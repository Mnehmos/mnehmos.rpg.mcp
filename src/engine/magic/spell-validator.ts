/**
 * Spell Validator - Core validation layer for spellcasting
 * Prevents LLM hallucination (CRIT-006) by validating:
 * - Spell exists in database
 * - Character knows/has prepared the spell
 * - Character has spell slots available
 * - Character can cast at the requested level
 * - Range and targeting requirements
 */

import type { Character } from '../../schema/character.js';
import type { Spell, CharacterClass, SpellSlots, SpellcastingAbility } from '../../schema/spell.js';
import { getSpell, isSpellAvailableToClass } from './spell-database.js';

// Spellcasting class configuration
interface SpellcastingConfig {
    canCast: boolean;
    startLevel: number;
    ability: SpellcastingAbility;
    fullCaster: boolean; // Full caster vs half-caster vs third-caster
    preparationRequired: boolean;
    pactMagic: boolean; // Warlock special case
}

const SPELLCASTING_CONFIG: Record<CharacterClass, SpellcastingConfig> = {
    barbarian: { canCast: false, startLevel: 999, ability: 'charisma', fullCaster: false, preparationRequired: false, pactMagic: false },
    bard: { canCast: true, startLevel: 1, ability: 'charisma', fullCaster: true, preparationRequired: false, pactMagic: false },
    cleric: { canCast: true, startLevel: 1, ability: 'wisdom', fullCaster: true, preparationRequired: true, pactMagic: false },
    druid: { canCast: true, startLevel: 1, ability: 'wisdom', fullCaster: true, preparationRequired: true, pactMagic: false },
    fighter: { canCast: false, startLevel: 3, ability: 'intelligence', fullCaster: false, preparationRequired: false, pactMagic: false }, // Eldritch Knight
    monk: { canCast: false, startLevel: 999, ability: 'wisdom', fullCaster: false, preparationRequired: false, pactMagic: false },
    paladin: { canCast: true, startLevel: 2, ability: 'charisma', fullCaster: false, preparationRequired: true, pactMagic: false },
    ranger: { canCast: true, startLevel: 2, ability: 'wisdom', fullCaster: false, preparationRequired: false, pactMagic: false },
    rogue: { canCast: false, startLevel: 3, ability: 'intelligence', fullCaster: false, preparationRequired: false, pactMagic: false }, // Arcane Trickster
    sorcerer: { canCast: true, startLevel: 1, ability: 'charisma', fullCaster: true, preparationRequired: false, pactMagic: false },
    warlock: { canCast: true, startLevel: 1, ability: 'charisma', fullCaster: false, preparationRequired: false, pactMagic: true },
    wizard: { canCast: true, startLevel: 1, ability: 'intelligence', fullCaster: true, preparationRequired: true, pactMagic: false },
    artificer: { canCast: true, startLevel: 1, ability: 'intelligence', fullCaster: false, preparationRequired: true, pactMagic: false }
};

// Spell slot progression for full casters
const FULL_CASTER_SLOTS: Record<number, number[]> = {
    1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
    11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
    12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
    13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
    14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
    15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
    16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
    17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
    18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
    19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
    20: [4, 3, 3, 3, 3, 2, 2, 1, 1]
};

// Half-caster progression (Paladin, Ranger)
const HALF_CASTER_SLOTS: Record<number, number[]> = {
    2: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    3: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    4: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    5: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    6: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    7: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    8: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    9: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    10: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    11: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    12: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    13: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    14: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    15: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    16: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    17: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    18: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    19: [4, 3, 3, 3, 2, 0, 0, 0, 0],
    20: [4, 3, 3, 3, 2, 0, 0, 0, 0]
};

// Warlock pact magic slots
const WARLOCK_SLOTS: Record<number, { count: number; level: number }> = {
    1: { count: 1, level: 1 },
    2: { count: 2, level: 1 },
    3: { count: 2, level: 2 },
    4: { count: 2, level: 2 },
    5: { count: 2, level: 3 },
    6: { count: 2, level: 3 },
    7: { count: 2, level: 4 },
    8: { count: 2, level: 4 },
    9: { count: 2, level: 5 },
    10: { count: 2, level: 5 },
    11: { count: 3, level: 5 },
    12: { count: 3, level: 5 },
    13: { count: 3, level: 5 },
    14: { count: 3, level: 5 },
    15: { count: 3, level: 5 },
    16: { count: 3, level: 5 },
    17: { count: 4, level: 5 },
    18: { count: 4, level: 5 },
    19: { count: 4, level: 5 },
    20: { count: 4, level: 5 }
};

export interface SpellValidationError {
    code: string;
    message: string;
}

export interface SpellValidationResult {
    valid: boolean;
    error?: SpellValidationError;
    spell?: Spell;
    effectiveSlotLevel?: number;
}

/**
 * Get max spell level a character can cast based on class and level
 */
export function getMaxSpellLevel(characterClass: CharacterClass, level: number): number {
    const config = SPELLCASTING_CONFIG[characterClass];
    if (!config.canCast) return 0;
    if (level < config.startLevel) return 0;

    if (config.pactMagic) {
        // Warlock uses pact magic
        const warlockSlots = WARLOCK_SLOTS[level];
        return warlockSlots?.level || 0;
    }

    if (config.fullCaster) {
        const slots = FULL_CASTER_SLOTS[level];
        if (!slots) return 0;
        // Find highest level with slots
        for (let i = 8; i >= 0; i--) {
            if (slots[i] > 0) return i + 1;
        }
        return 0;
    } else {
        // Half-caster
        const effectiveLevel = level >= config.startLevel ? level : 0;
        const slots = HALF_CASTER_SLOTS[effectiveLevel];
        if (!slots) return 0;
        for (let i = 8; i >= 0; i--) {
            if (slots[i] > 0) return i + 1;
        }
        return 0;
    }
}

/**
 * Get initial spell slots for a character based on class and level
 */
export function getInitialSpellSlots(characterClass: CharacterClass, level: number): SpellSlots {
    const config = SPELLCASTING_CONFIG[characterClass];
    const empty: SpellSlots = {
        level1: { current: 0, max: 0 },
        level2: { current: 0, max: 0 },
        level3: { current: 0, max: 0 },
        level4: { current: 0, max: 0 },
        level5: { current: 0, max: 0 },
        level6: { current: 0, max: 0 },
        level7: { current: 0, max: 0 },
        level8: { current: 0, max: 0 },
        level9: { current: 0, max: 0 }
    };

    if (!config.canCast || level < config.startLevel) {
        return empty;
    }

    let slots: number[];
    if (config.fullCaster) {
        slots = FULL_CASTER_SLOTS[level] || [0, 0, 0, 0, 0, 0, 0, 0, 0];
    } else if (config.pactMagic) {
        // Warlock doesn't use standard slots - handled separately
        return empty;
    } else {
        slots = HALF_CASTER_SLOTS[level] || [0, 0, 0, 0, 0, 0, 0, 0, 0];
    }

    return {
        level1: { current: slots[0], max: slots[0] },
        level2: { current: slots[1], max: slots[1] },
        level3: { current: slots[2], max: slots[2] },
        level4: { current: slots[3], max: slots[3] },
        level5: { current: slots[4], max: slots[4] },
        level6: { current: slots[5], max: slots[5] },
        level7: { current: slots[6], max: slots[6] },
        level8: { current: slots[7], max: slots[7] },
        level9: { current: slots[8], max: slots[8] }
    };
}

/**
 * Calculate spell save DC for a character
 * DC = 8 + proficiency bonus + spellcasting ability modifier
 */
export function calculateSpellSaveDC(character: Character): number {
    const config = SPELLCASTING_CONFIG[character.characterClass || 'fighter'];
    if (!config.canCast) return 0;

    const profBonus = Math.floor((character.level - 1) / 4) + 2;
    const abilityMod = getAbilityModifier(character, config.ability);

    return 8 + profBonus + abilityMod;
}

/**
 * Calculate spell attack bonus for a character
 * Attack = proficiency bonus + spellcasting ability modifier
 */
export function calculateSpellAttackBonus(character: Character): number {
    const config = SPELLCASTING_CONFIG[character.characterClass || 'fighter'];
    if (!config.canCast) return 0;

    const profBonus = Math.floor((character.level - 1) / 4) + 2;
    const abilityMod = getAbilityModifier(character, config.ability);

    return profBonus + abilityMod;
}

/**
 * Get ability modifier from stats
 */
function getAbilityModifier(character: Character, ability: SpellcastingAbility): number {
    const statMap: Record<SpellcastingAbility, keyof Character['stats']> = {
        intelligence: 'int',
        wisdom: 'wis',
        charisma: 'cha'
    };

    const stat = character.stats[statMap[ability]];
    return Math.floor((stat - 10) / 2);
}

/**
 * Check if character can cast spells at all
 */
export function canCastSpells(character: Character): { canCast: boolean; reason?: string } {
    const charClass = character.characterClass || 'fighter';
    const config = SPELLCASTING_CONFIG[charClass];

    if (!config.canCast) {
        return {
            canCast: false,
            reason: `${charClass} is not a spellcasting class`
        };
    }

    if (character.level < config.startLevel) {
        return {
            canCast: false,
            reason: `${charClass} gains spellcasting at level ${config.startLevel}`
        };
    }

    // Check for incapacitating conditions
    const conditions = character.conditions || [];
    if (conditions.includes('INCAPACITATED') || conditions.includes('STUNNED') || conditions.includes('PARALYZED') || conditions.includes('UNCONSCIOUS')) {
        return {
            canCast: false,
            reason: 'Cannot take actions while incapacitated'
        };
    }

    return { canCast: true };
}

/**
 * Check if character knows/has prepared a specific spell
 */
export function characterKnowsSpell(character: Character, spellName: string): { knows: boolean; reason?: string } {
    const spell = getSpell(spellName);
    if (!spell) {
        return { knows: false, reason: `Unknown spell: ${spellName}` };
    }

    const charClass = character.characterClass || 'fighter';
    const config = SPELLCASTING_CONFIG[charClass];

    // Check if spell is available to class
    if (!isSpellAvailableToClass(spellName, charClass as any)) {
        return {
            knows: false,
            reason: `${spell.name} is not available to ${charClass} class`
        };
    }

    // Cantrips: check cantripsKnown
    if (spell.level === 0) {
        const cantrips = character.cantripsKnown || [];
        if (!cantrips.some(c => c.toLowerCase() === spellName.toLowerCase())) {
            return {
                knows: false,
                reason: `${spell.name} is not in your known cantrips`
            };
        }
        return { knows: true };
    }

    // Leveled spells: check known and prepared
    const knownSpells = character.knownSpells || [];
    const preparedSpells = character.preparedSpells || [];

    // For classes that require preparation
    if (config.preparationRequired) {
        if (!preparedSpells.some(s => s.toLowerCase() === spellName.toLowerCase())) {
            if (knownSpells.some(s => s.toLowerCase() === spellName.toLowerCase())) {
                return {
                    knows: false,
                    reason: `${spell.name} is not prepared`
                };
            }
            return {
                knows: false,
                reason: `${spell.name} is not in your spellbook`
            };
        }
    } else {
        // Classes that cast from known spells (Sorcerer, Bard, Warlock, Ranger)
        if (!knownSpells.some(s => s.toLowerCase() === spellName.toLowerCase())) {
            return {
                knows: false,
                reason: `${spell.name} is not in your known spells`
            };
        }
    }

    return { knows: true };
}

/**
 * Check if character has spell slot available at the given level
 */
export function hasSpellSlotAvailable(character: Character, minLevel: number): { available: boolean; availableLevel?: number; reason?: string } {
    const charClass = character.characterClass || 'fighter';
    const config = SPELLCASTING_CONFIG[charClass];

    if (config.pactMagic) {
        // Warlock uses pact magic
        const pactSlots = character.pactMagicSlots;
        if (!pactSlots || pactSlots.current <= 0) {
            return { available: false, reason: 'No pact magic slots remaining' };
        }
        if (pactSlots.slotLevel < minLevel) {
            return { available: false, reason: `Pact magic slot level (${pactSlots.slotLevel}) is lower than spell minimum (${minLevel})` };
        }
        return { available: true, availableLevel: pactSlots.slotLevel };
    }

    // Standard spellcasting
    const slots = character.spellSlots;
    if (!slots) {
        return { available: false, reason: 'No spell slots available' };
    }

    // Find lowest available slot at or above minLevel
    const slotKeys: (keyof SpellSlots)[] = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'level7', 'level8', 'level9'];

    for (let i = minLevel - 1; i < 9; i++) {
        const key = slotKeys[i];
        if (slots[key] && slots[key].current > 0) {
            return { available: true, availableLevel: i + 1 };
        }
    }

    return { available: false, reason: `No level ${minLevel}+ spell slots available` };
}

/**
 * Main validation function - validates a spell cast request
 */
export function validateSpellCast(
    character: Character,
    spellName: string,
    requestedSlotLevel?: number
): SpellValidationResult {
    // Check empty spell name
    if (!spellName || spellName.trim() === '') {
        return {
            valid: false,
            error: { code: 'EMPTY_SPELL_NAME', message: 'Spell name is required' }
        };
    }

    // Check spell exists
    const spell = getSpell(spellName);
    if (!spell) {
        return {
            valid: false,
            error: { code: 'UNKNOWN_SPELL', message: `Unknown spell: ${spellName}` }
        };
    }

    // Check character can cast spells
    const castCheck = canCastSpells(character);
    if (!castCheck.canCast) {
        return {
            valid: false,
            error: { code: 'CANNOT_CAST', message: castCheck.reason! }
        };
    }

    // Check character knows/has prepared the spell
    const knowsCheck = characterKnowsSpell(character, spellName);
    if (!knowsCheck.knows) {
        return {
            valid: false,
            error: { code: 'SPELL_NOT_KNOWN', message: knowsCheck.reason! }
        };
    }

    // Check conditions that prevent casting
    const conditions = character.conditions || [];

    // Check for silence (blocks verbal component spells)
    if (conditions.includes('SILENCED') && spell.components.verbal) {
        return {
            valid: false,
            error: { code: 'SILENCED', message: 'Cannot cast spells with verbal components while silenced' }
        };
    }

    // Handle cantrips (no slot needed)
    if (spell.level === 0) {
        return {
            valid: true,
            spell,
            effectiveSlotLevel: 0
        };
    }

    // Check max spell level
    const maxLevel = getMaxSpellLevel(character.characterClass || 'fighter', character.level);
    const spellLevel = spell.level;

    if (spellLevel > maxLevel) {
        return {
            valid: false,
            error: {
                code: 'SPELL_LEVEL_TOO_HIGH',
                message: `Cannot cast level ${spellLevel} spells (max spell level: ${maxLevel})`
            }
        };
    }

    // Handle requested slot level
    let targetSlotLevel = requestedSlotLevel || spellLevel;

    // Cannot downcast
    if (targetSlotLevel < spellLevel) {
        return {
            valid: false,
            error: {
                code: 'CANNOT_DOWNCAST',
                message: `${spell.name} requires minimum slot level ${spellLevel}`
            }
        };
    }

    // Cannot upcast beyond max level
    if (targetSlotLevel > maxLevel) {
        return {
            valid: false,
            error: {
                code: 'SLOT_LEVEL_TOO_HIGH',
                message: `Cannot cast at level ${targetSlotLevel} (max available: ${maxLevel})`
            }
        };
    }

    // Check spell slot availability
    const slotCheck = hasSpellSlotAvailable(character, targetSlotLevel);
    if (!slotCheck.available) {
        return {
            valid: false,
            error: { code: 'NO_SLOTS', message: slotCheck.reason! }
        };
    }

    // For Warlock, always use pact slot level
    const config = SPELLCASTING_CONFIG[character.characterClass || 'fighter'];
    if (config.pactMagic) {
        targetSlotLevel = slotCheck.availableLevel!;
    }

    return {
        valid: true,
        spell,
        effectiveSlotLevel: targetSlotLevel
    };
}

/**
 * Consume a spell slot after successful cast
 */
export function consumeSpellSlot(character: Character, slotLevel: number): Character {
    const charClass = character.characterClass || 'fighter';
    const config = SPELLCASTING_CONFIG[charClass];

    if (config.pactMagic) {
        // Warlock pact magic
        if (character.pactMagicSlots && character.pactMagicSlots.current > 0) {
            return {
                ...character,
                pactMagicSlots: {
                    ...character.pactMagicSlots,
                    current: character.pactMagicSlots.current - 1
                }
            };
        }
        return character;
    }

    // Standard spellcasting
    if (!character.spellSlots) return character;

    const slotKey = `level${slotLevel}` as keyof SpellSlots;
    const currentSlot = character.spellSlots[slotKey];

    if (currentSlot && currentSlot.current > 0) {
        return {
            ...character,
            spellSlots: {
                ...character.spellSlots,
                [slotKey]: {
                    ...currentSlot,
                    current: currentSlot.current - 1
                }
            }
        };
    }

    return character;
}

/**
 * Restore all spell slots (for long rest)
 */
export function restoreAllSpellSlots(character: Character): Character {
    const charClass = character.characterClass || 'fighter';
    const config = SPELLCASTING_CONFIG[charClass];

    if (!config.canCast || character.level < config.startLevel) {
        return character;
    }

    if (config.pactMagic) {
        // Warlock pact magic
        const warlockSlots = WARLOCK_SLOTS[character.level];
        return {
            ...character,
            pactMagicSlots: {
                current: warlockSlots.count,
                max: warlockSlots.count,
                slotLevel: warlockSlots.level
            }
        };
    }

    // Standard spellcasting
    const slots = getInitialSpellSlots(charClass, character.level);
    return {
        ...character,
        spellSlots: slots
    };
}

/**
 * Restore warlock pact slots (for short rest)
 */
export function restorePactSlots(character: Character): Character {
    const charClass = character.characterClass || 'fighter';
    const config = SPELLCASTING_CONFIG[charClass];

    if (!config.pactMagic) {
        return character; // Not a warlock
    }

    const warlockSlots = WARLOCK_SLOTS[character.level];
    return {
        ...character,
        pactMagicSlots: {
            current: warlockSlots.count,
            max: warlockSlots.count,
            slotLevel: warlockSlots.level
        }
    };
}

/**
 * Check range for spell targeting
 */
export function validateSpellRange(
    spell: Spell,
    casterPosition: { x: number; y: number },
    targetPosition?: { x: number; y: number }
): { valid: boolean; reason?: string } {
    // Self-targeting spells
    if (spell.range === 'self') {
        return { valid: true };
    }

    // Touch spells - must be adjacent (within 1 square / 5 feet)
    if (spell.range === 'touch') {
        if (!targetPosition) {
            return { valid: false, reason: `${spell.name} has range Touch - target must be adjacent` };
        }
        const distance = Math.sqrt(
            Math.pow(targetPosition.x - casterPosition.x, 2) +
            Math.pow(targetPosition.y - casterPosition.y, 2)
        );
        // Adjacent = within 1 square (diagonal counts)
        if (distance > 1.5) { // Allow for diagonal (sqrt(2) ≈ 1.41)
            return { valid: false, reason: `${spell.name} has range Touch - target must be adjacent` };
        }
        return { valid: true };
    }

    // Ranged spells
    if (typeof spell.range === 'number') {
        if (!targetPosition) {
            return { valid: true }; // No target position to validate
        }
        const distanceInSquares = Math.sqrt(
            Math.pow(targetPosition.x - casterPosition.x, 2) +
            Math.pow(targetPosition.y - casterPosition.y, 2)
        );
        const distanceInFeet = distanceInSquares * 5; // 5 feet per square

        if (distanceInFeet > spell.range) {
            return { valid: false, reason: `${spell.name} has range ${spell.range} feet` };
        }
        return { valid: true };
    }

    return { valid: true };
}

/**
 * Get spellcasting configuration for a class
 */
export function getSpellcastingConfig(characterClass: CharacterClass): SpellcastingConfig {
    return SPELLCASTING_CONFIG[characterClass];
}
