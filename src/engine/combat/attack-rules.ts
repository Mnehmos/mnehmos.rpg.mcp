import { parseDiceTerms } from './rng.js';

/**
 * Limits on the numbers a caller may supply for an attack.
 *
 * Attack bonus, target number and damage can be passed in by the caller, which
 * is how monsters without a character sheet attack at all. They are still
 * caller input: unbounded, `attackBonus: 999, damage: 9999` kills anything in
 * one call. The bounds sit above anything in the rules (a +19 to hit and AC 30
 * are already extreme) so no legitimate attack is refused.
 */
export const MIN_ATTACK_BONUS = -20;
export const MAX_ATTACK_BONUS = 30;
export const MIN_ATTACK_DC = 1;
export const MAX_ATTACK_DC = 40;
/** Largest damage one attack may deal before criticals and vulnerabilities. */
export const MAX_ATTACK_DAMAGE = 1000;

/** Reach of a melee attack when the caller states no range, in feet. */
export const DEFAULT_MELEE_REACH_FT = 5;
export const MAX_ATTACK_RANGE_FT = 600;
const FEET_PER_SQUARE = 5;

/** The most a damage value could come to: the number itself, or every die at its maximum. */
export function maxPossibleDamage(damage: number | string): number {
    if (typeof damage === 'number') return damage;
    let max = 0;
    for (const term of parseDiceTerms(damage)) {
        if (term.sign < 0) continue;
        max += term.kind === 'dice' ? term.count * term.sides : term.value;
    }
    return max;
}

export function assertAttackNumbersWithinBounds(attackBonus: number, dc: number, damage: number | string): void {
    if (!Number.isFinite(attackBonus) || attackBonus < MIN_ATTACK_BONUS || attackBonus > MAX_ATTACK_BONUS) {
        throw new Error(
            `attackBonus ${attackBonus} is out of bounds (${MIN_ATTACK_BONUS} to ${MAX_ATTACK_BONUS}). ` +
            'Omit attackBonus to have it calculated from the attacker.'
        );
    }
    if (!Number.isFinite(dc) || dc < MIN_ATTACK_DC || dc > MAX_ATTACK_DC) {
        throw new Error(
            `dc ${dc} is out of bounds (${MIN_ATTACK_DC} to ${MAX_ATTACK_DC}). ` +
            "Omit dc to use the target's armor class."
        );
    }
    const most = maxPossibleDamage(damage);
    if (most > MAX_ATTACK_DAMAGE) {
        throw new Error(
            `damage ${damage} is out of bounds: one attack may deal at most ${MAX_ATTACK_DAMAGE}. ` +
            'Omit damage to have it calculated from the attacker.'
        );
    }
}

type Position = { x: number; y: number };

/** Grid distance in feet; diagonals cost the same as orthogonals, as movement does. */
export function distanceInFeet(a: Position, b: Position): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * FEET_PER_SQUARE;
}

/**
 * Refuse an attack on a target the attacker cannot reach.
 *
 * Only checked when both combatants have a position. `range` is the reach or
 * range of the attack in feet; without it the attack is melee.
 */
export function assertTargetInRange(
    attacker: { name: string; position?: Position },
    target: { name: string; position?: Position },
    range: number | undefined
): void {
    if (!attacker.position || !target.position) return;

    const reach = range ?? DEFAULT_MELEE_REACH_FT;
    const distance = distanceInFeet(attacker.position, target.position);
    if (distance <= reach) return;

    throw new Error(
        `${target.name} is ${distance}ft from ${attacker.name}, beyond this attack's ${reach}ft ` +
        `${range === undefined ? 'melee reach' : 'range'}. Move closer, or for a ranged or reach attack ` +
        'pass range (in feet) large enough to cover the distance.'
    );
}
