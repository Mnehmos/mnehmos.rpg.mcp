import { describe, it, expect, beforeEach } from 'vitest';
import { handleCreateEncounter, handleExecuteCombatAction, clearCombatState } from '../../src/server/handlers/combat-handlers.js';
import { getCombatManager } from '../../src/server/state/combat-manager.js';
import { closeDb, getDb } from '../../src/storage/index.js';

const ctx = { sessionId: 'test-session' };

async function createEncounter(seed: string, participants: unknown[], terrain?: unknown): Promise<string> {
    const result = await handleCreateEncounter({ seed, participants, terrain }, ctx);
    const json = result.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] ?? '{}';
    return JSON.parse(json).encounterId;
}

function participant(encounterId: string, id: string): any {
    const state = getCombatManager().get(`${ctx.sessionId}:${encounterId}`)!.getState()!;
    return state.participants.find(p => p.id === id)!;
}

const hero = (position = { x: 1, y: 0 }) => ({ id: 'hero', name: 'Hero', initiativeBonus: 50, hp: 30, maxHp: 30, position });
const goblin = (position = { x: 0, y: 0 }) => ({ id: 'gob', name: 'Goblin', initiativeBonus: 1, hp: 7, maxHp: 7, isEnemy: true, position });

describe('combat integrity', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
        clearCombatState();
    });

    describe('a move that cannot happen has no consequences', () => {
        it('rejects a move beyond remaining movement without provoking an opportunity attack', async () => {
            const encounterId = await createEncounter('integrity-move-1', [hero(), goblin()]);

            // 18 squares = 90ft against a 30ft speed, and it leaves the goblin's reach.
            await expect(handleExecuteCombatAction({
                encounterId, action: 'move', actorId: 'hero', targetPosition: { x: 19, y: 0 },
            }, ctx)).rejects.toThrow(/cannot move.*insufficient movement/is);

            expect(participant(encounterId, 'gob').reactionUsed).toBeFalsy();
            expect(participant(encounterId, 'hero').hp).toBe(30);
            expect(participant(encounterId, 'hero').position).toEqual({ x: 1, y: 0 });
            expect(participant(encounterId, 'hero').movementRemaining).toBe(30);
        });

        it('rejects a move onto a blocked square without provoking an opportunity attack', async () => {
            const encounterId = await createEncounter(
                'integrity-move-2', [hero(), goblin()], { obstacles: ['4,0'] }
            );

            await expect(handleExecuteCombatAction({
                encounterId, action: 'move', actorId: 'hero', targetPosition: { x: 4, y: 0 },
            }, ctx)).rejects.toThrow(/cannot move.*blocked/is);

            expect(participant(encounterId, 'gob').reactionUsed).toBeFalsy();
            expect(participant(encounterId, 'hero').hp).toBe(30);
        });

        it('still provokes an opportunity attack on a move that does happen', async () => {
            const encounterId = await createEncounter('integrity-move-3', [hero(), goblin()]);

            const result = await handleExecuteCombatAction({
                encounterId, action: 'move', actorId: 'hero', targetPosition: { x: 5, y: 0 },
            }, ctx);

            expect(result.content[0].text).toMatch(/opportunity attack/i);
            expect(participant(encounterId, 'gob').reactionUsed).toBe(true);
            expect(participant(encounterId, 'hero').position).toEqual({ x: 5, y: 0 });
        });
    });

    describe('damage never heals', () => {
        it('rejects a negative damage number', async () => {
            const encounterId = await createEncounter('integrity-dmg-1', [hero(), goblin()]);

            await expect(handleExecuteCombatAction({
                encounterId, action: 'attack', actorId: 'hero', targetId: 'gob',
                attackBonus: 100, dc: 1, damage: -50,
            }, ctx)).rejects.toThrow(/negative/i);

            expect(participant(encounterId, 'gob').hp).toBe(7);
        });

        it('floors dice damage with a large penalty at zero', async () => {
            const encounterId = await createEncounter('integrity-dmg-2', [hero(), goblin()]);

            await handleExecuteCombatAction({
                encounterId, action: 'attack', actorId: 'hero', targetId: 'gob',
                attackBonus: 100, dc: 1, damage: '1d4-10',
            }, ctx);

            expect(participant(encounterId, 'gob').hp).toBe(7);
        });

        it('never raises HP through applyDamage or lowers it through heal', async () => {
            const encounterId = await createEncounter('integrity-dmg-3', [hero(), goblin()]);
            const engine = getCombatManager().get(`${ctx.sessionId}:${encounterId}`)!;

            engine.applyDamage('gob', -100);
            expect(participant(encounterId, 'gob').hp).toBe(7);

            engine.heal('hero', -100);
            expect(participant(encounterId, 'hero').hp).toBe(30);
        });
    });
});
