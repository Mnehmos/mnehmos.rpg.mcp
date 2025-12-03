/**
 * World Generation Module
 *
 * Integrates heightmap, climate, and biome generation into a unified API.
 * Follows TDD principles with deterministic, seed-based generation.
 */

export * from './heightmap.js';
export * from './climate.js';
export * from './biome.js';
export * from './river.js';
export * from './lakes.js';
export * from './regions.js';
export * from './structures.js';

import { generateHeightmap } from './heightmap.js';
import { generateClimateMap } from './climate.js';
import { generateBiomeMap } from './biome.js';
import { generateRivers } from './river.js';
import { generateLakes, LakeSpillway } from './lakes.js';
import { generateRegions, Region } from './regions.js';
import { placeStructures, StructureLocation } from './structures.js';
import { BiomeType } from '../../schema/biome.js';

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
  /** River map (1 = river, 0 = no river) */
  rivers: Uint8Array;
  /** Region definitions */
  regions: Region[];
  /** Region ID map */
  regionMap: Int32Array;
  /** Placed structures */
  structures: StructureLocation[];
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
  /** Number of regions (default 10) */
  numRegions?: number;
  /** Number of cities (default 5) */
  numCities?: number;
  /** Number of towns (default 10) */
  numTowns?: number;
  /** Number of dungeons (default 5) */
  numDungeons?: number;
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
  const {
    seed, width, height, landRatio, octaves,
    numRegions, numCities, numTowns, numDungeons
  } = options;

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

  // Step 4: Generate Rivers
  // Convert moisture to precipitation (Float32Array)
  const precipitation = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) precipitation[i] = climate.moisture[i];

  const riverSystem = generateRivers({
    seed,
    width,
    height,
    elevation,
    precipitation
  });

  // Create raster river map from vector rivers
  const riverMap = new Uint8Array(width * height).fill(0);
  for (const river of riverSystem.rivers) {
    for (const p of river.path) {
      riverMap[p.y * width + p.x] = 1;
    }
  }

  // Step 4b: Generate Lakes (fills terrain depressions)
  const lakeResult = generateLakes({
    width,
    height,
    elevation,
    rivers: riverMap,
  });

  // Update biomes for lake tiles
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (lakeResult.lakeMap[idx] === 1) {
        biomeMap.biomes[y][x] = BiomeType.LAKE;
        // Clear river flag for lake tiles (lake replaces river)
        riverMap[idx] = 0;
      }
    }
  }

  // Step 4c: Trace rivers from lake spillways (lakes as river sources)
  const SEA_LEVEL = 20;
  for (const spillway of lakeResult.spillways) {
    traceSpillwayRiver(
      spillway,
      elevation,
      riverMap,
      lakeResult.lakeMap,
      SEA_LEVEL,
      width,
      height
    );
  }

  // Step 5: Generate Regions
  const regionData = generateRegions({
    seed,
    width,
    height,
    elevation,
    biomes: biomeMap.biomes,
    numRegions
  });

  // Step 6: Place Structures
  const structures = placeStructures({
    seed,
    width,
    height,
    elevation,
    biomes: biomeMap.biomes,
    riverMap,
    numCities,
    numTowns,
    numDungeons
  });

  // Step 7: Normalize elevations for display (ocean=0, land=1-100)
  for (let i = 0; i < width * height; i++) {
    if (elevation[i] < SEA_LEVEL) {
      elevation[i] = 0; // Ocean at sea level surface
    } else {
      // Remap land from [20, 100] to [1, 100]
      const landElev = elevation[i] - SEA_LEVEL; // 0-80 range
      elevation[i] = Math.round(1 + (landElev / 80) * 99); // 1-100 range
    }
  }

  return {
    seed,
    width,
    height,
    elevation,
    temperature: climate.temperature,
    moisture: climate.moisture,
    biomes: biomeMap.biomes,
    rivers: riverMap,
    regions: regionData.regions,
    regionMap: regionData.regionMap,
    structures
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

/**
 * Trace a river from a lake spillway downhill to ocean or existing river
 */
function traceSpillwayRiver(
  spillway: LakeSpillway,
  elevation: Uint8Array,
  riverMap: Uint8Array,
  lakeMap: Uint8Array,
  seaLevel: number,
  width: number,
  height: number
): void {
  const neighbors = [
    { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
    { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
  ];

  let x = spillway.outflowX;
  let y = spillway.outflowY;
  const maxSteps = width * height;
  const visited = new Set<number>();

  for (let step = 0; step < maxSteps; step++) {
    const idx = y * width + x;

    // Stop if we hit ocean
    if (elevation[idx] < seaLevel) break;

    // Stop if we hit an existing river (we've connected)
    if (riverMap[idx] === 1) break;

    // Stop if we hit a lake (shouldn't happen but safety check)
    if (lakeMap[idx] === 1) break;

    // Prevent infinite loops
    if (visited.has(idx)) break;
    visited.add(idx);

    // Mark this tile as river
    riverMap[idx] = 1;

    // Find lowest neighbor to flow to
    const currentElev = elevation[idx];
    let bestX = -1;
    let bestY = -1;
    let lowestElev = currentElev;

    for (const { dx, dy } of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nIdx = ny * width + nx;
      const nElev = elevation[nIdx];

      // Skip lake tiles
      if (lakeMap[nIdx] === 1) continue;

      // Prefer strictly lower, but allow equal for plateaus
      if (nElev < lowestElev || (nElev === lowestElev && bestX === -1)) {
        lowestElev = nElev;
        bestX = nx;
        bestY = ny;
      }
    }

    // If no lower neighbor found, we're stuck (endorheic basin)
    if (bestX === -1) break;

    x = bestX;
    y = bestY;
  }
}
