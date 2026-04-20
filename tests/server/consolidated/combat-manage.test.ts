/**
 * Tests for consolidated combat_manage tool
 * Validates all 7 actions: create, get, end, load, advance, death_save, lair_action
 */

import { handleCombatManage, CombatManageTool } from '../../../src/server/consolidated/combat-manage.js';
import { clearCombatState } from '../../../src/server/handlers/combat-handlers.js';
import { getDb } from '../../../src/storage/index.js';
import { randomUUID } from 'crypto';

// Force test mode
process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    // Try COMBAT_MANAGE_JSON format first
    const jsonMatch = text.match(/<!-- COMBAT_MANAGE_JSON\n([\s\S]*?)\nCOMBAT_MANAGE_JSON -->/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
    }
    // Fall back to raw JSON (error responses from router)
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
    } catch {
        // Not valid JSON
    }
    return { error: 'parse_failed', rawText: text };
}

describe('combat_manage consolidated tool', () => {
    const ctx = { sessionId: `test-session-${randomUUID()}` };
    let testEncounterId: string;

    beforeEach(async () => {
        // Reset test database
        const db = getDb(':memory:');
        db.exec('DELETE FROM encounters');

        // Clear in-memory combat state
        clearCombatState();
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(CombatManageTool.name).toBe('combat_manage');
        });

        it('should list all available actions in description', () => {
            expect(CombatManageTool.description).toContain('create');
            expect(CombatManageTool.description).toContain('get');
            expect(CombatManageTool.description).toContain('end');
            expect(CombatManageTool.description).toContain('load');
            expect(CombatManageTool.description).toContain('advance');
            expect(CombatManageTool.description).toContain('death_save');
            expect(CombatManageTool.description).toContain('lair_action');
        });
    });

    describe('create action', () => {
        it('should create a new encounter', async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'test-battle-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Test Hero',
                        initiativeBonus: 2,
                        hp: 30,
                        maxHp: 30,
                        isEnemy: false,
                        conditions: [],
                        position: { x: 5, y: 5 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 7,
                        maxHp: 7,
                        isEnemy: true,
                        conditions: [],
                        position: { x: 10, y: 10 }
                    }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('create');
            expect(data.encounterId).toContain('test-battle-1');

            // Store for later tests
            testEncounterId = data.encounterId;
        });

        it('should create encounter with terrain', async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'terrain-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 0, hp: 20, maxHp: 20 }
                ],
                terrain: {
                    obstacles: ['5,5', '5,6', '5,7'],
                    water: ['10,10', '10,11']
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        // Regression for issue #46: side="enemy" was silently dropped, leaving
        // isEnemy=undefined → false. Enemies showed as PCs in the turn prompt.
        it('honors participant `side` as alias for isEnemy', async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'side-alias-test',
                participants: [
                    { id: 'pc-vela', name: 'Vela', initiativeBonus: 0, hp: 38, maxHp: 38, side: 'party', position: { x: 1, y: 1 } },
                    { id: 'pc-tobin', name: 'Tobin', initiativeBonus: 4, hp: 28, maxHp: 28, side: 'ally', position: { x: 1, y: 2 } },
                    { id: 'enemy-rurk', name: 'Rurk', initiativeBonus: 1, hp: 22, maxHp: 22, side: 'enemy', position: { x: 5, y: 5 } },
                    { id: 'enemy-mira', name: 'Mira', initiativeBonus: 2, hp: 16, maxHp: 16, side: 'hostile', position: { x: 6, y: 5 } }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);

            const byId = Object.fromEntries(
                (data.participants as Array<{ id: string; isEnemy: boolean }>).map((p) => [p.id, p.isEnemy])
            );
            expect(byId['pc-vela']).toBe(false);
            expect(byId['pc-tobin']).toBe(false);
            expect(byId['enemy-rurk']).toBe(true);
            expect(byId['enemy-mira']).toBe(true);
        });

        it('explicit isEnemy wins over side when both are supplied', async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'side-conflict-test',
                participants: [
                    { id: 'overridden', name: 'Override', initiativeBonus: 0, hp: 10, maxHp: 10, side: 'enemy', isEnemy: false }
                ]
            }, ctx);

            const data = parseResult(result);
            const p = (data.participants as Array<{ id: string; isEnemy: boolean }>).find((x) => x.id === 'overridden');
            expect(p?.isEnemy).toBe(false);
        });

        // Regression for issue #48: spawn_quick_enemy with encounterId was
        // ignoring the id and creating a fresh encounter, leaving PCs without
        // opponents in the original.
        it('spawn_quick_enemy appends to existing encounter when encounterId is set', async () => {
            // Create encounter with PCs only
            const createResult = await handleCombatManage({
                action: 'create',
                seed: 'spawn-append-test',
                participants: [
                    { id: 'pc-hero', name: 'Hero', initiativeBonus: 3, hp: 30, maxHp: 30, isEnemy: false, position: { x: 0, y: 0 } }
                ]
            }, ctx);
            const originalId = parseResult(createResult).encounterId;

            // Spawn goblins into the same encounter
            const spawnResult = await handleCombatManage({
                action: 'spawn_quick_enemy',
                encounterId: originalId,
                creature: 'goblin',
                count: 2,
                position: { x: 10, y: 10 }
            }, ctx);
            const spawnData = parseResult(spawnResult);

            expect(spawnData.success).toBe(true);
            expect(spawnData.appendedToExisting).toBe(true);
            expect(spawnData.encounterId).toBe(originalId);
            expect(spawnData.spawnedCount).toBe(2);
            // Original encounter now has PC + 2 goblins = 3 participants
            expect(spawnData.turnOrder.length).toBe(3);
        });

        // Reviewer follow-ups on PR #58:
        // - currentTurn must come from turnOrder index, not participants[i]?.id.
        // - Auto-load from DB when the in-memory engine is gone.
        it('spawn_quick_enemy currentTurn comes from turnOrder index', async () => {
            const createResult = await handleCombatManage({
                action: 'create',
                seed: 'spawn-currentTurn-test',
                participants: [
                    { id: 'pc-hero', name: 'Hero', initiativeBonus: 5, hp: 30, maxHp: 30, isEnemy: false, position: { x: 0, y: 0 } }
                ]
            }, ctx);
            const originalId = parseResult(createResult).encounterId;

            const spawnResult = await handleCombatManage({
                action: 'spawn_quick_enemy',
                encounterId: originalId,
                creature: 'goblin',
                count: 1
            }, ctx);
            const spawnData = parseResult(spawnResult);

            // currentTurn must remain anchored to the pre-existing actor.
            // (Asserting turnOrder[0] is brittle to initiative re-sorting.)
            expect(spawnData.currentTurn).toBe('pc-hero');
            expect(spawnData.turnOrder).toContain(spawnData.currentTurn);
        });

        it('spawn_quick_enemy auto-loads from DB when engine is evicted from memory', async () => {
            const { getCombatManager } = await import('../../../src/server/state/combat-manager.js');
            const createResult = await handleCombatManage({
                action: 'create',
                seed: 'spawn-autoload-test',
                participants: [
                    { id: 'pc-hero', name: 'Hero', initiativeBonus: 5, hp: 30, maxHp: 30, isEnemy: false, position: { x: 0, y: 0 } }
                ]
            }, ctx);
            const originalId = parseResult(createResult).encounterId;

            // Simulate process restart / context eviction.
            getCombatManager().clear();

            const spawnResult = await handleCombatManage({
                action: 'spawn_quick_enemy',
                encounterId: originalId,
                creature: 'goblin',
                count: 1
            }, ctx);
            const spawnData = parseResult(spawnResult);

            expect(spawnData.success).toBe(true);
            expect(spawnData.appendedToExisting).toBe(true);
            expect(spawnData.loadedFromDb).toBe(true);
            expect(spawnData.encounterId).toBe(originalId);
            expect(spawnData.turnOrder.length).toBe(2);
        });

        // Reviewer follow-up on PR #58: when persistence fails after an
        // in-memory append, we must NOT return success — that splits memory
        // and DB state. Roll back the in-memory addParticipants.
        it('spawn_quick_enemy rolls back in-memory append when persistence fails', async () => {
            const { getCombatManager } = await import('../../../src/server/state/combat-manager.js');
            const createResult = await handleCombatManage({
                action: 'create',
                seed: 'spawn-rollback-test',
                participants: [
                    { id: 'pc-hero', name: 'Hero', initiativeBonus: 5, hp: 30, maxHp: 30, isEnemy: false, position: { x: 0, y: 0 } }
                ]
            }, ctx);
            const eid = parseResult(createResult).encounterId;
            const engine = getCombatManager().get(`${ctx.sessionId}:${eid}`)!;
            const beforeCount = engine.getState()!.participants.length;

            // Simulate persistence failure by stubbing saveState to throw.
            const repoMod = await import('../../../src/storage/repos/encounter.repo.js');
            const originalSave = repoMod.EncounterRepository.prototype.saveState;
            repoMod.EncounterRepository.prototype.saveState = function () {
                throw new Error('disk full');
            };

            try {
                const result = await handleCombatManage({
                    action: 'spawn_quick_enemy',
                    encounterId: eid,
                    creature: 'goblin',
                    count: 1
                }, ctx);
                const data = parseResult(result);
                expect(data.error).toBe(true);
                expect(data.rolledBack).toBe(true);
                expect(data.message).toMatch(/persist/i);
                // In-memory state must match what it was before the attempt.
                expect(engine.getState()!.participants.length).toBe(beforeCount);
            } finally {
                repoMod.EncounterRepository.prototype.saveState = originalSave;
            }
        });

        // Reviewer follow-up on PR #58: when an encounterId is supplied but
        // doesn't exist anywhere, return an explicit error. Silent fallback
        // to creating a fresh encounter hides typos / stale ids.
        it('spawn_quick_enemy errors when encounterId is unknown to memory and DB', async () => {
            const spawnResult = await handleCombatManage({
                action: 'spawn_quick_enemy',
                encounterId: 'encounter-does-not-exist-anywhere',
                creature: 'goblin',
                count: 1
            }, ctx);
            const data = parseResult(spawnResult);
            expect(data.error).toBe(true);
            expect(data.message).toMatch(/not found/i);
            expect(data.requestedEncounterId).toBe('encounter-does-not-exist-anywhere');
        });

        it('spawn_quick_enemy still creates a new encounter when encounterId is omitted', async () => {
            const result = await handleCombatManage({
                action: 'spawn_quick_enemy',
                creature: 'goblin',
                count: 1
            }, ctx);
            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.appendedToExisting).toBeUndefined();
            expect(data.encounterId).toBeDefined();
        });

        it('should accept "start" alias', async () => {
            const result = await handleCombatManage({
                action: 'start',
                seed: 'alias-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 0, hp: 20, maxHp: 20 }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        // PR #57 follow-up: damage modifiers must also survive the initial
        // create -> loadState cycle. Dropping resistances/immunities/etc.
        // changes damage resolution after a cold load.
        it('persists resistances/immunities/vulnerabilities into the initial encounter row', async () => {
            const { EncounterRepository } = await import('../../../src/storage/repos/encounter.repo.js');
            const createResult = await handleCombatManage({
                action: 'create',
                seed: 'damage-mods-cold-load',
                participants: [
                    {
                        id: 'fire-elem',
                        name: 'Fire Elemental',
                        initiativeBonus: 0,
                        hp: 30,
                        maxHp: 30,
                        isEnemy: true,
                        resistances: ['bludgeoning', 'piercing', 'slashing'],
                        immunities: ['fire'],
                        vulnerabilities: ['cold']
                    }
                ]
            }, ctx);
            const encounterId = parseResult(createResult).encounterId;

            const repo = new EncounterRepository(getDb(':memory:'));
            const loaded = repo.loadState(encounterId);
            const elem = loaded.participants.find((p: { id: string }) => p.id === 'fire-elem');
            expect(elem?.resistances).toEqual(['bludgeoning', 'piercing', 'slashing']);
            expect(elem?.immunities).toEqual(['fire']);
            expect(elem?.vulnerabilities).toEqual(['cold']);
        });

        // PR #57 follow-up: ensure ac survives an initial create -> loadState
        // round-trip even before any saveState() is called.
        it('persists ac into the initial encounter row (no loss on cold load)', async () => {
            const { EncounterRepository } = await import('../../../src/storage/repos/encounter.repo.js');
            const createResult = await handleCombatManage({
                action: 'create',
                seed: 'ac-persistence-cold-load',
                participants: [
                    { id: 'tanky', name: 'Tank', initiativeBonus: 0, hp: 30, maxHp: 30, ac: 18, isEnemy: false }
                ]
            }, ctx);
            const encounterId = parseResult(createResult).encounterId;

            const repo = new EncounterRepository(getDb(':memory:'));
            const loaded = repo.loadState(encounterId);
            expect(loaded).not.toBeNull();
            const tank = loaded.participants.find((p: { id: string; ac?: number }) => p.id === 'tanky');
            expect(tank?.ac).toBe(18);
        });

        // Regression for issue #47: participant `ac` was being silently dropped
        // by the consolidated schema and never reached the attack resolver. All
        // attacks resolved vs AC 10 regardless of the supplied value.
        it('honors participant `ac` in encounter state', async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'ac-persistence-test',
                participants: [
                    { id: 'tanky-pc', name: 'Tank', initiativeBonus: 0, hp: 38, maxHp: 38, ac: 18, isEnemy: false, position: { x: 0, y: 0 } },
                    { id: 'squishy-enemy', name: 'Bandit', initiativeBonus: 0, hp: 10, maxHp: 10, ac: 11, isEnemy: true, position: { x: 1, y: 0 } }
                ]
            }, ctx);
            const data = parseResult(result);
            expect(data.success).toBe(true);

            const byId = Object.fromEntries(
                (data.participants as Array<{ id: string; ac?: number }>).map((p) => [p.id, p.ac])
            );
            expect(byId['tanky-pc']).toBe(18);
            expect(byId['squishy-enemy']).toBe(11);
        });
    });

    describe('get action', () => {
        beforeEach(async () => {
            // Create an encounter first
            const result = await handleCombatManage({
                action: 'create',
                seed: 'get-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 2, hp: 30, maxHp: 30 },
                    { id: 'goblin-1', name: 'Goblin', initiativeBonus: 1, hp: 7, maxHp: 7, isEnemy: true }
                ]
            }, ctx);
            testEncounterId = parseResult(result).encounterId;
        });

        it('should get encounter state', async () => {
            const result = await handleCombatManage({
                action: 'get',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get');
        });

        it('should accept "state" alias', async () => {
            const result = await handleCombatManage({
                action: 'state',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('advance action', () => {
        beforeEach(async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'advance-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 10, hp: 30, maxHp: 30 },
                    { id: 'goblin-1', name: 'Goblin', initiativeBonus: 1, hp: 7, maxHp: 7, isEnemy: true }
                ]
            }, ctx);
            testEncounterId = parseResult(result).encounterId;
        });

        it('should advance to next turn', async () => {
            const result = await handleCombatManage({
                action: 'advance',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('advance');
        });

        it('should accept "next" alias', async () => {
            const result = await handleCombatManage({
                action: 'next',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('end action', () => {
        beforeEach(async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'end-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 0, hp: 30, maxHp: 30 }
                ]
            }, ctx);
            testEncounterId = parseResult(result).encounterId;
        });

        it('should end the encounter', async () => {
            const result = await handleCombatManage({
                action: 'end',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('end');
        });

        it('should accept "finish" alias', async () => {
            // Create another encounter since previous was ended
            const createResult = await handleCombatManage({
                action: 'create',
                seed: 'finish-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 0, hp: 30, maxHp: 30 }
                ]
            }, ctx);
            const encId = parseResult(createResult).encounterId;

            const result = await handleCombatManage({
                action: 'finish',
                encounterId: encId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('load action', () => {
        beforeEach(async () => {
            // Create an encounter
            const createResult = await handleCombatManage({
                action: 'create',
                seed: 'load-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 0, hp: 30, maxHp: 30 }
                ]
            }, ctx);
            testEncounterId = parseResult(createResult).encounterId;

            // End the encounter to save it to DB
            await handleCombatManage({
                action: 'end',
                encounterId: testEncounterId
            }, ctx);
        });

        it('should load encounter from database', async () => {
            // Clear in-memory state first
            clearCombatState();

            const result = await handleCombatManage({
                action: 'load',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('load');
        });

        it('should accept "resume" alias', async () => {
            clearCombatState();

            const result = await handleCombatManage({
                action: 'resume',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('death_save action', () => {
        beforeEach(async () => {
            // Create encounter with a character at 0 HP
            const result = await handleCombatManage({
                action: 'create',
                seed: 'death-save-test',
                participants: [
                    { id: 'dying-hero', name: 'Dying Hero', initiativeBonus: 0, hp: 0, maxHp: 30 },
                    { id: 'goblin-1', name: 'Goblin', initiativeBonus: 0, hp: 7, maxHp: 7, isEnemy: true }
                ]
            }, ctx);
            testEncounterId = parseResult(result).encounterId;
        });

        it('should roll death save for character at 0 HP', async () => {
            const result = await handleCombatManage({
                action: 'death_save',
                encounterId: testEncounterId,
                characterId: 'dying-hero'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('death_save');
        });

        it('should accept "dying" alias', async () => {
            const result = await handleCombatManage({
                action: 'dying',
                encounterId: testEncounterId,
                characterId: 'dying-hero'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('lair_action action', () => {
        beforeEach(async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'lair-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 0, hp: 30, maxHp: 30 },
                    { id: 'dragon-1', name: 'Dragon', initiativeBonus: 10, hp: 100, maxHp: 100, isEnemy: true }
                ]
            }, ctx);
            testEncounterId = parseResult(result).encounterId;
        });

        it('should route lair_action correctly (may fail on turn timing)', async () => {
            const result = await handleCombatManage({
                action: 'lair_action',
                encounterId: testEncounterId,
                actionDescription: 'Stalactites fall from the ceiling',
                targetIds: ['hero-1'],
                damage: 10,
                damageType: 'bludgeoning',
                savingThrow: { ability: 'dexterity', dc: 15 }
            }, ctx);

            const data = parseResult(result);
            // Lair actions require initiative 20 - we're testing the routing works
            // The action may fail due to turn timing, which is valid game logic
            if (data.error) {
                // Verify it's the expected turn-timing error, not a routing error
                expect(data.message).toContain('lair');
            } else {
                expect(data.success).toBe(true);
                expect(data.actionType).toBe('lair_action');
            }
        });

        it('should accept "lair" alias', async () => {
            const result = await handleCombatManage({
                action: 'lair',
                encounterId: testEncounterId,
                actionDescription: 'The floor erupts with fire'
            }, ctx);

            const data = parseResult(result);
            // Same as above - may fail due to turn timing
            if (data.error) {
                expect(data.message).toContain('lair');
            } else {
                expect(data.success).toBe(true);
            }
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleCombatManage({
                action: 'creat',  // Missing 'e' - similarity with "create" is 0.83
                seed: 'fuzzy-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 0, hp: 20, maxHp: 20 }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleCombatManage({
                action: 'xyz',
                encounterId: 'test'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting', async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'format-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 0, hp: 20, maxHp: 20 }
                ]
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('⚔️'); // Combat emoji
            expect(text).toContain('COMBAT STARTED'); // RichFormatter.header uppercases
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleCombatManage({
                action: 'create',
                seed: 'json-test',
                participants: [
                    { id: 'hero-1', name: 'Hero', initiativeBonus: 0, hp: 20, maxHp: 20 }
                ]
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- COMBAT_MANAGE_JSON');
        });
    });
});
