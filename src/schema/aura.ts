import { z } from 'zod';

/**
 * Aura effect trigger types - when the effect activates
 */
export const AuraTriggerSchema = z.enum(['enter', 'exit', 'start_of_turn', 'end_of_turn']);
export type AuraTrigger = z.infer<typeof AuraTriggerSchema>;

/**
 * Aura effect type - what the effect does
 */
export const AuraEffectTypeSchema = z.enum(['damage', 'buff', 'debuff', 'healing', 'condition', 'custom']);
export type AuraEffectType = z.infer<typeof AuraEffectTypeSchema>;

/**
 * Individual effect within an aura
 */
export const AuraEffectSchema = z.object({
    trigger: AuraTriggerSchema,
    type: AuraEffectTypeSchema,
    dice: z.string().optional(), // e.g., "3d8" for damage/healing
    damageType: z.string().optional(), // e.g., "radiant", "necrotic"
    saveType: z.string().optional(), // e.g., "wisdom", "dexterity"
    saveDC: z.number().int().optional(),
    conditions: z.array(z.string()).optional(), // e.g., ["frightened", "slowed"]
    description: z.string().optional(), // Custom effect description
    bonusAmount: z.number().int().optional(), // For buffs/debuffs
    bonusType: z.string().optional(), // e.g., "ac", "saves", "damage"
});

export type AuraEffect = z.infer<typeof AuraEffectSchema>;

/**
 * Active aura state
 * Auras are centered on a character and move with them
 */
export const AuraStateSchema = z.object({
    id: z.string(),
    ownerId: z.string(), // Character who created the aura
    spellName: z.string(),
    spellLevel: z.number().int().min(0).max(9),
    radius: z.number().int().min(1), // Radius in feet (5 feet = 1 square)
    affectsAllies: z.boolean().default(false),
    affectsEnemies: z.boolean().default(false),
    affectsSelf: z.boolean().default(false), // Some auras affect the caster
    effects: z.array(AuraEffectSchema),
    startedAt: z.number().int().min(1), // Round number
    maxDuration: z.number().int().optional(), // Maximum rounds (undefined = indefinite)
    requiresConcentration: z.boolean().default(false), // Some auras need concentration
});

export type AuraState = z.infer<typeof AuraStateSchema>;

/**
 * Result of an aura effect triggering
 */
export const AuraEffectResultSchema = z.object({
    auraId: z.string(),
    auraName: z.string(),
    targetId: z.string(),
    trigger: AuraTriggerSchema,
    effectType: AuraEffectTypeSchema,
    succeeded: z.boolean(), // Whether the effect applied (false if saved)
    damageDealt: z.number().int().optional(),
    damageType: z.string().optional(),
    healingDone: z.number().int().optional(),
    conditionsApplied: z.array(z.string()).optional(),
    saveRoll: z.number().int().optional(),
    saveDC: z.number().int().optional(),
    saveTotal: z.number().int().optional(),
    description: z.string().optional(),
});

export type AuraEffectResult = z.infer<typeof AuraEffectResultSchema>;

/**
 * Request to create a new aura
 */
export const CreateAuraRequestSchema = z.object({
    ownerId: z.string(),
    spellName: z.string(),
    spellLevel: z.number().int().min(0).max(9),
    radius: z.number().int().min(1),
    affectsAllies: z.boolean().default(false),
    affectsEnemies: z.boolean().default(false),
    affectsSelf: z.boolean().default(false),
    effects: z.array(AuraEffectSchema),
    currentRound: z.number().int().min(1),
    maxDuration: z.number().int().optional(),
    requiresConcentration: z.boolean().default(false),
});

export type CreateAuraRequest = z.infer<typeof CreateAuraRequestSchema>;

/**
 * Request to check aura effects at a position
 */
export const CheckAuraEffectsRequestSchema = z.object({
    encounterId: z.string(),
    x: z.number().int(),
    y: z.number().int(),
    trigger: AuraTriggerSchema,
});

export type CheckAuraEffectsRequest = z.infer<typeof CheckAuraEffectsRequestSchema>;
