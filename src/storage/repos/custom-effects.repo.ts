/**
 * CustomEffectsRepository
 *
 * Handles CRUD operations for custom effects (divine boons, curses, transformations).
 */

import Database from 'better-sqlite3';
import {
    CustomEffect,
    CustomEffectSchema,
    ApplyCustomEffectArgs,
    EffectMechanic,
    EffectTrigger,
    RemovalCondition,
    TriggerEvent,
    ActorType
} from '../../schema/improvisation.js';

export interface CustomEffectRow {
    id: number;
    target_id: string;
    target_type: string;
    name: string;
    description: string | null;
    source_type: string;
    source_entity_id: string | null;
    source_entity_name: string | null;
    category: string;
    power_level: number;
    mechanics: string;
    duration_type: string;
    duration_value: number | null;
    rounds_remaining: number | null;
    triggers: string;
    removal_conditions: string;
    stackable: number;
    max_stacks: number;
    current_stacks: number;
    is_active: number;
    created_at: string;
    expires_at: string | null;
}

export class CustomEffectsRepository {
    constructor(private db: Database.Database) {}

    /**
     * Apply a new custom effect to a target
     */
    apply(args: ApplyCustomEffectArgs): CustomEffect {
        const now = new Date().toISOString();

        // Calculate expires_at for time-based durations
        let expiresAt: string | null = null;
        if (args.duration.type !== 'permanent' && args.duration.type !== 'until_removed' && args.duration.value) {
            const expireDate = new Date();
            switch (args.duration.type) {
                case 'minutes':
                    expireDate.setMinutes(expireDate.getMinutes() + args.duration.value);
                    break;
                case 'hours':
                    expireDate.setHours(expireDate.getHours() + args.duration.value);
                    break;
                case 'days':
                    expireDate.setDate(expireDate.getDate() + args.duration.value);
                    break;
                // 'rounds' is tracked separately via rounds_remaining
            }
            if (args.duration.type !== 'rounds') {
                expiresAt = expireDate.toISOString();
            }
        }

        // Check for an existing active effect of the same name. Use a RAW read so a
        // previously-stored unreadable row (e.g. a legacy/invalid mechanic type written
        // before input validation tightened) cannot throw here and permanently brick this
        // (target, name): every retry would re-parse the bad row and re-throw its stored
        // error verbatim, regardless of the new payload. Instead, self-heal by dropping it.
        const existingRow = this.findRawByTargetAndName(args.target_id, args.target_type, args.name);
        let existing: CustomEffect | null = null;
        if (existingRow) {
            try {
                existing = this.rowToEffect(existingRow);
            } catch {
                // Corrupt/unreadable row: remove it so this apply() writes a clean
                // replacement instead of re-throwing the stored row's parse error forever.
                this.remove(existingRow.id);
            }
        }

        if (existing && !args.stackable) {
            // Refresh duration instead of creating new
            return this.refreshDuration(existing.id, args.duration.value || null);
        }

        if (existing && args.stackable && existing.current_stacks < (args.max_stacks ?? 1)) {
            // Increment stacks
            return this.incrementStacks(existing.id);
        }

        // Insert new effect
        const stmt = this.db.prepare(`
            INSERT INTO custom_effects (
                target_id, target_type, name, description,
                source_type, source_entity_id, source_entity_name,
                category, power_level, mechanics,
                duration_type, duration_value, rounds_remaining,
                triggers, removal_conditions,
                stackable, max_stacks, current_stacks,
                is_active, created_at, expires_at
            ) VALUES (
                @targetId, @targetType, @name, @description,
                @sourceType, @sourceEntityId, @sourceEntityName,
                @category, @powerLevel, @mechanics,
                @durationType, @durationValue, @roundsRemaining,
                @triggers, @removalConditions,
                @stackable, @maxStacks, @currentStacks,
                @isActive, @createdAt, @expiresAt
            )
        `);

        const params = {
            targetId: args.target_id,
            targetType: args.target_type,
            name: args.name,
            description: args.description,
            sourceType: args.source.type,
            sourceEntityId: args.source.entity_id || null,
            sourceEntityName: args.source.entity_name || null,
            category: args.category,
            powerLevel: args.power_level,
            mechanics: JSON.stringify(args.mechanics),
            durationType: args.duration.type,
            durationValue: args.duration.value || null,
            roundsRemaining: args.duration.type === 'rounds' ? args.duration.value : null,
            triggers: JSON.stringify(args.triggers),
            removalConditions: JSON.stringify(args.removal_conditions),
            stackable: args.stackable ? 1 : 0,
            maxStacks: args.max_stacks ?? 1,
            currentStacks: 1,
            isActive: 1,
            createdAt: now,
            expiresAt
        };

        // Insert and read-back atomically. If the stored row fails to parse on read-back
        // (e.g. a constraint input validation didn't catch), the whole transaction rolls
        // back — so an unreadable "poison" row can never persist and brick later retries
        // on this name. The error then surfaces honestly on THIS call, not a future one.
        const insertAndRead = this.db.transaction((p: typeof params): CustomEffect => {
            const result = stmt.run(p);
            return this.findById(result.lastInsertRowid as number)!;
        });

        return insertAndRead(params);
    }

    /**
     * Find an effect by ID
     */
    findById(id: number): CustomEffect | null {
        const stmt = this.db.prepare('SELECT * FROM custom_effects WHERE id = ?');
        const row = stmt.get(id) as CustomEffectRow | undefined;
        return row ? this.rowToEffect(row) : null;
    }

    /**
     * Find effect by target and name
     */
    findByTargetAndName(targetId: string, targetType: ActorType, name: string): CustomEffect | null {
        const stmt = this.db.prepare(`
            SELECT * FROM custom_effects
            WHERE target_id = ? AND target_type = ? AND name = ? AND is_active = 1
        `);
        const row = stmt.get(targetId, targetType, name) as CustomEffectRow | undefined;
        return row ? this.rowToEffect(row) : null;
    }

    /**
     * Raw, parse-tolerant lookup by target and name. Returns the underlying row without
     * running it through CustomEffectSchema, so callers (e.g. apply's self-heal path) can
     * detect a corrupt row instead of having the parse throw before they get a chance to.
     */
    findRawByTargetAndName(targetId: string, targetType: ActorType, name: string): CustomEffectRow | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM custom_effects
            WHERE target_id = ? AND target_type = ? AND name = ? AND is_active = 1
        `);
        return stmt.get(targetId, targetType, name) as CustomEffectRow | undefined;
    }

    /**
     * Get all active effects on a target
     */
    getEffectsOnTarget(targetId: string, targetType: ActorType, filters?: {
        category?: string;
        source_type?: string;
        is_active?: boolean;
    }): CustomEffect[] {
        let query = 'SELECT * FROM custom_effects WHERE target_id = ? AND target_type = ?';
        const params: any[] = [targetId, targetType];

        if (filters?.category) {
            query += ' AND category = ?';
            params.push(filters.category);
        }
        if (filters?.source_type) {
            query += ' AND source_type = ?';
            params.push(filters.source_type);
        }
        if (filters?.is_active !== undefined) {
            query += ' AND is_active = ?';
            params.push(filters.is_active ? 1 : 0);
        } else {
            // Default to active effects only
            query += ' AND is_active = 1';
        }

        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params) as CustomEffectRow[];
        return rows.map(row => this.rowToEffect(row));
    }

    /**
     * Get effects by trigger event
     */
    getEffectsByTrigger(targetId: string, targetType: ActorType, event: TriggerEvent): CustomEffect[] {
        const effects = this.getEffectsOnTarget(targetId, targetType);
        return effects.filter(effect =>
            effect.triggers.some(trigger => trigger.event === event || trigger.event === 'always_active')
        );
    }

    /**
     * Remove an effect by ID
     */
    remove(id: number): boolean {
        const stmt = this.db.prepare('DELETE FROM custom_effects WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }

    /**
     * Remove effect by target and name
     */
    removeByName(targetId: string, targetType: ActorType, name: string): boolean {
        const stmt = this.db.prepare(`
            DELETE FROM custom_effects
            WHERE target_id = ? AND target_type = ? AND name = ?
        `);
        const result = stmt.run(targetId, targetType, name);
        return result.changes > 0;
    }

    /**
     * Deactivate an effect (keep record but mark inactive)
     */
    deactivate(id: number): CustomEffect | null {
        const stmt = this.db.prepare('UPDATE custom_effects SET is_active = 0 WHERE id = ?');
        stmt.run(id);
        return this.findById(id);
    }

    /**
     * Advance round-based durations, deactivating expired effects
     */
    advanceRounds(targetId: string, targetType: ActorType, rounds: number = 1): {
        advanced: CustomEffect[];
        expired: CustomEffect[];
    } {
        const effects = this.getEffectsOnTarget(targetId, targetType);
        const advanced: CustomEffect[] = [];
        const expired: CustomEffect[] = [];

        for (const effect of effects) {
            if (effect.duration_type === 'rounds' && effect.rounds_remaining !== null) {
                const newRoundsRemaining = effect.rounds_remaining - rounds;

                if (newRoundsRemaining <= 0) {
                    // Effect expires
                    this.deactivate(effect.id);
                    expired.push({ ...effect, is_active: false, rounds_remaining: 0 });
                } else {
                    // Update rounds remaining
                    const stmt = this.db.prepare('UPDATE custom_effects SET rounds_remaining = ? WHERE id = ?');
                    stmt.run(newRoundsRemaining, effect.id);
                    advanced.push({ ...effect, rounds_remaining: newRoundsRemaining });
                }
            } else {
                advanced.push(effect);
            }
        }

        return { advanced, expired };
    }

    /**
     * Refresh duration on an existing effect
     */
    refreshDuration(id: number, newDurationValue: number | null): CustomEffect {
        const effect = this.findById(id);
        if (!effect) {
            throw new Error(`Effect ${id} not found`);
        }

        if (effect.duration_type === 'rounds') {
            const stmt = this.db.prepare('UPDATE custom_effects SET rounds_remaining = ? WHERE id = ?');
            stmt.run(newDurationValue, id);
        } else if (effect.duration_type !== 'permanent' && effect.duration_type !== 'until_removed') {
            // Recalculate expires_at
            const expireDate = new Date();
            const value = newDurationValue || effect.duration_value || 1;
            switch (effect.duration_type) {
                case 'minutes':
                    expireDate.setMinutes(expireDate.getMinutes() + value);
                    break;
                case 'hours':
                    expireDate.setHours(expireDate.getHours() + value);
                    break;
                case 'days':
                    expireDate.setDate(expireDate.getDate() + value);
                    break;
            }
            const stmt = this.db.prepare('UPDATE custom_effects SET expires_at = ?, duration_value = ? WHERE id = ?');
            stmt.run(expireDate.toISOString(), value, id);
        }

        return this.findById(id)!;
    }

    /**
     * Increment stacks on a stackable effect
     */
    incrementStacks(id: number): CustomEffect {
        const effect = this.findById(id);
        if (!effect) {
            throw new Error(`Effect ${id} not found`);
        }
        if (!effect.stackable) {
            throw new Error(`Effect ${effect.name} is not stackable`);
        }
        if (effect.current_stacks >= effect.max_stacks) {
            // At max, just refresh duration
            return this.refreshDuration(id, effect.duration_value);
        }

        const stmt = this.db.prepare('UPDATE custom_effects SET current_stacks = current_stacks + 1 WHERE id = ?');
        stmt.run(id);
        return this.findById(id)!;
    }

    /**
     * Decrement stacks on a stackable effect (removes if reaches 0)
     */
    decrementStacks(id: number): CustomEffect | null {
        const effect = this.findById(id);
        if (!effect) {
            return null;
        }

        if (effect.current_stacks <= 1) {
            this.remove(id);
            return null;
        }

        const stmt = this.db.prepare('UPDATE custom_effects SET current_stacks = current_stacks - 1 WHERE id = ?');
        stmt.run(id);
        return this.findById(id);
    }

    /**
     * Check and remove expired time-based effects
     */
    cleanupExpired(): number {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            UPDATE custom_effects
            SET is_active = 0
            WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at < ?
        `);
        const result = stmt.run(now);
        return result.changes;
    }

    /**
     * Get all active effects with a specific mechanic type
     */
    getEffectsByMechanicType(targetId: string, targetType: ActorType, mechanicType: string): CustomEffect[] {
        const effects = this.getEffectsOnTarget(targetId, targetType);
        return effects.filter(effect =>
            effect.mechanics.some(m => m.type === mechanicType)
        );
    }

    /**
     * Calculate total bonus from all effects of a given mechanic type
     */
    calculateTotalBonus(targetId: string, targetType: ActorType, mechanicType: string, condition?: string): number {
        const effects = this.getEffectsByMechanicType(targetId, targetType, mechanicType);
        let total = 0;

        for (const effect of effects) {
            for (const mechanic of effect.mechanics) {
                if (mechanic.type === mechanicType) {
                    // Check condition match if specified
                    if (condition && mechanic.condition && !mechanic.condition.includes(condition)) {
                        continue;
                    }
                    if (typeof mechanic.value === 'number') {
                        total += mechanic.value * effect.current_stacks;
                    }
                }
            }
        }

        return total;
    }

    /**
     * Convert database row to CustomEffect object
     */
    private rowToEffect(row: CustomEffectRow): CustomEffect {
        return CustomEffectSchema.parse({
            id: row.id,
            target_id: row.target_id,
            target_type: row.target_type,
            name: row.name,
            description: row.description,
            source_type: row.source_type,
            source_entity_id: row.source_entity_id,
            source_entity_name: row.source_entity_name,
            category: row.category,
            power_level: row.power_level,
            mechanics: JSON.parse(row.mechanics) as EffectMechanic[],
            duration_type: row.duration_type,
            duration_value: row.duration_value,
            rounds_remaining: row.rounds_remaining,
            triggers: JSON.parse(row.triggers) as EffectTrigger[],
            removal_conditions: JSON.parse(row.removal_conditions) as RemovalCondition[],
            stackable: row.stackable === 1,
            max_stacks: row.max_stacks,
            current_stacks: row.current_stacks,
            is_active: row.is_active === 1,
            created_at: row.created_at,
            expires_at: row.expires_at
        });
    }
}
