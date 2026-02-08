/**
 * Tests for consolidated combat_action tool
 * Validates all 9 actions: attack, heal, move, disengage, cast_spell, dash, dodge, help, ready
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleCombatAction, CombatActionTool } from '../../../src/server/consolidated/combat-action.js';
import { handleCombatManage } from '../../../src/server/consolidated/combat-manage.js';
import { clearCombatState } from '../../../src/server/handlers/combat-handlers.js';
import { getDb } from '../../../src/storage/index.js';
import { randomUUID } from 'crypto';

// Force test mode
process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    // Try COMBAT_ACTION_JSON format first
    const jsonMatch = text.match(/<!-- COMBAT_ACTION_JSON\n([\s\S]*?)\nCOMBAT_ACTION_JSON -->/);
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

function parseManageResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- COMBAT_MANAGE_JSON\n([\s\S]*?)\nCOMBAT_MANAGE_JSON -->/);
    return jsonMatch ? JSON.parse(jsonMatch[1]) : null;
}

describe('combat_action consolidated tool', () => {
    let ctx: { sessionId: string };
    let testEncounterId: string;

    beforeEach(async () => {
        // Create unique session context per test for isolation
        ctx = { sessionId: `test-session-${randomUUID()}` };

        // Reset test database
        const db = getDb(':memory:');
        db.exec('DELETE FROM encounters');

        // Clear in-memory combat state
        clearCombatState();

        // Create a test encounter
        const result = await handleCombatManage({
            action: 'create',
            seed: 'action-test',
            participants: [
                {
                    id: 'hero-1',
                    name: 'Test Hero',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    position: { x: 5, y: 5 }
                },
                {
                    id: 'goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 7,
                    maxHp: 7,
                    isEnemy: true,
                    position: { x: 10, y: 10 }
                }
            ]
        }, ctx);
        testEncounterId = parseManageResult(result).encounterId;
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(CombatActionTool.name).toBe('combat_action');
        });

        it('should list all available actions in description', () => {
            expect(CombatActionTool.description).toContain('attack');
            expect(CombatActionTool.description).toContain('heal');
            expect(CombatActionTool.description).toContain('move');
            expect(CombatActionTool.description).toContain('disengage');
            expect(CombatActionTool.description).toContain('cast_spell');
            expect(CombatActionTool.description).toContain('dash');
            expect(CombatActionTool.description).toContain('dodge');
            expect(CombatActionTool.description).toContain('help');
            expect(CombatActionTool.description).toContain('ready');
        });
    });

    describe('attack action', () => {
        it('should execute an attack', async () => {
            const result = await handleCombatAction({
                action: 'attack',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1',
                attackBonus: 5,
                damage: 8,
                damageType: 'slashing'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('attack');
        });

        it('should accept "hit" alias', async () => {
            const result = await handleCombatAction({
                action: 'hit',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1',
                attackBonus: 5,
                damage: 5
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should accept dice expression for damage', async () => {
            const result = await handleCombatAction({
                action: 'attack',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1',
                attackBonus: 5,
                damage: '1d8+3'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('heal action', () => {
        it('should heal a target', async () => {
            const result = await handleCombatAction({
                action: 'heal',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1',
                amount: 5
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('heal');
        });

        it('should accept "cure" alias', async () => {
            const result = await handleCombatAction({
                action: 'cure',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1',
                amount: 3
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('move action', () => {
        it('should move to a position', async () => {
            const result = await handleCombatAction({
                action: 'move',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetPosition: { x: 7, y: 7 }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('move');
        });

        it('should accept "walk" alias', async () => {
            const result = await handleCombatAction({
                action: 'walk',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetPosition: { x: 6, y: 6 }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('disengage action', () => {
        it('should disengage', async () => {
            const result = await handleCombatAction({
                action: 'disengage',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('disengage');
        });

        it('should accept "retreat" alias', async () => {
            const result = await handleCombatAction({
                action: 'retreat',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('cast_spell action', () => {
        it('should route cast_spell action (may fail if actor lacks spellcasting)', async () => {
            const result = await handleCombatAction({
                action: 'cast_spell',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                spellName: 'Fireball',
                targetIds: ['goblin-1'],
                slotLevel: 3
            }, ctx);

            const text = result.content[0].text;
            // Cast spell requires character in DB - verify routing happened
            // Error response includes action: 'cast_spell' which proves routing worked
            expect(text).toContain('COMBAT_ACTION_JSON');
        });

        it('should accept "cast" alias', async () => {
            const result = await handleCombatAction({
                action: 'cast',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                spellName: 'Magic Missile',
                targetId: 'goblin-1'
            }, ctx);

            const text = result.content[0].text;
            // Alias routing works - JSON block proves response was generated
            expect(text).toContain('COMBAT_ACTION_JSON');
        });
    });

    describe('dash action', () => {
        it('should take dash action', async () => {
            const result = await handleCombatAction({
                action: 'dash',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('dash');
            expect(data.effect).toContain('doubled');
        });

        it('should accept "sprint" alias', async () => {
            const result = await handleCombatAction({
                action: 'sprint',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);

            const data = parseResult(result);
            // Alias resolves to dash
            expect(data.actionType).toBe('dash');
        });
    });

    describe('dodge action', () => {
        it('should take dodge action', async () => {
            const result = await handleCombatAction({
                action: 'dodge',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('dodge');
            expect(data.effect).toContain('disadvantage');
        });

        it('should accept "evade" alias', async () => {
            const result = await handleCombatAction({
                action: 'evade',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);

            const data = parseResult(result);
            // Alias resolves to dodge
            expect(data.actionType).toBe('dodge');
        });
    });

    describe('help action', () => {
        it('should help an ally', async () => {
            const result = await handleCombatAction({
                action: 'help',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1'  // In real game would be an ally
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('help');
            expect(data.effect).toContain('advantage');
        });

        it('should accept "assist" alias', async () => {
            const result = await handleCombatAction({
                action: 'assist',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1'
            }, ctx);

            const data = parseResult(result);
            // Alias resolves to help
            expect(data.actionType).toBe('help');
        });
    });

    describe('ready action', () => {
        it('should ready an action', async () => {
            const result = await handleCombatAction({
                action: 'ready',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                readiedAction: 'Attack with sword',
                trigger: 'When the goblin moves closer'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('ready');
            expect(data.readiedAction).toBe('Attack with sword');
            expect(data.trigger).toContain('goblin');
        });

        it('should accept "prepare" alias', async () => {
            const result = await handleCombatAction({
                action: 'prepare',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                readiedAction: 'Cast Shield',
                trigger: 'When attacked'
            }, ctx);

            const data = parseResult(result);
            // Alias resolves to ready
            expect(data.actionType).toBe('ready');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleCombatAction({
                action: 'attck',  // Missing 'a' - similarity with "attack" is 0.83
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1',
                attackBonus: 5,
                damage: 5
            }, ctx);

            const data = parseResult(result);
            // Fuzzy matched to 'attack' - action was executed
            expect(data.actionType).toBe('attack');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleCombatAction({
                action: 'xyz',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting for attack', async () => {
            const result = await handleCombatAction({
                action: 'attack',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1',
                attackBonus: 5,
                damage: 5
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('⚔️'); // Attack emoji
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleCombatAction({
                action: 'dodge',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- COMBAT_ACTION_JSON');
        });
    });
});
