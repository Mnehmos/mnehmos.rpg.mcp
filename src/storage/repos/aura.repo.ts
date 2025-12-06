import Database from 'better-sqlite3';
import { AuraState, AuraStateSchema } from '../../schema/aura.js';

export class AuraRepository {
    constructor(private db: Database.Database) { }

    /**
     * Create a new aura
     */
    create(aura: AuraState): void {
        const valid = AuraStateSchema.parse(aura);

        const stmt = this.db.prepare(`
            INSERT INTO auras (
                id, owner_id, spell_name, spell_level, radius,
                affects_allies, affects_enemies, affects_self,
                effects, started_at, max_duration, requires_concentration
            )
            VALUES (@id, @ownerId, @spellName, @spellLevel, @radius,
                    @affectsAllies, @affectsEnemies, @affectsSelf,
                    @effects, @startedAt, @maxDuration, @requiresConcentration)
        `);

        stmt.run({
            id: valid.id,
            ownerId: valid.ownerId,
            spellName: valid.spellName,
            spellLevel: valid.spellLevel,
            radius: valid.radius,
            affectsAllies: valid.affectsAllies ? 1 : 0,
            affectsEnemies: valid.affectsEnemies ? 1 : 0,
            affectsSelf: valid.affectsSelf ? 1 : 0,
            effects: JSON.stringify(valid.effects),
            startedAt: valid.startedAt,
            maxDuration: valid.maxDuration ?? null,
            requiresConcentration: valid.requiresConcentration ? 1 : 0,
        });
    }

    /**
     * Find an aura by ID
     */
    findById(auraId: string): AuraState | null {
        const stmt = this.db.prepare(`
            SELECT * FROM auras WHERE id = ?
        `);
        const row = stmt.get(auraId) as AuraRow | undefined;

        if (!row) return null;

        return this.rowToAuraState(row);
    }

    /**
     * Find all auras owned by a specific character
     */
    findByOwnerId(ownerId: string): AuraState[] {
        const stmt = this.db.prepare(`
            SELECT * FROM auras WHERE owner_id = ?
        `);
        const rows = stmt.all(ownerId) as AuraRow[];

        return rows.map(row => this.rowToAuraState(row));
    }

    /**
     * Find all active auras (for an encounter or global check)
     */
    findAll(): AuraState[] {
        const stmt = this.db.prepare(`SELECT * FROM auras`);
        const rows = stmt.all() as AuraRow[];

        return rows.map(row => this.rowToAuraState(row));
    }

    /**
     * Delete an aura by ID
     */
    delete(auraId: string): boolean {
        const stmt = this.db.prepare(`
            DELETE FROM auras WHERE id = ?
        `);
        const result = stmt.run(auraId);
        return result.changes > 0;
    }

    /**
     * Delete all auras owned by a character
     */
    deleteByOwnerId(ownerId: string): number {
        const stmt = this.db.prepare(`
            DELETE FROM auras WHERE owner_id = ?
        `);
        const result = stmt.run(ownerId);
        return result.changes;
    }

    /**
     * Check if a character has any active auras
     */
    hasActiveAuras(ownerId: string): boolean {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM auras WHERE owner_id = ?
        `);
        const row = stmt.get(ownerId) as { count: number };
        return row.count > 0;
    }

    /**
     * Convert database row to AuraState
     */
    private rowToAuraState(row: AuraRow): AuraState {
        return AuraStateSchema.parse({
            id: row.id,
            ownerId: row.owner_id,
            spellName: row.spell_name,
            spellLevel: row.spell_level,
            radius: row.radius,
            affectsAllies: row.affects_allies === 1,
            affectsEnemies: row.affects_enemies === 1,
            affectsSelf: row.affects_self === 1,
            effects: JSON.parse(row.effects),
            startedAt: row.started_at,
            maxDuration: row.max_duration ?? undefined,
            requiresConcentration: row.requires_concentration === 1,
        });
    }
}

interface AuraRow {
    id: string;
    owner_id: string;
    spell_name: string;
    spell_level: number;
    radius: number;
    affects_allies: number;
    affects_enemies: number;
    affects_self: number;
    effects: string;
    started_at: number;
    max_duration: number | null;
    requires_concentration: number;
}
