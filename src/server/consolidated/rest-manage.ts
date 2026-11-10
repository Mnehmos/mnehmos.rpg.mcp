/**
 * Consolidated Rest Management Tool
 *
 * Replaces 2 individual rest tools with a single action-based tool:
 * - take_long_rest -> action: 'long'
 * - take_short_rest -> action: 'short'
 */

import { z } from 'zod';
import { SessionContext } from '../types.js';
import { getDb } from '../../storage/index.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { getCombatManager } from '../state/combat-manager.js';
import { restoreAllSpellSlots, restorePactSlots, getSpellcastingConfig } from '../../engine/magic/spell-validator.js';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { recoverHitDice, spendHitDice } from '../../engine/rest/hit-dice.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['long', 'short'] as const;
type RestAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const db = getDb();
    return {
        characterRepo: new CharacterRepository(db)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function getAbilityModifier(score: number): number {
    return Math.floor((score - 10) / 2);
}


// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const LongRestSchema = z.object({
    action: z.literal('long'),
    characterId: z.string().describe('Character taking the rest')
});

const ShortRestSchema = z.object({
    action: z.literal('short'),
    characterId: z.string().describe('Character taking the rest'),
    hitDiceToSpend: z.number().int().min(0).max(20).default(1)
        .describe('Hit dice to spend for healing (default: 1)')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleLongRest(args: z.infer<typeof LongRestSchema>): Promise<object> {
    const { characterRepo } = ensureDb();

    // Combat validation
    const combatManager = getCombatManager();
    if (combatManager.isCharacterInCombat(args.characterId)) {
        const encounters = combatManager.getEncountersForCharacter(args.characterId);
        throw new Error(`Cannot rest while in combat! Active encounter: ${encounters.join(', ')}`);
    }

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        throw new Error(`Character ${args.characterId} not found`);
    }

    const hpRestored = character.maxHp - character.hp;
    const newHp = character.maxHp;

    // Restore spell slots on long rest
    const charClass = character.characterClass || 'fighter';
    const spellConfig = getSpellcastingConfig(charClass);

    let spellSlotsRestored: { type: string; slotsRestored?: number; slotLevel?: number; level1?: number; level2?: number; level3?: number; level4?: number; level5?: number } | undefined = undefined;
    let updatedChar = { ...character, hp: newHp };

    if (spellConfig.canCast && character.level >= spellConfig.startLevel) {
        const restoredChar = restoreAllSpellSlots(character);

        if (spellConfig.pactMagic) {
            spellSlotsRestored = {
                type: 'pactMagic',
                slotsRestored: restoredChar.pactMagicSlots?.max || 0,
                slotLevel: restoredChar.pactMagicSlots?.slotLevel || 0
            };
            updatedChar = { ...updatedChar, pactMagicSlots: restoredChar.pactMagicSlots };
        } else if (restoredChar.spellSlots) {
            spellSlotsRestored = {
                type: 'standard',
                level1: restoredChar.spellSlots.level1.max,
                level2: restoredChar.spellSlots.level2.max,
                level3: restoredChar.spellSlots.level3.max,
                level4: restoredChar.spellSlots.level4.max,
                level5: restoredChar.spellSlots.level5.max
            };
            updatedChar = { ...updatedChar, spellSlots: restoredChar.spellSlots };
        }

        updatedChar = { ...updatedChar, concentratingOn: null, activeSpells: [] };
    }

    // A long rest returns half the character's hit dice.
    const hitDice = recoverHitDice(character);
    updatedChar = { ...updatedChar, resourcePools: hitDice.resourcePools };

    characterRepo.update(args.characterId, updatedChar);

    return {
        message: `${character.name} completes a long rest.`,
        character: character.name,
        previousHp: character.hp,
        newHp,
        maxHp: character.maxHp,
        hpRestored,
        restType: 'long',
        hitDiceRestored: hitDice.restored,
        hitDiceRemaining: hitDice.remaining,
        spellSlotsRestored
    };
}

async function handleShortRest(args: z.infer<typeof ShortRestSchema>): Promise<object> {
    const { characterRepo } = ensureDb();

    // Combat validation
    const combatManager = getCombatManager();
    if (combatManager.isCharacterInCombat(args.characterId)) {
        const encounters = combatManager.getEncountersForCharacter(args.characterId);
        throw new Error(`Cannot rest while in combat! Active encounter: ${encounters.join(', ')}`);
    }

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        throw new Error(`Character ${args.characterId} not found`);
    }

    const conModifier = getAbilityModifier(character.stats.con);

    // Spend hit dice from the character's pool: at most what is left of it,
    // however many were asked for.
    const hitDice = spendHitDice(character, args.hitDiceToSpend ?? 1);
    const hitDiceToSpend = hitDice.spent;
    const hitDieSize = hitDice.dieSize;
    const rolls = hitDice.rolls;

    const actualHealing = Math.min(hitDice.healing, character.maxHp - character.hp);
    const newHp = character.hp + actualHealing;

    // Restore warlock pact slots on short rest
    const charClass = character.characterClass || 'fighter';
    const spellConfig = getSpellcastingConfig(charClass);

    let pactSlotsRestored: { slotsRestored: number; slotLevel: number } | undefined = undefined;
    let updatedChar: Record<string, unknown> = { hp: newHp, resourcePools: hitDice.resourcePools };

    if (spellConfig.pactMagic && spellConfig.canCast && character.level >= spellConfig.startLevel) {
        const restoredChar = restorePactSlots(character);
        pactSlotsRestored = {
            slotsRestored: restoredChar.pactMagicSlots?.max || 0,
            slotLevel: restoredChar.pactMagicSlots?.slotLevel || 0
        };
        updatedChar = { ...updatedChar, pactMagicSlots: restoredChar.pactMagicSlots };
    }

    characterRepo.update(args.characterId, updatedChar);

    return {
        message: `${character.name} completes a short rest.`,
        character: character.name,
        previousHp: character.hp,
        newHp,
        maxHp: character.maxHp,
        hpRestored: actualHealing,
        hitDiceSpent: hitDiceToSpend,
        hitDiceRemaining: hitDice.remaining,
        hitDieSize: `d${hitDieSize}`,
        conModifier,
        rolls,
        restType: 'short',
        pactSlotsRestored
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<RestAction, ActionDefinition> = {
    long: {
        schema: LongRestSchema,
        handler: handleLongRest,
        aliases: ['long_rest', 'full'],
        description: 'Take a long rest (8 hours). Restores HP and spell slots.'
    },
    short: {
        schema: ShortRestSchema,
        handler: handleShortRest,
        aliases: ['short_rest', 'quick'],
        description: 'Take a short rest (1 hour). Spend hit dice to recover HP.'
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

export const RestManageTool = {
    name: 'rest_manage',
    description: `Manage character rest mechanics (D&D 5e style).

⏰ REST TYPES:
- long (8 hours): Full HP restoration, all spell slots restored
- short (1 hour): Spend hit dice to heal (roll d8 + CON per die)

⚔️ COMBAT RESTRICTION:
Cannot rest while in active combat encounter!

✨ SPELLCASTING:
- Full casters: All spell slots restored on long rest
- Warlocks: Pact slots restore on SHORT rest
- Concentration spells cleared on long rest

Actions: long, short
Aliases: long_rest/full→long, short_rest/quick→short`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe('Action: long, short'),
        characterId: z.string().describe('Character ID'),
        hitDiceToSpend: z.number().int().min(0).max(20).optional()
            .describe('For short rest: hit dice to spend (default: 1)')
    })
};

export async function handleRestManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    return router(args as Record<string, unknown>);
}
