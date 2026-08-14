/**
 * Consolidated Item Management Tool
 * Replaces 6 separate tools: create_item_template, get_item, list_items, search_items, update_item, delete_item
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { ItemRepository } from '../../storage/repos/item.repo.js';
import { getDb } from '../../storage/index.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { findOpen5eItem, searchOpen5eItems } from '../../content/open5e-catalog.js';
import { materializeOpen5eItem } from '../../services/open5e-item.service.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['create', 'get', 'list', 'search', 'update', 'delete', 'catalog_search', 'catalog_get', 'materialize'] as const;
type ItemAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const db = getDb();
    const itemRepo = new ItemRepository(db);
    return { itemRepo };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const CreateSchema = z.object({
    action: z.literal('create'),
    name: z.string().min(1).describe('Item name'),
    type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']).describe('Item type'),
    description: z.string().optional().describe('Item description'),
    weight: z.number().min(0).describe('Item weight in lbs'),
    value: z.number().min(0).describe('Item value in gold pieces'),
    properties: z.record(z.any()).optional().describe('Additional item properties')
});

const GetSchema = z.object({
    action: z.literal('get'),
    itemId: z.string().describe('The unique ID of the item to retrieve')
});

const ListSchema = z.object({
    action: z.literal('list'),
    type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']).optional().describe('Filter by item type')
});

const SearchSchema = z.object({
    action: z.literal('search'),
    name: z.string().optional().describe('Search by name (partial match)'),
    type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']).optional().describe('Filter by item type'),
    minValue: z.number().min(0).optional().describe('Minimum item value'),
    maxValue: z.number().min(0).optional().describe('Maximum item value')
});

const UpdateSchema = z.object({
    action: z.literal('update'),
    itemId: z.string().describe('The ID of the item to update'),
    name: z.string().optional(),
    description: z.string().optional(),
    type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']).optional(),
    weight: z.number().min(0).optional(),
    value: z.number().min(0).optional(),
    properties: z.record(z.any()).optional()
});

const DeleteSchema = z.object({
    action: z.literal('delete'),
    itemId: z.string().describe('The ID of the item to delete')
});

const CatalogSearchSchema = z.object({
    action: z.literal('catalog_search'),
    query: z.string().optional().describe('Name, source key, or category to search in the pinned Open5e SRD catalog'),
    type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']).optional(),
    limit: z.number().int().min(1).max(100).optional().default(20)
});

const CatalogGetSchema = z.object({
    action: z.literal('catalog_get'),
    sourceKey: z.string().describe('Open5e source key, content key, or exact item name')
});

const MaterializeSchema = z.object({
    action: z.literal('materialize'),
    sourceKey: z.string().describe('Open5e source key, content key, or exact item name to create as an engine item template')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<ItemAction, ActionDefinition> = {
    create: {
        schema: CreateSchema,
        handler: async (params: z.infer<typeof CreateSchema>) => {
            const { itemRepo } = ensureDb();

            const now = new Date().toISOString();
            const item = {
                name: params.name,
                type: params.type,
                description: params.description,
                weight: params.weight,
                value: params.value,
                properties: params.properties,
                id: randomUUID(),
                createdAt: now,
                updatedAt: now
            };

            itemRepo.create(item);

            return {
                success: true,
                item,
                message: `Item template "${item.name}" created`
            };
        },
        aliases: ['new', 'add', 'template']
    },

    get: {
        schema: GetSchema,
        handler: async (params: z.infer<typeof GetSchema>) => {
            const { itemRepo } = ensureDb();

            const item = itemRepo.findById(params.itemId);
            if (!item) {
                throw new Error(`Item not found: ${params.itemId}`);
            }

            return {
                success: true,
                item
            };
        },
        aliases: ['fetch', 'find', 'read']
    },

    list: {
        schema: ListSchema,
        handler: async (params: z.infer<typeof ListSchema>) => {
            const { itemRepo } = ensureDb();

            let items;
            if (params.type) {
                items = itemRepo.findByType(params.type);
            } else {
                items = itemRepo.findAll();
            }

            return {
                success: true,
                items,
                count: items.length,
                filter: params.type || null
            };
        },
        aliases: ['all', 'show']
    },

    search: {
        schema: SearchSchema,
        handler: async (params: z.infer<typeof SearchSchema>) => {
            const { itemRepo } = ensureDb();

            const items = itemRepo.search({
                name: params.name,
                type: params.type,
                minValue: params.minValue,
                maxValue: params.maxValue
            });

            return {
                success: true,
                items,
                count: items.length,
                query: params
            };
        },
        aliases: ['query', 'filter', 'find_by']
    },

    update: {
        schema: UpdateSchema,
        handler: async (params: z.infer<typeof UpdateSchema>) => {
            const { itemRepo } = ensureDb();

            const { itemId, action, ...updates } = params;
            const item = itemRepo.update(itemId, updates);

            if (!item) {
                throw new Error(`Item not found: ${itemId}`);
            }

            return {
                success: true,
                item,
                message: `Item "${item.name}" updated`
            };
        },
        aliases: ['modify', 'edit', 'patch']
    },

    delete: {
        schema: DeleteSchema,
        handler: async (params: z.infer<typeof DeleteSchema>) => {
            const { itemRepo } = ensureDb();

            const existing = itemRepo.findById(params.itemId);
            if (!existing) {
                throw new Error(`Item not found: ${params.itemId}`);
            }

            itemRepo.delete(params.itemId);

            return {
                success: true,
                deletedItem: existing,
                message: `Item "${existing.name}" deleted`
            };
        },
        aliases: ['remove', 'destroy']
    },

    catalog_search: {
        schema: CatalogSearchSchema,
        handler: async (params: z.infer<typeof CatalogSearchSchema>) => {
            const items = searchOpen5eItems({
                query: params.query,
                type: params.type,
                limit: params.limit
            }).map((item) => ({
                ...item,
                value: item.valueCopper / 100
            }));

            return {
                success: true,
                actionType: 'catalog_search',
                items,
                count: items.length,
                query: params.query ?? null,
                filter: params.type ?? null,
                catalogOnly: true,
                message: 'Pinned Open5e SRD results; call materialize before giving an item to a character.'
            };
        },
        aliases: ['source_search', 'srd_search']
    },

    catalog_get: {
        schema: CatalogGetSchema,
        handler: async (params: z.infer<typeof CatalogGetSchema>) => {
            const catalogItem = findOpen5eItem(params.sourceKey);
            if (!catalogItem) throw new Error(`Open5e SRD item not found: ${params.sourceKey}`);

            return {
                success: true,
                actionType: 'catalog_get',
                catalogItem: {
                    ...catalogItem,
                    value: catalogItem.valueCopper / 100
                },
                catalogOnly: true,
                message: 'Call materialize to create the authoritative engine item template.'
            };
        },
        aliases: ['source_get', 'srd_get']
    },

    materialize: {
        schema: MaterializeSchema,
        handler: async (params: z.infer<typeof MaterializeSchema>) => {
            const { itemRepo } = ensureDb();
            const materialized = materializeOpen5eItem(itemRepo, params.sourceKey);

            return {
                success: true,
                actionType: 'materialize',
                item: materialized.item,
                created: materialized.created,
                sourceKey: materialized.sourceItem.sourceKey,
                message: materialized.created
                    ? `Materialized source-backed item "${materialized.item.name}"`
                    : `Refreshed source-backed item "${materialized.item.name}"`
            };
        },
        aliases: ['source_create', 'srd_create']
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

export const ItemManageTool = {
    name: 'item_manage',
    description: `Manage item templates (definitions, not instances).

📦 ITEM WORKFLOW:
1. create - Define a custom item template
2. catalog_search/catalog_get - Read exact pinned SRD definitions without mutating state
3. materialize - Create or refresh a deterministic source-backed template
4. Then use inventory_manage to give items to characters

🗡️ ITEM TYPES:
- weapon: Attack bonuses, damage dice in properties
- armor: AC bonuses, baseAC for armor class calculation
- consumable: One-use items (potions, scrolls)
- quest/misc: Story items and general goods

⚔️ WEAPON PROPERTIES EXAMPLE:
{ attackBonus: 1, damageDice: "1d8", damageType: "slashing" }

🛡️ ARMOR PROPERTIES EXAMPLE:
{ baseAC: 14, maxDexBonus: 2 }

Actions: ${ACTIONS.join(', ')}
Aliases: new→create, fetch→get, query→search`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe(`Action to perform: ${ACTIONS.join(', ')}`),
        itemId: z.string().optional().describe('Item ID (for get, update, delete)'),
        name: z.string().optional().describe('Item name'),
        type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']).optional().describe('Item type'),
        description: z.string().optional().describe('Item description'),
        weight: z.number().optional().describe('Item weight in lbs'),
        value: z.number().optional().describe('Item value in gp'),
        properties: z.record(z.any()).optional().describe('Additional properties'),
        minValue: z.number().optional().describe('Minimum value for search'),
        maxValue: z.number().optional().describe('Maximum value for search'),
        sourceKey: z.string().optional().describe('Pinned Open5e source key/name (for catalog_get or materialize)'),
        query: z.string().optional().describe('Pinned Open5e catalog search text'),
        limit: z.number().int().optional().describe('Maximum catalog results (1-100)')
    })
};

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function handleItemManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args as Record<string, unknown>);

    // The router already returns McpResponse format
    // But we want to add rich formatting
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
    } else if (parsed.catalogItem) {
        const item = parsed.catalogItem;
        output = RichFormatter.header(`${item.name} (SRD Catalog)`, 'ðŸ“š');
        output += RichFormatter.keyValue({
            'Source Key': item.sourceKey,
            'Type': item.type,
            'Weight': `${item.weight} lbs`,
            'Value': `${item.value} gp`
        });
        if (item.description) output += `\n${item.description}\n`;
        output += RichFormatter.alert(parsed.message, 'info');
    } else if (parsed.item) {
        const item = parsed.item;
        output = RichFormatter.header(item.name || 'Item', '📦');
        output += RichFormatter.keyValue({
            'ID': `\`${item.id}\``,
            'Type': item.type,
            'Weight': `${item.weight} lbs`,
            'Value': `${item.value} gp`,
        });
        if (item.description) {
            output += `\n${item.description}\n`;
        }
        if (parsed.message) {
            output += RichFormatter.success(parsed.message);
        }
    } else if (parsed.items) {
        output = RichFormatter.header('Items', '📦');
        if (parsed.filter) {
            output += RichFormatter.keyValue({ 'Filter': parsed.filter });
        }
        if (parsed.query) {
            const queryInfo: Record<string, unknown> = {};
            if (typeof parsed.query === 'string') {
                queryInfo['Query'] = parsed.query;
            } else {
                if (parsed.query.name) queryInfo['Name'] = parsed.query.name;
                if (parsed.query.type) queryInfo['Type'] = parsed.query.type;
                if (parsed.query.minValue !== undefined) queryInfo['Min Value'] = parsed.query.minValue;
                if (parsed.query.maxValue !== undefined) queryInfo['Max Value'] = parsed.query.maxValue;
            }
            output += RichFormatter.keyValue(queryInfo);
        }
        if (parsed.items.length === 0) {
            output += RichFormatter.alert('No items found.', 'info');
        } else {
            const rows = parsed.items.map((i: { name: string; type: string; weight: number; value: number }) =>
                [i.name, i.type, `${i.weight}`, `${i.value} gp`]
            );
            output += RichFormatter.table(['Name', 'Type', 'Weight', 'Value'], rows);
            output += `\n*${parsed.count} item(s) total*\n`;
        }
    } else if (parsed.deletedItem) {
        output = RichFormatter.header('Item Deleted', '🗑️');
        output += RichFormatter.keyValue({
            'Name': parsed.deletedItem.name,
            'ID': `\`${parsed.deletedItem.id}\``,
        });
        output += RichFormatter.success(parsed.message);
    }

    output += RichFormatter.embedJson(parsed, 'ITEM_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
