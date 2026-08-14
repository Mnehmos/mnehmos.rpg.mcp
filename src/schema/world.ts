import { z } from 'zod';

/** Canonical persisted world-environment contract shared by storage and tools. */
export const WorldEnvironmentSchema = z.object({
  date: z.string().optional(),
  timeOfDay: z.string().optional(),
  season: z.string().optional(),
  moonPhase: z.string().optional(),
  weatherConditions: z.string().optional(),
  temperature: z.string().optional(),
  lighting: z.string().optional(),
}).strict();

export type WorldEnvironment = z.infer<typeof WorldEnvironmentSchema>;

/** Normalize rows written by the retired world_manage environment contract. */
export function normalizeWorldEnvironment(value: unknown): WorldEnvironment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  const copy = (key: keyof WorldEnvironment, ...legacyKeys: string[]) => {
    const candidate = [key, ...legacyKeys]
      .map(name => source[name])
      .find(candidate => candidate !== undefined);
    if (candidate !== undefined) canonical[key] = candidate;
  };

  copy('date');
  copy('timeOfDay', 'dayNightCycle');
  copy('season');
  copy('moonPhase');
  copy('weatherConditions', 'weather');
  copy('temperature');
  copy('lighting');
  return WorldEnvironmentSchema.parse(canonical);
}

export const WorldSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  seed: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  environment: z.preprocess(normalizeWorldEnvironment, WorldEnvironmentSchema).optional(),
});

export type World = z.infer<typeof WorldSchema>;
