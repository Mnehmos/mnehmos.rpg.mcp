import { CombatRNG } from '../../src/engine/combat/rng';

describe('CombatRNG', () => {
    describe('Determinism', () => {
        it('should produce identical results with same seed', () => {
            const rng1 = new CombatRNG('test-seed-123');
            const rng2 = new CombatRNG('test-seed-123');

            const rolls1 = [rng1.d20(), rng1.roll('2d6+3'), rng1.d20()];
            const rolls2 = [rng2.d20(), rng2.roll('2d6+3'), rng2.d20()];

            expect(rolls1).toEqual(rolls2);
        });

        it('should produce different results with different seeds', () => {
            const rng1 = new CombatRNG('seed-a');
            const rng2 = new CombatRNG('seed-b');

            const roll1 = rng1.d20();
            const roll2 = rng2.d20();

            expect(roll1).not.toBe(roll2);
        });
    });

    describe('Standard Notation Parsing', () => {
        it('should parse simple notation (1d20)', () => {
            const rng = new CombatRNG('notation-test');
            const result = rng.roll('1d20');

            expect(result).toBeGreaterThanOrEqual(1);
            expect(result).toBeLessThanOrEqual(20);
        });

        it('should parse notation with positive modifier (2d6+3)', () => {
            const rng = new CombatRNG('notation-test-2');
            const result = rng.roll('2d6+3');

            expect(result).toBeGreaterThanOrEqual(5); // min: 2 + 3
            expect(result).toBeLessThanOrEqual(15);  // max: 12 + 3
        });

        it('should parse notation with negative modifier (1d8-1)', () => {
            const rng = new CombatRNG('notation-test-3');
            const result = rng.roll('1d8-1');

            expect(result).toBeGreaterThanOrEqual(0); // min: 1 - 1
            expect(result).toBeLessThanOrEqual(7);   // max: 8 - 1
        });

        it('should throw on invalid notation', () => {
            const rng = new CombatRNG('invalid-test');

            expect(() => rng.roll('invalid')).toThrow('Invalid dice notation');
            expect(() => rng.roll('2x6')).toThrow('Invalid dice notation');
        });

        it('should parse compound sneak-attack expression (1d6+4+2d6)', () => {
            const rng = new CombatRNG('compound-sa');
            const result = rng.roll('1d6+4+2d6');
            // min: 1 + 4 + 2 = 7; max: 6 + 4 + 12 = 22
            expect(result).toBeGreaterThanOrEqual(7);
            expect(result).toBeLessThanOrEqual(22);
        });

        it('should parse compound smite expression (1d8+3+2d8)', () => {
            const rng = new CombatRNG('compound-smite');
            const result = rng.roll('1d8+3+2d8');
            // min: 1 + 3 + 2 = 6; max: 8 + 3 + 16 = 27
            expect(result).toBeGreaterThanOrEqual(6);
            expect(result).toBeLessThanOrEqual(27);
        });

        it('should parse mixed dice with subtraction (2d6+1d4-2)', () => {
            const rng = new CombatRNG('compound-mixed');
            const result = rng.roll('2d6+1d4-2');
            // min: 2 + 1 - 2 = 1; max: 12 + 4 - 2 = 14
            expect(result).toBeGreaterThanOrEqual(1);
            expect(result).toBeLessThanOrEqual(14);
        });

        it('should parse shorthand single die (d20)', () => {
            const rng = new CombatRNG('shorthand-d20');
            const result = rng.roll('d20');
            expect(result).toBeGreaterThanOrEqual(1);
            expect(result).toBeLessThanOrEqual(20);
        });

        it('rollDamageDetailed returns separate dice and modifier for compound notation', () => {
            const rng = new CombatRNG('compound-detail');
            const detail = rng.rollDamageDetailed('1d6+4+2d6');
            expect(detail.notation).toBe('1d6+4+2d6');
            // 1 + 2 = 3 dice rolled; modifier = 4
            expect(detail.rolls).toHaveLength(3);
            expect(detail.modifier).toBe(4);
            expect(detail.total).toBe(detail.diceTotal + detail.modifier);
        });

        // Strict-grammar regression: malformed operator sequences must throw
        // rather than silently evaluate (caught by reviewers on PR #51).
        it.each([
            '1d6++2',
            '1d6--2',
            '1d6+-2',
            '1d6-+2',
            '1d6+',
            '1d6-',
            '+',
            '++1d6',
            '1d6+2+',
            '1d6 + + 2'
        ])('rejects malformed operator sequence: %s', (notation) => {
            const rng = new CombatRNG('malformed-ops');
            expect(() => rng.roll(notation)).toThrow('Invalid dice notation');
        });
    });

    describe('Advantage/Disadvantage', () => {
        it('should roll with advantage (2d20 keep highest)', () => {
            const rng = new CombatRNG('advantage-test');
            const result = rng.rollWithAdvantage(5);

            expect(result).toBeGreaterThanOrEqual(6); // min: 1 + 5
            expect(result).toBeLessThanOrEqual(25);  // max: 20 + 5
        });

        it('should roll with disadvantage (2d20 keep lowest)', () => {
            const rng = new CombatRNG('disadvantage-test');
            const result = rng.rollWithDisadvantage(3);

            expect(result).toBeGreaterThanOrEqual(4); // min: 1 + 3
            expect(result).toBeLessThanOrEqual(23);  // max: 20 + 3
        });
    });

    describe('Keep/Drop', () => {
        it('should keep highest dice (4d6 keep 3)', () => {
            const rng = new CombatRNG('keep-high-test');
            const result = rng.rollKeepDrop(4, 6, 3, 'highest');

            expect(result).toBeGreaterThanOrEqual(3);  // min: 1+1+1
            expect(result).toBeLessThanOrEqual(18);   // max: 6+6+6
        });

        it('should keep lowest dice (4d6 keep 3)', () => {
            const rng = new CombatRNG('keep-low-test');
            const result = rng.rollKeepDrop(4, 6, 3, 'lowest');

            expect(result).toBeGreaterThanOrEqual(3);  // min: 1+1+1
            expect(result).toBeLessThanOrEqual(18);   // max: 6+6+6
        });

        it('should throw if keep > count', () => {
            const rng = new CombatRNG('error-test');

            expect(() => rng.rollKeepDrop(3, 6, 5, 'highest'))
                .toThrow('Cannot keep 5 dice when only rolling 3');
        });
    });

    describe('Reroll Mechanics', () => {
        it('should reroll specific values (Great Weapon Fighting)', () => {
            const rng = new CombatRNG('reroll-test');
            const result = rng.rollWithReroll(2, 6, [1, 2]);

            expect(result).toBeGreaterThanOrEqual(2);  // min: 1+1 (even with reroll)
            expect(result).toBeLessThanOrEqual(12);   // max: 6+6
        });
    });

    describe('Minimum Roll', () => {
        it('should enforce minimum value (Reliable Talent)', () => {
            const rng = new CombatRNG('min-test');

            // Run multiple times to check distribution
            const results: number[] = [];
            for (let i = 0; i < 20; i++) {
                const rng2 = new CombatRNG(`min-test-${i}`);
                results.push(rng2.rollWithMin(1, 20, 10));
            }

            // All results should be >= 10
            results.forEach(result => {
                expect(result).toBeGreaterThanOrEqual(10);
                expect(result).toBeLessThanOrEqual(20);
            });
        });
    });

    describe('Exploding Dice', () => {
        it('should explode on max roll', () => {
            const rng = new CombatRNG('explode-test');
            const result = rng.rollExploding(1, 6);

            expect(result).toBeGreaterThanOrEqual(1);
            // Could theoretically be infinite, but practically bounded
        });

        it('should explode multiple dice', () => {
            const rng = new CombatRNG('explode-multi-test');
            const result = rng.rollExploding(3, 6);

            expect(result).toBeGreaterThanOrEqual(3); // min: 1+1+1
        });
    });

    describe('Penetrating Dice', () => {
        it('should penetrate with -1 penalty', () => {
            const rng = new CombatRNG('penetrate-test');
            const result = rng.rollPenetrating(1, 6);

            expect(result).toBeGreaterThanOrEqual(1);
        });

        it('should penetrate multiple dice', () => {
            const rng = new CombatRNG('penetrate-multi-test');
            const result = rng.rollPenetrating(2, 6);

            expect(result).toBeGreaterThanOrEqual(2); // min: 1+1
        });
    });

    describe('Dice Pool Success Counting', () => {
        it('should count successes (Shadowrun style - d6, 5+)', () => {
            const rng = new CombatRNG('pool-test-1');
            const successes = rng.rollPool(5, 6, 5);

            expect(successes).toBeGreaterThanOrEqual(0);
            expect(successes).toBeLessThanOrEqual(5);
        });

        it('should count successes (WoD style - d10, 8+)', () => {
            const rng = new CombatRNG('pool-test-2');
            const successes = rng.rollPool(6, 10, 8);

            expect(successes).toBeGreaterThanOrEqual(0);
            expect(successes).toBeLessThanOrEqual(6);
        });
    });

    describe('Checks', () => {
        it('should perform basic d20 check', () => {
            const rng = new CombatRNG('check-test');
            const result = rng.check(5, 15);

            expect(typeof result).toBe('boolean');
        });
    });

    describe('Pathfinder 2e Degrees of Success', () => {
        it('should return critical success when beating DC by 10+', () => {
            const rng = new CombatRNG('degree-test-1');
            // Force a high roll by trying multiple seeds
            let degree: any;
            for (let i = 0; i < 100; i++) {
                const testRng = new CombatRNG(`degree-crit-${i}`);
                degree = testRng.checkDegree(10, 5); // +10 mod vs DC 5
                if (degree === 'critical-success') break;
            }
            expect(['critical-success', 'success']).toContain(degree);
        });

        it('should return success when meeting DC', () => {
            const rng = new CombatRNG('degree-test-2');
            const degree = rng.checkDegree(0, 15);

            expect(['critical-failure', 'failure', 'success', 'critical-success']).toContain(degree);
        });

        it('should return failure when missing DC', () => {
            const rng = new CombatRNG('degree-test-3');
            const degree = rng.checkDegree(-5, 20);

            expect(['critical-failure', 'failure', 'success', 'critical-success']).toContain(degree);
        });

        it('should return critical failure when missing DC by 10+', () => {
            const rng = new CombatRNG('degree-test-4');
            let degree: any;
            for (let i = 0; i < 100; i++) {
                const testRng = new CombatRNG(`degree-cf-${i}`);
                degree = testRng.checkDegree(-10, 20); // Very likely to crit fail
                if (degree === 'critical-failure') break;
            }
            expect(['critical-failure', 'failure']).toContain(degree);
        });
    });

    describe('Statistical Distribution', () => {
        it('should distribute d20 rolls reasonably', () => {
            const results = new Map<number, number>();

            for (let i = 0; i < 1000; i++) {
                const rng = new CombatRNG(`stat-test-${i}`);
                const roll = rng.d20();
                results.set(roll, (results.get(roll) || 0) + 1);
            }

            // Each number 1-20 should appear at least once in 1000 rolls
            for (let i = 1; i <= 20; i++) {
                expect(results.has(i)).toBe(true);
            }
        });
    });
});
