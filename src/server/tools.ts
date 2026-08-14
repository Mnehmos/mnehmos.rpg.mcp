import { z } from 'zod';
import { generateWorld } from '../engine/worldgen/index.js';
import { BIOME_HABITABILITY, WATER_BIOMES, validateStructurePlacement, getSuggestedBiomesForStructure } from '../engine/worldgen/validation.js';

import { PubSub } from '../engine/pubsub.js';

import { randomUUID } from 'crypto';
import { getWorldManager } from './state/world-manager.js';
import { SessionContext } from './types.js';
import { WorldRepository } from '../storage/repos/world.repo.js';
import { getDb } from '../storage/index.js';
import * as zlib from 'zlib';
import { StructureType } from '../schema/structure.js';
import { BiomeType } from '../schema/biome.js';
import { WorldSnapshotRepository } from '../storage/repos/world-snapshot.repo.js';
import { persistGeneratedWorldEntities } from '../services/generated-world-persistence.service.js';
export { LEGACY_SURFACE_POLICY } from './legacy-surface-policy.js';

// Global state for the server (in-memory for MVP)
let pubsub: PubSub | null = null;

export function setWorldPubSub(instance: PubSub) {
    pubsub = instance;
}

export const Tools = {
    GENERATE_WORLD: {
        name: 'generate_world',
        description: 'Generate a new procedural RPG world with seed, width, and height parameters. Example: { "seed": "atlas", "width": 50, "height": 50 }',
        inputSchema: z.object({
            seed: z.string().describe('Seed for random number generation'),
            width: z.number().int().min(10).max(1000).describe('Width of the world grid'),
            height: z.number().int().min(10).max(1000).describe('Height of the world grid'),
            landRatio: z.number().min(0.1).max(0.9).optional().describe('Land to water ratio (0.1 = mostly ocean, 0.9 = mostly land, default 0.3)'),
            temperatureOffset: z.number().min(-30).max(30).optional().describe('Global temperature offset (-30 to +30) to shift biome distribution'),
            moistureOffset: z.number().min(-30).max(30).optional().describe('Global moisture offset (-30 to +30) to shift biome distribution')
        })
    },
    GET_WORLD_STATE: {
        name: 'get_world_state',
        description: 'Retrieves the current state of the generated world.',
        inputSchema: z.object({
            worldId: z.string().describe('The ID of the world to retrieve')
        })
    },
    APPLY_MAP_PATCH: {
        name: 'apply_map_patch',
        description: 'Apply DSL commands to modify the world map. Use find_valid_poi_location first for structure placement. Example: { "worldId": "id", "script": "ADD_STRUCTURE..." }',
        inputSchema: z.object({
            worldId: z.string().describe('The ID of the world to patch'),
            script: z.string().describe('The DSL script containing patch commands.')
        })
    },
    GET_WORLD_MAP_OVERVIEW: {
        name: 'get_world_map_overview',
        description: 'Returns a high-level overview of the world including biome distribution and statistics.',
        inputSchema: z.object({
            worldId: z.string().describe('The ID of the world to overview')
        })
    },
    GET_REGION_MAP: {
        name: 'get_region_map',
        description: 'Returns detailed information about a specific region including its tiles and structures.',
        inputSchema: z.object({
            worldId: z.string().describe('The ID of the world'),
            regionId: z.number().int().min(0).describe('The ID of the region to retrieve')
        })
    },
    GET_WORLD_TILES: {
        name: 'get_world_tiles',
        description: 'Returns the full tile grid for rendering the world map. Includes biome, elevation, region, and river data for visualization.',
        inputSchema: z.object({
            worldId: z.string().describe('The ID of the world')
        })
    },
    PREVIEW_MAP_PATCH: {
        name: 'preview_map_patch',
        description: 'Previews what a DSL patch script would do without applying it to the world.',
        inputSchema: z.object({
            worldId: z.string().describe('The ID of the world to preview patch on'),
            script: z.string().describe('The DSL script to preview')
        })
    },
    FIND_VALID_POI_LOCATION: {
        name: 'find_valid_poi_location',
        description: 'Find terrain-valid locations for placing a POI/structure. Returns ranked candidates by suitability.',
        inputSchema: z.object({
            worldId: z.string().describe('The ID of the world'),
            poiType: z.enum(['city', 'town', 'village', 'castle', 'ruins', 'dungeon', 'temple']).describe('Type of POI to place'),
            nearWater: z.boolean().optional().describe('If true, prefer locations within 5 tiles of river/coast'),
            preferredBiomes: z.array(z.string()).optional().describe('List of preferred biome types'),
            avoidExistingPOIs: z.boolean().optional().default(true).describe('If true, avoid placing near existing structures'),
            minDistanceFromPOI: z.number().optional().default(5).describe('Minimum distance from existing POIs'),
            regionId: z.number().optional().describe('Limit search to specific region'),
            count: z.number().int().min(1).max(10).optional().default(3).describe('Number of candidate locations to return')
        })
    },
    SUGGEST_POI_LOCATIONS: {
        name: 'suggest_poi_locations',
        description: 'Batch suggest locations for multiple POI types at once. Returns DSL script for easy application.',
        inputSchema: z.object({
            worldId: z.string().describe('The ID of the world'),
            requests: z.array(z.object({
                poiType: z.enum(['city', 'town', 'village', 'castle', 'ruins', 'dungeon', 'temple']),
                count: z.number().int().min(1).max(10).default(1),
                nearWater: z.boolean().optional(),
                preferredBiomes: z.array(z.string()).optional()
            })).describe('List of POI placement requests')
        })
    }
} as const;

// Helper to ensure tile_cache column exists
function ensureTileCacheColumn(db: any) {
    try {
        const columns = db.prepare(`PRAGMA table_info(worlds)`).all() as any[];
        const hasCache = columns.some((col: any) => col.name === 'tile_cache');
        if (!hasCache) {
            console.error('[WorldGen] Adding tile_cache column to worlds table');
            db.exec(`ALTER TABLE worlds ADD COLUMN tile_cache BLOB`);
        }
    } catch (err) {
        // Ignore if table doesn't exist yet
    }
}

// Helper to get cached tiles from database
function getCachedTiles(db: any, worldId: string): any | null {
    try {
        ensureTileCacheColumn(db);
        const row = db.prepare('SELECT tile_cache FROM worlds WHERE id = ?').get(worldId) as any;
        if (row?.tile_cache) {
            // Decompress and parse
            const decompressed = zlib.gunzipSync(row.tile_cache);
            return JSON.parse(decompressed.toString('utf-8'));
        }
    } catch (err) {
        console.error('[WorldGen] Failed to read tile cache:', err);
    }
    return null;
}

// Helper to save tiles to database cache
function saveTilesToCache(db: any, worldId: string, tileData: any) {
    try {
        ensureTileCacheColumn(db);
        const json = JSON.stringify(tileData);
        const compressed = zlib.gzipSync(json);
        db.prepare('UPDATE worlds SET tile_cache = ? WHERE id = ?').run(compressed, worldId);
        console.error(`[WorldGen] Cached ${compressed.length} bytes of tile data for world ${worldId}`);
    } catch (err) {
        console.error('[WorldGen] Failed to save tile cache:', err);
    }
}

// Helper to invalidate tile cache (when world is modified)
function invalidateTileCache(db: any, worldId: string) {
    try {
        ensureTileCacheColumn(db);
        db.prepare('UPDATE worlds SET tile_cache = NULL WHERE id = ?').run(worldId);
        console.error(`[WorldGen] Invalidated tile cache for world ${worldId}`);
    } catch (err) {
        console.error('[WorldGen] Failed to invalidate tile cache:', err);
    }
}

export async function handleGenerateWorld(args: unknown, _ctx: SessionContext) {
    const parsed = Tools.GENERATE_WORLD.inputSchema.parse(args);
    
    console.error(`[WorldGen] Generating world with seed "${parsed.seed}" (${parsed.width}x${parsed.height})`);
    const startTime = Date.now();
    
    const world = generateWorld({
        seed: parsed.seed,
        width: parsed.width,
        height: parsed.height,
        landRatio: parsed.landRatio,
        temperatureOffset: parsed.temperatureOffset,
        moistureOffset: parsed.moistureOffset
    });

    const genTime = Date.now() - startTime;
    console.error(`[WorldGen] World generated in ${genTime}ms`);

    const worldId = randomUUID();
    // Store with session namespace in runtime manager
    getWorldManager().create(worldId, world);

    // Persist world metadata to database
    const db = getDb();
    const worldRepo = new WorldRepository(db);
    const now = new Date().toISOString();
    worldRepo.create({
        id: worldId,
        name: `World-${parsed.seed}`,
        seed: parsed.seed,
        width: parsed.width,
        height: parsed.height,
        createdAt: now,
        updatedAt: now
    });
    persistGeneratedWorldEntities(db, worldId, world);
    new WorldSnapshotRepository(db).save(worldId, world);

    // Pre-cache the tile data so subsequent loads are instant
    const tileData = buildTileData(world);
    saveTilesToCache(db, worldId, tileData);

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    worldId,
                    message: 'World generated successfully',
                    generationTimeMs: genTime,
                    stats: {
                        width: world.width,
                        height: world.height,
                        regions: world.regions.length,
                        structures: world.structures.length,
                        rivers: world.rivers.filter(r => r > 0).length
                    }
                }, null, 2)
            }
        ]
    };
}

// Helper to get world from memory or restore from DB
async function getOrRestoreWorld(worldId: string, sessionId: string) {
    const manager = getWorldManager();
    const sessionKey = `${sessionId}:${worldId}`;

    // Try memory first
    let world = manager.get(worldId) ?? manager.get(sessionKey);
    if (world) return world;

    // Try DB
    const db = getDb();
    const worldRepo = new WorldRepository(db);
    const storedWorld = worldRepo.findById(worldId);

    if (!storedWorld) {
        return null;
    }

    const snapshots = new WorldSnapshotRepository(db);
    const snapshot = snapshots.load(worldId);
    if (snapshot) {
        manager.create(worldId, snapshot);
        return snapshot;
    }

    // Legacy fallback for worlds created before durable snapshots existed.
    console.error(`[WorldGen] Restoring world ${worldId} from seed ${storedWorld.seed}`);
    const startTime = Date.now();
    
    world = generateWorld({
        seed: storedWorld.seed,
        width: storedWorld.width,
        height: storedWorld.height
    });

    const genTime = Date.now() - startTime;
    console.error(`[WorldGen] World restored in ${genTime}ms`);

    // Store in memory
    manager.create(worldId, world);
    snapshots.save(worldId, world);
    return world;
}

export async function handleGetWorldState(args: unknown, ctx: SessionContext) {
    const parsed = Tools.GET_WORLD_STATE.inputSchema.parse(args);
    const currentWorld = await getOrRestoreWorld(parsed.worldId, ctx.sessionId);

    if (!currentWorld) {
        throw new Error(`World ${parsed.worldId} not found.`);
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    seed: currentWorld.seed,
                    width: currentWorld.width,
                    height: currentWorld.height,
                    stats: {
                        regions: currentWorld.regions.length,
                        structures: currentWorld.structures.length
                    }
                }, null, 2)
            }
        ]
    };
}

import { parseDSL } from '../engine/dsl/parser.js';
import { applyPatch } from '../engine/dsl/engine.js';

export async function handleApplyMapPatch(args: unknown, ctx: SessionContext) {
    const parsed = Tools.APPLY_MAP_PATCH.inputSchema.parse(args);
    const currentWorld = await getOrRestoreWorld(parsed.worldId, ctx.sessionId);

    if (!currentWorld) {
        throw new Error(`World ${parsed.worldId} not found.`);
    }

    try {
        const commands = parseDSL(parsed.script);
        const result = applyPatch(currentWorld, commands);

        if (result.commandsExecuted > 0) {
            new WorldSnapshotRepository(getDb()).save(parsed.worldId, currentWorld);
        }

        // Only invalidate cache if commands actually executed
        if (result.commandsExecuted > 0) {
            const db = getDb();
            invalidateTileCache(db, parsed.worldId);

            pubsub?.publish('world', {
                type: 'patch_applied',
                commandsExecuted: result.commandsExecuted,
                timestamp: Date.now()
            });
        }

        // Return detailed result
        if (!result.success) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: false,
                            message: 'Patch failed - some commands could not be applied',
                            commandsExecuted: result.commandsExecuted,
                            errors: result.errors,
                            warnings: result.warnings,
                            hint: 'Use find_valid_poi_location to get valid coordinates for structure placement'
                        }, null, 2)
                    }
                ]
            };
        }

        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify({
                        success: true,
                        message: 'Patch applied successfully',
                        commandsExecuted: result.commandsExecuted,
                        warnings: result.warnings.length > 0 ? result.warnings : undefined
                    }, null, 2)
                }
            ]
        };
    } catch (error: any) {
        return {
            isError: true,
            content: [
                {
                    type: 'text' as const,
                    text: `Failed to parse patch script: ${error.message}`
                }
            ]
        };
    }
}

export async function handleGetWorldMapOverview(args: unknown, ctx: SessionContext) {
    const parsed = Tools.GET_WORLD_MAP_OVERVIEW.inputSchema.parse(args);
    const currentWorld = await getOrRestoreWorld(parsed.worldId, ctx.sessionId);

    if (!currentWorld) {
        throw new Error(`World ${parsed.worldId} not found.`);
    }

    // Calculate biome distribution
    const biomeDistribution: Record<string, number> = {};
    for (let y = 0; y < currentWorld.height; y++) {
        for (let x = 0; x < currentWorld.width; x++) {
            const biome = currentWorld.biomes[y][x];
            biomeDistribution[biome] = (biomeDistribution[biome] || 0) + 1;
        }
    }

    // Convert counts to percentages
    const totalTiles = currentWorld.width * currentWorld.height;
    const biomePercentages: Record<string, number> = {};
    for (const [biome, count] of Object.entries(biomeDistribution)) {
        biomePercentages[biome] = Math.round((count / totalTiles) * 100 * 10) / 10;
    }

    // Detect landmasses (simple connected components)
    const landmasses = detectLandmasses(currentWorld);

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    seed: currentWorld.seed,
                    dimensions: {
                        width: currentWorld.width,
                        height: currentWorld.height
                    },
                    biomeDistribution: biomePercentages,
                    regionCount: currentWorld.regions.length,
                    structureCount: currentWorld.structures.length,
                    riverTileCount: currentWorld.rivers.filter(r => r > 0).length,
                    landmasses: landmasses.slice(0, 5) // Top 5 landmasses
                }, null, 2)
            }
        ]
    };
}

/**
 * Detect landmasses using flood fill
 */
function detectLandmasses(world: any): Array<{ id: number; size: number; boundingBox: { x1: number; y1: number; x2: number; y2: number }; dominantBiomes: string[] }> {
    const { width, height, biomes } = world;
    const visited = new Uint8Array(width * height);
    const landmasses: Array<{ id: number; size: number; boundingBox: { x1: number; y1: number; x2: number; y2: number }; tiles: Array<{ x: number; y: number; biome: string }> }> = [];
    
    let landmassId = 0;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (visited[idx]) continue;
            
            const biome = biomes[y][x];
            if (WATER_BIOMES.includes(biome)) {
                visited[idx] = 1;
                continue;
            }
            
            // Flood fill to find connected land
            const tiles: Array<{ x: number; y: number; biome: string }> = [];
            const stack: Array<{ x: number; y: number }> = [{ x, y }];
            let minX = x, maxX = x, minY = y, maxY = y;
            
            while (stack.length > 0) {
                const { x: cx, y: cy } = stack.pop()!;
                const cIdx = cy * width + cx;
                
                if (visited[cIdx]) continue;
                if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
                
                const cBiome = biomes[cy][cx];
                if (WATER_BIOMES.includes(cBiome)) continue;
                
                visited[cIdx] = 1;
                tiles.push({ x: cx, y: cy, biome: cBiome });
                
                minX = Math.min(minX, cx);
                maxX = Math.max(maxX, cx);
                minY = Math.min(minY, cy);
                maxY = Math.max(maxY, cy);
                
                // Add neighbors
                stack.push({ x: cx + 1, y: cy });
                stack.push({ x: cx - 1, y: cy });
                stack.push({ x: cx, y: cy + 1 });
                stack.push({ x: cx, y: cy - 1 });
            }
            
            if (tiles.length > 10) { // Only count significant landmasses
                landmasses.push({
                    id: landmassId++,
                    size: tiles.length,
                    boundingBox: { x1: minX, y1: minY, x2: maxX, y2: maxY },
                    tiles
                });
            }
        }
    }
    
    // Sort by size and compute dominant biomes
    landmasses.sort((a, b) => b.size - a.size);
    
    return landmasses.map(lm => {
        const biomeCounts: Record<string, number> = {};
        for (const tile of lm.tiles) {
            biomeCounts[tile.biome] = (biomeCounts[tile.biome] || 0) + 1;
        }
        const dominantBiomes = Object.entries(biomeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([biome]) => biome);
        
        return {
            id: lm.id,
            size: lm.size,
            boundingBox: lm.boundingBox,
            dominantBiomes
        };
    });
}

export async function handleGetRegionMap(args: unknown, ctx: SessionContext) {
    const parsed = Tools.GET_REGION_MAP.inputSchema.parse(args);
    const currentWorld = await getOrRestoreWorld(parsed.worldId, ctx.sessionId);

    if (!currentWorld) {
        throw new Error(`World ${parsed.worldId} not found.`);
    }

    const regionId = parsed.regionId;

    // Find the region
    const region = currentWorld.regions.find((r: any) => r.id === regionId);
    if (!region) {
        throw new Error(`Region not found: ${regionId}`);
    }

    // Collect all tiles belonging to this region
    const tiles: Array<{ x: number; y: number; biome: string; elevation: number }> = [];
    for (let y = 0; y < currentWorld.height; y++) {
        for (let x = 0; x < currentWorld.width; x++) {
            const idx = y * currentWorld.width + x;
            if (currentWorld.regionMap[idx] === regionId) {
                tiles.push({
                    x,
                    y,
                    biome: currentWorld.biomes[y][x],
                    elevation: currentWorld.elevation[idx]
                });
            }
        }
    }

    // Find structures in this region
    const world = currentWorld;
    const structures = world.structures.filter((s: any) => {
        const idx = s.location.y * world.width + s.location.x;
        return world.regionMap[idx] === regionId;
    });

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    region: {
                        id: region.id,
                        name: region.name,
                        capitalX: region.capital.x,
                        capitalY: region.capital.y,
                        dominantBiome: region.biome
                    },
                    tiles,
                    structures,
                    tileCount: tiles.length
                }, null, 2)
            }
        ]
    };
}

// Helper to build tile data from world object
function buildTileData(world: any) {
    const biomeIndex: Record<string, number> = {};
    const biomes: string[] = [];

    // Build biome lookup
    for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
            const biome = world.biomes[y][x];
            if (!(biome in biomeIndex)) {
                biomeIndex[biome] = biomes.length;
                biomes.push(biome);
            }
        }
    }

    // Build structure location set
    const structureSet = new Set<string>();
    world.structures.forEach((s: any) => {
        structureSet.add(`${s.location.x},${s.location.y}`);
    });

    // Build tile grid (compact format for fast transfer)
    const tiles: number[][] = [];
    for (let y = 0; y < world.height; y++) {
        const row: number[] = [];
        for (let x = 0; x < world.width; x++) {
            const idx = y * world.width + x;
            const biome = world.biomes[y][x];
            const elevation = world.elevation[idx];
            const regionId = world.regionMap[idx];
            const hasRiver = world.rivers[idx] > 0 ? 1 : 0;
            const hasStructure = structureSet.has(`${x},${y}`) ? 1 : 0;

            row.push(biomeIndex[biome], elevation, regionId, hasRiver, hasStructure);
        }
        tiles.push(row);
    }

    // Region metadata
    const regions = world.regions.map((r: any) => ({
        id: r.id,
        name: r.name,
        biome: r.biome,
        capitalX: r.capital.x,
        capitalY: r.capital.y
    }));

    // Structure list
    const structures = world.structures.map((s: any) => ({
        type: s.type,
        name: s.name,
        x: s.location.x,
        y: s.location.y
    }));

    return {
        width: world.width,
        height: world.height,
        biomes,
        tiles,
        regions,
        structures
    };
}

export async function handleGetWorldTiles(args: unknown, ctx: SessionContext) {
    const parsed = Tools.GET_WORLD_TILES.inputSchema.parse(args);
    
    // Check for cached tiles first (much faster)
    const db = getDb();
    const cachedTiles = getCachedTiles(db, parsed.worldId);
    
    if (cachedTiles) {
        console.error(`[WorldGen] Returning cached tiles for world ${parsed.worldId}`);
        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify(cachedTiles) // Compact JSON - pretty-print causes stdio buffer issues
                }
            ]
        };
    }
    
    // No cache - need to restore/regenerate world
    console.error(`[WorldGen] No tile cache found, regenerating world ${parsed.worldId}`);
    const currentWorld = await getOrRestoreWorld(parsed.worldId, ctx.sessionId);

    if (!currentWorld) {
        throw new Error(`World ${parsed.worldId} not found.`);
    }

    // Build tile data
    const tileData = buildTileData(currentWorld);
    
    // Save to cache for future requests
    saveTilesToCache(db, parsed.worldId, tileData);

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(tileData) // Compact JSON - pretty-print causes stdio buffer issues
            }
        ]
    };
}

export async function handlePreviewMapPatch(args: unknown, ctx: SessionContext) {
    const parsed = Tools.PREVIEW_MAP_PATCH.inputSchema.parse(args);
    const currentWorld = await getOrRestoreWorld(parsed.worldId, ctx.sessionId);

    if (!currentWorld) {
        throw new Error(`World ${parsed.worldId} not found.`);
    }

    try {
        // Parse the DSL to validate it
        const commands = parseDSL(parsed.script);
        
        // Validate each command without applying
        const result = applyPatch(currentWorld, commands, { dryRun: true });

        // Return preview information
        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify({
                        valid: result.success,
                        commands: commands.map((cmd: any) => {
                            const preview: any = {
                                type: cmd.command
                            };

                            if ('x' in cmd.args && 'y' in cmd.args) {
                                preview.x = cmd.args.x;
                                preview.y = cmd.args.y;
                            }
                            if ('type' in cmd.args) {
                                preview.structureType = cmd.args.type;
                            }
                            if ('name' in cmd.args) {
                                preview.name = cmd.args.name;
                            }

                            return preview;
                        }),
                        commandCount: commands.length,
                        errors: result.errors,
                        warnings: result.warnings
                    }, null, 2)
                }
            ]
        };
    } catch (error: any) {
        throw new Error(`Invalid patch script: ${error.message}`);
    }
}

/**
 * Find valid POI locations based on terrain and preferences
 */
export async function handleFindValidPoiLocation(args: unknown, ctx: SessionContext) {
    const parsed = Tools.FIND_VALID_POI_LOCATION.inputSchema.parse(args);
    const currentWorld = await getOrRestoreWorld(parsed.worldId, ctx.sessionId);

    if (!currentWorld) {
        throw new Error(`World ${parsed.worldId} not found.`);
    }

    const { width, height, biomes, elevation, rivers, structures, regionMap } = currentWorld;
    const poiType = parsed.poiType as StructureType;
    const candidates: Array<{
        x: number;
        y: number;
        score: number;
        biome: string;
        elevation: number;
        nearWater: boolean;
        regionId: number;
    }> = [];

    // Build existing structure locations for distance checking
    const existingLocations = structures.map((s: any) => s.location);

    // Score all tiles
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const biome = biomes[y][x] as BiomeType;
            const elev = elevation[idx];
            const regionId = regionMap[idx];

            // Skip if region filter specified and doesn't match
            if (parsed.regionId !== undefined && regionId !== parsed.regionId) continue;

            // Check basic validity
            const validation = validateStructurePlacement(poiType, x, y, currentWorld);
            if (!validation.valid) continue;

            // Calculate score
            let score = 50; // Base score

            // Biome habitability
            score += BIOME_HABITABILITY[biome] || 0;

            // Preferred biomes bonus
            if (parsed.preferredBiomes?.includes(biome)) {
                score += 20;
            }

            // Near water bonus/check
            const nearWater = isNearWater(x, y, width, height, rivers, biomes);
            if (parsed.nearWater && nearWater) {
                score += 15;
            } else if (parsed.nearWater && !nearWater) {
                score -= 10; // Penalty if water required but not near
            }

            // Distance from existing POIs
            if (parsed.avoidExistingPOIs) {
                let tooClose = false;
                for (const loc of existingLocations) {
                    const dist = Math.sqrt((x - loc.x) ** 2 + (y - loc.y) ** 2);
                    if (dist < (parsed.minDistanceFromPOI || 5)) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;
            }

            // Elevation variety (mid-elevation is usually best for settlements)
            if (poiType === StructureType.CITY || poiType === StructureType.TOWN || poiType === StructureType.VILLAGE) {
                if (elev >= 20 && elev <= 60) score += 5;
            }

            // Dungeon prefers remote/harsh terrain
            if (poiType === StructureType.DUNGEON) {
                if (score < 50) score += 10; // Bonus for harsh terrain
            }

            candidates.push({
                x,
                y,
                score,
                biome,
                elevation: elev,
                nearWater,
                regionId
            });
        }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Return top N candidates
    const count = parsed.count || 3;
    const topCandidates = candidates.slice(0, count);

    if (topCandidates.length === 0) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify({
                        success: false,
                        message: `No valid locations found for ${poiType}`,
                        suggestedBiomes: getSuggestedBiomesForStructure(poiType)
                    }, null, 2)
                }
            ]
        };
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    success: true,
                    poiType,
                    candidates: topCandidates,
                    totalValidLocations: candidates.length,
                    hint: `Use these coordinates with apply_map_patch: ADD_STRUCTURE ${poiType} ${topCandidates[0].x} ${topCandidates[0].y}`
                }, null, 2)
            }
        ]
    };
}

/**
 * Check if a tile is near water (river or coast)
 */
function isNearWater(x: number, y: number, width: number, height: number, rivers: Uint8Array, biomes: BiomeType[][]): boolean {
    const searchRadius = 5;
    
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            
            const nIdx = ny * width + nx;
            
            // Check for river
            if (rivers[nIdx] > 0) return true;
            
            // Check for water biome (coast)
            if (WATER_BIOMES.includes(biomes[ny][nx])) return true;
        }
    }
    
    return false;
}

/**
 * Batch suggest POI locations
 */
export async function handleSuggestPoiLocations(args: unknown, ctx: SessionContext) {
    const parsed = Tools.SUGGEST_POI_LOCATIONS.inputSchema.parse(args);
    const currentWorld = await getOrRestoreWorld(parsed.worldId, ctx.sessionId);

    if (!currentWorld) {
        throw new Error(`World ${parsed.worldId} not found.`);
    }

    const results: Array<{
        poiType: string;
        locations: Array<{ x: number; y: number; score: number; biome: string }>;
    }> = [];

    // Track used locations to avoid overlap
    const usedLocations = new Set<string>();
    for (const structure of currentWorld.structures) {
        usedLocations.add(`${structure.location.x},${structure.location.y}`);
    }

    for (const request of parsed.requests) {
        // Find valid locations
        const locationResult = await handleFindValidPoiLocation({
            worldId: parsed.worldId,
            poiType: request.poiType,
            nearWater: request.nearWater,
            preferredBiomes: request.preferredBiomes,
            avoidExistingPOIs: true,
            count: request.count * 2 // Get extra candidates to filter
        }, ctx);

        // Parse the result
        const locationData = JSON.parse((locationResult.content[0] as any).text);
        
        if (locationData.success && locationData.candidates) {
            // Filter out already used locations
            const availableLocations = locationData.candidates.filter((loc: any) => {
                const key = `${loc.x},${loc.y}`;
                if (usedLocations.has(key)) return false;
                // Mark as used for subsequent requests
                usedLocations.add(key);
                return true;
            }).slice(0, request.count);

            results.push({
                poiType: request.poiType,
                locations: availableLocations.map((loc: any) => ({
                    x: loc.x,
                    y: loc.y,
                    score: loc.score,
                    biome: loc.biome
                }))
            });
        } else {
            results.push({
                poiType: request.poiType,
                locations: []
            });
        }
    }

    // Generate DSL script for convenience
    const dslLines: string[] = [];
    let poiIndex = 1;
    for (const result of results) {
        for (const loc of result.locations) {
            dslLines.push(`ADD_STRUCTURE ${result.poiType} ${loc.x} ${loc.y} "${result.poiType.charAt(0).toUpperCase() + result.poiType.slice(1)} ${poiIndex++}"`);
        }
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    success: true,
                    results,
                    suggestedDSL: dslLines.join('\n'),
                    hint: 'Copy the suggestedDSL to apply_map_patch to create all POIs at once'
                }, null, 2)
            }
        ]
    };
}

// Helper function for tests to clear world state
export function clearWorld() {
    // No-op for now, or could clear all worlds in manager
    // getWorldManager().clear(); // If we added a clear method
}
