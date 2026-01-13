/**
 * Consolidated Math Management Tool
 * Replaces 5 separate tools: dice_roll, probability_calculate, algebra_solve, algebra_simplify, physics_projectile
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { DiceEngine } from '../../math/dice.js';
import { ProbabilityEngine } from '../../math/probability.js';
import { AlgebraEngine } from '../../math/algebra.js';
import { PhysicsEngine } from '../../math/physics.js';
import { ExportEngine } from '../../math/export.js';
import { CalculationRepository, StoredCalculation } from '../../storage/repos/calculation.repo.js';
import { getDb } from '../../storage/index.js';
import { ExportFormatSchema } from '../../math/schemas.js';
import { randomUUID } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = [
    'roll', 'probability', 'solve', 'simplify', 'projectile'
] as const;
type MathAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function getRepo() {
    const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db';
    const db = getDb(dbPath);
    return { repo: new CalculationRepository(db), db };
}

function logCalculationEvent(db: any, calculationId: string, type: string, sessionId?: string) {
    db.prepare(`
        INSERT INTO event_logs (type, payload, timestamp)
        VALUES (?, ?, ?)
    `).run('calculation', JSON.stringify({
        calculationId,
        calculationType: type,
        sessionId
    }), new Date().toISOString());
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const RollSchema = z.object({
    action: z.literal('roll'),
    expression: z.string().describe('Dice notation: 2d6+3, 4d6dl1, 2d20kh1, 2d6!'),
    seed: z.string().optional(),
    exportFormat: ExportFormatSchema.optional().default('json')
});

const ProbabilitySchema = z.object({
    action: z.literal('probability'),
    expression: z.string().describe('Dice expression to analyze'),
    target: z.number().int().describe('Target value to compare against'),
    comparison: z.enum(['gte', 'lte', 'eq', 'gt', 'lt']).default('gte'),
    exportFormat: ExportFormatSchema.optional().default('plaintext')
});

const SolveSchema = z.object({
    action: z.literal('solve'),
    equation: z.string().describe('Algebraic equation to solve'),
    variable: z.string().optional().default('x'),
    exportFormat: ExportFormatSchema.optional().default('plaintext')
});

const SimplifySchema = z.object({
    action: z.literal('simplify'),
    expression: z.string().describe('Algebraic expression to simplify'),
    exportFormat: ExportFormatSchema.optional().default('plaintext')
});

const ProjectileSchema = z.object({
    action: z.literal('projectile'),
    velocity: z.number().describe('Initial velocity in m/s'),
    angle: z.number().describe('Launch angle in degrees'),
    height: z.number().optional().default(0).describe('Initial height in meters'),
    gravity: z.number().optional().default(9.81).describe('Gravity acceleration'),
    exportFormat: ExportFormatSchema.optional().default('plaintext')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleRoll(args: z.infer<typeof RollSchema>, sessionId?: string): Promise<object> {
    const { repo, db } = getRepo();
    const engine = new DiceEngine(args.seed);
    const exporter = new ExportEngine();

    const result = engine.roll(args.expression);

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId,
        ...result,
        seed: args.seed || result.seed
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'dice_roll', sessionId);

    return {
        success: true,
        actionType: 'roll',
        expression: args.expression,
        total: result.result,
        rolls: result.steps,
        seed: calculation.seed,
        calculationId: calculation.id,
        formatted: exporter.export(calculation, args.exportFormat)
    };
}

async function handleProbability(args: z.infer<typeof ProbabilitySchema>, sessionId?: string): Promise<object> {
    const { repo, db } = getRepo();
    const engine = new ProbabilityEngine();
    const exporter = new ExportEngine();

    const prob = engine.calculateProbability(args.expression, args.target, args.comparison);
    const ev = engine.expectedValue(args.expression);

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId,
        input: JSON.stringify(args),
        result: prob,
        steps: [
            `Probability (${args.comparison} ${args.target}): ${(prob * 100).toFixed(2)}%`,
            `Expected Value: ${ev.toFixed(2)}`
        ],
        timestamp: new Date().toISOString(),
        metadata: { type: 'probability', probability: prob, expectedValue: ev }
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'probability', sessionId);

    return {
        success: true,
        actionType: 'probability',
        expression: args.expression,
        target: args.target,
        comparison: args.comparison,
        probability: prob,
        probabilityPercent: `${(prob * 100).toFixed(2)}%`,
        expectedValue: ev,
        calculationId: calculation.id,
        formatted: exporter.export(calculation, args.exportFormat)
    };
}

async function handleSolve(args: z.infer<typeof SolveSchema>, sessionId?: string): Promise<object> {
    const { repo, db } = getRepo();
    const engine = new AlgebraEngine();
    const exporter = new ExportEngine();

    const result = engine.solve(args.equation, args.variable || 'x');

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId,
        ...result
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'algebra_solve', sessionId);

    return {
        success: true,
        actionType: 'solve',
        equation: args.equation,
        variable: args.variable,
        solution: result.result,
        steps: result.steps,
        calculationId: calculation.id,
        formatted: exporter.export(calculation, args.exportFormat)
    };
}

async function handleSimplify(args: z.infer<typeof SimplifySchema>, sessionId?: string): Promise<object> {
    const { repo, db } = getRepo();
    const engine = new AlgebraEngine();
    const exporter = new ExportEngine();

    const result = engine.simplify(args.expression);

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId,
        ...result
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'algebra_simplify', sessionId);

    return {
        success: true,
        actionType: 'simplify',
        input: args.expression,
        simplified: result.result,
        steps: result.steps,
        calculationId: calculation.id,
        formatted: exporter.export(calculation, args.exportFormat)
    };
}

async function handleProjectile(args: z.infer<typeof ProjectileSchema>, sessionId?: string): Promise<object> {
    const { repo, db } = getRepo();
    const engine = new PhysicsEngine();
    const exporter = new ExportEngine();

    const result = engine.projectile(args.velocity, args.angle, args.gravity || 9.81, 10, args.height);

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId,
        ...result
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'physics_projectile', sessionId);

    return {
        success: true,
        actionType: 'projectile',
        velocity: args.velocity,
        angle: args.angle,
        height: args.height,
        gravity: args.gravity,
        trajectory: result.metadata?.trajectory,
        maxHeight: result.metadata?.maxHeight,
        range: result.metadata?.range,
        timeOfFlight: result.metadata?.timeOfFlight,
        calculationId: calculation.id,
        formatted: exporter.export(calculation, args.exportFormat)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<MathAction, ActionDefinition> = {
    roll: {
        schema: RollSchema,
        handler: async (args) => handleRoll(args as z.infer<typeof RollSchema>),
        aliases: ['dice', 'dice_roll', 'd20', 'throw'],
        description: 'Roll dice using standard notation'
    },
    probability: {
        schema: ProbabilitySchema,
        handler: async (args) => handleProbability(args as z.infer<typeof ProbabilitySchema>),
        aliases: ['prob', 'calculate_probability', 'odds', 'chance'],
        description: 'Calculate dice roll probabilities'
    },
    solve: {
        schema: SolveSchema,
        handler: async (args) => handleSolve(args as z.infer<typeof SolveSchema>),
        aliases: ['algebra_solve', 'equation', 'solve_equation'],
        description: 'Solve algebraic equations'
    },
    simplify: {
        schema: SimplifySchema,
        handler: async (args) => handleSimplify(args as z.infer<typeof SimplifySchema>),
        aliases: ['algebra_simplify', 'reduce', 'simplify_expression'],
        description: 'Simplify algebraic expressions'
    },
    projectile: {
        schema: ProjectileSchema,
        handler: async (args) => handleProjectile(args as z.infer<typeof ProjectileSchema>),
        aliases: ['physics', 'physics_projectile', 'trajectory', 'launch'],
        description: 'Calculate projectile motion trajectory'
    }
};

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION & HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export const MathManageTool = {
    name: 'math_manage',
    description: `Mathematical operations for RPG mechanics.

⚠️ REDIRECT - DO NOT USE FOR:
- Attack rolls → Use combat_action { action: "attack" }
- Spell damage → Use combat_action { action: "cast_spell" }
- Skill checks → Use roll_skill_check (auto-applies proficiency)
- Ability checks → Use roll_ability_check (auto-applies modifier)
- Saving throws → Use roll_saving_throw (auto-applies save proficiency)

These specialized tools look up character stats and apply bonuses automatically!

🎲 DICE ROLLING (roll) - Use ONLY for:
- Stat generation (4d6dl1)
- Random tables/loot
- NPC behavior/morale rolls
- Weather/random encounters
- Anything without character stat bonuses

Standard notation plus special modifiers:
- 2d6+3: Basic roll with modifier
- 4d6dl1: Drop lowest 1 (stat generation)
- 2d20kh1: Keep highest 1 (advantage)
- 2d6!: Exploding dice (reroll on max)
- 8d6r1: Reroll 1s once

📊 PROBABILITY (probability):
Calculate odds before important rolls:
- target: Number to hit
- comparison: gte|lte|eq|gt|lt

🧮 ALGEBRA (solve, simplify):
- solve: Find variable value (damage = base + modifier)
- simplify: Reduce expressions

🏹 PROJECTILE PHYSICS:
Calculate ranged attack trajectories:
- velocity: Initial speed (ft/s)
- angle: Launch angle (degrees)
- height: Initial height (ft)
- gravity: Default 32.2 ft/s²

Actions: roll, probability, solve, simplify, projectile`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        // Roll params
        expression: z.string().optional(),
        seed: z.string().optional(),
        // Probability params
        target: z.number().optional(),
        comparison: z.enum(['gte', 'lte', 'eq', 'gt', 'lt']).optional(),
        // Solve params
        equation: z.string().optional(),
        variable: z.string().optional(),
        // Projectile params
        velocity: z.number().optional(),
        angle: z.number().optional(),
        height: z.number().optional(),
        gravity: z.number().optional(),
        // Common
        exportFormat: z.enum(['json', 'plaintext', 'markdown', 'latex']).optional()
    })
};

export async function handleMathManage(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    // Pass sessionId to handlers
    const argsWithSession = { ...(args as Record<string, unknown>), sessionId: ctx.sessionId };

    const result = await router(argsWithSession);
    const parsed = JSON.parse(result.content[0].text);

    let output = '';

    if (parsed.error) {
        output = RichFormatter.header('Error', '');
        output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        if (parsed.suggestions) {
            output += '\n**Did you mean:**\n';
            parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                output += `  - ${s.action} (${s.similarity}% match)\n`;
            });
        }
    } else {
        switch (parsed.actionType) {
            case 'roll':
                output = RichFormatter.header('Dice Roll', '');
                output += RichFormatter.keyValue({
                    'Expression': parsed.expression,
                    'Result': parsed.total,
                    'Rolls': Array.isArray(parsed.rolls) ? parsed.rolls.join(', ') : parsed.rolls
                });
                if (parsed.seed) output += `\nSeed: ${parsed.seed}\n`;
                break;

            case 'probability':
                output = RichFormatter.header('Probability', '');
                output += RichFormatter.keyValue({
                    'Expression': parsed.expression,
                    'Target': `${parsed.comparison} ${parsed.target}`,
                    'Probability': parsed.probabilityPercent,
                    'Expected Value': parsed.expectedValue?.toFixed(2)
                });
                break;

            case 'solve':
                output = RichFormatter.header('Equation Solved', '');
                output += RichFormatter.keyValue({
                    'Equation': parsed.equation,
                    'Variable': parsed.variable,
                    'Solution': parsed.solution
                });
                if (parsed.steps?.length) {
                    output += '\nSteps:\n';
                    parsed.steps.forEach((s: string) => output += `  ${s}\n`);
                }
                break;

            case 'simplify':
                output = RichFormatter.header('Simplified', '');
                output += RichFormatter.keyValue({
                    'Input': parsed.input,
                    'Simplified': parsed.simplified
                });
                break;

            case 'projectile':
                output = RichFormatter.header('Projectile Motion', '');
                output += RichFormatter.keyValue({
                    'Velocity': `${parsed.velocity} m/s`,
                    'Angle': `${parsed.angle}°`,
                    'Max Height': parsed.maxHeight?.toFixed(2) + ' m',
                    'Range': parsed.range?.toFixed(2) + ' m',
                    'Time of Flight': parsed.timeOfFlight?.toFixed(2) + ' s'
                });
                break;

            default:
                output = RichFormatter.header('Math', '');
                if (parsed.formatted) output += parsed.formatted + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'MATH_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
