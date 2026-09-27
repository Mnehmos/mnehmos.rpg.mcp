import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import {
    Corpse,
    CorpseState,
    LootTable,
    CORPSE_DECAY_RULES,
    DEFAULT_LOOT_TABLES
} from '../../schema/corpse.js';
import { InventoryRepository } from './inventory.repo.js';
import { ItemRepository } from './item.repo.js';

/**
 * FAILED-004: Corpse Repository
 * Manages corpses, loot generation, and harvesting
 */

interface CorpseRow {
    id: string;
    character_id: string;
    character_name: string;
    character_type: string;
    creature_type: string | null;
    cr: number | null;
    world_id: string | null;
    region_id: string | null;
    position_x: number | null;
    position_y: number | null;
    encounter_id: string | null;
    state: string;
    state_updated_at: string;
    loot_generated: number;
    looted: number;
    looted_by: string | null;
    looted_at: string | null;
    currency: string | null;
    currency_looted: number;
    harvestable: number;
    harvestable_resources: string;
    created_at: string;
    updated_at: string;
}

interface CorpseInventoryRow {
    corpse_id: string;
    item_id: string;
    quantity: number;
    looted: number;
}

interface LootTableRow {
    id: string;
    name: string;
    creature_types: string;
    cr_min: number | null;
    cr_max: number | null;
    guaranteed_drops: string;
    random_drops: string;
    currency_range: string | null;
    harvestable_resources: string | null;
    created_at: string;
    updated_at: string;
}

export class CorpseRepository {
    private inventoryRepo: InventoryRepository;

    constructor(private db: Database.Database) {
        this.inventoryRepo = new InventoryRepository(db);
    }

    /**
     * Create a corpse when a character dies
     */
    createFromDeath(characterId: string, characterName: string, characterType: 'pc' | 'npc' | 'enemy' | 'neutral', options: {
        encounterId?: string;
        position?: { x: number; y: number };
        worldId?: string;
        regionId?: string;
        creatureType?: string;
        cr?: number;
    } = {}): Corpse {
        const now = new Date().toISOString();
        const id = uuid();

        const stmt = this.db.prepare(`
            INSERT INTO corpses (
                id, character_id, character_name, character_type, creature_type, cr,
                world_id, region_id, position_x, position_y, encounter_id,
                state, state_updated_at, harvestable, harvestable_resources,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fresh', ?, 0, '[]', ?, ?)
        `);

        stmt.run(
            id,
            characterId,
            characterName,
            characterType,
            options.creatureType ?? null,
            options.cr ?? null,
            options.worldId ?? null,
            options.regionId ?? null,
            options.position?.x ?? null,
            options.position?.y ?? null,
            options.encounterId ?? null,
            now,
            now,
            now
        );

        return this.findById(id)!;
    }

    /**
     * Get corpse by ID
     */
    findById(id: string): Corpse | null {
        const stmt = this.db.prepare(`SELECT * FROM corpses WHERE id = ?`);
        const row = stmt.get(id) as CorpseRow | undefined;
        if (!row) return null;
        return this.rowToCorpse(row);
    }

    /**
     * Get corpse for a specific character
     */
    findByCharacterId(characterId: string): Corpse | null {
        const stmt = this.db.prepare(`
            SELECT * FROM corpses
            WHERE character_id = ? AND state != 'gone'
            ORDER BY created_at DESC LIMIT 1
        `);
        const row = stmt.get(characterId) as CorpseRow | undefined;
        if (!row) return null;
        return this.rowToCorpse(row);
    }

    /**
     * Get all corpses in an encounter
     */
    findByEncounterId(encounterId: string): Corpse[] {
        const stmt = this.db.prepare(`
            SELECT * FROM corpses
            WHERE encounter_id = ? AND state != 'gone'
        `);
        const rows = stmt.all(encounterId) as CorpseRow[];
        return rows.map(r => this.rowToCorpse(r));
    }

    /**
     * Get corpses in a region
     */
    findByRegion(worldId: string, regionId: string): Corpse[] {
        const stmt = this.db.prepare(`
            SELECT * FROM corpses
            WHERE world_id = ? AND region_id = ? AND state != 'gone'
        `);
        const rows = stmt.all(worldId, regionId) as CorpseRow[];
        return rows.map(r => this.rowToCorpse(r));
    }

    /**
     * Get corpses at or near a specific position
     */
    findNearPosition(worldId: string, x: number, y: number, radius: number = 3): Corpse[] {
        const stmt = this.db.prepare(`
            SELECT * FROM corpses
            WHERE world_id = ?
              AND state != 'gone'
              AND position_x IS NOT NULL
              AND position_y IS NOT NULL
              AND ABS(position_x - ?) <= ?
              AND ABS(position_y - ?) <= ?
        `);
        const rows = stmt.all(worldId, x, radius, y, radius) as CorpseRow[];
        return rows.map(r => this.rowToCorpse(r));
    }

    /**
     * Add item to corpse inventory
     */
    addToCorpseInventory(corpseId: string, itemId: string, quantity: number = 1): void {
        const stmt = this.db.prepare(`
            INSERT INTO corpse_inventory (corpse_id, item_id, quantity, looted)
            VALUES (?, ?, ?, 0)
            ON CONFLICT(corpse_id, item_id) DO UPDATE SET quantity = quantity + ?
        `);
        stmt.run(corpseId, itemId, quantity, quantity);
    }

    /**
     * Get items in corpse inventory
     */
    getCorpseInventory(corpseId: string): Array<{ itemId: string; quantity: number; looted: boolean }> {
        const stmt = this.db.prepare(`
            SELECT * FROM corpse_inventory
            WHERE corpse_id = ?
        `);
        const rows = stmt.all(corpseId) as CorpseInventoryRow[];
        return rows.map(r => ({
            itemId: r.item_id,
            quantity: r.quantity,
            looted: r.looted === 1
        }));
    }

    /**
     * Get unlootable items from corpse
     */
    getAvailableLoot(corpseId: string): Array<{ itemId: string; quantity: number }> {
        const stmt = this.db.prepare(`
            SELECT * FROM corpse_inventory
            WHERE corpse_id = ? AND looted = 0
        `);
        const rows = stmt.all(corpseId) as CorpseInventoryRow[];
        return rows.map(r => ({
            itemId: r.item_id,
            quantity: r.quantity
        }));
    }

    /**
     * Loot an item from a corpse
     * @param transferToLooter - If true, adds item to looter's inventory
     */
    lootItem(corpseId: string, itemId: string, looterId: string, quantity?: number, transferToLooter?: boolean): {
        success: boolean;
        itemId: string;
        quantity: number;
        transferred: boolean;
        reason?: string;
    } {
        const corpse = this.findById(corpseId);
        if (!corpse) {
            return { success: false, itemId, quantity: 0, transferred: false, reason: 'Corpse not found' };
        }

        if (corpse.state === 'gone') {
            return { success: false, itemId, quantity: 0, transferred: false, reason: 'Corpse has decayed completely' };
        }

        const inventory = this.getAvailableLoot(corpseId);
        const item = inventory.find(i => i.itemId === itemId);
        if (!item) {
            return { success: false, itemId, quantity: 0, transferred: false, reason: 'Item not on corpse or already looted' };
        }

        const toLoot = quantity ?? item.quantity;
        if (toLoot > item.quantity) {
            return { success: false, itemId, quantity: 0, transferred: false, reason: `Only ${item.quantity} available` };
        }

        const now = new Date().toISOString();

        if (toLoot === item.quantity) {
            // Mark as fully looted
            const stmt = this.db.prepare(`
                UPDATE corpse_inventory SET looted = 1 WHERE corpse_id = ? AND item_id = ?
            `);
            stmt.run(corpseId, itemId);
        } else {
            // Reduce quantity
            const stmt = this.db.prepare(`
                UPDATE corpse_inventory SET quantity = quantity - ? WHERE corpse_id = ? AND item_id = ?
            `);
            stmt.run(toLoot, corpseId, itemId);
        }

        // Update corpse
        const updateStmt = this.db.prepare(`
            UPDATE corpses SET looted_by = ?, looted_at = ?, updated_at = ? WHERE id = ?
        `);
        updateStmt.run(looterId, now, now, corpseId);

        // Check if all items looted
        const remaining = this.getAvailableLoot(corpseId);
        if (remaining.length === 0) {
            const lootedStmt = this.db.prepare(`
                UPDATE corpses SET looted = 1, updated_at = ? WHERE id = ?
            `);
            lootedStmt.run(now, corpseId);
        }

        // Optionally transfer to looter's inventory
        let transferred = false;
        if (transferToLooter) {
            this.inventoryRepo.addItem(looterId, itemId, toLoot);
            transferred = true;
        }

        return { success: true, itemId, quantity: toLoot, transferred };
    }

    /**
     * Loot all items from a corpse
     * @param transferToLooter - If true, adds all items to looter's inventory
     */
    lootAll(corpseId: string, looterId: string, transferToLooter?: boolean): Array<{ itemId: string; quantity: number; transferred: boolean }> {
        const available = this.getAvailableLoot(corpseId);
        const looted: Array<{ itemId: string; quantity: number; transferred: boolean }> = [];

        for (const item of available) {
            const result = this.lootItem(corpseId, item.itemId, looterId, item.quantity, transferToLooter);
            if (result.success) {
                looted.push({ itemId: result.itemId, quantity: result.quantity, transferred: result.transferred });
            }
        }

        return looted;
    }

    /**
     * Loot currency from a corpse
     * @param transferToLooter - If true, adds currency to looter's inventory
     */
    lootCurrency(corpseId: string, looterId: string, transferToLooter?: boolean): {
        success: boolean;
        currency: { gold: number; silver: number; copper: number };
        transferred: boolean;
        reason?: string;
    } {
        const corpse = this.findById(corpseId);
        if (!corpse) {
            return { success: false, currency: { gold: 0, silver: 0, copper: 0 }, transferred: false, reason: 'Corpse not found' };
        }

        if (corpse.currencyLooted) {
            return { success: false, currency: { gold: 0, silver: 0, copper: 0 }, transferred: false, reason: 'Currency already looted' };
        }

        const currency = corpse.currency;
        if (currency.gold === 0 && currency.silver === 0 && currency.copper === 0) {
            return { success: false, currency: { gold: 0, silver: 0, copper: 0 }, transferred: false, reason: 'No currency on corpse' };
        }

        // Mark currency as looted
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            UPDATE corpses SET currency_looted = 1, updated_at = ? WHERE id = ?
        `);
        stmt.run(now, corpseId);

        // Optionally transfer to looter's inventory
        let transferred = false;
        if (transferToLooter) {
            this.inventoryRepo.addCurrency(looterId, currency);
            transferred = true;
        }

        return { success: true, currency, transferred };
    }

    /**
     * Generate loot for a corpse based on creature type
     */
    generateLoot(corpseId: string, creatureType: string, cr?: number): {
        itemsAdded: Array<{ name: string; quantity: number }>;
        currency: { gold: number; silver: number; copper: number };
        harvestable: Array<{ resourceType: string; quantity: number }>;
    } {
        const corpse = this.findById(corpseId);
        if (!corpse || corpse.lootGenerated) {
            return { itemsAdded: [], currency: { gold: 0, silver: 0, copper: 0 }, harvestable: [] };
        }

        // Find matching loot table
        const lootTable = this.findLootTableByCreatureType(creatureType, cr);
        if (!lootTable) {
            // Mark as generated but empty
            this.markLootGenerated(corpseId);
            return { itemsAdded: [], currency: { gold: 0, silver: 0, copper: 0 }, harvestable: [] };
        }

        const itemsAdded: Array<{ name: string; quantity: number }> = [];
        const harvestable: Array<{ resourceType: string; quantity: number }> = [];

        // Process guaranteed drops
        for (const drop of lootTable.guaranteedDrops) {
            const qty = this.rollQuantity(drop.quantity.min, drop.quantity.max);
            if (qty > 0 && drop.itemName) {
                itemsAdded.push({ name: drop.itemName, quantity: qty });
                // Would need to create item in items table and add to corpse_inventory
            }
        }

        // Process random drops
        for (const drop of lootTable.randomDrops) {
            if (Math.random() <= drop.weight) {
                const qty = this.rollQuantity(drop.quantity.min, drop.quantity.max);
                if (qty > 0 && drop.itemName) {
                    itemsAdded.push({ name: drop.itemName, quantity: qty });
                }
            }
        }

        // Process currency
        let gold = 0, silver = 0, copper = 0;
        if (lootTable.currencyRange) {
            gold = this.rollQuantity(lootTable.currencyRange.gold.min, lootTable.currencyRange.gold.max);
            if (lootTable.currencyRange.silver) {
                silver = this.rollQuantity(lootTable.currencyRange.silver.min, lootTable.currencyRange.silver.max);
            }
            if (lootTable.currencyRange.copper) {
                copper = this.rollQuantity(lootTable.currencyRange.copper.min, lootTable.currencyRange.copper.max);
            }
        }

        // Process harvestable resources
        if (lootTable.harvestableResources) {
            for (const resource of lootTable.harvestableResources) {
                const qty = this.rollQuantity(resource.quantity.min, resource.quantity.max);
                if (qty > 0) {
                    harvestable.push({ resourceType: resource.resourceType, quantity: qty });
                }
            }
        }

        // Update corpse with harvestable resources
        if (harvestable.length > 0) {
            const now = new Date().toISOString();
            const stmt = this.db.prepare(`
                UPDATE corpses
                SET harvestable = 1, harvestable_resources = ?, updated_at = ?
                WHERE id = ?
            `);
            stmt.run(
                JSON.stringify(harvestable.map(h => ({ ...h, harvested: false }))),
                now,
                corpseId
            );
        }

        this.markLootGenerated(corpseId, { gold, silver, copper });

        return { itemsAdded, currency: { gold, silver, copper }, harvestable };
    }

    /**
     * Harvest a resource from a corpse
     * @param createItem - If true, creates an item in the items table and adds to harvester inventory
     */
    harvestResource(corpseId: string, resourceType: string, harvesterId: string, options?: {
        skillCheck?: { roll: number; dc: number };
        createItem?: boolean;
    }): {
        success: boolean;
        quantity: number;
        resourceType: string;
        itemId?: string;
        transferred: boolean;
        reason?: string;
    } {
        const corpse = this.findById(corpseId);
        if (!corpse) {
            return { success: false, quantity: 0, resourceType, transferred: false, reason: 'Corpse not found' };
        }

        if (!corpse.harvestable) {
            return { success: false, quantity: 0, resourceType, transferred: false, reason: 'Corpse has no harvestable resources' };
        }

        if (corpse.state === 'skeletal' || corpse.state === 'gone') {
            return { success: false, quantity: 0, resourceType, transferred: false, reason: 'Corpse too decayed to harvest' };
        }

        const resources = corpse.harvestableResources;
        const resource = resources.find(r => r.resourceType === resourceType && !r.harvested);
        if (!resource) {
            return { success: false, quantity: 0, resourceType, transferred: false, reason: 'Resource not available or already harvested' };
        }

        // Check DC if required
        if (options?.skillCheck) {
            if (options.skillCheck.roll < options.skillCheck.dc) {
                return { success: false, quantity: 0, resourceType, transferred: false, reason: `Failed skill check (${options.skillCheck.roll} vs DC ${options.skillCheck.dc})` };
            }
        }

        // Mark harvested, mint the item, hand it over: one transaction, so a
        // failure partway can't leave a harvested corpse with no pelt anywhere.
        resource.harvested = true;
        const now = new Date().toISOString();
        let itemId: string | undefined;
        let transferred = false;

        this.db.transaction(() => {
            this.db.prepare(`
                UPDATE corpses
                SET harvestable_resources = ?, updated_at = ?
                WHERE id = ?
            `).run(JSON.stringify(resources), now, corpseId);

            if (options?.createItem) {
                // Created through ItemRepository, the one writer of `items`. The
                // hand-rolled INSERT that used to live here skipped `properties`,
                // so harvested items read back without it — the same drift as #81.
                itemId = uuid();
                new ItemRepository(this.db).create({
                    id: itemId,
                    name: resourceType, // e.g. "wolf pelt"
                    description: `Harvested ${resourceType} from a corpse`,
                    type: 'misc',
                    weight: 1,
                    value: 10, // Default value, could be parameterized
                    properties: {},
                    createdAt: now,
                    updatedAt: now
                });

                this.inventoryRepo.addItem(harvesterId, itemId, resource.quantity);
                transferred = true;
            }
        })();

        return { success: true, quantity: resource.quantity, resourceType, itemId, transferred };
    }

    /**
     * Process corpse decay based on time passed
     */
    processDecay(hoursAdvanced: number): { corpseId: string; oldState: CorpseState; newState: CorpseState }[] {
        const changes: { corpseId: string; oldState: CorpseState; newState: CorpseState }[] = [];
        const stmt = this.db.prepare(`SELECT * FROM corpses WHERE state != 'gone'`);
        const corpses = stmt.all() as CorpseRow[];

        const now = new Date();

        for (const row of corpses) {
            const stateUpdated = new Date(row.state_updated_at);
            const hoursSinceUpdate = Math.floor((now.getTime() - stateUpdated.getTime()) / (1000 * 60 * 60)) + hoursAdvanced;

            let currentState = row.state as CorpseState;
            let newState = currentState;

            if (currentState === 'fresh' && hoursSinceUpdate >= CORPSE_DECAY_RULES.fresh_to_decaying) {
                newState = 'decaying';
            } else if (currentState === 'decaying' && hoursSinceUpdate >= CORPSE_DECAY_RULES.decaying_to_skeletal) {
                newState = 'skeletal';
            } else if (currentState === 'skeletal' && hoursSinceUpdate >= CORPSE_DECAY_RULES.skeletal_to_gone) {
                newState = 'gone';
            }

            if (newState !== currentState) {
                this.updateState(row.id, newState);
                changes.push({ corpseId: row.id, oldState: currentState, newState });
            }
        }

        return changes;
    }

    /**
     * Update corpse state
     */
    updateState(corpseId: string, newState: CorpseState): void {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            UPDATE corpses SET state = ?, state_updated_at = ?, updated_at = ? WHERE id = ?
        `);
        stmt.run(newState, now, now, corpseId);
    }

    /**
     * Clean up gone corpses
     */
    cleanupGoneCorpses(): number {
        // Delete corpse inventory first
        const deleteInventory = this.db.prepare(`
            DELETE FROM corpse_inventory WHERE corpse_id IN (SELECT id FROM corpses WHERE state = 'gone')
        `);
        deleteInventory.run();

        // Delete corpses
        const deleteCorpses = this.db.prepare(`DELETE FROM corpses WHERE state = 'gone'`);
        const result = deleteCorpses.run();
        return result.changes;
    }

    /**
     * Mark corpse as loot generated
     */
    private markLootGenerated(corpseId: string, currency?: { gold: number; silver: number; copper: number }): void {
        const now = new Date().toISOString();
        if (currency && (currency.gold > 0 || currency.silver > 0 || currency.copper > 0)) {
            const stmt = this.db.prepare(`
                UPDATE corpses SET loot_generated = 1, currency = ?, updated_at = ? WHERE id = ?
            `);
            stmt.run(JSON.stringify(currency), now, corpseId);
        } else {
            const stmt = this.db.prepare(`
                UPDATE corpses SET loot_generated = 1, updated_at = ? WHERE id = ?
            `);
            stmt.run(now, corpseId);
        }
    }

    // ============================================================
    // LOOT TABLE OPERATIONS
    // ============================================================

    /**
     * Create a loot table
     */
    createLootTable(table: Omit<LootTable, 'id' | 'createdAt' | 'updatedAt'>): LootTable {
        const now = new Date().toISOString();
        const id = uuid();

        const stmt = this.db.prepare(`
            INSERT INTO loot_tables (
                id, name, creature_types, cr_min, cr_max,
                guaranteed_drops, random_drops, currency_range, harvestable_resources,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            id,
            table.name,
            JSON.stringify(table.creatureTypes),
            table.crRange?.min ?? null,
            table.crRange?.max ?? null,
            JSON.stringify(table.guaranteedDrops),
            JSON.stringify(table.randomDrops),
            table.currencyRange ? JSON.stringify(table.currencyRange) : null,
            table.harvestableResources ? JSON.stringify(table.harvestableResources) : null,
            now,
            now
        );

        return this.findLootTableById(id)!;
    }

    /**
     * Find loot table by ID
     */
    findLootTableById(id: string): LootTable | null {
        const stmt = this.db.prepare(`SELECT * FROM loot_tables WHERE id = ?`);
        const row = stmt.get(id) as LootTableRow | undefined;
        if (!row) return null;
        return this.rowToLootTable(row);
    }

    /**
     * Find loot table by creature type
     */
    findLootTableByCreatureType(creatureType: string, cr?: number): LootTable | null {
        // First try to find in database
        const stmt = this.db.prepare(`SELECT * FROM loot_tables`);
        const rows = stmt.all() as LootTableRow[];

        for (const row of rows) {
            const table = this.rowToLootTable(row);
            if (table.creatureTypes.includes(creatureType.toLowerCase())) {
                if (cr !== undefined && table.crRange) {
                    if (cr >= table.crRange.min && cr <= table.crRange.max) {
                        return table;
                    }
                } else {
                    return table;
                }
            }
        }

        // Fall back to default loot tables
        for (const defaultTable of DEFAULT_LOOT_TABLES) {
            if (defaultTable.creatureTypes.includes(creatureType.toLowerCase())) {
                if (cr !== undefined && defaultTable.crRange) {
                    if (cr >= defaultTable.crRange.min && cr <= defaultTable.crRange.max) {
                        return {
                            id: `default-${defaultTable.name.toLowerCase().replace(/\s+/g, '-')}`,
                            ...defaultTable,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        };
                    }
                } else {
                    return {
                        id: `default-${defaultTable.name.toLowerCase().replace(/\s+/g, '-')}`,
                        ...defaultTable,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                }
            }
        }

        return null;
    }

    /**
     * List all loot tables
     */
    listLootTables(): LootTable[] {
        const stmt = this.db.prepare(`SELECT * FROM loot_tables`);
        const rows = stmt.all() as LootTableRow[];
        return rows.map(r => this.rowToLootTable(r));
    }

    // ============================================================
    // HELPER METHODS
    // ============================================================

    private rollQuantity(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private rowToCorpse(row: CorpseRow): Corpse {
        let currency = { gold: 0, silver: 0, copper: 0 };
        if (row.currency) {
            try {
                const parsed = JSON.parse(row.currency);
                currency = {
                    gold: parsed.gold ?? 0,
                    silver: parsed.silver ?? 0,
                    copper: parsed.copper ?? 0
                };
            } catch {
                // Keep default
            }
        }

        return {
            id: row.id,
            characterId: row.character_id,
            characterName: row.character_name,
            characterType: row.character_type as 'pc' | 'npc' | 'enemy' | 'neutral',
            creatureType: row.creature_type ?? undefined,
            cr: row.cr ?? undefined,
            worldId: row.world_id,
            regionId: row.region_id,
            position: row.position_x !== null && row.position_y !== null
                ? { x: row.position_x, y: row.position_y }
                : null,
            encounterId: row.encounter_id,
            state: row.state as CorpseState,
            stateUpdatedAt: row.state_updated_at,
            lootGenerated: row.loot_generated === 1,
            looted: row.looted === 1,
            lootedBy: row.looted_by,
            lootedAt: row.looted_at,
            currency,
            currencyLooted: row.currency_looted === 1,
            harvestable: row.harvestable === 1,
            harvestableResources: JSON.parse(row.harvestable_resources),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    private rowToLootTable(row: LootTableRow): LootTable {
        return {
            id: row.id,
            name: row.name,
            creatureTypes: JSON.parse(row.creature_types),
            crRange: row.cr_min !== null && row.cr_max !== null
                ? { min: row.cr_min, max: row.cr_max }
                : undefined,
            guaranteedDrops: JSON.parse(row.guaranteed_drops),
            randomDrops: JSON.parse(row.random_drops),
            currencyRange: row.currency_range ? JSON.parse(row.currency_range) : undefined,
            harvestableResources: row.harvestable_resources ? JSON.parse(row.harvestable_resources) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}
