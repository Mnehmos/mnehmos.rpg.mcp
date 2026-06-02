/**
 * Consolidated Inventory Management Tool
 * Replaces 8 separate tools: give_item, remove_item, transfer_item, use_item, equip_item, unequip_item, get_inventory, get_inventory_detailed
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { ItemRepository } from '../../storage/repos/item.repo.js';
import { InventoryRepository } from '../../storage/repos/inventory.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { INVENTORY_LIMITS } from '../../schema/inventory.js';
import { getDb } from '../../storage/index.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['give', 'remove', 'transfer', 'use', 'equip', 'unequip', 'get', 'get_detailed'] as const;
type InventoryAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    return {
        itemRepo: new ItemRepository(db),
        inventoryRepo: new InventoryRepository(db),
        charRepo: new CharacterRepository(db)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const GiveSchema = z.object({
    action: z.literal('give'),
    characterId: z.string().describe('Character receiving the item'),
    itemId: z.string().describe('Item to give'),
    quantity: z.number().int().min(1).default(1).describe('Quantity to give')
});

const RemoveSchema = z.object({
    action: z.literal('remove'),
    characterId: z.string().describe('Character losing the item'),
    itemId: z.string().describe('Item to remove'),
    quantity: z.number().int().min(1).default(1).describe('Quantity to remove')
});

const TransferSchema = z.object({
    action: z.literal('transfer'),
    fromCharacterId: z.string().describe('Character giving the item'),
    toCharacterId: z.string().describe('Character receiving the item'),
    itemId: z.string().describe('The item to transfer'),
    quantity: z.number().int().min(1).default(1).describe('How many to transfer')
});

const UseSchema = z.object({
    action: z.literal('use'),
    characterId: z.string().describe('Character using the item'),
    itemId: z.string().describe('The consumable item to use'),
    targetId: z.string().optional().describe('Optional target character for the effect')
});

const EquipSchema = z.object({
    action: z.literal('equip'),
    characterId: z.string().describe('Character equipping the item'),
    itemId: z.string().describe('Item to equip'),
    slot: z.enum(['mainhand', 'offhand', 'armor', 'head', 'feet', 'accessory']).describe('Equipment slot')
});

const UnequipSchema = z.object({
    action: z.literal('unequip'),
    characterId: z.string().describe('Character unequipping the item'),
    itemId: z.string().describe('Item to unequip')
});

const GetSchema = z.object({
    action: z.literal('get'),
    characterId: z.string().describe('Character whose inventory to retrieve')
});

const GetDetailedSchema = z.object({
    action: z.literal('get_detailed'),
    characterId: z.string().describe('Character whose inventory to retrieve')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<InventoryAction, ActionDefinition> = {
    give: {
        schema: GiveSchema,
        handler: async (params: z.infer<typeof GiveSchema>) => {
            const { inventoryRepo, itemRepo } = ensureDb();

            // Validate quantity limits
            if (params.quantity > INVENTORY_LIMITS.MAX_GIVE_QUANTITY) {
                throw new Error(`Cannot give more than ${INVENTORY_LIMITS.MAX_GIVE_QUANTITY} items at once. Requested: ${params.quantity}`);
            }

            // Get item details for validation
            const item = itemRepo.findById(params.itemId);
            if (!item) {
                throw new Error(`Item not found: ${params.itemId}`);
            }

            // Check unique item constraints
            const properties = item.properties || {};
            const isUnique = properties.unique === true;
            const isWorldUnique = properties.worldUnique === true;

            if (isUnique || isWorldUnique) {
                if (params.quantity > 1) {
                    throw new Error(`Cannot give more than 1 of unique item "${item.name}"`);
                }

                const inventory = inventoryRepo.getInventory(params.characterId);
                const existingItem = inventory.items.find((i: { itemId: string }) => i.itemId === params.itemId);
                if (existingItem) {
                    throw new Error(`Character already owns unique item "${item.name}". Unique items cannot stack.`);
                }

                if (isWorldUnique) {
                    const allOwners = inventoryRepo.findItemOwners(params.itemId);
                    if (allOwners.length > 0) {
                        throw new Error(`World-unique item "${item.name}" is already owned by another character.`);
                    }
                }
            }

            // Check weight capacity
            const currentInventory = inventoryRepo.getInventoryWithDetails(params.characterId);
            const addedWeight = item.weight * params.quantity;
            const newTotalWeight = currentInventory.totalWeight + addedWeight;

            if (newTotalWeight > currentInventory.capacity) {
                throw new Error(
                    `Cannot add items: would exceed weight capacity. ` +
                    `Current: ${currentInventory.totalWeight.toFixed(1)}/${currentInventory.capacity}, ` +
                    `Adding: ${addedWeight.toFixed(1)}`
                );
            }

            // Check stack size limits
            const existingItem = currentInventory.items.find((i: { item: { id: string } }) => i.item.id === params.itemId);
            const existingQuantity = existingItem?.quantity || 0;
            const newTotal = existingQuantity + params.quantity;

            if (newTotal > INVENTORY_LIMITS.MAX_STACK_SIZE) {
                throw new Error(
                    `Cannot add items: would exceed max stack size of ${INVENTORY_LIMITS.MAX_STACK_SIZE}. ` +
                    `Current: ${existingQuantity}, Adding: ${params.quantity}`
                );
            }

            inventoryRepo.addItem(params.characterId, params.itemId, params.quantity);

            return {
                success: true,
                actionType: 'give',
                itemName: item.name,
                quantity: params.quantity,
                characterId: params.characterId,
                message: `Added ${params.quantity}x ${item.name} to inventory`
            };
        },
        aliases: ['add', 'grant', 'award']
    },

    remove: {
        schema: RemoveSchema,
        handler: async (params: z.infer<typeof RemoveSchema>) => {
            const { inventoryRepo, itemRepo } = ensureDb();

            const item = itemRepo.findById(params.itemId);
            const success = inventoryRepo.removeItem(params.characterId, params.itemId, params.quantity);

            if (!success) {
                throw new Error(`Failed to remove item. Character may not have enough quantity.`);
            }

            return {
                success: true,
                actionType: 'remove',
                itemName: item?.name || params.itemId,
                quantity: params.quantity,
                characterId: params.characterId,
                message: `Removed ${params.quantity}x ${item?.name || params.itemId} from inventory`
            };
        },
        aliases: ['take', 'subtract', 'drop']
    },

    transfer: {
        schema: TransferSchema,
        handler: async (params: z.infer<typeof TransferSchema>) => {
            const { inventoryRepo, itemRepo } = ensureDb();

            const item = itemRepo.findById(params.itemId);
            if (!item) {
                throw new Error(`Item not found: ${params.itemId}`);
            }

            const success = inventoryRepo.transferItem(
                params.fromCharacterId,
                params.toCharacterId,
                params.itemId,
                params.quantity
            );

            if (!success) {
                throw new Error(`Transfer failed. Source may not have enough quantity or item is equipped.`);
            }

            return {
                success: true,
                actionType: 'transfer',
                itemName: item.name,
                quantity: params.quantity,
                fromCharacterId: params.fromCharacterId,
                toCharacterId: params.toCharacterId,
                message: `Transferred ${params.quantity}x ${item.name}`
            };
        },
        aliases: ['trade', 'move', 'pass']
    },

    use: {
        schema: UseSchema,
        handler: async (params: z.infer<typeof UseSchema>) => {
            const { inventoryRepo, itemRepo } = ensureDb();

            const item = itemRepo.findById(params.itemId);
            if (!item) {
                throw new Error(`Item not found: ${params.itemId}`);
            }

            if (item.type !== 'consumable') {
                throw new Error(`Item "${item.name}" is not a consumable (type: ${item.type})`);
            }

            const inventory = inventoryRepo.getInventory(params.characterId);
            const hasItem = inventory.items.some((i: { itemId: string; quantity: number }) =>
                i.itemId === params.itemId && i.quantity > 0
            );
            if (!hasItem) {
                throw new Error(`Character does not have item "${item.name}"`);
            }

            const removed = inventoryRepo.removeItem(params.characterId, params.itemId, 1);
            if (!removed) {
                throw new Error(`Failed to consume item`);
            }

            const effect = item.properties?.effect || item.properties?.effects || 'No defined effect';

            return {
                success: true,
                actionType: 'use',
                itemName: item.name,
                characterId: params.characterId,
                targetId: params.targetId || params.characterId,
                effect,
                message: `Used ${item.name}`
            };
        },
        aliases: ['consume', 'apply', 'activate']
    },

    equip: {
        schema: EquipSchema,
        handler: async (params: z.infer<typeof EquipSchema>) => {
            const { inventoryRepo, itemRepo, charRepo } = ensureDb();

            // Verify ownership
            const inventory = inventoryRepo.getInventory(params.characterId);
            const hasItem = inventory.items.some((i: { itemId: string; quantity: number }) =>
                i.itemId === params.itemId && i.quantity > 0
            );

            if (!hasItem) {
                throw new Error(`Character does not own item ${params.itemId}`);
            }

            const item = itemRepo.findById(params.itemId);
            if (!item) {
                throw new Error(`Item not found: ${params.itemId}`);
            }

            inventoryRepo.equipItem(params.characterId, params.itemId, params.slot);

            // Update character AC if item has AC properties
            const character = charRepo.findById(params.characterId);
            let acChange: string | null = null;

            if (character && item.properties) {
                const props = item.properties as Record<string, unknown>;
                let newAc = character.ac;

                if (props.acBonus && typeof props.acBonus === 'number') {
                    newAc = character.ac + props.acBonus;
                    acChange = `AC increased by ${props.acBonus} (now ${newAc})`;
                }

                if (props.baseAC && typeof props.baseAC === 'number' && params.slot === 'armor') {
                    const dexMod = Math.floor((character.stats.dex - 10) / 2);
                    const maxDexBonus = props.maxDexBonus !== undefined ? Number(props.maxDexBonus) : 99;
                    const effectiveDexBonus = Math.min(dexMod, maxDexBonus);
                    newAc = props.baseAC + (maxDexBonus > 0 ? effectiveDexBonus : 0);
                    acChange = `AC set to ${newAc} (base ${props.baseAC}${maxDexBonus < 99 ? ` + DEX max ${maxDexBonus}` : ' + DEX'})`;
                }

                if (newAc !== character.ac) {
                    charRepo.update(params.characterId, { ac: newAc });
                }
            }

            return {
                success: true,
                actionType: 'equip',
                itemName: item.name,
                slot: params.slot,
                characterId: params.characterId,
                acChange,
                message: `Equipped ${item.name} in ${params.slot} slot`
            };
        },
        aliases: ['wear', 'wield', 'don']
    },

    unequip: {
        schema: UnequipSchema,
        handler: async (params: z.infer<typeof UnequipSchema>) => {
            const { inventoryRepo, itemRepo, charRepo } = ensureDb();

            const item = itemRepo.findById(params.itemId);
            const inventory = inventoryRepo.getInventory(params.characterId);
            const equippedItem = inventory.items.find((i: { itemId: string; equipped: boolean }) =>
                i.itemId === params.itemId && i.equipped
            );
            const slot = equippedItem?.slot;

            inventoryRepo.unequipItem(params.characterId, params.itemId);

            // Update character AC
            const character = charRepo.findById(params.characterId);
            let acChange: string | null = null;

            if (character && item?.properties) {
                const props = item.properties as Record<string, unknown>;
                let newAc = character.ac;

                if (props.acBonus && typeof props.acBonus === 'number') {
                    newAc = Math.max(10, character.ac - props.acBonus);
                    acChange = `AC decreased by ${props.acBonus} (now ${newAc})`;
                }

                if (props.baseAC && typeof props.baseAC === 'number' && slot === 'armor') {
                    const dexMod = Math.floor((character.stats.dex - 10) / 2);
                    newAc = 10 + dexMod;
                    acChange = `AC reverted to unarmored (${newAc})`;
                }

                if (newAc !== character.ac) {
                    charRepo.update(params.characterId, { ac: newAc });
                }
            }

            return {
                success: true,
                actionType: 'unequip',
                itemName: item?.name || params.itemId,
                characterId: params.characterId,
                acChange,
                message: `Unequipped ${item?.name || params.itemId}`
            };
        },
        aliases: ['remove_equipped', 'doff', 'unwield']
    },

    get: {
        schema: GetSchema,
        handler: async (params: z.infer<typeof GetSchema>) => {
            const { inventoryRepo } = ensureDb();

            const inventory = inventoryRepo.getInventory(params.characterId);

            return {
                success: true,
                actionType: 'get',
                characterId: params.characterId,
                inventory: inventory.items,
                itemCount: inventory.items.length
            };
        },
        aliases: ['list', 'show', 'view']
    },

    get_detailed: {
        schema: GetDetailedSchema,
        handler: async (params: z.infer<typeof GetDetailedSchema>) => {
            const { inventoryRepo } = ensureDb();

            const inventory = inventoryRepo.getInventoryWithDetails(params.characterId);

            return {
                success: true,
                actionType: 'get_detailed',
                characterId: params.characterId,
                inventory: inventory.items,
                totalWeight: inventory.totalWeight,
                capacity: inventory.capacity,
                gold: (inventory as { gold?: number }).gold || 0,
                itemCount: inventory.items.length
            };
        },
        aliases: ['detailed', 'full', 'complete']
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

export const InventoryManageTool = {
    name: 'inventory_manage',
    description: `Manage character inventories and equipment.

📦 ITEM WORKFLOW:
1. Create items with item_manage first (or use existing items)
2. give - Add items to character inventory
3. equip - Slot weapons/armor (updates AC automatically)

🔄 COMMON ACTIONS:
- transfer: Move items between characters
- use: Consume potions/scrolls (removes item, shows effect)
- get_detailed: Show weight, capacity, and item details

⚔️ EQUIPMENT SLOTS:
mainhand, offhand, armor, head, feet, accessory

Actions: ${ACTIONS.join(', ')}
Aliases: add→give, take→remove, trade→transfer, consume→use, wield→equip`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe(`Action to perform: ${ACTIONS.join(', ')}`),
        characterId: z.string().optional().describe('Character ID'),
        itemId: z.string().optional().describe('Item ID'),
        quantity: z.number().optional().describe('Quantity (default: 1)'),
        fromCharacterId: z.string().optional().describe('Source character (for transfer)'),
        toCharacterId: z.string().optional().describe('Target character (for transfer)'),
        targetId: z.string().optional().describe('Effect target (for use)'),
        slot: z.enum(['mainhand', 'offhand', 'armor', 'head', 'feet', 'accessory']).optional().describe('Equipment slot (for equip)')
    })
};

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function handleInventoryManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const response = await router(args as Record<string, unknown>);

    // Wrap response with ASCII formatting
    try {
        const parsed = JSON.parse(response.content[0].text);
        let output = '';

        if (parsed.error) {
            output = RichFormatter.header('Inventory Error', '❌');
            output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
            if (parsed.suggestions) {
                output += RichFormatter.section('Did you mean?');
                parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                    output += `  • ${s.action} (${s.similarity}% match)\n`;
                });
            }
            if (parsed.validActions) {
                output += RichFormatter.section('Valid Actions');
                output += RichFormatter.list(parsed.validActions);
            }
        } else if (parsed.actionType === 'give' || parsed.actionType === 'remove') {
            output = RichFormatter.header(parsed.actionType === 'give' ? 'Item Added' : 'Item Removed', parsed.actionType === 'give' ? '➕' : '➖');
            output += RichFormatter.keyValue({
                'Item': parsed.itemName,
                'Quantity': parsed.quantity,
                'Character': parsed.characterId,
            });
            output += RichFormatter.success(parsed.message);
        } else if (parsed.actionType === 'transfer') {
            output = RichFormatter.header('Item Transferred', '🔀');
            output += RichFormatter.keyValue({
                'Item': parsed.itemName,
                'Quantity': parsed.quantity,
                'From': parsed.fromCharacterId,
                'To': parsed.toCharacterId,
            });
            output += RichFormatter.success(parsed.message);
        } else if (parsed.actionType === 'use') {
            output = RichFormatter.header('Item Used', '✨');
            output += RichFormatter.keyValue({
                'Item': parsed.itemName,
                'Target': parsed.targetId,
            });
            output += RichFormatter.section('Effect');
            output += `${parsed.effect}\n`;
            output += RichFormatter.success(parsed.message);
        } else if (parsed.actionType === 'equip' || parsed.actionType === 'unequip') {
            output = RichFormatter.header(parsed.actionType === 'equip' ? 'Item Equipped' : 'Item Unequipped', parsed.actionType === 'equip' ? '⚔️' : '📦');
            output += RichFormatter.keyValue({
                'Item': parsed.itemName,
                'Character': parsed.characterId,
                ...(parsed.slot && { 'Slot': parsed.slot }),
            });
            if (parsed.acChange) {
                output += RichFormatter.alert(parsed.acChange, 'info');
            }
            output += RichFormatter.success(parsed.message);
        } else if (parsed.actionType === 'get' || parsed.actionType === 'get_detailed') {
            output = RichFormatter.header('Inventory', '🎒');
            output += RichFormatter.keyValue({
                'Character': parsed.characterId,
                ...(parsed.totalWeight !== undefined && {
                    'Weight': `${parsed.totalWeight}/${parsed.capacity} lbs`
                }),
                ...(parsed.gold !== undefined && { 'Gold': parsed.gold }),
                'Items': parsed.itemCount || 0
            });
            if (parsed.inventory?.length) {
                output += RichFormatter.inventory(parsed.inventory.map((i: { item?: { name: string }; itemId: string; quantity: number; equipped: boolean; slot?: string }) => ({
                    name: i.item?.name || i.itemId,
                    quantity: i.quantity,
                    equipped: i.equipped,
                    slot: i.slot,
                })));
            } else {
                output += '*Inventory is empty*\n';
            }
        } else {
            // Fallback
            output = RichFormatter.header('Inventory Operation', '🎒');
            output += JSON.stringify(parsed, null, 2) + '\n';
        }

        // Embed JSON for programmatic access
        output += RichFormatter.embedJson(parsed, 'INVENTORY_MANAGE');

        return { content: [{ type: 'text', text: output }] };
    } catch {
        // If JSON parsing fails, return original response
        return response;
    }
}
