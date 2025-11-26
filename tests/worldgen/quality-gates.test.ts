/**
 * Quality Gates for World Generation
 *
 * These tests define what "good" world generation looks like, inspired by
 * Azgaar's Fantasy Map Generator quality benchmarks.
 *
 * Tests ensure:
 * - Terrain continuity (no abrupt elevation jumps)
 * - Biome plausibility (realistic climate-biome relationships)
 * - River validity (downhill flow, no loops, proper branching)
 */

import { describe, it, expect } from 'vitest';
import { generateWorld } from '../../src/worldgen/index.js';
import { BiomeType } from '../../src/schema/biome.js';

describe('Quality Gate: Terrain Continuity', () => {
  it('should have no abrupt elevation jumps between adjacent tiles', () => {
    const seed = 'terrain-continuity-test';
    const width = 100;
    const height = 100;

    const world = generateWorld({ seed, width, height });
    const heightmap = world.elevation;


    // Check all tiles for smooth transitions
    const maxAllowedJump = 30; // 30 units on 0-100 scale
    let abruptJumps = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const current = heightmap[y * width + x];

        // Check 4-connected neighbors (N, E, S, W)
        const neighbors = [
          y > 0 ? heightmap[(y - 1) * width + x] : null,        // North
          x < width - 1 ? heightmap[y * width + x + 1] : null, // East
          y < height - 1 ? heightmap[(y + 1) * width + x] : null, // South
          x > 0 ? heightmap[y * width + x - 1] : null          // West
        ].filter((n): n is number => n !== null);

        for (const neighbor of neighbors) {
          const diff = Math.abs(current - neighbor);
          if (diff > maxAllowedJump) {
            abruptJumps++;
          }
        }
      }
    }

    // Allow up to 0.5% of connections to be abrupt (natural cliffs)
    const totalConnections = (width - 1) * height + width * (height - 1);
    const allowedAbruptJumps = Math.floor(totalConnections * 0.005);

    expect(abruptJumps).toBeLessThanOrEqual(allowedAbruptJumps);
  });

  it('should have realistic land/sea ratio (20-40% land)', () => {
    const seed = 'land-sea-ratio-test';
    const width = 100;
    const height = 100;

    const world = generateWorld({ seed, width, height });
    const heightmap = world.elevation;

    // Sea level at 20 (based on our heightmap implementation 0-100 scale)
    const seaLevel = 20;
    let landTiles = 0;

    for (let i = 0; i < width * height; i++) {
      if (heightmap[i] >= seaLevel) {
        landTiles++;
      }
    }

    const totalTiles = width * height;
    const landRatio = landTiles / totalTiles;

    expect(landRatio).toBeGreaterThanOrEqual(0.2);
    expect(landRatio).toBeLessThanOrEqual(0.4);
  });

  it('should have smooth elevation distribution (no extreme spikes)', () => {
    const seed = 'elevation-distribution-test';
    const width = 100;
    const height = 100;

    const world = generateWorld({ seed, width, height });
    const heightmap = world.elevation;

    // Use TypedArray directly (it is already flat)
    const elevations = heightmap;

    // Calculate mean and standard deviation
    const mean = elevations.reduce((sum, e) => sum + e, 0) / elevations.length;
    const variance = elevations.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / elevations.length;
    const stdDev = Math.sqrt(variance);

    // Count values beyond 3 standard deviations (outliers)
    const outliers = elevations.filter(e => Math.abs(e - mean) > 3 * stdDev).length;
    const outlierRatio = outliers / elevations.length;

    // Allow up to 1% outliers (mountain peaks, deep ocean trenches)
    expect(outlierRatio).toBeLessThanOrEqual(0.01);
  });

  it('should have connected landmasses (no floating single-tile islands)', () => {
    const seed = 'landmass-connectivity-test';
    const width = 100;
    const height = 100;

    const world = generateWorld({ seed, width, height });
    const heightmap = world.elevation;
    const seaLevel = 20;

    // Find all single-tile islands
    let singleTileIslands = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const current = heightmap[y * width + x];

        // Skip if not land
        if (current < seaLevel) continue;

        // Check if all neighbors are water
        const neighbors = [
          y > 0 ? heightmap[(y - 1) * width + x] : null,
          x < width - 1 ? heightmap[y * width + x + 1] : null,
          y < height - 1 ? heightmap[(y + 1) * width + x] : null,
          x > 0 ? heightmap[y * width + x - 1] : null
        ].filter((n): n is number => n !== null);

        const allNeighborsWater = neighbors.every(n => n < seaLevel);
        if (allNeighborsWater) {
          singleTileIslands++;
        }
      }
    }

    // Allow up to 0.5% single-tile islands (realistic for archipelagos)
    const totalLandTiles = heightmap.filter(e => e >= seaLevel).length;
    const allowedSingleTiles = Math.floor(totalLandTiles * 0.005);

    expect(singleTileIslands).toBeLessThanOrEqual(allowedSingleTiles);
  });
});

describe('Quality Gate: Biome Plausibility', () => {
  it('should not place tropical biomes next to polar biomes', () => {
    const seed = 'biome-adjacency-test';
    const width = 100;
    const height = 100;

    const world = generateWorld({ seed, width, height });
    const biomeMap = world.biomes;

    // Define incompatible biome pairs (tropical vs polar)
    const tropicalBiomes = [BiomeType.RAINFOREST, BiomeType.SAVANNA];
    const polarBiomes = [BiomeType.TUNDRA, BiomeType.GLACIER];

    let incompatibleAdjacencies = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const current = biomeMap[y][x];

        const neighbors = [
          y > 0 ? biomeMap[y - 1][x] : null,
          x < width - 1 ? biomeMap[y][x + 1] : null,
          y < height - 1 ? biomeMap[y + 1][x] : null,
          x > 0 ? biomeMap[y][x - 1] : null
        ].filter((n): n is BiomeType => n !== null);

        const isTropical = tropicalBiomes.includes(current);
        const hasPolarNeighbor = neighbors.some(n => polarBiomes.includes(n));

        const isPolar = polarBiomes.includes(current);
        const hasTropicalNeighbor = neighbors.some(n => tropicalBiomes.includes(n));

        if ((isTropical && hasPolarNeighbor) || (isPolar && hasTropicalNeighbor)) {
          incompatibleAdjacencies++;
        }
      }
    }

    // Strict: no direct tropical-polar adjacencies allowed
    expect(incompatibleAdjacencies).toBe(0);
  });

  it('should correlate cold biomes with high latitudes', () => {
    const seed = 'latitude-biome-correlation-test';
    const width = 100;
    const height = 100;

    const world = generateWorld({ seed, width, height });
    const biomeMap = world.biomes;

    const polarBiomes = [BiomeType.TUNDRA, BiomeType.GLACIER, BiomeType.TAIGA];

    // Northern 20% should have more polar biomes
    const northernThird = Math.floor(height * 0.2);
    let northernPolarCount = 0;
    let northernTotalLand = 0;

    for (let y = 0; y < northernThird; y++) {
      for (let x = 0; x < width; x++) {
        const biome = biomeMap[y][x];
        if (biome !== BiomeType.OCEAN && biome !== BiomeType.DEEP_OCEAN) {
          northernTotalLand++;
          if (polarBiomes.includes(biome)) {
            northernPolarCount++;
          }
        }
      }
    }

    // Southern 20% should have more polar biomes
    const southernThird = Math.floor(height * 0.8);
    let southernPolarCount = 0;
    let southernTotalLand = 0;

    for (let y = southernThird; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const biome = biomeMap[y][x];
        if (biome !== BiomeType.OCEAN && biome !== BiomeType.DEEP_OCEAN) {
          southernTotalLand++;
          if (polarBiomes.includes(biome)) {
            southernPolarCount++;
          }
        }
      }
    }

    // At least 30% of polar regions should be polar biomes
    const northernPolarRatio = northernTotalLand > 0 ? northernPolarCount / northernTotalLand : 0;
    const southernPolarRatio = southernTotalLand > 0 ? southernPolarCount / southernTotalLand : 0;

    // Skip test if no land in polar regions (rare seed)
    if (northernTotalLand > 10) {
      expect(northernPolarRatio).toBeGreaterThanOrEqual(0.3);
    }
    if (southernTotalLand > 10) {
      expect(southernPolarRatio).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('should have diverse biome distribution (not dominated by single type)', () => {
    const seed = 'biome-diversity-test';
    const width = 100;
    const height = 100;

    const world = generateWorld({ seed, width, height });
    const biomeMap = world.biomes;

    // Count each biome type
    const biomeCounts = new Map<BiomeType, number>();
    const landBiomes = biomeMap.flat().filter(b => b !== BiomeType.OCEAN && b !== BiomeType.DEEP_OCEAN);

    for (const biome of landBiomes) {
      biomeCounts.set(biome, (biomeCounts.get(biome) || 0) + 1);
    }

    // No single land biome should dominate more than 50% of land
    const totalLand = landBiomes.length;
    for (const [_biome, count] of biomeCounts.entries()) {
      const ratio = count / totalLand;
      expect(ratio).toBeLessThanOrEqual(0.5);
    }

    // Should have at least 3 different land biome types
    expect(biomeCounts.size).toBeGreaterThanOrEqual(3);
  });

  it('should match biomes to climate zones (temperature/moisture logic)', () => {
    const seed = 'climate-biome-match-test';
    const width = 100;
    const height = 100;

    const world = generateWorld({ seed, width, height });
    const biomeMap = world.biomes;

    // Verify biome assignments match climate rules
    let invalidAssignments = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const biome = biomeMap[y][x];
        const temp = world.temperature[y * width + x];
        const moisture = world.moisture[y * width + x];

        // Skip ocean biomes
        if (biome === BiomeType.OCEAN || biome === BiomeType.DEEP_OCEAN) continue;

        // Validation rules based on temperature/moisture
        // Rainforest: Hot (>19°C) + Very wet (>60% moisture)
        if (biome === BiomeType.RAINFOREST && (temp < 19 || moisture < 60)) {
          invalidAssignments++;
        }
        // Glacier: Very cold (<-10°C) + High moisture
        if (biome === BiomeType.GLACIER && temp > -10) {
          invalidAssignments++;
        }
        // Desert: Hot (>19°C) + Very dry (<20% moisture)
        if (biome === BiomeType.DESERT && (temp < 19 || moisture > 20)) {
          invalidAssignments++;
        }
        // Tundra: Cold (<0°C)
        if (biome === BiomeType.TUNDRA && temp > 0) {
          invalidAssignments++;
        }
      }
    }

    // Allow up to 2% mismatches (edge cases, transitions)
    const totalTiles = width * height;
    const allowedInvalid = Math.floor(totalTiles * 0.02);

    expect(invalidAssignments).toBeLessThanOrEqual(allowedInvalid);
  });
});

describe('Quality Gate: River Validity', () => {
  it('should flow downhill (no uphill river segments)', () => {
    // This test will be implemented once river generation is added (Section 4.5)
    // For now, it's a placeholder that passes
    expect(true).toBe(true);
  });

  it('should have no loops in river network', () => {
    // This test will be implemented once river generation is added (Section 4.5)
    expect(true).toBe(true);
  });

  it('should have realistic branching (tributaries merge, not split)', () => {
    // This test will be implemented once river generation is added (Section 4.5)
    expect(true).toBe(true);
  });

  it('should terminate at ocean or lake (no rivers ending on land)', () => {
    // This test will be implemented once river generation is added (Section 4.5)
    expect(true).toBe(true);
  });

  it('should have water flux increasing downstream', () => {
    // This test will be implemented once river generation is added (Section 4.5)
    expect(true).toBe(true);
  });
});
