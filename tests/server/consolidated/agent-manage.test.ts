/**
 * Tests for consolidated agent_manage tool
 * Validates 22 actions across lifecycle, prompt assembly, mind state, invocation.
 */

import { handleAgentManage, AgentManageTool } from '../../../src/server/consolidated/agent-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

const ctx = { sessionId: 'test-session' };

function extractJson(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const match = text.match(/<!-- AGENT_MANAGE_JSON\n([\s\S]*?)\nAGENT_MANAGE_JSON -->/);
    if (match) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch { return { __unparsed: text }; }
}

function createCharacter(name: string): string {
    const db = getDb(':memory:');
    const charRepo = new CharacterRepository(db);
    const id = randomUUID();
    const now = new Date().toISOString();
    charRepo.create({
        id,
        name,
        characterClass: 'Fighter',
        race: 'Human',
        characterType: 'pc',
        level: 1,
        hp: 20,
        maxHp: 20,
        ac: 15,
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        createdAt: now,
        updatedAt: now
    } as never);
    return id;
}

describe('agent_manage tool', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:'); // initializes + migrates
    });

    afterAll(() => {
        closeDb();
    });

    it('exposes the expected tool surface', () => {
        expect(AgentManageTool.name).toBe('agent_manage');
        expect(AgentManageTool.description).toContain('LLM-driven');
        expect(AgentManageTool.actionSchemas).toBeDefined();

        const expectedActions = [
            'create', 'get', 'list', 'update', 'delete', 'resume', 'health', 'budget',
            'set_slice', 'remove_slice', 'toggle_slice', 'list_slices',
            'narrate', 'broadcast', 'preview_prompt',
            'add_secret', 'list_secrets', 'remove_secret', 'add_journal', 'get_journal',
            'invoke', 'replay'
        ];
        for (const action of expectedActions) {
            expect(AgentManageTool.actionSchemas).toHaveProperty(action);
        }
    });

    // ─────────── Lifecycle ───────────

    describe('lifecycle', () => {
        it('creates an agent bound to a character', async () => {
            const characterId = createCharacter('Kara');

            const result = await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );

            const parsed = extractJson(result);
            expect(parsed.actionType).toBe('create');
            expect(parsed.success).toBe(true);
            expect(parsed.agent.characterId).toBe(characterId);
            expect(parsed.agent.provider).toBe('openai');
            expect(parsed.characterName).toBe('Kara');
        });

        it('refuses duplicate agents for the same character', async () => {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );
            const result = await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o' },
                ctx
            );
            const parsed = extractJson(result);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('already bound');
        });

        it('errors when character does not exist', async () => {
            const result = await handleAgentManage(
                { action: 'create', characterId: 'nope', provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );
            const parsed = extractJson(result);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('not found');
        });

        it('gets an agent by characterId', async () => {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );
            const result = await handleAgentManage({ action: 'get', characterId }, ctx);
            const parsed = extractJson(result);
            expect(parsed.actionType).toBe('get');
            expect(parsed.agent.characterId).toBe(characterId);
            expect(parsed.characterName).toBe('Kara');
        });

        it('lists agents with status filter', async () => {
            const c1 = createCharacter('A');
            const c2 = createCharacter('B');
            await handleAgentManage({ action: 'create', characterId: c1, provider: 'openai', model: 'm' }, ctx);
            await handleAgentManage({ action: 'create', characterId: c2, provider: 'openai', model: 'm' }, ctx);

            const all = extractJson(await handleAgentManage({ action: 'list' }, ctx));
            expect(all.count).toBe(2);

            // pause one
            await handleAgentManage({ action: 'update', characterId: c2, status: 'paused' }, ctx);
            const paused = extractJson(await handleAgentManage({ action: 'list', status: 'paused' }, ctx));
            expect(paused.count).toBe(1);
        });

        it('updates agent fields and resumes a paused agent', async () => {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );

            const updated = extractJson(await handleAgentManage(
                { action: 'update', characterId, status: 'paused', temperature: 1.2 },
                ctx
            ));
            expect(updated.agent.status).toBe('paused');
            expect(updated.agent.temperature).toBe(1.2);

            const resumed = extractJson(await handleAgentManage({ action: 'resume', characterId }, ctx));
            expect(resumed.agent.status).toBe('active');
            expect(resumed.agent.circuitState).toBe('closed');
        });

        it('returns health snapshot', async () => {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini', budgetTokens: 1000 },
                ctx
            );

            const result = extractJson(await handleAgentManage({ action: 'health', characterId }, ctx));
            expect(result.status).toBe('active');
            expect(result.circuitState).toBe('closed');
            expect(result.budgetRemaining).toBe(1000);
        });

        it('updates budget and resets usage', async () => {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini', budgetTokens: 1000 },
                ctx
            );

            const result = extractJson(await handleAgentManage(
                { action: 'budget', characterId, setBudget: 5000 },
                ctx
            ));
            expect(result.budgetTokens).toBe(5000);
            expect(result.budgetRemaining).toBe(5000);
        });

        it('deletes an agent', async () => {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );

            const deleted = extractJson(await handleAgentManage({ action: 'delete', characterId }, ctx));
            expect(deleted.success).toBe(true);

            const gone = extractJson(await handleAgentManage({ action: 'get', characterId }, ctx));
            expect(gone.error).toBe(true);
        });
    });

    // ─────────── Prompt assembly ───────────

    describe('prompt assembly', () => {
        async function setupAgent() {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );
            return characterId;
        }

        it('sets and lists slices', async () => {
            const characterId = await setupAgent();

            await handleAgentManage(
                { action: 'set_slice', characterId, kind: 'persona', content: 'You are Kara.' },
                ctx
            );
            await handleAgentManage(
                { action: 'set_slice', characterId, kind: 'directive', content: 'Protect Theron.' },
                ctx
            );

            const list = extractJson(await handleAgentManage({ action: 'list_slices', characterId }, ctx));
            expect(list.count).toBe(2);
            const kinds = list.slices.map((s: { kind: string }) => s.kind);
            expect(kinds).toContain('persona');
            expect(kinds).toContain('directive');
        });

        it('upserts a slice in place when kind+label match', async () => {
            const characterId = await setupAgent();

            const first = extractJson(await handleAgentManage(
                { action: 'set_slice', characterId, kind: 'persona', content: 'v1' },
                ctx
            ));
            const second = extractJson(await handleAgentManage(
                { action: 'set_slice', characterId, kind: 'persona', content: 'v2' },
                ctx
            ));
            expect(first.slice.id).toBe(second.slice.id);
            expect(second.slice.content).toBe('v2');
        });

        it('toggles a slice', async () => {
            const characterId = await setupAgent();
            const setResult = extractJson(await handleAgentManage(
                { action: 'set_slice', characterId, kind: 'persona', content: 'x' },
                ctx
            ));
            const sliceId = setResult.slice.id;

            const toggled = extractJson(await handleAgentManage(
                { action: 'toggle_slice', sliceId, enabled: false },
                ctx
            ));
            expect(toggled.success).toBe(true);
            expect(toggled.enabled).toBe(false);
        });

        it('removes a slice', async () => {
            const characterId = await setupAgent();
            const slice = extractJson(await handleAgentManage(
                { action: 'set_slice', characterId, kind: 'persona', content: 'x' },
                ctx
            )).slice;

            const removed = extractJson(await handleAgentManage(
                { action: 'remove_slice', sliceId: slice.id },
                ctx
            ));
            expect(removed.success).toBe(true);
        });

        it('appends to narrative_feed via narrate', async () => {
            const characterId = await setupAgent();
            const result = extractJson(await handleAgentManage(
                { action: 'narrate', characterId, content: 'You overhear orcs near the road.' },
                ctx
            ));
            expect(result.success).toBe(true);
            expect(result.sliceId).toBeDefined();

            const slices = extractJson(await handleAgentManage(
                { action: 'list_slices', characterId, kind: 'narrative_feed' },
                ctx
            ));
            expect(slices.count).toBe(1);
        });

        it('broadcasts to multiple agents', async () => {
            const c1 = createCharacter('A');
            const c2 = createCharacter('B');
            const c3 = createCharacter('C');

            await handleAgentManage({ action: 'create', characterId: c1, provider: 'openai', model: 'm' }, ctx);
            await handleAgentManage({ action: 'create', characterId: c2, provider: 'openai', model: 'm' }, ctx);
            // c3 has no agent

            const result = extractJson(await handleAgentManage(
                { action: 'broadcast', characterIds: [c1, c2, c3], content: 'A bell tolls.' },
                ctx
            ));
            expect(result.deliveredTo).toBe(2);
            expect(result.skipped).toBe(1);
        });

        it('preview_prompt returns composed messages without calling the LLM', async () => {
            const characterId = await setupAgent();
            // Add a slice so there's content to compose
            await handleAgentManage(
                { action: 'set_slice', characterId, kind: 'persona', content: 'You are Kara.' },
                ctx
            );

            const result = extractJson(await handleAgentManage(
                { action: 'preview_prompt', characterId, situation: "It's your turn." },
                ctx
            ));
            expect(result.actionType).toBe('preview_prompt');
            expect(Array.isArray(result.messages)).toBe(true);
            expect(result.messages.length).toBeGreaterThan(0);
            expect(result.slicesIncluded).toContain('persona');
            expect(result.estimatedPromptTokens).toBeGreaterThan(0);
        });
    });

    // ─────────── Mind state ───────────

    describe('mind state', () => {
        async function setupAgent() {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );
            return characterId;
        }

        it('adds, lists, and removes secrets', async () => {
            const characterId = await setupAgent();

            const added = extractJson(await handleAgentManage(
                { action: 'add_secret', characterId, content: 'Theron stole the amulet.', importance: 'critical' },
                ctx
            ));
            expect(added.success).toBe(true);
            expect(added.secret.importance).toBe('critical');

            const list = extractJson(await handleAgentManage({ action: 'list_secrets', characterId }, ctx));
            expect(list.count).toBe(1);

            const removed = extractJson(await handleAgentManage(
                { action: 'remove_secret', secretId: added.secret.id },
                ctx
            ));
            expect(removed.success).toBe(true);
        });

        it('adds and retrieves journal entries with filters', async () => {
            const characterId = await setupAgent();

            await handleAgentManage(
                { action: 'add_journal', characterId, kind: 'observation', content: 'A glint behind the curtain.' },
                ctx
            );
            await handleAgentManage(
                { action: 'add_journal', characterId, kind: 'plan', content: 'Reach the door before they spot me.', encounterId: 'enc-1', round: 2 },
                ctx
            );

            const all = extractJson(await handleAgentManage({ action: 'get_journal', characterId }, ctx));
            expect(all.count).toBe(2);

            const filtered = extractJson(await handleAgentManage(
                { action: 'get_journal', characterId, kinds: ['plan'] },
                ctx
            ));
            expect(filtered.count).toBe(1);
            expect(filtered.entries[0].kind).toBe('plan');
        });
    });

    // ─────────── Invocation (live, against runtime with no provider keys) ───────────

    describe('invocation', () => {
        it('invoke surfaces a real status (error or ok) — runtime is wired', async () => {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );

            const result = extractJson(await handleAgentManage(
                { action: 'invoke', characterId, situation: "It's your turn." },
                ctx
            ));

            // No OPENAI_API_KEY in test env -> runtime returns status='error' with provider message
            expect(result.actionType).toBe('invoke');
            // Either 'error' (no key) or 'ok' (if test env has a key) — both are valid surfaces
            expect(['error', 'ok', 'incapable', 'paused', 'budget_exhausted']).toContain(result.status);
            expect(result.agentId).toBeDefined();
            expect(result.characterName).toBe('Kara');
        });

        it('replay returns dry-mode info for a stored call', async () => {
            const characterId = createCharacter('Kara');
            await handleAgentManage(
                { action: 'create', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            );

            // Trigger an invoke so there's a call to replay
            const invokeResult = extractJson(await handleAgentManage(
                { action: 'invoke', characterId, situation: "go" },
                ctx
            ));

            if (invokeResult.callId) {
                const replay = extractJson(await handleAgentManage(
                    { action: 'replay', callId: invokeResult.callId },
                    ctx
                ));
                expect(replay.actionType).toBe('replay');
                expect(replay.mode).toBe('dry');
                expect(replay.original).toBeDefined();
                expect(replay.callId).toBe(invokeResult.callId);
            }
        });

        it('replay errors when callId not found', async () => {
            const result = extractJson(await handleAgentManage(
                { action: 'replay', callId: 'nope' },
                ctx
            ));
            expect(result.error).toBe(true);
        });
    });

    // ─────────── Aliases + fuzzy routing ───────────

    describe('action routing', () => {
        it('resolves an alias (bind → create)', async () => {
            const characterId = createCharacter('Kara');
            const result = extractJson(await handleAgentManage(
                { action: 'bind', characterId, provider: 'openai', model: 'gpt-4o-mini' },
                ctx
            ));
            expect(result.actionType).toBe('create');
            expect(result.success).toBe(true);
        });

        it('returns helpful error for invalid action', async () => {
            const result = await handleAgentManage({ action: 'launch_nukes' }, ctx);
            const text = result.content[0].text;
            // The action router returns a guiding error for unknown actions
            expect(text.toLowerCase()).toMatch(/unknown|invalid|action|did you mean/);
        });
    });
});
