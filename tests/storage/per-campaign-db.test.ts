import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { campaignDbPath, closeDb, getDb } from '../../src/storage/index';
import { runInTenant, type TenantContext } from '../../src/storage/tenant-context';
import { CharacterRepository } from '../../src/storage/repos/character.repo';
import type { Character } from '../../src/schema/character';
import { FIXED_TIMESTAMP } from '../fixtures.js';

const CAMPAIGN_A = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_B = '22222222-2222-4222-8222-222222222222';

const tenant = (campaignId: string, accountId = 'account-1'): TenantContext => ({ accountId, campaignId });

const character = (id: string, name: string): Character => ({
    id,
    name,
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    hp: 10, maxHp: 10, ac: 10, level: 1,
    createdAt: FIXED_TIMESTAMP, updatedAt: FIXED_TIMESTAMP,
} as Character);

describe('per-campaign database resolution', () => {
    let dataDir: string;
    let previousDataDir: string | undefined;

    beforeEach(() => {
        closeDb();
        previousDataDir = process.env.RPG_DATA_DIR;
        dataDir = mkdtempSync(join(tmpdir(), 'rpg-tenant-'));
        process.env.RPG_DATA_DIR = dataDir;
    });

    afterEach(() => {
        closeDb();
        if (previousDataDir === undefined) delete process.env.RPG_DATA_DIR;
        else process.env.RPG_DATA_DIR = previousDataDir;
        rmSync(dataDir, { recursive: true, force: true });
    });

    it('gives two campaigns two different files on disk', () => {
        runInTenant(tenant(CAMPAIGN_A), () => getDb());
        runInTenant(tenant(CAMPAIGN_B), () => getDb());

        expect(campaignDbPath(CAMPAIGN_A)).not.toBe(campaignDbPath(CAMPAIGN_B));
        expect(existsSync(campaignDbPath(CAMPAIGN_A))).toBe(true);
        expect(existsSync(campaignDbPath(CAMPAIGN_B))).toBe(true);
    });

    it("does not expose one campaign's rows to another", () => {
        runInTenant(tenant(CAMPAIGN_A), () => {
            new CharacterRepository(getDb()).create(character('char-a', 'Alice'));
        });

        const seenFromB = runInTenant(tenant(CAMPAIGN_B), () =>
            new CharacterRepository(getDb()).findAll()
        );

        // findAll() issues an unscoped `SELECT * FROM characters`. That is the
        // point: the query cannot leak, because the row is not in this file.
        expect(seenFromB).toEqual([]);
    });

    it("still returns a campaign's own rows", () => {
        runInTenant(tenant(CAMPAIGN_A), () => {
            new CharacterRepository(getDb()).create(character('char-a', 'Alice'));
        });

        const seenFromA = runInTenant(tenant(CAMPAIGN_A), () =>
            new CharacterRepository(getDb()).findAll().map(c => c.name)
        );

        expect(seenFromA).toEqual(['Alice']);
    });

    it('isolates campaigns even for the same account', () => {
        runInTenant(tenant(CAMPAIGN_A, 'shared-account'), () => {
            new CharacterRepository(getDb()).create(character('char-a', 'Alice'));
        });

        const seenFromB = runInTenant(tenant(CAMPAIGN_B, 'shared-account'), () =>
            new CharacterRepository(getDb()).findAll()
        );

        // A leak between one user's own campaigns is a correctness bug rather
        // than a breach, but the boundary is the same line either way.
        expect(seenFromB).toEqual([]);
    });

    it('reuses one handle for repeated access to the same campaign', () => {
        const first = runInTenant(tenant(CAMPAIGN_A), () => getDb());
        const second = runInTenant(tenant(CAMPAIGN_A), () => getDb());

        expect(second).toBe(first);
    });

    it('refuses to open a database with no verified tenant in scope', () => {
        expect(() => getDb()).toThrow(/No tenant context in scope/);
    });

    it.each([
        ['path traversal', '../../../etc/passwd'],
        ['separator', 'campaigns/../secret'],
        ['not a uuid', 'not-a-uuid'],
        ['empty', ''],
    ])('refuses a malformed campaign id (%s)', (_label, campaignId) => {
        // The id becomes a path segment, so it is validated rather than
        // sanitized — a rejected id is a bug or an attack, and neither should
        // be repaired into something that opens a file.
        expect(() => runInTenant(tenant(campaignId), () => getDb())).toThrow(/malformed campaign id/);
    });

    it('keeps concurrent campaigns on their own database across await points', async () => {
        const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

        const write = (campaignId: string, name: string) =>
            runInTenant(tenant(campaignId), async () => {
                await tick();
                new CharacterRepository(getDb()).create(character(`char-${name}`, name));
                await tick();
                return new CharacterRepository(getDb()).findAll().map(c => c.name);
            });

        const [a, b] = await Promise.all([write(CAMPAIGN_A, 'Alice'), write(CAMPAIGN_B, 'Bob')]);

        expect(a).toEqual(['Alice']);
        expect(b).toEqual(['Bob']);
    });
});
