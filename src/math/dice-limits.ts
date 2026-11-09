/**
 * Bounds on a dice expression.
 *
 * Dice notation arrives from tool arguments, and every roll runs on the single
 * event loop that serves every campaign. Unbounded, `99999999d6` allocates
 * until the process dies and `1d1!` never stops exploding. No table rolls a
 * thousand dice at once, so the limits cost nothing real.
 */
export const MAX_DICE_COUNT = 1000;
export const MAX_DICE_SIDES = 1000;
/** Extra dice one exploding die may add. Only reachable by astronomically bad luck. */
export const MAX_EXPLOSIONS_PER_DIE = 100;

export function assertDiceWithinLimits(count: number, sides: number, explode: boolean = false): void {
    if (!Number.isInteger(count) || !Number.isInteger(sides)) {
        throw new Error('Dice count and sides must be whole numbers.');
    }
    if (count < 1) throw new Error('Dice count must be at least 1.');
    if (sides < 1) throw new Error('Dice sides must be at least 1.');
    if (count > MAX_DICE_COUNT) {
        throw new Error(`Too many dice: ${count}. A single roll may use at most ${MAX_DICE_COUNT} dice.`);
    }
    if (sides > MAX_DICE_SIDES) {
        throw new Error(`Too many sides: ${sides}. A die may have at most ${MAX_DICE_SIDES} sides.`);
    }
    if (explode && sides < 2) {
        throw new Error('Exploding dice need at least 2 sides: a one-sided die would explode forever.');
    }
}
