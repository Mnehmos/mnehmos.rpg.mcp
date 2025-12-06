/**
 * PHASE-2: Social Hearing Mechanics - Stealth vs Perception Opposed Rolls
 *
 * Implements D&D 5e-style opposed checks for eavesdropping detection:
 * - Speaker rolls Stealth (d20 + DEX modifier + stealthBonus)
 * - Listener rolls Perception (d20 + WIS modifier + perceptionBonus)
 * - If listener's total >= speaker's total, they hear the conversation
 */

import { Character, NPC } from '../../schema/character.js';

export interface OpposedRollResult {
    // Speaker (trying to be stealthy)
    speakerRoll: number;           // Raw d20 roll
    speakerModifier: number;       // DEX mod + stealthBonus
    speakerTotal: number;          // Roll + modifier

    // Listener (trying to perceive)
    listenerRoll: number;          // Raw d20 roll
    listenerModifier: number;      // WIS mod + perceptionBonus
    listenerTotal: number;         // Roll + modifier

    // Result
    success: boolean;              // Did listener hear it?
    margin: number;                // How much they beat/missed by
}

/**
 * Calculate ability modifier from ability score (D&D 5e formula)
 *
 * @param abilityScore - Ability score (1-30, typically 3-20)
 * @returns Modifier (-5 to +10 typically)
 */
function getModifier(abilityScore: number): number {
    return Math.floor((abilityScore - 10) / 2);
}

/**
 * Roll a d20 (1-20)
 */
function rollD20(): number {
    return Math.floor(Math.random() * 20) + 1;
}

/**
 * Perform a Stealth vs Perception opposed roll
 *
 * Speaker tries to hide their conversation (Stealth check)
 * Listener tries to overhear (Perception check)
 *
 * @param speaker - Character attempting stealth
 * @param listener - Character attempting perception
 * @param environmentModifier - Optional modifier from environment (e.g., -5 for noisy tavern)
 * @returns Detailed result of the opposed roll
 */
export function rollStealthVsPerception(
    speaker: Character | NPC,
    listener: Character | NPC,
    environmentModifier: number = 0
): OpposedRollResult {
    // Speaker's Stealth check
    const speakerRoll = rollD20();
    const dexModifier = getModifier(speaker.stats.dex);
    const speakerStealthBonus = speaker.stealthBonus || 0;
    const speakerModifier = dexModifier + speakerStealthBonus;
    const speakerTotal = speakerRoll + speakerModifier;

    // Listener's Perception check
    const listenerRoll = rollD20();
    const wisModifier = getModifier(listener.stats.wis); // Fixed: should be listener's WIS, not speaker's
    const listenerPerceptionBonus = listener.perceptionBonus || 0;
    const listenerModifier = wisModifier + listenerPerceptionBonus + environmentModifier;
    const listenerTotal = listenerRoll + listenerModifier;

    // Listener succeeds if their total >= speaker's total
    const success = listenerTotal >= speakerTotal;
    const margin = listenerTotal - speakerTotal;

    return {
        speakerRoll,
        speakerModifier,
        speakerTotal,
        listenerRoll,
        listenerModifier,
        listenerTotal,
        success,
        margin
    };
}

/**
 * Determine environment modifier based on atmospherics
 *
 * @param atmospherics - Room atmospheric effects
 * @returns Modifier to apply to Perception checks
 */
export function getEnvironmentModifier(atmospherics: string[]): number {
    let modifier = 0;

    // SILENCE makes it easier to hear (no background noise)
    if (atmospherics.includes('SILENCE')) {
        modifier += 5;
    }

    // FOG doesn't affect hearing (visual only)
    // DARKNESS doesn't affect hearing
    // ANTIMAGIC doesn't affect natural hearing

    return modifier;
}

/**
 * Check if character is deafened (cannot hear)
 *
 * @param character - Character to check
 * @returns true if character cannot hear
 */
export function isDeafened(character: Character | NPC): boolean {
    return character.conditions?.includes('DEAFENED') || false;
}

/**
 * Batch process opposed rolls for multiple listeners
 *
 * Optimized for scenarios where one speaker is heard by many listeners
 *
 * @param speaker - The character speaking
 * @param listeners - Array of characters trying to hear
 * @param environmentModifier - Modifier from environment
 * @returns Map of listenerId -> OpposedRollResult
 */
export function batchRollStealthVsPerception(
    speaker: Character | NPC,
    listeners: Array<Character | NPC>,
    environmentModifier: number = 0
): Map<string, OpposedRollResult> {
    const results = new Map<string, OpposedRollResult>();

    for (const listener of listeners) {
        // Skip deafened listeners
        if (isDeafened(listener)) {
            continue;
        }

        const result = rollStealthVsPerception(speaker, listener, environmentModifier);
        results.set(listener.id, result);
    }

    return results;
}
