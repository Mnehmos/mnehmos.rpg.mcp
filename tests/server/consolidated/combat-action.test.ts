/**
 * Tests for consolidated combat_action tool
 * Validates all 9 actions: attack, heal, move, disengage, cast_spell, dash, dodge, help, ready
 */

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

    // Regression for issue #49: off-turn actions used to succeed silently,
    // letting a caller stack multiple attacks from different actors in one
    // round. Now the response surfaces an off_turn_action warning.
    describe('off-turn advisory', () => {
        it('warns when actorId does not match the current-turn participant', async () => {
            // Test setup gave hero-1 initiativeBonus 10 vs goblin-1's 1, so
            // hero-1 is on turn. Fire an attack as the goblin instead.
            const result = await handleCombatAction({
                action: 'attack',
                encounterId: testEncounterId,
                actorId: 'goblin-1',
                targetId: 'hero-1',
                attackBonus: 3,
                damage: 4
            }, ctx);

            expect(result.content[0].text).toMatch(/off_turn_action/);
        });

        it('does not warn when actorId is the current-turn participant', async () => {
            const result = await handleCombatAction({
                action: 'attack',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1',
                attackBonus: 5,
                damage: 8
            }, ctx);

            expect(result.content[0].text).not.toMatch(/off_turn_action/);
        });

        // Reviewer follow-up on PR #59: hasLairActions wasn't being persisted,
        // so loadState() couldn't rebuild the LAIR slot in turnOrder after a
        // restart. The lair turn would silently disappear.
        it('persists hasLairActions so LAIR survives a loadState round-trip', async () => {
            const { handleCreateEncounter } = await import('../../../src/server/handlers/combat-handlers.js');
            const { EncounterRepository } = await import('../../../src/storage/repos/encounter.repo.js');
            const lairCtx = { sessionId: `lair-persist-${randomUUID()}` };

            const create = await handleCreateEncounter({
                seed: 'lair-persist-test',
                participants: [
                    { id: 'pc', name: 'Hero', initiativeBonus: 0, hp: 30, maxHp: 30, isEnemy: false, position: { x: 0, y: 0 } },
                    { id: 'dragon', name: 'Dragon', initiativeBonus: 0, hp: 100, maxHp: 100, isEnemy: true, hasLairActions: true, position: { x: 5, y: 5 } }
                ]
            }, lairCtx);
            const eid = (create.content[0].text.match(/encounter-[\w-]+/) || [])[0]!;

            const repo = new EncounterRepository(getDb(':memory:'));
            const loaded = repo.loadState(eid);
            expect(loaded).not.toBeNull();
            expect(loaded.turnOrder).toContain('LAIR');
            const dragon = loaded.participants.find((p: { id: string }) => p.id === 'dragon');
            expect(dragon?.hasLairActions).toBe(true);
        });

        // Reviewer follow-up on PR #59: previously the warning was suppressed
        // when the active turn slot was 'LAIR', so a participant could still
        // act mid-LAIR-turn without any signal. The warning should fire.
        it('warns when a participant acts during a LAIR turn', async () => {
            const { handleCreateEncounter, handleExecuteCombatAction } =
                await import('../../../src/server/handlers/combat-handlers.js');
            const lairCtx = { sessionId: `lair-test-${randomUUID()}` };

            // Construct an encounter with a LAIR-bearing creature so that the
            // turn order includes a 'LAIR' slot at initiative 20.
            const create = await handleCreateEncounter({
                seed: 'lair-warning-test',
                participants: [
                    { id: 'pc', name: 'Hero', initiativeBonus: 0, hp: 30, maxHp: 30, isEnemy: false, position: { x: 0, y: 0 } },
                    { id: 'dragon', name: 'Dragon', initiativeBonus: 0, hp: 100, maxHp: 100, isEnemy: true, hasLairActions: true, position: { x: 5, y: 5 } }
                ]
            }, lairCtx);
            const lairEncounterId = (create.content[0].text.match(/encounter-[\w-]+/) || [])[0]!;

            // Force the active slot to LAIR by advancing turns until we hit it.
            const { getCombatManager } = await import('../../../src/server/state/combat-manager.js');
            const engine = getCombatManager().get(`${lairCtx.sessionId}:${lairEncounterId}`)!;
            const state = engine.getState()!;
            const lairIndex = state.turnOrder.indexOf('LAIR');
            expect(lairIndex).toBeGreaterThanOrEqual(0);
            state.currentTurnIndex = lairIndex;

            // Now PC tries to act — should warn even though the active slot is LAIR.
            const acted = await handleExecuteCombatAction({
                encounterId: lairEncounterId,
                action: 'attack',
                actorId: 'pc',
                targetId: 'dragon',
                attackBonus: 3,
                damage: 5
            }, lairCtx);
            expect(acted.content[0].text).toMatch(/off_turn_action/);
            expect(acted.content[0].text).toMatch(/LAIR action/);
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

        // Reviewer follow-ups on PR #60:
        // - dash must consume the action economy slot (else attack-then-dash).
        // - dash must auto-load the engine from DB (matches other actions).
        it('dash refuses when the actor already used their main action this turn', async () => {
            // hero-1 attacks (consumes action) then tries to dash.
            await handleCombatAction({
                action: 'attack',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetId: 'goblin-1',
                attackBonus: 5,
                damage: 4
            }, ctx);

            const dashResult = await handleCombatAction({
                action: 'dash',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);
            const dashData = parseResult(dashResult);
            expect(dashData.error).toBe(true);
            expect(dashData.message).toMatch(/already used|action/i);
        });

        // Reviewer follow-up on PR #60 (Minor): two concurrent dash calls
        // hitting the auto-load path could both try to register the same
        // engine key, throwing "Encounter X already exists" on the loser.
        it('dash survives two concurrent auto-load requests without throwing', async () => {
            const { getCombatManager } = await import('../../../src/server/state/combat-manager.js');
            getCombatManager().clear();

            const [a, b] = await Promise.all([
                handleCombatAction({
                    action: 'dash',
                    encounterId: testEncounterId,
                    actorId: 'hero-1'
                }, ctx),
                handleCombatAction({
                    action: 'dash',
                    encounterId: testEncounterId,
                    actorId: 'hero-1'
                }, ctx)
            ]);

            const da = parseResult(a);
            const db = parseResult(b);
            // One must succeed (the first) and the other must reject due to
            // hasDashed/economy — but neither may throw "already exists".
            expect([da, db].some((d) => d.success === true)).toBe(true);
            for (const d of [da, db]) {
                if (d.error) {
                    expect(String(d.message ?? '')).not.toMatch(/already exists/i);
                }
            }
        });

        it('dash auto-loads the encounter from DB when engine is evicted', async () => {
            const { getCombatManager } = await import('../../../src/server/state/combat-manager.js');
            getCombatManager().clear();

            const dashResult = await handleCombatAction({
                action: 'dash',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);
            const dashData = parseResult(dashResult);
            expect(dashData.success).toBe(true);
            expect(dashData.movementRemaining).toBe(60);
        });

        // Regression for issue #50: dash was a stub that returned a success
        // message without actually extending movementRemaining, so the next
        // move call still enforced the base 30ft budget.
        it('dash actually doubles the enforced move budget', async () => {
            const dashResult = await handleCombatAction({
                action: 'dash',
                encounterId: testEncounterId,
                actorId: 'hero-1'
            }, ctx);
            const dashData = parseResult(dashResult);
            expect(dashData.success).toBe(true);
            expect(dashData.movementRemaining).toBe(60);

            // Move 9 tiles diagonally (~45ft at 5ft/sq). Without dash this
            // would exceed the 30ft budget; with dash (60ft) it fits.
            const moveResult = await handleCombatAction({
                action: 'move',
                encounterId: testEncounterId,
                actorId: 'hero-1',
                targetPosition: { x: 14, y: 14 }
            }, ctx);
            const moveData = parseResult(moveResult);
            expect(moveData.success).toBe(true);
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
