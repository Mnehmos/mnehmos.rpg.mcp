/**
 * World Generation Module
 *
 * Integrates heightmap, climate, and biome generation into a unified API.
 * Follows TDD principles with deterministic, seed-based generation.
 */

export * from './heightmap';
export * from './climate';
export * from './biome';

import { generateHeightmap } from './heightmap';
import { generateClimateMap } from './climate';
import { generateBiomeMap } from './biome';
import { BiomeType } from '../schema/biome';

/**
 * Complete world generation output
 */
export interface GeneratedWorld {
  seed: string;
  width: number;
  height: number;
  /** Elevation map (0-100, sea level at 20) */
  elevation: Uint8Array;
  /** Temperature map (Celsius, -20 to 40) */
  temperature: Int8Array;
  /** Moisture map (percentage, 0-100) */
  moisture: Uint8Array;
  /** Biome assignment */
  biomes: BiomeType[][];
}

/**
 * World generation options
 */
export interface WorldGenOptions {
  /** Deterministic seed */
  seed: string;
  /** Map width in cells */
  width: number;
  /** Map height in cells */
  height: number;
  /** Target land ratio (default 0.3 for 30% land) */
  landRatio?: number;
  /** Number of noise octaves (default 6) */
  octaves?: number;
  /** Equator temperature in Celsius (default 30) */
  equatorTemp?: number;
  /** Pole temperature in Celsius (default -10) */
  poleTemp?: number;
}

/**
 * Generate a complete world
 *
 * This is the primary entry point for world generation.
 * Produces a deterministic world from a seed.
 *
 * @example
 * ```typescript
 * const world = generateWorld({
 *   seed: 'my-world-42',
 *   width: 100,
 *   height: 100,
 * });
 *
 * console.log(world.biomes[50][50]); // BiomeType at equator, center
 * ```
 */
export function generateWorld(options: WorldGenOptions): GeneratedWorld {
  const { seed, width, height, landRatio, octaves } = options;

  // Step 1: Generate heightmap
  const elevation = generateHeightmap(seed, width, height, {
    landRatio,
    octaves,
  });

  // Step 2: Generate climate (temperature + moisture)
  const climate = generateClimateMap(seed, width, height, elevation);

  // Step 3: Assign biomes
  const biomeMap = generateBiomeMap({
    width,
    height,
    temperature: climate.temperature,
    moisture: climate.moisture,
    elevation,
  });

  return {
    seed,
    width,
    height,
    elevation,
    temperature: climate.temperature,
    moisture: climate.moisture,
    biomes: biomeMap.biomes,
  };
}

/**
 * Quick world generation with defaults
 *
 * @example
 * ```typescript
 * const world = quickWorld('seed123', 50, 50);
 * ```
 */
export function quickWorld(seed: string, width: number = 50, height: number = 50): GeneratedWorld {
  return generateWorld({ seed, width, height });
}
