import Database from 'better-sqlite3';
import { TurnAction } from '../../schema/turn-state.js';

export interface QueuedTurnActions {
    id: string;
    worldId: string;
    turnNumber: number;
    nationId: string;
    actions: TurnAction[];
    createdAt: string;
    resolvedAt?: string;
}

interface QueuedTurnActionsRow {
    id: string;
    world_id: string;
    turn_number: number;
    nation_id: string;
    actions: string;
    created_at: string;
    resolved_at: string | null;
}

/** Durable planning-phase action queue; resolution is the only mutation path. */
export class TurnActionRepository {
    public constructor(private readonly db: Database.Database) {}

    public upsert(input: {
        id: string;
        worldId: string;
        turnNumber: number;
        nationId: string;
        actions: TurnAction[];
        createdAt: string;
    }): void {
        this.db.prepare(`
            INSERT INTO turn_actions (id, world_id, turn_number, nation_id, actions, created_at, resolved_at)
            VALUES (@id, @worldId, @turnNumber, @nationId, @actions, @createdAt, NULL)
            ON CONFLICT(world_id, turn_number, nation_id) DO UPDATE SET
                id = excluded.id,
                actions = excluded.actions,
                created_at = excluded.created_at,
                resolved_at = NULL
        `).run({
            ...input,
            actions: JSON.stringify(input.actions),
        });
    }

    public findPending(worldId: string, turnNumber: number): QueuedTurnActions[] {
        const rows = this.db.prepare(`
            SELECT * FROM turn_actions
            WHERE world_id = ? AND turn_number = ? AND resolved_at IS NULL
            ORDER BY created_at, nation_id
        `).all(worldId, turnNumber) as QueuedTurnActionsRow[];
        return rows.map(row => this.mapRow(row));
    }

    public markResolved(worldId: string, turnNumber: number, resolvedAt = new Date().toISOString()): void {
        this.db.prepare(`
            UPDATE turn_actions
            SET resolved_at = ?
            WHERE world_id = ? AND turn_number = ? AND resolved_at IS NULL
        `).run(resolvedAt, worldId, turnNumber);
    }

    private mapRow(row: QueuedTurnActionsRow): QueuedTurnActions {
        return {
            id: row.id,
            worldId: row.world_id,
            turnNumber: row.turn_number,
            nationId: row.nation_id,
            actions: JSON.parse(row.actions) as TurnAction[],
            createdAt: row.created_at,
            resolvedAt: row.resolved_at ?? undefined,
        };
    }
}
