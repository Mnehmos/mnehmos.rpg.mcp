import * as fs from 'fs';
import { initDB } from '../../../src/storage/db';
import { migrate } from '../../../src/storage/migrations';
import { CharacterRepository } from '../../../src/storage/repos/character.repo';
import { ProviderFactory } from '../../../src/agent/provider/factory';
import { LLMProvider, ProviderCallResult, ProviderError } from '../../../src/agent/provider/types';
import { invokeAgent } from '../../../src/agent/runtime/invoke';
import { buildAgentRuntime } from '../../../src/agent/runtime/deps';
import { Character } from '../../../src/schema/character';
import { FIXED_TIMESTAMP } from '../../fixtures.js';

const TEST_DB = 'test-invoke.db';

function cleanup() {
    for (const s of ['', '-wal', '-shm']) {
        const p = TEST_DB + s;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
}

function char(id: string, overrides: Partial<Character> = {}): Character {
    return {
        id,
        name: 'Kara',
        stats: { str: 12, dex: 17, con: 14, int: 10, wis: 14, cha: 12 },
        hp: 30,
        maxHp: 45,
        ac: 16,
        level: 5,
        characterType: 'pc',
        characterClass: 'ranger',
        race: 'Half-Elf',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        ...overrides
    } as Character;
}

/** Provider mock that lets each test script the response. */
function fakeProvider(impl: (opts: { model: string; messages: unknown[] }) => Promise<ProviderCallResult>): LLMProvider {
    return {
        name: 'openai',
        call: async (opts) => impl({ model: opts.model, messages: opts.messages })
    };
}

describe('invokeAgent', () => {
    let db: ReturnType<typeof initDB>;
    let factory: ProviderFactory;
    let deps: ReturnType<typeof buildAgentRuntime>;

    beforeEach(() => {
        cleanup();
        db = initDB(TEST_DB);
        migrate(db);
        factory = new ProviderFactory();
        deps = buildAgentRuntime(db, factory);
    });

    afterEach(() => {
        db.close();
        cleanup();
    });

    function setupAgent(opts: Partial<{ budgetTokens: number | null; status: 'active' | 'paused'; circuitState: 'closed' | 'open' | 'half_open'; consecutiveFailures: number }> = {}) {
        const chars = new CharacterRepository(db);
        chars.create(char('char-1'));
        const agent = deps.agentRepo.create({
            characterId: 'char-1',
            provider: 'openai',
            model: 'gpt-4o-mini',
            budgetTokens: opts.budgetTokens ?? null
        });
        if (opts.status || opts.circuitState || opts.consecutiveFailures !== undefined) {
            deps.agentRepo.update(agent.id, {
                status: opts.status,
                circuitState: opts.circuitState,
                consecutiveFailures: opts.consecutiveFailures
            });
        }
        return deps.agentRepo.findById(agent.id)!;
    }

    // ───────── happy path ─────────

    it('returns the provider text on success and records a call', async () => {
        const agent = setupAgent();
        factory.register('openai', fakeProvider(async () => ({
            text: 'Kara nocks an arrow. I attack the orc with my longbow.',
            promptTokens: 100,
            completionTokens: 20,
            raw: '{"choices":[{"message":{"content":"x"}}]}',
            durationMs: 250,
            finishReason: 'stop'
        })));

        const result = await invokeAgent({ agentId: agent.id, situation: "It's your turn." }, deps);

        expect(result.status).toBe('ok');
        expect(result.response).toContain('Kara nocks an arrow');
        expect(result.promptTokens).toBe(100);
        expect(result.completionTokens).toBe(20);
        expect(result.characterName).toBe('Kara');
        expect(result.callId).toBeTruthy();
    });

    it('increments tokens_used after a successful call', async () => {
        const agent = setupAgent();
        factory.register('openai', fakeProvider(async () => ({
            text: 'ok', promptTokens: 100, completionTokens: 50, raw: '{}', durationMs: 1
        })));

        await invokeAgent({ agentId: agent.id }, deps);

        const updated = deps.agentRepo.findById(agent.id)!;
        expect(updated.tokensUsed).toBe(150);
    });

    it('appends a journal entry of kind=response on success', async () => {
        const agent = setupAgent();
        factory.register('openai', fakeProvider(async () => ({
            text: "I attack the orc.", raw: '{}', durationMs: 1
        })));

        await invokeAgent({
            agentId: agent.id,
            situation: 'go',
            encounterId: 'enc-1',
            round: 3
        }, deps);

        const journal = deps.agentRepo.listJournal(agent.id);
        expect(journal.length).toBe(1);
        expect(journal[0].kind).toBe('response');
        expect(journal[0].content).toBe('I attack the orc.');
        expect(journal[0].encounterId).toBe('enc-1');
        expect(journal[0].round).toBe(3);
    });

    it('looks up agent by characterId when agentId not given', async () => {
        setupAgent();
        factory.register('openai', fakeProvider(async () => ({
            text: 'fine', raw: '{}', durationMs: 1
        })));

        const result = await invokeAgent({ characterId: 'char-1' }, deps);
        expect(result.status).toBe('ok');
    });

    // ───────── preflight skip paths ─────────

    it('returns paused status without calling the provider when agent is paused', async () => {
        const agent = setupAgent({ status: 'paused' });
        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: 'should not run', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({ agentId: agent.id }, deps);

        expect(called).toBe(false);
        expect(result.status).toBe('paused');
        expect(result.reason).toBe('agent_paused');
        expect(result.callId).toBeTruthy(); // call row still recorded for audit
    });

    it('returns circuit_open status without calling the provider', async () => {
        const agent = setupAgent({ circuitState: 'open', consecutiveFailures: 3 });
        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: '', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({ agentId: agent.id }, deps);

        expect(called).toBe(false);
        expect(result.status).toBe('circuit_open');
    });

    it('returns budget_exhausted status without calling the provider', async () => {
        const agent = setupAgent({ budgetTokens: 100 });
        deps.agentRepo.incrementTokensUsed(agent.id, 100);

        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: '', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({ agentId: agent.id }, deps);

        expect(called).toBe(false);
        expect(result.status).toBe('budget_exhausted');
    });

    it('returns incapable status when character HP is 0', async () => {
        const agent = setupAgent();
        // Drop character to 0 HP via repo
        const chars = new CharacterRepository(db);
        chars.update('char-1', { hp: 0 });

        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: '', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({ agentId: agent.id }, deps);

        expect(called).toBe(false);
        expect(result.status).toBe('incapable');
        expect(result.reason).toContain('hp_zero');
    });

    it('returns error when agent not found', async () => {
        const result = await invokeAgent({ agentId: 'nope' }, deps);
        expect(result.status).toBe('error');
        expect(result.reason).toBe('agent_not_found');
    });

    it('returns error when provider has no credentials', async () => {
        const agent = setupAgent();
        // Don't register a provider.

        const result = await invokeAgent({ agentId: agent.id }, deps);

        expect(result.status).toBe('error');
        expect(result.reason).toContain('OPENAI_API_KEY');
    });

    // ───────── failure paths + circuit ─────────

    it('records timeout status when provider throws timeout', async () => {
        const agent = setupAgent();
        factory.register('openai', fakeProvider(async () => {
            throw new ProviderError('timed out', 'timeout');
        }));

        const result = await invokeAgent({ agentId: agent.id }, deps);

        expect(result.status).toBe('timeout');
        const updated = deps.agentRepo.findById(agent.id)!;
        expect(updated.consecutiveFailures).toBe(1);
    });

    it('records rate_limited status', async () => {
        const agent = setupAgent();
        factory.register('openai', fakeProvider(async () => {
            throw new ProviderError('429', 'rate_limited');
        }));

        const result = await invokeAgent({ agentId: agent.id }, deps);
        expect(result.status).toBe('rate_limited');
    });

    it('opens circuit after 3 consecutive failures', async () => {
        const agent = setupAgent();
        factory.register('openai', fakeProvider(async () => {
            throw new ProviderError('timeout', 'timeout');
        }));

        await invokeAgent({ agentId: agent.id }, deps);
        await invokeAgent({ agentId: agent.id }, deps);
        await invokeAgent({ agentId: agent.id }, deps);

        const updated = deps.agentRepo.findById(agent.id)!;
        expect(updated.consecutiveFailures).toBe(3);
        expect(updated.circuitState).toBe('open');

        // 4th invoke is short-circuited
        const next = await invokeAgent({ agentId: agent.id }, deps);
        expect(next.status).toBe('circuit_open');
    });

    it('does NOT trip circuit on auth errors', async () => {
        const agent = setupAgent();
        factory.register('openai', fakeProvider(async () => {
            throw new ProviderError('401', 'auth');
        }));

        await invokeAgent({ agentId: agent.id }, deps);
        await invokeAgent({ agentId: agent.id }, deps);

        const updated = deps.agentRepo.findById(agent.id)!;
        expect(updated.consecutiveFailures).toBe(0);
        expect(updated.circuitState).toBe('closed');
    });

    it('closes circuit on success after prior failures', async () => {
        const agent = setupAgent();
        let calls = 0;
        factory.register('openai', fakeProvider(async () => {
            calls++;
            if (calls < 2) throw new ProviderError('timeout', 'timeout');
            return { text: 'recovered', raw: '{}', durationMs: 1 };
        }));

        await invokeAgent({ agentId: agent.id }, deps);
        const after1 = deps.agentRepo.findById(agent.id)!;
        expect(after1.consecutiveFailures).toBe(1);

        await invokeAgent({ agentId: agent.id }, deps);
        const after2 = deps.agentRepo.findById(agent.id)!;
        expect(after2.consecutiveFailures).toBe(0);
        expect(after2.circuitState).toBe('closed');
    });

    // ───────── overrides ─────────

    it('passes systemOverride through to the provider', async () => {
        const agent = setupAgent();
        let captured: unknown[] = [];
        factory.register('openai', fakeProvider(async ({ messages }) => {
            captured = messages;
            return { text: 'ok', raw: '{}', durationMs: 1 };
        }));

        await invokeAgent({
            agentId: agent.id,
            situation: 'GO',
            systemOverride: 'CUSTOM_SYSTEM_FROM_DM'
        }, deps);

        const sysMsg = captured.find((m): m is { role: string; content: string } => (m as { role: string }).role === 'system');
        expect(sysMsg!.content).toContain('CUSTOM_SYSTEM_FROM_DM');
    });

    it('passes messagesOverride through to the provider', async () => {
        const agent = setupAgent();
        let captured: unknown[] = [];
        factory.register('openai', fakeProvider(async ({ messages }) => {
            captured = messages;
            return { text: 'ok', raw: '{}', durationMs: 1 };
        }));

        await invokeAgent({
            agentId: agent.id,
            messagesOverride: [
                { role: 'system', content: 'SYS_OVERRIDE' },
                { role: 'user', content: 'USR_OVERRIDE' }
            ]
        }, deps);

        expect(captured.length).toBe(2);
        expect((captured[0] as { content: string }).content).toBe('SYS_OVERRIDE');
        expect((captured[1] as { content: string }).content).toBe('USR_OVERRIDE');
    });
});
