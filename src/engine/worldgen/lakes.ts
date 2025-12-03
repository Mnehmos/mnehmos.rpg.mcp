/**
 * Lake Generation Module
 *
 * Identifies terrain depressions and fills them with lakes.
 * Uses a "pour point" algorithm - lakes fill up to the lowest point
 * on their rim where water can overflow.
 *
 * Algorithm:
 * 1. Find sinks (river endpoints that can't drain)
 * 2. For each sink, find the depression it sits in
 * 3. Calculate the pour point (lowest rim elevation)
 * 4. Fill all tiles below the pour point elevation
 * 5. Find spillway for outgoing river
 */

export interface LakeGenerationOptions {
  width: number;
  height: number;
  elevation: Uint8Array;
  rivers: Uint8Array;
  seaLevel?: number;
  minLakeSize?: number;
  maxLakeSize?: number;
  /** Minimum depth of depression to form a lake (pour point - sink) */
  minDepth?: number;
  /** Maximum lake fill level above sink (caps very deep lakes) */
  maxFillDepth?: number;
}

export interface LakeSpillway {
  /** X coordinate of spillway (on lake edge) */
  lakeX: number;
  /** Y coordinate of spillway (on lake edge) */
  lakeY: number;
  /** X coordinate of outflow target (where river starts) */
  outflowX: number;
  /** Y coordinate of outflow target (where river starts) */
  outflowY: number;
  /** Elevation at the spillway point */
  elevation: number;
}

export interface LakeResult {
  /** Map of lake tiles (1 = lake, 0 = not lake) */
  lakeMap: Uint8Array;
  /** Number of lakes generated */
  lakeCount: number;
  /** Spillway points where rivers can flow out of lakes */
  spillways: LakeSpillway[];
}

const toIndex = (x: number, y: number, width: number) => y * width + x;
const fromIndex = (index: number, width: number) => ({
  x: index % width,
  y: Math.floor(index / width)
});

// 8-directional neighbors for more natural lake shapes
const NEIGHBORS_8 = [
  { dx: 0, dy: -1 },  // N
  { dx: 1, dy: -1 },  // NE
  { dx: 1, dy: 0 },   // E
  { dx: 1, dy: 1 },   // SE
  { dx: 0, dy: 1 },   // S
  { dx: -1, dy: 1 },  // SW
  { dx: -1, dy: 0 },  // W
  { dx: -1, dy: -1 }, // NW
];

// 4-directional for more controlled operations
const NEIGHBORS_4 = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

/**
 * Generate lakes by identifying and filling terrain depressions
 */
export function generateLakes(options: LakeGenerationOptions): LakeResult {
  const {
    width,
    height,
    elevation,
    rivers,
    seaLevel = 20,
    minLakeSize = 4,
    maxLakeSize = 100,
    minDepth = 2,      // Depression must be at least 2 elevation units deep
    maxFillDepth = 15, // Don't fill more than 15 units above sink
  } = options;

  const size = width * height;
  const lakeMap = new Uint8Array(size);
  const spillways: LakeSpillway[] = [];
  const processed = new Uint8Array(size); // Track which tiles have been considered for lakes

  // Find depression seeds - river tiles that are local minima
  const depressionSeeds = findDepressionSeeds(elevation, rivers, seaLevel, width, height);
  
  console.log(`Found ${depressionSeeds.length} potential depression seeds`);

  let lakeCount = 0;

  // Sort seeds by elevation (lowest first) to process deepest depressions first
  depressionSeeds.sort((a, b) => elevation[a] - elevation[b]);

  for (const seedIdx of depressionSeeds) {
    // Skip if this tile is already part of a lake
    if (processed[seedIdx]) continue;

    const seedElev = elevation[seedIdx];

    // Find the depression boundary and pour point
    const depression = findDepressionBoundary(
      seedIdx,
      elevation,
      seaLevel,
      processed,
      width,
      height,
      maxLakeSize * 3 // Search limit (larger than max lake to find rim)
    );

    if (!depression) continue;

    const { pourPoint, pourPointElev, basinTiles } = depression;

    // Calculate depression depth
    const depth = pourPointElev - seedElev;

    // Skip shallow depressions
    if (depth < minDepth) {
      // Mark as processed so we don't revisit
      for (const idx of basinTiles) {
        processed[idx] = 1;
      }
      continue;
    }

    // Calculate lake fill level (pour point elevation minus 1, capped by maxFillDepth)
    const maxLakeLevel = seedElev + maxFillDepth;
    const lakeLevel = Math.min(pourPointElev - 1, maxLakeLevel);

    // Fill the depression up to lake level
    const lakeTiles = fillToLevel(
      seedIdx,
      lakeLevel,
      elevation,
      seaLevel,
      processed,
      width,
      height,
      maxLakeSize
    );

    // Check size constraints
    if (lakeTiles.length >= minLakeSize && lakeTiles.length <= maxLakeSize) {
      // Create the lake
      for (const idx of lakeTiles) {
        lakeMap[idx] = 1;
        processed[idx] = 1;
      }
      lakeCount++;

      // Add spillway at pour point
      if (pourPoint !== -1) {
        const spillway = createSpillway(
          pourPoint,
          lakeTiles,
          elevation,
          seaLevel,
          width,
          height
        );
        if (spillway) {
          spillways.push(spillway);
        }
      }

      console.log(`Created lake #${lakeCount}: ${lakeTiles.length} tiles, depth=${depth}, level=${lakeLevel}`);
    } else {
      // Mark basin as processed even if no lake formed
      for (const idx of basinTiles) {
        processed[idx] = 1;
      }
      
      if (lakeTiles.length > maxLakeSize) {
        console.log(`Rejected lake: too large (${lakeTiles.length} tiles)`);
      }
    }
  }

  return { lakeMap, lakeCount, spillways };
}

/**
 * Find depression seeds - river tiles that are local minima AND have significantly
 * lower elevation than their surroundings
 */
function findDepressionSeeds(
  elevation: Uint8Array,
  rivers: Uint8Array,
  seaLevel: number,
  width: number,
  height: number
): number[] {
  const seeds: number[] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = toIndex(x, y, width);

      // Must be a river tile and above sea level
      if (rivers[idx] === 0) continue;
      if (elevation[idx] < seaLevel) continue;

      const elev = elevation[idx];
      let isLocalMin = true;
      let neighborCount = 0;
      let higherNeighbors = 0;
      let nearOcean = false;

      // Check all 8 neighbors
      for (const { dx, dy } of NEIGHBORS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const nIdx = toIndex(nx, ny, width);
        neighborCount++;

        // Check if near ocean
        if (elevation[nIdx] < seaLevel) {
          nearOcean = true;
          break;
        }

        // Check if any neighbor is lower (not a local minimum)
        if (elevation[nIdx] < elev) {
          isLocalMin = false;
        }

        if (elevation[nIdx] > elev) {
          higherNeighbors++;
        }
      }

      // Skip tiles adjacent to ocean (they drain to sea)
      if (nearOcean) continue;

      // Must be a true local minimum (no lower neighbors)
      // AND surrounded by mostly higher terrain (suggests a depression)
      if (isLocalMin && higherNeighbors >= neighborCount * 0.5) {
        seeds.push(idx);
      }
    }
  }

  return seeds;
}

/**
 * Find the boundary of a depression and its pour point
 * Returns the pour point (lowest rim cell) and the elevation there
 */
function findDepressionBoundary(
  seedIdx: number,
  elevation: Uint8Array,
  seaLevel: number,
  processed: Uint8Array,
  width: number,
  height: number,
  searchLimit: number
): { pourPoint: number; pourPointElev: number; basinTiles: number[] } | null {
  const seedElev = elevation[seedIdx];
  const basinTiles: number[] = [];
  const visited = new Set<number>();
  
  // Use a priority queue approach - expand from lowest to highest
  // Find the rim (where elevation increases significantly)
  
  // Start BFS from seed, tracking elevation changes
  const queue: number[] = [seedIdx];
  visited.add(seedIdx);
  
  let pourPoint = -1;
  let pourPointElev = Infinity;
  
  while (queue.length > 0 && basinTiles.length < searchLimit) {
    const idx = queue.shift()!;
    const elev = elevation[idx];
    
    // Skip ocean tiles
    if (elev < seaLevel) continue;
    
    // Skip already processed (part of another lake)
    if (processed[idx]) continue;
    
    basinTiles.push(idx);
    
    const { x, y } = fromIndex(idx, width);
    
    for (const { dx, dy } of NEIGHBORS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      
      const nIdx = toIndex(nx, ny, width);
      if (visited.has(nIdx)) continue;
      visited.add(nIdx);
      
      const nElev = elevation[nIdx];
      
      // If neighbor is below sea level, this depression drains to ocean
      // Not a valid closed basin
      if (nElev < seaLevel) {
        return null;
      }
      
      // If neighbor is higher than seed elevation + a threshold,
      // it's part of the rim, not the basin
      // We're looking for the LOWEST point on the rim
      if (nElev > seedElev + 1) {
        // This is a rim candidate
        if (nElev < pourPointElev) {
          pourPointElev = nElev;
          pourPoint = nIdx;
        }
      } else {
        // Still in the basin, continue exploring
        queue.push(nIdx);
      }
    }
  }
  
  // Validate we found a proper rim
  if (pourPoint === -1 || pourPointElev <= seedElev) {
    return null;
  }
  
  return { pourPoint, pourPointElev, basinTiles };
}

/**
 * Fill a depression up to a given elevation level
 */
function fillToLevel(
  seedIdx: number,
  lakeLevel: number,
  elevation: Uint8Array,
  seaLevel: number,
  processed: Uint8Array,
  width: number,
  height: number,
  maxSize: number
): number[] {
  const lakeTiles: number[] = [];
  const visited = new Set<number>();
  const queue: number[] = [seedIdx];
  
  visited.add(seedIdx);
  
  while (queue.length > 0 && lakeTiles.length < maxSize) {
    const idx = queue.shift()!;
    const elev = elevation[idx];
    
    // Only include tiles at or below lake level (and above sea level)
    if (elev > lakeLevel || elev < seaLevel) continue;
    
    // Don't include tiles already part of another lake
    if (processed[idx]) continue;
    
    lakeTiles.push(idx);
    
    const { x, y } = fromIndex(idx, width);
    
    for (const { dx, dy } of NEIGHBORS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      
      const nIdx = toIndex(nx, ny, width);
      if (visited.has(nIdx)) continue;
      visited.add(nIdx);
      
      queue.push(nIdx);
    }
  }
  
  return lakeTiles;
}

/**
 * Create a spillway at the pour point
 */
function createSpillway(
  pourPoint: number,
  lakeTiles: number[],
  elevation: Uint8Array,
  seaLevel: number,
  width: number,
  height: number
): LakeSpillway | null {
  const lakeSet = new Set(lakeTiles);
  const { x: pourX, y: pourY } = fromIndex(pourPoint, width);
  
  // Find the adjacent lake tile (the point on the lake shore)
  let lakeX = -1;
  let lakeY = -1;
  
  for (const { dx, dy } of NEIGHBORS_4) {
    const nx = pourX + dx;
    const ny = pourY + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    
    const nIdx = toIndex(nx, ny, width);
    if (lakeSet.has(nIdx)) {
      lakeX = nx;
      lakeY = ny;
      break;
    }
  }
  
  if (lakeX === -1) return null;
  
  // Find where the spillway flows to (lowest non-lake neighbor of pour point)
  let outflowX = -1;
  let outflowY = -1;
  let lowestElev = elevation[pourPoint];
  
  for (const { dx, dy } of NEIGHBORS_8) {
    const nx = pourX + dx;
    const ny = pourY + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    
    const nIdx = toIndex(nx, ny, width);
    
    // Skip lake tiles
    if (lakeSet.has(nIdx)) continue;
    
    // Skip ocean (lake already drains there)
    if (elevation[nIdx] < seaLevel) continue;
    
    const nElev = elevation[nIdx];
    if (nElev < lowestElev) {
      lowestElev = nElev;
      outflowX = nx;
      outflowY = ny;
    }
  }
  
  if (outflowX === -1) return null;
  
  return {
    lakeX,
    lakeY,
    outflowX,
    outflowY,
    elevation: elevation[pourPoint],
  };
}
