import Database from 'better-sqlite3';
import { ConcentrationState, ConcentrationStateSchema } from '../../schema/concentration.js';

export class ConcentrationRepository {
    constructor(private db: Database.Database) { }

    /**
     * Start concentration on a spell
     */
    create(concentration: ConcentrationState): void {
        const valid = ConcentrationStateSchema.parse(concentration);

        const stmt = this.db.prepare(`
            INSERT INTO concentration (
                character_id, active_spell, spell_level, target_ids,
                started_at, max_duration, save_dc_base
            )
            VALUES (@characterId, @activeSpell, @spellLevel, @targetIds,
                    @startedAt, @maxDuration, @saveDCBase)
        `);

        stmt.run({
            characterId: valid.characterId,
            activeSpell: valid.activeSpell,
            spellLevel: valid.spellLevel,
            targetIds: valid.targetIds ? JSON.stringify(valid.targetIds) : null,
            startedAt: valid.startedAt,
            maxDuration: valid.maxDuration ?? null,
            saveDCBase: valid.saveDCBase,
        });
    }

    /**
     * Get active concentration for a character
     */
    findByCharacterId(characterId: string): ConcentrationState | null {
        const stmt = this.db.prepare(`
            SELECT * FROM concentration WHERE character_id = ?
        `);
        const row = stmt.get(characterId) as ConcentrationRow | undefined;

        if (!row) return null;

        return ConcentrationStateSchema.parse({
            characterId: row.character_id,
            activeSpell: row.active_spell,
            spellLevel: row.spell_level,
            targetIds: row.target_ids ? JSON.parse(row.target_ids) : undefined,
            startedAt: row.started_at,
            maxDuration: row.max_duration ?? undefined,
            saveDCBase: row.save_dc_base,
        });
    }

    /**
     * Break concentration (delete the record)
     */
    delete(characterId: string): boolean {
        const stmt = this.db.prepare(`
            DELETE FROM concentration WHERE character_id = ?
        `);
        const result = stmt.run(characterId);
        return result.changes > 0;
    }

    /**
     * Check if a character is concentrating
     */
    isConcentrating(characterId: string): boolean {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM concentration WHERE character_id = ?
        `);
        const row = stmt.get(characterId) as { count: number };
        return row.count > 0;
    }

    /**
     * Get all active concentrations (for debugging/admin)
     */
    findAll(): ConcentrationState[] {
        const stmt = this.db.prepare(`SELECT * FROM concentration`);
        const rows = stmt.all() as ConcentrationRow[];

        return rows.map(row => ConcentrationStateSchema.parse({
            characterId: row.character_id,
            activeSpell: row.active_spell,
            spellLevel: row.spell_level,
            targetIds: row.target_ids ? JSON.parse(row.target_ids) : undefined,
            startedAt: row.started_at,
            maxDuration: row.max_duration ?? undefined,
            saveDCBase: row.save_dc_base,
        }));
    }
}

interface ConcentrationRow {
    character_id: string;
    active_spell: string;
    spell_level: number;
    target_ids: string | null;
    started_at: number;
    max_duration: number | null;
    save_dc_base: number;
}
