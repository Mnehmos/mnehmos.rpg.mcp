import { z } from 'zod';

export const NationResourcesSchema = z.object({
    food: z.number().min(0).default(0),
    metal: z.number().min(0).default(0),
    oil: z.number().min(0).default(0),
});

export type NationResources = z.infer<typeof NationResourcesSchema>;

export const NationSchema = z.object({
    id: z.string(),
    worldId: z.string(),
    name: z.string(),
    leader: z.string().describe('Name of the LLM persona leading this nation'),
    ideology: z.enum(['democracy', 'autocracy', 'theocracy', 'tribal']),

    // Personality Traits (0-100)
    aggression: z.number().int().min(0).max(100),
    trust: z.number().int().min(0).max(100),
    paranoia: z.number().int().min(0).max(100),

    // Economy
    gdp: z.number().min(0),
    resources: NationResourcesSchema,
    relations: z.record(z.object({
        opinion: z.number(),
        alliance: z.boolean(),
        truceUntil: z.number().optional()
    })).default({}),

    // State
    privateMemory: z.record(z.any()).optional().describe('LLM-only private memory'),
    publicIntent: z.string().optional().describe('Publicly declared intent'),

    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type Nation = z.infer<typeof NationSchema>;
