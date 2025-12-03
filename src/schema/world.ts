import { z } from 'zod';

export const WorldSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  seed: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  environment: z
    .object({
      date: z.string().optional(),
      timeOfDay: z.string().optional(),
      season: z.string().optional(),
      moonPhase: z.string().optional(),
      weatherConditions: z.string().optional(),
      temperature: z.string().optional(),
      lighting: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

export type World = z.infer<typeof WorldSchema>;
