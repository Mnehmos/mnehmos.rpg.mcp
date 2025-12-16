/**
 * River Generation Module
 *
 * Generates rivers using flow accumulation algorithm.
 * Inspired by Azgaar's river system (reference/AZGAAR_SNAPSHOT.md Section 4).
 *
 * Algorithm:
 * 1. Calculate flow accumulation from precipitation
 * 2. Identify high-flux cells as river sources
 * 3. Trace river paths downhill to ocean/lake
 * 4. Track confluences where rivers merge
 *
 * Key properties:
 * - Deterministic (seedable PRNG)
 * - Rivers always flow downhill
 * - Acyclic network (DAG structure)
 * - Flux increases downstream
 * - Memory optimized using TypedArrays
 */

import seedrandom from 'seedrandom';

/**
 * Point in 2D grid
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Single river with path and flow data
 */
export interface River {
  id: string;
  /** River path from source to mouth */
  path: Point[];
  /** Water flux at each point in path */
  flux: number[];
  /** Points where tributaries join this river */
  confluences: Point[];
}

/**
 * Complete river system for a world
 */
export interface RiverSystem {
  rivers: River[];
  /** Flow accumulation map */
  flowMap: number[][];
}

/**
 * River generation options
 */
export interface RiverGenerationOptions {
  /** Deterministic seed */
  seed: string;
  width: number;
  height: number;
  /** Elevation map (Uint8Array) */
  elevation: Uint8Array;
  /** Precipitation map (optional, defaults to uniform) */
  precipitation?: Float32Array; // Changed to Float32Array to match internal usage
  /** Sea level (default 20) */
  seaLevel?: number;
  /** Minimum flux to form a river (default 100) */
  minFlux?: number;
}

// Helper to convert 2D coords to 1D index
export const toIndex = (x: number, y: number, width: number) => y * width + x;
export const fromIndex = (index: number, width: number) => ({ x: index % width, y: Math.floor(index / width) });

/**
 * Generate river system
 */
export function generateRivers(options: RiverGenerationOptions): RiverSystem {
  const {
    seed,
    width,
    height,
    elevation,
    seaLevel = 20,
    precipitation,
    minFlux = 800, // Higher threshold - fewer rivers
  } = options;

  const size = width * height;
  const rng = seedrandom(seed);

  // Clone elevation to avoid mutating input (Uint8Array copy is fast)
  const workingElevation = new Uint8Array(elevation);

  ensureSeaOutlets(workingElevation, seaLevel, width, height);

  // Use TypedArrays for internal calculations
  const oceanDistance = calculateOceanDistance(workingElevation, seaLevel, width, height);

  // Carve spillways to guarantee downhill routes without raising terrain
  carveSpillways(workingElevation, oceanDistance, seaLevel, width, height);

  // Default uniform precipitation if not provided
  let precipFlat: Float32Array;
  if (precipitation) {
    precipFlat = precipitation;
  } else {
    precipFlat = new Float32Array(size);
    precipFlat.fill(100);
  }

  // Step 1: Calculate flow directions (steepest descent, distance-aware, with meander)
  // Stores index of target cell, or -1 if none
  const flowDirection = calculateFlowDirection(workingElevation, oceanDistance, seaLevel, width, height, rng);

  // Step 2: Calculate flow accumulation following flow directions
  const flowMapFlat = calculateFlowAccumulation(workingElevation, oceanDistance, precipFlat, seaLevel, flowDirection, width, height);

  // Step 3: Identify sources (with higher threshold for fewer rivers)
  const minFluxThreshold = minFlux;
  const sources = findRiverSources(flowMapFlat, workingElevation, seaLevel, minFluxThreshold, rng, width, height);

  // Step 4: Trace rivers
  const incomingCounts = calculateIncomingCounts(flowDirection, size);
  const rivers: River[] = [];
  const globalVisited = new Uint8Array(size); // 0 = unvisited, 1 = visited

  // Reuse buffer for cycle detection
  // Stores traceId for the current river trace
  const pathSetBuffer = new Int32Array(size);
  let traceIdCounter = 1;

  for (const source of sources) {
    // Skip if already part of a river
    const sourceIdx = toIndex(source.x, source.y, width);
    if (globalVisited[sourceIdx] === 1) continue;

    const river = traceRiverPath(
      source,
      workingElevation,
      flowMapFlat, // Use flat map internally
      flowDirection,
      incomingCounts,
      seaLevel,
      globalVisited,
      pathSetBuffer,
      traceIdCounter++,
      width,
      height
    );

    if (river && river.path.length > 25) {  // Increased from 10 - skip short river fragments
      river.id = `river_${rivers.length + 1}`;
      rivers.push(river);
    }
  }

  // Convert flow map back to 2D for return (API compatibility)
  const flowMap2D: number[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => flowMapFlat[toIndex(x, y, width)])
  );

  return {
    rivers,
    flowMap: flowMap2D,
  };
}

/**
 * Calculate flow direction for each cell (steepest descent)
 */
function calculateFlowDirection(
  elevation: Uint8Array,
  oceanDistance: Int32Array,
  seaLevel: number,
  width: number,
  height: number,
  rng: seedrandom.PRNG
): Int32Array {
  const size = width * height;
  const dir = new Int32Array(size).fill(-1);

  const neighborDeltas = [
    { x: 0, y: -1 }, // N
    { x: 1, y: -1 }, // NE
    { x: 1, y: 0 },  // E
    { x: 1, y: 1 },  // SE
    { x: 0, y: 1 },  // S
    { x: -1, y: 1 }, // SW
    { x: -1, y: 0 }, // W
    { x: -1, y: -1 } // NW
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = toIndex(x, y, width);

      // Ocean cells don't flow
      if (elevation[idx] < seaLevel) continue;

      const currentElev = elevation[idx];
      const currentDist = oceanDistance[idx];

      let bestIdx = -1;
      let maxDrop = -Infinity;
      let bestDist = Infinity;

      for (const { x: dx, y: dy } of neighborDeltas) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = toIndex(nx, ny, width);
          const nElev = elevation[nIdx];
          const nDist = oceanDistance[nIdx];

          // Priority 1: Must be lower or equal elevation
          // Priority 2: Must be closer to ocean (if equal elevation)

          const drop = currentElev - nElev;

          // Valid flow target:
          // 1. Strictly lower elevation
          // 2. OR Equal elevation but strictly closer to ocean (plateau flow)

          const isValid = drop > 0 || (drop === 0 && nDist < currentDist);

          if (isValid) {
            // Scale meander based on world size - smaller worlds need MORE meander
            // to avoid perfectly straight rivers over short distances
            const worldSizeFactor = Math.max(1, 200 / Math.min(width, height)); // 1.0 for 200+, 2.0 for 100, 4.0 for 50
            
            // Add random meander factor to break up straight lines
            // ESPECIALLY on flat terrain (drop === 0) which creates straight paths
            const flatTerrainBonus = drop === 0 ? (rng() * 4 * worldSizeFactor) : 0;
            const slopeBonus = drop > 0 ? (rng() * 2 * worldSizeFactor) : 0;
            const diagonalBonus = (dx !== 0 && dy !== 0) ? (rng() * 1.0 * worldSizeFactor) : 0;
            const effectiveDrop = drop + slopeBonus + flatTerrainBonus + diagonalBonus;
            
            // Pick steepest drop (with meander)
            // Tie-break with distance to ocean (more relaxed for small worlds)
            const tolerance = 0.5 * worldSizeFactor;
            if (effectiveDrop > maxDrop + 0.01) {
              maxDrop = effectiveDrop;
              bestDist = nDist;
              bestIdx = nIdx;
            } else if (Math.abs(effectiveDrop - maxDrop) < tolerance) {
              // Close enough - pick randomly between options for natural meander
              if (rng() > 0.4 && nDist <= bestDist + 3 * worldSizeFactor) {
                bestDist = nDist;
                bestIdx = nIdx;
              }
            }
          }
        }
      }

      if (bestIdx !== -1) {
        dir[idx] = bestIdx;
      }
    }
  }

  return dir;
}

/**
 * Calculate flow accumulation given fixed flow directions
 */
function calculateFlowAccumulation(
  elevation: Uint8Array,
  oceanDistance: Int32Array,
  precipitation: Float32Array,
  seaLevel: number,
  flowDirection: Int32Array,
  width: number,
  height: number
): Float32Array {
  const size = width * height;
  const flow = new Float32Array(size);

  // Initialize flow with precipitation for land cells
  for (let i = 0; i < size; i++) {
    if (elevation[i] >= seaLevel) {
      flow[i] = precipitation[i];
    }
  }

  // Order cells from high to low elevation (filled), ensuring upstream processed first
  // We can use a flat array of indices and sort them
  const cells = new Int32Array(size);
  let cellCount = 0;
  for (let i = 0; i < size; i++) {
    if (elevation[i] >= seaLevel) {
      cells[cellCount++] = i;
    }
  }

  // Sort only the valid cells
  const validCells = cells.subarray(0, cellCount);
  validCells.sort((a, b) => {
    const elevDiff = elevation[b] - elevation[a];
    if (elevDiff !== 0) return elevDiff;
    // Secondary sort: distance to ocean (descending)
    // Further from ocean = upstream
    return oceanDistance[b] - oceanDistance[a];
  });

  for (let i = 0; i < cellCount; i++) {
    const idx = validCells[i];
    const targetIdx = flowDirection[idx];
    if (targetIdx !== -1) {
      flow[targetIdx] += flow[idx];
    }
  }

  return flow;
}

/**
 * Identify potential river sources
 */
function findRiverSources(
  flowMap: Float32Array,
  elevation: Uint8Array,
  seaLevel: number,
  minFlux: number,
  _rng: seedrandom.PRNG,
  width: number,
  height: number
): Point[] {
  const sources: Point[] = [];
  const size = width * height;

  // Candidate selection: High flux but not too high (avoid main rivers starting mid-stream?)
  // Actually, standard algorithm is: any cell with flux > threshold is part of a river.
  // Sources are the "start" of these segments.
  // But usually we just pick high flux points that don't have high flux inputs?
  // Simplification: Pick random points with high flux, or iterate all.
  // Let's iterate all cells with flux > threshold and sort by elevation (highest first)

  const candidates: number[] = [];
  for (let i = 0; i < size; i++) {
    if (elevation[i] >= seaLevel && flowMap[i] >= minFlux) {
      candidates.push(i);
    }
  }

  // Sort by elevation descending
  candidates.sort((a, b) => elevation[b] - elevation[a]);

  for (const idx of candidates) {
    sources.push(fromIndex(idx, width));
  }

  return sources;
}

/**
 * Trace a single river from source to sea/confluence
 */
function traceRiverPath(
  start: Point,
  elevation: Uint8Array,
  flowMap: Float32Array,
  flowDirection: Int32Array,
  incomingCounts: Int32Array,
  seaLevel: number,
  globalVisited: Uint8Array, // Now Uint8Array
  pathSetBuffer: Int32Array, // Reused buffer
  traceId: number, // Unique ID for this trace
  width: number,
  height: number
): River {
  const path: Point[] = [start];
  const startIdx = toIndex(start.x, start.y, width);
  const flux: number[] = [clampFlux(flowMap[startIdx])];
  const confluences: Point[] = [];

  let currentIdx = startIdx;

  // Mark start
  pathSetBuffer[currentIdx] = traceId;
  globalVisited[currentIdx] = 1;

  const maxSteps = width * height;

  while (true) {
    const nextIdx = flowDirection[currentIdx];

    if (nextIdx === -1) { // Check for invalid direction index
      break;
    }

    const next = fromIndex(nextIdx, width);

    if (pathSetBuffer[nextIdx] === traceId) { // Check cycle using traceId
      console.warn('Cycle detected in river path, terminating');
      break;
    }
    pathSetBuffer[nextIdx] = traceId;

    path.push(next);
    flux.push(clampFlux(flowMap[nextIdx]));
    globalVisited[nextIdx] = 1;

    if (incomingCounts[nextIdx] > 1) {
      confluences.push(next);
    }

    // Stop if reached ocean
    if (elevation[nextIdx] < seaLevel) {
      break;
    }

    if (path.length > maxSteps) {
      console.warn('River path exceeded grid cells, terminating');
      break;
    }

    currentIdx = nextIdx; // Update current index
  }

  return {
    id: '',
    path,
    flux,
    confluences,
  };
}

function clampFlux(val: number): number {
  return Math.max(0, Math.min(10000, val)); // Reasonable cap
}

/**
 * Calculate incoming flow count for each cell
 */
function calculateIncomingCounts(flowDirection: Int32Array, size: number): Int32Array {
  const counts = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    const target = flowDirection[i];
    if (target !== -1) {
      counts[target]++;
    }
  }
  return counts;
}

/**
 * Ensure map edges are sea level or lower to allow drainage
 */
function ensureSeaOutlets(elevation: Uint8Array, seaLevel: number, width: number, height: number): void {
  let hasOcean = false;
  const size = width * height;

  // Check if any cell is already ocean
  for (let i = 0; i < size; i++) {
    if (elevation[i] < seaLevel) {
      hasOcean = true;
      break;
    }
  }

  // If no ocean, force an outlet at the lowest edge point
  if (!hasOcean) {
    let minEdgeElev = 255;
    let minEdgeIdx = -1;

    // Check top/bottom edges
    for (let x = 0; x < width; x++) {
      const topIdx = x;
      const bottomIdx = (height - 1) * width + x;

      if (elevation[topIdx] < minEdgeElev) {
        minEdgeElev = elevation[topIdx];
        minEdgeIdx = topIdx;
      }
      if (elevation[bottomIdx] < minEdgeElev) {
        minEdgeElev = elevation[bottomIdx];
        minEdgeIdx = bottomIdx;
      }
    }

    // Check left/right edges
    for (let y = 0; y < height; y++) {
      const leftIdx = y * width;
      const rightIdx = y * width + (width - 1);

      if (elevation[leftIdx] < minEdgeElev) {
        minEdgeElev = elevation[leftIdx];
        minEdgeIdx = leftIdx;
      }
      if (elevation[rightIdx] < minEdgeElev) {
        minEdgeElev = elevation[rightIdx];
        minEdgeIdx = rightIdx;
      }
    }

    // Lower the lowest edge to seaLevel - 1
    if (minEdgeIdx !== -1) {
      elevation[minEdgeIdx] = Math.max(0, seaLevel - 1);
    }
  }
}

/**
 * Calculate distance to nearest ocean for each cell
 */
function calculateOceanDistance(
  elevation: Uint8Array,
  seaLevel: number,
  width: number,
  height: number
): Int32Array {
  const size = width * height;
  const distance = new Int32Array(size).fill(2147483647); // Max int32 roughly
  const queue = new Int32Array(size); // Circular buffer or just large enough array
  let head = 0;
  let tail = 0;

  // Initialize queue with ocean/edge cells
  let initialQueueSize = 0;
  for (let i = 0; i < size; i++) {
    if (elevation[i] < seaLevel) {
      distance[i] = 0;
      queue[tail++] = i;
      initialQueueSize++;
    }
  }
  console.error(`BFS Initializing Queue Size: ${initialQueueSize} for size ${size} (seaLevel: ${seaLevel})`);

  const neighborDeltas = [
    { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }
  ];

  while (head < tail) { // BFS loop
    const idx = queue[head++];
    const { x, y } = fromIndex(idx, width);
    const dist = distance[idx];

    for (const { x: dx, y: dy } of neighborDeltas) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = toIndex(nx, ny, width);
        if (distance[nIdx] > dist + 1) {
          distance[nIdx] = dist + 1;
          queue[tail++] = nIdx;
        }
      }
    }
  }

  return distance;
}

/**
 * Carve spillways to guarantee downhill exits without raising terrain
 */
function carveSpillways(
  elevation: Uint8Array,
  oceanDistance: Int32Array,
  seaLevel: number,
  width: number,
  height: number
): void {
  const size = width * height;

  // Process cells furthest from ocean first to propagate low elevations downstream
  const cells = new Int32Array(size);
  for (let i = 0; i < size; i++) cells[i] = i;

  cells.sort((a, b) => oceanDistance[b] - oceanDistance[a]);

  const neighbors = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  for (let i = 0; i < size; i++) {
    const idx = cells[i];
    const { x, y } = fromIndex(idx, width);

    if (elevation[idx] < seaLevel) continue;

    const currentElev = elevation[idx];
    const currentDist = oceanDistance[idx];

    // Find best downstream neighbor (closer to ocean)
    let bestNIdx = -1;
    let bestNElev = Number.MAX_VALUE;

    for (const { x: dx, y: dy } of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      const nIdx = toIndex(nx, ny, width);
      const dist = oceanDistance[nIdx];

      // Must be strictly closer to ocean
      if (dist >= currentDist) continue;

      const elev = elevation[nIdx];

      // Pick the neighbor with lowest elevation to minimize carving
      if (elev < bestNElev) {
        bestNElev = elev;
        bestNIdx = nIdx;
      }
    }

    // If we found a downstream neighbor that is higher than current, carve it
    // This ensures that 'current' can flow into 'bestN'
    if (bestNIdx !== -1 && bestNElev > currentElev) {
      elevation[bestNIdx] = currentElev;
    } else if (bestNIdx === -1) {
      console.error(`CarveSpillways failed for cell ${x},${y} dist=${currentDist} elev=${currentElev}`);
    }
  }
}

