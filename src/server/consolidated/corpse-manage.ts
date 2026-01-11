/**
 * Consolidated Corpse Management Tool
 * Replaces 14 separate tools for corpse and loot table operations
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { CorpseRepository } from '../../storage/repos/corpse.repo.js';
import { LootTableSchema } from '../../schema/corpse.js';
import { getDb } from '../../storage/index.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = [
    'create', 'get', 'get_by_character',
    'list_in_encounter', 'list_nearby', 'get_inventory',
    'loot', 'harvest', 'generate_loot',
    'advance_decay', 'cleanup',
    'loot_table_create', 'loot_table_get', 'loot_table_list'
] as const;
type CorpseAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function getRepo(): CorpseRepository {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    return new CorpseRepository(db);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const CreateSchema = z.object({
    action: z.literal('create'),
    characterId: z.string().describe('ID of the dead character'),
    characterName: z.string().describe('Name of the dead character'),
    characterType: z.enum(['pc', 'npc', 'enemy', 'neutral']).describe('Type of character'),
    creatureType: z.string().optional().describe('Creature type for loot table lookup'),
    cr: z.number().optional().describe('Challenge rating for loot scaling'),
    worldId: z.string().optional(),
    regionId: z.string().optional(),
    encounterId: z.string().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional()
});

const GetSchema = z.object({
    action: z.literal('get'),
    corpseId: z.string().describe('The unique ID of the corpse')
});

const GetByCharacterSchema = z.object({
    action: z.literal('get_by_character'),
    characterId: z.string().describe('The character ID to find corpse for')
});

const ListInEncounterSchema = z.object({
    action: z.literal('list_in_encounter'),
    encounterId: z.string().describe('The encounter ID to list corpses from')
});

const ListNearbySchema = z.object({
    action: z.literal('list_nearby'),
    worldId: z.string().describe('World ID to search in'),
    x: z.number().int().describe('X coordinate'),
    y: z.number().int().describe('Y coordinate'),
    radius: z.number().int().min(1).max(20).default(3).describe('Search radius')
});

const GetInventorySchema = z.object({
    action: z.literal('get_inventory'),
    corpseId: z.string().describe('The corpse ID to get inventory for')
});

const LootSchema = z.object({
    action: z.literal('loot'),
    characterId: z.string().describe('Character doing the looting'),
    corpseId: z.string().describe('Corpse to loot from'),
    itemId: z.string().optional().describe('Specific item to loot (omit for loot all)'),
    quantity: z.number().int().min(1).optional().describe('Quantity to loot'),
    lootAll: z.boolean().optional().describe('Loot everything from the corpse')
});

const HarvestSchema = z.object({
    action: z.literal('harvest'),
    characterId: z.string().describe('Character doing the harvesting'),
    corpseId: z.string().describe('Corpse to harvest from'),
    resourceType: z.string().describe('Type of resource to harvest'),
    skillRoll: z.number().int().optional().describe('Result of skill check if required'),
    skillDC: z.number().int().optional().describe('DC of the skill check')
});

const GenerateLootSchema = z.object({
    action: z.literal('generate_loot'),
    corpseId: z.string().describe('Corpse to generate loot for'),
    creatureType: z.string().describe('Creature type for loot table'),
    cr: z.number().optional().describe('Challenge rating for loot scaling')
});

const AdvanceDecaySchema = z.object({
    action: z.literal('advance_decay'),
    hoursAdvanced: z.number().int().min(1).describe('Hours of game time to advance')
});

const CleanupSchema = z.object({
    action: z.literal('cleanup')
});

const LootTableEntrySchema = z.object({
    itemId: z.string().nullable().optional(),
    itemTemplateId: z.string().nullable().optional(),
    itemName: z.string().optional(),
    quantity: z.object({
        min: z.number().int().min(0).default(1),
        max: z.number().int().min(0).default(1)
    }).default({ min: 1, max: 1 }),
    weight: z.number().min(0).max(1).default(1),
    conditions: z.array(z.string()).optional()
});

const LootTableCreateSchema = z.object({
    action: z.literal('loot_table_create'),
    name: z.string().describe('Name of the loot table'),
    creatureTypes: z.array(z.string()).describe('Creature types this table applies to'),
    crRange: z.object({
        min: z.number().min(0).default(0),
        max: z.number().min(0).default(30)
    }).optional().describe('CR range for this table'),
    guaranteedDrops: z.array(LootTableEntrySchema).default([]).describe('Items that always drop'),
    randomDrops: z.array(LootTableEntrySchema).default([]).describe('Items with chance to drop'),
    currencyRange: z.object({
        gold: z.object({ min: z.number(), max: z.number() }),
        silver: z.object({ min: z.number(), max: z.number() }).optional(),
        copper: z.object({ min: z.number(), max: z.number() }).optional()
    }).optional().describe('Currency drop ranges'),
    harvestableResources: z.array(z.object({
        resourceType: z.string(),
        quantity: z.object({ min: z.number(), max: z.number() }),
        dcRequired: z.number().int().optional()
    })).optional().describe('Harvestable resources')
});

const LootTableGetSchema = z.object({
    action: z.literal('loot_table_get'),
    id: z.string().optional().describe('Loot table ID'),
    creatureType: z.string().optional().describe('Creature type to search for'),
    cr: z.number().optional().describe('CR for matching')
});

const LootTableListSchema = z.object({
    action: z.literal('loot_table_list')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<CorpseAction, ActionDefinition> = {
    create: {
        schema: CreateSchema,
        handler: async (params: z.infer<typeof CreateSchema>) => {
            const repo = getRepo();
            const corpse = repo.createFromDeath(
                params.characterId,
                params.characterName,
                params.characterType,
                {
                    creatureType: params.creatureType,
                    cr: params.cr,
                    worldId: params.worldId,
                    regionId: params.regionId,
                    encounterId: params.encounterId,
                    position: params.position
                }
            );
            return {
                success: true,
                corpse,
                message: `Corpse created for ${params.characterName}`
            };
        },
        aliases: ['new', 'add', 'spawn']
    },

    get: {
        schema: GetSchema,
        handler: async (params: z.infer<typeof GetSchema>) => {
            const repo = getRepo();
            const corpse = repo.findById(params.corpseId);
            if (!corpse) {
                throw new Error(`Corpse not found: ${params.corpseId}`);
            }
            const inventory = repo.getAvailableLoot(params.corpseId);
            return {
                success: true,
                corpse,
                availableLoot: inventory,
                canLoot: corpse.state !== 'gone' && inventory.length > 0,
                canHarvest: corpse.harvestable && corpse.state !== 'skeletal' && corpse.state !== 'gone'
            };
        },
        aliases: ['fetch', 'find', 'read']
    },

    get_by_character: {
        schema: GetByCharacterSchema,
        handler: async (params: z.infer<typeof GetByCharacterSchema>) => {
            const repo = getRepo();
            const corpse = repo.findByCharacterId(params.characterId);
            if (!corpse) {
                throw new Error(`No corpse found for character: ${params.characterId}`);
            }
            const inventory = repo.getAvailableLoot(corpse.id);
            return {
                success: true,
                corpse,
                availableLoot: inventory
            };
        },
        aliases: ['find_by_character', 'by_character']
    },

    list_in_encounter: {
        schema: ListInEncounterSchema,
        handler: async (params: z.infer<typeof ListInEncounterSchema>) => {
            const repo = getRepo();
            const corpses = repo.findByEncounterId(params.encounterId);
            return {
                success: true,
                encounterId: params.encounterId,
                count: corpses.length,
                corpses: corpses.map(c => ({
                    id: c.id,
                    characterName: c.characterName,
                    characterType: c.characterType,
                    state: c.state,
                    looted: c.looted,
                    position: c.position
                }))
            };
        },
        aliases: ['in_encounter', 'encounter_corpses']
    },

    list_nearby: {
        schema: ListNearbySchema,
        handler: async (params: z.infer<typeof ListNearbySchema>) => {
            const repo = getRepo();
            const corpses = repo.findNearPosition(params.worldId, params.x, params.y, params.radius);
            return {
                success: true,
                worldId: params.worldId,
                center: { x: params.x, y: params.y },
                radius: params.radius,
                count: corpses.length,
                corpses: corpses.map(c => ({
                    id: c.id,
                    characterName: c.characterName,
                    state: c.state,
                    looted: c.looted,
                    position: c.position,
                    distance: c.position
                        ? Math.sqrt(Math.pow(c.position.x - params.x, 2) + Math.pow(c.position.y - params.y, 2))
                        : null
                }))
            };
        },
        aliases: ['nearby', 'near']
    },

    get_inventory: {
        schema: GetInventorySchema,
        handler: async (params: z.infer<typeof GetInventorySchema>) => {
            const repo = getRepo();
            const inventory = repo.getCorpseInventory(params.corpseId);
            const available = repo.getAvailableLoot(params.corpseId);
            return {
                success: true,
                corpseId: params.corpseId,
                totalItems: inventory.length,
                availableToLoot: available.length,
                inventory,
                available
            };
        },
        aliases: ['inventory', 'items']
    },

    loot: {
        schema: LootSchema,
        handler: async (params: z.infer<typeof LootSchema>) => {
            const repo = getRepo();

            if (params.lootAll) {
                const looted = repo.lootAll(params.corpseId, params.characterId);
                return {
                    success: true,
                    lootedBy: params.characterId,
                    corpseId: params.corpseId,
                    itemsLooted: looted,
                    totalItems: looted.length,
                    lootAll: true
                };
            }

            if (!params.itemId) {
                throw new Error('Must specify itemId or set lootAll: true');
            }

            const result = repo.lootItem(params.corpseId, params.itemId, params.characterId, params.quantity);
            return {
                success: result.success,
                lootedBy: params.characterId,
                corpseId: params.corpseId,
                itemId: result.itemId,
                quantity: result.quantity,
                reason: result.reason
            };
        },
        aliases: ['take', 'grab', 'loot_item']
    },

    harvest: {
        schema: HarvestSchema,
        handler: async (params: z.infer<typeof HarvestSchema>) => {
            const repo = getRepo();
            const skillCheck = params.skillRoll !== undefined && params.skillDC !== undefined
                ? { roll: params.skillRoll, dc: params.skillDC }
                : undefined;

            const result = repo.harvestResource(
                params.corpseId,
                params.resourceType,
                params.characterId,
                { skillCheck }
            );

            return {
                success: result.success,
                harvestedBy: params.characterId,
                corpseId: params.corpseId,
                resourceType: result.resourceType,
                quantity: result.quantity,
                skillCheck: skillCheck ? {
                    roll: skillCheck.roll,
                    dc: skillCheck.dc,
                    passed: skillCheck.roll >= skillCheck.dc
                } : 'not required',
                reason: result.reason
            };
        },
        aliases: ['skin', 'gather', 'extract']
    },

    generate_loot: {
        schema: GenerateLootSchema,
        handler: async (params: z.infer<typeof GenerateLootSchema>) => {
            const repo = getRepo();
            const result = repo.generateLoot(params.corpseId, params.creatureType, params.cr);
            return {
                success: true,
                corpseId: params.corpseId,
                creatureType: params.creatureType,
                cr: params.cr,
                loot: {
                    items: result.itemsAdded,
                    currency: result.currency,
                    harvestable: result.harvestable
                }
            };
        },
        aliases: ['gen_loot', 'roll_loot']
    },

    advance_decay: {
        schema: AdvanceDecaySchema,
        handler: async (params: z.infer<typeof AdvanceDecaySchema>) => {
            const repo = getRepo();
            const changes = repo.processDecay(params.hoursAdvanced);
            return {
                success: true,
                hoursAdvanced: params.hoursAdvanced,
                corpsesDecayed: changes.length,
                changes: changes.map(c => ({
                    corpseId: c.corpseId,
                    from: c.oldState,
                    to: c.newState
                }))
            };
        },
        aliases: ['decay', 'process_decay', 'time_pass']
    },

    cleanup: {
        schema: CleanupSchema,
        handler: async () => {
            const repo = getRepo();
            const count = repo.cleanupGoneCorpses();
            return {
                success: true,
                corpsesRemoved: count
            };
        },
        aliases: ['clean', 'remove_gone', 'purge']
    },

    loot_table_create: {
        schema: LootTableCreateSchema,
        handler: async (params: z.infer<typeof LootTableCreateSchema>) => {
            const repo = getRepo();
            const { action, ...tableData } = params;
            const table = repo.createLootTable(tableData);
            return {
                success: true,
                lootTable: table,
                message: `Loot table "${table.name}" created for creature types: ${table.creatureTypes.join(', ')}`
            };
        },
        aliases: ['table_create', 'create_table', 'new_table']
    },

    loot_table_get: {
        schema: LootTableGetSchema,
        handler: async (params: z.infer<typeof LootTableGetSchema>) => {
            const repo = getRepo();
            let table = null;
            if (params.id) {
                table = repo.findLootTableById(params.id);
            } else if (params.creatureType) {
                table = repo.findLootTableByCreatureType(params.creatureType, params.cr);
            }
            if (!table) {
                throw new Error('No matching loot table found');
            }
            return {
                success: true,
                lootTable: table
            };
        },
        aliases: ['table_get', 'get_table', 'find_table']
    },

    loot_table_list: {
        schema: LootTableListSchema,
        handler: async () => {
            const repo = getRepo();
            const tables = repo.listLootTables();
            return {
                success: true,
                count: tables.length,
                tables: tables.map(t => ({
                    id: t.id,
                    name: t.name,
                    creatureTypes: t.creatureTypes,
                    crRange: t.crRange
                }))
            };
        },
        aliases: ['table_list', 'list_tables', 'all_tables']
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER & TOOL DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

export const CorpseManageTool = {
    name: 'corpse_manage',
    description: `Unified corpse and loot management. Actions: ${ACTIONS.join(', ')}. Aliases include: spawn→create, take→loot, skin→harvest, decay→advance_decay, table_create→loot_table_create.`,
    inputSchema: z.object({
        action: z.string().describe(`Action to perform: ${ACTIONS.join(', ')}`),
        corpseId: z.string().optional().describe('Corpse ID'),
        characterId: z.string().optional().describe('Character ID'),
        characterName: z.string().optional().describe('Character name (for create)'),
        characterType: z.enum(['pc', 'npc', 'enemy', 'neutral']).optional(),
        creatureType: z.string().optional().describe('Creature type'),
        cr: z.number().optional().describe('Challenge rating'),
        worldId: z.string().optional(),
        regionId: z.string().optional(),
        encounterId: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        x: z.number().optional().describe('X coordinate (for list_nearby)'),
        y: z.number().optional().describe('Y coordinate (for list_nearby)'),
        radius: z.number().optional().describe('Search radius'),
        itemId: z.string().optional().describe('Item ID (for loot)'),
        quantity: z.number().optional().describe('Quantity'),
        lootAll: z.boolean().optional().describe('Loot all items'),
        resourceType: z.string().optional().describe('Resource type (for harvest)'),
        skillRoll: z.number().optional().describe('Skill roll result'),
        skillDC: z.number().optional().describe('Skill DC'),
        hoursAdvanced: z.number().optional().describe('Hours for decay'),
        // Loot table fields
        id: z.string().optional().describe('Loot table ID'),
        name: z.string().optional().describe('Loot table name'),
        creatureTypes: z.array(z.string()).optional().describe('Creature types for table'),
        crRange: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
        guaranteedDrops: z.array(z.any()).optional().describe('Items that always drop'),
        randomDrops: z.array(z.any()).optional().describe('Items with chance to drop'),
        currencyRange: z.record(z.any()).optional().describe('Currency ranges'),
        harvestableResources: z.array(z.any()).optional().describe('Harvestable resources')
    })
};

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function handleCorpseManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args as Record<string, unknown>);
    const parsed = JSON.parse(result.content[0].text);

    let output = '';

    if (parsed.error) {
        output = RichFormatter.header('Error', '❌');
        output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        if (parsed.suggestions) {
            output += '\n**Did you mean:**\n';
            parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                output += `  • ${s.action} (${s.similarity}% match)\n`;
            });
        }
    } else if (parsed.corpse) {
        const c = parsed.corpse;
        output = RichFormatter.header(c.characterName || 'Corpse', '💀');
        output += RichFormatter.keyValue({
            'ID': `\`${c.id}\``,
            'Character': c.characterName,
            'Type': c.characterType,
            'State': c.state,
            'Looted': c.looted ? 'Yes' : 'No'
        });
        if (parsed.availableLoot?.length > 0) {
            output += '\n**Available Loot:**\n';
            parsed.availableLoot.forEach((item: { itemId: string; quantity: number }) => {
                output += `  • ${item.itemId} (x${item.quantity})\n`;
            });
        }
        if (parsed.canLoot !== undefined) {
            output += RichFormatter.keyValue({
                'Can Loot': parsed.canLoot ? '✓' : '✗',
                'Can Harvest': parsed.canHarvest ? '✓' : '✗'
            });
        }
        if (parsed.message) {
            output += RichFormatter.success(parsed.message);
        }
    } else if (parsed.corpses) {
        output = RichFormatter.header('Corpses', '💀');
        output += RichFormatter.keyValue({ 'Count': parsed.count });
        if (parsed.corpses.length === 0) {
            output += RichFormatter.alert('No corpses found.', 'info');
        } else {
            const rows = parsed.corpses.map((c: { characterName: string; state: string; looted: boolean; distance?: number }) =>
                [c.characterName, c.state, c.looted ? 'Yes' : 'No', c.distance !== undefined ? c.distance.toFixed(1) : '-']
            );
            output += RichFormatter.table(['Name', 'State', 'Looted', 'Distance'], rows);
        }
    } else if (parsed.lootTable) {
        const t = parsed.lootTable;
        output = RichFormatter.header(t.name || 'Loot Table', '🎲');
        output += RichFormatter.keyValue({
            'ID': `\`${t.id}\``,
            'Creature Types': t.creatureTypes?.join(', ') || 'Any',
            'CR Range': t.crRange ? `${t.crRange.min || '?'} - ${t.crRange.max || '?'}` : 'Any'
        });
        if (parsed.message) {
            output += RichFormatter.success(parsed.message);
        }
    } else if (parsed.tables) {
        output = RichFormatter.header('Loot Tables', '🎲');
        output += RichFormatter.keyValue({ 'Count': parsed.count });
        if (parsed.tables.length === 0) {
            output += RichFormatter.alert('No loot tables found.', 'info');
        } else {
            const rows = parsed.tables.map((t: { name: string; creatureTypes: string[] }) =>
                [t.name, t.creatureTypes.join(', ')]
            );
            output += RichFormatter.table(['Name', 'Creature Types'], rows);
        }
    } else if (parsed.itemsLooted) {
        output = RichFormatter.header('Loot Result', '💰');
        output += RichFormatter.keyValue({
            'Looted By': parsed.lootedBy,
            'Items': parsed.totalItems || parsed.itemsLooted.length
        });
        if (parsed.lootAll) {
            output += '\n**Items Looted:**\n';
            parsed.itemsLooted.forEach((item: { itemId: string; quantity: number }) => {
                output += `  • ${item.itemId} (x${item.quantity})\n`;
            });
        }
        output += RichFormatter.success('Items looted successfully');
    } else if (parsed.harvestedBy) {
        output = RichFormatter.header('Harvest Result', '🌿');
        output += RichFormatter.keyValue({
            'Harvested By': parsed.harvestedBy,
            'Resource': parsed.resourceType,
            'Quantity': parsed.quantity
        });
        if (parsed.skillCheck && typeof parsed.skillCheck === 'object') {
            output += RichFormatter.keyValue({
                'Skill Check': `${parsed.skillCheck.roll} vs DC ${parsed.skillCheck.dc} (${parsed.skillCheck.passed ? 'Passed' : 'Failed'})`
            });
        }
        output += parsed.success ? RichFormatter.success('Harvest successful') : RichFormatter.alert(parsed.reason || 'Harvest failed', 'error');
    } else if (parsed.hoursAdvanced !== undefined) {
        output = RichFormatter.header('Decay Processed', '⏳');
        output += RichFormatter.keyValue({
            'Hours Advanced': parsed.hoursAdvanced,
            'Corpses Decayed': parsed.corpsesDecayed
        });
        if (parsed.changes?.length > 0) {
            output += '\n**State Changes:**\n';
            parsed.changes.forEach((c: { corpseId: string; from: string; to: string }) => {
                output += `  • ${c.corpseId}: ${c.from} → ${c.to}\n`;
            });
        }
    } else if (parsed.corpsesRemoved !== undefined) {
        output = RichFormatter.header('Cleanup Complete', '🧹');
        output += RichFormatter.keyValue({ 'Corpses Removed': parsed.corpsesRemoved });
    } else if (parsed.loot) {
        output = RichFormatter.header('Loot Generated', '🎲');
        output += RichFormatter.keyValue({
            'Corpse': parsed.corpseId,
            'Creature Type': parsed.creatureType,
            'CR': parsed.cr || 'N/A'
        });
        if (parsed.loot.items?.length > 0) {
            output += '\n**Items:**\n';
            parsed.loot.items.forEach((item: { itemId: string; quantity: number }) => {
                output += `  • ${item.itemId} (x${item.quantity})\n`;
            });
        }
        if (parsed.loot.currency) {
            output += '\n**Currency:** ' + JSON.stringify(parsed.loot.currency) + '\n';
        }
    } else if (parsed.inventory) {
        output = RichFormatter.header('Corpse Inventory', '📦');
        output += RichFormatter.keyValue({
            'Total Items': parsed.totalItems,
            'Available to Loot': parsed.availableToLoot
        });
    } else {
        output = RichFormatter.header('Result', '✓');
        output += RichFormatter.keyValue({ 'Success': parsed.success ? 'Yes' : 'No' });
        if (parsed.message) {
            output += RichFormatter.success(parsed.message);
        }
    }

    output += RichFormatter.embedJson(parsed, 'CORPSE_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
