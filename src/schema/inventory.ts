import { z } from 'zod';

// Constants for inventory system limits
export const INVENTORY_LIMITS = {
    MAX_ITEM_VALUE: 10_000_000, // 10 million gold max per item
    MAX_STACK_SIZE: 9999,       // Max items in a single stack
    MAX_GIVE_QUANTITY: 9999,    // Max items that can be given at once
    DEFAULT_WEIGHT_CAPACITY: 100 // Default carry weight (based on STR in future)
} as const;

export const ItemSchema = z.object({
    id: z.string(),
    name: z.string()
        .min(1, 'Item name cannot be empty')
        .refine(s => s.trim().length > 0, 'Item name cannot be whitespace only'),
    description: z.string().optional(),
    type: z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']),
    weight: z.number().min(0).default(0),
    value: z.number().min(0).max(INVENTORY_LIMITS.MAX_ITEM_VALUE,
        `Item value cannot exceed ${INVENTORY_LIMITS.MAX_ITEM_VALUE.toLocaleString()} gold`).default(0),
    properties: z.record(z.any()).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});

export const InventoryItemSchema = z.object({
    itemId: z.string(),
    quantity: z.number().int().min(1),
    equipped: z.boolean().default(false),
    slot: z.string().optional() // 'mainhand', 'offhand', 'armor', etc.
});

export const InventorySchema = z.object({
    characterId: z.string(),
    items: z.array(InventoryItemSchema),
    capacity: z.number().default(100), // Weight limit
    currency: z.object({
        gold: z.number().int().min(0).default(0),
        silver: z.number().int().min(0).default(0),
        copper: z.number().int().min(0).default(0)
    }).default({})
});

export type Item = z.infer<typeof ItemSchema>;
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export type Inventory = z.infer<typeof InventorySchema>;
