/**
 * Spell Scroll System - Handles scroll creation, validation, and usage
 * Implements D&D 5e spell scroll rules
 */

import { Character } from '../../schema/character.js';
import { Item } from '../../schema/inventory.js';
import {
    ScrollProperties,
    ScrollUsageResult,
    calculateScrollDC,
    calculateScrollAttackBonus,
    calculateScrollValue,
    getScrollRarity
} from '../../schema/scroll.js';
import { SpellcastingClass } from '../../schema/spell.js';
import { ItemRepository } from '../../storage/repos/item.repo.js';
import { InventoryRepository } from '../../storage/repos/inventory.repo.js';

/**
 * Validate if a character can use a spell scroll
 * Rules:
 * 1. If spell is on character's class list AND they can cast spells of that level: auto-success
 * 2. If spell is on character's class list BUT spell level too high: DC 10 + spell level Arcana check
 * 3. If spell is NOT on character's class list: DC 10 + spell level Arcana check
 */
export function validateScrollUse(
    character: Character,
    scrollProperties: ScrollProperties
): {
    requiresCheck: boolean;
    checkDC: number | null;
    reason: string;
} {
    const { spellLevel, spellClass } = scrollProperties;

    // Check if character is a spellcaster
    const isSpellcaster = character.maxSpellLevel !== undefined && character.maxSpellLevel > 0;

    if (!isSpellcaster) {
        // Non-spellcasters always require a check
        const checkDC = 10 + spellLevel;
        return {
            requiresCheck: true,
            checkDC,
            reason: 'not_a_spellcaster'
        };
    }

    // Check if spell is on character's class list
    const characterClass = character.characterClass?.toLowerCase();
    const spellClassList = spellClass?.toLowerCase();

    const isOnClassList = characterClass === spellClassList;

    if (!isOnClassList) {
        // Spell not on class list - requires check
        const checkDC = 10 + spellLevel;
        return {
            requiresCheck: true,
            checkDC,
            reason: 'spell_not_on_class_list'
        };
    }

    // Spell is on class list - check if they can cast that level
    const maxSpellLevel = character.maxSpellLevel || 0;

    if (spellLevel > maxSpellLevel) {
        // Can't cast that level yet - requires check
        const checkDC = 10 + spellLevel;
        return {
            requiresCheck: true,
            checkDC,
            reason: 'spell_level_too_high'
        };
    }

    // Spell on class list AND can cast that level - auto success!
    return {
        requiresCheck: false,
        checkDC: null,
        reason: 'auto_success'
    };
}

/**
 * Roll an Arcana check for scroll use
 * Uses Intelligence modifier + proficiency bonus (if proficient in Arcana)
 */
export function rollArcanaCheck(character: Character): { roll: number; total: number; modifier: number } {
    const roll = Math.floor(Math.random() * 20) + 1;

    // Calculate Intelligence modifier
    const intModifier = Math.floor((character.stats.int - 10) / 2);

    // For now, assume no proficiency bonus
    // TODO: Add proficiency tracking to character schema
    const proficiencyBonus = 0;

    const modifier = intModifier + proficiencyBonus;
    const total = roll + modifier;

    return { roll, total, modifier };
}

/**
 * Use a spell scroll
 * Handles validation, Arcana checks, and scroll consumption
 */
export function useSpellScroll(
    character: Character,
    scroll: Item,
    inventoryRepo: InventoryRepository
): ScrollUsageResult {
    // Validate scroll type
    if (scroll.type !== 'scroll') {
        return {
            success: false,
            consumed: false,
            requiresCheck: false,
            reason: 'invalid_scroll',
            message: `Item "${scroll.name}" is not a scroll (type: ${scroll.type})`
        };
    }

    // Extract scroll properties
    const scrollProps = scroll.properties as ScrollProperties;
    if (!scrollProps || !scrollProps.spellName || scrollProps.spellLevel === undefined) {
        return {
            success: false,
            consumed: false,
            requiresCheck: false,
            reason: 'invalid_scroll',
            message: `Scroll "${scroll.name}" is missing required spell properties`
        };
    }

    // Check if character has the scroll in inventory
    const inventory = inventoryRepo.getInventory(character.id);
    const hasScroll = inventory.items.some(i => i.itemId === scroll.id && i.quantity > 0);

    if (!hasScroll) {
        return {
            success: false,
            consumed: false,
            requiresCheck: false,
            reason: 'not_in_inventory',
            message: `Character does not have scroll "${scroll.name}" in inventory`
        };
    }

    // Validate scroll use requirements
    const validation = validateScrollUse(character, scrollProps);

    if (!validation.requiresCheck) {
        // Auto-success - remove scroll and allow spell cast
        inventoryRepo.removeItem(character.id, scroll.id, 1);

        return {
            success: true,
            consumed: true,
            requiresCheck: false,
            reason: 'auto_success',
            message: `Successfully used scroll of ${scrollProps.spellName}. Scroll consumed.`
        };
    }

    // Requires Arcana check
    const checkDC = validation.checkDC!;
    const arcanaCheck = rollArcanaCheck(character);
    const checkPassed = arcanaCheck.total >= checkDC;

    // Scroll is consumed regardless of check success
    inventoryRepo.removeItem(character.id, scroll.id, 1);

    if (checkPassed) {
        return {
            success: true,
            consumed: true,
            requiresCheck: true,
            checkRoll: arcanaCheck.roll,
            checkTotal: arcanaCheck.total,
            checkDC,
            checkPassed: true,
            reason: 'check_passed',
            message: `Arcana check passed (${arcanaCheck.total} vs DC ${checkDC}). Successfully used scroll of ${scrollProps.spellName}. Scroll consumed.`
        };
    } else {
        return {
            success: false,
            consumed: true,
            requiresCheck: true,
            checkRoll: arcanaCheck.roll,
            checkTotal: arcanaCheck.total,
            checkDC,
            checkPassed: false,
            reason: 'check_failed',
            message: `Arcana check failed (${arcanaCheck.total} vs DC ${checkDC}). Scroll of ${scrollProps.spellName} wasted and consumed.`
        };
    }
}

/**
 * Create a spell scroll item
 */
export function createSpellScroll(
    spellName: string,
    spellLevel: number,
    spellClass?: SpellcastingClass,
    customDC?: number,
    customAttackBonus?: number,
    customValue?: number,
    customDescription?: string
): Omit<Item, 'id' | 'createdAt' | 'updatedAt'> {
    const scrollDC = customDC || calculateScrollDC(spellLevel);
    const scrollAttackBonus = customAttackBonus || calculateScrollAttackBonus(spellLevel);
    const value = customValue || calculateScrollValue(spellLevel);
    const rarity = getScrollRarity(spellLevel);

    const scrollName = `Scroll of ${spellName}`;
    const description = customDescription ||
        `A spell scroll containing the ${spellLevel === 0 ? 'cantrip' : `${spellLevel}${getOrdinalSuffix(spellLevel)}-level spell`} ${spellName}. ` +
        `Rarity: ${rarity}. ` +
        `Spell Save DC: ${scrollDC}, Spell Attack Bonus: +${scrollAttackBonus}.`;

    const scrollProperties: ScrollProperties = {
        spellName,
        spellLevel,
        scrollDC,
        scrollAttackBonus,
        requiresCheck: false, // Will be determined at use time
        spellClass
    };

    return {
        name: scrollName,
        description,
        type: 'scroll',
        weight: 0.1, // Scrolls are light
        value,
        properties: scrollProperties
    };
}

/**
 * Get scroll details from an item
 */
export function getScrollDetails(scroll: Item): {
    valid: boolean;
    spellName?: string;
    spellLevel?: number;
    scrollDC?: number;
    scrollAttackBonus?: number;
    spellClass?: string;
    rarity?: string;
    error?: string;
} {
    if (scroll.type !== 'scroll') {
        return {
            valid: false,
            error: 'Item is not a scroll'
        };
    }

    const props = scroll.properties as ScrollProperties;
    if (!props || !props.spellName || props.spellLevel === undefined) {
        return {
            valid: false,
            error: 'Scroll is missing required properties'
        };
    }

    return {
        valid: true,
        spellName: props.spellName,
        spellLevel: props.spellLevel,
        scrollDC: props.scrollDC,
        scrollAttackBonus: props.scrollAttackBonus,
        spellClass: props.spellClass,
        rarity: getScrollRarity(props.spellLevel)
    };
}

/**
 * Check if a character can use a specific scroll
 * (Doesn't consume the scroll, just checks)
 */
export function checkScrollUsability(
    character: Character,
    scroll: Item
): {
    canUse: boolean;
    requiresCheck: boolean;
    checkDC: number | null;
    reason: string;
    message: string;
} {
    if (scroll.type !== 'scroll') {
        return {
            canUse: false,
            requiresCheck: false,
            checkDC: null,
            reason: 'invalid_scroll',
            message: 'Item is not a scroll'
        };
    }

    const props = scroll.properties as ScrollProperties;
    if (!props || !props.spellName || props.spellLevel === undefined) {
        return {
            canUse: false,
            requiresCheck: false,
            checkDC: null,
            reason: 'invalid_scroll',
            message: 'Scroll is missing required properties'
        };
    }

    const validation = validateScrollUse(character, props);

    if (!validation.requiresCheck) {
        return {
            canUse: true,
            requiresCheck: false,
            checkDC: null,
            reason: validation.reason,
            message: `Can use scroll automatically (spell on class list and can cast ${props.spellLevel}${getOrdinalSuffix(props.spellLevel)}-level spells)`
        };
    }

    return {
        canUse: true,
        requiresCheck: true,
        checkDC: validation.checkDC,
        reason: validation.reason,
        message: `Requires DC ${validation.checkDC} Arcana check (${validation.reason.replace(/_/g, ' ')})`
    };
}

/**
 * Calculate effective spell DC/attack bonus for a scroll
 * Uses the higher of caster's spellcasting DC or scroll's default DC
 */
export function getEffectiveScrollDC(
    character: Character,
    scroll: Item
): {
    spellDC: number;
    spellAttackBonus: number;
    usingCasterStats: boolean;
} {
    const props = scroll.properties as ScrollProperties;
    const scrollDC = props.scrollDC || calculateScrollDC(props.spellLevel);
    const scrollAttackBonus = props.scrollAttackBonus || calculateScrollAttackBonus(props.spellLevel);

    // If character has spellcasting, use their stats if higher
    if (character.spellSaveDC && character.spellAttackBonus) {
        const useCasterDC = character.spellSaveDC > scrollDC;
        const useCasterAttack = character.spellAttackBonus > scrollAttackBonus;

        return {
            spellDC: useCasterDC ? character.spellSaveDC : scrollDC,
            spellAttackBonus: useCasterAttack ? character.spellAttackBonus : scrollAttackBonus,
            usingCasterStats: useCasterDC && useCasterAttack
        };
    }

    // Use scroll's default stats
    return {
        spellDC: scrollDC,
        spellAttackBonus: scrollAttackBonus,
        usingCasterStats: false
    };
}

/**
 * Helper function to get ordinal suffix (1st, 2nd, 3rd, etc.)
 */
function getOrdinalSuffix(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}
