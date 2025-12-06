/**
 * POI & Map Visualization Tools
 *
 * MCP tools for:
 * - POI management (create, discover, link)
 * - Map visualization data export
 * - NodeNetwork CRUD operations
 * - Room discovery mechanics
 *
 * @module server/poi-tools
 */

import { z } from 'zod';
import { getDb } from '../storage/index.js';
import { POIRepository } from '../storage/repos/poi.repo.js';
import { SpatialRepository } from '../storage/repos/spatial.repo.js';
import { StructureRepository } from '../storage/repos/structure.repo.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { WorldRepository } from '../storage/repos/world.repo.js';
import { RegionRepository } from '../storage/repos/region.repo.js';
import {
    POI,
    POICategory,
    MapLayer,
    getIconForStructureType,
    getCategoryForStructureType
} from '../schema/poi.js';
import { NodeNetwork, Exit } from '../schema/spatial.js';
import { SessionContext } from './types.js';

// ============================================================
// TOOL DEFINITIONS
// ============================================================

export const POITools = {
    // POI Management
    CREATE_POI: {
        name: 'create_poi',
        description: 'Create a Point of Interest on the world map. Can be linked to structures and room networks.',
        inputSchema: z.object({
            worldId: z.string().describe('World ID'),
            x: z.number().int().min(0).describe('X coordinate on world map'),
            y: z.number().int().min(0).describe('Y coordinate on world map'),
            name: z.string().min(1).max(100).describe('POI name'),
            description: z.string().max(500).optional().describe('Brief description for map tooltip'),
            category: z.enum(['settlement', 'fortification', 'dungeon', 'landmark', 'religious', 'commercial', 'natural', 'hidden'])
                .describe('POI category'),
            icon: z.enum(['city', 'town', 'village', 'castle', 'fort', 'tower', 'dungeon', 'cave', 'ruins', 'temple', 'shrine', 'inn', 'market', 'mine', 'farm', 'camp', 'portal', 'monument', 'tree', 'mountain', 'lake', 'waterfall', 'bridge', 'crossroads', 'unknown'])
                .describe('Map icon'),
            discoveryState: z.enum(['unknown', 'rumored', 'discovered', 'explored', 'mapped']).default('unknown'),
            discoveryDC: z.number().int().min(0).max(30).optional()
                .describe('Perception DC to discover if hidden'),
            population: z.number().int().min(0).default(0),
            level: z.number().int().min(1).max(20).optional()
                .describe('Suggested level for dungeons'),
            tags: z.array(z.string()).default([])
        })
    },

    GET_POI: {
        name: 'get_poi',
        description: 'Get a POI by ID or coordinates',
        inputSchema: z.object({
            poiId: z.string().uuid().optional(),
            worldId: z.string().optional(),
            x: z.number().int().optional(),
            y: z.number().int().optional()
        })
    },

    DISCOVER_POI: {
        name: 'discover_poi',
        description: 'Mark a POI as discovered by a character. Rolls perception if discovery DC is set.',
        inputSchema: z.object({
            poiId: z.string().uuid().describe('POI to discover'),
            characterId: z.string().uuid().describe('Character discovering the POI'),
            autoSuccess: z.boolean().default(false)
                .describe('If true, skip perception check')
        })
    },

    LINK_POI_TO_NETWORK: {
        name: 'link_poi_to_network',
        description: 'Link a POI to a NodeNetwork (room graph) for navigation',
        inputSchema: z.object({
            poiId: z.string().uuid(),
            networkId: z.string().uuid(),
            entranceRoomId: z.string().uuid().optional()
                .describe('Entry room when visiting this POI')
        })
    },

    SYNC_STRUCTURES_TO_POIS: {
        name: 'sync_structures_to_pois',
        description: 'Create POIs from all world structures that don\'t have POI entries yet',
        inputSchema: z.object({
            worldId: z.string().describe('World to sync')
        })
    },

    // Map Visualization
    GET_MAP_VISUALIZATION: {
        name: 'get_map_visualization',
        description: 'Get complete map data for frontend rendering including terrain, regions, and POIs',
        inputSchema: z.object({
            worldId: z.string(),
            characterId: z.string().uuid().optional()
                .describe('If provided, filters POIs by discovery and shows player position'),
            includeHidden: z.boolean().default(false)
                .describe('If true, include hidden POIs (for DM view)')
        })
    },

    GET_POI_LAYERS: {
        name: 'get_poi_layers',
        description: 'Get POIs organized into layers by category for map rendering',
        inputSchema: z.object({
            worldId: z.string(),
            characterId: z.string().uuid().optional()
                .describe('If provided, only show discovered POIs'),
            categories: z.array(z.enum(['settlement', 'fortification', 'dungeon', 'landmark', 'religious', 'commercial', 'natural', 'hidden']))
                .optional()
                .describe('Filter to specific categories')
        })
    },

    // NodeNetwork Management
    CREATE_NETWORK: {
        name: 'create_node_network',
        description: 'Create a NodeNetwork (collection of rooms) at a world map location',
        inputSchema: z.object({
            worldId: z.string(),
            name: z.string().min(1).max(100),
            type: z.enum(['cluster', 'linear']).describe('cluster=town/dungeon, linear=road'),
            centerX: z.number().int().min(0).describe('World map X coordinate'),
            centerY: z.number().int().min(0).describe('World map Y coordinate'),
            boundingBox: z.object({
                minX: z.number().int(),
                maxX: z.number().int(),
                minY: z.number().int(),
                maxY: z.number().int()
            }).optional().describe('For large networks spanning multiple tiles')
        })
    },

    GET_NETWORK: {
        name: 'get_node_network',
        description: 'Get a NodeNetwork with all its rooms',
        inputSchema: z.object({
            networkId: z.string().uuid()
        })
    },

    LIST_NETWORKS: {
        name: 'list_node_networks',
        description: 'List all NodeNetworks in a world or region',
        inputSchema: z.object({
            worldId: z.string(),
            minX: z.number().int().optional(),
            maxX: z.number().int().optional(),
            minY: z.number().int().optional(),
            maxY: z.number().int().optional()
        })
    },

    // Room Discovery
    EXPLORE_ROOM: {
        name: 'explore_room',
        description: 'Character explores a room, potentially discovering hidden exits and secrets',
        inputSchema: z.object({
            characterId: z.string().uuid(),
            roomId: z.string().uuid(),
            searchType: z.enum(['quick', 'thorough']).default('quick')
                .describe('quick=passive perception, thorough=active investigation (takes time)')
        })
    },

    GET_ROOM_GRAPH: {
        name: 'get_room_graph',
        description: 'Get the complete room graph for a network, showing connections',
        inputSchema: z.object({
            networkId: z.string().uuid(),
            characterId: z.string().uuid().optional()
                .describe('If provided, only show discovered rooms/exits')
        })
    },

    LINK_ROOMS: {
        name: 'link_rooms',
        description: 'Create bidirectional exits between two rooms',
        inputSchema: z.object({
            room1Id: z.string().uuid(),
            room2Id: z.string().uuid(),
            direction1to2: z.enum(['north', 'south', 'east', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest']),
            exitType: z.enum(['OPEN', 'LOCKED', 'HIDDEN']).default('OPEN'),
            dc: z.number().int().min(5).max(30).optional(),
            description1to2: z.string().optional(),
            description2to1: z.string().optional(),
            travelTime: z.number().int().min(0).optional()
        })
    }
} as const;

// ============================================================
// HELPERS
// ============================================================

function getRepos() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return {
        poi: new POIRepository(db),
        spatial: new SpatialRepository(db),
        structure: new StructureRepository(db),
        character: new CharacterRepository(db),
        world: new WorldRepository(db),
        region: new RegionRepository(db)
    };
}

function rollD20(): number {
    return Math.floor(Math.random() * 20) + 1;
}

function getOppositeDirection(dir: string): string {
    const opposites: Record<string, string> = {
        'north': 'south',
        'south': 'north',
        'east': 'west',
        'west': 'east',
        'up': 'down',
        'down': 'up',
        'northeast': 'southwest',
        'southwest': 'northeast',
        'northwest': 'southeast',
        'southeast': 'northwest'
    };
    return opposites[dir] || 'south';
}

// ============================================================
// HANDLERS
// ============================================================

export async function handleCreatePOI(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.CREATE_POI.inputSchema.parse(args);
    const { poi: poiRepo, region: regionRepo } = getRepos();

    // Check if POI already exists at these coordinates
    const existing = poiRepo.findByCoordinates(parsed.worldId, parsed.x, parsed.y);
    if (existing) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: false,
                    error: `POI already exists at (${parsed.x}, ${parsed.y}): ${existing.name}`
                }, null, 2)
            }]
        };
    }

    // Find region if any
    const regions = regionRepo.findByWorldId(parsed.worldId);
    const region = regions.find(r =>
        Math.abs(r.centerX - parsed.x) < 20 && Math.abs(r.centerY - parsed.y) < 20
    );

    const newPOI: POI = {
        id: crypto.randomUUID(),
        worldId: parsed.worldId,
        regionId: region?.id,
        x: parsed.x,
        y: parsed.y,
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        icon: parsed.icon,
        discoveryState: parsed.discoveryState,
        discoveredBy: [],
        discoveryDC: parsed.discoveryDC,
        childPOIIds: [],
        population: parsed.population,
        level: parsed.level,
        tags: parsed.tags,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    poiRepo.create(newPOI);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                poi: {
                    id: newPOI.id,
                    name: newPOI.name,
                    x: newPOI.x,
                    y: newPOI.y,
                    category: newPOI.category,
                    icon: newPOI.icon,
                    discoveryState: newPOI.discoveryState
                }
            }, null, 2)
        }]
    };
}

export async function handleGetPOI(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.GET_POI.inputSchema.parse(args);
    const { poi: poiRepo } = getRepos();

    let poi: POI | null = null;

    if (parsed.poiId) {
        poi = poiRepo.findById(parsed.poiId);
    } else if (parsed.worldId && parsed.x !== undefined && parsed.y !== undefined) {
        poi = poiRepo.findByCoordinates(parsed.worldId, parsed.x, parsed.y);
    }

    if (!poi) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'POI not found' }, null, 2)
            }]
        };
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, poi }, null, 2)
        }]
    };
}

export async function handleDiscoverPOI(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.DISCOVER_POI.inputSchema.parse(args);
    const { poi: poiRepo, character: charRepo } = getRepos();

    const poi = poiRepo.findById(parsed.poiId);
    if (!poi) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'POI not found' }, null, 2)
            }]
        };
    }

    const character = charRepo.findById(parsed.characterId);
    if (!character) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'Character not found' }, null, 2)
            }]
        };
    }

    // Check if already discovered
    if (poi.discoveredBy.includes(parsed.characterId)) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: true,
                    alreadyDiscovered: true,
                    poi: { id: poi.id, name: poi.name }
                }, null, 2)
            }]
        };
    }

    // Roll perception if needed
    if (!parsed.autoSuccess && poi.discoveryDC) {
        const wisModifier = Math.floor((character.stats.wis - 10) / 2);
        const perceptionBonus = (character as any).perceptionBonus || 0;
        const roll = rollD20();
        const total = roll + wisModifier + perceptionBonus;

        if (total < poi.discoveryDC) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        success: false,
                        discovered: false,
                        roll: { d20: roll, modifier: wisModifier + perceptionBonus, total, dc: poi.discoveryDC },
                        message: `${character.name} fails to notice anything unusual.`
                    }, null, 2)
                }]
            };
        }
    }

    // Discover the POI
    const updated = poiRepo.discoverPOI(parsed.poiId, parsed.characterId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                discovered: true,
                poi: {
                    id: updated?.id,
                    name: updated?.name,
                    description: updated?.description,
                    category: updated?.category
                },
                message: `${character.name} discovers ${poi.name}!`
            }, null, 2)
        }]
    };
}

export async function handleLinkPOIToNetwork(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.LINK_POI_TO_NETWORK.inputSchema.parse(args);
    const { poi: poiRepo, spatial: spatialRepo } = getRepos();

    const poi = poiRepo.findById(parsed.poiId);
    if (!poi) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'POI not found' }, null, 2)
            }]
        };
    }

    const network = spatialRepo.findNetworkById(parsed.networkId);
    if (!network) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'Network not found' }, null, 2)
            }]
        };
    }

    // Verify entrance room if specified
    if (parsed.entranceRoomId) {
        const room = spatialRepo.findById(parsed.entranceRoomId);
        if (!room) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ success: false, error: 'Entrance room not found' }, null, 2)
                }]
            };
        }
    }

    const updated = poiRepo.linkToNetwork(parsed.poiId, parsed.networkId, parsed.entranceRoomId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                poi: {
                    id: updated?.id,
                    name: updated?.name,
                    networkId: updated?.networkId,
                    entranceRoomId: updated?.entranceRoomId
                }
            }, null, 2)
        }]
    };
}

export async function handleSyncStructuresToPOIs(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.SYNC_STRUCTURES_TO_POIS.inputSchema.parse(args);
    const { poi: poiRepo, structure: structureRepo } = getRepos();

    const structures = structureRepo.findByWorldId(parsed.worldId);
    const existingPOIs = poiRepo.findByWorldId(parsed.worldId);
    const existingStructureIds = new Set(existingPOIs.map(p => p.structureId).filter(Boolean));

    const created: Array<{ id: string; name: string; x: number; y: number }> = [];

    for (const structure of structures) {
        if (existingStructureIds.has(structure.id)) continue;

        // Check if POI exists at same coordinates
        const existingAtCoords = poiRepo.findByCoordinates(parsed.worldId, structure.x, structure.y);
        if (existingAtCoords) {
            // Link existing POI to structure
            poiRepo.linkToStructure(existingAtCoords.id, structure.id);
            continue;
        }

        // Create new POI from structure
        const newPOI: POI = {
            id: crypto.randomUUID(),
            worldId: parsed.worldId,
            regionId: structure.regionId,
            x: structure.x,
            y: structure.y,
            name: structure.name,
            category: getCategoryForStructureType(structure.type),
            icon: getIconForStructureType(structure.type),
            structureId: structure.id,
            discoveryState: 'discovered', // Structures are visible on map
            discoveredBy: [],
            childPOIIds: [],
            population: structure.population,
            tags: [structure.type],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        poiRepo.create(newPOI);
        created.push({ id: newPOI.id, name: newPOI.name, x: newPOI.x, y: newPOI.y });
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                synced: created.length,
                created
            }, null, 2)
        }]
    };
}

export async function handleGetMapVisualization(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.GET_MAP_VISUALIZATION.inputSchema.parse(args);
    const { poi: poiRepo, world: worldRepo, region: regionRepo, character: charRepo } = getRepos();

    const world = worldRepo.findById(parsed.worldId);
    if (!world) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'World not found' }, null, 2)
            }]
        };
    }

    // Get POIs filtered by discovery state
    let pois = poiRepo.findByWorldId(parsed.worldId);

    if (parsed.characterId && !parsed.includeHidden) {
        // Filter to discovered POIs
        pois = pois.filter(p =>
            p.discoveryState !== 'unknown' ||
            p.discoveredBy.includes(parsed.characterId!)
        );
    }

    // Get regions with colors
    const regions = regionRepo.findByWorldId(parsed.worldId);

    // Build POI layers by category
    const layerMap = new Map<POICategory, MapLayer>();

    for (const poi of pois) {
        if (!layerMap.has(poi.category)) {
            layerMap.set(poi.category, {
                layerId: poi.category,
                layerName: poi.category.charAt(0).toUpperCase() + poi.category.slice(1) + 's',
                visible: true,
                opacity: 1,
                pois: []
            });
        }

        layerMap.get(poi.category)!.pois.push({
            id: poi.id,
            x: poi.x,
            y: poi.y,
            name: poi.discoveryState === 'unknown' ? '?' : poi.name,
            icon: poi.discoveryState === 'unknown' ? 'unknown' : poi.icon,
            category: poi.category,
            discoveryState: poi.discoveryState,
            hasNetwork: !!poi.networkId,
            population: poi.population || undefined
        });
    }

    // Get player position if character provided
    let playerPosition;
    if (parsed.characterId) {
        const character = charRepo.findById(parsed.characterId);
        if (character) {
            // Try to find character's current network/room position
            const currentRoomId = (character as any).currentRoomId;
            if (currentRoomId) {
                const { spatial: spatialRepo } = getRepos();
                const room = spatialRepo.findById(currentRoomId);
                if (room?.networkId) {
                    const network = spatialRepo.findNetworkById(room.networkId);
                    if (network) {
                        playerPosition = {
                            characterId: parsed.characterId,
                            x: network.centerX,
                            y: network.centerY,
                            roomId: currentRoomId
                        };
                    }
                }
            }
        }
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                worldId: world.id,
                worldName: world.name,
                width: world.width,
                height: world.height,
                regions: regions.map(r => ({
                    id: r.id,
                    name: r.name,
                    type: r.type,
                    centerX: r.centerX,
                    centerY: r.centerY,
                    color: r.color
                })),
                poiLayers: Array.from(layerMap.values()),
                playerPosition,
                totalPOIs: pois.length
            }, null, 2)
        }]
    };
}

export async function handleGetPOILayers(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.GET_POI_LAYERS.inputSchema.parse(args);
    const { poi: poiRepo } = getRepos();

    let pois = poiRepo.findByWorldId(parsed.worldId);

    // Filter by discovery
    if (parsed.characterId) {
        pois = pois.filter(p =>
            p.discoveryState !== 'unknown' ||
            p.discoveredBy.includes(parsed.characterId!)
        );
    }

    // Filter by categories
    if (parsed.categories) {
        const categorySet = new Set(parsed.categories);
        pois = pois.filter(p => categorySet.has(p.category));
    }

    // Group by category
    const layers: MapLayer[] = [];
    const byCategory = new Map<POICategory, POI[]>();

    for (const poi of pois) {
        if (!byCategory.has(poi.category)) {
            byCategory.set(poi.category, []);
        }
        byCategory.get(poi.category)!.push(poi);
    }

    for (const [category, categoryPOIs] of byCategory) {
        layers.push({
            layerId: category,
            layerName: category.charAt(0).toUpperCase() + category.slice(1) + 's',
            visible: true,
            opacity: 1,
            pois: categoryPOIs.map(p => ({
                id: p.id,
                x: p.x,
                y: p.y,
                name: p.discoveryState === 'unknown' ? '?' : p.name,
                icon: p.discoveryState === 'unknown' ? 'unknown' : p.icon,
                category: p.category,
                discoveryState: p.discoveryState,
                hasNetwork: !!p.networkId,
                population: p.population || undefined
            }))
        });
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, layers }, null, 2)
        }]
    };
}

export async function handleCreateNetwork(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.CREATE_NETWORK.inputSchema.parse(args);
    const { spatial: spatialRepo } = getRepos();

    const network: NodeNetwork = {
        id: crypto.randomUUID(),
        name: parsed.name,
        type: parsed.type,
        worldId: parsed.worldId,
        centerX: parsed.centerX,
        centerY: parsed.centerY,
        boundingBox: parsed.boundingBox,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    spatialRepo.createNetwork(network);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                network: {
                    id: network.id,
                    name: network.name,
                    type: network.type,
                    centerX: network.centerX,
                    centerY: network.centerY
                }
            }, null, 2)
        }]
    };
}

export async function handleGetNetwork(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.GET_NETWORK.inputSchema.parse(args);
    const { spatial: spatialRepo, poi: poiRepo } = getRepos();

    const network = spatialRepo.findNetworkById(parsed.networkId);
    if (!network) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'Network not found' }, null, 2)
            }]
        };
    }

    const rooms = spatialRepo.findRoomsByNetwork(parsed.networkId);
    const linkedPOI = poiRepo.findByNetworkId(parsed.networkId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                network,
                linkedPOI: linkedPOI ? { id: linkedPOI.id, name: linkedPOI.name } : null,
                rooms: rooms.map(r => ({
                    id: r.id,
                    name: r.name,
                    biomeContext: r.biomeContext,
                    localX: r.localX,
                    localY: r.localY,
                    exitCount: r.exits.length,
                    entityCount: r.entityIds.length,
                    visitedCount: r.visitedCount
                })),
                roomCount: rooms.length
            }, null, 2)
        }]
    };
}

export async function handleListNetworks(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.LIST_NETWORKS.inputSchema.parse(args);
    const { spatial: spatialRepo } = getRepos();

    let networks: NodeNetwork[];

    if (parsed.minX !== undefined && parsed.maxX !== undefined &&
        parsed.minY !== undefined && parsed.maxY !== undefined) {
        networks = spatialRepo.findNetworksInBoundingBox(
            parsed.minX, parsed.maxX, parsed.minY, parsed.maxY
        );
    } else {
        // Get all networks in world via bounding box query with world size
        networks = spatialRepo.findNetworksInBoundingBox(0, 10000, 0, 10000);
        networks = networks.filter(n => n.worldId === parsed.worldId);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                networks: networks.map(n => ({
                    id: n.id,
                    name: n.name,
                    type: n.type,
                    centerX: n.centerX,
                    centerY: n.centerY,
                    boundingBox: n.boundingBox
                })),
                count: networks.length
            }, null, 2)
        }]
    };
}

export async function handleExploreRoom(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.EXPLORE_ROOM.inputSchema.parse(args);
    const { spatial: spatialRepo, character: charRepo } = getRepos();

    const character = charRepo.findById(parsed.characterId);
    if (!character) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'Character not found' }, null, 2)
            }]
        };
    }

    const room = spatialRepo.findById(parsed.roomId);
    if (!room) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'Room not found' }, null, 2)
            }]
        };
    }

    // Calculate perception modifier
    const wisModifier = Math.floor((character.stats.wis - 10) / 2);
    const perceptionBonus = (character as any).perceptionBonus || 0;
    const totalPerception = wisModifier + perceptionBonus;

    // For thorough search, add Investigation bonus and advantage
    const investigationBonus = parsed.searchType === 'thorough'
        ? Math.floor((character.stats.int - 10) / 2)
        : 0;

    const roll1 = rollD20();
    const roll2 = parsed.searchType === 'thorough' ? rollD20() : roll1;
    const bestRoll = Math.max(roll1, roll2);
    const total = bestRoll + totalPerception + investigationBonus;

    // Check for hidden exits
    const hiddenExitsFound: Exit[] = [];
    for (const exit of room.exits) {
        if (exit.type === 'HIDDEN' && exit.dc) {
            if (total >= exit.dc) {
                hiddenExitsFound.push(exit);
            }
        }
    }

    // Check for locked exits (reveal their existence)
    const lockedExits = room.exits.filter(e => e.type === 'LOCKED');

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                roomId: room.id,
                roomName: room.name,
                searchType: parsed.searchType,
                roll: {
                    d20: bestRoll,
                    perceptionMod: totalPerception,
                    investigationMod: investigationBonus,
                    total
                },
                discoveries: {
                    hiddenExits: hiddenExitsFound.map(e => ({
                        direction: e.direction,
                        description: e.description || `A hidden passage leads ${e.direction}`,
                        dc: e.dc
                    })),
                    lockedExits: lockedExits.map(e => ({
                        direction: e.direction,
                        description: e.description || `A locked passage leads ${e.direction}`
                    }))
                },
                timeTaken: parsed.searchType === 'thorough' ? '10 minutes' : 'instant'
            }, null, 2)
        }]
    };
}

export async function handleGetRoomGraph(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.GET_ROOM_GRAPH.inputSchema.parse(args);
    const { spatial: spatialRepo } = getRepos();

    const network = spatialRepo.findNetworkById(parsed.networkId);
    if (!network) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'Network not found' }, null, 2)
            }]
        };
    }

    const rooms = spatialRepo.findRoomsByNetwork(parsed.networkId);

    // Build adjacency list
    const nodes = rooms.map(r => ({
        id: r.id,
        name: r.name,
        biome: r.biomeContext,
        localX: r.localX,
        localY: r.localY,
        atmospherics: r.atmospherics,
        entityCount: r.entityIds.length,
        visitedCount: r.visitedCount
    }));

    const edges: Array<{
        from: string;
        to: string;
        direction: string;
        type: string;
        bidirectional: boolean;
    }> = [];

    const edgeSet = new Set<string>();

    for (const room of rooms) {
        for (const exit of room.exits) {
            // Skip hidden exits if filtering by character (and not discovered)
            // For now, show all exits in graph view

            const edgeKey = [room.id, exit.targetNodeId].sort().join('|');
            if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);

                // Check if bidirectional
                const targetRoom = rooms.find(r => r.id === exit.targetNodeId);
                const isBidirectional = targetRoom?.exits.some(e => e.targetNodeId === room.id) || false;

                edges.push({
                    from: room.id,
                    to: exit.targetNodeId,
                    direction: exit.direction,
                    type: exit.type,
                    bidirectional: isBidirectional
                });
            }
        }
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                network: {
                    id: network.id,
                    name: network.name,
                    type: network.type
                },
                graph: {
                    nodes,
                    edges
                },
                stats: {
                    nodeCount: nodes.length,
                    edgeCount: edges.length
                }
            }, null, 2)
        }]
    };
}

export async function handleLinkRooms(args: unknown, _ctx: SessionContext) {
    const parsed = POITools.LINK_ROOMS.inputSchema.parse(args);
    const { spatial: spatialRepo } = getRepos();

    const room1 = spatialRepo.findById(parsed.room1Id);
    const room2 = spatialRepo.findById(parsed.room2Id);

    if (!room1) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'Room 1 not found' }, null, 2)
            }]
        };
    }

    if (!room2) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'Room 2 not found' }, null, 2)
            }]
        };
    }

    // Create exit from room1 to room2
    const exit1to2: Exit = {
        direction: parsed.direction1to2 as Exit['direction'],
        targetNodeId: parsed.room2Id,
        type: parsed.exitType,
        dc: parsed.dc,
        description: parsed.description1to2,
        travelTime: parsed.travelTime
    };

    // Create exit from room2 to room1 (opposite direction)
    const exit2to1: Exit = {
        direction: getOppositeDirection(parsed.direction1to2) as Exit['direction'],
        targetNodeId: parsed.room1Id,
        type: parsed.exitType,
        dc: parsed.dc,
        description: parsed.description2to1,
        travelTime: parsed.travelTime
    };

    spatialRepo.addExit(parsed.room1Id, exit1to2);
    spatialRepo.addExit(parsed.room2Id, exit2to1);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                link: {
                    room1: { id: room1.id, name: room1.name },
                    room2: { id: room2.id, name: room2.name },
                    direction: parsed.direction1to2,
                    reverseDirection: getOppositeDirection(parsed.direction1to2),
                    exitType: parsed.exitType
                }
            }, null, 2)
        }]
    };
}
