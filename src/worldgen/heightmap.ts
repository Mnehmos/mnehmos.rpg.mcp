import seedrandom from 'seedrandom';
import { createNoise2D } from 'simplex-noise';

/**
 * Heightmap Generator
 *
 * Generates deterministic heightmaps using layered Perlin/Simplex noise.
 * Inspired by Azgaar's heightmap-generator.js but implemented independently.
 *
 * Reference: reference/AZGAAR_SNAPSHOT.md Section 1
 */

export interface HeightmapOptions {
  /** Seed for deterministic generation */
  seed: string;
  /** Width of heightmap grid */
  width: number;
  /** Height of heightmap grid */
  height: number;
  /** Number of octaves (noise layers) for detail */
  octaves?: number;
  /** Persistence (amplitude decay per octave) */
  persistence?: number;
  /** Lacunarity (frequency increase per octave) */
  lacunarity?: number;
  /** Land ratio target (0-1, default 0.3 for ~30% land) */
  landRatio?: number;
}

export interface Heightmap {
  width: number;
  height: number;
  /** Flat array of elevation values (0-100) */
  data: Uint8Array;
  /** Sea level threshold (typically 20) */
  seaLevel: number;
}

// Helper to convert 2D coords to 1D index
const toIndex = (x: number, y: number, width: number) => y * width + x;

/**
 * Generate a heightmap from a seed
 */
export function generateHeightmap(
  seed: string,
  width: number,
  height: number,
  options?: Partial<HeightmapOptions>
): Uint8Array {
  const opts: HeightmapOptions = {
    seed,
    width,
    height,
    octaves: options?.octaves ?? 6,
    persistence: options?.persistence ?? 0.5,
    lacunarity: options?.lacunarity ?? 2.0,
    landRatio: options?.landRatio ?? 0.3,
  };

  // Create seeded RNG
  const rng = seedrandom(seed);

  // Create noise function with seeded RNG
  const noise2D = createNoise2D(rng);

  // Generate base heightmap (Float32Array for precision during generation)
  const rawHeightmap = generateLayeredNoise(noise2D, opts);

  // Normalize to target land ratio and convert to Uint8Array (0-100)
  const normalized = normalizeHeightmap(rawHeightmap, opts.width, opts.height, opts.landRatio!);

  // Smooth to reduce abrupt jumps (2 iterations)
  // Mutates normalized array in place or returns new one
  const smoothed = smoothHeightmap(normalized, opts.width, opts.height, 2);

  return smoothed;
}

/**
 * Generate layered noise heightmap
 */
function generateLayeredNoise(
  noise2D: (x: number, y: number) => number,
  options: HeightmapOptions
): Float32Array {
  const { width, height, octaves, persistence, lacunarity } = options;
  const size = width * height;
  const heightmap = new Float32Array(size);

  let maxAmplitude = 0;

  // Accumulate octaves
  for (let octave = 0; octave < octaves!; octave++) {
    const frequency = Math.pow(lacunarity!, octave);
    const amplitude = Math.pow(persistence!, octave);
    maxAmplitude += amplitude;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Scale coordinates by frequency
        const nx = (x / width) * frequency;
        const ny = (y / height) * frequency;

        // Sample noise (-1 to 1)
        const sample = noise2D(nx, ny);

        // Accumulate with amplitude
        heightmap[toIndex(x, y, width)] += sample * amplitude;
      }
    }
  }

  // Normalize to 0-1 range
  for (let i = 0; i < size; i++) {
    // Noise is in range [-maxAmplitude, maxAmplitude]
    // Normalize to [0, 1]
    heightmap[i] = (heightmap[i] + maxAmplitude) / (2 * maxAmplitude);
  }

  return heightmap;
}

/**
 * Normalize heightmap to achieve target land ratio
 *
 * Adjusts elevation distribution so that approximately `landRatio` of cells
 * are above sea level (20).
 */
function normalizeHeightmap(
  rawHeightmap: Float32Array,
  width: number,
  height: number,
  targetLandRatio: number
): Uint8Array {
  const size = width * height;
  const SEA_LEVEL = 20;

  // Collect all elevations for sorting
  // We can use a copy of the raw array
  const elevations = new Float32Array(rawHeightmap);
  elevations.sort();

  // Find elevation that represents sea level (1 - landRatio percentile)
  const seaLevelIndex = Math.floor((1 - targetLandRatio) * (size - 1));
  const seaLevelValue = elevations[seaLevelIndex];

  // Create normalized map
  const normalized = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const rawValue = rawHeightmap[i];
    let normalizedValue;

    if (rawValue <= seaLevelValue) {
      // Below sea level
      // Map [0, seaLevelValue] → [0, SEA_LEVEL]
      // Avoid division by zero
      normalizedValue = seaLevelValue > 0 ? (rawValue / seaLevelValue) * SEA_LEVEL : 0;
    } else {
      // Above sea level
      // Map [seaLevelValue, 1] → [SEA_LEVEL, 100]
      const landRange = 100 - SEA_LEVEL;
      const rawLandRange = 1 - seaLevelValue;
      normalizedValue = SEA_LEVEL + ((rawValue - seaLevelValue) / rawLandRange) * landRange;
    }

    // Clamp and round to integer
    normalized[i] = Math.round(Math.max(0, Math.min(100, normalizedValue)));
  }

  return normalized;
}

/**
 * Add ridges/tectonic features to heightmap
 *
 * Inspired by Azgaar's "Range" primitive for mountain ranges.
 */
export function addRidges(
  heightmap: Uint8Array,
  width: number,
  height: number,
  rng: seedrandom.PRNG,
  count: number = 3
): Uint8Array {
  // Create copy
  const result = new Uint8Array(heightmap);

  for (let i = 0; i < count; i++) {
    // Random ridge line
    const startX = Math.floor(rng() * width);
    const startY = Math.floor(rng() * height);
    const angle = rng() * Math.PI * 2;

    const length = Math.floor(width * 0.3 + rng() * width * 0.4);
    const ridgeHeight = 40 + rng() * 30;
    const ridgeWidth = 3 + Math.floor(rng() * 5);

    // Draw ridge line
    for (let step = 0; step < length; step++) {
      const x = Math.floor(startX + Math.cos(angle) * step);
      const y = Math.floor(startY + Math.sin(angle) * step);

      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      // Add elevation in a radius around the line
      for (let dy = -ridgeWidth; dy <= ridgeWidth; dy++) {
        for (let dx = -ridgeWidth; dx <= ridgeWidth; dx++) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const distance = Math.sqrt(dx * dx + dy * dy);
          const falloff = Math.max(0, 1 - distance / ridgeWidth);
          const elevation = ridgeHeight * falloff;

          const idx = toIndex(nx, ny, width);
          const newElev = result[idx] + elevation;
          result[idx] = Math.min(100, newElev);
        }
      }
    }
  }

  return result;
}

/**
 * Smooth heightmap to reduce jaggedness
 *
 * Applies a simple averaging filter.
 */
export function smoothHeightmap(
  heightmap: Uint8Array,
  width: number,
  height: number,
  iterations: number = 1
): Uint8Array {
  let result = new Uint8Array(heightmap);
  // const size = width * height;

  for (let iter = 0; iter < iterations; iter++) {
    const temp = new Uint8Array(result);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        // Average with 8 neighbors
        // We can optimize this by pre-calculating offsets, but 2D loop is clear enough
        let sum = 0;

        sum += result[toIndex(x - 1, y - 1, width)];
        sum += result[toIndex(x, y - 1, width)];
        sum += result[toIndex(x + 1, y - 1, width)];

        sum += result[toIndex(x - 1, y, width)];
        sum += result[toIndex(x, y, width)];
        sum += result[toIndex(x + 1, y, width)];

        sum += result[toIndex(x - 1, y + 1, width)];
        sum += result[toIndex(x, y + 1, width)];
        sum += result[toIndex(x + 1, y + 1, width)];

        temp[toIndex(x, y, width)] = Math.round(sum / 9);
      }
    }

    result = temp;
  }

  return result;
}
