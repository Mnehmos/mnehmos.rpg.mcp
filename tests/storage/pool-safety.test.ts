import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { campaignDbPath, closeDb, eraseCampaignDatabase, getDb } from '../../src/storage/index';
import { runInTenant } from '../../src/storage/tenant-context';
import { atomic } from '../../src/storage/unit-of-work';

const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const tenant = (n: number) => ({ accountId: 'account-1', campaignId: id(n) });
const open = (n: number) => runInTenant(tenant(n), () => getDb());

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
}

/**
 * A handle with a call in flight belongs to that call. Closing it underneath
 * the call — to make room in the pool, or to erase the campaign — fails the
 * call halfway through its transaction.
 */
describe('campaign handle pool safety', () => {
    let dataDir: string;
    let previous: Record<string, string | undefined>;

    beforeEach(() => {
        closeDb();
        previous = { dir: process.env.RPG_DATA_DIR, cap: process.env.RPG_MAX_OPEN_DATABASES };
        dataDir = mkdtempSync(join(tmpdir(), 'rpg-pool-'));
        process.env.RPG_DATA_DIR = dataDir;
        process.env.RPG_MAX_OPEN_DATABASES = '2';
    });

    afterEach(() => {
        closeDb();
        for (const [key, name] of [['dir', 'RPG_DATA_DIR'], ['cap', 'RPG_MAX_OPEN_DATABASES']] as const) {
            if (previous[key] === undefined) delete process.env[name];
            else process.env[name] = previous[key];
        }
        rmSync(dataDir, { recursive: true, force: true });
    });

    it('still evicts the least recently used idle handle at the cap', () => {
        const first = open(1);
        open(2);
        open(3);
        expect(first.open).toBe(false);
    });

    it('never evicts a handle while a call is running on it', async () => {
        const gate = deferred();
        let busyHandle!: ReturnType<typeof getDb>;

        const call = runInTenant(tenant(1), () => atomic(async () => {
            busyHandle = getDb();
            busyHandle.exec('CREATE TABLE IF NOT EXISTS probe (v TEXT)');
            busyHandle.prepare('INSERT INTO probe (v) VALUES (?)').run('kept');
            await gate.promise; // e.g. waiting on an LLM provider
            return busyHandle.prepare('SELECT v FROM probe').get() as { v: string };
        }));
        await new Promise(resolve => setImmediate(resolve));

        // Three other campaigns arrive; the pool cap is two.
        open(2);
        open(3);
        open(4);
        expect(busyHandle.open).toBe(true);

        gate.resolve();
        await expect(call).resolves.toEqual({ v: 'kept' });

        // The write committed and is there for the next call.
        expect(open(1).prepare('SELECT v FROM probe').get()).toEqual({ v: 'kept' });
    });

    it('erasing a campaign waits for the call in flight instead of closing its handle', async () => {
        const gate = deferred();
        let finished = false;

        const call = runInTenant(tenant(1), () => atomic(async () => {
            const db = getDb();
            db.exec('CREATE TABLE IF NOT EXISTS probe (v TEXT)');
            await gate.promise;
            db.prepare('INSERT INTO probe (v) VALUES (?)').run('last write');
            finished = true;
            return 'done';
        }));
        await new Promise(resolve => setImmediate(resolve));

        const erased = eraseCampaignDatabase(id(1));
        await new Promise(resolve => setImmediate(resolve));
        expect(existsSync(campaignDbPath(id(1)))).toBe(true);

        gate.resolve();
        await expect(call).resolves.toBe('done');
        await expect(erased).resolves.toBe(true);
        expect(finished).toBe(true);
        expect(existsSync(campaignDbPath(id(1)))).toBe(false);
    });

    it('erases an idle campaign straight away', async () => {
        open(1);
        await expect(eraseCampaignDatabase(id(1))).resolves.toBe(true);
        expect(existsSync(campaignDbPath(id(1)))).toBe(false);
        await expect(eraseCampaignDatabase(id(1))).resolves.toBe(false);
    });
});
