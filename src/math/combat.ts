import { DiceEngine } from './dice';
import { CalculationResult } from './schemas';

export class CombatEngine {
    private diceEngine: DiceEngine;

    constructor(seed?: string) {
        this.diceEngine = new DiceEngine(seed);
    }

    attackRoll(attacker: { attackBonus: number, critRange?: number }, target: { ac: number }, advantage?: boolean, disadvantage?: boolean): CalculationResult {
        // Roll 1d20 + bonus
        const critThreshold = attacker.critRange || 20;
        const expr = {
            count: 1,
            sides: 20,
            modifier: attacker.attackBonus,
            advantage,
            disadvantage
        };

        const rollResult = this.diceEngine.roll(expr);
        const rolls = rollResult.metadata?.rolls as number[];
        // If advantage/disadvantage, rolls has 1 element (the chosen one) or we need to look at steps.
        // DiceEngine implementation of advantage returns the chosen roll in rolls array?
        // Let's check DiceEngine.roll:
        // if (expr.advantage || expr.disadvantage) { ... rolls.push(...chosenSet.rolls); }
        // So yes, rolls[0] is the final die roll used.

        const d20 = rolls[0];
        const total = rollResult.result as number;
        const isCrit = d20 >= critThreshold;
        const isMiss = d20 === 1; // Critical miss
        const hit = !isMiss && (isCrit || total >= target.ac);

        const steps = [
            ...rollResult.steps,
            `Target AC: ${target.ac}`,
            `Natural Roll: ${d20}`,
            isCrit ? 'Critical Hit!' : (isMiss ? 'Critical Miss!' : (hit ? 'Hit!' : 'Miss!'))
        ];

        return {
            ...rollResult,
            result: hit ? (isCrit ? 'crit' : 'hit') : 'miss',
            steps,
            metadata: {
                ...rollResult.metadata,
                isCrit,
                isMiss,
                hit,
                total
            }
        };
    }

    damageRoll(damageExpr: string, isCrit: boolean = false): CalculationResult {
        // If crit, double the dice count.
        // We need to parse first.
        const baseExpr = this.diceEngine.parse(damageExpr);
        const expr = {
            ...baseExpr,
            count: isCrit ? baseExpr.count * 2 : baseExpr.count
        };

        const result = this.diceEngine.roll(expr);
        if (isCrit) {
            result.steps.unshift('Critical Hit! Doubling dice count.');
        }
        return result;
    }

    savingThrow(dc: number, modifier: number, advantage?: boolean, disadvantage?: boolean): CalculationResult {
        const expr = {
            count: 1,
            sides: 20,
            modifier,
            advantage,
            disadvantage
        };
        const rollResult = this.diceEngine.roll(expr);
        const total = rollResult.result as number;
        const success = total >= dc;
        const margin = total - dc;

        return {
            ...rollResult,
            result: success ? 'success' : 'failure',
            steps: [
                ...rollResult.steps,
                `DC: ${dc}`,
                success ? `Passed by ${margin}` : `Failed by ${-margin}`
            ],
            metadata: {
                ...rollResult.metadata,
                success,
                margin
            }
        };
    }

    fallDamage(feet: number): CalculationResult {
        const diceCount = Math.min(20, Math.floor(feet / 10));
        if (diceCount === 0) {
            return {
                input: `${feet} ft fall`,
                result: 0,
                steps: ['Fall distance < 10ft, no damage.'],
                timestamp: new Date().toISOString()
            };
        }
        return this.diceEngine.roll(`${diceCount}d6`);
    }

    encounterBalance(partyLevels: number[], enemyCRs: number[]): { difficulty: string, xpBudget: number, adjustedXP: number } {
        // Simplified 5e logic
        // 1. Calculate Party XP Thresholds
        // This requires a table lookup. For MVP let's approximate or use a small map.
        // Level 1: Easy 25, Medium 50, Hard 75, Deadly 100
        // ...
        // Let's implement a simplified version or just return the raw XP sums for now.
        // Task says "CR calculation, difficulty, XP budget analysis".

        // Let's just sum enemy XP (approx from CR) and compare to party budget.
        // CR to XP map
        const crToXp: Record<number, number> = {
            0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800
            // ... extend as needed
        };

        const getXp = (cr: number) => crToXp[cr] || cr * 200; // Fallback

        const totalEnemyXP = enemyCRs.reduce((sum, cr) => sum + getXp(cr), 0);

        // Multiplier for number of enemies
        let multiplier = 1;
        const count = enemyCRs.length;
        if (count === 2) multiplier = 1.5;
        else if (count >= 3 && count <= 6) multiplier = 2;
        else if (count >= 7 && count <= 10) multiplier = 2.5;
        else if (count >= 11) multiplier = 3;

        const adjustedXP = totalEnemyXP * multiplier;

        // Party thresholds (simplified for Level 1-5)
        const thresholds: Record<number, number[]> = {
            1: [25, 50, 75, 100],
            2: [50, 100, 150, 200],
            3: [75, 150, 225, 400],
            4: [125, 250, 375, 500],
            5: [250, 500, 750, 1100]
        };

        let partyThresholds = [0, 0, 0, 0]; // Easy, Med, Hard, Deadly
        for (const level of partyLevels) {
            const t = thresholds[level] || [0, 0, 0, 0];
            partyThresholds[0] += t[0];
            partyThresholds[1] += t[1];
            partyThresholds[2] += t[2];
            partyThresholds[3] += t[3];
        }

        let difficulty = 'Trivial';
        if (adjustedXP >= partyThresholds[3]) difficulty = 'Deadly';
        else if (adjustedXP >= partyThresholds[2]) difficulty = 'Hard';
        else if (adjustedXP >= partyThresholds[1]) difficulty = 'Medium';
        else if (adjustedXP >= partyThresholds[0]) difficulty = 'Easy';

        return {
            difficulty,
            xpBudget: partyThresholds[2], // Usually 'Hard' is the budget limit
            adjustedXP
        };
    }
}
