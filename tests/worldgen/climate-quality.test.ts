import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../../src/worldgen/heightmap';
import { generateClimateMap, ClimateMap } from '../../src/worldgen/climate';

/**
 * Climate Quality Gates
 *
 * Tests for temperature and moisture distribution.
 * Based on Azgaar's climate system (reference/AZGAAR_SNAPSHOT.md Section 3).
 *
 * Temperature: Latitude-based gradient (equator hot → poles cold)
 * Moisture: Ocean proximity + precipitation patterns
 */


describe('Climate Quality Gates', () => {
  describe('Temperature Gradient by Latitude', () => {

    it('should have warmer temperatures at equator (middle)', () => {
      const seed = 'temp-latitude-001';
      const width = 40;
      const height = 60;
      const climateMap = generateTestClimateMap(seed, width, height);

      // Sample temperatures at different latitudes
      const topRow: number[] = [];
      const middleRow: number[] = [];
      const bottomRow: number[] = [];

      for (let x = 0; x < 40; x++) {
        topRow.push(climateMap.temperature[5 * width + x]); // Near north pole
        middleRow.push(climateMap.temperature[30 * width + x]); // Equator
        bottomRow.push(climateMap.temperature[55 * width + x]); // Near south pole
      }

      const avgTop = topRow.reduce((sum, t) => sum + t, 0) / topRow.length;
      const avgMiddle = middleRow.reduce((sum, t) => sum + t, 0) / middleRow.length;
      const avgBottom = bottomRow.reduce((sum, t) => sum + t, 0) / bottomRow.length;

      // Equator should be warmest
      expect(avgMiddle).toBeGreaterThan(avgTop);
      expect(avgMiddle).toBeGreaterThan(avgBottom);

      // Poles should be cold (below 10°C on average)
      expect(avgTop).toBeLessThan(10);
      expect(avgBottom).toBeLessThan(10);

      // Equator should be warm (above 20°C on average)
      expect(avgMiddle).toBeGreaterThan(20);
    });

    it('should have smooth temperature gradient from equator to poles', () => {
      const seed = 'temp-gradient-smooth-001';
      const width = 30;
      const height = 60;
      const climateMap = generateTestClimateMap(seed, width, height);

      // Sample center column (avoid edge effects)
      const centerX = 15;
      const temperatures: number[] = [];

      for (let y = 0; y < 60; y++) {
        temperatures.push(climateMap.temperature[y * width + centerX]);
      }

      // Check that temperature changes gradually (no huge jumps)
      for (let i = 0; i < temperatures.length - 1; i++) {
        const delta = Math.abs(temperatures[i + 1] - temperatures[i]);
        expect(delta).toBeLessThan(5); // Max 5°C change between adjacent cells
      }
    });

    it('should have symmetric temperature distribution (north/south)', () => {
      const seed = 'temp-symmetry-001';
      const width = 40;
      const height = 60;
      const climateMap = generateTestClimateMap(seed, width, height);

      // Compare north and south hemispheres
      const northTemps: number[] = [];
      const southTemps: number[] = [];

      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 40; x++) {
          northTemps.push(climateMap.temperature[y * width + x]);
          southTemps.push(climateMap.temperature[(59 - y) * width + x]);
        }
      }

      const avgNorth = northTemps.reduce((sum, t) => sum + t, 0) / northTemps.length;
      const avgSouth = southTemps.reduce((sum, t) => sum + t, 0) / southTemps.length;

      // Hemispheres should have similar average temperatures (within 3°C)
      expect(Math.abs(avgNorth - avgSouth)).toBeLessThan(3);
    });

    it('should decrease temperature with elevation', () => {
      const seed = 'temp-elevation-001';
      const width = 40;
      const height = 40;
      const climateMap = generateTestClimateMap(seed, width, height);

      // Group cells by elevation
      const lowlandTemps: number[] = [];
      const highlandTemps: number[] = [];

      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 40; x++) {
          const idx = y * width + x;
          const elevation = climateMap.elevation[idx];
          const temp = climateMap.temperature[idx];

          if (elevation >= 20 && elevation < 40) {
            lowlandTemps.push(temp);
          } else if (elevation >= 70 && elevation <= 100) {
            highlandTemps.push(temp);
          }
        }
      }

      // Mountains should be colder than lowlands
      if (lowlandTemps.length > 0 && highlandTemps.length > 0) {
        const avgLowland = lowlandTemps.reduce((sum, t) => sum + t, 0) / lowlandTemps.length;
        const avgHighland = highlandTemps.reduce((sum, t) => sum + t, 0) / highlandTemps.length;

        expect(avgHighland).toBeLessThan(avgLowland);
      }
    });

    it('should have valid temperature range (-20 to 40°C)', () => {
      const seed = 'temp-range-001';
      const width = 50;
      const height = 50;
      const climateMap = generateTestClimateMap(seed, width, height);

      for (let i = 0; i < width * height; i++) {
        const temp = climateMap.temperature[i];
        expect(temp).toBeGreaterThanOrEqual(-20);
        expect(temp).toBeLessThanOrEqual(40);
      }
    });
  });

  describe('Moisture Distribution Consistency', () => {
    it('should have higher moisture near oceans', () => {
      const seed = 'moisture-ocean-001';
      const width = 40;
      const height = 40;
      const climateMap = generateTestClimateMap(seed, width, height);

      const SEA_LEVEL = 20;
      const coastalMoisture: number[] = [];
      const inlandMoisture: number[] = [];

      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 40; x++) {
          const idx = y * width + x;
          const elevation = climateMap.elevation[idx];
          const moisture = climateMap.moisture[idx];

          // Check if adjacent to ocean
          let isCoastal = false;
          if (elevation >= SEA_LEVEL) {
            // Land cell - check neighbors
            const neighbors = [
              { x: x - 1, y },
              { x: x + 1, y },
              { x, y: y - 1 },
              { x, y: y + 1 },
            ];

            for (const n of neighbors) {
              if (n.x >= 0 && n.x < 40 && n.y >= 0 && n.y < 40) {
                if (climateMap.elevation[n.y * width + n.x] < SEA_LEVEL) {
                  isCoastal = true;
                  break;
                }
              }
            }

            if (isCoastal) {
              coastalMoisture.push(moisture);
            } else {
              // Check if far inland (at least 3 cells from ocean)
              let oceanDistance = 0;
              for (let radius = 1; radius <= 3; radius++) {
                let hasOcean = false;
                for (let dy = -radius; dy <= radius; dy++) {
                  for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < 40 && ny >= 0 && ny < 40) {
                      if (climateMap.elevation[ny * width + nx] < SEA_LEVEL) {
                        hasOcean = true;
                        break;
                      }
                    }
                  }
                  if (hasOcean) break;
                }
                if (!hasOcean) oceanDistance = radius;
                else break;
              }

              if (oceanDistance >= 3) {
                inlandMoisture.push(moisture);
              }
            }
          }
        }
      }

      // Coastal areas should have higher moisture than inland
      if (coastalMoisture.length > 0 && inlandMoisture.length > 0) {
        const avgCoastal =
          coastalMoisture.reduce((sum, m) => sum + m, 0) / coastalMoisture.length;
        const avgInland = inlandMoisture.reduce((sum, m) => sum + m, 0) / inlandMoisture.length;

        expect(avgCoastal).toBeGreaterThan(avgInland);
      }
    });

    it('should have valid moisture range (0-100%)', () => {
      const seed = 'moisture-range-001';
      const width = 40;
      const height = 40;
      const climateMap = generateTestClimateMap(seed, width, height);

      for (let i = 0; i < width * height; i++) {
        const moisture = climateMap.moisture[i];
        expect(moisture).toBeGreaterThanOrEqual(0);
        expect(moisture).toBeLessThanOrEqual(100);
      }
    });

    it('should have smooth moisture transitions', () => {
      const seed = 'moisture-smooth-001';
      const width = 30;
      const height = 30;
      const climateMap = generateTestClimateMap(seed, width, height);

      // Check for abrupt moisture changes
      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 30; x++) {
          const current = climateMap.moisture[y * width + x];

          // Check right neighbor
          if (x < 29) {
            const neighbor = climateMap.moisture[y * width + x + 1];
            const delta = Math.abs(current - neighbor);
            expect(delta).toBeLessThan(30); // Max 30% change between neighbors
          }

          // Check bottom neighbor
          if (y < 29) {
            const neighbor = climateMap.moisture[(y + 1) * width + x];
            const delta = Math.abs(current - neighbor);
            expect(delta).toBeLessThan(30);
          }
        }
      }
    });

    it('should have diverse moisture levels', () => {
      const seed = 'moisture-diversity-001';
      const width = 50;
      const height = 50;
      const climateMap = generateTestClimateMap(seed, width, height);

      // Count cells in moisture bands
      const bands = {
        arid: 0, // 0-20%
        dry: 0, // 20-40%
        moderate: 0, // 40-60%
        moist: 0, // 60-80%
        wet: 0, // 80-100%
      };

      for (let i = 0; i < width * height; i++) {
        const moisture = climateMap.moisture[i];

        if (moisture < 20) bands.arid++;
        else if (moisture < 40) bands.dry++;
        else if (moisture < 60) bands.moderate++;
        else if (moisture < 80) bands.moist++;
        else bands.wet++;
      }

      // Should have variety (at least 3 different moisture bands)
      const bandCount = Object.values(bands).filter((count) => count > 0).length;
      expect(bandCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Determinism', () => {
    it('should produce identical climate for the same seed', () => {
      const seed = 'climate-determinism-001';
      const width = 20;
      const height = 20;

      const climate1 = generateTestClimateMap(seed, width, height);
      const climate2 = generateTestClimateMap(seed, width, height);

      // Compare temperature
      for (let i = 0; i < width * height; i++) {
        expect(climate1.temperature[i]).toBe(climate2.temperature[i]);
        expect(climate1.moisture[i]).toBe(climate2.moisture[i]);
      }
    });

    it('should produce different climate for different seeds', () => {
      const seed1 = 'climate-alpha';
      const seed2 = 'climate-beta';
      const width = 20;
      const height = 20;

      const climate1 = generateTestClimateMap(seed1, width, height);
      const climate2 = generateTestClimateMap(seed2, width, height);

      // Count differences
      let tempDifferences = 0;
      let moistureDifferences = 0;

      for (let i = 0; i < width * height; i++) {
        if (climate1.temperature[i] !== climate2.temperature[i]) {
          tempDifferences++;
        }
        if (climate1.moisture[i] !== climate2.moisture[i]) {
          moistureDifferences++;
        }
      }

      // Should be significantly different (at least 50%)
      expect(tempDifferences).toBeGreaterThan((20 * 20) / 2);
      expect(moistureDifferences).toBeGreaterThan((20 * 20) / 2);
    });
  });

});

/**
 * Helper to generate climate map with heightmap
 */
function generateTestClimateMap(seed: string, width: number, height: number): ClimateMap {
  const heightmap = generateHeightmap(seed, width, height);
  return generateClimateMap(seed, width, height, heightmap);
}
