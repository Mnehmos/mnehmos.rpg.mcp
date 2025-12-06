import { z } from 'zod';
import { SpellcastingClassSchema } from './spell.js';

/**
 * Scroll Properties Schema
 * Extended properties for scroll items that contain spells
 */
export const ScrollPropertiesSchema = z.object({
    spellName: z.string().min(1, 'Spell name is required'),
    spellLevel: z.number().int().min(0).max(9).describe('Spell level (0 for cantrips, 1-9 for leveled spells)'),
    scrollDC: z.number().int().min(10).optional().describe('Default spell save DC if caster has no spellcasting ability'),
    scrollAttackBonus: z.number().int().optional().describe('Default spell attack bonus if caster has no spellcasting ability'),
    requiresCheck: z.boolean().default(false).describe('Whether scroll use requires an Arcana check'),
    checkDC: z.number().int().min(10).optional().describe('DC for Arcana check to use scroll'),
    spellClass: SpellcastingClassSchema.optional().describe('Class list the spell is on (for determining if check is required)')
});

export type ScrollProperties = z.infer<typeof ScrollPropertiesSchema>;

/**
 * Scroll Usage Validation Request
 */
export const ScrollUsageValidationSchema = z.object({
    characterId: z.string().describe('Character attempting to use the scroll'),
    itemId: z.string().describe('ID of the scroll item'),
    spellName: z.string().describe('Name of the spell on the scroll'),
    spellLevel: z.number().int().min(0).max(9).describe('Level of the spell'),
    spellClass: SpellcastingClassSchema.optional().describe('Class list the spell is on'),
    targetId: z.string().optional().describe('Target for the spell'),
    targetPoint: z.object({
        x: z.number(),
        y: z.number()
    }).optional().describe('Target point for area spells')
});

export type ScrollUsageValidation = z.infer<typeof ScrollUsageValidationSchema>;

/**
 * Scroll Usage Result
 */
export const ScrollUsageResultSchema = z.object({
    success: z.boolean().describe('Whether the scroll was used successfully'),
    consumed: z.boolean().describe('Whether the scroll was consumed (even on failure)'),
    requiresCheck: z.boolean().describe('Whether an Arcana check was required'),
    checkRoll: z.number().int().optional().describe('The d20 roll for the Arcana check'),
    checkTotal: z.number().int().optional().describe('Total Arcana check result'),
    checkDC: z.number().int().optional().describe('DC for the Arcana check'),
    checkPassed: z.boolean().optional().describe('Whether the check passed'),
    reason: z.enum([
        'auto_success',      // Spell on class list and can cast that level
        'check_passed',      // Required check and passed
        'check_failed',      // Required check and failed
        'not_in_inventory',  // Character doesn't have the scroll
        'spell_cast',        // Spell successfully cast
        'invalid_scroll'     // Scroll data is invalid
    ]).describe('Reason for the result'),
    spellCastResult: z.record(z.any()).optional().describe('Result of the spell cast if successful'),
    message: z.string().describe('Human-readable message about the result')
});

export type ScrollUsageResult = z.infer<typeof ScrollUsageResultSchema>;

/**
 * Scroll Creation Request
 */
export const CreateScrollRequestSchema = z.object({
    spellName: z.string().min(1, 'Spell name is required'),
    spellLevel: z.number().int().min(0).max(9),
    scrollDC: z.number().int().min(10).optional()
        .describe('Default DC (usually 13 + spell level for crafted scrolls)'),
    scrollAttackBonus: z.number().int().optional()
        .describe('Default attack bonus (usually +5 + spell level)'),
    spellClass: SpellcastingClassSchema.optional()
        .describe('Class list the spell is on'),
    value: z.number().int().min(0).optional()
        .describe('Gold value of the scroll'),
    description: z.string().optional()
        .describe('Custom description for the scroll')
});

export type CreateScrollRequest = z.infer<typeof CreateScrollRequestSchema>;

/**
 * Scroll rarity based on spell level
 */
export enum ScrollRarity {
    COMMON = 'common',           // Cantrips
    UNCOMMON = 'uncommon',       // 1st-3rd level
    RARE = 'rare',               // 4th-5th level
    VERY_RARE = 'very_rare',     // 6th-8th level
    LEGENDARY = 'legendary'      // 9th level
}

/**
 * Get scroll rarity based on spell level
 */
export function getScrollRarity(spellLevel: number): ScrollRarity {
    if (spellLevel === 0) return ScrollRarity.COMMON;
    if (spellLevel <= 3) return ScrollRarity.UNCOMMON;
    if (spellLevel <= 5) return ScrollRarity.RARE;
    if (spellLevel <= 8) return ScrollRarity.VERY_RARE;
    return ScrollRarity.LEGENDARY;
}

/**
 * Calculate default scroll DC based on spell level
 * Formula: 13 + spell level (standard for crafted scrolls)
 */
export function calculateScrollDC(spellLevel: number): number {
    return 13 + spellLevel;
}

/**
 * Calculate default scroll attack bonus based on spell level
 * Formula: 5 + spell level (standard for crafted scrolls)
 */
export function calculateScrollAttackBonus(spellLevel: number): number {
    return 5 + spellLevel;
}

/**
 * Calculate scroll value based on spell level and rarity
 * Based on DMG scroll prices
 */
export function calculateScrollValue(spellLevel: number): number {
    const valueLookup: Record<number, number> = {
        0: 25,      // Cantrip - Common (25-50gp)
        1: 75,      // 1st level - Uncommon (50-100gp)
        2: 150,     // 2nd level - Uncommon (100-200gp)
        3: 300,     // 3rd level - Uncommon (200-400gp)
        4: 750,     // 4th level - Rare (500-1000gp)
        5: 1500,    // 5th level - Rare (1000-2000gp)
        6: 5000,    // 6th level - Very Rare (2500-7500gp)
        7: 10000,   // 7th level - Very Rare (5000-15000gp)
        8: 20000,   // 8th level - Very Rare (10000-30000gp)
        9: 50000    // 9th level - Legendary (25000-100000gp)
    };
    return valueLookup[spellLevel] || 100;
}
