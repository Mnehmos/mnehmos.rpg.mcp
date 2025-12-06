/**
 * Aura System - Manages area-effect auras centered on characters
 * Handles aura creation, position-based effect triggers, and movement integration
 */

import { randomUUID } from 'crypto';
import { AuraState, AuraEffect, AuraEffectResult, CreateAuraRequest, AuraTrigger } from '../../schema/aura.js';
import { Position, Token } from '../../schema/encounter.js';
import { AuraRepository } from '../../storage/repos/aura.repo.js';

/**
 * Calculate distance in feet between two positions
 * Assumes each grid square is 5 feet
 */
export function calculateDistance(pos1: Position, pos2: Position): number {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const squares = Math.sqrt(dx * dx + dy * dy);
    return Math.round(squares * 5); // Convert squares to feet
}

/**
 * Check if a position is within an aura's radius
 * @param auraCenter - Position of the aura's owner
 * @param targetPosition - Position to check
 * @param radius - Aura radius in feet
 */
export function isInAuraRange(
    auraCenter: Position,
    targetPosition: Position,
    radius: number
): boolean {
    const distance = calculateDistance(auraCenter, targetPosition);
    return distance <= radius;
}

/**
 * Create a new aura
 */
export function createAura(
    request: CreateAuraRequest,
    auraRepo: AuraRepository
): AuraState {
    const aura: AuraState = {
        id: randomUUID(),
        ownerId: request.ownerId,
        spellName: request.spellName,
        spellLevel: request.spellLevel,
        radius: request.radius,
        affectsAllies: request.affectsAllies,
        affectsEnemies: request.affectsEnemies,
        affectsSelf: request.affectsSelf,
        effects: request.effects,
        startedAt: request.currentRound,
        maxDuration: request.maxDuration,
        requiresConcentration: request.requiresConcentration,
    };

    auraRepo.create(aura);
    return aura;
}

/**
 * End an aura by ID
 */
export function endAura(auraId: string, auraRepo: AuraRepository): boolean {
    return auraRepo.delete(auraId);
}

/**
 * End all auras owned by a character
 */
export function endAurasByOwner(ownerId: string, auraRepo: AuraRepository): number {
    return auraRepo.deleteByOwnerId(ownerId);
}

/**
 * Get all active auras
 */
export function getActiveAuras(auraRepo: AuraRepository): AuraState[] {
    return auraRepo.findAll();
}

/**
 * Get auras affecting a specific position
 * @param tokens - All tokens in the encounter (to find aura owner positions)
 * @param targetPosition - Position to check
 * @param auraRepo - Aura repository
 */
export function getAurasAtPosition(
    tokens: Token[],
    targetPosition: Position,
    auraRepo: AuraRepository
): AuraState[] {
    const allAuras = auraRepo.findAll();
    const aurasAtPosition: AuraState[] = [];

    for (const aura of allAuras) {
        // Find the aura owner's position
        const owner = tokens.find(t => t.id === aura.ownerId);
        if (!owner || !owner.position) {
            continue;
        }

        // Check if target position is within aura radius
        if (isInAuraRange(owner.position, targetPosition, aura.radius)) {
            aurasAtPosition.push(aura);
        }
    }

    return aurasAtPosition;
}

/**
 * Check if a target should be affected by an aura
 * @param aura - The aura to check
 * @param target - The target token
 * @param ownerIsAlly - Whether the aura owner is an ally of the target
 */
export function shouldAffectTarget(
    aura: AuraState,
    target: Token,
    ownerIsAlly: boolean
): boolean {
    // Check if target is the aura owner
    if (target.id === aura.ownerId) {
        return aura.affectsSelf;
    }

    // Check ally/enemy filters
    if (ownerIsAlly && !aura.affectsAllies) {
        return false;
    }

    if (!ownerIsAlly && !aura.affectsEnemies) {
        return false;
    }

    return true;
}

/**
 * Roll a saving throw
 * @param abilityModifier - The ability modifier for the save
 * @returns Object with roll and total
 */
export function rollSave(abilityModifier: number): { roll: number; total: number } {
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + abilityModifier;
    return { roll, total };
}

/**
 * Roll damage or healing dice
 * @param dice - Dice notation (e.g., "3d8")
 * @returns Total result
 */
export function rollDice(dice: string): number {
    const match = dice.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
    if (!match) {
        throw new Error(`Invalid dice notation: ${dice}`);
    }

    const [, numDiceStr, diceSizeStr, bonusStr] = match;
    const numDice = parseInt(numDiceStr, 10);
    const diceSize = parseInt(diceSizeStr, 10);
    const bonus = bonusStr ? parseInt(bonusStr, 10) : 0;

    let total = bonus;
    for (let i = 0; i < numDice; i++) {
        total += Math.floor(Math.random() * diceSize) + 1;
    }

    return total;
}

/**
 * Apply a single aura effect to a target
 * @param aura - The aura
 * @param effect - The specific effect to apply
 * @param target - The target token
 * @returns Result of the effect application
 */
export function applyAuraEffect(
    aura: AuraState,
    effect: AuraEffect,
    target: Token,
    trigger: AuraTrigger
): AuraEffectResult {
    const result: AuraEffectResult = {
        auraId: aura.id,
        auraName: aura.spellName,
        targetId: target.id,
        trigger,
        effectType: effect.type,
        succeeded: false,
    };

    // Handle effects that require saving throws
    if (effect.saveType && effect.saveDC) {
        const abilityModifier = getAbilityModifier(target, effect.saveType);
        const saveResult = rollSave(abilityModifier);

        result.saveRoll = saveResult.roll;
        result.saveDC = effect.saveDC;
        result.saveTotal = saveResult.total;
        result.succeeded = saveResult.total >= effect.saveDC;

        // If save succeeded, effect doesn't apply (for most damaging effects)
        if (result.succeeded && (effect.type === 'damage' || effect.type === 'condition')) {
            return result;
        }
    } else {
        // No save required - effect automatically succeeds
        result.succeeded = true;
    }

    // Apply the effect based on type
    switch (effect.type) {
        case 'damage':
            if (effect.dice) {
                result.damageDealt = rollDice(effect.dice);
                result.damageType = effect.damageType;
            }
            break;

        case 'healing':
            if (effect.dice) {
                result.healingDone = rollDice(effect.dice);
            }
            break;

        case 'condition':
            if (effect.conditions) {
                result.conditionsApplied = effect.conditions;
            }
            break;

        case 'buff':
        case 'debuff':
        case 'custom':
            result.description = effect.description;
            break;
    }

    return result;
}

/**
 * Get ability modifier for a token
 */
function getAbilityModifier(token: Token, ability: string): number {
    if (!token.abilityScores) {
        return 0;
    }

    const abilityMap: Record<string, keyof typeof token.abilityScores> = {
        strength: 'strength',
        dexterity: 'dexterity',
        constitution: 'constitution',
        intelligence: 'intelligence',
        wisdom: 'wisdom',
        charisma: 'charisma',
    };

    const abilityKey = abilityMap[ability.toLowerCase()];
    if (!abilityKey) {
        return 0;
    }

    const score = token.abilityScores[abilityKey];
    return Math.floor((score - 10) / 2);
}

/**
 * Check aura effects for a specific target and trigger
 * @param tokens - All tokens in the encounter
 * @param targetId - ID of the target to check
 * @param trigger - The trigger type (enter, exit, start_of_turn, etc.)
 * @param auraRepo - Aura repository
 * @returns Array of effect results
 */
export function checkAuraEffectsForTarget(
    tokens: Token[],
    targetId: string,
    trigger: AuraTrigger,
    auraRepo: AuraRepository
): AuraEffectResult[] {
    const target = tokens.find(t => t.id === targetId);
    if (!target || !target.position) {
        return [];
    }

    const aurasAtPosition = getAurasAtPosition(tokens, target.position, auraRepo);
    const results: AuraEffectResult[] = [];

    for (const aura of aurasAtPosition) {
        // Find aura owner to determine ally status
        const owner = tokens.find(t => t.id === aura.ownerId);
        if (!owner) continue;

        // Determine if target is ally (same isEnemy status as owner)
        const ownerIsAlly = target.isEnemy === owner.isEnemy;

        // Check if target should be affected
        if (!shouldAffectTarget(aura, target, ownerIsAlly)) {
            continue;
        }

        // Apply each effect that matches the trigger
        for (const effect of aura.effects) {
            if (effect.trigger === trigger) {
                const result = applyAuraEffect(aura, effect, target, trigger);
                results.push(result);
            }
        }
    }

    return results;
}

/**
 * Check if aura has exceeded its duration
 */
export function checkAuraDuration(
    aura: AuraState,
    currentRound: number
): boolean {
    if (!aura.maxDuration) {
        return false; // No duration limit
    }

    const roundsElapsed = currentRound - aura.startedAt;
    return roundsElapsed >= aura.maxDuration;
}

/**
 * Clean up expired auras
 * @param currentRound - Current combat round
 * @param auraRepo - Aura repository
 * @returns Array of expired aura IDs
 */
export function expireOldAuras(
    currentRound: number,
    auraRepo: AuraRepository
): string[] {
    const allAuras = auraRepo.findAll();
    const expiredIds: string[] = [];

    for (const aura of allAuras) {
        if (checkAuraDuration(aura, currentRound)) {
            auraRepo.delete(aura.id);
            expiredIds.push(aura.id);
        }
    }

    return expiredIds;
}
