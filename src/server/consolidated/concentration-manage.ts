/**
 * Consolidated Concentration Management Tool
 *
 * Replaces 5 individual concentration tools with a single action-based tool:
 * - check_concentration_save -> action: 'check_save'
 * - break_concentration -> action: 'break'
 * - get_concentration_state -> action: 'get'
 * - check_concentration_duration -> action: 'check_duration'
 * - check_automatic_concentration_break -> action: 'check_auto'
 */

import { z } from 'zod';
import { SessionContext } from '../types.js';
import { getDb } from '../../storage/index.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../../storage/repos/concentration.repo.js';
import {
    checkConcentration,
    breakConcentration,
    getConcentration,
    checkConcentrationDuration,
    checkAutomaticConcentrationBreak,
} from '../../engine/magic/concentration.js';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['check_save', 'break', 'get', 'check_duration', 'check_auto'] as const;
type ConcentrationAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return {
        characterRepo: new CharacterRepository(db),
        concentrationRepo: new ConcentrationRepository(db),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const CheckSaveSchema = z.object({
    action: z.literal('check_save'),
    characterId: z.string().describe('Character maintaining concentration'),
    damageAmount: z.number().int().min(0).describe('Damage triggering the check')
});

const BreakSchema = z.object({
    action: z.literal('break'),
    characterId: z.string().describe('Character whose concentration breaks'),
    reason: z.enum(['damage', 'incapacitated', 'death', 'new_spell', 'voluntary', 'duration'])
        .describe('Reason for breaking'),
    damageAmount: z.number().int().min(0).optional()
});

const GetSchema = z.object({
    action: z.literal('get'),
    characterId: z.string().describe('Character to query')
});

const CheckDurationSchema = z.object({
    action: z.literal('check_duration'),
    characterId: z.string().describe('Character maintaining concentration'),
    currentRound: z.number().int().min(1).describe('Current combat round')
});

const CheckAutoSchema = z.object({
    action: z.literal('check_auto'),
    characterId: z.string().describe('Character to check')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleCheckSave(args: z.infer<typeof CheckSaveSchema>): Promise<object> {
    const { characterRepo, concentrationRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        throw new Error(`Character ${args.characterId} not found`);
    }

    const result = checkConcentration(character, args.damageAmount, concentrationRepo);

    if (result.broken) {
        breakConcentration(
            { characterId: args.characterId, reason: 'damage', damageAmount: args.damageAmount },
            concentrationRepo,
            characterRepo
        );
    }

    return {
        spell: result.spell,
        maintained: !result.broken,
        broken: result.broken,
        saveRoll: result.saveRoll,
        constitutionModifier: result.constitutionModifier,
        saveTotal: result.saveTotal,
        saveDC: result.saveDC,
        damageAmount: args.damageAmount,
        message: result.spell === 'none'
            ? 'Character is not concentrating on any spell.'
            : result.broken
                ? `Concentration broken on ${result.spell}!`
                : `Concentration maintained on ${result.spell}!`
    };
}

async function handleBreak(args: z.infer<typeof BreakSchema>): Promise<object> {
    const { characterRepo, concentrationRepo } = ensureDb();

    const result = breakConcentration(
        { characterId: args.characterId, reason: args.reason, damageAmount: args.damageAmount },
        concentrationRepo,
        characterRepo
    );

    const reasonMap: Record<string, string> = {
        damage: 'failed concentration save from damage',
        incapacitated: 'becoming incapacitated',
        death: 'character death',
        new_spell: 'casting a new concentration spell',
        voluntary: 'voluntary choice',
        duration: 'spell duration expiring',
    };

    return {
        spell: result.spell,
        reason: args.reason,
        message: result.spell === 'none'
            ? 'Character was not concentrating on any spell.'
            : `Concentration on ${result.spell} ended (${reasonMap[args.reason] || args.reason}).`
    };
}

async function handleGet(args: z.infer<typeof GetSchema>): Promise<object> {
    const { concentrationRepo } = ensureDb();

    const concentration = getConcentration(args.characterId, concentrationRepo);

    if (!concentration) {
        return {
            concentrating: false,
            message: `Character ${args.characterId} is not concentrating on any spell.`
        };
    }

    return {
        concentrating: true,
        spell: concentration.activeSpell,
        spellLevel: concentration.spellLevel,
        startedAt: concentration.startedAt,
        maxDuration: concentration.maxDuration,
        targets: concentration.targetIds || [],
        message: `Concentrating on ${concentration.activeSpell} (Level ${concentration.spellLevel})`
    };
}

async function handleCheckDuration(args: z.infer<typeof CheckDurationSchema>): Promise<object> {
    const { characterRepo, concentrationRepo } = ensureDb();

    const result = checkConcentrationDuration(
        args.characterId,
        args.currentRound,
        concentrationRepo,
        characterRepo
    );

    if (!result) {
        return {
            expired: false,
            message: 'Concentration is still within duration limit.'
        };
    }

    return {
        expired: true,
        spell: result.spell,
        message: `Concentration on ${result.spell} has exceeded its duration and has ended.`
    };
}

async function handleCheckAuto(args: z.infer<typeof CheckAutoSchema>): Promise<object> {
    const { characterRepo, concentrationRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        throw new Error(`Character ${args.characterId} not found`);
    }

    const result = checkAutomaticConcentrationBreak(character, concentrationRepo, characterRepo);

    if (!result) {
        return {
            broken: false,
            message: 'No automatic concentration break required.'
        };
    }

    return {
        broken: true,
        spell: result.spell,
        reason: result.reason,
        message: `Concentration on ${result.spell} automatically broken due to ${result.reason}.`
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<ConcentrationAction, ActionDefinition> = {
    check_save: {
        schema: CheckSaveSchema,
        handler: handleCheckSave,
        aliases: ['save', 'damage'],
        description: 'Roll Constitution save after taking damage'
    },
    break: {
        schema: BreakSchema,
        handler: handleBreak,
        aliases: ['end', 'stop'],
        description: 'Manually break concentration'
    },
    get: {
        schema: GetSchema,
        handler: handleGet,
        aliases: ['state', 'status', 'query'],
        description: 'Query current concentration state'
    },
    check_duration: {
        schema: CheckDurationSchema,
        handler: handleCheckDuration,
        aliases: ['duration'],
        description: 'Check if concentration exceeded duration'
    },
    check_auto: {
        schema: CheckAutoSchema,
        handler: handleCheckAuto,
        aliases: ['auto', 'conditions'],
        description: 'Check for automatic break (death/incapacitated)'
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

export const ConcentrationManageTool = {
    name: 'concentration_manage',
    description: `Manage spell concentration (D&D 5e rules).

🎯 WHEN TO USE:
- After damage: check_save (CON save DC = max(10, damage/2))
- After incapacitation/death: check_auto (auto-break)
- Before new concentration spell: break (new_spell reason)
- Each round: check_duration (for time-limited spells)

⚔️ COMBAT INTEGRATION:
When a concentrating character takes damage, ALWAYS call check_save!
The engine handles the CON save automatically.

🔮 SPELL EXAMPLES (require concentration):
Hold Person, Bless, Haste, Hex, Hunter's Mark, Spirit Guardians

Actions: check_save, break, get, check_duration, check_auto
Aliases: save/damage→check_save, end/stop→break, state→get`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe('Action: check_save, break, get, check_duration, check_auto'),
        characterId: z.string().describe('Character ID'),
        damageAmount: z.number().int().min(0).optional(),
        reason: z.enum(['damage', 'incapacitated', 'death', 'new_spell', 'voluntary', 'duration']).optional(),
        currentRound: z.number().int().min(1).optional()
    })
};

export async function handleConcentrationManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    return router(args as Record<string, unknown>);
}
