import { describe, it, expect } from 'vitest';
import { DiceEngine } from '../../src/math/dice';
import { ProbabilityEngine } from '../../src/math/probability';
import { MAX_DICE_COUNT, MAX_DICE_SIDES } from '../../src/math/dice-limits';
import { parseDiceTerms } from '../../src/engine/combat/rng';
import { rollDice as rollSpellDice } from '../../src/engine/magic/spell-resolver';
import { rollDice as rollAuraDice } from '../../src/engine/magic/aura';

/**
 * A dice expression is caller input. Every roll runs on the one event loop
 * that serves every campaign, so an expression must never be able to loop
 * forever or allocate without bound.
 */
describe('dice limits', () => {
    describe('DiceEngine', () => {
        it('rejects an exploding one-sided die instead of looping forever', () => {
            const engine = new DiceEngine('limits');
            expect(() => engine.roll('1d1!')).toThrow(/explod/i);
            expect(() => engine.roll({ count: 1, sides: 1, modifier: 0, explode: true })).toThrow(/explod/i);
        });

        it('still rolls a non-exploding one-sided die', () => {
            expect(new DiceEngine('limits').roll('3d1').result).toBe(3);
        });

        it('rejects more dice than the limit', () => {
            const engine = new DiceEngine('limits');
            expect(() => engine.roll(`${MAX_DICE_COUNT + 1}d6`)).toThrow(/at most/i);
            expect(() => engine.roll('30000000d6')).toThrow(/at most/i);
        });

        it('rejects more sides than the limit', () => {
            expect(() => new DiceEngine('limits').roll(`1d${MAX_DICE_SIDES + 1}`)).toThrow(/at most/i);
        });

        it('rejects zero dice and zero sides', () => {
            const engine = new DiceEngine('limits');
            expect(() => engine.roll('0d6')).toThrow(/at least/i);
            expect(() => engine.roll('1d0')).toThrow(/at least/i);
        });

        it('accepts expressions at the limit', () => {
            const result = new DiceEngine('limits').roll(`${MAX_DICE_COUNT}d${MAX_DICE_SIDES}`);
            expect((result.metadata?.rolls as number[]).length).toBe(MAX_DICE_COUNT);
        });

        it('validates expressions passed as objects, not just strings', () => {
            const engine = new DiceEngine('limits');
            expect(() => engine.roll({ count: 5_000_000, sides: 6, modifier: 0 })).toThrow(/at most/i);
        });

        it('bounds an explosion chain on a two-sided die', () => {
            const result = new DiceEngine('limits').roll(`${MAX_DICE_COUNT}d2!`);
            expect((result.metadata?.rolls as number[]).length).toBeLessThan(MAX_DICE_COUNT * 200);
        });
    });

    describe('ProbabilityEngine', () => {
        it('rejects a distribution too large to compute', () => {
            const engine = new ProbabilityEngine();
            expect(() => engine.getDistribution(`${MAX_DICE_COUNT}d${MAX_DICE_SIDES}`)).toThrow(/too large/i);
        });

        it('still computes ordinary distributions', () => {
            const engine = new ProbabilityEngine();
            expect(engine.expectedValue('8d6')).toBeCloseTo(28, 5);
            expect(engine.expectedValue('20d12')).toBeCloseTo(130, 5);
        });
    });

    describe('other dice parsers', () => {
        it('combat damage notation rejects oversized dice', () => {
            expect(() => parseDiceTerms('99999999d6')).toThrow(/at most/i);
            expect(() => parseDiceTerms(`1d${MAX_DICE_SIDES + 1}+3`)).toThrow(/at most/i);
            expect(parseDiceTerms('2d6+1d4-2')).toHaveLength(3);
        });

        it('spell dice reject oversized dice', () => {
            expect(() => rollSpellDice('99999999d6')).toThrow(/at most/i);
            expect(rollSpellDice('8d6').rolls).toHaveLength(8);
        });

        it('aura dice reject oversized dice', () => {
            expect(() => rollAuraDice('99999999d6')).toThrow(/at most/i);
            expect(rollAuraDice('3d1')).toBe(3);
        });
    });
});
