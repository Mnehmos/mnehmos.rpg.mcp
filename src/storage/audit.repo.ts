import { Database } from 'better-sqlite3';
import { AuditLog, AuditLogSchema } from '../schema/audit.js';

const DEFAULT_MAX_AUDIT_ROWS = 5000;
/** Prune once per this many inserts, so the cost is not paid on every call. */
const PRUNE_EVERY = 100;

function configuredMaxRows(): number {
    const configured = Number.parseInt(process.env.RPG_AUDIT_LOG_MAX_ROWS ?? '', 10);
    return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_AUDIT_ROWS;
}

export interface AuditRepositoryOptions {
    /** Newest rows to keep. Defaults to RPG_AUDIT_LOG_MAX_ROWS, or 5000. */
    maxRows?: number;
}

/**
 * The audit log records every tool call with its arguments and result, so it
 * is the fastest-growing table in a campaign. It is a recent-history aid, not
 * an archive: only the newest rows are kept.
 */
export class AuditRepository {
    private readonly maxRows: number;

    constructor(private db: Database, options: AuditRepositoryOptions = {}) {
        this.maxRows = options.maxRows ?? configuredMaxRows();
    }

    /** Delete everything older than the newest `maxRows` rows. Returns rows removed. */
    prune(): number {
        const info = this.db.prepare(`
            DELETE FROM audit_logs
            WHERE id <= (SELECT MAX(id) FROM audit_logs) - ?
        `).run(this.maxRows);
        return info.changes;
    }

    create(log: Omit<AuditLog, 'id'>): AuditLog {
        // Validate input
        const validated = AuditLogSchema.omit({ id: true }).parse(log);

        const stmt = this.db.prepare(`
            INSERT INTO audit_logs (action, actor_id, target_id, details, timestamp)
            VALUES (@action, @actorId, @targetId, @details, @timestamp)
        `);

        const info = stmt.run({
            action: validated.action,
            actorId: validated.actorId || null,
            targetId: validated.targetId || null,
            details: validated.details ? JSON.stringify(validated.details) : null,
            timestamp: validated.timestamp
        });

        const id = Number(info.lastInsertRowid);
        if (id % PRUNE_EVERY === 0) this.prune();

        return {
            ...validated,
            actorId: validated.actorId ?? null,
            targetId: validated.targetId ?? null,
            id
        };
    }

    list(limit: number = 50): AuditLog[] {
        const stmt = this.db.prepare(`
            SELECT id, action, actor_id as actorId, target_id as targetId, details, timestamp
            FROM audit_logs
            ORDER BY timestamp DESC
            LIMIT ?
        `);

        const rows = stmt.all(limit) as any[];
        console.error(`AuditRepository.list found ${rows.length} rows`);

        return rows.map(row => ({
            id: row.id,
            action: row.action,
            actorId: row.actorId,
            targetId: row.targetId,
            details: row.details ? JSON.parse(row.details) : undefined,
            timestamp: row.timestamp
        }));
    }
}
