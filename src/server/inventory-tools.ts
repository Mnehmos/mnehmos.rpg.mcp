import { z } from 'zod';
import { randomUUID } from 'crypto';
import { ItemRepository } from '../storage/repos/item.repo.js';
import { InventoryRepository } from '../storage/repos/inventory.repo.js';
import { ItemSchema, INVENTORY_LIMITS } from '../schema/inventory.js';
import { getDb } from '../storage/index.js';
import { SessionContext } from './types.js';

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test' 
        ? ':memory:' 
        : process.env.RPG_DATA_DIR 
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    const itemRepo = new ItemRepository(db);
    const inventoryRepo = new InventoryRepository(db);
    return { itemRepo, inventoryRepo };
}

export const InventoryTools = {
    CREATE_ITEM_TEMPLATE: {
        name: 'create_item_template',
        description: 'Define a new type of item (e.g., "Iron Sword").',
        inputSchema: ItemSchema.omit({ id: true, createdAt: true, updatedAt: true })
    },
    GET_ITEM: {
        name: 'get_item',
        description: 'Get details of a specific item by ID.',
        inputSchema: z.object({
            itemId: z.string().describe('The unique ID of the item to retrieve')
        })
    },
    LIST_ITEMS: {
        name: 'list_items',
        description: 'List all item templates in the database.',
        inputSchema: z.object({
            type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']).optional().describe('Filter by item type')
        })
    },
    SEARCH_ITEMS: {
        name: 'search_items',
        description: 'Search for items by name, type, or value range.',
        inputSchema: z.object({
            name: z.string().optional().describe('Search by name (partial match)'),
            type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']).optional().describe('Filter by item type'),
            minValue: z.number().min(0).optional().describe('Minimum item value'),
            maxValue: z.number().min(0).optional().describe('Maximum item value')
        })
    },
    UPDATE_ITEM: {
        name: 'update_item',
        description: 'Update an existing item template.',
        inputSchema: z.object({
            itemId: z.string().describe('The ID of the item to update'),
            name: z.string().optional(),
            description: z.string().optional(),
            type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']).optional(),
            weight: z.number().min(0).optional(),
            value: z.number().min(0).optional(),
            properties: z.record(z.any()).optional()
        })
    },
    DELETE_ITEM: {
        name: 'delete_item',
        description: 'Delete an item template from the database.',
        inputSchema: z.object({
            itemId: z.string().describe('The ID of the item to delete')
        })
    },
    GIVE_ITEM: {
        name: 'give_item',
        description: 'Add an item to a character\'s inventory.',
        inputSchema: z.object({
            characterId: z.string(),
            itemId: z.string(),
            quantity: z.number().int().min(1).default(1)
        })
    },
    REMOVE_ITEM: {
        name: 'remove_item',
        description: 'Remove an item from a character\'s inventory.',
        inputSchema: z.object({
            characterId: z.string(),
            itemId: z.string(),
            quantity: z.number().int().min(1).default(1)
        })
    },
    TRANSFER_ITEM: {
        name: 'transfer_item',
        description: 'Transfer an item from one character to another.',
        inputSchema: z.object({
            fromCharacterId: z.string().describe('Character giving the item'),
            toCharacterId: z.string().describe('Character receiving the item'),
            itemId: z.string().describe('The item to transfer'),
            quantity: z.number().int().min(1).default(1).describe('How many to transfer')
        })
    },
    USE_ITEM: {
        name: 'use_item',
        description: 'Use a consumable item (removes it from inventory and applies effects).',
        inputSchema: z.object({
            characterId: z.string().describe('Character using the item'),
            itemId: z.string().describe('The consumable item to use'),
            targetId: z.string().optional().describe('Optional target character for the effect')
        })
    },
    EQUIP_ITEM: {
        name: 'equip_item',
        description: 'Equip an item in a specific slot.',
        inputSchema: z.object({
            characterId: z.string(),
            itemId: z.string(),
            slot: z.enum(['mainhand', 'offhand', 'armor', 'head', 'feet', 'accessory'])
        })
    },
    UNEQUIP_ITEM: {
        name: 'unequip_item',
        description: 'Unequip an item.',
        inputSchema: z.object({
            characterId: z.string(),
            itemId: z.string()
        })
    },
    GET_INVENTORY: {
        name: 'get_inventory',
        description: 'List all items in a character\'s inventory.',
        inputSchema: z.object({
            characterId: z.string()
        })
    },
    GET_INVENTORY_DETAILED: {
        name: 'get_inventory_detailed',
        description: 'Get detailed inventory with full item info, sorted by equipped/type/name.',
        inputSchema: z.object({
            characterId: z.string()
        })
    }
} as const;

export async function handleCreateItemTemplate(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = InventoryTools.CREATE_ITEM_TEMPLATE.inputSchema.parse(args);

    const now = new Date().toISOString();
    const item = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
    };

    itemRepo.create(item);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(item, null, 2)
        }]
    };
}

export async function handleGiveItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo, itemRepo } = ensureDb();
    const parsed = InventoryTools.GIVE_ITEM.inputSchema.parse(args);

    // Validate quantity limits
    if (parsed.quantity > INVENTORY_LIMITS.MAX_GIVE_QUANTITY) {
        throw new Error(`Cannot give more than ${INVENTORY_LIMITS.MAX_GIVE_QUANTITY} items at once. Requested quantity: ${parsed.quantity}`);
    }

    // Get item details for validation
    const item = itemRepo.findById(parsed.itemId);
    if (!item) {
        throw new Error(`Item not found: ${parsed.itemId}`);
    }

    // Check unique item constraints
    const properties = item.properties || {};
    const isUnique = properties.unique === true;
    const isWorldUnique = properties.worldUnique === true;

    if (isUnique || isWorldUnique) {
        // Unique items can only have quantity of 1
        if (parsed.quantity > 1) {
            throw new Error(`Cannot give more than 1 of unique item "${item.name}"`);
        }

        // Check if character already has this unique item
        const inventory = inventoryRepo.getInventory(parsed.characterId);
        const existingItem = inventory.items.find(i => i.itemId === parsed.itemId);
        if (existingItem) {
            throw new Error(`Character already owns unique item "${item.name}". Unique items cannot stack.`);
        }

        // For world-unique items, check if ANY character has it
        if (isWorldUnique) {
            const allOwners = inventoryRepo.findItemOwners(parsed.itemId);
            if (allOwners.length > 0) {
                throw new Error(`World-unique item "${item.name}" is already owned by another character. Only one can exist in the world.`);
            }
        }
    }

    // Check weight capacity
    const currentInventory = inventoryRepo.getInventoryWithDetails(parsed.characterId);
    const addedWeight = item.weight * parsed.quantity;
    const newTotalWeight = currentInventory.totalWeight + addedWeight;

    if (newTotalWeight > currentInventory.capacity) {
        throw new Error(
            `Cannot add items: would exceed weight capacity. ` +
            `Current: ${currentInventory.totalWeight.toFixed(1)}/${currentInventory.capacity}, ` +
            `Adding: ${addedWeight.toFixed(1)}, ` +
            `Would be: ${newTotalWeight.toFixed(1)}`
        );
    }

    // Check stack size limits (existing + new shouldn't exceed max)
    const existingItem = currentInventory.items.find(i => i.item.id === parsed.itemId);
    const existingQuantity = existingItem?.quantity || 0;
    const newTotal = existingQuantity + parsed.quantity;

    if (newTotal > INVENTORY_LIMITS.MAX_STACK_SIZE) {
        throw new Error(
            `Cannot add items: would exceed max stack size of ${INVENTORY_LIMITS.MAX_STACK_SIZE}. ` +
            `Current: ${existingQuantity}, Adding: ${parsed.quantity}, Would be: ${newTotal}`
        );
    }

    inventoryRepo.addItem(parsed.characterId, parsed.itemId, parsed.quantity);

    return {
        content: [{
            type: 'text' as const,
            text: `Added ${parsed.quantity} of item ${parsed.itemId} to character ${parsed.characterId}`
        }]
    };
}

export async function handleRemoveItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.REMOVE_ITEM.inputSchema.parse(args);

    const success = inventoryRepo.removeItem(parsed.characterId, parsed.itemId, parsed.quantity);

    if (!success) {
        throw new Error(`Failed to remove item. Character may not have enough quantity.`);
    }

    return {
        content: [{
            type: 'text' as const,
            text: `Removed ${parsed.quantity} of item ${parsed.itemId} from character ${parsed.characterId}`
        }]
    };
}

export async function handleEquipItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.EQUIP_ITEM.inputSchema.parse(args);

    // Verify ownership first
    const inventory = inventoryRepo.getInventory(parsed.characterId);
    const hasItem = inventory.items.some(i => i.itemId === parsed.itemId && i.quantity > 0);

    if (!hasItem) {
        throw new Error(`Character does not own item ${parsed.itemId}`);
    }

    inventoryRepo.equipItem(parsed.characterId, parsed.itemId, parsed.slot);

    return {
        content: [{
            type: 'text' as const,
            text: `Equipped item ${parsed.itemId} in slot ${parsed.slot}`
        }]
    };
}

export async function handleUnequipItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.UNEQUIP_ITEM.inputSchema.parse(args);

    inventoryRepo.unequipItem(parsed.characterId, parsed.itemId);

    return {
        content: [{
            type: 'text' as const,
            text: `Unequipped item ${parsed.itemId}`
        }]
    };
}

export async function handleGetInventory(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.GET_INVENTORY.inputSchema.parse(args);

    const inventory = inventoryRepo.getInventory(parsed.characterId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(inventory, null, 2)
        }]
    };
}

export async function handleGetItem(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = InventoryTools.GET_ITEM.inputSchema.parse(args);

    const item = itemRepo.findById(parsed.itemId);

    if (!item) {
        throw new Error(`Item not found: ${parsed.itemId}`);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({ item }, null, 2)
        }]
    };
}

export async function handleListItems(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = InventoryTools.LIST_ITEMS.inputSchema.parse(args);

    let items;
    if (parsed.type) {
        items = itemRepo.findByType(parsed.type);
    } else {
        items = itemRepo.findAll();
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({ items, count: items.length }, null, 2)
        }]
    };
}

export async function handleSearchItems(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = InventoryTools.SEARCH_ITEMS.inputSchema.parse(args);

    const items = itemRepo.search(parsed);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({ items, count: items.length, query: parsed }, null, 2)
        }]
    };
}

export async function handleUpdateItem(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = InventoryTools.UPDATE_ITEM.inputSchema.parse(args);

    const { itemId, ...updates } = parsed;
    const item = itemRepo.update(itemId, updates);

    if (!item) {
        throw new Error(`Item not found: ${itemId}`);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({ item, message: 'Item updated successfully' }, null, 2)
        }]
    };
}

export async function handleDeleteItem(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = InventoryTools.DELETE_ITEM.inputSchema.parse(args);

    const existing = itemRepo.findById(parsed.itemId);
    if (!existing) {
        throw new Error(`Item not found: ${parsed.itemId}`);
    }

    itemRepo.delete(parsed.itemId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({ message: `Item "${existing.name}" deleted successfully`, itemId: parsed.itemId }, null, 2)
        }]
    };
}

export async function handleTransferItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo, itemRepo } = ensureDb();
    const parsed = InventoryTools.TRANSFER_ITEM.inputSchema.parse(args);

    // Get item details for the response
    const item = itemRepo.findById(parsed.itemId);
    if (!item) {
        throw new Error(`Item not found: ${parsed.itemId}`);
    }

    const success = inventoryRepo.transferItem(
        parsed.fromCharacterId,
        parsed.toCharacterId,
        parsed.itemId,
        parsed.quantity
    );

    if (!success) {
        throw new Error(`Transfer failed. Source may not have enough quantity or item is equipped.`);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `Transferred ${parsed.quantity}x ${item.name}`,
                from: parsed.fromCharacterId,
                to: parsed.toCharacterId,
                item: item.name,
                quantity: parsed.quantity
            }, null, 2)
        }]
    };
}

export async function handleUseItem(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo, itemRepo } = ensureDb();
    const parsed = InventoryTools.USE_ITEM.inputSchema.parse(args);

    // Get item details
    const item = itemRepo.findById(parsed.itemId);
    if (!item) {
        throw new Error(`Item not found: ${parsed.itemId}`);
    }

    // Verify it's a consumable
    if (item.type !== 'consumable') {
        throw new Error(`Item "${item.name}" is not a consumable (type: ${item.type})`);
    }

    // Verify ownership
    const inventory = inventoryRepo.getInventory(parsed.characterId);
    const hasItem = inventory.items.some(i => i.itemId === parsed.itemId && i.quantity > 0);
    if (!hasItem) {
        throw new Error(`Character does not have item "${item.name}"`);
    }

    // Remove one from inventory
    const removed = inventoryRepo.removeItem(parsed.characterId, parsed.itemId, 1);
    if (!removed) {
        throw new Error(`Failed to consume item`);
    }

    // Extract effect from properties
    const effect = item.properties?.effect || item.properties?.effects || 'No defined effect';

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `Used ${item.name}`,
                item: {
                    id: item.id,
                    name: item.name,
                    description: item.description
                },
                effect,
                target: parsed.targetId || parsed.characterId,
                consumed: true
            }, null, 2)
        }]
    };
}

export async function handleGetInventoryDetailed(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo } = ensureDb();
    const parsed = InventoryTools.GET_INVENTORY_DETAILED.inputSchema.parse(args);

    const inventory = inventoryRepo.getInventoryWithDetails(parsed.characterId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(inventory, null, 2)
        }]
    };
}
