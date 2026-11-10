import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleCreateEncounter, handleExecuteCombatAction, clearCombatState } from '../../src/server/handlers/combat-handlers.js';
import { getCombatManager } from '../../src/server/state/combat-manager.js';
import { closeDb, getDb } from '../../src/storage/index.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { getInitialSpellSlots } from '../../src/engine/magic/spell-validator.js';
import { resolveSpell } from '../../src/engine/magic/spell-resolver.js';
import { getSpell } from '../../src/engine/magic/spell-database.js';
import { CombatRNG } from '../../src/engine/combat/rng.js';

const ctx = { sessionId: 'test-session' };
const STATS = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

function createCaster(id: string, characterClass: string, level: number, stats: Partial<typeof STATS>, spells: string[], cantrips: string[] = []) {
    new CharacterRepository(getDb()).create({
        id, name: id, stats: { ...STATS, ...stats }, hp: 30, maxHp: 30, ac: 12, level,
        characterClass, knownSpells: spells, preparedSpells: spells, cantripsKnown: cantrips,
        spellSlots: getInitialSpellSlots(characterClass as any, level),
        maxSpellLevel: 5, conditions: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as any);
}

async function encounter(seed: string, participants: unknown[]): Promise<string> {
    const result = await handleCreateEncounter({ seed, participants }, ctx);
    return result.content[0].text.match(/Encounter ID: (encounter-[^\n`]+)/)![1];
}

const hp = (encounterId: string, id: string): number =>
    getCombatManager().get(`${ctx.sessionId}:${encounterId}`)!.getState()!.participants.find(p => p.id === id)!.hp;

const cast = (encounterId: string, actorId: string, spellName: string, extra: Record<string, unknown>) =>
    handleExecuteCombatAction({ encounterId, action: 'cast_spell', actorId, spellName, ...extra }, ctx);

/**
 * Spell rolls returning the given values in order, then the last one forever.
 * In combat they come from the encounter's seeded dice; the resolver called on
 * its own falls back to Math.random. Both draw from the one sequence here.
 */
function rolls(...values: number[]) {
    let i = 0;
    const next = () => values[Math.min(i++, values.length - 1)];
    vi.spyOn(CombatRNG.prototype, 'random').mockImplementation(next);
    return vi.spyOn(Math, 'random').mockImplementation(next);
}
const MAX = 0.999; // every die shows its highest face
const MIN = 0;     // every die shows a 1

const caster = (id: string) => ({ id, name: id, hp: 30, maxHp: 30, initiativeBonus: 50 });
const dummy = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, name: id, hp: 100, maxHp: 100, initiativeBonus: 0, isEnemy: true, ...extra });

describe('spell rules', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
        clearCombatState();
    });
    afterEach(() => { vi.restoreAllMocks(); });

    describe('saving throws are rolled once, by the target', () => {
        it('Fireball: a target that saves takes half of the rolled damage, not a quarter', async () => {
            createCaster('wiz', 'wizard', 5, { int: 18 }, ['Fireball']);
            const enc = await encounter('spell-save-1', [caster('wiz'), dummy('a'), dummy('b')]);

            rolls(MAX); // 8d6 = 48; every save is a natural 20
            await cast(enc, 'wiz', 'Fireball', { targetIds: ['a', 'b'], slotLevel: 3 });

            expect(hp(enc, 'a')).toBe(100 - 24);
            expect(hp(enc, 'b')).toBe(100 - 24);
        });

        it('Fireball: a target that fails its save takes the full rolled damage', async () => {
            createCaster('wiz', 'wizard', 5, { int: 18 }, ['Fireball']);
            const enc = await encounter('spell-save-2', [caster('wiz'), dummy('a')]);

            // 8 damage dice at max, one high d20 that no target rolled, then the target's own save: a 1.
            rolls(MAX, MAX, MAX, MAX, MAX, MAX, MAX, MAX, MAX, MIN);
            await cast(enc, 'wiz', 'Fireball', { targetIds: ['a'], slotLevel: 3 });

            expect(hp(enc, 'a')).toBe(100 - 48);
        });

        it('Sacred Flame: the target is hit when its own save fails', async () => {
            createCaster('clr', 'cleric', 1, { wis: 18 }, [], ['Sacred Flame']);
            const enc = await encounter('spell-save-3', [caster('clr'), dummy('a')]);

            rolls(MAX, MAX, MIN); // 1d8 = 8, a high d20 no target rolled, target saves with a 1
            const result = await cast(enc, 'clr', 'Sacred Flame', { targetId: 'a' });

            expect(hp(enc, 'a')).toBe(100 - 8);
            expect(result.content[0].text).toMatch(/failed/i);
        });
    });

    it('uses the caster\'s real spell save DC', async () => {
        // Level 5 cleric, WIS 18: 8 + 3 proficiency + 4 = 15.
        createCaster('clr', 'cleric', 5, { wis: 18 }, [], ['Sacred Flame']);
        const enc = await encounter('spell-dc-1', [caster('clr'), dummy('a')]);

        rolls(MAX, MIN, 0.55); // damage, unused d20, target rolls a 12: fails DC 15
        const result = await cast(enc, 'clr', 'Sacred Flame', { targetId: 'a' });

        expect(result.content[0].text).toMatch(/DC 15/);
        expect(hp(enc, 'a')).toBeLessThan(100);
    });

    it('heals with the caster\'s own spellcasting ability, not always Wisdom', async () => {
        // A bard casts with Charisma (+4). With Wisdom 8 (-1) the old maths healed 1 - 1 = 0.
        createCaster('brd', 'bard', 1, { cha: 18, wis: 8 }, ['Cure Wounds']);
        const enc = await encounter('spell-heal-1', [caster('brd'), { ...dummy('ally'), isEnemy: false, hp: 5, maxHp: 30 }]);

        rolls(MIN); // 1d8 = 1
        await cast(enc, 'brd', 'Cure Wounds', { targetId: 'ally', slotLevel: 1 });

        expect(hp(enc, 'ally')).toBe(5 + 1 + 4);
    });

    it('refuses to aim a single-target spell at several creatures', async () => {
        createCaster('wiz', 'wizard', 5, { int: 18 }, [], ['Fire Bolt']);
        const enc = await encounter('spell-target-1', [caster('wiz'), dummy('a'), dummy('b'), dummy('c')]);

        await expect(cast(enc, 'wiz', 'Fire Bolt', { targetIds: ['a', 'b', 'c'] }))
            .rejects.toThrow(/one target/i);
        await expect(cast(enc, 'wiz', 'Fire Bolt', { targetId: 'a,b,c' }))
            .rejects.toThrow(/one target/i);

        expect([hp(enc, 'a'), hp(enc, 'b'), hp(enc, 'c')]).toEqual([100, 100, 100]);
    });

    describe('spell attack rolls', () => {
        const wizard = { level: 5, characterClass: 'wizard', stats: { ...STATS, int: 18 } } as any;

        it('a natural 1 always misses', () => {
            rolls(MAX, MIN); // damage die, then the attack roll: 1
            const result = resolveSpell(getSpell('Fire Bolt')!, wizard, 0, { targetAC: 2 });
            expect(result.attackRoll).toBe(1);
            expect(result.hit).toBe(false);
        });

        it('a natural 20 always hits', () => {
            rolls(MAX, MAX);
            const result = resolveSpell(getSpell('Fire Bolt')!, wizard, 0, { targetAC: 40 });
            expect(result.attackRoll).toBe(20);
            expect(result.hit).toBe(true);
        });
    });
});
