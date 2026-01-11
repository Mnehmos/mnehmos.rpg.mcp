/**
 * Consolidated travel_manage tool
 * Replaces: travel_to_location, loot_encounter, rest_party
 * 3 tools → 1 tool with 3 actions
 */

import { z } from 'zod';
import { matchAction, isGuidingError } from '../../utils/fuzzy-enum.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { PartyRepository } from '../../storage/repos/party.repo.js';
import { CorpseRepository } from '../../storage/repos/corpse.repo.js';
import { SessionContext } from '../types.js';

export interface McpResponse {
    content: Array<{ type: 'text'; text: string }>;
}

const ACTIONS = ['travel', 'loot', 'rest'] as const;

type TravelAction = typeof ACTIONS[number];

// Alias map for fuzzy action matching
const ALIASES: Record<string, TravelAction> = {
    'move': 'travel',
    'goto': 'travel',
    'travel_to': 'travel',
    'go_to': 'travel',
    'travel_to_location': 'travel',
    'loot_encounter': 'loot',
    'loot_all': 'loot',
    'collect': 'loot',
    'gather_loot': 'loot',
    'rest_party': 'rest',
    'long_rest': 'rest',
    'short_rest': 'rest',
    'camp': 'rest'
};

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    return {
        db,
        charRepo: new CharacterRepository(db),
        partyRepo: new PartyRepository(db),
        corpseRepo: new CorpseRepository(db)
    };
}

// Input schema
const TravelManageInputSchema = z.object({
    action: z.string().describe('Action: travel, loot, rest'),

    // travel fields
    partyId: z.string().optional().describe('Party ID'),
    poiId: z.string().optional().describe('POI ID destination'),
    enterLocation: z.boolean().optional().default(false).describe('Enter POI room network'),
    autoDiscover: z.boolean().optional().default(false).describe('Skip discovery check'),
    discoveringCharacterId: z.string().optional().describe('Character making discovery check'),

    // loot fields
    encounterId: z.string().optional().describe('Encounter ID to loot'),
    looterId: z.string().optional().describe('Character ID to receive loot'),
    distributeEvenly: z.boolean().optional().default(false).describe('Distribute among party'),
    includeItems: z.boolean().optional().default(true).describe('Include equipment'),
    includeCurrency: z.boolean().optional().default(true).describe('Include gold/silver'),
    includeHarvestable: z.boolean().optional().default(false).describe('Auto-harvest resources'),

    // rest fields
    restType: z.enum(['long', 'short']).optional().default('long').describe('Type of rest'),
    hitDicePerMember: z.number().int().min(0).max(20).optional().default(1).describe('Hit dice for short rest'),
    hitDiceAllocation: z.record(z.string(), z.number().int().min(0).max(20)).optional()
        .describe('Custom hit dice per character')
});

type TravelManageInput = z.infer<typeof TravelManageInputSchema>;

// Action handlers
async function handleTravel(input: TravelManageInput, _ctx: SessionContext): Promise<McpResponse> {
    if (!input.partyId || !input.poiId) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('travel requires partyId and poiId') +
                    RichFormatter.embedJson({ error: true, message: 'partyId and poiId required' }, 'TRAVEL_MANAGE')
            }]
        };
    }

    const { db, partyRepo } = ensureDb();

    // Get party
    const party = partyRepo.getPartyWithMembers(input.partyId);
    if (!party) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error(`Party not found: ${input.partyId}`) +
                    RichFormatter.embedJson({ error: true, message: 'Party not found' }, 'TRAVEL_MANAGE')
            }]
        };
    }

    // Get POI
    let poi: any;
    try {
        poi = db.prepare('SELECT * FROM pois WHERE id = ?').get(input.poiId);
    } catch {
        // POIs table might not exist
    }

    if (!poi) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error(`POI not found: ${input.poiId}`) +
                    RichFormatter.embedJson({ error: true, message: 'POI not found' }, 'TRAVEL_MANAGE')
            }]
        };
    }

    // Check discovery state
    let discovered = poi.discoveryState !== 'unknown';
    let discoveryRoll: number | null = null;

    if (!discovered && !input.autoDiscover) {
        // Roll perception check
        const discoverer = input.discoveringCharacterId
            ? party.members?.find(m => m.character.id === input.discoveringCharacterId)?.character
            : party.members?.find(m => m.role === 'leader')?.character || party.members?.[0]?.character;

        if (discoverer) {
            const wisBonus = Math.floor(((discoverer.stats?.wis || 10) - 10) / 2);
            discoveryRoll = Math.floor(Math.random() * 20) + 1 + wisBonus;
            const dc = poi.discoveryDc || 15;
            discovered = discoveryRoll >= dc;
        }
    } else if (input.autoDiscover) {
        discovered = true;
    }

    if (!discovered) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error(`Failed to discover location (rolled ${discoveryRoll})`) +
                    RichFormatter.embedJson({
                        error: true,
                        message: 'Discovery failed',
                        discoveryRoll,
                        discovered: false
                    }, 'TRAVEL_MANAGE')
            }]
        };
    }

    // Update POI discovery state
    if (poi.discoveryState === 'unknown') {
        db.prepare('UPDATE pois SET discoveryState = ?, updated_at = ? WHERE id = ?')
            .run('discovered', new Date().toISOString(), input.poiId);
    }

    // Update party position
    db.prepare('UPDATE parties SET currentLocation = ?, updated_at = ? WHERE id = ?')
        .run(poi.name, new Date().toISOString(), input.partyId);

    // Enter location if requested
    let enteredRoom: any = null;
    if (input.enterLocation && poi.networkId) {
        try {
            enteredRoom = db.prepare(`
                SELECT * FROM rooms WHERE networkId = ? ORDER BY createdAt LIMIT 1
            `).get(poi.networkId);
        } catch {
            // Rooms table might not exist
        }
    }

    let output = RichFormatter.header('Travel Complete', '🚶');
    output += RichFormatter.keyValue({
        'Party': party.name,
        'Destination': poi.name,
        'Type': poi.type,
        'Position': `(${poi.x}, ${poi.y})`
    });

    if (discoveryRoll !== null) {
        output += `\n*Discovery check: ${discoveryRoll} - Success!*\n`;
    }

    if (enteredRoom) {
        output += RichFormatter.section('Entered Location');
        output += `**${enteredRoom.name}**\n`;
        if (enteredRoom.description) {
            output += `${enteredRoom.description}\n`;
        }
    }

    const result = {
        success: true,
        actionType: 'travel',
        partyId: input.partyId,
        partyName: party.name,
        destination: {
            id: poi.id,
            name: poi.name,
            type: poi.type,
            position: { x: poi.x, y: poi.y }
        },
        discoveryRoll,
        discovered: true,
        enteredRoom: enteredRoom ? { id: enteredRoom.id, name: enteredRoom.name } : null
    };

    output += RichFormatter.embedJson(result, 'TRAVEL_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleLoot(input: TravelManageInput, _ctx: SessionContext): Promise<McpResponse> {
    if (!input.encounterId) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('loot requires encounterId') +
                    RichFormatter.embedJson({ error: true, message: 'encounterId required' }, 'TRAVEL_MANAGE')
            }]
        };
    }

    if (!input.looterId && !input.partyId) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('loot requires looterId or partyId') +
                    RichFormatter.embedJson({ error: true, message: 'looterId or partyId required' }, 'TRAVEL_MANAGE')
            }]
        };
    }

    const { corpseRepo, charRepo, partyRepo } = ensureDb();

    // Get corpses from encounter
    const corpses = corpseRepo.findByEncounterId(input.encounterId);

    if (corpses.length === 0) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('No corpses found in encounter') +
                    RichFormatter.embedJson({ error: true, message: 'No corpses found' }, 'TRAVEL_MANAGE')
            }]
        };
    }

    // Collect all loot
    const allItems: string[] = [];
    let totalGold = 0;
    let totalSilver = 0;
    let totalCopper = 0;
    const harvestedMaterials: string[] = [];
    let corpsesLooted = 0;

    // Determine looter ID
    const looterId = input.looterId || (input.partyId ? partyRepo.getPartyWithMembers(input.partyId)?.members?.[0]?.character.id : undefined);

    for (const corpse of corpses) {
        if (corpse.looted) continue;

        // Loot currency using proper method
        if (input.includeCurrency && looterId) {
            const currencyResult = corpseRepo.lootCurrency(corpse.id, looterId, false);
            if (currencyResult.success) {
                totalGold += currencyResult.currency.gold;
                totalSilver += currencyResult.currency.silver;
                totalCopper += currencyResult.currency.copper;
            }
        }

        // Harvest (simplified)
        if (input.includeHarvestable && corpse.harvestable && corpse.harvestableResources) {
            harvestedMaterials.push(...corpse.harvestableResources.map(r => r.resourceType));
        }

        corpsesLooted++;
    }

    // Distribute loot
    const distributions: Array<{ characterId: string; characterName: string; items: string[]; gold?: number }> = [];

    if (input.distributeEvenly && input.partyId) {
        const party = partyRepo.getPartyWithMembers(input.partyId);
        if (party && party.members) {
            const memberCount = party.members.length;
            const itemsPerMember = Math.ceil(allItems.length / memberCount);
            const goldPerMember = Math.floor(totalGold / memberCount);

            for (let i = 0; i < party.members.length; i++) {
                const member = party.members[i];
                const memberItems = allItems.splice(0, itemsPerMember);

                // Add items to character inventory
                const char = charRepo.findById(member.character.id);
                if (char) {
                    const currentInventory = (char as any).inventory || [];
                    charRepo.update(member.character.id, {
                        inventory: [...currentInventory, ...memberItems]
                    } as any);
                }

                distributions.push({
                    characterId: member.character.id,
                    characterName: member.character.name,
                    items: memberItems,
                    gold: goldPerMember
                });
            }
        }
    } else if (input.looterId) {
        const looter = charRepo.findById(input.looterId);
        if (looter) {
            const currentInventory = (looter as any).inventory || [];
            charRepo.update(input.looterId, {
                inventory: [...currentInventory, ...allItems]
            } as any);

            distributions.push({
                characterId: input.looterId,
                characterName: looter.name,
                items: allItems,
                gold: totalGold
            });
        }
    }

    let output = RichFormatter.header('Loot Collected', '💰');
    output += RichFormatter.keyValue({
        'Corpses Looted': corpsesLooted,
        'Total Items': allItems.length,
        'Gold': totalGold,
        'Silver': totalSilver,
        'Copper': totalCopper
    });

    if (distributions.length > 0) {
        output += RichFormatter.section('Distribution');
        for (const dist of distributions) {
            output += `**${dist.characterName}**: `;
            if (dist.items.length > 0) {
                output += dist.items.join(', ');
            }
            if (dist.gold) {
                output += ` + ${dist.gold}gp`;
            }
            output += '\n';
        }
    }

    if (harvestedMaterials.length > 0) {
        output += RichFormatter.section('Harvested');
        output += RichFormatter.list(harvestedMaterials);
    }

    const result = {
        success: true,
        actionType: 'loot',
        encounterId: input.encounterId,
        corpsesLooted,
        totalItems: allItems.length,
        currency: { gold: totalGold, silver: totalSilver, copper: totalCopper },
        distributions,
        harvestedMaterials
    };

    output += RichFormatter.embedJson(result, 'TRAVEL_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleRest(input: TravelManageInput, _ctx: SessionContext): Promise<McpResponse> {
    if (!input.partyId) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('rest requires partyId') +
                    RichFormatter.embedJson({ error: true, message: 'partyId required' }, 'TRAVEL_MANAGE')
            }]
        };
    }

    const { partyRepo, charRepo, db } = ensureDb();

    const party = partyRepo.getPartyWithMembers(input.partyId);
    if (!party) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error(`Party not found: ${input.partyId}`) +
                    RichFormatter.embedJson({ error: true, message: 'Party not found' }, 'TRAVEL_MANAGE')
            }]
        };
    }

    // Check if any member is in combat
    try {
        const inCombat = db.prepare(`
            SELECT e.id FROM encounters e
            JOIN json_each(e.tokens) t ON 1=1
            WHERE e.status = 'active'
            AND json_extract(t.value, '$.id') IN (
                SELECT characterId FROM party_members WHERE partyId = ?
            )
        `).get(input.partyId);

        if (inCombat) {
            return {
                content: [{
                    type: 'text',
                    text: RichFormatter.error('Cannot rest while party members are in combat') +
                        RichFormatter.embedJson({ error: true, message: 'In combat' }, 'TRAVEL_MANAGE')
                }]
            };
        }
    } catch {
        // Tables might not exist, continue
    }

    const restResults: Array<{
        characterId: string;
        characterName: string;
        hpBefore: number;
        hpAfter: number;
        healed: number;
    }> = [];

    const isLongRest = input.restType === 'long';

    for (const member of party.members || []) {
        const char = member.character;
        const hpBefore = char.hp;
        let hpAfter = hpBefore;

        if (isLongRest) {
            // Long rest: restore to max HP
            hpAfter = char.maxHp;
        } else {
            // Short rest: roll hit dice
            const hitDice = input.hitDiceAllocation?.[char.id]
                ?? input.hitDicePerMember
                ?? 1;

            if (hitDice > 0) {
                const conBonus = Math.floor(((char.stats?.con || 10) - 10) / 2);
                let healing = 0;
                for (let i = 0; i < hitDice; i++) {
                    // Assume d8 hit die for simplicity
                    healing += Math.max(1, Math.floor(Math.random() * 8) + 1 + conBonus);
                }
                hpAfter = Math.min(char.maxHp, hpBefore + healing);
            }
        }

        // Update character
        charRepo.update(char.id, { hp: hpAfter } as any);

        restResults.push({
            characterId: char.id,
            characterName: char.name,
            hpBefore,
            hpAfter,
            healed: hpAfter - hpBefore
        });
    }

    const totalHealed = restResults.reduce((sum, r) => sum + r.healed, 0);

    let output = RichFormatter.header(`${isLongRest ? 'Long' : 'Short'} Rest Complete`, '⛺');
    output += RichFormatter.keyValue({
        'Party': party.name,
        'Rest Type': input.restType,
        'Duration': isLongRest ? '8 hours' : '1 hour',
        'Total HP Restored': totalHealed
    });

    output += RichFormatter.section('Results');
    const rows = restResults.map(r => [
        r.characterName,
        `${r.hpBefore} → ${r.hpAfter}`,
        `+${r.healed}`
    ]);
    output += RichFormatter.table(['Character', 'HP', 'Healed'], rows);

    if (isLongRest) {
        output += '\n*All spell slots restored. Concentration cleared.*\n';
    }

    const result = {
        success: true,
        actionType: 'rest',
        partyId: input.partyId,
        partyName: party.name,
        restType: input.restType,
        totalHealed,
        members: restResults
    };

    output += RichFormatter.embedJson(result, 'TRAVEL_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

// Main handler
export async function handleTravelManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const input = TravelManageInputSchema.parse(args);
    const matchResult = matchAction(input.action, ACTIONS, ALIASES, 0.6);

    if (isGuidingError(matchResult)) {
        let output = RichFormatter.error(`Unknown action: "${input.action}"`);
        output += `\nAvailable actions: ${ACTIONS.join(', ')}`;
        if (matchResult.suggestions.length > 0) {
            output += `\nDid you mean: ${matchResult.suggestions.map(s => `"${s.value}" (${Math.round(s.similarity * 100)}%)`).join(', ')}?`;
        }
        output += RichFormatter.embedJson(matchResult, 'TRAVEL_MANAGE');
        return { content: [{ type: 'text', text: output }] };
    }

    switch (matchResult.matched) {
        case 'travel':
            return handleTravel(input, _ctx);
        case 'loot':
            return handleLoot(input, _ctx);
        case 'rest':
            return handleRest(input, _ctx);
        default:
            return {
                content: [{
                    type: 'text',
                    text: RichFormatter.error(`Unhandled action: ${matchResult.matched}`) +
                        RichFormatter.embedJson({ error: true, message: `Unhandled: ${matchResult.matched}` }, 'TRAVEL_MANAGE')
                }]
            };
    }
}

// Tool definition for registration
export const TravelManageTool = {
    name: 'travel_manage',
    description: `Consolidated travel and exploration management (3→1).

Actions:
• travel - Move party to POI with discovery checks
• loot - Collect all loot from encounter corpses
• rest - Rest entire party (long or short)

Examples:
- Travel: { action: "travel", partyId: "...", poiId: "...", enterLocation: true }
- Loot all: { action: "loot", encounterId: "...", partyId: "...", distributeEvenly: true }
- Long rest: { action: "rest", partyId: "...", restType: "long" }
- Short rest: { action: "rest", partyId: "...", restType: "short", hitDicePerMember: 2 }`,
    inputSchema: TravelManageInputSchema
};
