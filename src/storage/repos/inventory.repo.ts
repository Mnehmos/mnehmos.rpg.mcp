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

        // Get currency from characters table
        const currency = this.getCurrency(characterId);

        return InventorySchema.parse({
            characterId,
            items,
            capacity: 100, // Default
            currency
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

        const currency = this.getCurrency(characterId);

        return {
            characterId,
            items,
            totalWeight,
            capacity: 100,
            currency
        };
    }

    // ============================================================
    // CURRENCY OPERATIONS
    // ============================================================

    /**
     * Get currency for a character
     */
    getCurrency(characterId: string): { gold: number; silver: number; copper: number } {
        const stmt = this.db.prepare('SELECT currency FROM characters WHERE id = ?');
        const row = stmt.get(characterId) as { currency: string | null } | undefined;

        if (!row || !row.currency) {
            return { gold: 0, silver: 0, copper: 0 };
        }

        try {
            const parsed = JSON.parse(row.currency);
            return {
                gold: parsed.gold ?? 0,
                silver: parsed.silver ?? 0,
                copper: parsed.copper ?? 0
            };
        } catch {
            return { gold: 0, silver: 0, copper: 0 };
        }
    }

    /**
     * Set currency for a character (replaces existing)
     */
    setCurrency(characterId: string, currency: { gold?: number; silver?: number; copper?: number }): void {
        const current = this.getCurrency(characterId);
        const updated = {
            gold: currency.gold ?? current.gold,
            silver: currency.silver ?? current.silver,
            copper: currency.copper ?? current.copper
        };

        const stmt = this.db.prepare('UPDATE characters SET currency = ? WHERE id = ?');
        stmt.run(JSON.stringify(updated), characterId);
    }

    /**
     * Add currency to a character
     */
    addCurrency(characterId: string, currency: { gold?: number; silver?: number; copper?: number }): { gold: number; silver: number; copper: number } {
        const current = this.getCurrency(characterId);
        const updated = {
            gold: current.gold + (currency.gold ?? 0),
            silver: current.silver + (currency.silver ?? 0),
            copper: current.copper + (currency.copper ?? 0)
        };

        const stmt = this.db.prepare('UPDATE characters SET currency = ? WHERE id = ?');
        stmt.run(JSON.stringify(updated), characterId);

        return updated;
    }

    /**
     * Remove currency from a character
     * @returns true if successful, false if insufficient funds
     */
    removeCurrency(characterId: string, currency: { gold?: number; silver?: number; copper?: number }): boolean {
        const current = this.getCurrency(characterId);

        // Convert everything to copper for comparison
        const currentTotal = current.gold * 100 + current.silver * 10 + current.copper;
        const removeTotal = (currency.gold ?? 0) * 100 + (currency.silver ?? 0) * 10 + (currency.copper ?? 0);

        if (removeTotal > currentTotal) {
            return false;
        }

        // Simple subtraction (doesn't auto-convert denominations)
        const updated = {
            gold: current.gold - (currency.gold ?? 0),
            silver: current.silver - (currency.silver ?? 0),
            copper: current.copper - (currency.copper ?? 0)
        };

        // Handle negative values by borrowing
        if (updated.copper < 0) {
            const needed = Math.ceil(-updated.copper / 10);
            updated.silver -= needed;
            updated.copper += needed * 10;
        }
        if (updated.silver < 0) {
            const needed = Math.ceil(-updated.silver / 10);
            updated.gold -= needed;
            updated.silver += needed * 10;
        }

        if (updated.gold < 0) {
            return false; // Shouldn't happen if our total check was correct
        }

        const stmt = this.db.prepare('UPDATE characters SET currency = ? WHERE id = ?');
        stmt.run(JSON.stringify(updated), characterId);

        return true;
    }

    /**
     * Transfer currency between characters
     * @returns true if successful, false if insufficient funds
     */
    transferCurrency(fromCharacterId: string, toCharacterId: string, currency: { gold?: number; silver?: number; copper?: number }): boolean {
        const transfer = this.db.transaction(() => {
            if (!this.removeCurrency(fromCharacterId, currency)) {
                return false;
            }
            this.addCurrency(toCharacterId, currency);
            return true;
        });

        return transfer();
    }

    /**
     * Check if character has at least this much currency
     */
    hasCurrency(characterId: string, currency: { gold?: number; silver?: number; copper?: number }): boolean {
        const current = this.getCurrency(characterId);
        const currentTotal = current.gold * 100 + current.silver * 10 + current.copper;
        const requiredTotal = (currency.gold ?? 0) * 100 + (currency.silver ?? 0) * 10 + (currency.copper ?? 0);
        return currentTotal >= requiredTotal;
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
