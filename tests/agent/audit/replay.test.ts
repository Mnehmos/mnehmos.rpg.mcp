import * as fs from 'fs';
import { initDB } from '../../../src/storage/db';
import { migrate } from '../../../src/storage/migrations';
import { CharacterRepository } from '../../../src/storage/repos/character.repo';
import { ProviderFactory } from '../../../src/agent/provider/factory';
import { LLMProvider, ProviderCallResult, ProviderError } from '../../../src/agent/provider/types';
import { invokeAgent } from '../../../src/agent/runtime/invoke';
import { replayCall } from '../../../src/agent/audit/replay';
import { buildAgentRuntime } from '../../../src/agent/runtime/deps';
import { Character } from '../../../src/schema/character';
import { FIXED_TIMESTAMP } from '../../fixtures.js';

const TEST_DB = 'test-replay.db';

function cleanup() {
    for (const s of ['', '-wal', '-shm']) {
        const p = TEST_DB + s;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
}

function char(id: string): Character {
    return {
        id,
        name: 'Kara',
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: 20,
        maxHp: 20,
        ac: 15,
        level: 1,
        characterType: 'pc',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP
    } as Character;
}

function provider(impl: (model: string) => Promise<ProviderCallResult>): LLMProvider {
    return {
        name: 'openai',
        call: async (opts) => impl(opts.model)
    };
}

describe('replayCall', () => {
    let db: ReturnType<typeof initDB>;
    let deps: ReturnType<typeof buildAgentRuntime>;

    beforeEach(() => {
        cleanup();
        db = initDB(TEST_DB);
        migrate(db);
        const factory = new ProviderFactory();
        deps = buildAgentRuntime(db, factory);
    });

    afterEach(() => {
        db.close();
        cleanup();
    });

    async function setupAgentAndOriginalCall(originalText = 'I attack the orc.') {
        new CharacterRepository(db).create(char('char-1'));
        const agent = deps.agentRepo.create({
            characterId: 'char-1',
            provider: 'openai',
            model: 'gpt-4o-mini'
        });
        deps.providerFactory.register('openai', provider(async () => ({
            text: originalText,
            promptTokens: 100,
            completionTokens: 20,
            raw: JSON.stringify({ choices: [{ message: { content: originalText } }] }),
            durationMs: 200
        })));
        const result = await invokeAgent({ agentId: agent.id, situation: 'go' }, deps);
        expect(result.status).toBe('ok');
        return { agent, originalCallId: result.callId! };
    }

    // ───────── dry mode ─────────

    it('dry mode: returns stored data without calling the provider', async () => {
        const { originalCallId } = await setupAgentAndOriginalCall('original response');

        let calledAgain = false;
        deps.providerFactory.register('openai', provider(async () => {
            calledAgain = true;
            return { text: 'should not run', raw: '{}', durationMs: 1 };
        }));

        const result = await replayCall({ callId: originalCallId }, deps);
        expect('error' in result).toBe(false);
        if ('error' in result) throw new Error('unreachable');

        expect(result.mode).toBe('dry');
        expect(result.callId).toBe(originalCallId);
        expect(result.original.model).toBe('gpt-4o-mini');
        expect(result.original.status).toBe('ok');
        expect(result.replay).toBeUndefined();
        expect(result.diff).toBeUndefined();
        expect(calledAgain).toBe(false);
    });

    it('dry mode: errors when callId is missing', async () => {
        const result = await replayCall({ callId: 'no-such-call' }, deps);
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.message).toContain('Call not found');
        }
    });

    // ───────── live mode ─────────

    it('live mode: re-issues against the override model and records a new call row', async () => {
        const { agent, originalCallId } = await setupAgentAndOriginalCall('original');

        let observedModel: string | undefined;
        deps.providerFactory.register('openai', provider(async (model) => {
            observedModel = model;
            return {
                text: 'replayed response from a different model',
                promptTokens: 110,
                completionTokens: 30,
                raw: '{"choices":[]}',
                durationMs: 300
            };
        }));

        const result = await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);
        if ('error' in result) throw new Error(`unexpected error: ${result.message}`);

        expect(result.mode).toBe('live');
        expect(observedModel).toBe('gpt-4o');
        expect(result.replay).toBeDefined();
        expect(result.replay!.status).toBe('ok');
        expect(result.replay!.model).toBe('gpt-4o');
        expect(result.replay!.response).toContain('replayed response');
        expect(result.replay!.promptTokens).toBe(110);
        expect(result.replay!.completionTokens).toBe(30);

        // The replay call MUST be persisted as a new agent_calls row
        const replayCallRow = deps.agentRepo.findCallById(result.replay!.replayCallId);
        expect(replayCallRow).not.toBeNull();
        expect(replayCallRow!.requestId).toBe(`replay:${originalCallId}`);
        expect(replayCallRow!.model).toBe('gpt-4o');
        expect(replayCallRow!.status).toBe('ok');

        // Total calls for this agent: original + replay = 2
        const allCalls = deps.agentRepo.listCalls(agent.id);
        expect(allCalls.length).toBe(2);
    });

    it('live mode: makes exactly ONE provider call (regression test for double-call bug)', async () => {
        const { originalCallId } = await setupAgentAndOriginalCall();

        let callCount = 0;
        deps.providerFactory.register('openai', provider(async () => {
            callCount++;
            return { text: 'r', raw: '{}', durationMs: 1 };
        }));

        await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);
        expect(callCount).toBe(1);
    });

    it('live mode: re-issuing with the same model still works (not just override-only)', async () => {
        const { originalCallId } = await setupAgentAndOriginalCall();

        deps.providerFactory.register('openai', provider(async () => ({
            text: 'second run', raw: '{}', durationMs: 1, promptTokens: 50, completionTokens: 10
        })));

        const result = await replayCall({ callId: originalCallId, model: 'gpt-4o-mini' }, deps);
        if ('error' in result) throw new Error(result.message);

        expect(result.mode).toBe('live');
        expect(result.replay!.model).toBe('gpt-4o-mini');
        expect(result.replay!.status).toBe('ok');
    });

    it('live mode: emits a diff comparing original vs replay text', async () => {
        const { originalCallId } = await setupAgentAndOriginalCall('original ten chars');

        deps.providerFactory.register('openai', provider(async () => ({
            text: 'totally different', raw: '{}', durationMs: 1
        })));

        const result = await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);
        if ('error' in result) throw new Error(result.message);

        expect(result.diff).toBeDefined();
        expect(result.diff!.sameText).toBe(false);
        // original.rawResponse is the raw JSON, not the response text — different from 'totally different'
        expect(result.diff!.replayLength).toBe('totally different'.length);
    });

    it('live mode: provider timeout surfaces as replay.status=timeout with a new call row', async () => {
        const { originalCallId } = await setupAgentAndOriginalCall();

        deps.providerFactory.register('openai', provider(async () => {
            throw new ProviderError('timed out', 'timeout');
        }));

        const result = await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);
        if ('error' in result) throw new Error(result.message);

        expect(result.mode).toBe('live');
        expect(result.replay!.status).toBe('timeout');
        expect(result.replay!.errorMessage).toContain('timed out');

        // Failed replay STILL records a call row (for audit + cost tracking on aborted calls)
        const replayCallRow = deps.agentRepo.findCallById(result.replay!.replayCallId);
        expect(replayCallRow).not.toBeNull();
        expect(replayCallRow!.status).toBe('timeout');
    });

    it('live mode: generic provider error surfaces as replay.status=error', async () => {
        const { originalCallId } = await setupAgentAndOriginalCall();

        deps.providerFactory.register('openai', provider(async () => {
            throw new ProviderError('500 server', 'server');
        }));

        const result = await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);
        if ('error' in result) throw new Error(result.message);

        expect(result.replay!.status).toBe('error');
        expect(result.replay!.errorMessage).toContain('500 server');
    });

    it('live mode: errors cleanly when provider is not configured', async () => {
        // Build fresh runtime with no provider registered
        const freshFactory = new ProviderFactory();
        const freshDeps = buildAgentRuntime(db, freshFactory);
        const { originalCallId } = await setupAgentAndOriginalCall();

        const result = await replayCall({ callId: originalCallId, model: 'gpt-4o' }, freshDeps);
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.message).toMatch(/Provider unavailable|OPENAI_API_KEY/);
        }
    });

    it('live mode: NEVER mutates the agent or appends a journal entry (audit isolation)', async () => {
        const { agent, originalCallId } = await setupAgentAndOriginalCall();
        const tokensBefore = deps.agentRepo.findById(agent.id)!.tokensUsed;
        const journalBefore = deps.agentRepo.listJournal(agent.id).length;

        deps.providerFactory.register('openai', provider(async () => ({
            text: 'replay output', raw: '{}', durationMs: 1,
            promptTokens: 999, completionTokens: 999
        })));

        await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);

        const tokensAfter = deps.agentRepo.findById(agent.id)!.tokensUsed;
        const journalAfter = deps.agentRepo.listJournal(agent.id).length;

        // Replay does NOT count toward the agent's budget (it's a DM audit action)
        expect(tokensAfter).toBe(tokensBefore);
        // Replay does NOT append to the agent's journal (it's not a turn the agent took)
        expect(journalAfter).toBe(journalBefore);
    });

    it('live mode: NEVER goes through preflight (paused agent still replayable)', async () => {
        const { agent, originalCallId } = await setupAgentAndOriginalCall();
        deps.agentRepo.update(agent.id, { status: 'paused' });

        deps.providerFactory.register('openai', provider(async () => ({
            text: 'replayed even when paused', raw: '{}', durationMs: 1
        })));

        const result = await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);
        if ('error' in result) throw new Error(result.message);

        expect(result.mode).toBe('live');
        expect(result.replay!.status).toBe('ok');
        expect(result.replay!.response).toBe('replayed even when paused');
    });

    it('live mode: NEVER trips the circuit breaker on failure', async () => {
        const { agent, originalCallId } = await setupAgentAndOriginalCall();

        deps.providerFactory.register('openai', provider(async () => {
            throw new ProviderError('timeout', 'timeout');
        }));

        const before = deps.agentRepo.findById(agent.id)!;
        await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);
        await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);
        await replayCall({ callId: originalCallId, model: 'gpt-4o' }, deps);
        const after = deps.agentRepo.findById(agent.id)!;

        expect(after.consecutiveFailures).toBe(before.consecutiveFailures);
        expect(after.circuitState).toBe(before.circuitState);
    });
});
