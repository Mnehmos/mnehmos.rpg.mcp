import Database from 'better-sqlite3';
import { Inventory, InventoryItem, InventorySchema } from '../../schema/inventory.js';

export class InventoryRepository {
    constructor(private db: Database.Database) { }

    getInventory(characterId: string): Inventory {
        const stmt = this.db.prepare(`
            SELECT i.*, ii.quantity, ii.equipped, ii.slot
            FROM inventory_items ii
            JOIN items i ON ii.item_id = i.id
            WHERE ii.character_id = ?
        `);

        const rows = stmt.all(characterId) as InventoryRow[];

        const items: InventoryItem[] = rows.map(row => ({
            itemId: row.id,
            quantity: row.quantity,
            equipped: Boolean(row.equipped),
            slot: row.slot || undefined
        }));

        // Note: Capacity and currency would typically be stored on the character or a separate table.
        // For now, we'll use defaults or mock values as they aren't in the schema yet.
        // In a real implementation, we'd likely join with the characters table or an inventory_metadata table.
        return InventorySchema.parse({
            characterId,
            items,
            capacity: 100, // Default
            currency: { gold: 0, silver: 0, copper: 0 } // Default
        });
    }

    addItem(characterId: string, itemId: string, quantity: number = 1): void {
        const stmt = this.db.prepare(`
            INSERT INTO inventory_items (character_id, item_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(character_id, item_id) DO UPDATE SET
            quantity = quantity + excluded.quantity
        `);
        stmt.run(characterId, itemId, quantity);
    }

    removeItem(characterId: string, itemId: string, quantity: number = 1): boolean {
        const getStmt = this.db.prepare('SELECT quantity FROM inventory_items WHERE character_id = ? AND item_id = ?');
        const row = getStmt.get(characterId, itemId) as { quantity: number } | undefined;

        if (!row || row.quantity < quantity) return false;

        if (row.quantity === quantity) {
            const delStmt = this.db.prepare('DELETE FROM inventory_items WHERE character_id = ? AND item_id = ?');
            delStmt.run(characterId, itemId);
        } else {
            const updateStmt = this.db.prepare('UPDATE inventory_items SET quantity = quantity - ? WHERE character_id = ? AND item_id = ?');
            updateStmt.run(quantity, characterId, itemId);
        }
        return true;
    }

    equipItem(characterId: string, itemId: string, slot: string): void {
        // First, unequip anything in that slot
        const unequipStmt = this.db.prepare('UPDATE inventory_items SET equipped = 0, slot = NULL WHERE character_id = ? AND slot = ?');
        unequipStmt.run(characterId, slot);

        // Then equip the new item
        const equipStmt = this.db.prepare('UPDATE inventory_items SET equipped = 1, slot = ? WHERE character_id = ? AND item_id = ?');
        equipStmt.run(slot, characterId, itemId);
    }

    unequipItem(characterId: string, itemId: string): void {
        const stmt = this.db.prepare('UPDATE inventory_items SET equipped = 0, slot = NULL WHERE character_id = ? AND item_id = ?');
        stmt.run(characterId, itemId);
    }

    /**
     * Find all characters who own a specific item (for world-unique enforcement)
     */
    findItemOwners(itemId: string): string[] {
        const stmt = this.db.prepare('SELECT character_id FROM inventory_items WHERE item_id = ?');
        const rows = stmt.all(itemId) as { character_id: string }[];
        return rows.map(r => r.character_id);
    }

    transferItem(fromCharacterId: string, toCharacterId: string, itemId: string, quantity: number = 1): boolean {
        // Verify source has enough
        const getStmt = this.db.prepare('SELECT quantity, equipped FROM inventory_items WHERE character_id = ? AND item_id = ?');
        const row = getStmt.get(fromCharacterId, itemId) as { quantity: number; equipped: number } | undefined;

        if (!row || row.quantity < quantity) return false;

        // Can't transfer equipped items
        if (row.equipped) return false;

        // Use transaction for atomicity
        const transfer = this.db.transaction(() => {
            // Remove from source
            if (row.quantity === quantity) {
                const delStmt = this.db.prepare('DELETE FROM inventory_items WHERE character_id = ? AND item_id = ?');
                delStmt.run(fromCharacterId, itemId);
            } else {
                const updateStmt = this.db.prepare('UPDATE inventory_items SET quantity = quantity - ? WHERE character_id = ? AND item_id = ?');
                updateStmt.run(quantity, fromCharacterId, itemId);
            }

            // Add to destination
            const addStmt = this.db.prepare(`
                INSERT INTO inventory_items (character_id, item_id, quantity)
                VALUES (?, ?, ?)
                ON CONFLICT(character_id, item_id) DO UPDATE SET
                quantity = quantity + excluded.quantity
            `);
            addStmt.run(toCharacterId, itemId, quantity);
        });

        transfer();
        return true;
    }

    getInventoryWithDetails(characterId: string): InventoryWithItems {
        const stmt = this.db.prepare(`
            SELECT i.*, ii.quantity, ii.equipped, ii.slot
            FROM inventory_items ii
            JOIN items i ON ii.item_id = i.id
            WHERE ii.character_id = ?
            ORDER BY ii.equipped DESC, i.type, i.name
        `);

        const rows = stmt.all(characterId) as InventoryRowFull[];

        const items = rows.map(row => ({
            item: {
                id: row.id,
                name: row.name,
                description: row.description || undefined,
                type: row.type as 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc',
                weight: row.weight,
                value: row.value,
                properties: row.properties ? JSON.parse(row.properties) : undefined
            },
            quantity: row.quantity,
            equipped: Boolean(row.equipped),
            slot: row.slot || undefined
        }));

        const totalWeight = items.reduce((sum, i) => sum + (i.item.weight * i.quantity), 0);

        return {
            characterId,
            items,
            totalWeight,
            capacity: 100,
            currency: { gold: 0, silver: 0, copper: 0 }
        };
    }
}

interface InventoryRowFull {
    id: string;
    name: string;
    description: string | null;
    type: string;
    weight: number;
    value: number;
    properties: string | null;
    quantity: number;
    equipped: number;
    slot: string | null;
}

interface InventoryWithItems {
    characterId: string;
    items: Array<{
        item: {
            id: string;
            name: string;
            description?: string;
            type: 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc';
            weight: number;
            value: number;
            properties?: Record<string, any>;
        };
        quantity: number;
        equipped: boolean;
        slot?: string;
    }>;
    totalWeight: number;
    capacity: number;
    currency: { gold: number; silver: number; copper: number };
}

interface InventoryRow {
    id: string;
    name: string;
    type: string;
    weight: number;
    value: number;
    quantity: number;
    equipped: number;
    slot: string | null;
}
