import Database from 'better-sqlite3';
import { CalculationResult, CalculationResultSchema } from '../../math/schemas';

interface CalculationRow {
    id: string;
    session_id: string | null;
    input: string;
    result: string; // JSON or string
    steps: string | null; // JSON array
    seed: string | null;
    timestamp: string;
    metadata: string | null; // JSON
}

export type StoredCalculation = CalculationResult & { id: string; sessionId?: string };

export class CalculationRepository {
    constructor(private db: Database.Database) { }

    create(calculation: StoredCalculation): void {
        const stmt = this.db.prepare(`
      INSERT INTO calculations (id, session_id, input, result, steps, seed, timestamp, metadata)
      VALUES (@id, @sessionId, @input, @result, @steps, @seed, @timestamp, @metadata)
    `);

        stmt.run({
            id: calculation.id,
            sessionId: calculation.sessionId || null,
            input: calculation.input,
            result: JSON.stringify(calculation.result),
            steps: calculation.steps ? JSON.stringify(calculation.steps) : null,
            seed: calculation.seed || null,
            timestamp: calculation.timestamp,
            metadata: calculation.metadata ? JSON.stringify(calculation.metadata) : null,
        });
    }

    findById(id: string): StoredCalculation | null {
        const stmt = this.db.prepare('SELECT * FROM calculations WHERE id = ?');
        const row = stmt.get(id) as CalculationRow | undefined;

        if (!row) return null;

        return this.rowToCalculation(row);
    }

    findBySessionId(sessionId: string): StoredCalculation[] {
        const stmt = this.db.prepare('SELECT * FROM calculations WHERE session_id = ? ORDER BY timestamp DESC');
        const rows = stmt.all(sessionId) as CalculationRow[];

        return rows.map(row => this.rowToCalculation(row));
    }

    findAll(limit: number = 50): StoredCalculation[] {
        const stmt = this.db.prepare('SELECT * FROM calculations ORDER BY timestamp DESC LIMIT ?');
        const rows = stmt.all(limit) as CalculationRow[];

        return rows.map(row => this.rowToCalculation(row));
    }

    private rowToCalculation(row: CalculationRow): StoredCalculation {
        let result: number | string;
        try {
            result = JSON.parse(row.result);
        } catch {
            // Fallback for legacy or raw string data if any
            result = row.result;
        }

        return {
            id: row.id,
            sessionId: row.session_id || undefined,
            ...CalculationResultSchema.parse({
                input: row.input,
                result: result,
                steps: row.steps ? JSON.parse(row.steps) : [],
                timestamp: row.timestamp,
                seed: row.seed || undefined,
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            }),
        };
    }
}
