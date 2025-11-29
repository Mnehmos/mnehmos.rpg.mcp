import { z } from 'zod';

export const DiplomaticRelationSchema = z.object({
    fromNationId: z.string(),
    toNationId: z.string(),
    opinion: z.number().int().min(-100).max(100).default(0),
    isAllied: z.boolean().default(false),
    truceUntil: z.number().int().optional().describe('Turn number when truce expires'),
    updatedAt: z.string().datetime(),
});

export type DiplomaticRelation = z.infer<typeof DiplomaticRelationSchema>;

export const TerritorialClaimSchema = z.object({
    id: z.string(),
    nationId: z.string(),
    regionId: z.string(),
    claimStrength: z.number().int().min(0).max(100),
    justification: z.string().optional(),
    createdAt: z.string().datetime(),
});

export type TerritorialClaim = z.infer<typeof TerritorialClaimSchema>;

export const NationEventSchema = z.object({
    id: z.number().optional(), // Auto-increment in DB
    worldId: z.string(),
    turnNumber: z.number().int(),
    eventType: z.enum([
        'ALLIANCE_FORMED',
        'ALLIANCE_BROKEN',
        'WAR_DECLARED',
        'PEACE_SIGNED',
        'REGION_CLAIMED',
        'REGION_CONQUERED',
        'REGION_TRANSFERRED',
        'DIPLOMATIC_MESSAGE',
        'RESOURCE_TRANSFER'
    ]),
    involvedNations: z.array(z.string()),
    details: z.record(z.any()),
    timestamp: z.string().datetime(),
});

export type NationEvent = z.infer<typeof NationEventSchema>;
