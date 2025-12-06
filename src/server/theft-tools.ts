import { z } from 'zod';
import { getDb } from '../storage/index.js';
import { TheftRepository } from '../storage/repos/theft.repo.js';
import { HeatLevelSchema, HEAT_VALUES, compareHeatLevels } from '../schema/theft.js';
import { SessionContext } from './types.js';

/**
 * HIGH-008: Theft System Tools
 * Tools for stolen item tracking, heat decay, and fence mechanics
 */

// ============================================================
// TOOL DEFINITIONS
// ============================================================

export const TheftTools = {
    STEAL_ITEM: {
        name: 'steal_item',
        description: `Record a theft event. Marks an item as stolen from one character and creates a "hot" theft record.

The theft creates a provenance record that:
- Can be detected by the original owner
- May trigger guard searches
- Affects NPC disposition if detected
- Heat decays over time (burning → hot → warm → cool → cold)

Example:
{
  "thiefId": "rogue-1",
  "victimId": "merchant-1",
  "itemId": "ruby-necklace",
  "witnesses": ["guard-1"],
  "locationId": "marketplace"
}`,
        inputSchema: z.object({
            thiefId: z.string().describe('Character performing the theft'),
            victimId: z.string().describe('Character being stolen from'),
            itemId: z.string().describe('Item being stolen'),
            witnesses: z.array(z.string()).optional().describe('NPCs who witnessed the theft'),
            locationId: z.string().optional().describe('Where the theft occurred')
        })
    },

    CHECK_ITEM_STOLEN: {
        name: 'check_item_stolen',
        description: 'Check if an item is stolen and get its provenance details.',
        inputSchema: z.object({
            itemId: z.string()
        })
    },

    CHECK_STOLEN_ITEMS_ON_CHARACTER: {
        name: 'check_stolen_items_on_character',
        description: `Check if a character is carrying any stolen items.
Useful for guard searches, merchant inspections, etc.`,
        inputSchema: z.object({
            characterId: z.string(),
            checkerId: z.string().optional().describe('The NPC/guard doing the checking')
        })
    },

    CHECK_ITEM_RECOGNITION: {
        name: 'check_item_recognition',
        description: `Check if an NPC recognizes a stolen item.
- Original owner ALWAYS recognizes their items
- Guards have chance based on bounty/heat level
- Other NPCs rarely recognize unless item is famous`,
        inputSchema: z.object({
            npcId: z.string().describe('NPC who might recognize the item'),
            characterId: z.string().describe('Character carrying the item'),
            itemId: z.string().describe('Item to check')
        })
    },

    SELL_TO_FENCE: {
        name: 'sell_to_fence',
        description: `Sell a stolen item to a fence NPC.
Fences pay reduced prices but don't ask questions.
After cooldown period, the stolen flag is removed.`,
        inputSchema: z.object({
            sellerId: z.string(),
            fenceId: z.string(),
            itemId: z.string(),
            itemValue: z.number().int().min(0).describe('Base value of the item in gold')
        })
    },

    REGISTER_FENCE: {
        name: 'register_fence',
        description: 'Register an NPC as a fence (buys stolen goods).',
        inputSchema: z.object({
            npcId: z.string(),
            factionId: z.string().optional(),
            buyRate: z.number().min(0.1).max(1.0).optional().default(0.4),
            maxHeatLevel: HeatLevelSchema.optional().default('hot'),
            dailyHeatCapacity: z.number().int().min(0).optional().default(100),
            specializations: z.array(z.string()).optional(),
            cooldownDays: z.number().int().min(0).optional().default(7)
        })
    },

    REPORT_THEFT: {
        name: 'report_theft',
        description: 'Report a theft to guards, setting bounty and increasing detection chance.',
        inputSchema: z.object({
            reporterId: z.string(),
            itemId: z.string(),
            bountyOffered: z.number().int().min(0).optional().default(0)
        })
    },

    ADVANCE_HEAT_DECAY: {
        name: 'advance_heat_decay',
        description: 'Process heat decay for all stolen items when game time advances.',
        inputSchema: z.object({
            daysAdvanced: z.number().int().min(1)
        })
    },

    GET_FENCE: {
        name: 'get_fence',
        description: 'Get information about a fence NPC.',
        inputSchema: z.object({
            npcId: z.string()
        })
    },

    LIST_FENCES: {
        name: 'list_fences',
        description: 'List all registered fences, optionally filtered by faction.',
        inputSchema: z.object({
            factionId: z.string().optional()
        })
    }
} as const;

// ============================================================
// TOOL HANDLERS
// ============================================================

function getRepo(): TheftRepository {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return new TheftRepository(db);
}

export async function handleStealItem(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.STEAL_ITEM.inputSchema.parse(args);
    const repo = getRepo();

    // EDGE-001: Prevent self-theft - a character cannot steal from themselves
    if (parsed.thiefId === parsed.victimId) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    error: 'A character cannot steal from themselves'
                }, null, 2)
            }]
        };
    }

    const record = repo.recordTheft({
        itemId: parsed.itemId,
        stolenFrom: parsed.victimId,
        stolenBy: parsed.thiefId,
        stolenLocation: parsed.locationId ?? null,
        witnesses: parsed.witnesses ?? []
    });

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                record,
                message: `Item ${parsed.itemId} marked as stolen from ${parsed.victimId} by ${parsed.thiefId}`,
                heatLevel: record.heatLevel,
                witnesses: record.witnesses.length
            }, null, 2)
        }]
    };
}

export async function handleCheckItemStolen(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.CHECK_ITEM_STOLEN.inputSchema.parse(args);
    const repo = getRepo();

    const record = repo.getTheftRecord(parsed.itemId);
    const isStolen = record !== null;

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                itemId: parsed.itemId,
                isStolen,
                record: record ?? undefined,
                heatLevel: record?.heatLevel ?? null,
                originalOwner: record?.stolenFrom ?? null,
                thief: record?.stolenBy ?? null,
                reportedToGuards: record?.reportedToGuards ?? false,
                bounty: record?.bounty ?? 0
            }, null, 2)
        }]
    };
}

export async function handleCheckStolenItemsOnCharacter(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.inputSchema.parse(args);
    const repo = getRepo();

    const stolenItems = repo.getStolenItemsHeldBy(parsed.characterId);

    // Calculate detection risk based on heat levels
    let detectionRisk = 'none';
    let hottest = 'cold';
    for (const item of stolenItems) {
        if (compareHeatLevels(item.heatLevel, hottest as any) > 0) {
            hottest = item.heatLevel;
        }
    }

    if (hottest === 'burning') detectionRisk = 'very high';
    else if (hottest === 'hot') detectionRisk = 'high';
    else if (hottest === 'warm') detectionRisk = 'moderate';
    else if (hottest === 'cool') detectionRisk = 'low';

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                characterId: parsed.characterId,
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
            }, null, 2)
        }]
    };
}

export async function handleCheckItemRecognition(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.CHECK_ITEM_RECOGNITION.inputSchema.parse(args);
    const repo = getRepo();

    const record = repo.getTheftRecord(parsed.itemId);

    if (!record) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    itemId: parsed.itemId,
                    recognized: false,
                    isStolen: false,
                    reason: 'Item is not stolen'
                }, null, 2)
            }]
        };
    }

    // Original owner ALWAYS recognizes
    if (parsed.npcId === record.stolenFrom) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    itemId: parsed.itemId,
                    recognized: true,
                    isStolen: true,
                    recognizedBy: 'original_owner',
                    message: 'That belongs to me! THIEF!',
                    reaction: 'hostile',
                    stolenFrom: record.stolenFrom,
                    stolenAt: record.stolenAt
                }, null, 2)
            }]
        };
    }

    // Witnesses recognize
    if (record.witnesses.includes(parsed.npcId)) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    itemId: parsed.itemId,
                    recognized: true,
                    isStolen: true,
                    recognizedBy: 'witness',
                    message: 'I saw you steal that!',
                    reaction: 'suspicious'
                }, null, 2)
            }]
        };
    }

    // Guards check based on heat and bounty
    // TODO: Check if NPC is a guard based on faction/role
    const heatValue = HEAT_VALUES[record.heatLevel];
    const recognitionChance = Math.min(100, heatValue + record.bounty / 10);
    const roll = Math.random() * 100;

    if (roll < recognitionChance) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    itemId: parsed.itemId,
                    recognized: true,
                    isStolen: true,
                    recognizedBy: 'suspicion',
                    roll: Math.floor(roll),
                    threshold: Math.floor(recognitionChance),
                    message: 'That looks suspicious...',
                    reaction: 'suspicious'
                }, null, 2)
            }]
        };
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                itemId: parsed.itemId,
                recognized: false,
                isStolen: true,
                roll: Math.floor(roll),
                threshold: Math.floor(recognitionChance),
                reason: 'NPC did not recognize the item'
            }, null, 2)
        }]
    };
}

export async function handleSellToFence(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.SELL_TO_FENCE.inputSchema.parse(args);
    const repo = getRepo();

    const record = repo.getTheftRecord(parsed.itemId);
    if (!record) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    reason: 'Item is not stolen - no need for a fence'
                }, null, 2)
            }]
        };
    }

    const check = repo.canFenceAccept(parsed.fenceId, record, parsed.itemValue);
    if (!check.accepted) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    reason: check.reason
                }, null, 2)
            }]
        };
    }

    // Record the transaction
    repo.recordFenceTransaction(parsed.fenceId, parsed.itemId, record.heatLevel);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                itemId: parsed.itemId,
                fenceId: parsed.fenceId,
                price: check.price,
                baseValue: parsed.itemValue,
                heatLevel: record.heatLevel,
                message: `Sold for ${check.price} gold (${Math.floor((check.price! / parsed.itemValue) * 100)}% of value)`
            }, null, 2)
        }]
    };
}

export async function handleRegisterFence(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.REGISTER_FENCE.inputSchema.parse(args);
    const repo = getRepo();

    // EDGE-006: Prevent theft victims from being registered as fences
    // This creates immersion-breaking scenarios where victims buy back their own stolen goods
    const stolenFromVictim = repo.getItemsStolenFrom(parsed.npcId);
    if (stolenFromVictim.length > 0) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    error: 'Cannot register a theft victim as a fence',
                    reason: `${parsed.npcId} has had ${stolenFromVictim.length} item(s) stolen from them`,
                    suggestion: 'Theft victims cannot act as fences for narrative consistency'
                }, null, 2)
            }]
        };
    }

    const fence = repo.registerFence({
        npcId: parsed.npcId,
        factionId: parsed.factionId ?? null,
        buyRate: parsed.buyRate,
        maxHeatLevel: parsed.maxHeatLevel,
        dailyHeatCapacity: parsed.dailyHeatCapacity,
        specializations: parsed.specializations ?? [],
        cooldownDays: parsed.cooldownDays
    });

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                fence,
                message: `${parsed.npcId} registered as a fence`
            }, null, 2)
        }]
    };
}

export async function handleReportTheft(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.REPORT_THEFT.inputSchema.parse(args);
    const repo = getRepo();

    const record = repo.getTheftRecord(parsed.itemId);
    if (!record) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    reason: 'No theft record found for this item'
                }, null, 2)
            }]
        };
    }

    repo.reportToGuards(parsed.itemId, parsed.bountyOffered ?? 0);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                itemId: parsed.itemId,
                reportedBy: parsed.reporterId,
                bounty: parsed.bountyOffered ?? 0,
                message: 'Theft reported to guards'
            }, null, 2)
        }]
    };
}

export async function handleAdvanceHeatDecay(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.ADVANCE_HEAT_DECAY.inputSchema.parse(args);
    const repo = getRepo();

    const changes = repo.processHeatDecay(parsed.daysAdvanced);

    // Also reset fence daily capacity
    repo.resetFenceDailyCapacity();

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                daysAdvanced: parsed.daysAdvanced,
                itemsDecayed: changes.length,
                changes: changes.map(c => ({
                    itemId: c.itemId,
                    from: c.oldHeat,
                    to: c.newHeat
                }))
            }, null, 2)
        }]
    };
}

export async function handleGetFence(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.GET_FENCE.inputSchema.parse(args);
    const repo = getRepo();

    const fence = repo.getFence(parsed.npcId);

    if (!fence) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    found: false,
                    npcId: parsed.npcId,
                    message: 'NPC is not a registered fence'
                }, null, 2)
            }]
        };
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                found: true,
                fence
            }, null, 2)
        }]
    };
}

export async function handleListFences(args: unknown, _ctx: SessionContext) {
    const parsed = TheftTools.LIST_FENCES.inputSchema.parse(args);
    const repo = getRepo();

    const fences = repo.listFences(parsed.factionId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                count: fences.length,
                factionFilter: parsed.factionId ?? 'all',
                fences
            }, null, 2)
        }]
    };
}
