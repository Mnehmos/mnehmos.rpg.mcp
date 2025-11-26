import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../../src/worldgen/heightmap';

/**
 * Terrain Quality Gates
 *
 * These tests define quality benchmarks inspired by Azgaar's Fantasy Map Generator.
 * They serve as acceptance criteria for terrain generation algorithms.
 *
 * Reference: reference/AZGAAR_SNAPSHOT.md
 */

describe('Terrain Quality Gates', () => {
  describe('Terrain Continuity', () => {
    it('should not have abrupt elevation jumps between neighbors', () => {
      // Test seed for deterministic terrain
      const seed = 'terrain-continuity-001';

      // Generate small test heightmap (10x10 grid)
      const heightmap = generateHeightmap(seed, 10, 10);

      // Check all adjacent cells for maximum elevation delta
      const MAX_ELEVATION_DELTA = 30; // Allow up to 30 units difference (0-100 scale)


      // Helper to access 1D array as 2D
      const get = (y: number, x: number) => heightmap[y * 10 + x];

      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const current = get(y, x);

          // Check right neighbor
          if (x < 9) {
            const right = get(y, x + 1);
            const delta = Math.abs(current - right);
            expect(delta).toBeLessThanOrEqual(MAX_ELEVATION_DELTA);
          }

          // Check bottom neighbor
          if (y < 9) {
            const bottom = get(y + 1, x);
            const delta = Math.abs(current - bottom);
            expect(delta).toBeLessThanOrEqual(MAX_ELEVATION_DELTA);
          }

          // Check diagonal neighbors (for smoothness)
          if (x < 9 && y < 9) {
            const diagonal = get(y + 1, x + 1);
            const delta = Math.abs(current - diagonal);
            expect(delta).toBeLessThanOrEqual(MAX_ELEVATION_DELTA * 1.4); // Allow slightly more for diagonals
          }
        }
      }
    });

    it('should produce smooth gradients in non-mountainous regions', () => {
      const seed = 'smooth-terrain-001';
      const width = 20;
      const height = 20;
      const heightmap = generateHeightmap(seed, width, height);
      const get = (y: number, x: number) => heightmap[y * width + x];

      // Sample a central region (avoiding edges and extremes)
      for (let y = 5; y < 15; y++) {
        for (let x = 5; x < 15; x++) {
          const elevation = get(y, x);

          // Only test relatively flat areas (20-60 elevation)
          if (elevation >= 20 && elevation <= 60) {
            // Get 3x3 neighborhood
            const neighborhood = [
              get(y - 1, x - 1),
              get(y - 1, x),
              get(y - 1, x + 1),
              get(y, x - 1),
              get(y, x),
              get(y, x + 1),
              get(y + 1, x - 1),
              get(y + 1, x),
              get(y + 1, x + 1),
            ];

            // Calculate standard deviation
            const mean = neighborhood.reduce((sum, val) => sum + val, 0) / neighborhood.length;
            const variance =
              neighborhood.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
              neighborhood.length;
            const stdDev = Math.sqrt(variance);

            // In smooth regions, std dev should be relatively low
            expect(stdDev).toBeLessThan(15);
          }
        }
      }
    });

    it('should maintain consistent land-to-sea ratio', () => {
      const seed = 'land-ratio-001';
      const width = 50;
      const height = 50;
      const heightmap = generateHeightmap(seed, width, height);
      const get = (y: number, x: number) => heightmap[y * width + x];

      const SEA_LEVEL = 20; // From Azgaar's MIN_LAND_HEIGHT constant
      let landCount = 0;
      let totalCount = 0;

      for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
          totalCount++;
          if (get(y, x) >= SEA_LEVEL) {
            landCount++;
          }
        }
      }

      const landRatio = landCount / totalCount;

      // Azgaar typically generates 20-40% land
      expect(landRatio).toBeGreaterThan(0.2);
      expect(landRatio).toBeLessThan(0.5);
    });
  });

  describe('Elevation Distribution', () => {
    it('should have realistic elevation distribution', () => {
      const seed = 'elevation-dist-001';
      const width = 40;
      const height = 40;
      const heightmap = generateHeightmap(seed, width, height);
      const get = (y: number, x: number) => heightmap[y * width + x];

      // Count cells in elevation bands
      const bands = {
        deepOcean: 0, // 0-10
        shallowOcean: 0, // 10-20
        lowland: 0, // 20-40
        highland: 0, // 40-60
        mountain: 0, // 60-80
        highMountain: 0, // 80-100
      };

      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 40; x++) {
          const elevation = get(y, x);

          if (elevation < 10) bands.deepOcean++;
          else if (elevation < 20) bands.shallowOcean++;
          else if (elevation < 40) bands.lowland++;
          else if (elevation < 60) bands.highland++;
          else if (elevation < 80) bands.mountain++;
          else bands.highMountain++;
        }
      }

      const total = 40 * 40;

      // Most terrain should be ocean or lowland
      expect(bands.deepOcean + bands.shallowOcean + bands.lowland).toBeGreaterThan(total * 0.6);

      // High mountains should be rare
      expect(bands.highMountain).toBeLessThan(total * 0.1);

      // Should have some variety (not all one elevation)
      expect(Object.values(bands).filter((count) => count > 0).length).toBeGreaterThanOrEqual(4);
    });

    it('should have valid elevation range (0-100)', () => {
      const seed = 'elevation-range-001';
      const width = 30;
      const height = 30;
      const heightmap = generateHeightmap(seed, width, height);
      const get = (y: number, x: number) => heightmap[y * width + x];

      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 30; x++) {
          const elevation = get(y, x);

          expect(elevation).toBeGreaterThanOrEqual(0);
          expect(elevation).toBeLessThanOrEqual(100);
          expect(Number.isInteger(elevation)).toBe(true); // Should be integer values
        }
      }
    });
  });

  describe('Determinism', () => {
    it('should produce identical heightmaps for the same seed', () => {
      const seed = 'determinism-001';
      const width = 15;
      const height = 15;

      const heightmap1 = generateHeightmap(seed, width, height);
      const heightmap2 = generateHeightmap(seed, width, height);

      // Compare every cell
      for (let i = 0; i < width * height; i++) {
        expect(heightmap1[i]).toBe(heightmap2[i]);
      }
    });

    it('should produce different heightmaps for different seeds', () => {
      const seed1 = 'seed-alpha';
      const seed2 = 'seed-beta';
      const width = 15;
      const height = 15;

      const heightmap1 = generateHeightmap(seed1, width, height);
      const heightmap2 = generateHeightmap(seed2, width, height);

      // Count differences
      let differences = 0;
      for (let i = 0; i < width * height; i++) {
        if (heightmap1[i] !== heightmap2[i]) {
          differences++;
        }
      }

      // Should be significantly different (at least 50% different)
      expect(differences).toBeGreaterThan((15 * 15) / 2);
    });
  });
});
