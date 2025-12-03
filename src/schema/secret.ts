import { z } from 'zod';

/**
 * Reveal condition types - when secrets can be uncovered
 */
export const RevealConditionSchema = z.object({
    type: z.enum([
        'skill_check',      // Player passes a skill check
        'quest_complete',   // A specific quest is completed
        'item_interact',    // Player interacts with an item
        'dialogue',         // Keyword spoken in dialogue
        'location_enter',   // Player enters a location
        'combat_end',       // Combat encounter ends
        'time_passed',      // In-game time passes
        'manual'            // DM explicitly reveals
    ]),
    
    // Skill check specifics
    skill: z.string().optional(),           // "Insight", "Perception", "Arcana"
    dc: z.number().int().min(1).optional(), // Difficulty class
    
    // Quest trigger
    questId: z.string().optional(),
    
    // Item trigger
    itemId: z.string().optional(),
    
    // Location trigger
    locationId: z.string().optional(),
    
    // NPC trigger
    npcId: z.string().optional(),
    
    // Dialogue trigger
    dialogueTrigger: z.string().optional(), // Keyword that triggers reveal
    
    // Time trigger
    hoursRequired: z.number().int().min(1).optional(),
    
    // Partial reveal (hint instead of full reveal)
    partialReveal: z.boolean().default(false),
    partialText: z.string().optional()      // "You sense something is off..."
});

/**
 * Secret schema - hidden information the DM knows but players shouldn't see
 */
export const SecretSchema = z.object({
    id: z.string(),
    worldId: z.string(),
    
    // Classification
    type: z.enum(['npc', 'location', 'item', 'quest', 'plot', 'mechanic', 'custom']),
    category: z.string(), // 'motivation', 'trap', 'puzzle', 'loot', 'weakness', 'twist', etc.
    
    // Content
    name: z.string(),                       // "Innkeeper's True Identity"
    publicDescription: z.string(),          // What player knows
    secretDescription: z.string(),          // What AI knows (hidden)
    
    // Entity linking
    linkedEntityId: z.string().optional(),  // NPC ID, Item ID, etc.
    linkedEntityType: z.string().optional(), // 'npc', 'item', 'location', 'quest'
    
    // Revelation state
    revealed: z.boolean().default(false),
    revealedAt: z.string().datetime().optional(),
    revealedBy: z.string().optional(),      // What triggered the reveal
    
    // Revelation conditions
    revealConditions: z.array(RevealConditionSchema).default([]),
    
    // Sensitivity for filtering
    sensitivity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    
    // Leak detection patterns
    leakPatterns: z.array(z.string()).default([]), // ["vampire", "undead", "blood"]
    
    // Metadata
    notes: z.string().optional(),           // DM notes
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});

/**
 * Game event that might trigger a reveal
 */
export const GameEventSchema = z.object({
    type: z.enum([
        'skill_check',
        'quest_complete', 
        'item_interact',
        'dialogue',
        'location_enter',
        'combat_end',
        'time_passed'
    ]),
    
    // Skill check event
    skill: z.string().optional(),
    result: z.number().int().optional(),
    
    // Quest event
    questId: z.string().optional(),
    
    // Item event
    itemId: z.string().optional(),
    
    // Location event
    locationId: z.string().optional(),
    
    // Dialogue event
    text: z.string().optional(),
    
    // Time event
    hoursPassed: z.number().optional(),
    
    // Context
    characterId: z.string().optional(),
    encounterId: z.string().optional()
});

/**
 * Result of a reveal operation
 */
export const RevealResultSchema = z.object({
    success: z.boolean(),
    secret: SecretSchema.optional(),
    narration: z.string().optional(),
    partial: z.boolean().default(false),
    reason: z.string().optional()
});

export type RevealCondition = z.infer<typeof RevealConditionSchema>;
export type Secret = z.infer<typeof SecretSchema>;
export type GameEvent = z.infer<typeof GameEventSchema>;
export type RevealResult = z.infer<typeof RevealResultSchema>;
