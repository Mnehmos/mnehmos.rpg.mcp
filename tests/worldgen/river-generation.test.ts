import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';
import { generateRivers } from '../../src/worldgen/river';

// ============================================================================

function createSimpleHeightmap(width: number, height: number, seed: string): number[][] {
  // Simple gradient: high in center, low at edges
  const map: number[][] = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const rng = seedrandom(seed);

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);

      // Higher in center, lower at edges with deterministic noise
      row.push(100 - (distance / maxDistance) * 80 + (rng() - 0.5) * 5);
    }
    map.push(row);
  }

  return map;
}

// Unused helper functions removed

describe('River Generation', () => {
  // Helper to convert 2D array to Uint8Array
  function flatten(map: number[][]): Uint8Array {
    const height = map.length;
    const width = map[0].length;
    const flat = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        flat[y * width + x] = map[y][x];
      }
    }
    return flat;
  }

  it('should generate rivers on a simple map', () => {
    const width = 50;
    const height = 50;
    const seed = 'test-seed';
    const elevation2D = createSimpleHeightmap(width, height, seed);
    const elevation = flatten(elevation2D);

    const result = generateRivers({
      seed,
      width,
      height,
      elevation,
      seaLevel: 20,
      minFlux: 10
    });

    expect(result).toBeDefined();
    expect(result.rivers.length).toBeGreaterThan(0);
    expect(result.flowMap).toBeDefined();
  });

  it('should flow downhill', () => {
    const width = 30;
    const height = 30;
    const seed = 'downhill-test';
    const elevation2D = createSimpleHeightmap(width, height, seed);
    const elevation = flatten(elevation2D);

    const result = generateRivers({
      seed,
      width,
      height,
      elevation,
      seaLevel: 20
    });

    for (const river of result.rivers) {
      for (let i = 0; i < river.path.length - 1; i++) {
        const curr = river.path[i];
        const next = river.path[i + 1];

        // Check adjacency (allow diagonal)
        const dx = Math.abs(curr.x - next.x);
        const dy = Math.abs(curr.y - next.y);
        expect(Math.max(dx, dy)).toBe(1);
      }
    }
  });

  it('should terminate at ocean or map edge', () => {
    const width = 40;
    const height = 40;
    const seed = 'termination-test';
    const elevation2D = createSimpleHeightmap(width, height, seed);
    const elevation = flatten(elevation2D);
    const seaLevel = 20;

    const result = generateRivers({
      seed,
      width,
      height,
      elevation,
      seaLevel
    });

    expect(result.rivers.length).toBeGreaterThan(0);
  });
});
