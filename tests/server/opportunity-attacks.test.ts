import { handleCreateEncounter, handleExecuteCombatAction, handleAdvanceTurn, clearCombatState } from '../../src/server/handlers/combat-handlers.js';
import { closeDb, getDb } from '../../src/storage/index.js';

const mockCtx = { sessionId: 'test-session' };

function extractStateJson(responseText: string): any {
    const match = responseText.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/);
    if (match) {
        return JSON.parse(match[1]);
    }
    throw new Error('Could not extract state JSON from response');
}

/**
 * HIGH-003: No Opportunity Attacks
 *
 * Tests for opportunity attack mechanics:
 * - When a creature leaves a threatened square, adjacent enemies get a reaction attack
 * - Reactions reset at the start of each creature's turn
 * - Disengage action prevents opportunity attacks
 */
describe('HIGH-003: Opportunity Attacks', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
        clearCombatState();
    });

    describe('Movement Provokes Opportunity Attacks', () => {
        it('should trigger opportunity attack when leaving threatened square', async () => {
            // Create encounter: hero adjacent to goblin, hero moves away
            const createResult = await handleCreateEncounter({
                seed: 'opp-attack-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 10, // Goes first
                        hp: 30,
                        maxHp: 30,
                        position: { x: 1, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 15,
                        maxHp: 15,
                        isEnemy: true,
                        position: { x: 0, y: 0 } // Adjacent to hero
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Hero moves away from goblin (leaving threatened square)
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 5, y: 0 } // Moving away from goblin
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            // Should show opportunity attack was triggered
            expect(moveText).toMatch(/opportunity attack/i);
            expect(moveText).toContain('Goblin');
        });

        it('should NOT trigger opportunity attack when moving within threat range', async () => {
            // Create encounter: hero adjacent to goblin, hero moves to another adjacent square
            const createResult = await handleCreateEncounter({
                seed: 'opp-attack-2',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 10,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 1, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 15,
                        maxHp: 15,
                        isEnemy: true,
                        position: { x: 0, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Hero moves to another square still adjacent to goblin
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 1, y: 1 } // Still adjacent to goblin at (0,0)
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            // Should NOT trigger opportunity attack (still in threat range)
            expect(moveText).not.toMatch(/opportunity attack/i);
        });

        it('should NOT trigger opportunity attack from same faction', async () => {
            // Create encounter: hero adjacent to ally, hero moves away
            const createResult = await handleCreateEncounter({
                seed: 'opp-attack-3',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 10,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 1, y: 0 }
                    },
                    {
                        id: 'ally-1',
                        name: 'Ally Fighter',
                        initiativeBonus: 5,
                        hp: 25,
                        maxHp: 25,
                        isEnemy: false, // Same faction as hero
                        position: { x: 0, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Hero moves away from ally
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 5, y: 0 }
            }, mockCtx);

            const moveText = moveResult.content[0].text;
            // Should NOT trigger opportunity attack (same faction)
            expect(moveText).not.toMatch(/opportunity attack/i);
        });
    });

    describe('Reaction Tracking', () => {
        it('should track reaction usage - only one OA per round per creature', async () => {
            // Create encounter: goblin adjacent to two heroes
            const createResult = await handleCreateEncounter({
                seed: 'reaction-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero 1',
                        initiativeBonus: 10,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 1, y: 0 }
                    },
                    {
                        id: 'hero-2',
                        name: 'Hero 2',
                        initiativeBonus: 9,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 0, y: 1 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 15,
                        maxHp: 15,
                        isEnemy: true,
                        position: { x: 0, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Hero 1 moves away - goblin uses reaction
            const move1Result = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 5, y: 0 }
            }, mockCtx);

            expect(move1Result.content[0].text).toMatch(/opportunity attack/i);

            // Advance to hero 2's turn
            await handleAdvanceTurn({ encounterId }, mockCtx);

            // Hero 2 moves away - goblin already used reaction
            const move2Result = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-2',
                targetPosition: { x: 0, y: 5 }
            }, mockCtx);

            // Should NOT trigger second opportunity attack (reaction already used)
            expect(move2Result.content[0].text).not.toMatch(/opportunity attack/i);
        });

        it('should reset reactions at start of creature turn', async () => {
            // Create encounter
            const createResult = await handleCreateEncounter({
                seed: 'reaction-reset-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero 1',
                        initiativeBonus: 10,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 1, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 5,
                        hp: 15,
                        maxHp: 15,
                        isEnemy: true,
                        position: { x: 0, y: 0 }
                    },
                    {
                        id: 'hero-2',
                        name: 'Hero 2',
                        initiativeBonus: 1,
                        hp: 30,
                        maxHp: 30,
                        position: { x: -1, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Hero 1 moves away - goblin uses reaction
            await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 5, y: 0 }
            }, mockCtx);

            // Advance through goblin's turn (reaction resets)
            await handleAdvanceTurn({ encounterId }, mockCtx); // Hero 1 -> Goblin
            await handleAdvanceTurn({ encounterId }, mockCtx); // Goblin -> Hero 2

            // Move hero 1 back to adjacent position for round 2 test
            // Actually, let's advance to round 2 and test with hero 2
            // Hero 2 is at (-1, 0), adjacent to goblin at (0, 0)
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-2',
                targetPosition: { x: -5, y: 0 } // Moving away
            }, mockCtx);

            // Goblin's reaction should be available again (reset at start of its turn)
            expect(moveResult.content[0].text).toMatch(/opportunity attack/i);
        });
    });

    describe('Disengage Action', () => {
        it('should prevent opportunity attacks after disengage', async () => {
            const createResult = await handleCreateEncounter({
                seed: 'disengage-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 10,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 1, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 15,
                        maxHp: 15,
                        isEnemy: true,
                        position: { x: 0, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Hero takes disengage action
            const disengageResult = await handleExecuteCombatAction({
                encounterId,
                action: 'disengage',
                actorId: 'hero-1'
            }, mockCtx);

            expect(disengageResult.content[0].text).toMatch(/disengage/i);

            // Hero moves away - should NOT provoke
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 5, y: 0 }
            }, mockCtx);

            expect(moveResult.content[0].text).not.toMatch(/opportunity attack/i);
        });
    });

    describe('Edge Cases', () => {
        it('should not trigger OA from defeated enemies', async () => {
            const createResult = await handleCreateEncounter({
                seed: 'defeated-test-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 10,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 1, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 5, // Low HP - will be defeated
                        maxHp: 15,
                        isEnemy: true,
                        position: { x: 0, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // First, defeat the goblin with an attack
            await handleExecuteCombatAction({
                encounterId,
                action: 'attack',
                actorId: 'hero-1',
                targetId: 'goblin-1',
                attackBonus: 20, // Guaranteed hit
                dc: 5,
                damage: 100 // Overkill to ensure defeat
            }, mockCtx);

            // Hero moves away from defeated goblin
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 5, y: 0 }
            }, mockCtx);

            // Should NOT trigger opportunity attack (goblin is defeated)
            expect(moveResult.content[0].text).not.toMatch(/opportunity attack/i);
        });

        it('should apply opportunity attack damage', async () => {
            const createResult = await handleCreateEncounter({
                seed: 'oa-damage-1',
                participants: [
                    {
                        id: 'hero-1',
                        name: 'Hero',
                        initiativeBonus: 10,
                        hp: 30,
                        maxHp: 30,
                        position: { x: 1, y: 0 }
                    },
                    {
                        id: 'goblin-1',
                        name: 'Goblin',
                        initiativeBonus: 1,
                        hp: 15,
                        maxHp: 15,
                        isEnemy: true,
                        position: { x: 0, y: 0 }
                    }
                ]
            }, mockCtx);
            const createData = JSON.parse(createResult.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] || '{}');
            const encounterId = createData.encounterId;

            // Hero moves away - triggers OA
            const moveResult = await handleExecuteCombatAction({
                encounterId,
                action: 'move',
                actorId: 'hero-1',
                targetPosition: { x: 5, y: 0 }
            }, mockCtx);

            // Should show attack roll and potential damage
            const text = moveResult.content[0].text;
            expect(text).toMatch(/opportunity attack/i);
            // If the attack hits, there should be damage info
            // The exact outcome depends on the dice roll, but the mechanics should be there
            expect(text).toMatch(/d20|Attack Roll|damage/i);
        });
    });
});
