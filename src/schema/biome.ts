import { z } from 'zod';

/**
 * Biome type enumeration
 */
export enum BiomeType {
  // Water biomes
  OCEAN = 'ocean',
  DEEP_OCEAN = 'deep_ocean',
  LAKE = 'lake',

  // Hot biomes
  DESERT = 'hot_desert',
  SAVANNA = 'savanna',
  RAINFOREST = 'tropical_rainforest',

  // Temperate biomes
  GRASSLAND = 'grassland',
  FOREST = 'temperate_deciduous_forest',
  SWAMP = 'wetland',

  // Cold biomes
  TAIGA = 'taiga',
  TUNDRA = 'tundra',
  GLACIER = 'glacier',
}

export const BiomeSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  temperatureMin: z.number(),
  temperatureMax: z.number(),
  moistureMin: z.number().min(0).max(1),
  moistureMax: z.number().min(0).max(1),
  elevationMin: z.number(),
  elevationMax: z.number(),
});

export type Biome = z.infer<typeof BiomeSchema>;
