/**
 * Scene-scope gate tests (TDD RED phase).
 *
 * Verifies that invokeAgent enforces SYSTEM.md Rule 5 — an agent cannot
 * mechanically observe or act on a scene they're not physically in.
 *
 * Test matrix from the design doc:
 *   - in_scene_encounter_invocation_succeeds
 *   - out_of_scene_encounter_skipped_without_remote_contact
 *   - remote_contact_sending_injects_prefix_and_succeeds
 *   - explicit_room_scene_id_match_succeeds
 *   - explicit_room_scene_id_mismatch_skipped
 *   - no_scene_context_default_compatibility_mode_allows_invoke
 *   - no_scene_context_strict_mode_skips
 *   - voice_of_god_remote_contact_bypasses_with_audit
 *   - skipped_invoke_never_throws_never_breaks_caller
 *
 * NOTE: NO `import { describe, it, expect } from 'vitest'` — vitest globals only.
 * That import breaks test collection on Windows + vitest 1.6.1.
 */

import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { initDB } from '../../../src/storage/db';
import { migrate } from '../../../src/storage/migrations';
import { CharacterRepository } from '../../../src/storage/repos/character.repo';
import { EncounterRepository } from '../../../src/storage/repos/encounter.repo';
import { ProviderFactory } from '../../../src/agent/provider/factory';
import { LLMProvider, ProviderCallResult } from '../../../src/agent/provider/types';
import { invokeAgent } from '../../../src/agent/runtime/invoke';
import { buildAgentRuntime } from '../../../src/agent/runtime/deps';
import { Character } from '../../../src/schema/character';
import { FIXED_TIMESTAMP } from '../../fixtures.js';

const TEST_DB = 'test-scene-scope.db';

function cleanup() {
    for (const s of ['', '-wal', '-shm']) {
        const p = TEST_DB + s;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
}

function char(id: string, overrides: Partial<Character> = {}): Character {
    return {
        id,
        name: 'Test',
        stats: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
        hp: 30,
        maxHp: 30,
        ac: 14,
        level: 3,
        characterType: 'pc',
        characterClass: 'fighter',
        race: 'Human',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        ...overrides
    } as Character;
}

function fakeProvider(impl: (opts: { model: string; messages: { role: string; content: string }[] }) => Promise<ProviderCallResult>): LLMProvider {
    return {
        name: 'openai',
        call: async (opts) => impl({ model: opts.model, messages: opts.messages as { role: string; content: string }[] })
    };
}

describe('invokeAgent — scene-scope gate', () => {
    let db: ReturnType<typeof initDB>;
    let factory: ProviderFactory;
    let deps: ReturnType<typeof buildAgentRuntime>;
    let originalStrict: string | undefined;

    beforeEach(() => {
        cleanup();
        db = initDB(TEST_DB);
        migrate(db);
        factory = new ProviderFactory();
        deps = buildAgentRuntime(db, factory);
        originalStrict = process.env.AGENT_SCENE_STRICT;
        delete process.env.AGENT_SCENE_STRICT;
    });

    afterEach(() => {
        db.close();
        cleanup();
        if (originalStrict === undefined) delete process.env.AGENT_SCENE_STRICT;
        else process.env.AGENT_SCENE_STRICT = originalStrict;
    });

    function setupAgent(characterId: string) {
        const agent = deps.agentRepo.create({
            characterId,
            provider: 'openai',
            model: 'gpt-4o-mini',
            budgetTokens: null
        });
        return deps.agentRepo.findById(agent.id)!;
    }

    // Minimal room insert — characters.current_room_id has a FK to room_nodes(id).
    // We can't create characters with nonexistent room ids without violating it.
    function setupRoom(id: string, biome: string = 'urban') {
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO room_nodes (id, name, base_description, biome_context, atmospherics, exits, entity_ids, created_at, updated_at, visited_count)
            VALUES (?, ?, ?, ?, '[]', '[]', '[]', ?, ?, 0)
        `).run(id, `room-${id.slice(0, 8)}`, 'a test fixture room with valid baseDescription length', biome, now, now);
    }

    function createEncounter(participantIds: string[]): string {
        const encRepo = new EncounterRepository(db);
        const encounterId = randomUUID();
        const now = new Date().toISOString();
        const tokens = participantIds.map((id, i) => ({
            id,
            name: `Token-${i}`,
            initiative: 20 - i,
            initiativeBonus: 0,
            hp: 30,
            maxHp: 30,
            ac: 14,
            isEnemy: false,
            position: { x: i, y: 0 },
            movementSpeed: 30,
            size: 'medium'
        }));
        db.prepare(`
            INSERT INTO encounters (id, region_id, tokens, round, active_token_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            encounterId,
            null,
            JSON.stringify(tokens),
            1,
            participantIds[0] ?? null,
            'active',
            now,
            now
        );
        void encRepo; // referenced for typing
        return encounterId;
    }

    // ───────── encounter-anchored scene ─────────

    it('in_scene_encounter_invocation_succeeds', async () => {
        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        const charB = randomUUID();
        chars.create(char(charA, { name: 'Alice' }));
        chars.create(char(charB, { name: 'Bob' }));

        const agent = setupAgent(charA);
        const encounterId = createEncounter([charA, charB]);

        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: 'I attack the orc.', raw: '{}', durationMs: 1, promptTokens: 50, completionTokens: 10 };
        }));

        const result = await invokeAgent({
            agentId: agent.id,
            encounterId,
            situation: 'an orc swings at you'
        }, deps);

        expect(called).toBe(true);
        expect(result.status).toBe('ok');
        expect(result.response).toContain('I attack the orc');
    });

    it('out_of_scene_encounter_skipped_without_remote_contact', async () => {
        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        const charB = randomUUID();
        const charC = randomUUID();
        const roomX = randomUUID();
        setupRoom(roomX);
        chars.create(char(charA, { name: 'Alice' }));
        chars.create(char(charB, { name: 'Bob' }));
        chars.create(char(charC, { name: 'Carla', currentRoomId: roomX }));

        const agentC = setupAgent(charC);
        const encounterId = createEncounter([charA, charB]);

        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: 'should not run', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({
            agentId: agentC.id,
            encounterId,
            situation: 'react'
        }, deps);

        expect(called).toBe(false);
        expect(result.status).toBe('skipped');
        expect(result.reason).toContain('out_of_scene');
        // Persist an agent_calls row with status='skipped' so audit reflects it.
        const calls = deps.agentRepo.listCalls(agentC.id, { limit: 10 });
        expect(calls.length).toBe(1);
        expect(calls[0].status).toBe('skipped');
        expect(calls[0].errorMessage).toContain('out_of_scene');
    });

    it('combat_advance_auto_invoke_skipped_when_agent_character_removed_from_encounter_mid_fight', async () => {
        // Encounter only has charA. Agent is bound to charC (not in tokens). Even if
        // a stale auto-on-turn hook tries to invoke for charC via encounterId, the
        // gate should skip without throwing.
        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        const charC = randomUUID();
        const roomX = randomUUID();
        setupRoom(roomX);
        chars.create(char(charA, { name: 'Alice' }));
        chars.create(char(charC, { name: 'Carla', currentRoomId: roomX }));

        const agentC = setupAgent(charC);
        const encounterId = createEncounter([charA]);

        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: 'should not run', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({
            agentId: agentC.id,
            encounterId,
            situation: "It's your turn"
        }, deps);

        expect(called).toBe(false);
        expect(result.status).toBe('skipped');
        expect(result.reason).toContain('out_of_scene');
    });

    // ───────── room-anchored scene ─────────

    it('explicit_room_scene_id_match_succeeds', async () => {
        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        const tavern = randomUUID();
        setupRoom(tavern);
        chars.create(char(charA, { name: 'Alice', currentRoomId: tavern }));

        const agent = setupAgent(charA);

        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: 'I greet the barkeep.', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({
            agentId: agent.id,
            sceneId: tavern,
            situation: 'barkeep approaches'
        }, deps);

        expect(called).toBe(true);
        expect(result.status).toBe('ok');
    });

    it('explicit_room_scene_id_mismatch_skipped', async () => {
        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        const cellar = randomUUID();
        setupRoom(cellar);
        const tavern = randomUUID();
        setupRoom(tavern);
        chars.create(char(charA, { name: 'Alice', currentRoomId: cellar }));

        const agent = setupAgent(charA);

        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: 'should not run', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({
            agentId: agent.id,
            sceneId: tavern
        }, deps);

        expect(called).toBe(false);
        expect(result.status).toBe('skipped');
        expect(result.reason).toContain('out_of_scene');
    });

    // ───────── remote contact ─────────

    it('remote_contact_sending_injects_prefix_and_succeeds', async () => {
        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        const charC = randomUUID();
        const roomX = randomUUID();
        setupRoom(roomX);
        chars.create(char(charA, { name: 'Alice' }));
        chars.create(char(charC, { name: 'Carla', currentRoomId: roomX }));

        const agentC = setupAgent(charC);
        const encounterId = createEncounter([charA]);

        let capturedMessages: { role: string; content: string }[] = [];
        factory.register('openai', fakeProvider(async ({ messages }) => {
            capturedMessages = messages;
            return { text: 'I rush to help!', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({
            agentId: agentC.id,
            encounterId,
            remoteContact: {
                method: 'sending',
                source: charA,
                payload: 'Help, ambush at the bridge!',
                oneWay: false,
                wordLimit: 25
            }
        }, deps);

        expect(result.status).toBe('ok');
        // The user-message (the situation) should mention SENDING and the channel.
        const userMsg = capturedMessages.find(m => m.role === 'user');
        expect(userMsg).toBeDefined();
        expect(userMsg!.content.toLowerCase()).toContain('sending');
        expect(userMsg!.content).toContain('Help, ambush at the bridge!');
    });

    it('voice_of_god_remote_contact_bypasses_with_audit', async () => {
        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        const roomX = randomUUID();
        setupRoom(roomX);
        chars.create(char(charA, { name: 'Alice', currentRoomId: roomX }));

        const agent = setupAgent(charA);

        let captured: { role: string; content: string }[] = [];
        factory.register('openai', fakeProvider(async ({ messages }) => {
            captured = messages;
            return { text: 'I kneel.', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({
            agentId: agent.id,
            remoteContact: {
                method: 'voice_of_god',
                payload: 'You hear the System speak: prepare.',
                oneWay: true
            }
        }, deps);

        expect(result.status).toBe('ok');
        const userMsg = captured.find(m => m.role === 'user');
        expect(userMsg!.content.toLowerCase()).toContain('voice_of_god');
    });

    // ───────── compatibility / strict modes ─────────

    it('no_scene_context_default_compatibility_mode_allows_invoke', async () => {
        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        chars.create(char(charA, { name: 'Alice' }));

        const agent = setupAgent(charA);

        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: 'I look around.', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({ agentId: agent.id, situation: 'introspect' }, deps);

        expect(called).toBe(true);
        expect(result.status).toBe('ok');
    });

    it('no_scene_context_strict_mode_skips', async () => {
        process.env.AGENT_SCENE_STRICT = 'true';

        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        chars.create(char(charA, { name: 'Alice' }));

        const agent = setupAgent(charA);

        let called = false;
        factory.register('openai', fakeProvider(async () => {
            called = true;
            return { text: 'should not run', raw: '{}', durationMs: 1 };
        }));

        const result = await invokeAgent({ agentId: agent.id }, deps);

        expect(called).toBe(false);
        expect(result.status).toBe('skipped');
        expect(result.reason).toContain('no_scene_context');
    });

    // ───────── safety property ─────────

    it('skipped_invoke_never_throws_never_breaks_caller', async () => {
        const chars = new CharacterRepository(db);
        const charA = randomUUID();
        const cellar = randomUUID();
        setupRoom(cellar);
        const tavern = randomUUID();
        setupRoom(tavern);
        chars.create(char(charA, { name: 'Alice', currentRoomId: cellar }));

        const agent = setupAgent(charA);

        factory.register('openai', fakeProvider(async () => {
            throw new Error('provider invoked despite skip');
        }));

        // Should return a structured result rather than throw.
        const promise = invokeAgent({ agentId: agent.id, sceneId: tavern }, deps);
        await expect(promise).resolves.toBeDefined();
        const result = await promise;
        expect(result.status).toBe('skipped');
    });
});
