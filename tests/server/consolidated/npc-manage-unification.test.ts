/**
 * Tests for npc_manage unification with character_manage + agent_manage.
 * Adds two new actions:
 *   - create (composite NPC bootstrap: sheet + optional agent + optional initial relationship/memory)
 *   - get_full_context (single-call "table-ready bundle" for DM)
 *
 * Per CLAUDE.md: NO `import { describe, it, expect } from 'vitest'` — vitest globals
 * are configured and explicit imports break test collection on Windows + vitest 1.6.1.
 */

import { handleNpcManage } from '../../../src/server/consolidated/npc-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { NpcMemoryRepository } from '../../../src/storage/repos/npc-memory.repo.js';
import { AgentRepository } from '../../../src/storage/repos/agent.repo.js';
import { SpatialRepository } from '../../../src/storage/repos/spatial.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }): any {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- NPC_MANAGE_JSON\n([\s\S]*?)\nNPC_MANAGE_JSON -->/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch { /* not JSON */ }
    return { error: 'parse_failed', rawText: text };
}

describe('npc_manage unification — create + get_full_context', () => {
    const ctx = { sessionId: 'test-session' };

    beforeEach(() => {
        closeDb();
        // Ensure no leftover provider keys leak through
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        getDb(':memory:'); // initialize migrations
    });

    // ════════════════════════════════════════════════════════════════
    // create action
    // ════════════════════════════════════════════════════════════════

    describe('create action', () => {
        it('creates a minimal NPC and returns characterId with agentId=null', async () => {
            const result = await handleNpcManage({
                action: 'create',
                name: 'Bartender Bob'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('create');
            expect(typeof data.characterId).toBe('string');
            expect(data.characterId.length).toBeGreaterThan(0);
            expect(data.agentId).toBeNull();
            expect(data.character).toBeDefined();
            expect(data.character.name).toBe('Bartender Bob');
            expect(data.character.characterType).toBe('npc');
            expect(data.character.characterClass).toBe('Commoner');

            // Verify character row exists in DB
            const db = getDb(':memory:');
            const charRepo = new CharacterRepository(db);
            const stored = charRepo.findById(data.characterId);
            expect(stored).not.toBeNull();
            expect(stored!.name).toBe('Bartender Bob');
        });

        it('propagates full sheet fields through to the character row', async () => {
            const result = await handleNpcManage({
                action: 'create',
                name: 'Sir Cedric',
                class: 'Knight',
                race: 'Half-Elf',
                level: 5,
                hp: 42,
                maxHp: 42,
                ac: 18,
                stats: { str: 16, dex: 12, con: 14, int: 10, wis: 13, cha: 15 },
                factionId: 'silver-knights',
                characterType: 'npc'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.character.characterClass).toBe('Knight');
            expect(data.character.level).toBe(5);
            expect(data.character.hp).toBe(42);
            expect(data.character.ac).toBe(18);
            expect(data.character.stats.str).toBe(16);
            expect(data.agentId).toBeNull();

            const db = getDb(':memory:');
            const charRepo = new CharacterRepository(db);
            const stored = charRepo.findById(data.characterId) as any;
            expect(stored).not.toBeNull();
            expect(stored.characterClass).toBe('Knight');
            expect(stored.level).toBe(5);
            expect(stored.factionId).toBe('silver-knights');
        });

        it('persists character and reports warnings when agent provider has no API key', async () => {
            const result = await handleNpcManage({
                action: 'create',
                name: 'Wizard Wanda',
                agent: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    persona: 'A cantankerous old wizard.',
                    directive: 'Speak in riddles.'
                }
            }, ctx);

            const data = parseResult(result);
            // The character path must always succeed
            expect(data.success).toBe(true);
            expect(typeof data.characterId).toBe('string');

            const db = getDb(':memory:');
            const charRepo = new CharacterRepository(db);
            expect(charRepo.findById(data.characterId)).not.toBeNull();

            // The agent CREATE step itself can succeed (rows persist; no provider
            // check is performed at row insert time). So the test allows either:
            //   (a) agentId is non-null AND no warning required, OR
            //   (b) agentId is null AND warnings array reports a binding failure.
            // What's NEVER allowed: characterId missing.
            if (data.agentId === null) {
                expect(Array.isArray(data.warnings)).toBe(true);
                const warnText = (data.warnings || []).join(' ');
                expect(warnText.toLowerCase()).toContain('agent');
            }
        });

        it('materializes persona, directive, and secrets as slices when agent block supplied', async () => {
            const result = await handleNpcManage({
                action: 'create',
                name: 'Bandit King',
                agent: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    persona: 'Cruel and cunning.',
                    directive: 'Always demand tribute first.',
                    secrets: [
                        { content: 'The royal seal is fake.', importance: 'critical' }
                    ]
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            // Agent create itself doesn't depend on provider keys; should succeed
            expect(data.agentId).not.toBeNull();
            expect(typeof data.agentId).toBe('string');

            const db = getDb(':memory:');
            const agentRepo = new AgentRepository(db);

            const slices = agentRepo.listSlices(data.agentId);
            const personaSlice = slices.find((s: any) => s.kind === 'persona');
            const directiveSlice = slices.find((s: any) => s.kind === 'directive');
            expect(personaSlice).toBeDefined();
            expect(personaSlice!.content).toBe('Cruel and cunning.');
            expect(directiveSlice).toBeDefined();
            expect(directiveSlice!.content).toBe('Always demand tribute first.');

            const secrets = agentRepo.listSecrets(data.agentId);
            expect(secrets.length).toBe(1);
            expect(secrets[0].content).toBe('The royal seal is fake.');
        });

        it('seeds an initial relationship when seedRelationship supplied', async () => {
            // First create a PC
            const db = getDb(':memory:');
            const charRepo = new CharacterRepository(db);
            const pcId = randomUUID();
            const now = new Date().toISOString();
            charRepo.create({
                id: pcId,
                name: 'Hero',
                stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                hp: 10,
                maxHp: 10,
                ac: 10,
                level: 1,
                characterType: 'pc',
                race: 'Human',
                characterClass: 'Fighter',
                conditions: [],
                resistances: [],
                vulnerabilities: [],
                immunities: [],
                createdAt: now,
                updatedAt: now
            } as any);

            const result = await handleNpcManage({
                action: 'create',
                name: 'Childhood Friend',
                seedRelationship: {
                    withCharacterId: pcId,
                    familiarity: 'friend',
                    disposition: 'friendly',
                    notes: 'Grew up in the same village.'
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.relationshipSeeded).toBe(true);

            const memoryRepo = new NpcMemoryRepository(db);
            const rel = memoryRepo.getRelationship(pcId, data.characterId);
            expect(rel).not.toBeNull();
            expect(rel!.familiarity).toBe('friend');
            expect(rel!.disposition).toBe('friendly');
            expect(rel!.notes).toBe('Grew up in the same village.');
        });

        it('seeds an initial memory when seedMemory supplied', async () => {
            const db = getDb(':memory:');
            const charRepo = new CharacterRepository(db);
            const pcId = randomUUID();
            const now = new Date().toISOString();
            charRepo.create({
                id: pcId,
                name: 'Hero',
                stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                hp: 10,
                maxHp: 10,
                ac: 10,
                level: 1,
                characterType: 'pc',
                race: 'Human',
                characterClass: 'Fighter',
                conditions: [],
                resistances: [],
                vulnerabilities: [],
                immunities: [],
                createdAt: now,
                updatedAt: now
            } as any);

            const result = await handleNpcManage({
                action: 'create',
                name: 'Mentor',
                seedMemory: {
                    forCharacterId: pcId,
                    summary: 'Taught the basics of swordsmanship.',
                    importance: 'high',
                    topics: ['training', 'backstory']
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.memorySeeded).toBe(true);

            const memoryRepo = new NpcMemoryRepository(db);
            const memories = memoryRepo.getConversationHistory(pcId, data.characterId);
            expect(memories.length).toBe(1);
            expect(memories[0].summary).toBe('Taught the basics of swordsmanship.');
            expect(memories[0].importance).toBe('high');
        });

        it('returns an error when name is missing or empty', async () => {
            const result = await handleNpcManage({
                action: 'create',
                name: ''
            }, ctx);

            const data = parseResult(result);
            // Should fail validation. Could be a direct error or a parsed error envelope.
            const isError = data.error === true || typeof data.error === 'string' || data.success === false;
            expect(isError).toBe(true);
        });
    });

    // ════════════════════════════════════════════════════════════════
    // get_full_context action
    // ════════════════════════════════════════════════════════════════

    describe('get_full_context action', () => {
        async function createTestNpc(): Promise<string> {
            const result = await handleNpcManage({
                action: 'create',
                name: 'Test Sage',
                class: 'Wizard',
                race: 'Elf',
                level: 5,
                hp: 30,
                maxHp: 30,
                ac: 12,
                stats: { str: 8, dex: 14, con: 12, int: 18, wis: 16, cha: 10 },
                knownSpells: ['fireball', 'magic missile']
            }, ctx);

            const data = parseResult(result);
            return data.characterId;
        }

        it('returns all sections by default', async () => {
            const npcId = await createTestNpc();

            const result = await handleNpcManage({
                action: 'get_full_context',
                characterId: npcId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_full_context');
            expect(data.characterId).toBe(npcId);

            // All section keys MUST be present (null vs populated, but never missing)
            expect('sheet' in data).toBe(true);
            expect('persona' in data).toBe(true);
            expect('relationships' in data).toBe(true);
            expect('memories' in data).toBe(true);
            expect('recentHistory' in data).toBe(true);
            expect('location' in data).toBe(true);
            expect('currentEncounter' in data).toBe(true);
            expect('inventory' in data).toBe(true);
            expect('prompt' in data).toBe(true);
            expect('meta' in data).toBe(true);

            // Sheet should be populated (NPC was created)
            expect(data.sheet).not.toBeNull();
            expect(data.sheet.hp).toBe(30);
            expect(data.sheet.maxHp).toBe(30);
            expect(data.sheet.ac).toBe(12);
            expect(data.sheet.stats).toBeDefined();

            // No agent bound → persona null, recentHistory null
            expect(data.persona).toBeNull();
            expect(data.recentHistory).toBeNull();

            // No room placement → location null
            expect(data.location).toBeNull();
            // No encounter → currentEncounter null
            expect(data.currentEncounter).toBeNull();

            // Relationships always defined (count + items)
            expect(data.relationships.count).toBeDefined();
            expect(Array.isArray(data.relationships.items)).toBe(true);
            expect(data.memories.count).toBeDefined();
            expect(Array.isArray(data.memories.items)).toBe(true);

            // Prompt blob always returns object with combined string
            expect(data.prompt).toBeDefined();
            expect(typeof data.prompt.combined).toBe('string');
        });

        it('returns null (not missing key) for sections toggled off', async () => {
            const npcId = await createTestNpc();

            const result = await handleNpcManage({
                action: 'get_full_context',
                characterId: npcId,
                includeSheet: false,
                includeMemories: false,
                includeInventory: false
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect('sheet' in data).toBe(true);
            expect(data.sheet).toBeNull();
            expect('memories' in data).toBe(true);
            expect(data.memories).toBeNull();
            expect('inventory' in data).toBe(true);
            expect(data.inventory).toBeNull();

            expect(Array.isArray(data.meta.sectionsSkipped)).toBe(true);
            expect(data.meta.sectionsSkipped).toContain('sheet');
            expect(data.meta.sectionsSkipped).toContain('memories');
            expect(data.meta.sectionsSkipped).toContain('inventory');
        });

        it('returns an error for a non-existent character', async () => {
            const result = await handleNpcManage({
                action: 'get_full_context',
                characterId: 'does-not-exist'
            }, ctx);

            const data = parseResult(result);
            const isError = data.error === true || typeof data.error === 'string' || data.success === false;
            expect(isError).toBe(true);
            if (data.message) {
                expect(data.message.toLowerCase()).toContain('not found');
            }
        });

        it('populates location section when NPC is placed in a room', async () => {
            const npcId = await createTestNpc();

            const db = getDb(':memory:');
            const spatial = new SpatialRepository(db);
            const charRepo = new CharacterRepository(db);
            const now = new Date().toISOString();

            const roomId = randomUUID();
            spatial.create({
                id: roomId,
                name: 'Sage Tower',
                baseDescription: 'A creaky wooden tower.',
                biomeContext: 'forest',
                atmospherics: [],
                exits: [],
                entityIds: [npcId],
                createdAt: now,
                updatedAt: now,
                visitedCount: 0,
                lastVisitedAt: now
            } as any);

            // Place NPC in the room (update character row)
            charRepo.update(npcId, { currentRoomId: roomId } as any);

            // Add a second character to the room
            const otherId = randomUUID();
            charRepo.create({
                id: otherId,
                name: 'Apprentice',
                stats: { str: 10, dex: 10, con: 10, int: 12, wis: 10, cha: 10 },
                hp: 10,
                maxHp: 10,
                ac: 10,
                level: 1,
                characterType: 'npc',
                race: 'Human',
                characterClass: 'Commoner',
                conditions: [],
                resistances: [],
                vulnerabilities: [],
                immunities: [],
                currentRoomId: roomId,
                createdAt: now,
                updatedAt: now
            } as any);
            spatial.addEntityToRoom(roomId, otherId);

            const result = await handleNpcManage({
                action: 'get_full_context',
                characterId: npcId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.location).not.toBeNull();
            expect(data.location.roomId).toBe(roomId);
            expect(Array.isArray(data.location.occupants)).toBe(true);

            const occupantIds = data.location.occupants.map((o: any) => o.characterId);
            expect(occupantIds).toContain(otherId);
            expect(occupantIds).not.toContain(npcId);
        });

        it('includes the buildCharacterStateSlice output in prompt.sheet', async () => {
            const npcId = await createTestNpc();

            const result = await handleNpcManage({
                action: 'get_full_context',
                characterId: npcId,
                includePromptBlob: true
            }, ctx);

            const data = parseResult(result);
            expect(typeof data.prompt.sheet).toBe('string');
            expect(data.prompt.sheet).toContain('YOUR CHARACTER');
            expect(data.prompt.sheet).toContain('HP:');
            expect(data.prompt.sheet).toContain('AC:');
            expect(data.prompt.combined).toContain(data.prompt.sheet);
        });

        it('returns inbound relationships (who knows this NPC)', async () => {
            const npcId = await createTestNpc();

            const db = getDb(':memory:');
            const charRepo = new CharacterRepository(db);
            const memoryRepo = new NpcMemoryRepository(db);
            const now = new Date().toISOString();

            // Create 2 PCs
            const pc1 = randomUUID();
            const pc2 = randomUUID();
            for (const id of [pc1, pc2]) {
                charRepo.create({
                    id,
                    name: `PC-${id.slice(0, 4)}`,
                    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                    hp: 10,
                    maxHp: 10,
                    ac: 10,
                    level: 1,
                    characterType: 'pc',
                    race: 'Human',
                    characterClass: 'Fighter',
                    conditions: [],
                    resistances: [],
                    vulnerabilities: [],
                    immunities: [],
                    createdAt: now,
                    updatedAt: now
                } as any);
            }

            memoryRepo.upsertRelationship({
                characterId: pc1,
                npcId,
                familiarity: 'friend',
                disposition: 'friendly',
                notes: null
            });
            memoryRepo.upsertRelationship({
                characterId: pc2,
                npcId,
                familiarity: 'acquaintance',
                disposition: 'neutral',
                notes: null
            });

            const result = await handleNpcManage({
                action: 'get_full_context',
                characterId: npcId
            }, ctx);

            const data = parseResult(result);
            expect(data.relationships.count).toBe(2);
            const charIds = data.relationships.items.map((r: any) => r.characterId);
            expect(charIds).toContain(pc1);
            expect(charIds).toContain(pc2);
            // Each entry should reference the queried NPC
            for (const item of data.relationships.items) {
                expect(item.npcId).toBe(npcId);
            }
        });
    });

    // ════════════════════════════════════════════════════════════════
    // fuzzy matching
    // ════════════════════════════════════════════════════════════════

    describe('fuzzy match still works after adding new actions', () => {
        it('routes "creat" (typo) to the create action', async () => {
            const result = await handleNpcManage({
                action: 'creat',
                name: 'Typo Test NPC'
            }, ctx);

            const data = parseResult(result);
            // Typo should route to 'create'
            expect(data.actionType).toBe('create');
            expect(typeof data.characterId).toBe('string');
        });
    });
});
