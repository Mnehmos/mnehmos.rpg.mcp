import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { campaignDbPath, closeDb, getDb, initDB } from '../../src/storage/index';
import { runInTenant } from '../../src/storage/tenant-context';

const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const tenant = { accountId: 'account-1', campaignId: CAMPAIGN };

/** Build a real database, then overwrite pages in the middle of the file. */
function writeCorruptDatabase(path: string): void {
    const db = new Database(path);
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
    const insert = db.prepare('INSERT INTO notes (body) VALUES (?)');
    for (let i = 0; i < 2000; i++) insert.run(`note ${i} `.repeat(20));
    db.close();

    const bytes = readFileSync(path);
    bytes.fill(0xff, 4096 * 2, 4096 * 6);
    writeFileSync(path, bytes);
}

describe('a corrupted database', () => {
    let dataDir: string;
    let previousDataDir: string | undefined;

    beforeEach(() => {
        closeDb();
        previousDataDir = process.env.RPG_DATA_DIR;
        dataDir = mkdtempSync(join(tmpdir(), 'rpg-corrupt-'));
        process.env.RPG_DATA_DIR = dataDir;
    });

    afterEach(() => {
        closeDb();
        if (previousDataDir === undefined) delete process.env.RPG_DATA_DIR;
        else process.env.RPG_DATA_DIR = previousDataDir;
        rmSync(dataDir, { recursive: true, force: true });
    });

    it('is refused for a hosted campaign, not silently replaced with an empty one', () => {
        const path = campaignDbPath(CAMPAIGN);
        runInTenant(tenant, () => getDb());
        closeDb();
        rmSync(path);
        rmSync(`${path}-wal`, { force: true });
        rmSync(`${path}-shm`, { force: true });
        writeCorruptDatabase(path);
        const sizeBefore = statSync(path).size;

        expect(() => runInTenant(tenant, () => getDb())).toThrow(/integrity|corrupt|malformed/i);

        // The damaged file stays exactly where it was for an operator to recover.
        expect(statSync(path).size).toBe(sizeBefore);
        expect(readdirSync(dirname(path)).filter(name => name.includes('.corrupt-'))).toEqual([]);

        // And it keeps being refused: no later request gets a blank campaign.
        expect(() => runInTenant(tenant, () => getDb())).toThrow(/integrity|corrupt|malformed/i);
    });

    it('is still quarantined and replaced for a local single-user database', () => {
        const path = join(dataDir, 'local.db');
        writeCorruptDatabase(path);

        const db = initDB(path);
        expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        db.close();

        expect(readdirSync(dataDir).filter(name => name.includes('.corrupt-'))).toHaveLength(1);
    });
});
