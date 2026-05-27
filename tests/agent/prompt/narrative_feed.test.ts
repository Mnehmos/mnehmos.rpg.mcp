import * as fs from 'fs';
import { initDB } from '../../../src/storage/db';
import { migrate } from '../../../src/storage/migrations';
import { CharacterRepository } from '../../../src/storage/repos/character.repo';
import { AgentRepository } from '../../../src/storage/repos/agent.repo';
import { buildNarrativeFeedSlice } from '../../../src/agent/prompt/slices/narrative_feed';
import { Character } from '../../../src/schema/character';
import { FIXED_TIMESTAMP } from '../../fixtures.js';

const TEST_DB = 'test-narrative-feed-slice.db';

function cleanup() {
    for (const s of ['', '-wal', '-shm']) {
        const p = TEST_DB + s;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
}

function char(id: string): Character {
    return {
        id,
        name: 'T',
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: 10, maxHp: 10, ac: 10, level: 1,
        characterType: 'pc',
        createdAt: FIXED_TIMESTAMP, updatedAt: FIXED_TIMESTAMP
    } as Character;
}

describe('buildNarrativeFeedSlice', () => {
    let db: ReturnType<typeof initDB>;
    let chars: CharacterRepository;
    let repo: AgentRepository;
    let agentId: string;

    beforeEach(() => {
        cleanup();
        db = initDB(TEST_DB);
        migrate(db);
        chars = new CharacterRepository(db);
        repo = new AgentRepository(db);
        chars.create(char('c1'));
        agentId = repo.create({ characterId: 'c1', provider: 'openai', model: 'm' }).id;
    });

    afterEach(() => {
        db.close();
        cleanup();
    });

    it('returns null when no narrative feed entries', () => {
        expect(buildNarrativeFeedSlice(agentId, repo)).toBeNull();
    });

    it('includes a single entry with header', () => {
        repo.upsertSlice({ agentId, kind: 'narrative_feed', content: 'You hear footsteps.', label: '2026-01-01T00:00:00Z' });
        const slice = buildNarrativeFeedSlice(agentId, repo)!;
        expect(slice).toContain('--- RECENT OBSERVATIONS (TOLD TO YOU) ---');
        expect(slice).toContain('- You hear footsteps.');
    });

    it('orders entries chronologically (oldest first) at output time', () => {
        repo.upsertSlice({ agentId, kind: 'narrative_feed', content: 'A', label: '2026-01-01T00:00:00Z' });
        repo.upsertSlice({ agentId, kind: 'narrative_feed', content: 'B', label: '2026-01-01T01:00:00Z' });
        repo.upsertSlice({ agentId, kind: 'narrative_feed', content: 'C', label: '2026-01-01T02:00:00Z' });

        const slice = buildNarrativeFeedSlice(agentId, repo)!;
        const aIdx = slice.indexOf('- A');
        const bIdx = slice.indexOf('- B');
        const cIdx = slice.indexOf('- C');
        expect(aIdx).toBeLessThan(bIdx);
        expect(bIdx).toBeLessThan(cIdx);
    });

    it('trims to maxEntries, keeping the newest', () => {
        for (let i = 0; i < 20; i++) {
            const ts = `2026-01-01T${String(i).padStart(2, '0')}:00:00Z`;
            repo.upsertSlice({ agentId, kind: 'narrative_feed', content: `entry-${i}`, label: ts });
        }

        const slice = buildNarrativeFeedSlice(agentId, repo, { maxEntries: 5 })!;
        // Expect last 5 (15..19), oldest first in display: 15,16,17,18,19
        expect(slice).toContain('entry-15');
        expect(slice).toContain('entry-19');
        expect(slice).not.toContain('entry-14');
    });

    it('trims by char budget when smaller than entry budget', () => {
        repo.upsertSlice({ agentId, kind: 'narrative_feed', content: 'x'.repeat(100), label: '2026-01-01T00:00:00Z' });
        repo.upsertSlice({ agentId, kind: 'narrative_feed', content: 'y'.repeat(100), label: '2026-01-01T01:00:00Z' });
        repo.upsertSlice({ agentId, kind: 'narrative_feed', content: 'z'.repeat(100), label: '2026-01-01T02:00:00Z' });

        // Budget of 150 chars should keep at most the newest one
        const slice = buildNarrativeFeedSlice(agentId, repo, { maxChars: 150 })!;
        expect(slice).toContain('z'.repeat(100));
        expect(slice).not.toContain('x'.repeat(100));
    });
});
