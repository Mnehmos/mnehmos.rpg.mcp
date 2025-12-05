import { describe, it, expect, beforeEach } from 'vitest';
import { handleCreateEncounter, handleExecuteCombatAction, clearCombatState } from '../../src/server/combat-tools.js';
import { closeDb, getDb } from '../../src/storage/index.js';

const mockCtx = { sessionId: 'test-session' };

/**
 * CRIT-003: Spatial Collision Not Enforced
 *
 * Tests for spatial positioning and movement collision in combat.
 * Movement should be blocked by obstacles and other combatants.
 */
describe('CRIT-003: Spatial Combat Movement', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
        clearCombatState();
    });

    describe('Movement with Positions', () => {
        it('should support position data on participants', async () => {
            const result = await handleCreateEncounter({
                seed: 'pos-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 2,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 0, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 7,
                        maxHp: 7,
                        isEnemy: true,
                        position: { x: 5, y: 0 }
                    }
                ]
            }, mockCtx);

            const text = result.content[0].text;
            // Encounter created successfully with positions
            expect(text).toContain('hero-1');
            expect(text).toContain('goblin-1');
        });

        it('should execute move action to new position', async () => {
            // Create encounter with positions
            const createResult = await handleCreateEncounter({
                seed: 'move-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 5,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 0, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 7,
                        maxHp: 7,
                        isEnemy: true,
                        position: { x: 10, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Execute move action
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 3, y: 0 }
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            expect(moveText).toContain('move');
            // Position should be updated
            expect(moveText).toContain('3');
        });

        it('should block movement onto occupied squares', async () => {
            // Create encounter with goblin at a specific position
            const createResult = await handleCreateEncounter({
                seed: 'block-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 5,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 0, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 7,
                        maxHp: 7,
                        isEnemy: true,
                        position: { x: 2, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Try to move ONTO the goblin's position - should be blocked
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 2, y: 0 } // Same as goblin position
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            // Should fail - destination is occupied
            expect(moveText).toMatch(/blocked|cannot/i);
        });
    });

    describe('Terrain Obstacles', () => {
        it('should block movement onto terrain obstacles', async () => {
            // Create encounter with terrain
            const createResult = await handleCreateEncounter({
                seed: 'terrain-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 5,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 0, y: 0 }
                    }
                ],
                terrain: {
                    obstacles: ['2,0'] // Wall tile
                }
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Try to move ONTO the wall tile - should fail
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 2, y: 0 } // The wall position
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            // Should be blocked - destination is an obstacle
            expect(moveText).toMatch(/blocked|cannot/i);
        });
    });
});
