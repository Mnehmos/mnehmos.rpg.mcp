/**
 * Verifies that every successful invokeAgent emits an npc_action event to
 * the event_inbox table for frontend polling.
 */

import * as fs from 'fs';
import { initDB } from '../../../src/storage/db';
import { migrate } from '../../../src/storage/migrations';
import { CharacterRepository } from '../../../src/storage/repos/character.repo';
import { EventInboxRepository } from '../../../src/storage/repos/event-inbox.repo';
import { ProviderFactory } from '../../../src/agent/provider/factory';
import { LLMProvider, ProviderCallResult, ProviderError } from '../../../src/agent/provider/types';
import { invokeAgent } from '../../../src/agent/runtime/invoke';
import { buildAgentRuntime } from '../../../src/agent/runtime/deps';
import { Character } from '../../../src/schema/character';
import { FIXED_TIMESTAMP } from '../../fixtures.js';

const TEST_DB = 'test-event-inbox.db';

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

function fakeProvider(impl: () => Promise<ProviderCallResult>): LLMProvider {
    return { name: 'openai', call: async () => impl() };
}

describe('invokeAgent → event_inbox emission', () => {
    let db: ReturnType<typeof initDB>;
    let deps: ReturnType<typeof buildAgentRuntime>;
    let inboxRepo: EventInboxRepository;

    beforeEach(() => {
        cleanup();
        db = initDB(TEST_DB);
        migrate(db);
        const factory = new ProviderFactory();
        deps = buildAgentRuntime(db, factory);
        inboxRepo = new EventInboxRepository(db);
    });

    afterEach(() => {
        db.close();
        cleanup();
    });

    function setupAgent() {
        new CharacterRepository(db).create(char('char-1'));
        return deps.agentRepo.create({
            characterId: 'char-1',
            provider: 'openai',
            model: 'gpt-4o-mini'
        });
    }

    it('emits an npc_action event on successful invoke', async () => {
        const agent = setupAgent();
        deps.providerFactory.register('openai', fakeProvider(async () => ({
            text: 'I attack the orc.',
            promptTokens: 50,
            completionTokens: 10,
            raw: '{}',
            durationMs: 100
        })));

        const result = await invokeAgent({ agentId: agent.id, situation: 'go' }, deps);
        expect(result.status).toBe('ok');

        const events = inboxRepo.poll(10);
        expect(events.length).toBe(1);
        expect(events[0].eventType).toBe('npc_action');
        expect(events[0].sourceType).toBe('npc');
        expect(events[0].sourceId).toBe('char-1');
    });

    it('event payload contains the response text + identifying ids + tokens', async () => {
        const agent = setupAgent();
        deps.providerFactory.register('openai', fakeProvider(async () => ({
            text: '*Kara nocks an arrow.* I shoot the orc with my longbow.',
            promptTokens: 100,
            completionTokens: 20,
            raw: '{}',
            durationMs: 250
        })));

        await invokeAgent({
            agentId: agent.id,
            situation: 'go',
            encounterId: 'enc-42',
            round: 3
        }, deps);

        const events = inboxRepo.poll(10);
        const payload = events[0].payload as {
            agentId: string;
            characterId: string;
            characterName: string;
            response: string;
            callId: string;
            encounterId: string;
            round: number;
            promptTokens: number;
            completionTokens: number;
            durationMs: number;
            status: string;
        };

        expect(payload.agentId).toBe(agent.id);
        expect(payload.characterId).toBe('char-1');
        expect(payload.characterName).toBe('Kara');
        expect(payload.response).toContain('Kara nocks an arrow');
        expect(payload.callId).toBeTruthy();
        expect(payload.encounterId).toBe('enc-42');
        expect(payload.round).toBe(3);
        expect(payload.promptTokens).toBe(100);
        expect(payload.completionTokens).toBe(20);
        expect(payload.durationMs).toBe(250);
        expect(payload.status).toBe('ok');
    });

    it('does NOT emit an event on preflight skip (paused agent)', async () => {
        const agent = setupAgent();
        deps.agentRepo.update(agent.id, { status: 'paused' });

        let called = false;
        deps.providerFactory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: 'should not run', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({ agentId: agent.id }, deps);
        expect(result.status).toBe('paused');
        expect(called).toBe(false);

        const events = inboxRepo.poll(10);
        expect(events.length).toBe(0);
    });

    it('does NOT emit an event on provider failure', async () => {
        const agent = setupAgent();
        deps.providerFactory.register('openai', fakeProvider(async () => {
            throw new ProviderError('timed out', 'timeout');
        }));

        const result = await invokeAgent({ agentId: agent.id }, deps);
        expect(result.status).toBe('timeout');

        const events = inboxRepo.poll(10);
        expect(events.length).toBe(0);
    });

    it('emits exactly one event per successful invoke (no duplicates)', async () => {
        const agent = setupAgent();
        deps.providerFactory.register('openai', fakeProvider(async () => ({
            text: 'ok', raw: '{}', durationMs: 1
        })));

        await invokeAgent({ agentId: agent.id }, deps);
        await invokeAgent({ agentId: agent.id }, deps);
        await invokeAgent({ agentId: agent.id }, deps);

        const events = inboxRepo.poll(20);
        expect(events.length).toBe(3);
    });

    it('events have priority=5 (medium importance for NPC actions)', async () => {
        const agent = setupAgent();
        deps.providerFactory.register('openai', fakeProvider(async () => ({
            text: 'ok', raw: '{}', durationMs: 1
        })));

        await invokeAgent({ agentId: agent.id }, deps);

        const events = inboxRepo.poll(10);
        expect(events[0].priority).toBe(5);
    });

    it('event survives invoke even if eventInboxRepo throws (defensive)', async () => {
        const agent = setupAgent();
        deps.providerFactory.register('openai', fakeProvider(async () => ({
            text: 'ok', raw: '{}', durationMs: 1
        })));

        // Replace the eventInboxRepo with one that throws
        const broken = {
            push: () => { throw new Error('inbox failure'); }
        } as unknown as EventInboxRepository;
        const brokenDeps = { ...deps, eventInboxRepo: broken };

        // Should not throw — invoke isolates inbox failure
        const result = await invokeAgent({ agentId: agent.id }, brokenDeps);
        expect(result.status).toBe('ok');
        expect(result.response).toBe('ok');
    });
});
