/**
 * Tests for consolidated combat_manage tool
 * Validates all 7 actions: create, get, end, load, advance, death_save, lair_action
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
