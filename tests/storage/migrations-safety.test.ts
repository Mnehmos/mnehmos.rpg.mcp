import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/storage/migrations';

const tables = (db: Database.Database): string[] =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(r => r.name);

describe('migrations', () => {
    // migrate() runs every time a campaign database is opened: on a restart, a
    // deploy, or when the handle comes back after being evicted from the pool.
    // It must not change game state on those runs.
    it('does not move a party that has no map position when the database is reopened', () => {
        const db = new Database(':memory:');
        migrate(db);
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO parties (id, name, status, formation, created_at, updated_at)
                    VALUES ('p1', 'Unplaced', 'active', 'standard', ?, ?)`).run(now, now);

        migrate(db); // the next open

        expect(db.prepare('SELECT position_x, position_y FROM parties WHERE id = ?').get('p1'))
            .toEqual({ position_x: null, position_y: null });
    });

    it('still gives legacy parties a position when the column is first added', () => {
        const db = new Database(':memory:');
        // A database from before parties had a position.
        db.exec(`CREATE TABLE parties (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, world_id TEXT,
            status TEXT NOT NULL DEFAULT 'active', current_location TEXT, current_quest_id TEXT,
            formation TEXT NOT NULL DEFAULT 'standard',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_played_at TEXT)`);
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO parties (id, name, created_at, updated_at) VALUES ('old', 'Old Guard', ?, ?)`).run(now, now);

        migrate(db);

        expect(db.prepare('SELECT position_x, position_y FROM parties WHERE id = ?').get('old'))
            .toEqual({ position_x: 50, position_y: 50 });
    });

    it('applies all of its changes or none of them', () => {
        const db = new Database(':memory:');
        // A view squatting on a table name makes a later step fail part-way through.
        db.exec('CREATE VIEW node_networks AS SELECT 1 AS id');

        expect(() => migrate(db)).toThrow();

        expect(tables(db)).toEqual([]);
    });

    it('is safe to run repeatedly', () => {
        const db = new Database(':memory:');
        migrate(db);
        const before = tables(db).sort();
        migrate(db);
        migrate(db);
        expect(tables(db).sort()).toEqual(before);
    });
});
