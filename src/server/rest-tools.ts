import { z } from 'zod';
import { SessionContext } from './types.js';
import { getDb } from '../storage/index.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';

/**
 * CRIT-002 Fix: Rest Mechanics
 *
 * Implements long rest and short rest for HP restoration.
 * Foundation for spell slot recovery once spellcasting system is added.
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

    // Update character HP
    characterRepo.update(parsed.characterId, { hp: newHp });

    // Future: restore spell slots here when spellcasting system exists
    // const spellSlotsRestored = restoreAllSpellSlots(character);

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
                // Future fields:
                // spellSlotsRestored: spellSlotsRestored,
                // abilitiesReset: []
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

    // Update character HP
    characterRepo.update(parsed.characterId, { hp: newHp });

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
                restType: 'short'
            }, null, 2)
        }]
    };
}
