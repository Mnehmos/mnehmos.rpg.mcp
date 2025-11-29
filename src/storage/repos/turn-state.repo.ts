import Database from 'better-sqlite3';
import { TurnState, TurnStateSchema } from '../../schema/turn-state.js';

interface TurnStateRow {
    world_id: string;
    current_turn: number;
    turn_phase: string;
    phase_started_at: string;
    nations_ready: string;
    created_at: string;
    updated_at: string;
}

export class TurnStateRepository {
    constructor(private db: Database.Database) { }

    create(turnState: TurnState): void {
        const valid = TurnStateSchema.parse(turnState);
        const stmt = this.db.prepare(`
            INSERT INTO turn_state (world_id, current_turn, turn_phase, phase_started_at, nations_ready, created_at, updated_at)
            VALUES (@worldId, @currentTurn, @turnPhase, @phaseStartedAt, @nationsReady, @createdAt, @updatedAt)
        `);
        stmt.run({
            ...valid,
            worldId: valid.worldId,
            currentTurn: valid.currentTurn,
            turnPhase: valid.turnPhase,
            phaseStartedAt: valid.phaseStartedAt,
            nationsReady: JSON.stringify(valid.nationsReady),
        });
    }

    findByWorldId(worldId: string): TurnState | null {
        const stmt = this.db.prepare('SELECT * FROM turn_state WHERE world_id = ?');
        const row = stmt.get(worldId) as TurnStateRow | undefined;
        if (!row) return null;
        return this.mapRowToTurnState(row);
    }

    updatePhase(worldId: string, phase: 'planning' | 'resolution' | 'finished'): void {
        const stmt = this.db.prepare(`
            UPDATE turn_state 
            SET turn_phase = ?, phase_started_at = ?, updated_at = ?
            WHERE world_id = ?
        `);
        const now = new Date().toISOString();
        stmt.run(phase, now, now, worldId);
    }

    addReadyNation(worldId: string, nationId: string): void {
        const current = this.findByWorldId(worldId);
        if (!current) throw new Error('Turn state not found');
        if (current.nationsReady.includes(nationId)) return; // Already ready

        const updated = [...current.nationsReady, nationId];
        const stmt = this.db.prepare(`
            UPDATE turn_state 
            SET nations_ready = ?, updated_at = ?
            WHERE world_id = ?
        `);
        stmt.run(JSON.stringify(updated), new Date().toISOString(), worldId);
    }

    clearReadyNations(worldId: string): void {
        const stmt = this.db.prepare(`
            UPDATE turn_state 
            SET nations_ready = '[]', updated_at = ?
            WHERE world_id = ?
        `);
        stmt.run(new Date().toISOString(), worldId);
    }

    incrementTurn(worldId: string): void {
        const stmt = this.db.prepare(`
            UPDATE turn_state 
            SET current_turn = current_turn + 1, updated_at = ?
            WHERE world_id = ?
        `);
        stmt.run(new Date().toISOString(), worldId);
    }

    private mapRowToTurnState(row: TurnStateRow): TurnState {
        return TurnStateSchema.parse({
            worldId: row.world_id,
            currentTurn: row.current_turn,
            turnPhase: row.turn_phase,
            phaseStartedAt: row.phase_started_at,
            nationsReady: JSON.parse(row.nations_ready),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        });
    }
}
