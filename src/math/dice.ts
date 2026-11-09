import seedrandom from 'seedrandom';
import { DiceExpression, CalculationResult } from './schemas.js';
import { assertDiceWithinLimits, MAX_EXPLOSIONS_PER_DIE } from './dice-limits.js';

export class DiceEngine {
    private rng: seedrandom.PRNG;
    private seed: string;

    constructor(seed?: string) {
        this.seed = seed || new Date().toISOString();
        this.rng = seedrandom(this.seed);
    }

    // Parse string "2d6+4" into DiceExpression object
    parse(expression: string): DiceExpression {
        // Regex supports: NdX, dX (shorthand for 1dX), NdX+M, NdXdl1, NdXkh2, NdXdl1+5, NdX!
        const match = expression.match(/^(\d+)?d(\d+)(?:(dl|dh|kl|kh)(\d+))?([+-]\d+)?(!)?$/);
        if (!match) {
            throw new Error(`Invalid dice expression: ${expression}`);
        }

        const count = match[1] ? parseInt(match[1], 10) : 1; // Default to 1 if omitted
        const sides = parseInt(match[2], 10);
        const modifierType = match[3]; // dl, dh, kl, kh
        const modifierCount = match[4] ? parseInt(match[4], 10) : 0;
        const modifier = match[5] ? parseInt(match[5], 10) : 0;
        const explode = !!match[6];

        assertDiceWithinLimits(count, sides, explode);

        const result: DiceExpression = {
            count,
            sides,
            modifier,
            explode
        };

        // Add drop/keep modifiers
        if (modifierType === 'dl') result.dropLowest = modifierCount;
        else if (modifierType === 'dh') result.dropHighest = modifierCount;
        else if (modifierType === 'kl') result.keepLowest = modifierCount;
        else if (modifierType === 'kh') result.keepHighest = modifierCount;

        return result;
    }

    roll(expression: string | DiceExpression): CalculationResult {
        const expr = typeof expression === 'string' ? this.parse(expression) : expression;
        // Expressions can also arrive as objects, which never pass through parse().
        assertDiceWithinLimits(expr.count, expr.sides, !!expr.explode);
        const rolls: number[] = [];
        const steps: string[] = [];

        let total = 0;

        // Advantage/Disadvantage logic would typically be handled by rolling twice
        // but here we just implement standard rolling.
        // If advantage is requested, the caller should probably call roll twice or we extend this.
        // The schema has advantage/disadvantage flags, so let's support them if passed in object.

        if (expr.advantage || expr.disadvantage) {
            // Roll two sets
            const set1 = this.rollSet(expr);
            const set2 = this.rollSet(expr);

            steps.push(`Roll 1: [${set1.rolls.join(', ')}] = ${set1.sum}`);
            steps.push(`Roll 2: [${set2.rolls.join(', ')}] = ${set2.sum}`);

            let chosenSet;
            if (expr.advantage) {
                chosenSet = set1.sum >= set2.sum ? set1 : set2;
                steps.push(`Advantage: Taken ${chosenSet.sum}`);
            } else {
                chosenSet = set1.sum <= set2.sum ? set1 : set2;
                steps.push(`Disadvantage: Taken ${chosenSet.sum}`);
            }

            total = chosenSet.sum + expr.modifier;
            steps.push(`Total: ${chosenSet.sum} + ${expr.modifier} = ${total}`);
            for (const roll of chosenSet.rolls) rolls.push(roll);
        } else {
            const set = this.rollSet(expr);
            for (const roll of set.rolls) rolls.push(roll);
            total = set.sum + expr.modifier;
            steps.push(`Rolled ${expr.count}d${expr.sides}: [${set.rolls.join(', ')}]`);

            // Show kept/dropped dice if applicable
            if (set.dropped && set.dropped.length > 0) {
                steps.push(`Kept: [${set.kept?.join(', ')}], Dropped: [${set.dropped.join(', ')}]`);
                steps.push(`Sum of kept dice: ${set.sum}`);
            }

            if (expr.modifier !== 0) {
                steps.push(`Modifier: ${expr.modifier}`);
                steps.push(`Total: ${set.sum} + ${expr.modifier} = ${total}`);
            } else {
                steps.push(`Total: ${total}`);
            }
        }

        return {
            input: typeof expression === 'string' ? expression : `${expr.count}d${expr.sides}${expr.modifier >= 0 ? '+' : ''}${expr.modifier}`,
            result: total,
            steps,
            timestamp: new Date().toISOString(),
            seed: this.seed,
            metadata: { rolls }
        };
    }

    private rollSet(expr: DiceExpression): { rolls: number[], sum: number, kept?: number[], dropped?: number[] } {
        const rolls: number[] = [];

        for (let i = 0; i < expr.count; i++) {
            let roll = Math.floor(this.rng() * expr.sides) + 1;
            rolls.push(roll);

            if (expr.explode && roll === expr.sides) {
                // Explode!
                let exploded = roll;
                let explosions = 0;
                while (exploded === expr.sides && explosions < MAX_EXPLOSIONS_PER_DIE) {
                    exploded = Math.floor(this.rng() * expr.sides) + 1;
                    rolls.push(exploded);
                    explosions++;
                }
            }
        }

        // Apply drop/keep modifiers
        let keptRolls = [...rolls];
        let droppedRolls: number[] = [];

        if (expr.dropLowest && expr.dropLowest > 0) {
            const sorted = [...rolls].sort((a, b) => a - b);
            droppedRolls = sorted.slice(0, expr.dropLowest);
            keptRolls = sorted.slice(expr.dropLowest);
        } else if (expr.dropHighest && expr.dropHighest > 0) {
            const sorted = [...rolls].sort((a, b) => b - a);
            droppedRolls = sorted.slice(0, expr.dropHighest);
            keptRolls = sorted.slice(expr.dropHighest);
        } else if (expr.keepLowest && expr.keepLowest > 0) {
            const sorted = [...rolls].sort((a, b) => a - b);
            keptRolls = sorted.slice(0, expr.keepLowest);
            droppedRolls = sorted.slice(expr.keepLowest);
        } else if (expr.keepHighest && expr.keepHighest > 0) {
            const sorted = [...rolls].sort((a, b) => b - a);
            keptRolls = sorted.slice(0, expr.keepHighest);
            droppedRolls = sorted.slice(expr.keepHighest);
        }

        const sum = keptRolls.reduce((acc, val) => acc + val, 0);
        return { rolls, sum, kept: keptRolls, dropped: droppedRolls.length > 0 ? droppedRolls : undefined };
    }
}
