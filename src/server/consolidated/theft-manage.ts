/**
 * Consolidated Theft Management Tool
 * Replaces 10 separate tools for theft and fence mechanics:
 * steal_item, check_item_stolen, check_stolen_items_on_character,
 * check_item_recognition, sell_to_fence, register_fence, report_theft,
 * advance_heat_decay, get_fence, list_fences
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { TheftRepository } from '../../storage/repos/theft.repo.js';
import { HeatLevelSchema, HEAT_VALUES, compareHeatLevels, HeatLevel } from '../../schema/theft.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['steal', 'check', 'search', 'recognize', 'sell', 'register_fence', 'report', 'decay', 'get_fence', 'list_fences'] as const;
type TheftManageAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function getRepo(): TheftRepository {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return new TheftRepository(db);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const StealSchema = z.object({
    action: z.literal('steal'),
    thiefId: z.string().describe('Character performing the theft'),
    victimId: z.string().describe('Character being stolen from'),
    itemId: z.string().describe('Item being stolen'),
    witnesses: z.array(z.string()).optional().describe('NPCs who witnessed'),
    locationId: z.string().optional().describe('Location of theft')
});

const CheckSchema = z.object({
    action: z.literal('check'),
    itemId: z.string().describe('Item to check')
});

const SearchSchema = z.object({
    action: z.literal('search'),
    characterId: z.string().describe('Character to search'),
    checkerId: z.string().optional().describe('Guard/NPC searching')
});

const RecognizeSchema = z.object({
    action: z.literal('recognize'),
    npcId: z.string().describe('NPC who might recognize'),
    characterId: z.string().describe('Character carrying item'),
    itemId: z.string().describe('Item to check')
});

const SellSchema = z.object({
    action: z.literal('sell'),
    sellerId: z.string().describe('Character selling'),
    fenceId: z.string().describe('Fence NPC'),
    itemId: z.string().describe('Item to sell'),
    itemValue: z.number().int().min(0).describe('Base value in gold')
});

const RegisterFenceSchema = z.object({
    action: z.literal('register_fence'),
    npcId: z.string().describe('NPC to register as fence'),
    factionId: z.string().optional(),
    buyRate: z.number().min(0.1).max(1.0).optional().default(0.4),
    maxHeatLevel: HeatLevelSchema.optional().default('hot'),
    dailyHeatCapacity: z.number().int().min(0).optional().default(100),
    specializations: z.array(z.string()).optional(),
    cooldownDays: z.number().int().min(0).optional().default(7)
});

const ReportSchema = z.object({
    action: z.literal('report'),
    reporterId: z.string().describe('Who is reporting'),
    itemId: z.string().describe('Stolen item'),
    bountyOffered: z.number().int().min(0).optional().default(0)
});

const DecaySchema = z.object({
    action: z.literal('decay'),
    daysAdvanced: z.number().int().min(1).describe('Days to advance')
});

const GetFenceSchema = z.object({
    action: z.literal('get_fence'),
    npcId: z.string().describe('Fence NPC ID')
});

const ListFencesSchema = z.object({
    action: z.literal('list_fences'),
    factionId: z.string().optional().describe('Filter by faction')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleSteal(args: z.infer<typeof StealSchema>): Promise<object> {
    const repo = getRepo();

    // Prevent self-theft
    if (args.thiefId === args.victimId) {
        return { error: true, message: 'A character cannot steal from themselves' };
    }

    const record = repo.recordTheft({
        itemId: args.itemId,
        stolenFrom: args.victimId,
        stolenBy: args.thiefId,
        stolenLocation: args.locationId ?? null,
        witnesses: args.witnesses ?? []
    });

    return {
        success: true,
        actionType: 'steal',
        record,
        message: `Item ${args.itemId} stolen from ${args.victimId} by ${args.thiefId}`,
        heatLevel: record.heatLevel,
        witnesses: record.witnesses.length
    };
}

async function handleCheck(args: z.infer<typeof CheckSchema>): Promise<object> {
    const repo = getRepo();
    const record = repo.getTheftRecord(args.itemId);

    return {
        success: true,
        actionType: 'check',
        itemId: args.itemId,
        isStolen: record !== null,
        record: record ?? undefined,
        heatLevel: record?.heatLevel ?? null,
        originalOwner: record?.stolenFrom ?? null,
        thief: record?.stolenBy ?? null,
        reportedToGuards: record?.reportedToGuards ?? false,
        bounty: record?.bounty ?? 0
    };
}

async function handleSearch(args: z.infer<typeof SearchSchema>): Promise<object> {
    const repo = getRepo();
    const stolenItems = repo.getStolenItemsHeldBy(args.characterId);

    let detectionRisk = 'none';
    let hottest: HeatLevel = 'cold';
    for (const item of stolenItems) {
        if (compareHeatLevels(item.heatLevel, hottest) > 0) {
            hottest = item.heatLevel;
        }
    }

    if (hottest === 'burning') detectionRisk = 'very high';
    else if (hottest === 'hot') detectionRisk = 'high';
    else if (hottest === 'warm') detectionRisk = 'moderate';
    else if (hottest === 'cool') detectionRisk = 'low';

    return {
        success: true,
        actionType: 'search',
        characterId: args.characterId,
        stolenItemCount: stolenItems.length,
        detectionRisk,
        hottestItem: hottest,
        items: stolenItems.map(i => ({
            itemId: i.itemId,
            heatLevel: i.heatLevel,
            stolenFrom: i.stolenFrom,
            reportedToGuards: i.reportedToGuards,
            bounty: i.bounty
        }))
    };
}

async function handleRecognize(args: z.infer<typeof RecognizeSchema>): Promise<object> {
    const repo = getRepo();
    const record = repo.getTheftRecord(args.itemId);

    if (!record) {
        return {
            success: true,
            actionType: 'recognize',
            itemId: args.itemId,
            recognized: false,
            isStolen: false,
            reason: 'Item is not stolen'
        };
    }

    // Original owner always recognizes
    if (args.npcId === record.stolenFrom) {
        return {
            success: true,
            actionType: 'recognize',
            itemId: args.itemId,
            recognized: true,
            isStolen: true,
            recognizedBy: 'original_owner',
            message: 'That belongs to me! THIEF!',
            reaction: 'hostile'
        };
    }

    // Witnesses recognize
    if (record.witnesses.includes(args.npcId)) {
        return {
            success: true,
            actionType: 'recognize',
            itemId: args.itemId,
            recognized: true,
            isStolen: true,
            recognizedBy: 'witness',
            message: 'I saw you steal that!',
            reaction: 'suspicious'
        };
    }

    // Guards check based on heat and bounty
    const heatValue = HEAT_VALUES[record.heatLevel];
    const recognitionChance = Math.min(100, heatValue + record.bounty / 10);
    const roll = Math.random() * 100;

    if (roll < recognitionChance) {
        return {
            success: true,
            actionType: 'recognize',
            itemId: args.itemId,
            recognized: true,
            isStolen: true,
            recognizedBy: 'suspicion',
            roll: Math.floor(roll),
            threshold: Math.floor(recognitionChance),
            reaction: 'suspicious'
        };
    }

    return {
        success: true,
        actionType: 'recognize',
        itemId: args.itemId,
        recognized: false,
        isStolen: true,
        roll: Math.floor(roll),
        threshold: Math.floor(recognitionChance)
    };
}

async function handleSell(args: z.infer<typeof SellSchema>): Promise<object> {
    const repo = getRepo();
    const record = repo.getTheftRecord(args.itemId);

    if (!record) {
        return { error: true, message: 'Item is not stolen - no need for a fence' };
    }

    const check = repo.canFenceAccept(args.fenceId, record, args.itemValue);
    if (!check.accepted) {
        return { error: true, message: check.reason };
    }

    repo.recordFenceTransaction(args.fenceId, args.itemId, record.heatLevel);

    return {
        success: true,
        actionType: 'sell',
        itemId: args.itemId,
        fenceId: args.fenceId,
        price: check.price,
        baseValue: args.itemValue,
        heatLevel: record.heatLevel,
        message: `Sold for ${check.price} gold (${Math.floor((check.price! / args.itemValue) * 100)}% of value)`
    };
}

async function handleRegisterFence(args: z.infer<typeof RegisterFenceSchema>): Promise<object> {
    const repo = getRepo();

    // Prevent theft victims from being fences
    const stolenFromVictim = repo.getItemsStolenFrom(args.npcId);
    if (stolenFromVictim.length > 0) {
        return {
            error: true,
            message: `Cannot register a theft victim as a fence`,
            reason: `${args.npcId} has had ${stolenFromVictim.length} item(s) stolen`
        };
    }

    const fence = repo.registerFence({
        npcId: args.npcId,
        factionId: args.factionId ?? null,
        buyRate: args.buyRate,
        maxHeatLevel: args.maxHeatLevel,
        dailyHeatCapacity: args.dailyHeatCapacity,
        specializations: args.specializations ?? [],
        cooldownDays: args.cooldownDays
    });

    return {
        success: true,
        actionType: 'register_fence',
        fence,
        message: `${args.npcId} registered as a fence`
    };
}

async function handleReport(args: z.infer<typeof ReportSchema>): Promise<object> {
    const repo = getRepo();
    const record = repo.getTheftRecord(args.itemId);

    if (!record) {
        return { error: true, message: 'No theft record found for this item' };
    }

    repo.reportToGuards(args.itemId, args.bountyOffered ?? 0);

    return {
        success: true,
        actionType: 'report',
        itemId: args.itemId,
        reportedBy: args.reporterId,
        bounty: args.bountyOffered ?? 0,
        message: 'Theft reported to guards'
    };
}

async function handleDecay(args: z.infer<typeof DecaySchema>): Promise<object> {
    const repo = getRepo();
    const changes = repo.processHeatDecay(args.daysAdvanced);
    repo.resetFenceDailyCapacity();

    return {
        success: true,
        actionType: 'decay',
        daysAdvanced: args.daysAdvanced,
        itemsDecayed: changes.length,
        changes: changes.map(c => ({
            itemId: c.itemId,
            from: c.oldHeat,
            to: c.newHeat
        }))
    };
}

async function handleGetFence(args: z.infer<typeof GetFenceSchema>): Promise<object> {
    const repo = getRepo();
    const fence = repo.getFence(args.npcId);

    if (!fence) {
        return {
            success: true,
            actionType: 'get_fence',
            found: false,
            npcId: args.npcId,
            message: 'NPC is not a registered fence'
        };
    }

    return {
        success: true,
        actionType: 'get_fence',
        found: true,
        fence
    };
}

async function handleListFences(args: z.infer<typeof ListFencesSchema>): Promise<object> {
    const repo = getRepo();
    const fences = repo.listFences(args.factionId);

    return {
        success: true,
        actionType: 'list_fences',
        count: fences.length,
        factionFilter: args.factionId ?? 'all',
        fences
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<TheftManageAction, ActionDefinition> = {
    steal: {
        schema: StealSchema,
        handler: handleSteal,
        aliases: ['record_theft', 'thieve'],
        description: 'Record a theft event'
    },
    check: {
        schema: CheckSchema,
        handler: handleCheck,
        aliases: ['check_stolen', 'provenance'],
        description: 'Check if an item is stolen'
    },
    search: {
        schema: SearchSchema,
        handler: handleSearch,
        aliases: ['frisk', 'check_character'],
        description: 'Search character for stolen items'
    },
    recognize: {
        schema: RecognizeSchema,
        handler: handleRecognize,
        aliases: ['identify', 'spot'],
        description: 'Check if NPC recognizes stolen item'
    },
    sell: {
        schema: SellSchema,
        handler: handleSell,
        aliases: ['fence', 'sell_to_fence'],
        description: 'Sell stolen item to fence'
    },
    register_fence: {
        schema: RegisterFenceSchema,
        handler: handleRegisterFence,
        aliases: ['add_fence', 'create_fence'],
        description: 'Register an NPC as a fence'
    },
    report: {
        schema: ReportSchema,
        handler: handleReport,
        aliases: ['report_theft', 'alert_guards'],
        description: 'Report theft to guards'
    },
    decay: {
        schema: DecaySchema,
        handler: handleDecay,
        aliases: ['advance_time', 'heat_decay'],
        description: 'Process heat decay over time'
    },
    get_fence: {
        schema: GetFenceSchema,
        handler: handleGetFence,
        aliases: ['fence_info'],
        description: 'Get fence NPC information'
    },
    list_fences: {
        schema: ListFencesSchema,
        handler: handleListFences,
        aliases: ['fences', 'all_fences'],
        description: 'List all registered fences'
    }
};

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION & HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export const TheftManageTool = {
    name: 'theft_manage',
    description: `Manage theft mechanics, stolen items, and fence NPCs.
Actions: steal, check, search, recognize, sell, register_fence, report, decay, get_fence, list_fences
Aliases: fence→sell, frisk→search, provenance→check

HEAT LEVELS (decay over time):
- burning: Just stolen, very high detection
- hot: Recent theft, high detection
- warm: Moderate detection
- cool: Low detection
- cold: Safe to sell normally

THEFT WORKFLOW:
1. steal - Record a theft
2. check - Check item provenance
3. search - Guard searches character
4. recognize - NPC recognition check
5. report - Report to guards (adds bounty)
6. sell - Sell to fence
7. decay - Process heat over time

FENCE WORKFLOW:
1. register_fence - Add fence NPC
2. get_fence - Get fence info
3. list_fences - List all fences`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        thiefId: z.string().optional(),
        victimId: z.string().optional(),
        itemId: z.string().optional(),
        characterId: z.string().optional(),
        npcId: z.string().optional(),
        sellerId: z.string().optional(),
        fenceId: z.string().optional(),
        reporterId: z.string().optional(),
        checkerId: z.string().optional(),
        witnesses: z.array(z.string()).optional(),
        locationId: z.string().optional(),
        itemValue: z.number().optional(),
        bountyOffered: z.number().optional(),
        daysAdvanced: z.number().optional(),
        factionId: z.string().optional(),
        buyRate: z.number().optional(),
        maxHeatLevel: z.string().optional(),
        dailyHeatCapacity: z.number().optional(),
        specializations: z.array(z.string()).optional(),
        cooldownDays: z.number().optional()
    })
};

export async function handleTheftManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args as Record<string, unknown>);
    const parsed = JSON.parse(result.content[0].text);

    let output = '';

    if (parsed.error) {
        output = RichFormatter.header('Error', '');
        output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        if (parsed.suggestions) {
            output += '\n**Did you mean:**\n';
            parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                output += `  - ${s.action} (${s.similarity}% match)\n`;
            });
        }
    } else {
        switch (parsed.actionType) {
            case 'steal':
                output = RichFormatter.header('Theft Recorded', '');
                output += RichFormatter.keyValue({
                    'Item': `\`${parsed.record?.itemId}\``,
                    'Victim': parsed.record?.stolenFrom,
                    'Thief': parsed.record?.stolenBy,
                    'Heat': parsed.heatLevel,
                    'Witnesses': parsed.witnesses
                });
                break;

            case 'check':
                output = RichFormatter.header('Item Provenance', '');
                output += RichFormatter.keyValue({
                    'Item': `\`${parsed.itemId}\``,
                    'Stolen': parsed.isStolen ? 'Yes' : 'No',
                    'Heat': parsed.heatLevel || 'N/A',
                    'Original Owner': parsed.originalOwner || 'N/A',
                    'Bounty': parsed.bounty || 0
                });
                break;

            case 'search':
                output = RichFormatter.header('Character Search', '');
                output += RichFormatter.keyValue({
                    'Character': `\`${parsed.characterId}\``,
                    'Stolen Items': parsed.stolenItemCount,
                    'Detection Risk': parsed.detectionRisk,
                    'Hottest Item': parsed.hottestItem
                });
                break;

            case 'recognize':
                output = RichFormatter.header('Recognition Check', '');
                output += RichFormatter.keyValue({
                    'Item': `\`${parsed.itemId}\``,
                    'Recognized': parsed.recognized ? 'Yes' : 'No',
                    'By': parsed.recognizedBy || 'N/A',
                    'Reaction': parsed.reaction || 'None'
                });
                break;

            case 'sell':
                output = RichFormatter.header('Fence Sale', '');
                output += RichFormatter.keyValue({
                    'Item': `\`${parsed.itemId}\``,
                    'Price': `${parsed.price} gold`,
                    'Base Value': `${parsed.baseValue} gold`,
                    'Heat': parsed.heatLevel
                });
                break;

            case 'register_fence':
                output = RichFormatter.header('Fence Registered', '');
                output += RichFormatter.keyValue({
                    'NPC': `\`${parsed.fence?.npcId}\``,
                    'Buy Rate': `${(parsed.fence?.buyRate * 100).toFixed(0)}%`,
                    'Max Heat': parsed.fence?.maxHeatLevel
                });
                break;

            case 'report':
                output = RichFormatter.header('Theft Reported', '');
                output += RichFormatter.keyValue({
                    'Item': `\`${parsed.itemId}\``,
                    'Bounty': `${parsed.bounty} gold`
                });
                break;

            case 'decay':
                output = RichFormatter.header('Heat Decay', '');
                output += RichFormatter.keyValue({
                    'Days Advanced': parsed.daysAdvanced,
                    'Items Decayed': parsed.itemsDecayed
                });
                break;

            case 'get_fence':
                output = RichFormatter.header('Fence Info', '');
                if (parsed.found) {
                    output += RichFormatter.keyValue({
                        'NPC': `\`${parsed.fence?.npcId}\``,
                        'Buy Rate': `${(parsed.fence?.buyRate * 100).toFixed(0)}%`,
                        'Max Heat': parsed.fence?.maxHeatLevel
                    });
                } else {
                    output += 'Not a registered fence.\n';
                }
                break;

            case 'list_fences':
                output = RichFormatter.header(`Fences (${parsed.count})`, '');
                if (parsed.fences?.length > 0) {
                    parsed.fences.forEach((f: any) => {
                        output += `- **${f.npcId}** (${(f.buyRate * 100).toFixed(0)}%)\n`;
                    });
                } else {
                    output += 'No registered fences.\n';
                }
                break;

            default:
                output = RichFormatter.header('Theft', '');
                if (parsed.message) output += parsed.message + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'THEFT_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
