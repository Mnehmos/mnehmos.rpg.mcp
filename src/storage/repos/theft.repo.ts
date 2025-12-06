import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import {
    StolenItemRecord,
    FenceNpc,
    HeatLevel,
    HEAT_VALUES,
    HEAT_DECAY_RULES,
    compareHeatLevels
} from '../../schema/theft.js';
import { InventoryRepository } from './inventory.repo.js';

/**
 * HIGH-008: Theft Repository
 * Manages stolen item tracking, heat decay, and fence mechanics
 */

interface StolenItemRow {
    id: string;
    item_id: string;
    stolen_from: string;
    stolen_by: string;
    stolen_at: string;
    stolen_location: string | null;
    heat_level: string;
    heat_updated_at: string;
    reported_to_guards: number;
    bounty: number;
    witnesses: string;
    recovered: number;
    recovered_at: string | null;
    fenced: number;
    fenced_at: string | null;
    fenced_to: string | null;
    created_at: string;
    updated_at: string;
}

interface FenceNpcRow {
    npc_id: string;
    faction_id: string | null;
    buy_rate: number;
    max_heat_level: string;
    daily_heat_capacity: number;
    current_daily_heat: number;
    last_reset_at: string;
    specializations: string;
    cooldown_days: number;
    reputation: number;
}

export class TheftRepository {
    private inventoryRepo: InventoryRepository;

    constructor(private db: Database.Database) {
        this.inventoryRepo = new InventoryRepository(db);
    }

    // ============================================================
    // STOLEN ITEM OPERATIONS
    // ============================================================

    /**
     * Record a theft event
     * @param transferItem - If true, physically moves item from victim to thief inventory
     */
    recordTheft(record: {
        itemId: string;
        stolenFrom: string;
        stolenBy: string;
        stolenLocation?: string | null;
        witnesses?: string[];
        transferItem?: boolean;
        quantity?: number;
    }): StolenItemRecord & { transferred: boolean } {
        // EDGE-001: Prevent self-theft
        if (record.stolenFrom === record.stolenBy) {
            throw new Error('A character cannot steal from themselves');
        }

        const now = new Date().toISOString();
        const id = uuid();

        const stmt = this.db.prepare(`
            INSERT INTO stolen_items (
                id, item_id, stolen_from, stolen_by, stolen_at, stolen_location,
                heat_level, heat_updated_at, witnesses, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'burning', ?, ?, ?, ?)
        `);

        stmt.run(
            id,
            record.itemId,
            record.stolenFrom,
            record.stolenBy,
            now,
            record.stolenLocation ?? null,
            now,
            JSON.stringify(record.witnesses ?? []),
            now,
            now
        );

        // Optionally transfer the item physically
        let transferred = false;
        if (record.transferItem) {
            const qty = record.quantity ?? 1;
            const removed = this.inventoryRepo.removeItem(record.stolenFrom, record.itemId, qty);
            if (removed) {
                this.inventoryRepo.addItem(record.stolenBy, record.itemId, qty);
                transferred = true;
            }
        }

        return { ...this.getTheftRecord(record.itemId)!, transferred };
    }

    /**
     * Check if an item is currently stolen (not recovered or cleared)
     */
    isStolen(itemId: string): boolean {
        const stmt = this.db.prepare(`
            SELECT id FROM stolen_items
            WHERE item_id = ? AND recovered = 0
        `);
        const row = stmt.get(itemId);
        return !!row;
    }

    /**
     * Get theft record for an item
     */
    getTheftRecord(itemId: string): StolenItemRecord | null {
        const stmt = this.db.prepare(`
            SELECT * FROM stolen_items
            WHERE item_id = ? AND recovered = 0
            ORDER BY created_at DESC LIMIT 1
        `);
        const row = stmt.get(itemId) as StolenItemRow | undefined;
        if (!row) return null;
        return this.rowToStolenItem(row);
    }

    /**
     * Get all stolen items currently held by a character
     */
    getStolenItemsHeldBy(characterId: string): StolenItemRecord[] {
        // This requires joining with inventory to find items currently held
        // For now, return all items stolen by this character that aren't recovered
        const stmt = this.db.prepare(`
            SELECT si.* FROM stolen_items si
            JOIN inventory_items ii ON si.item_id = ii.item_id
            WHERE ii.character_id = ? AND si.recovered = 0
        `);
        const rows = stmt.all(characterId) as StolenItemRow[];
        return rows.map(r => this.rowToStolenItem(r));
    }

    /**
     * Get all items stolen FROM a character
     */
    getItemsStolenFrom(characterId: string): StolenItemRecord[] {
        const stmt = this.db.prepare(`
            SELECT * FROM stolen_items
            WHERE stolen_from = ? AND recovered = 0
        `);
        const rows = stmt.all(characterId) as StolenItemRow[];
        return rows.map(r => this.rowToStolenItem(r));
    }

    /**
     * Get all active theft records (not recovered)
     */
    getAllActiveThefts(): StolenItemRecord[] {
        const stmt = this.db.prepare(`
            SELECT * FROM stolen_items WHERE recovered = 0
        `);
        const rows = stmt.all() as StolenItemRow[];
        return rows.map(r => this.rowToStolenItem(r));
    }

    /**
     * Update heat level
     */
    updateHeatLevel(itemId: string, newHeat: HeatLevel): void {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            UPDATE stolen_items
            SET heat_level = ?, heat_updated_at = ?, updated_at = ?
            WHERE item_id = ? AND recovered = 0
        `);
        stmt.run(newHeat, now, now, itemId);
    }

    /**
     * Report theft to guards
     */
    reportToGuards(itemId: string, bounty: number = 0): void {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            UPDATE stolen_items
            SET reported_to_guards = 1, bounty = ?, updated_at = ?
            WHERE item_id = ? AND recovered = 0
        `);
        stmt.run(bounty, now, itemId);
    }

    /**
     * Mark item as recovered
     */
    markRecovered(itemId: string): void {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            UPDATE stolen_items
            SET recovered = 1, recovered_at = ?, updated_at = ?
            WHERE item_id = ? AND recovered = 0
        `);
        stmt.run(now, now, itemId);
    }

    /**
     * Mark item as fenced
     */
    markFenced(itemId: string, fenceId: string): void {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            UPDATE stolen_items
            SET fenced = 1, fenced_at = ?, fenced_to = ?, updated_at = ?
            WHERE item_id = ? AND recovered = 0
        `);
        stmt.run(now, fenceId, now, itemId);
    }

    /**
     * Clear stolen flag completely (after cooldown)
     */
    clearStolenFlag(itemId: string): void {
        const stmt = this.db.prepare(`
            DELETE FROM stolen_items WHERE item_id = ?
        `);
        stmt.run(itemId);
    }

    /**
     * Process heat decay for all stolen items
     */
    processHeatDecay(daysAdvanced: number): { itemId: string; oldHeat: HeatLevel; newHeat: HeatLevel }[] {
        const changes: { itemId: string; oldHeat: HeatLevel; newHeat: HeatLevel }[] = [];
        const items = this.getAllActiveThefts();
        const now = new Date();

        for (const item of items) {
            const heatUpdated = new Date(item.heatUpdatedAt);
            const daysSinceUpdate = Math.floor((now.getTime() - heatUpdated.getTime()) / (1000 * 60 * 60 * 24)) + daysAdvanced;

            let currentHeat = item.heatLevel;
            let newHeat = currentHeat;

            // Apply decay based on time passed
            if (currentHeat === 'burning' && daysSinceUpdate >= HEAT_DECAY_RULES.burning_to_hot) {
                newHeat = 'hot';
            } else if (currentHeat === 'hot' && daysSinceUpdate >= HEAT_DECAY_RULES.hot_to_warm) {
                newHeat = 'warm';
            } else if (currentHeat === 'warm' && daysSinceUpdate >= HEAT_DECAY_RULES.warm_to_cool) {
                newHeat = 'cool';
            } else if (currentHeat === 'cool' && daysSinceUpdate >= HEAT_DECAY_RULES.cool_to_cold) {
                newHeat = 'cold';
            }

            if (newHeat !== currentHeat) {
                this.updateHeatLevel(item.itemId, newHeat);
                changes.push({ itemId: item.itemId, oldHeat: currentHeat, newHeat });
            }
        }

        return changes;
    }

    // ============================================================
    // FENCE OPERATIONS
    // ============================================================

    /**
     * Register an NPC as a fence
     * EDGE-006: Throws error if NPC has been a theft victim
     */
    registerFence(fence: {
        npcId: string;
        factionId?: string | null;
        buyRate?: number;
        maxHeatLevel?: HeatLevel;
        dailyHeatCapacity?: number;
        specializations?: string[];
        cooldownDays?: number;
        reputation?: number;
    }): FenceNpc {
        const now = new Date().toISOString();

        // EDGE-006: Prevent theft victims from being registered as fences
        const victimCheck = this.db.prepare(
            'SELECT COUNT(*) as count FROM stolen_items WHERE stolen_from = ?'
        ).get(fence.npcId) as { count: number };
        if (victimCheck.count > 0) {
            throw new Error('Cannot register a theft victim as a fence');
        }

        const stmt = this.db.prepare(`
            INSERT INTO fence_npcs (
                npc_id, faction_id, buy_rate, max_heat_level, daily_heat_capacity,
                current_daily_heat, last_reset_at, specializations, cooldown_days, reputation
            ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `);

        stmt.run(
            fence.npcId,
            fence.factionId ?? null,
            fence.buyRate ?? 0.4,
            fence.maxHeatLevel ?? 'hot',
            fence.dailyHeatCapacity ?? 100,
            now,
            JSON.stringify(fence.specializations ?? []),
            fence.cooldownDays ?? 7,
            fence.reputation ?? 50
        );

        return this.getFence(fence.npcId)!;
    }

    /**
     * Get fence data for an NPC
     */
    getFence(npcId: string): FenceNpc | null {
        const stmt = this.db.prepare(`SELECT * FROM fence_npcs WHERE npc_id = ?`);
        const row = stmt.get(npcId) as FenceNpcRow | undefined;
        if (!row) return null;
        return this.rowToFence(row);
    }

    /**
     * List all fences
     */
    listFences(factionId?: string): FenceNpc[] {
        let stmt;
        if (factionId) {
            stmt = this.db.prepare(`SELECT * FROM fence_npcs WHERE faction_id = ?`);
            const rows = stmt.all(factionId) as FenceNpcRow[];
            return rows.map(r => this.rowToFence(r));
        } else {
            stmt = this.db.prepare(`SELECT * FROM fence_npcs`);
            const rows = stmt.all() as FenceNpcRow[];
            return rows.map(r => this.rowToFence(r));
        }
    }

    /**
     * Check if fence will accept an item
     */
    canFenceAccept(fenceId: string, stolenRecord: StolenItemRecord, itemValue: number): {
        accepted: boolean;
        reason?: string;
        price?: number;
    } {
        const fence = this.getFence(fenceId);
        if (!fence) {
            return { accepted: false, reason: 'Not a registered fence' };
        }

        // Check heat level
        if (compareHeatLevels(stolenRecord.heatLevel, fence.maxHeatLevel) > 0) {
            return { accepted: false, reason: `Item too hot (${stolenRecord.heatLevel}), fence only accepts ${fence.maxHeatLevel} or cooler` };
        }

        // Check daily capacity
        const heatValue = HEAT_VALUES[stolenRecord.heatLevel];
        if (fence.currentDailyHeat + heatValue > fence.dailyHeatCapacity) {
            return { accepted: false, reason: 'Fence at daily capacity' };
        }

        // Calculate price
        const price = Math.floor(itemValue * fence.buyRate);
        return { accepted: true, price };
    }

    /**
     * Record a fence transaction
     * @param paySeller - If true, transfers gold from fence to seller
     * @param sellerId - Required if paySeller is true
     * @param price - Required if paySeller is true (amount to pay)
     */
    recordFenceTransaction(
        fenceId: string,
        itemId: string,
        itemHeatLevel: HeatLevel,
        options?: {
            paySeller?: boolean;
            sellerId?: string;
            price?: number;
        }
    ): { fenced: boolean; paid: boolean; amountPaid?: number } {
        const fence = this.getFence(fenceId);
        if (!fence) return { fenced: false, paid: false };

        const heatValue = HEAT_VALUES[itemHeatLevel];

        // Update fence daily heat
        const stmt = this.db.prepare(`
            UPDATE fence_npcs
            SET current_daily_heat = current_daily_heat + ?
            WHERE npc_id = ?
        `);
        stmt.run(heatValue, fenceId);

        // Mark item as fenced
        this.markFenced(itemId, fenceId);

        // Optionally pay the seller
        let paid = false;
        if (options?.paySeller && options?.sellerId && options?.price) {
            this.inventoryRepo.addCurrency(options.sellerId, { gold: options.price });
            paid = true;
        }

        return { fenced: true, paid, amountPaid: paid ? options?.price : undefined };
    }

    /**
     * Reset daily heat capacity for all fences
     */
    resetFenceDailyCapacity(): void {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            UPDATE fence_npcs
            SET current_daily_heat = 0, last_reset_at = ?
        `);
        stmt.run(now);
    }

    // ============================================================
    // HELPER METHODS
    // ============================================================

    private rowToStolenItem(row: StolenItemRow): StolenItemRecord {
        return {
            id: row.id,
            itemId: row.item_id,
            stolenFrom: row.stolen_from,
            stolenBy: row.stolen_by,
            stolenAt: row.stolen_at,
            stolenLocation: row.stolen_location,
            heatLevel: row.heat_level as HeatLevel,
            heatUpdatedAt: row.heat_updated_at,
            reportedToGuards: row.reported_to_guards === 1,
            bounty: row.bounty,
            witnesses: JSON.parse(row.witnesses),
            recovered: row.recovered === 1,
            recoveredAt: row.recovered_at,
            fenced: row.fenced === 1,
            fencedAt: row.fenced_at,
            fencedTo: row.fenced_to,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    private rowToFence(row: FenceNpcRow): FenceNpc {
        return {
            npcId: row.npc_id,
            factionId: row.faction_id,
            buyRate: row.buy_rate,
            maxHeatLevel: row.max_heat_level as HeatLevel,
            dailyHeatCapacity: row.daily_heat_capacity,
            currentDailyHeat: row.current_daily_heat,
            lastResetAt: row.last_reset_at,
            specializations: JSON.parse(row.specializations),
            cooldownDays: row.cooldown_days,
            reputation: row.reputation
        };
    }
}
