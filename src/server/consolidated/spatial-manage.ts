/**
 * Consolidated Spatial Management Tool
 * Replaces 5 separate tools for spatial/room operations:
 * look_at_surroundings, generate_room_node, get_room_exits,
 * move_character_to_room, list_rooms
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import {
    handleLookAtSurroundings,
    handleGenerateRoomNode,
    handleUpdateRoomNode,
    handleGetRoomExits,
    handleMoveCharacterToRoom,
    handleListRooms,
    handleCreateNodeNetwork,
    handleGetNodeNetwork,
    handleListNodeNetworks
} from '../handlers/spatial-handlers.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = [
    'look',
    'generate',
    'update',
    'get_exits',
    'move',
    'list',
    'network_create',
    'network_get',
    'network_list'
] as const;
type SpatialAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT HOLDER
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const BiomeEnum = z.enum([
    'forest', 'mountain', 'urban', 'dungeon',
    'coastal', 'cavern', 'divine', 'arcane'
]);

const AtmosphericEnum = z.enum([
    'DARKNESS', 'FOG', 'ANTIMAGIC', 'SILENCE', 'BRIGHT', 'MAGICAL'
]);

const DirectionEnum = z.enum([
    'north', 'south', 'east', 'west', 'up', 'down',
    'northeast', 'northwest', 'southeast', 'southwest'
]);

const NetworkTypeEnum = z.enum(['cluster', 'linear']);

const BoundingBoxSchema = z.object({
    minX: z.number().int().min(0),
    maxX: z.number().int().min(0),
    minY: z.number().int().min(0),
    maxY: z.number().int().min(0)
});

const LookSchema = z.object({
    action: z.literal('look'),
    observerId: z.string().uuid().describe('ID of the character observing')
});

const GenerateSchema = z.object({
    action: z.literal('generate'),
    name: z.string().min(1).max(100).describe('Room name'),
    baseDescription: z.string().min(10).max(2000).describe('Detailed description'),
    biomeContext: BiomeEnum.describe('Biome/environment type'),
    atmospherics: z.array(AtmosphericEnum).default([]).describe('Environmental effects'),
    previousNodeId: z.string().uuid().optional().describe('Link from this room'),
    direction: DirectionEnum.optional().describe('Direction of exit from previous room'),
    networkId: z.string().uuid().optional().describe('Optional node network ID'),
    localX: z.number().int().min(0).optional().describe('Optional local X coordinate within node network'),
    localY: z.number().int().min(0).optional().describe('Optional local Y coordinate within node network')
});

const UpdateSchema = z.object({
    action: z.literal('update'),
    roomId: z.string().uuid().describe('Room ID'),
    name: z.string().min(1).max(100).optional().describe('Room name'),
    baseDescription: z.string().min(10).max(2000).optional().describe('Detailed description'),
    biomeContext: BiomeEnum.optional().describe('Biome/environment type'),
    atmospherics: z.array(AtmosphericEnum).optional().describe('Environmental effects')
});

const GetExitsSchema = z.object({
    action: z.literal('get_exits'),
    roomId: z.string().uuid().describe('Room ID')
});

const MoveSchema = z.object({
    action: z.literal('move'),
    characterId: z.string().uuid().describe('Character ID'),
    roomId: z.string().uuid().describe('Destination room ID'),
    networkId: z.string().uuid().optional().describe('Optional node network ID to assign to the room'),
    localX: z.number().int().min(0).optional().describe('Optional local X coordinate within node network'),
    localY: z.number().int().min(0).optional().describe('Optional local Y coordinate within node network')
});

const ListSchema = z.object({
    action: z.literal('list'),
    biome: BiomeEnum.optional().describe('Filter by biome')
});

const NetworkCreateSchema = z.object({
    action: z.literal('network_create'),
    name: z.string().min(1).max(100).describe('Network name'),
    networkType: NetworkTypeEnum.describe('Network shape'),
    worldId: z.string().min(1).describe('World ID'),
    centerX: z.number().int().min(0).describe('Center X coordinate'),
    centerY: z.number().int().min(0).describe('Center Y coordinate'),
    boundingBox: BoundingBoxSchema.optional().describe('Optional world-map bounding box')
});

const NetworkGetSchema = z.object({
    action: z.literal('network_get'),
    networkId: z.string().uuid().describe('Node network ID')
});

const NetworkListSchema = z.object({
    action: z.literal('network_list'),
    worldId: z.string().min(1).optional().describe('Optional world filter')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleLook(args: z.infer<typeof LookSchema>, ctx?: SessionContext): Promise<object> {
    if (!ctx) throw new Error('No session context');
    const result = await handleLookAtSurroundings({ observerId: args.observerId }, ctx);
    return extractResultData(result, 'look');
}

async function handleGenerate(args: z.infer<typeof GenerateSchema>, ctx?: SessionContext): Promise<object> {
    if (!ctx) throw new Error('No session context');
    const result = await handleGenerateRoomNode({
        name: args.name,
        baseDescription: args.baseDescription,
        biomeContext: args.biomeContext,
        atmospherics: args.atmospherics,
        previousNodeId: args.previousNodeId,
        direction: args.direction,
        networkId: args.networkId,
        localX: args.localX,
        localY: args.localY
    }, ctx);
    return extractResultData(result, 'generate');
}

async function handleUpdate(args: z.infer<typeof UpdateSchema>, ctx?: SessionContext): Promise<object> {
    if (!ctx) throw new Error('No session context');
    const result = await handleUpdateRoomNode({
        roomId: args.roomId,
        name: args.name,
        baseDescription: args.baseDescription,
        biomeContext: args.biomeContext,
        atmospherics: args.atmospherics
    }, ctx);
    return extractResultData(result, 'update');
}

async function handleGetExits(args: z.infer<typeof GetExitsSchema>, ctx?: SessionContext): Promise<object> {
    if (!ctx) throw new Error('No session context');
    const result = await handleGetRoomExits({ roomId: args.roomId }, ctx);
    return extractResultData(result, 'get_exits');
}

async function handleMove(args: z.infer<typeof MoveSchema>, ctx?: SessionContext): Promise<object> {
    if (!ctx) throw new Error('No session context');
    const result = await handleMoveCharacterToRoom({
        characterId: args.characterId,
        roomId: args.roomId,
        networkId: args.networkId,
        localX: args.localX,
        localY: args.localY
    }, ctx);
    return extractResultData(result, 'move');
}

async function handleList(args: z.infer<typeof ListSchema>, ctx?: SessionContext): Promise<object> {
    if (!ctx) throw new Error('No session context');
    const result = await handleListRooms({ biome: args.biome }, ctx);
    return extractResultData(result, 'list');
}

async function handleNetworkCreate(args: z.infer<typeof NetworkCreateSchema>, ctx?: SessionContext): Promise<object> {
    if (!ctx) throw new Error('No session context');
    const result = await handleCreateNodeNetwork({
        name: args.name,
        networkType: args.networkType,
        worldId: args.worldId,
        centerX: args.centerX,
        centerY: args.centerY,
        boundingBox: args.boundingBox
    }, ctx);
    return extractResultData(result, 'network_create');
}

async function handleNetworkGet(args: z.infer<typeof NetworkGetSchema>, ctx?: SessionContext): Promise<object> {
    if (!ctx) throw new Error('No session context');
    const result = await handleGetNodeNetwork({ networkId: args.networkId }, ctx);
    return extractResultData(result, 'network_get');
}

async function handleNetworkList(args: z.infer<typeof NetworkListSchema>, ctx?: SessionContext): Promise<object> {
    if (!ctx) throw new Error('No session context');
    const result = await handleListNodeNetworks({ worldId: args.worldId }, ctx);
    return extractResultData(result, 'network_list');
}

function extractResultData(result: McpResponse, actionType: string): Record<string, unknown> {
    try {
        const data = JSON.parse(result.content[0].text);
        return { actionType, ...data };
    } catch {
        return { success: false, actionType, rawData: result.content[0].text };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<SpatialAction, ActionDefinition> = {
    look: {
        schema: LookSchema,
        handler: handleLook,
        aliases: ['observe', 'surroundings', 'look_at'],
        description: 'Look at surroundings - filtered by darkness, fog, perception'
    },
    generate: {
        schema: GenerateSchema,
        handler: handleGenerate,
        aliases: ['create', 'room', 'new_room'],
        description: 'Create a persistent room with immutable description'
    },
    update: {
        schema: UpdateSchema,
        handler: handleUpdate,
        aliases: ['edit', 'patch'],
        description: 'Partially update room description, biome, or atmospherics'
    },
    get_exits: {
        schema: GetExitsSchema,
        handler: handleGetExits,
        aliases: ['exits', 'doors'],
        description: 'Get all exits from a room'
    },
    move: {
        schema: MoveSchema,
        handler: handleMove,
        aliases: ['enter', 'go', 'travel'],
        description: 'Move a character to a room'
    },
    list: {
        schema: ListSchema,
        handler: handleList,
        aliases: ['rooms', 'all_rooms'],
        description: 'List all rooms, optionally filtered by biome'
    },
    network_create: {
        schema: NetworkCreateSchema,
        handler: handleNetworkCreate,
        aliases: ['create_network'],
        description: 'Create a node network for a town, road, or dungeon'
    },
    network_get: {
        schema: NetworkGetSchema,
        handler: handleNetworkGet,
        aliases: ['get_network'],
        description: 'Get a node network by ID'
    },
    network_list: {
        schema: NetworkListSchema,
        handler: handleNetworkList,
        aliases: ['networks'],
        description: 'List node networks, optionally filtered by world'
    }
};

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION & HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export const SpatialManageTool = {
    name: 'spatial_manage',
    description: `Manage spatial graph - rooms, exits, and character locations.
Actions: look, generate, update, get_exits, move, list, network_create, network_get, network_list
Aliases: observe→look, create→generate, edit→update, exits→get_exits, enter→move, rooms→list, networks→network_list

🏠 SPATIAL WORKFLOW:
1. network_create - Create a spatial network for a town, dungeon, road, or region
2. generate - Create a new room with description, atmospherics, and optional local coordinates
3. update - Patch room description, biome, or atmospherics
4. look - View room from character's perspective (perception-filtered)
5. get_exits - Get all exits from a room
6. move - Move character to a room
7. list / network_list - List rooms or networks

Environmental effects: DARKNESS, FOG, ANTIMAGIC, SILENCE, BRIGHT, MAGICAL
Biomes: forest, mountain, urban, dungeon, coastal, cavern, divine, arcane`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        observerId: z.string().optional().describe('Observer character ID (for look)'),
        characterId: z.string().optional().describe('Character ID (for move)'),
        roomId: z.string().optional().describe('Room ID'),
        name: z.string().optional().describe('Room or network name'),
        baseDescription: z.string().optional().describe('Room description (for generate/update)'),
        biomeContext: BiomeEnum.optional().describe('Biome type'),
        atmospherics: z.array(AtmosphericEnum).optional(),
        previousNodeId: z.string().optional(),
        direction: DirectionEnum.optional(),
        biome: BiomeEnum.optional().describe('Filter biome (for list)'),
        networkId: z.string().optional().describe('Node network ID'),
        networkType: NetworkTypeEnum.optional().describe('Network shape'),
        worldId: z.string().optional().describe('World ID'),
        centerX: z.number().optional().describe('Network center X'),
        centerY: z.number().optional().describe('Network center Y'),
        boundingBox: BoundingBoxSchema.optional().describe('Network bounding box'),
        localX: z.number().optional().describe('Room local X within network'),
        localY: z.number().optional().describe('Room local Y within network')
    })
};

export async function handleSpatialManage(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    try {
        const result = await router(args as Record<string, unknown>, ctx);
        const parsed = JSON.parse(result.content[0].text);

        let output = '';

        if (parsed.error) {
            output = RichFormatter.header('Error', '❌');
            output += RichFormatter.alert(parsed.message || parsed.error || 'Unknown error', 'error');
            if (parsed.suggestions) {
                output += '\n**Did you mean:**\n';
                parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                    output += `  • ${s.action} (${s.similarity}% match)\n`;
                });
            }
        } else {
            switch (parsed.actionType) {
                case 'look':
                    output = RichFormatter.header(parsed.roomName || 'Surroundings', '👁️');
                    if (parsed.description) {
                        output += '\n' + parsed.description + '\n\n';
                    }
                    if (parsed.exits?.length > 0) {
                        output += '**Exits:**\n';
                        parsed.exits.forEach((e: { direction: string; description?: string; type: string }) => {
                            output += `  • ${e.direction}: ${e.description || e.type}\n`;
                        });
                    }
                    if (parsed.atmospherics?.length > 0) {
                        output += `\n**Atmospherics:** ${parsed.atmospherics.join(', ')}\n`;
                    }
                    break;
                case 'generate':
                    output = RichFormatter.header('Room Created', '🏠');
                    output += RichFormatter.keyValue({
                        'ID': `\`${parsed.roomId}\``,
                        'Name': parsed.name,
                        'Biome': parsed.biomeContext,
                        'Network': parsed.networkId ? `\`${parsed.networkId}\`` : 'None',
                        'Linked': parsed.linkedToPrevious ? '✅' : '❌'
                    });
                    break;
                case 'update':
                    output = RichFormatter.header('Room Updated', '🏠');
                    output += RichFormatter.keyValue({
                        'ID': `\`${parsed.roomId}\``,
                        'Name': parsed.name,
                        'Biome': parsed.biomeContext,
                        'Atmospherics': parsed.atmospherics?.join(', ') || 'None'
                    });
                    break;
                case 'get_exits':
                    output = RichFormatter.header(`Exits from ${parsed.roomName || 'Room'}`, '🚪');
                    if (parsed.exits?.length > 0) {
                        parsed.exits.forEach((e: { direction: string; targetNodeId: string; type: string }) => {
                            output += `  • **${e.direction}** → \`${e.targetNodeId}\` (${e.type})\n`;
                        });
                    } else {
                        output += 'No exits.\n';
                    }
                    break;
                case 'move':
                    output = RichFormatter.header('Character Moved', '🚶');
                    output += RichFormatter.keyValue({
                        'Character': parsed.characterName,
                        'To Room': parsed.newRoomName,
                        'Visit #': parsed.visitedCount
                    });
                    break;
                case 'list':
                    output = RichFormatter.header(`Rooms (${parsed.count})`, '🏠');
                    if (parsed.rooms?.length > 0) {
                        parsed.rooms.forEach((r: { name: string; id: string; biomeContext: string; exitCount: number; entityCount: number; visitedCount: number }) => {
                            output += `• **${r.name}** (\`${r.id}\`) - ${r.biomeContext}\n`;
                            output += `  Exits: ${r.exitCount} | Entities: ${r.entityCount} | Visits: ${r.visitedCount}\n`;
                        });
                    } else {
                        output += 'No rooms found.\n';
                    }
                    break;
                case 'network_create':
                    output = RichFormatter.header('Network Created', '🗺️');
                    output += RichFormatter.keyValue({
                        'ID': `\`${parsed.networkId}\``,
                        'Name': parsed.name,
                        'Type': parsed.networkType,
                        'World': parsed.worldId
                    });
                    break;
                case 'network_get':
                    output = RichFormatter.header(parsed.name || 'Network', '🗺️');
                    output += RichFormatter.keyValue({
                        'ID': `\`${parsed.networkId}\``,
                        'Type': parsed.networkType,
                        'World': parsed.worldId,
                        'Center': `${parsed.centerX}, ${parsed.centerY}`
                    });
                    break;
                case 'network_list':
                    output = RichFormatter.header(`Networks (${parsed.count})`, '🗺️');
                    if (parsed.networks?.length > 0) {
                        parsed.networks.forEach((n: { name: string; id: string; networkType: string; worldId: string }) => {
                            output += `• **${n.name}** (\`${n.id}\`) - ${n.networkType} / ${n.worldId}\n`;
                        });
                    } else {
                        output += 'No networks found.\n';
                    }
                    break;
                default:
                    output = RichFormatter.header('Spatial', '🏠');
                    if (parsed.message) output += parsed.message + '\n';
            }
        }

        output += RichFormatter.embedJson(parsed, 'SPATIAL_MANAGE');

        return {
            content: [{
                type: 'text' as const,
                text: output
            }]
        };
    } catch (error) {
        return {
            content: [{
                type: 'text' as const,
                text: RichFormatter.header('Error', '') +
                    RichFormatter.alert(error instanceof Error ? error.message : String(error), 'error')
            }]
        };
    }
}
