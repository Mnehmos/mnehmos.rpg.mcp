/**
 * Tests for consolidated math_manage tool
 * Validates all 5 actions: roll, probability, solve, simplify, projectile
 */

import { handleMathManage, MathManageTool } from '../../../src/server/consolidated/math-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- MATH_MANAGE_JSON\n([\s\S]*?)\nMATH_MANAGE_JSON -->/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
    }
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
    } catch {
        // Not valid JSON
    }
    return { error: 'parse_failed', rawText: text };
}

describe('math_manage consolidated tool', () => {
    const ctx = { sessionId: 'test-session' };

    beforeEach(() => {
        closeDb();
        getDb(':memory:');
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(MathManageTool.name).toBe('math_manage');
        });

        it('should list all available actions in description', () => {
            expect(MathManageTool.description).toContain('roll');
            expect(MathManageTool.description).toContain('probability');
            expect(MathManageTool.description).toContain('solve');
            expect(MathManageTool.description).toContain('simplify');
            expect(MathManageTool.description).toContain('projectile');
        });

        it('points RPG checks at the registered stunt tool instead of nonexistent tools', () => {
            expect(MathManageTool.description).toContain('improvisation_manage { action: "stunt"');
            expect(MathManageTool.description).toContain('there is no standalone roll_saving_throw tool');
            expect(MathManageTool.description).not.toContain('Use roll_skill_check');
            expect(MathManageTool.description).not.toContain('Use roll_ability_check');
        });
    });

    describe('roll action', () => {
        it('should roll basic dice', async () => {
            const result = await handleMathManage({
                action: 'roll',
                expression: '2d6+3'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('roll');
            expect(data.expression).toBe('2d6+3');
            expect(typeof data.total).toBe('number');
            expect(data.total).toBeGreaterThanOrEqual(5);  // Min: 1+1+3
            expect(data.total).toBeLessThanOrEqual(15);    // Max: 6+6+3
        });

        it('should handle drop lowest', async () => {
            const result = await handleMathManage({
                action: 'roll',
                expression: '4d6dl1',
                seed: 'test-seed-dl'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.expression).toBe('4d6dl1');
            expect(typeof data.total).toBe('number');
        });

        it('should handle keep highest (advantage)', async () => {
            const result = await handleMathManage({
                action: 'roll',
                expression: '2d20kh1',
                seed: 'test-advantage'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.total).toBeGreaterThanOrEqual(1);
            expect(data.total).toBeLessThanOrEqual(20);
        });

        it('should use deterministic seed', async () => {
            const result1 = await handleMathManage({
                action: 'roll',
                expression: '1d20',
                seed: 'fixed-seed'
            }, ctx);

            const result2 = await handleMathManage({
                action: 'roll',
                expression: '1d20',
                seed: 'fixed-seed'
            }, ctx);

            const data1 = parseResult(result1);
            const data2 = parseResult(result2);
            expect(data1.total).toBe(data2.total);
        });

        it('should accept "dice" alias', async () => {
            const result = await handleMathManage({
                action: 'dice',
                expression: '1d6'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('roll');
        });

        it('should accept "d20" alias', async () => {
            const result = await handleMathManage({
                action: 'd20',
                expression: '1d20'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('roll');
        });
    });

    describe('probability action', () => {
        it('should calculate probability of hitting target', async () => {
            const result = await handleMathManage({
                action: 'probability',
                expression: '2d6',
                target: 7,
                comparison: 'gte'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('probability');
            expect(typeof data.probability).toBe('number');
            expect(data.probability).toBeGreaterThan(0);
            expect(data.probability).toBeLessThan(1);
            expect(data.probabilityPercent).toContain('%');
        });

        it('should calculate expected value', async () => {
            const result = await handleMathManage({
                action: 'probability',
                expression: '2d6',
                target: 7,
                comparison: 'gte'
            }, ctx);

            const data = parseResult(result);
            expect(data.expectedValue).toBe(7); // EV of 2d6 is 7
        });

        it('should support different comparisons', async () => {
            const resultLte = await handleMathManage({
                action: 'probability',
                expression: '1d6',
                target: 3,
                comparison: 'lte'
            }, ctx);

            const dataLte = parseResult(resultLte);
            expect(dataLte.probability).toBe(0.5); // 1,2,3 out of 6

            const resultEq = await handleMathManage({
                action: 'probability',
                expression: '1d6',
                target: 1,
                comparison: 'eq'
            }, ctx);

            const dataEq = parseResult(resultEq);
            expect(dataEq.probability).toBeCloseTo(1/6, 4);
        });

        it('should accept "prob" alias', async () => {
            const result = await handleMathManage({
                action: 'prob',
                expression: '1d20',
                target: 15,
                comparison: 'gte'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('probability');
        });

        it('should accept "odds" alias', async () => {
            const result = await handleMathManage({
                action: 'odds',
                expression: '1d20',
                target: 10,
                comparison: 'gte'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('probability');
        });
    });

    describe('solve action', () => {
        it('should solve simple linear equation', async () => {
            const result = await handleMathManage({
                action: 'solve',
                equation: '2x + 3 = 7',
                variable: 'x'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('solve');
            expect(data.equation).toBe('2x + 3 = 7');
        });

        it('should default to x as variable', async () => {
            const result = await handleMathManage({
                action: 'solve',
                equation: 'x + 5 = 10'
            }, ctx);

            const data = parseResult(result);
            expect(data.variable).toBe('x');
        });

        it('should accept "equation" alias', async () => {
            const result = await handleMathManage({
                action: 'equation',
                equation: 'x = 5'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('solve');
        });

        it('should accept "algebra_solve" alias', async () => {
            const result = await handleMathManage({
                action: 'algebra_solve',
                equation: 'x = 10'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('solve');
        });
    });

    describe('simplify action', () => {
        it('should simplify expressions', async () => {
            const result = await handleMathManage({
                action: 'simplify',
                expression: '2x + 3x'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('simplify');
            expect(data.input).toBe('2x + 3x');
        });

        it('should accept "reduce" alias', async () => {
            const result = await handleMathManage({
                action: 'reduce',
                expression: '4y - 2y'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('simplify');
        });

        it('should accept "algebra_simplify" alias', async () => {
            const result = await handleMathManage({
                action: 'algebra_simplify',
                expression: '3a + 2a'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('simplify');
        });
    });

    describe('projectile action', () => {
        it('should calculate projectile motion', async () => {
            const result = await handleMathManage({
                action: 'projectile',
                velocity: 20,
                angle: 45,
                height: 0,
                gravity: 9.81
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('projectile');
            expect(data.velocity).toBe(20);
            expect(data.angle).toBe(45);
            expect(typeof data.maxHeight).toBe('number');
            expect(typeof data.range).toBe('number');
        });

        it('should use default gravity', async () => {
            const result = await handleMathManage({
                action: 'projectile',
                velocity: 10,
                angle: 30
            }, ctx);

            const data = parseResult(result);
            expect(data.gravity).toBe(9.81);
        });

        it('should handle elevated launch', async () => {
            const result = await handleMathManage({
                action: 'projectile',
                velocity: 15,
                angle: 60,
                height: 10
            }, ctx);

            const data = parseResult(result);
            expect(data.height).toBe(10);
        });

        it('should accept "physics" alias', async () => {
            const result = await handleMathManage({
                action: 'physics',
                velocity: 10,
                angle: 45
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('projectile');
        });

        it('should accept "trajectory" alias', async () => {
            const result = await handleMathManage({
                action: 'trajectory',
                velocity: 10,
                angle: 45
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('projectile');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleMathManage({
                action: 'rol',  // Missing 'l'
                expression: '1d6'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('roll');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleMathManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting for roll', async () => {
            const result = await handleMathManage({
                action: 'roll',
                expression: '2d6'
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('DICE ROLL');
        });

        it('should include rich text formatting for probability', async () => {
            const result = await handleMathManage({
                action: 'probability',
                expression: '2d6',
                target: 7,
                comparison: 'gte'
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('PROBABILITY');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleMathManage({
                action: 'roll',
                expression: '1d6'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- MATH_MANAGE_JSON');
        });
    });

    describe('calculation storage', () => {
        it('should store calculation with ID', async () => {
            const result = await handleMathManage({
                action: 'roll',
                expression: '1d20'
            }, ctx);

            const data = parseResult(result);
            expect(data.calculationId).toBeDefined();
            expect(typeof data.calculationId).toBe('string');
        });

        it('should include session ID', async () => {
            const result = await handleMathManage({
                action: 'probability',
                expression: '2d6',
                target: 7,
                comparison: 'gte'
            }, ctx);

            const data = parseResult(result);
            expect(data.calculationId).toBeDefined();
        });
    });
});
