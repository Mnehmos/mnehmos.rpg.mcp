import { z } from 'zod';

export const RegionSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  name: z.string(),
  type: z.enum(['kingdom', 'duchy', 'county', 'wilderness', 'water', 'plains', 'forest', 'mountain', 'desert', 'city']),
  centerX: z.number(),
  centerY: z.number(),
  color: z.string(),
  ownerNationId: z.string().nullable().optional(),
  controlLevel: z.number().int().min(0).max(100).default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Region = z.infer<typeof RegionSchema>;
