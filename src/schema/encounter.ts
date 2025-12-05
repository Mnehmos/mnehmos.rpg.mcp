import { z } from 'zod';

export const ConditionSchema = z.object({
    id: z.string(),
    type: z.string(),
    durationType: z.string(),
    duration: z.number().optional(),
    sourceId: z.string().optional(),
    saveDC: z.number().optional(),
    saveAbility: z.string().optional(),
    ongoingEffects: z.array(z.any()).optional(),
    metadata: z.record(z.any()).optional()
});

// CRIT-003: Position schema for spatial combat
export const PositionSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number().optional()
});

export type Position = z.infer<typeof PositionSchema>;

export const TokenSchema = z.object({
    id: z.string(),
    name: z.string(),
    initiativeBonus: z.number(),
    initiative: z.number().optional(),  // Rolled initiative value
    isEnemy: z.boolean().optional(),    // Whether this is an enemy
    hp: z.number(),
    maxHp: z.number(),
    conditions: z.array(ConditionSchema),
    position: PositionSchema.optional(), // CRIT-003: Spatial position for movement
    abilityScores: z.object({
        strength: z.number(),
        dexterity: z.number(),
        constitution: z.number(),
        intelligence: z.number(),
        wisdom: z.number(),
        charisma: z.number()
    }).optional()
});

export type Token = z.infer<typeof TokenSchema>;

// CRIT-003: Terrain schema for blocking obstacles
export const TerrainSchema = z.object({
    obstacles: z.array(z.string()).default([]), // "x,y" format for blocking tiles
    difficultTerrain: z.array(z.string()).optional() // Future: 2x movement cost
});

export type Terrain = z.infer<typeof TerrainSchema>;

export const EncounterSchema = z.object({
    id: z.string(),
    regionId: z.string().optional(), // Made optional as it might not always be linked to a region
    tokens: z.array(TokenSchema),
    round: z.number().int().min(0),
    activeTokenId: z.string().optional(),
    status: z.enum(['active', 'completed', 'paused']),
    terrain: TerrainSchema.optional(), // CRIT-003: Terrain obstacles
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type Encounter = z.infer<typeof EncounterSchema>;
