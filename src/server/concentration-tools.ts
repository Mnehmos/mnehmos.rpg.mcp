import { z } from 'zod';
import { SessionContext } from './types.js';
import { getDb } from '../storage/index.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../storage/repos/concentration.repo.js';
import {
    checkConcentration,
    breakConcentration,
    getConcentration,
    checkConcentrationDuration,
    checkAutomaticConcentrationBreak,
} from '../engine/magic/concentration.js';
import { BreakConcentrationRequestSchema } from '../schema/concentration.js';

/**
 * Concentration Management Tools
 * Handles concentration checks, breaking concentration, and querying concentration state
 */

export const ConcentrationTools = {
    CHECK_CONCENTRATION_SAVE: {
        name: 'check_concentration_save',
        description: 'Roll a Constitution saving throw to maintain concentration after taking damage. DC = 10 or half damage (whichever is higher). Automatically breaks concentration if save fails.',
        inputSchema: z.object({
            characterId: z.string().describe('The ID of the character maintaining concentration'),
            damageAmount: z.number().int().min(0).describe('Amount of damage taken that triggered the concentration check'),
        }),
    },
    BREAK_CONCENTRATION: {
        name: 'break_concentration',
        description: 'Manually break a character\'s concentration on a spell. Use this for voluntary breaks, incapacitation, death, or when casting a new concentration spell.',
        inputSchema: z.object({
            characterId: z.string().describe('The ID of the character whose concentration is breaking'),
            reason: z.enum(['damage', 'incapacitated', 'death', 'new_spell', 'voluntary', 'duration'])
                .describe('Reason for breaking concentration'),
            damageAmount: z.number().int().min(0).optional()
                .describe('Amount of damage (only if reason is damage)'),
        }),
    },
    GET_CONCENTRATION_STATE: {
        name: 'get_concentration_state',
        description: 'Query what spell a character is currently concentrating on, including duration and targets.',
        inputSchema: z.object({
            characterId: z.string().describe('The ID of the character to check'),
        }),
    },
    CHECK_CONCENTRATION_DURATION: {
        name: 'check_concentration_duration',
        description: 'Check if a character\'s concentration has exceeded its maximum duration. Automatically breaks concentration if duration expired.',
        inputSchema: z.object({
            characterId: z.string().describe('The ID of the character maintaining concentration'),
            currentRound: z.number().int().min(1).describe('The current combat round number'),
        }),
    },
    CHECK_AUTO_BREAK: {
        name: 'check_automatic_concentration_break',
        description: 'Check if concentration should automatically break due to death or incapacitating conditions (unconscious, stunned, paralyzed, petrified).',
        inputSchema: z.object({
            characterId: z.string().describe('The ID of the character to check'),
        }),
    },
} as const;

function ensureDb() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return {
        characterRepo: new CharacterRepository(db),
        concentrationRepo: new ConcentrationRepository(db),
    };
}

/**
 * Handle concentration save check after damage
 */
export async function handleCheckConcentrationSave(args: unknown, _ctx: SessionContext) {
    const { characterRepo, concentrationRepo } = ensureDb();
    const parsed = ConcentrationTools.CHECK_CONCENTRATION_SAVE.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const result = checkConcentration(character, parsed.damageAmount, concentrationRepo);

    // If concentration broken, actually break it
    if (result.broken) {
        breakConcentration(
            { characterId: parsed.characterId, reason: 'damage', damageAmount: parsed.damageAmount },
            concentrationRepo,
            characterRepo
        );
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: formatConcentrationCheckResult(result),
            },
        ],
    };
}

/**
 * Handle manual concentration break
 */
export async function handleBreakConcentration(args: unknown, _ctx: SessionContext) {
    const { characterRepo, concentrationRepo } = ensureDb();
    const parsed = BreakConcentrationRequestSchema.parse(args);

    const result = breakConcentration(parsed, concentrationRepo, characterRepo);

    return {
        content: [
            {
                type: 'text' as const,
                text: formatBreakConcentrationResult(result),
            },
        ],
    };
}

/**
 * Handle get concentration state query
 */
export async function handleGetConcentrationState(args: unknown, _ctx: SessionContext) {
    const { concentrationRepo } = ensureDb();
    const parsed = ConcentrationTools.GET_CONCENTRATION_STATE.inputSchema.parse(args);

    const concentration = getConcentration(parsed.characterId, concentrationRepo);

    if (!concentration) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Character ${parsed.characterId} is not currently concentrating on any spell.`,
                },
            ],
        };
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: formatConcentrationState(concentration),
            },
        ],
    };
}

/**
 * Handle concentration duration check
 */
export async function handleCheckConcentrationDuration(args: unknown, _ctx: SessionContext) {
    const { characterRepo, concentrationRepo } = ensureDb();
    const parsed = ConcentrationTools.CHECK_CONCENTRATION_DURATION.inputSchema.parse(args);

    const result = checkConcentrationDuration(
        parsed.characterId,
        parsed.currentRound,
        concentrationRepo,
        characterRepo
    );

    if (!result) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: 'Concentration is still within duration limit.',
                },
            ],
        };
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: `Concentration on ${result.spell} has exceeded its duration and has ended.`,
            },
        ],
    };
}

/**
 * Handle automatic concentration break check
 */
export async function handleCheckAutoBreak(args: unknown, _ctx: SessionContext) {
    const { characterRepo, concentrationRepo } = ensureDb();
    const parsed = ConcentrationTools.CHECK_AUTO_BREAK.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const result = checkAutomaticConcentrationBreak(character, concentrationRepo, characterRepo);

    if (!result) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: 'No automatic concentration break required.',
                },
            ],
        };
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: `Concentration on ${result.spell} automatically broken due to ${result.reason}.`,
            },
        ],
    };
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

function formatConcentrationCheckResult(result: any): string {
    if (result.spell === 'none') {
        return 'Character is not concentrating on any spell.';
    }

    if (!result.broken) {
        return `✅ Concentration maintained on ${result.spell}!

🎲 Save Roll: ${result.saveRoll} + ${result.constitutionModifier} (CON) = ${result.saveTotal}
🎯 DC: ${result.saveDC} (half of ${result.damageAmount} damage)

Concentration continues.`;
    }

    return `❌ Concentration broken on ${result.spell}!

🎲 Save Roll: ${result.saveRoll} + ${result.constitutionModifier} (CON) = ${result.saveTotal}
🎯 DC: ${result.saveDC} (half of ${result.damageAmount} damage)

The spell ends immediately.`;
}

function formatBreakConcentrationResult(result: any): string {
    if (result.spell === 'none') {
        return 'Character was not concentrating on any spell.';
    }

    const reasonMap: Record<string, string> = {
        damage: 'failed concentration save from damage',
        incapacitated: 'becoming incapacitated',
        death: 'character death',
        new_spell: 'casting a new concentration spell',
        voluntary: 'voluntary choice',
        duration: 'spell duration expiring',
    };

    const reasonText = reasonMap[result.reason] || result.reason;

    return `💔 Concentration on ${result.spell} has ended (${reasonText}).`;
}

function formatConcentrationState(concentration: any): string {
    const durationText = concentration.maxDuration
        ? `${concentration.maxDuration} rounds (started round ${concentration.startedAt})`
        : 'unlimited';

    const targetsText = concentration.targetIds && concentration.targetIds.length > 0
        ? concentration.targetIds.join(', ')
        : 'none';

    return `🔮 Active Concentration

Spell: ${concentration.activeSpell} (Level ${concentration.spellLevel})
Duration: ${durationText}
Targets: ${targetsText}

⚠️ Taking damage requires a Constitution save:
DC = 10 or half damage (whichever is higher)`;
}
