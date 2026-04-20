import seedrandom from 'seedrandom';

/**
 * Comprehensive Combat RNG system supporting multiple RPG dice mechanics.
 * Deterministic and seeded for reproducibility.
 * 
 * Supports:
 * - D&D 5e: Advantage, Disadvantage, Keep/Drop, Reroll, Minimum
 * - Savage Worlds: Exploding dice
 * - Hackmaster: Penetrating dice
 * - Shadowrun/WoD: Dice pool success counting
 * - Pathfinder 2e: Degree-of-success mechanics (in CombatEngine)
 */
export class CombatRNG {
    private rng: seedrandom.PRNG;

    constructor(seed: string) {
        this.rng = seedrandom(seed);
    }

    /**
     * Roll a single die with N sides
     */
    private rollDie(sides: number): number {
        return Math.floor(this.rng() * sides) + 1;
    }

    /**
     * Parse and execute standard dice notation, including multi-term sums.
     * Examples: "1d20", "2d6+3", "1d8-1", "1d6+4+2d6" (sneak attack), "1d8+3+2d8" (smite)
     */
    roll(notation: string): number {
        const terms = parseDiceTerms(notation);
        let total = 0;
        for (const term of terms) {
            if (term.kind === 'dice') {
                for (let i = 0; i < term.count; i++) {
                    total += term.sign * this.rollDie(term.sides);
                }
            } else {
                total += term.sign * term.value;
            }
        }
        return total;
    }

    /**
     * D&D 5e: Roll with Advantage (2d20, keep highest)
     */
    rollWithAdvantage(modifier: number = 0): number {
        const roll1 = this.rollDie(20);
        const roll2 = this.rollDie(20);
        return Math.max(roll1, roll2) + modifier;
    }

    /**
     * D&D 5e: Roll with Disadvantage (2d20, keep lowest)
     */
    rollWithDisadvantage(modifier: number = 0): number {
        const roll1 = this.rollDie(20);
        const roll2 = this.rollDie(20);
        return Math.min(roll1, roll2) + modifier;
    }

    /**
     * General Keep/Drop mechanic
     * Roll N dice of S sides, keep the highest/lowest K dice
     */
    rollKeepDrop(
        count: number,
        sides: number,
        keep: number,
        type: 'highest' | 'lowest'
    ): number {
        if (keep > count) {
            throw new Error(`Cannot keep ${keep} dice when only rolling ${count}`);
        }

        const rolls: number[] = [];
        for (let i = 0; i < count; i++) {
            rolls.push(this.rollDie(sides));
        }

        rolls.sort((a, b) => type === 'highest' ? b - a : a - b);

        let total = 0;
        for (let i = 0; i < keep; i++) {
            total += rolls[i];
        }

        return total;
    }

    /**
     * D&D 5e: Reroll specific values once (e.g., Great Weapon Fighting)
     * rerollOn: array of values to reroll (e.g., [1, 2])
     */
    rollWithReroll(count: number, sides: number, rerollOn: number[]): number {
        let total = 0;

        for (let i = 0; i < count; i++) {
            let roll = this.rollDie(sides);

            // Reroll once if value is in rerollOn array
            if (rerollOn.includes(roll)) {
                roll = this.rollDie(sides);
            }

            total += roll;
        }

        return total;
    }

    /**
     * D&D 5e: Roll with minimum value (e.g., Reliable Talent)
     * Any roll below min is treated as min
     */
    rollWithMin(count: number, sides: number, min: number): number {
        let total = 0;

        for (let i = 0; i < count; i++) {
            const roll = this.rollDie(sides);
            total += Math.max(roll, min);
        }

        return total;
    }

    /**
     * Savage Worlds/L5R: Exploding dice
     * When max value is rolled, roll again and add (can chain indefinitely)
     */
    rollExploding(count: number, sides: number): number {
        let total = 0;

        for (let i = 0; i < count; i++) {
            let roll = this.rollDie(sides);
            total += roll;

            // Keep exploding while rolling max
            while (roll === sides) {
                roll = this.rollDie(sides);
                total += roll;
            }
        }

        return total;
    }

    /**
     * Hackmaster: Penetrating dice
     * Like exploding, but subtract 1 from each reroll after the first
     */
    rollPenetrating(count: number, sides: number): number {
        let total = 0;

        for (let i = 0; i < count; i++) {
            let roll = this.rollDie(sides);
            total += roll;

            // Keep penetrating while rolling max
            while (roll === sides) {
                roll = this.rollDie(sides) - 1; // Subtract 1 from penetration
                total += roll;
            }
        }

        return total;
    }

    /**
     * Shadowrun/World of Darkness: Dice pool success counting
     * Roll poolSize dice of diceSize, count how many meet/exceed threshold
     * 
     * @param poolSize Number of dice to roll
     * @param diceSize Size of each die (typically d6 or d10)
     * @param threshold Minimum value to count as success
     * @returns Number of successes
     */
    rollPool(poolSize: number, diceSize: number, threshold: number): number {
        let successes = 0;

        for (let i = 0; i < poolSize; i++) {
            const roll = this.rollDie(diceSize);
            if (roll >= threshold) {
                successes++;
            }
        }

        return successes;
    }

    /**
     * Convenience method for d20 checks
     */
    d20(modifier: number = 0): number {
        return this.rollDie(20) + modifier;
    }

    /**
     * Make a check against a Difficulty Class
     * Returns true if roll + modifier meets or exceeds DC
     */
    check(modifier: number, dc: number): boolean {
        return this.d20(modifier) >= dc;
    }

    /**
     * Pathfinder 2e: Determine degree of success
     * Returns: 'critical-failure' | 'failure' | 'success' | 'critical-success'
     */
    checkDegree(
        modifier: number,
        dc: number
    ): 'critical-failure' | 'failure' | 'success' | 'critical-success' {
        const result = this.checkDegreeDetailed(modifier, dc);
        return result.degree;
    }

    /**
     * Detailed check result with full dice mechanics exposed
     * This is the TRANSPARENT version - shows exactly what was rolled
     */
    checkDegreeDetailed(
        modifier: number,
        dc: number
    ): CheckResult {
        const roll = this.rollDie(20);
        const total = roll + modifier;
        const margin = total - dc;

        // Natural 20/1 adjust degree by one step
        let degree: 'critical-failure' | 'failure' | 'success' | 'critical-success';

        if (margin >= 10) {
            degree = 'critical-success';
        } else if (margin >= 0) {
            degree = 'success';
        } else if (margin >= -10) {
            degree = 'failure';
        } else {
            degree = 'critical-failure';
        }

        const isNat20 = roll === 20;
        const isNat1 = roll === 1;

        // Adjust for natural 20 (improve by one step)
        if (isNat20) {
            if (degree === 'failure') degree = 'success';
            else if (degree === 'success') degree = 'critical-success';
        }

        // Adjust for natural 1 (worsen by one step)
        if (isNat1) {
            if (degree === 'success') degree = 'failure';
            else if (degree === 'critical-success') degree = 'success';
        }

        return {
            roll,
            modifier,
            total,
            dc,
            margin,
            degree,
            isNat20,
            isNat1,
            isHit: degree === 'success' || degree === 'critical-success',
            isCrit: degree === 'critical-success'
        };
    }

    /**
     * Roll damage dice with detailed breakdown.
     * Supports compound expressions like "1d6+4+2d6" (sneak attack) and "1d8+3+2d8" (smite).
     */
    rollDamageDetailed(notation: string): DamageResult {
        const terms = parseDiceTerms(notation);
        const rolls: number[] = [];
        let diceTotal = 0;
        let modifier = 0;

        for (const term of terms) {
            if (term.kind === 'dice') {
                for (let i = 0; i < term.count; i++) {
                    const r = this.rollDie(term.sides);
                    rolls.push(term.sign * r);
                    diceTotal += term.sign * r;
                }
            } else {
                modifier += term.sign * term.value;
            }
        }

        return {
            notation,
            rolls,
            diceTotal,
            modifier,
            total: diceTotal + modifier
        };
    }
}

/**
 * Detailed result of a d20 check
 */
export interface CheckResult {
    roll: number;           // The raw d20 roll (1-20)
    modifier: number;       // The modifier applied
    total: number;          // roll + modifier
    dc: number;             // The DC to beat
    margin: number;         // total - dc (positive = success)
    degree: 'critical-failure' | 'failure' | 'success' | 'critical-success';
    isNat20: boolean;
    isNat1: boolean;
    isHit: boolean;         // success or critical-success
    isCrit: boolean;        // critical-success
}

/**
 * Detailed result of a damage roll
 */
export interface DamageResult {
    notation: string;       // Original notation (e.g., "2d6+3")
    rolls: number[];        // Individual die results
    diceTotal: number;      // Sum of dice only
    modifier: number;       // Flat modifier
    total: number;          // Final damage total
}

type DiceTerm =
    | { kind: 'dice'; count: number; sides: number; sign: 1 | -1 }
    | { kind: 'scalar'; value: number; sign: 1 | -1 };

/**
 * Parse compound dice notation into a list of terms.
 * Accepts a `+`/`-`-joined chain of dice (`NdS`, `dS`) and integers.
 * Examples: `1d6+4+2d6`, `1d8+3+2d8`, `2d6+1d4-2`, `d20+5`.
 *
 * Strict grammar — rejects malformed operator chains like `1d6++2`,
 * `1d6--2`, `1d6+`, or trailing operators. Pattern:
 *   <term> ( [+-] <term> )*
 *   <term> := <int> | <int>?d<int>
 * with at most one leading sign.
 */
export function parseDiceTerms(notation: string): DiceTerm[] {
    const stripped = notation.replace(/\s+/g, '');
    if (!stripped) {
        throw new Error(`Invalid dice notation: ${notation}`);
    }
    const TERM = String.raw`(?:\d*d\d+|\d+)`;
    const STRICT = new RegExp(`^[+-]?${TERM}(?:[+-]${TERM})*$`, 'i');
    if (!STRICT.test(stripped)) {
        throw new Error(`Invalid dice notation: ${notation}`);
    }

    // Tokenize once the grammar check has passed.
    const tokens = stripped.match(/[+-]?[^+-]+/g)!;

    const terms: DiceTerm[] = [];
    for (const raw of tokens) {
        const sign: 1 | -1 = raw.startsWith('-') ? -1 : 1;
        const body = raw.replace(/^[+-]/, '');
        const diceMatch = body.match(/^(\d*)d(\d+)$/i);
        if (diceMatch) {
            const count = diceMatch[1] === '' ? 1 : parseInt(diceMatch[1], 10);
            const sides = parseInt(diceMatch[2], 10);
            if (count <= 0 || sides <= 0) {
                throw new Error(`Invalid dice notation: ${notation}`);
            }
            terms.push({ kind: 'dice', count, sides, sign });
            continue;
        }
        // Grammar already guaranteed scalar shape.
        terms.push({ kind: 'scalar', value: parseInt(body, 10), sign });
    }
    return terms;
}
