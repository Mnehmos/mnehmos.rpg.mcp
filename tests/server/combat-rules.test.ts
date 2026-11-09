import { describe, it, expect, beforeEach } from 'vitest';
import { handleCreateEncounter, handleExecuteCombatAction, handleAdvanceTurn, clearCombatState } from '../../src/server/handlers/combat-handlers.js';
import { getCombatManager } from '../../src/server/state/combat-manager.js';
import { closeDb, getDb } from '../../src/storage/index.js';

const ctx = { sessionId: 'test-session' };

async function createEncounter(seed: string, participants: unknown[]): Promise<string> {
    const result = await handleCreateEncounter({ seed, participants }, ctx);
    const json = result.content[0].text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/)?.[1] ?? '{}';
    return JSON.parse(json).encounterId;
}

function participant(encounterId: string, id: string): any {
    const state = getCombatManager().get(`${ctx.sessionId}:${encounterId}`)!.getState()!;
    return state.participants.find(p => p.id === id)!;
}

// Hero always acts first; the goblin stands next to it and the ogre far away.
const hero = { id: 'hero', name: 'Hero', initiativeBonus: 50, hp: 30, maxHp: 30, position: { x: 1, y: 1 } };
const goblin = { id: 'gob', name: 'Goblin', initiativeBonus: 1, hp: 7, maxHp: 7, isEnemy: true, position: { x: 2, y: 1 } };
const ogre = { id: 'ogre', name: 'Ogre', initiativeBonus: -5, hp: 59, maxHp: 59, isEnemy: true, position: { x: 18, y: 18 } };

const attack = (encounterId: string, extra: Record<string, unknown>) =>
    handleExecuteCombatAction({ encounterId, action: 'attack', attackBonus: 5, dc: 12, damage: 3, ...extra }, ctx);

describe('combat rules the engine enforces', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
        clearCombatState();
    });

    describe('acting out of turn', () => {
        it('resolves one off-turn attack as the attacker\'s reaction', async () => {
            const encounterId = await createEncounter('rules-turn-1', [hero, goblin]);

            const result = await attack(encounterId, { actorId: 'gob', targetId: 'hero' });

            expect(result.content[0].text).toMatch(/reaction/i);
            expect(participant(encounterId, 'gob').reactionUsed).toBe(true);
            // A reaction is not the goblin's action: it still has its own turn.
            expect(participant(encounterId, 'gob').actionUsed).toBeFalsy();
        });

        it('refuses a second off-turn attack in the same round', async () => {
            const encounterId = await createEncounter('rules-turn-2', [hero, goblin]);
            await attack(encounterId, { actorId: 'gob', targetId: 'hero' });
            const hpAfterFirst = participant(encounterId, 'hero').hp;

            await expect(attack(encounterId, { actorId: 'gob', targetId: 'hero', attackBonus: 30, dc: 1 }))
                .rejects.toThrow(/not Goblin's turn.*reaction/is);

            expect(participant(encounterId, 'hero').hp).toBe(hpAfterFirst);
        });

        it('gives the reaction back on the attacker\'s next turn', async () => {
            const encounterId = await createEncounter('rules-turn-3', [hero, goblin]);
            await attack(encounterId, { actorId: 'gob', targetId: 'hero' });

            await handleAdvanceTurn({ encounterId }, ctx); // goblin's turn
            expect(participant(encounterId, 'gob').reactionUsed).toBeFalsy();
            // On its own turn the goblin attacks with its action as usual.
            await attack(encounterId, { actorId: 'gob', targetId: 'hero' });
            expect(participant(encounterId, 'gob').actionUsed).toBe(true);
        });

        it('leaves on-turn attacks alone', async () => {
            const encounterId = await createEncounter('rules-turn-4', [hero, goblin]);
            const result = await attack(encounterId, { actorId: 'hero', targetId: 'gob' });
            expect(result.content[0].text).not.toMatch(/off_turn_action/);
            expect(participant(encounterId, 'hero').reactionUsed).toBeFalsy();
            expect(participant(encounterId, 'hero').actionUsed).toBe(true);
        });
    });

    describe('reach and range', () => {
        it('refuses a melee attack on a target out of reach, and says how to fix it', async () => {
            const encounterId = await createEncounter('rules-range-1', [hero, goblin, ogre]);

            await expect(attack(encounterId, { actorId: 'hero', targetId: 'ogre' }))
                .rejects.toThrow(/85ft.*range/is);

            expect(participant(encounterId, 'ogre').hp).toBe(59);
            expect(participant(encounterId, 'hero').actionUsed).toBeFalsy();
        });

        it('allows a ranged attack when the caller states a sufficient range', async () => {
            const encounterId = await createEncounter('rules-range-2', [hero, goblin, ogre]);
            await attack(encounterId, { actorId: 'hero', targetId: 'ogre', range: 150 });
            expect(participant(encounterId, 'hero').actionUsed).toBe(true);
        });

        it('refuses a ranged attack beyond the stated range', async () => {
            const encounterId = await createEncounter('rules-range-3', [hero, goblin, ogre]);
            await expect(attack(encounterId, { actorId: 'hero', targetId: 'ogre', range: 60 }))
                .rejects.toThrow(/85ft/);
        });

        it('allows adjacent and diagonal melee attacks', async () => {
            const diagonal = { ...goblin, position: { x: 2, y: 2 } };
            const encounterId = await createEncounter('rules-range-4', [hero, diagonal]);
            await attack(encounterId, { actorId: 'hero', targetId: 'gob' });
            expect(participant(encounterId, 'hero').actionUsed).toBe(true);
        });

        it('does not check distance when positions are unknown', async () => {
            const { position: _h, ...heroNoPos } = hero;
            const { position: _o, ...ogreNoPos } = ogre;
            const encounterId = await createEncounter('rules-range-5', [heroNoPos, ogreNoPos]);
            await attack(encounterId, { actorId: 'hero', targetId: 'ogre' });
            expect(participant(encounterId, 'hero').actionUsed).toBe(true);
        });
    });

    describe('caller-supplied attack numbers', () => {
        it.each([
            ['attackBonus', { attackBonus: 999 }, /attackBonus/],
            ['attackBonus', { attackBonus: -999 }, /attackBonus/],
            ['dc', { dc: 500 }, /dc/i],
            ['dc', { dc: -3 }, /dc/i],
            ['damage', { damage: 9999 }, /damage/i],
            ['damage dice', { damage: '900d100' }, /damage/i],
        ])('refuses an out-of-bounds %s', async (_label, extra, message) => {
            const encounterId = await createEncounter('rules-bounds-1', [hero, goblin]);
            await expect(attack(encounterId, { actorId: 'hero', targetId: 'gob', ...extra })).rejects.toThrow(message);
            expect(participant(encounterId, 'gob').hp).toBe(7);
        });

        it('accepts ordinary and high-end values', async () => {
            const encounterId = await createEncounter('rules-bounds-2', [hero, goblin]);
            await attack(encounterId, { actorId: 'hero', targetId: 'gob', attackBonus: 19, dc: 25, damage: '12d6+10' });
            expect(participant(encounterId, 'hero').actionUsed).toBe(true);
        });
    });
});

describe('opportunity attacks use the combatants\' own numbers', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
        clearCombatState();
    });

    it('rolls the attacker\'s attack bonus against the mover\'s armor class', async () => {
        const encounterId = await createEncounter('rules-oa-1', [
            { ...hero, ac: 16 },
            { ...goblin, attackBonus: 4 },
        ]);

        const result = await handleExecuteCombatAction({
            encounterId, action: 'move', actorId: 'hero', targetPosition: { x: 1, y: 5 },
        }, ctx);

        expect(result.content[0].text).toMatch(/\+ 4 = \d+ vs AC 16/);
    });
});
