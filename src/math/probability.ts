import { DiceExpression } from './schemas.js';
import { DiceEngine } from './dice.js';
import { assertDiceWithinLimits } from './dice-limits.js';

/**
 * Cap on (outcomes of one die) x (number of dice). Convolution cost grows with
 * the square of this, so it is bounded separately from the roll limits: rolling
 * 1000d1000 is cheap, computing its exact distribution is not.
 */
const MAX_DISTRIBUTION_SIZE = 2000;

type Distribution = Map<number, number>; // Value -> Probability

export class ProbabilityEngine {
    private diceEngine = new DiceEngine();

    getDistribution(expression: string | DiceExpression): Distribution {
        const expr = typeof expression === 'string' ? this.diceEngine.parse(expression) : expression;

        // 1. Base distribution for 1 die
        assertDiceWithinLimits(expr.count, expr.sides, !!expr.explode);
        let dist = this.singleDieDistribution(expr.sides, !!expr.explode);
        if (dist.size * expr.count > MAX_DISTRIBUTION_SIZE) {
            throw new Error(
                `Distribution too large to compute exactly for ${expr.count}d${expr.sides}${expr.explode ? '!' : ''}. ` +
                'Use fewer or smaller dice.'
            );
        }

        // 2. Convolve for N dice
        let totalDist = dist;
        for (let i = 1; i < expr.count; i++) {
            totalDist = this.convolve(totalDist, dist);
        }
        dist = totalDist;

        // 3. Handle Advantage/Disadvantage
        if (expr.advantage) {
            dist = this.applyAdvantage(dist);
        } else if (expr.disadvantage) {
            dist = this.applyDisadvantage(dist);
        }

        // 4. Apply modifier
        if (expr.modifier !== 0) {
            dist = this.shift(dist, expr.modifier);
        }

        return dist;
    }

    calculateProbability(expression: string, target: number, comparison: 'gte' | 'lte' | 'eq' | 'gt' | 'lt' = 'gte'): number {
        const dist = this.getDistribution(expression);
        let prob = 0;
        for (const [v, p] of dist) {
            let match = false;
            switch (comparison) {
                case 'gte': match = v >= target; break;
                case 'lte': match = v <= target; break;
                case 'eq': match = v === target; break;
                case 'gt': match = v > target; break;
                case 'lt': match = v < target; break;
            }
            if (match) prob += p;
        }
        return prob;
    }

    expectedValue(expression: string | DiceExpression): number {
        const dist = this.getDistribution(expression);
        let ev = 0;
        for (const [v, p] of dist) {
            ev += v * p;
        }
        return ev;
    }

    compare(exprA: string, exprB: string): number {
        // P(A > B)
        const distA = this.getDistribution(exprA);
        const distB = this.getDistribution(exprB);

        // Invert B to get distribution of -B
        const distNegB = new Map<number, number>();
        for (const [v, p] of distB) {
            distNegB.set(-v, p);
        }

        // Convolve A and -B to get distribution of A - B
        const distDiff = this.convolve(distA, distNegB);

        // Sum prob where diff > 0
        let prob = 0;
        for (const [v, p] of distDiff) {
            if (v > 0) prob += p;
        }
        return prob;
    }

    private singleDieDistribution(sides: number, explode: boolean): Distribution {
        const dist = new Map<number, number>();
        if (!explode) {
            const prob = 1 / sides;
            for (let i = 1; i <= sides; i++) {
                dist.set(i, prob);
            }
            return dist;
        } else {
            // Exploding dice
            // Limit recursion by probability threshold
            let currentProb = 1 / sides;
            let offset = 0;
            const threshold = 1e-9;

            // Safety break to prevent infinite loops if something goes wrong
            let iterations = 0;
            const maxIterations = 20;

            while (currentProb > threshold && iterations < maxIterations) {
                for (let i = 1; i < sides; i++) {
                    dist.set(offset + i, currentProb);
                }
                offset += sides;
                currentProb /= sides;
                iterations++;
            }
            return dist;
        }
    }

    private convolve(d1: Distribution, d2: Distribution): Distribution {
        const result = new Map<number, number>();
        for (const [v1, p1] of d1) {
            for (const [v2, p2] of d2) {
                const sum = v1 + v2;
                const p = p1 * p2;
                result.set(sum, (result.get(sum) || 0) + p);
            }
        }
        return result;
    }

    private applyAdvantage(d: Distribution): Distribution {
        return this.orderStatistic(d, 'max');
    }

    private applyDisadvantage(d: Distribution): Distribution {
        return this.orderStatistic(d, 'min');
    }

    private orderStatistic(d: Distribution, type: 'max' | 'min'): Distribution {
        const result = new Map<number, number>();
        const sortedKeys = Array.from(d.keys()).sort((a, b) => a - b);

        // Calculate CDF
        const cdf = new Map<number, number>();
        let cumProb = 0;
        for (const k of sortedKeys) {
            cumProb += d.get(k)!;
            cdf.set(k, cumProb);
        }

        for (let i = 0; i < sortedKeys.length; i++) {
            const k = sortedKeys[i];
            const pk = d.get(k)!;
            const cdfK = cdf.get(k)!;

            // CDF(k-1) is the CDF of the previous element in sortedKeys
            const cdfKMinus1 = i > 0 ? cdf.get(sortedKeys[i - 1])! : 0;

            let newProb: number;
            if (type === 'max') {
                // P(max = k) = P(X=k) * (CDF(k) + CDF(k-1))
                newProb = pk * (cdfK + cdfKMinus1);
            } else {
                // P(min = k) = P(X=k) * (2 - CDF(k) - CDF(k-1))
                newProb = pk * (2 - cdfK - cdfKMinus1);
            }
            result.set(k, newProb);
        }
        return result;
    }

    private shift(d: Distribution, amount: number): Distribution {
        const result = new Map<number, number>();
        for (const [v, p] of d) {
            result.set(v + amount, p);
        }
        return result;
    }
}
