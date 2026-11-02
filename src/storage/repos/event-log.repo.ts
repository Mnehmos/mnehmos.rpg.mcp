import Database from 'better-sqlite3';

/**
 * The one writer of `event_logs`.
 *
 * perception_manage and math_manage each used to carry their own INSERT. Two
 * copies of the column list is how a field quietly stops persisting (#81), so
 * the row shape now lives in one place.
 */
export class EventLogRepository {
    constructor(private db: Database.Database) { }

    append(type: string, payload: Record<string, unknown>, timestamp: string = new Date().toISOString()): number {
        const result = this.db.prepare(`
            INSERT INTO event_logs (type, payload, timestamp)
            VALUES (?, ?, ?)
        `).run(type, JSON.stringify(payload), timestamp);
        return Number(result.lastInsertRowid);
    }
}
