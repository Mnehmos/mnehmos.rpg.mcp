import * as fs from 'fs';
import { initDB } from '../../src/storage/db';
import { migrate } from '../../src/storage/migrations';
import { CharacterRepository } from '../../src/storage/repos/character.repo';
import { AgentRepository } from '../../src/storage/repos/agent.repo';
import { Character } from '../../src/schema/character';
import { FIXED_TIMESTAMP } from '../fixtures.js';

const TEST_DB_PATH = 'test-agent-repo.db';

function cleanup() {
    for (const suffix of ['', '-wal', '-shm']) {
        const p = TEST_DB_PATH + suffix;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
}

function makeCharacter(id: string): Character {
    return {
        id,
        name: `Char-${id}`,
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: 20,
        maxHp: 20,
        ac: 15,
        level: 1,
        characterType: 'pc',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP
    };
}

describe('AgentRepository', () => {
    let db: ReturnType<typeof initDB>;
    let repo: AgentRepository;
    let chars: CharacterRepository;

    beforeEach(() => {
        cleanup();
        db = initDB(TEST_DB_PATH);
        migrate(db);
        repo = new AgentRepository(db);
        chars = new CharacterRepository(db);
    });

    afterEach(() => {
        db.close();
        cleanup();
    });

    // ───────────────────── agents CRUD ─────────────────────

    describe('agent CRUD', () => {
        it('creates an agent bound to a character', () => {
            chars.create(makeCharacter('char-1'));

            const agent = repo.create({
                characterId: 'char-1',
                provider: 'openai',
                model: 'gpt-4o-mini'
            });

            expect(agent.characterId).toBe('char-1');
            expect(agent.provider).toBe('openai');
            expect(agent.model).toBe('gpt-4o-mini');
            expect(agent.status).toBe('active');
            expect(agent.autoOnTurn).toBe(false);
            expect(agent.circuitState).toBe('closed');
            expect(agent.consecutiveFailures).toBe(0);
            expect(agent.tokensUsed).toBe(0);
        });

        it('honors all create options', () => {
            chars.create(makeCharacter('char-1'));

            const agent = repo.create({
                characterId: 'char-1',
                provider: 'openrouter',
                model: 'anthropic/claude-sonnet-4-5',
                autoOnTurn: true,
                temperature: 0.3,
                maxTokens: 1200,
                budgetTokens: 50000,
                timeoutMs: 30000
            });

            expect(agent.autoOnTurn).toBe(true);
            expect(agent.temperature).toBe(0.3);
            expect(agent.maxTokens).toBe(1200);
            expect(agent.budgetTokens).toBe(50000);
            expect(agent.timeoutMs).toBe(30000);
        });

        it('finds agent by id and by characterId', () => {
            chars.create(makeCharacter('char-1'));
            const agent = repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });

            expect(repo.findById(agent.id)?.id).toBe(agent.id);
            expect(repo.findByCharacterId('char-1')?.id).toBe(agent.id);
            expect(repo.findById('nonexistent')).toBeNull();
            expect(repo.findByCharacterId('nonexistent')).toBeNull();
        });

        it('lists agents and filters by status / autoOnTurn', () => {
            chars.create(makeCharacter('char-1'));
            chars.create(makeCharacter('char-2'));
            chars.create(makeCharacter('char-3'));

            repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini', autoOnTurn: true });
            repo.create({ characterId: 'char-2', provider: 'openai', model: 'gpt-4o-mini', autoOnTurn: false });
            const a3 = repo.create({ characterId: 'char-3', provider: 'openai', model: 'gpt-4o-mini', autoOnTurn: true });
            repo.update(a3.id, { status: 'paused' });

            expect(repo.list().length).toBe(3);
            expect(repo.list({ autoOnTurn: true }).length).toBe(2);
            expect(repo.list({ autoOnTurn: false }).length).toBe(1);
            expect(repo.list({ status: 'paused' }).length).toBe(1);
            expect(repo.list({ status: 'active', autoOnTurn: true }).length).toBe(1);
        });

        it('updates only provided fields', () => {
            chars.create(makeCharacter('char-1'));
            const agent = repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });

            const updated = repo.update(agent.id, { model: 'gpt-4o', temperature: 1.1, autoOnTurn: true });
            expect(updated?.model).toBe('gpt-4o');
            expect(updated?.temperature).toBe(1.1);
            expect(updated?.autoOnTurn).toBe(true);
            expect(updated?.provider).toBe('openai'); // unchanged
        });

        it('returns null when updating a missing agent', () => {
            expect(repo.update('nope', { model: 'x' })).toBeNull();
        });

        it('deletes an agent', () => {
            chars.create(makeCharacter('char-1'));
            const agent = repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });

            expect(repo.delete(agent.id)).toBe(true);
            expect(repo.findById(agent.id)).toBeNull();
            expect(repo.delete(agent.id)).toBe(false);
        });

        it('cascade-deletes when character is removed', () => {
            chars.create(makeCharacter('char-1'));
            const agent = repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });

            chars.delete('char-1');
            expect(repo.findById(agent.id)).toBeNull();
        });

        it('increments tokens_used', () => {
            chars.create(makeCharacter('char-1'));
            const agent = repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });

            repo.incrementTokensUsed(agent.id, 250);
            repo.incrementTokensUsed(agent.id, 100);
            expect(repo.findById(agent.id)?.tokensUsed).toBe(350);
        });
    });

    // ───────────────────── slices ─────────────────────

    describe('slices', () => {
        function setup() {
            chars.create(makeCharacter('char-1'));
            return repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });
        }

        it('upserts a slice (insert path)', () => {
            const agent = setup();
            const slice = repo.upsertSlice({
                agentId: agent.id,
                kind: 'persona',
                content: 'You are Kara.'
            });

            expect(slice.kind).toBe('persona');
            expect(slice.content).toBe('You are Kara.');
            expect(slice.enabled).toBe(true);
            expect(slice.orderIndex).toBe(0);
        });

        it('assigns increasing order_index across slice kinds', () => {
            const agent = setup();
            const a = repo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'A' });
            const b = repo.upsertSlice({ agentId: agent.id, kind: 'directive', content: 'B' });
            const c = repo.upsertSlice({ agentId: agent.id, kind: 'secrets', content: 'C' });
            expect(a.orderIndex).toBe(0);
            expect(b.orderIndex).toBe(1);
            expect(c.orderIndex).toBe(2);
        });

        it('upserts updates an existing slice with same kind+null-label', () => {
            const agent = setup();
            const first = repo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'v1' });
            const second = repo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'v2' });
            expect(first.id).toBe(second.id);
            expect(second.content).toBe('v2');

            const listed = repo.listSlices(agent.id, { kind: 'persona' });
            expect(listed.length).toBe(1);
        });

        it('treats different labels as different slices (narrative_feed append-only)', () => {
            const agent = setup();
            const a = repo.upsertSlice({ agentId: agent.id, kind: 'narrative_feed', content: 'obs 1', label: 't=1' });
            const b = repo.upsertSlice({ agentId: agent.id, kind: 'narrative_feed', content: 'obs 2', label: 't=2' });
            expect(a.id).not.toBe(b.id);
            expect(repo.listSlices(agent.id, { kind: 'narrative_feed' }).length).toBe(2);
        });

        it('toggles a slice enabled/disabled', () => {
            const agent = setup();
            const slice = repo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'x' });

            expect(repo.toggleSlice(slice.id, false)).toBe(true);
            expect(repo.findSliceById(slice.id)?.enabled).toBe(false);

            expect(repo.toggleSlice(slice.id, true)).toBe(true);
            expect(repo.findSliceById(slice.id)?.enabled).toBe(true);
        });

        it('lists slices with enabled filter', () => {
            const agent = setup();
            const a = repo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'a' });
            const b = repo.upsertSlice({ agentId: agent.id, kind: 'directive', content: 'b' });
            repo.toggleSlice(b.id, false);

            expect(repo.listSlices(agent.id).length).toBe(2);
            expect(repo.listSlices(agent.id, { enabled: true }).length).toBe(1);
            expect(repo.listSlices(agent.id, { enabled: false }).length).toBe(1);
            expect(repo.listSlices(agent.id, { enabled: true })[0].id).toBe(a.id);
        });

        it('deletes a slice', () => {
            const agent = setup();
            const slice = repo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'x' });
            expect(repo.deleteSlice(slice.id)).toBe(true);
            expect(repo.findSliceById(slice.id)).toBeNull();
            expect(repo.deleteSlice(slice.id)).toBe(false);
        });

        it('cascade-deletes slices when agent is removed', () => {
            const agent = setup();
            repo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'x' });
            repo.upsertSlice({ agentId: agent.id, kind: 'directive', content: 'y' });

            repo.delete(agent.id);
            expect(repo.listSlices(agent.id).length).toBe(0);
        });
    });

    // ───────────────────── secrets ─────────────────────

    describe('secrets', () => {
        it('adds and lists secrets', () => {
            chars.create(makeCharacter('char-1'));
            const agent = repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });

            repo.addSecret({ agentId: agent.id, content: 'secret 1', importance: 'high' });
            repo.addSecret({ agentId: agent.id, content: 'secret 2' });

            const list = repo.listSecrets(agent.id);
            expect(list.length).toBe(2);
            expect(list[0].content).toBe('secret 1');
            expect(list[0].importance).toBe('high');
            expect(list[1].importance).toBeNull();
        });

        it('deletes a secret', () => {
            chars.create(makeCharacter('char-1'));
            const agent = repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });
            const secret = repo.addSecret({ agentId: agent.id, content: 'doomed' });

            expect(repo.deleteSecret(secret.id)).toBe(true);
            expect(repo.listSecrets(agent.id).length).toBe(0);
        });
    });

    // ───────────────────── journal ─────────────────────

    describe('journal', () => {
        function setup() {
            chars.create(makeCharacter('char-1'));
            return repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });
        }

        it('adds journal entries with optional encounter/round', () => {
            const agent = setup();
            const e = repo.addJournalEntry({
                agentId: agent.id,
                kind: 'response',
                content: 'spoke up',
                encounterId: 'enc-1',
                round: 3
            });

            expect(e.kind).toBe('response');
            expect(e.encounterId).toBe('enc-1');
            expect(e.round).toBe(3);
        });

        it('lists journal entries newest-first with limit', () => {
            const agent = setup();
            for (let i = 0; i < 5; i++) {
                repo.addJournalEntry({ agentId: agent.id, kind: 'observation', content: `entry ${i}` });
            }

            const all = repo.listJournal(agent.id);
            expect(all.length).toBe(5);
            const trimmed = repo.listJournal(agent.id, { limit: 2 });
            expect(trimmed.length).toBe(2);
        });

        it('filters by kinds and encounterId', () => {
            const agent = setup();
            repo.addJournalEntry({ agentId: agent.id, kind: 'response', content: 'r' });
            repo.addJournalEntry({ agentId: agent.id, kind: 'plan', content: 'p' });
            repo.addJournalEntry({ agentId: agent.id, kind: 'observation', content: 'o', encounterId: 'enc-X' });
            repo.addJournalEntry({ agentId: agent.id, kind: 'observation', content: 'o2', encounterId: 'enc-Y' });

            expect(repo.listJournal(agent.id, { kinds: ['response'] }).length).toBe(1);
            expect(repo.listJournal(agent.id, { kinds: ['response', 'plan'] }).length).toBe(2);
            expect(repo.listJournal(agent.id, { encounterId: 'enc-X' }).length).toBe(1);
        });
    });

    // ───────────────────── calls (audit log) ─────────────────────

    describe('calls', () => {
        function setup() {
            chars.create(makeCharacter('char-1'));
            return repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });
        }

        it('records a call', () => {
            const agent = setup();
            const call = repo.recordCall({
                agentId: agent.id,
                provider: 'openai',
                model: 'gpt-4o-mini',
                messagesJson: JSON.stringify([{ role: 'user', content: 'hi' }]),
                rawResponse: 'hello',
                promptTokens: 12,
                completionTokens: 4,
                durationMs: 320,
                status: 'ok'
            });

            expect(call.agentId).toBe(agent.id);
            expect(call.status).toBe('ok');
            expect(call.promptTokens).toBe(12);
            expect(call.completionTokens).toBe(4);
        });

        it('finds calls by id and lists newest-first', () => {
            const agent = setup();
            const c1 = repo.recordCall({ agentId: agent.id, provider: 'openai', model: 'm', messagesJson: '[]', status: 'ok' });
            repo.recordCall({ agentId: agent.id, provider: 'openai', model: 'm', messagesJson: '[]', status: 'timeout' });

            expect(repo.findCallById(c1.id)?.id).toBe(c1.id);

            const list = repo.listCalls(agent.id);
            expect(list.length).toBe(2);
            // newest first: the 'timeout' one was inserted second
            expect(list[0].status).toBe('timeout');
        });

        it('filters calls by status', () => {
            const agent = setup();
            repo.recordCall({ agentId: agent.id, provider: 'openai', model: 'm', messagesJson: '[]', status: 'ok' });
            repo.recordCall({ agentId: agent.id, provider: 'openai', model: 'm', messagesJson: '[]', status: 'timeout' });
            repo.recordCall({ agentId: agent.id, provider: 'openai', model: 'm', messagesJson: '[]', status: 'ok' });

            expect(repo.listCalls(agent.id, { status: 'ok' }).length).toBe(2);
            expect(repo.listCalls(agent.id, { status: 'timeout' }).length).toBe(1);
        });
    });

    // ───────────────────── circuit breaker ─────────────────────

    describe('circuit breaker', () => {
        function setup() {
            chars.create(makeCharacter('char-1'));
            return repo.create({ characterId: 'char-1', provider: 'openai', model: 'gpt-4o-mini' });
        }

        it('opens circuit after 3 consecutive failures', () => {
            const agent = setup();
            expect(repo.recordFailure(agent.id)).toEqual({ failures: 1, circuitState: 'closed' });
            expect(repo.recordFailure(agent.id)).toEqual({ failures: 2, circuitState: 'closed' });
            expect(repo.recordFailure(agent.id)).toEqual({ failures: 3, circuitState: 'open' });

            const updated = repo.findById(agent.id)!;
            expect(updated.consecutiveFailures).toBe(3);
            expect(updated.circuitState).toBe('open');
        });

        it('recordSuccess resets failures and closes the circuit', () => {
            const agent = setup();
            repo.recordFailure(agent.id);
            repo.recordFailure(agent.id);
            repo.recordFailure(agent.id);
            expect(repo.findById(agent.id)?.circuitState).toBe('open');

            repo.recordSuccess(agent.id);
            const updated = repo.findById(agent.id)!;
            expect(updated.consecutiveFailures).toBe(0);
            expect(updated.circuitState).toBe('closed');
        });
    });
});
