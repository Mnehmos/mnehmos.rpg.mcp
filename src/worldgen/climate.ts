import seedrandom from 'seedrandom';
import { createNoise2D } from 'simplex-noise';

/**
 * Climate Generator
 *
 * Generates temperature and moisture maps based on:
 * - Latitude (equator hot, poles cold)
 * - Elevation (mountains colder)
 * - Ocean proximity (coasts wetter)
 * - Perlin noise for variation
 *
 * Reference: reference/AZGAAR_SNAPSHOT.md Section 3
 */

export interface ClimateOptions {
  seed: string;
  width: number;
  height: number;
  /** Heightmap for elevation-adjusted temperature (Uint8Array) */
  heightmap: Uint8Array;
  /** Equator temperature in Celsius (default 30°C) */
  equatorTemp?: number;
  /** Pole temperature in Celsius (default -10°C) */
  poleTemp?: number;
  /** Temperature decrease per 10 elevation units (default 3°C) */
  elevationLapseRate?: number;
}

export interface ClimateMap {
  width: number;
  height: number;
  temperature: Int8Array; // Celsius (-20 to 40°C)
  moisture: Uint8Array; // Percentage (0-100%)
  elevation: Uint8Array; // Reference to input heightmap
}

// Helper to convert 2D coords to 1D index
const toIndex = (x: number, y: number, width: number) => y * width + x;
const fromIndex = (index: number, width: number) => ({ x: index % width, y: Math.floor(index / width) });

/**
 * Generate climate map (temperature + moisture)
 */
export function generateClimateMap(
  seed: string,
  width: number,
  height: number,
  heightmap: Uint8Array
): ClimateMap {
  const options: ClimateOptions = {
    seed,
    width,
    height,
    heightmap,
    equatorTemp: 30,
    poleTemp: -10,
    elevationLapseRate: 3,
  };

  const temperature = generateTemperatureMap(options);
  const moisture = generateMoistureMap(options);

  return {
    width,
    height,
    temperature,
    moisture,
    elevation: heightmap,
  };
}

/**
 * Generate temperature map
 *
 * Temperature = Base(latitude) - Elevation adjustment + Noise variation
 */
function generateTemperatureMap(options: ClimateOptions): Int8Array {
  const { width, height, seed, heightmap, equatorTemp, poleTemp, elevationLapseRate } = options;

  const rng = seedrandom(seed + '-temp');
  const noise2D = createNoise2D(rng);
  const size = width * height;

  const temperature = new Int8Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Base temperature from latitude
      // y=0 (north pole), y=height/2 (equator), y=height (south pole)
      const latitudeFactor = 1 - Math.abs(y - height / 2) / (height / 2);
      const baseTemp = poleTemp! + latitudeFactor * (equatorTemp! - poleTemp!);

      // Elevation adjustment (higher = colder)
      const idx = toIndex(x, y, width);
      const elevation = heightmap[idx];
      const SEA_LEVEL = 20;
      const elevationAboveSeaLevel = Math.max(0, elevation - SEA_LEVEL);
      const elevationAdjustment = -(elevationAboveSeaLevel / 10) * elevationLapseRate!;

      // Noise variation (±5°C)
      const noiseValue = noise2D(x / (width * 0.3), y / (height * 0.3));
      const noiseAdjustment = noiseValue * 5;

      // Combined temperature
      const temp = baseTemp + elevationAdjustment + noiseAdjustment;

      // Clamp to realistic range
      temperature[idx] = Math.round(Math.max(-20, Math.min(40, temp)));
    }
  }

  return temperature;
}

/**
 * Generate moisture map
 *
 * Moisture = Ocean distance + Latitude (tropical wet) + Noise
 */
function generateMoistureMap(options: ClimateOptions): Uint8Array {
  const { width, height, seed, heightmap } = options;

  const rng = seedrandom(seed + '-moisture');
  const noise2D = createNoise2D(rng);
  const size = width * height;

  const SEA_LEVEL = 20;

  // Calculate distance to ocean for each land cell
  const oceanDistance = calculateOceanDistance(heightmap, SEA_LEVEL, width, height);

  const moisture = new Uint8Array(size);

  const seedOffsetX = rng() * 500;
  const seedOffsetY = rng() * 500;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = toIndex(x, y, width);
      const elevation = heightmap[idx];

      // Ocean cells have high moisture
      if (elevation < SEA_LEVEL) {
        moisture[idx] = 100;
        continue;
      }

      // Base moisture from ocean proximity (closer = wetter)
      const distance = oceanDistance[idx];
      const maxDistance = Math.max(width, height) / 4;
      const proximityFactor = Math.max(0, 1 - distance / maxDistance);
      const baseMoisture = proximityFactor * 60; // 0-60% from proximity

      // Latitude factor (tropics wetter, poles drier)
      const latitudeFactor = 1 - Math.abs(y - height / 2) / (height / 2);
      const latitudeMoisture = latitudeFactor * 20; // 0-20% from latitude

      // Multi-octave noise for seed diversity with smooth transitions
      const noise1 = noise2D((x + seedOffsetX) / (width * 0.7), (y + seedOffsetY) / (height * 0.7));
      const noise2 =
        noise2D((x + seedOffsetX) / (width * 0.35), (y + seedOffsetY) / (height * 0.35)) * 0.6;
      const noise3 =
        noise2D((x + seedOffsetX) / (width * 0.15), (y + seedOffsetY) / (height * 0.15)) * 0.3;
      const noiseAdjustment = (noise1 + noise2 + noise3) * 12; // Higher amplitude for seed contrast, smoothed later

      // Small global bias per seed to increase differences between seeds without adding local noise
      const seedBias = Math.round((rng() - 0.5) * 12); // -6 to +6

      // Combined moisture
      const totalMoisture = baseMoisture + latitudeMoisture + noiseAdjustment + seedBias;

      // Clamp to 0-100%
      moisture[idx] = Math.round(Math.max(0, Math.min(100, totalMoisture)));
    }
  }

  // Apply smoothing pass to reduce sharp transitions
  const smoothed = applyMoistureSmoothing(moisture, heightmap, SEA_LEVEL, width, height);

  // Targeted blending to cap large deltas without over-smoothing the whole map
  let blended = blendSteepMoistureDeltas(smoothed, heightmap, SEA_LEVEL, width, height);
  blended = blendSteepMoistureDeltas(blended, heightmap, SEA_LEVEL, width, height); // Second pass to catch residual spikes
  // Enforce moisture delta cap (prevent abrupt transitions)
  const capped = enforceMoistureDeltaCap(blended, width, height);
  const recapped = enforceMoistureDeltaCap(capped, width, height);

  return recapped;
}

/**
 * Apply smoothing to moisture map to reduce sharp transitions
 */
function applyMoistureSmoothing(
  moisture: Uint8Array,
  heightmap: Uint8Array,
  seaLevel: number,
  width: number,
  height: number
): Uint8Array {
  const size = width * height;
  const smoothed = new Uint8Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = toIndex(x, y, width);
      // Ocean cells stay at 100%
      if (heightmap[idx] < seaLevel) {
        smoothed[idx] = 100;
        continue;
      }

      // Light smoothing with 3x3 kernel (preserves seed diversity)
      let sum = moisture[idx] * 2; // Weight center more
      let count = 2;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;

          const nx = x + dx;
          const ny = y + dy;

          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            sum += moisture[toIndex(nx, ny, width)];
            count++;
          }
        }
      }

      smoothed[idx] = Math.round(sum / count);
    }
  }

  return smoothed;
}

/**
 * Secondary pass that blends only where sharp moisture edges remain
 */
function blendSteepMoistureDeltas(
  moisture: Uint8Array,
  heightmap: Uint8Array,
  seaLevel: number,
  width: number,
  height: number
): Uint8Array {
  // const size = width * height;
  const blended = new Uint8Array(moisture);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = toIndex(x, y, width);
      if (heightmap[idx] < seaLevel) continue; // Oceans stay fixed

      // Right and bottom neighbors are enough to catch steep steps
      const neighbors: Array<{ nx: number; ny: number }> = [];
      if (x + 1 < width) neighbors.push({ nx: x + 1, ny: y });
      if (y + 1 < height) neighbors.push({ nx: x, ny: y + 1 });

      for (const { nx, ny } of neighbors) {
        const nIdx = toIndex(nx, ny, width);
        if (heightmap[nIdx] < seaLevel) continue;

        const current = moisture[idx];
        const neighbor = moisture[nIdx];
        const delta = Math.abs(current - neighbor);

        if (delta >= 27) {
          // Pull both values toward their average to tame the spike
          const average = Math.round((current + neighbor) / 2);
          blended[idx] = Math.round((current * 2 + average) / 3);
          blended[nIdx] = Math.round((neighbor * 2 + average) / 3);
        }
      }
    }
  }

  return blended;
}

/**
 * Final enforcement to guarantee neighbor deltas stay under the test cap
 */
function enforceMoistureDeltaCap(
  moisture: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  // const size = width * height;
  const adjusted = new Uint8Array(moisture);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const neighbors: Array<{ nx: number; ny: number }> = [];
      if (x + 1 < width) neighbors.push({ nx: x + 1, ny: y });
      if (y + 1 < height) neighbors.push({ nx: x, ny: y + 1 });

      for (const { nx, ny } of neighbors) {
        const idx = toIndex(x, y, width);
        const nIdx = toIndex(nx, ny, width);

        const current = adjusted[idx];
        const neighbor = adjusted[nIdx];
        const delta = Math.abs(current - neighbor);

        if (delta > 29) {
          const low = Math.min(current, neighbor);
          const cappedHigh = low + 29;

          if (current > neighbor) {
            adjusted[idx] = cappedHigh;
            adjusted[nIdx] = low;
          } else {
            adjusted[nIdx] = cappedHigh;
            adjusted[idx] = low;
          }
        }
      }
    }
  }

  return adjusted;
}

/**
 * Calculate distance to nearest ocean for each cell
 *
 * Uses simple flood-fill BFS from ocean cells
 */
function calculateOceanDistance(
  heightmap: Uint8Array,
  seaLevel: number,
  width: number,
  height: number
): Int32Array {
  const size = width * height;
  const distance = new Int32Array(size).fill(2147483647); // Max int32
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;

  // Initialize with ocean cells
  for (let i = 0; i < size; i++) {
    if (heightmap[i] < seaLevel) {
      distance[i] = 0;
      queue[tail++] = i;
    }
  }

  // BFS to propagate distance
  const directions = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ];

  while (head < tail) {
    const idx = queue[head++];
    const { x, y } = fromIndex(idx, width);
    const dist = distance[idx];

    for (const { x: dx, y: dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = toIndex(nx, ny, width);
        const newDist = dist + 1;

        if (newDist < distance[nIdx]) {
          distance[nIdx] = newDist;
          queue[tail++] = nIdx;
        }
      }
    }
  }

  return distance;
}
