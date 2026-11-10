import type { Character } from '../../schema/character.js';
import { getClassStartingData } from '../../data/class-starting-data.js';

/**
 * Hit dice: the pool a character spends on short rests.
 *
 * A character has one hit die per level, of a size set by its class. Dice
 * spent on a short rest are gone until a long rest, which returns half the
 * character's total (at least one). Without the pool a short rest was free,
 * unlimited healing.
 *
 * The pool lives in `resourcePools.hit_dice`. A character that has never
 * rested has no entry and is treated as having a full pool.
 */
export const HIT_DICE_POOL = 'hit_dice';

type Pools = NonNullable<Character['resourcePools']>;
type RestingCharacter = Pick<Character, 'level' | 'stats'> & {
    characterClass?: string | null;
    resourcePools?: Pools;
};

export interface HitDicePool {
    current: number;
    max: number;
}

/** Size of a class's hit die; d8 for a class the engine has no data for. */
export function hitDieSize(characterClass: string | null | undefined): number {
    const hitDice = characterClass ? getClassStartingData(characterClass)?.hitDice : undefined;
    const size = hitDice ? Number.parseInt(hitDice.replace(/^d/i, ''), 10) : NaN;
    return Number.isInteger(size) && size > 0 ? size : 8;
}

export function getHitDicePool(character: RestingCharacter): HitDicePool {
    const max = Math.max(1, Math.trunc(character.level || 1));
    const stored = character.resourcePools?.[HIT_DICE_POOL];
    const current = stored ? Math.min(max, Math.max(0, Math.trunc(stored.current))) : max;
    return { current, max };
}

function withPool(character: RestingCharacter, pool: HitDicePool, refilled: boolean): Pools {
    const previous = character.resourcePools?.[HIT_DICE_POOL];
    return {
        ...(character.resourcePools ?? {}),
        [HIT_DICE_POOL]: {
            current: pool.current,
            max: pool.max,
            ...(refilled
                ? { lastRefilledAt: new Date().toISOString() }
                : previous?.lastRefilledAt ? { lastRefilledAt: previous.lastRefilledAt } : {}),
        },
    };
}

export interface HitDiceSpend {
    /** Dice actually spent: the request, limited by what was left. */
    spent: number;
    rolls: number[];
    /** Total healing rolled, before capping at max HP. */
    healing: number;
    dieSize: number;
    remaining: number;
    /** `resourcePools` to store on the character. */
    resourcePools: Pools;
}

/** Spend up to `requested` hit dice. Each die heals at least 1. */
export function spendHitDice(
    character: RestingCharacter,
    requested: number,
    random: () => number = Math.random
): HitDiceSpend {
    const pool = getHitDicePool(character);
    const spent = Math.max(0, Math.min(Math.trunc(requested), pool.current));
    const dieSize = hitDieSize(character.characterClass);
    const conModifier = Math.floor(((character.stats?.con ?? 10) - 10) / 2);

    const rolls: number[] = [];
    let healing = 0;
    for (let i = 0; i < spent; i++) {
        const roll = Math.floor(random() * dieSize) + 1;
        rolls.push(roll);
        healing += Math.max(1, roll + conModifier);
    }

    const remaining = pool.current - spent;
    return {
        spent, rolls, healing, dieSize, remaining,
        resourcePools: withPool(character, { current: remaining, max: pool.max }, false),
    };
}

export interface HitDiceRecovery {
    restored: number;
    remaining: number;
    resourcePools: Pools;
}

/** A long rest returns half the character's hit dice (at least one), up to its level. */
export function recoverHitDice(character: RestingCharacter): HitDiceRecovery {
    const pool = getHitDicePool(character);
    const remaining = Math.min(pool.max, pool.current + Math.max(1, Math.floor(pool.max / 2)));
    return {
        restored: remaining - pool.current,
        remaining,
        resourcePools: withPool(character, { current: remaining, max: pool.max }, true),
    };
}
