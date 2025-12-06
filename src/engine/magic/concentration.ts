/**
 * Concentration System - Manages concentration spell mechanics
 * Handles concentration checks, breaking concentration, and duration tracking
 */

import { ConcentrationState, ConcentrationCheckResult, BreakConcentrationRequest } from '../../schema/concentration.js';
import { Character, NPC } from '../../schema/character.js';
import { ConcentrationRepository } from '../../storage/repos/concentration.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';

/**
 * Calculate the DC for a concentration save after taking damage
 * DC = 10 or half the damage taken, whichever is higher
 */
export function calculateConcentrationDC(damageAmount: number): number {
    const halfDamage = Math.floor(damageAmount / 2);
    return Math.max(10, halfDamage);
}

/**
 * Roll a constitution saving throw for concentration
 */
export function rollConcentrationSave(constitutionModifier: number): { roll: number; total: number } {
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + constitutionModifier;
    return { roll, total };
}

/**
 * Check if concentration is maintained after taking damage
 */
export function checkConcentration(
    character: Character | NPC,
    damageAmount: number,
    concentrationRepo: ConcentrationRepository
): ConcentrationCheckResult {
    const concentration = concentrationRepo.findByCharacterId(character.id);

    if (!concentration) {
        return {
            characterId: character.id,
            spell: 'none',
            broken: false,
            reason: 'damage',
        };
    }

    const dc = calculateConcentrationDC(damageAmount);
    const constitutionModifier = Math.floor((character.stats.con - 10) / 2);
    const { roll, total } = rollConcentrationSave(constitutionModifier);

    const success = total >= dc;

    return {
        characterId: character.id,
        spell: concentration.activeSpell,
        broken: !success,
        reason: success ? 'damage' : 'failed_save',
        saveRoll: roll,
        saveDC: dc,
        saveTotal: total,
        damageAmount,
        constitutionModifier,
    };
}

/**
 * Break concentration for a character
 * This handles:
 * - Automatic breaks (incapacitated, death, new spell)
 * - Voluntary breaks
 * - Failed concentration saves
 */
export function breakConcentration(
    request: BreakConcentrationRequest,
    concentrationRepo: ConcentrationRepository,
    characterRepo: CharacterRepository
): ConcentrationCheckResult {
    const concentration = concentrationRepo.findByCharacterId(request.characterId);

    if (!concentration) {
        return {
            characterId: request.characterId,
            spell: 'none',
            broken: false,
            reason: request.reason,
        };
    }

    const spell = concentration.activeSpell;

    // Delete concentration record
    concentrationRepo.delete(request.characterId);

    // Update character's concentrating_on field to null
    const character = characterRepo.findById(request.characterId);
    if (character) {
        characterRepo.update(request.characterId, {
            concentratingOn: null,
        });
    }

    return {
        characterId: request.characterId,
        spell,
        broken: true,
        reason: request.reason,
        damageAmount: request.damageAmount,
    };
}

/**
 * Start concentration on a spell
 */
export function startConcentration(
    characterId: string,
    spellName: string,
    spellLevel: number,
    currentRound: number,
    maxDuration: number | undefined,
    targetIds: string[] | undefined,
    concentrationRepo: ConcentrationRepository,
    characterRepo: CharacterRepository
): void {
    // Break any existing concentration first
    if (concentrationRepo.isConcentrating(characterId)) {
        breakConcentration(
            { characterId, reason: 'new_spell' },
            concentrationRepo,
            characterRepo
        );
    }

    // Create new concentration state
    const concentration: ConcentrationState = {
        characterId,
        activeSpell: spellName,
        spellLevel,
        startedAt: currentRound,
        maxDuration,
        targetIds,
        saveDCBase: 10,
    };

    concentrationRepo.create(concentration);

    // Update character's concentrating_on field
    characterRepo.update(characterId, {
        concentratingOn: spellName,
    });
}

/**
 * Check if concentration has exceeded its duration
 */
export function checkConcentrationDuration(
    characterId: string,
    currentRound: number,
    concentrationRepo: ConcentrationRepository,
    characterRepo: CharacterRepository
): ConcentrationCheckResult | null {
    const concentration = concentrationRepo.findByCharacterId(characterId);

    if (!concentration) {
        return null;
    }

    // No duration limit - concentration continues
    if (!concentration.maxDuration) {
        return null;
    }

    const roundsElapsed = currentRound - concentration.startedAt;

    if (roundsElapsed >= concentration.maxDuration) {
        // Duration exceeded - break concentration
        return breakConcentration(
            { characterId, reason: 'duration' },
            concentrationRepo,
            characterRepo
        );
    }

    return null;
}

/**
 * Get active concentration for a character
 */
export function getConcentration(
    characterId: string,
    concentrationRepo: ConcentrationRepository
): ConcentrationState | null {
    return concentrationRepo.findByCharacterId(characterId);
}

/**
 * Check for automatic concentration breaks (incapacitated, death)
 * This should be called when a character's conditions change
 */
export function checkAutomaticConcentrationBreak(
    character: Character | NPC,
    concentrationRepo: ConcentrationRepository,
    characterRepo: CharacterRepository
): ConcentrationCheckResult | null {
    if (!concentrationRepo.isConcentrating(character.id)) {
        return null;
    }

    // Check for death
    if (character.hp <= 0) {
        return breakConcentration(
            { characterId: character.id, reason: 'death' },
            concentrationRepo,
            characterRepo
        );
    }

    // Check for incapacitated condition
    const incapacitatingConditions = [
        'unconscious',
        'stunned',
        'paralyzed',
        'petrified',
    ];

    const hasIncapacitatingCondition = character.conditions?.some(
        (condition: any) => {
            if (typeof condition === 'string') {
                return incapacitatingConditions.includes(condition.toLowerCase());
            }
            return incapacitatingConditions.includes(condition.type.toLowerCase());
        }
    );

    if (hasIncapacitatingCondition) {
        return breakConcentration(
            { characterId: character.id, reason: 'incapacitated' },
            concentrationRepo,
            characterRepo
        );
    }

    return null;
}
