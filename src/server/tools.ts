import { z } from 'zod';
import { generateWorld } from '../engine/worldgen/index.js';

import { PubSub } from '../engine/pubsub.js';

import { randomUUID } from 'crypto';
import { getWorldManager } from './state/world-manager.js';
import { SessionContext } from './types.js';
import { WorldRepository } from '../storage/repos/world.repo.js';
import { getDb } from '../storage/index.js';
import * as zlib from 'zlib';

// Global state for the server (in-memory for MVP)
let pubsub: PubSub | null = null;

export function setWorldPubSub(instance: PubSub) {
    pubsub = instance;
}

export const Tools = {
    GENERATE_WORLD: {
        name: 'generate_world',
        description: `Generates a new RPG world with the specified parameters.
        
Examples:
{
  "seed": "campaign-2024",
  "width": 50,
  "height": 50
}`,
        inputSchema: z.object({
            seed: z.string().describe('Seed for random number generation'),
            width: z.number().int().min(10).max(1000).describe('Width of the world grid'),
            height: z.number().int().min(10).max(1000).describe('Height of the world grid')
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
        description: `Applies a DSL patch script to the current world.

Supported Commands:
- ADD_STRUCTURE type x y (e.g., "ADD_STRUCTURE town 12 15")
- SET_BIOME type x y (e.g., "SET_BIOME forest 10 10")
- EDIT_TILE x y elevation (e.g., "EDIT_TILE 5 5 0.8")

Example Script:
ADD_STRUCTURE city 25 25
SET_BIOME mountain 26 25`,
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

export async function handleGenerateWorld(args: unknown, ctx: SessionContext) {
    const parsed = Tools.GENERATE_WORLD.inputSchema.parse(args);
    
    console.error(`[WorldGen] Generating world with seed "${parsed.seed}" (${parsed.width}x${parsed.height})`);
    const startTime = Date.now();
    
    const world = generateWorld({
        seed: parsed.seed,
        width: parsed.width,
        height: parsed.height
    });

    const genTime = Date.now() - startTime;
    console.error(`[WorldGen] World generated in ${genTime}ms`);

    const worldId = randomUUID();
    // Store with session namespace in runtime manager
    getWorldManager().create(`${ctx.sessionId}:${worldId}`, world);

    // Persist world metadata to database
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
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
    let world = manager.get(sessionKey);
    if (world) return world;

    // Try DB
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const worldRepo = new WorldRepository(db);
    const storedWorld = worldRepo.findById(worldId);

    if (!storedWorld) {
        return null;
    }

    // Re-generate world
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
    manager.create(sessionKey, world);
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
        applyPatch(currentWorld, commands);

        // Invalidate tile cache since world was modified
        const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
        invalidateTileCache(db, parsed.worldId);

        pubsub?.publish('world', {
            type: 'patch_applied',
            commandsExecuted: commands.length,
            timestamp: Date.now()
        });

        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify({
                        message: 'Patch applied successfully',
                        commandsExecuted: commands.length
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
                    text: `Failed to apply patch: ${error.message}`
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
                    riverTileCount: currentWorld.rivers.filter(r => r > 0).length
                }, null, 2)
            }
        ]
    };
}

export async function handleGetRegionMap(args: unknown, ctx: SessionContext) {
    const parsed = Tools.GET_REGION_MAP.inputSchema.parse(args);
    const currentWorld = await getOrRestoreWorld(parsed.worldId, ctx.sessionId);

    if (!currentWorld) {
        throw new Error(`World ${parsed.worldId} not found.`);
    }

    const regionId = parsed.regionId;

    // Find the region
    const region = currentWorld.regions.find(r => r.id === regionId);
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
    const structures = world.structures.filter(s => {
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
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
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

        // Return preview information without applying
        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify({
                        commands: commands.map(cmd => {
                            // Build a preview object based on command type
                            const preview: any = {
                                type: cmd.command
                            };

                            // Add specific args based on command type
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
                        willModify: commands.length > 0
                    }, null, 2)
                }
            ]
        };
    } catch (error: any) {
        throw new Error(`Invalid patch script: ${error.message}`);
    }
}

// Helper function for tests to clear world state
export function clearWorld() {
    // No-op for now, or could clear all worlds in manager
    // getWorldManager().clear(); // If we added a clear method
}
