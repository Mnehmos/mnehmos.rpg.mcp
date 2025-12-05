import { z } from 'zod';
import { SessionContext } from './types.js';
import { getDb } from '../storage/index.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';

// CRIT-002: Import spell slot recovery functions
import { restoreAllSpellSlots, restorePactSlots, getSpellcastingConfig } from '../engine/magic/spell-validator.js';

/**
 * CRIT-002 Fix: Rest Mechanics
 *
 * Implements long rest and short rest for HP and spell slot restoration.
 */

export const RestTools = {
    TAKE_LONG_REST: {
        name: 'take_long_rest',
        description: 'Take a long rest (8 hours). Restores HP to maximum. Future: will restore spell slots.',
        inputSchema: z.object({
            characterId: z.string().describe('The ID of the character taking the rest')
        })
    },
    TAKE_SHORT_REST: {
        name: 'take_short_rest',
        description: 'Take a short rest (1 hour). Spend hit dice to recover HP.',
        inputSchema: z.object({
            characterId: z.string().describe('The ID of the character taking the rest'),
            hitDiceToSpend: z.number().int().min(0).max(20).default(1)
                .describe('Number of hit dice to spend for healing (default: 1)')
        })
    }
} as const;

function ensureDb() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return {
        characterRepo: new CharacterRepository(db)
    };
}

/**
 * Calculate ability modifier from ability score
 */
function getAbilityModifier(score: number): number {
    return Math.floor((score - 10) / 2);
}

/**
 * Roll a die (simulated with random)
 */
function rollDie(sides: number): number {
    return Math.floor(Math.random() * sides) + 1;
}

/**
 * Get hit die size based on class (default d8 since we don't have class field)
 * Future: look up character class and return appropriate die
 */
function getHitDieSize(_characterId: string): number {
    // Default to d8 (fighter/cleric size) since no class field exists yet
    // Barbarian: d12, Fighter/Paladin/Ranger: d10, Most others: d8, Wizard/Sorcerer: d6
    return 8;
}

export async function handleTakeLongRest(args: unknown, _ctx: SessionContext) {
    const { characterRepo } = ensureDb();
    const parsed = RestTools.TAKE_LONG_REST.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const hpRestored = character.maxHp - character.hp;
    const newHp = character.maxHp;

    // CRIT-002: Restore spell slots on long rest
    const charClass = character.characterClass || 'fighter';
    const spellConfig = getSpellcastingConfig(charClass as any);

    let spellSlotsRestored: any = undefined;
    let updatedChar = { ...character, hp: newHp };

    if (spellConfig.canCast && character.level >= spellConfig.startLevel) {
        // Restore spell slots
        const restoredChar = restoreAllSpellSlots(character);

        // Track what was restored
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
                level5: restoredChar.spellSlots.level5.max,
                level6: restoredChar.spellSlots.level6.max,
                level7: restoredChar.spellSlots.level7.max,
                level8: restoredChar.spellSlots.level8.max,
                level9: restoredChar.spellSlots.level9.max
            };
            updatedChar = { ...updatedChar, spellSlots: restoredChar.spellSlots };
        }

        // Clear concentration
        updatedChar = { ...updatedChar, concentratingOn: null, activeSpells: [] };
    }

    // Update character HP and spell slots
    characterRepo.update(parsed.characterId, updatedChar);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `${character.name} completes a long rest.`,
                character: character.name,
                previousHp: character.hp,
                newHp: newHp,
                maxHp: character.maxHp,
                hpRestored: hpRestored,
                restType: 'long',
                spellSlotsRestored: spellSlotsRestored
            }, null, 2)
        }]
    };
}

export async function handleTakeShortRest(args: unknown, _ctx: SessionContext) {
    const { characterRepo } = ensureDb();
    const parsed = RestTools.TAKE_SHORT_REST.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const hitDiceToSpend = parsed.hitDiceToSpend ?? 1;
    const hitDieSize = getHitDieSize(parsed.characterId);
    const conModifier = getAbilityModifier(character.stats.con);

    // Roll hit dice for healing
    let totalHealing = 0;
    const rolls: number[] = [];

    for (let i = 0; i < hitDiceToSpend; i++) {
        const roll = rollDie(hitDieSize);
        rolls.push(roll);
        // Each hit die heals: roll + CON modifier (minimum 1 per die)
        totalHealing += Math.max(1, roll + conModifier);
    }

    // Cap healing at maxHp
    const actualHealing = Math.min(totalHealing, character.maxHp - character.hp);
    const newHp = character.hp + actualHealing;

    // CRIT-002: Restore warlock pact magic slots on short rest
    const charClass = character.characterClass || 'fighter';
    const spellConfig = getSpellcastingConfig(charClass as any);

    let pactSlotsRestored: any = undefined;
    let updatedChar: any = { hp: newHp };

    if (spellConfig.pactMagic && spellConfig.canCast && character.level >= spellConfig.startLevel) {
        // Warlock gets pact slots back on short rest
        const restoredChar = restorePactSlots(character);
        pactSlotsRestored = {
            slotsRestored: restoredChar.pactMagicSlots?.max || 0,
            slotLevel: restoredChar.pactMagicSlots?.slotLevel || 0
        };
        updatedChar = { ...updatedChar, pactMagicSlots: restoredChar.pactMagicSlots };
    }

    // Update character HP (and warlock pact slots if applicable)
    characterRepo.update(parsed.characterId, updatedChar);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `${character.name} completes a short rest.`,
                character: character.name,
                previousHp: character.hp,
                newHp: newHp,
                maxHp: character.maxHp,
                hpRestored: actualHealing,
                hitDiceSpent: hitDiceToSpend,
                hitDieSize: `d${hitDieSize}`,
                conModifier: conModifier,
                rolls: rolls,
                restType: 'short',
                pactSlotsRestored: pactSlotsRestored // Warlock only
            }, null, 2)
        }]
    };
}
