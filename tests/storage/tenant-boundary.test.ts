import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
    assertNoLegacyDatabase,
    campaignDbPath,
    closeDb,
    deleteCampaignDatabase,
    getDb,
    listCampaignDatabases,
} from '../../src/storage/index';
import { runInTenant, type TenantContext } from '../../src/storage/tenant-context';

const CAMPAIGN_A = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_B = '22222222-2222-4222-8222-222222222222';

const tenant = (campaignId: string): TenantContext => ({ accountId: 'account-1', campaignId });

describe('tenant boundary guards', () => {
    let dataDir: string;
    let previousDataDir: string | undefined;

    beforeEach(() => {
        closeDb();
        previousDataDir = process.env.RPG_DATA_DIR;
        dataDir = mkdtempSync(join(tmpdir(), 'rpg-boundary-'));
        process.env.RPG_DATA_DIR = dataDir;
    });

    afterEach(() => {
        closeDb();
        if (previousDataDir === undefined) delete process.env.RPG_DATA_DIR;
        else process.env.RPG_DATA_DIR = previousDataDir;
        rmSync(dataDir, { recursive: true, force: true });
    });

    describe('legacy database assertion', () => {
        it('passes when only per-campaign databases exist', () => {
            runInTenant(tenant(CAMPAIGN_A), () => getDb());

            expect(() => assertNoLegacyDatabase()).not.toThrow();
        });

        it.each(['rpg-mcp.db', 'rpg.db'])('refuses to start when %s is still present', (name) => {
            writeFileSync(join(dataDir, name), '');

            // A leftover pre-split file means an incomplete cutover or a
            // rollback-forward. Starting anyway would serve empty campaigns
            // while the real data sat in a file nothing reads.
            expect(() => assertNoLegacyDatabase()).toThrow(/pre-split database/);
        });

        it('names the offending path so the fix is obvious', () => {
            writeFileSync(join(dataDir, 'rpg-mcp.db'), '');

            expect(() => assertNoLegacyDatabase()).toThrow(/rpg-mcp\.db/);
        });
    });

    describe('listing campaign databases', () => {
        it('returns nothing before any campaign exists', () => {
            expect(listCampaignDatabases()).toEqual([]);
        });

        it('reports every campaign present on disk', () => {
            runInTenant(tenant(CAMPAIGN_A), () => getDb());
            runInTenant(tenant(CAMPAIGN_B), () => getDb());

            expect(listCampaignDatabases()).toEqual([CAMPAIGN_A, CAMPAIGN_B]);
        });

        it('ignores files that are not campaign databases', () => {
            runInTenant(tenant(CAMPAIGN_A), () => getDb());
            const shard = join(dataDir, 'campaigns', CAMPAIGN_A.slice(0, 2));
            mkdirSync(shard, { recursive: true });
            writeFileSync(join(shard, 'notes.txt'), '');
            writeFileSync(join(shard, 'not-a-uuid.db'), '');

            expect(listCampaignDatabases()).toEqual([CAMPAIGN_A]);
        });
    });

    describe('deleting a campaign database', () => {
        it('removes the file so the campaign is gone', () => {
            runInTenant(tenant(CAMPAIGN_A), () => getDb());
            expect(existsSync(campaignDbPath(CAMPAIGN_A))).toBe(true);

            expect(deleteCampaignDatabase(CAMPAIGN_A)).toBe(true);

            expect(existsSync(campaignDbPath(CAMPAIGN_A))).toBe(false);
            expect(listCampaignDatabases()).toEqual([]);
        });

        it('removes the WAL and shared-memory sidecars too', () => {
            runInTenant(tenant(CAMPAIGN_A), () => getDb());
            const path = campaignDbPath(CAMPAIGN_A);
            // Release the handle before fabricating sidecars: SQLite keeps -shm
            // mapped while the database is open, and Windows refuses the write.
            closeDb();
            writeFileSync(`${path}-wal`, '');
            writeFileSync(`${path}-shm`, '');

            deleteCampaignDatabase(CAMPAIGN_A);

            // A surviving -wal would let a later open recover rows from the
            // database that was just deleted.
            expect(existsSync(`${path}-wal`)).toBe(false);
            expect(existsSync(`${path}-shm`)).toBe(false);
        });

        it('leaves other campaigns untouched', () => {
            runInTenant(tenant(CAMPAIGN_A), () => getDb());
            runInTenant(tenant(CAMPAIGN_B), () => getDb());

            deleteCampaignDatabase(CAMPAIGN_A);

            expect(listCampaignDatabases()).toEqual([CAMPAIGN_B]);
        });

        it('reports false for a campaign that has no database', () => {
            expect(deleteCampaignDatabase(CAMPAIGN_A)).toBe(false);
        });

        it('rejects a malformed campaign id rather than deleting by path', () => {
            expect(() => deleteCampaignDatabase('../../etc/passwd')).toThrow(/malformed campaign id/);
        });

        it('lets a campaign be recreated cleanly after deletion', () => {
            runInTenant(tenant(CAMPAIGN_A), () => getDb());
            deleteCampaignDatabase(CAMPAIGN_A);

            const reopened = runInTenant(tenant(CAMPAIGN_A), () => getDb());

            // The pooled handle must have been dropped on delete; a stale one
            // would point at an unlinked file.
            expect(reopened.open).toBe(true);
            expect(existsSync(campaignDbPath(CAMPAIGN_A))).toBe(true);
        });
    });
});

describe('structural guard: no path-based database access in production code', () => {
    const SRC = join(__dirname, '..', '..', 'src');
    // storage/index.ts defines getDb and owns the test-only escape hatch.
    const ALLOWED = ['storage\\index.ts', 'storage/index.ts'];

    function sourceFiles(dir: string): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) return sourceFiles(full);
            return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
        });
    }

    it('no module outside storage/index.ts passes an argument to getDb', async () => {
        const { readFile } = await import('node:fs/promises');
        const offenders: string[] = [];

        for (const file of sourceFiles(SRC)) {
            const rel = relative(SRC, file);
            if (ALLOWED.some(a => rel.endsWith(a.replace(/\\/g, '/')) || rel.endsWith(a))) continue;
            const contents = await readFile(file, 'utf8');
            // getDb() is correct; getDb(anything) bypasses tenant resolution.
            if (/getDb\(\s*[^)\s]/.test(contents)) offenders.push(rel);
        }

        // This is the rule a future contributor is most likely to break by
        // habit, and it would silently reattach a caller to a database chosen
        // without a verified tenant.
        expect(offenders).toEqual([]);
    });
});
