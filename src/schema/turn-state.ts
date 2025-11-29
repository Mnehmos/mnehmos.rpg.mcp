import { z } from 'zod';

export const TurnStateSchema = z.object({
    worldId: z.string(),
    currentTurn: z.number().int().min(1),
    turnPhase: z.enum(['planning', 'resolution', 'finished']),
    phaseStartedAt: z.string().datetime(),
    nationsReady: z.array(z.string()),  // Array of nation IDs
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type TurnState = z.infer<typeof TurnStateSchema>;

// Action schema for batch submission
export const TurnActionSchema = z.object({
    type: z.enum(['claim_region', 'propose_alliance', 'break_alliance', 'transfer_region', 'declare_intent', 'send_message', 'adjust_relations']),
    // Union of all possible action parameters
    regionId: z.string().optional(),
    toNationId: z.string().optional(),
    fromNationId: z.string().optional(),
    justification: z.string().optional(),
    intent: z.string().optional(),
    message: z.string().optional(),
    opinionDelta: z.number().optional(),
});

export type TurnAction = z.infer<typeof TurnActionSchema>;
