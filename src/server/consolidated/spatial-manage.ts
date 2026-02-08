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
    handleGetRoomExits,
    handleMoveCharacterToRoom,
    handleListRooms
} from '../handlers/spatial-handlers.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['look', 'generate', 'get_exits', 'move', 'list'] as const;
type SpatialAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT HOLDER
// ═══════════════════════════════════════════════════════════════════════════

let currentContext: SessionContext | null = null;

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
    direction: DirectionEnum.optional().describe('Direction of exit from previous room')
});

const GetExitsSchema = z.object({
    action: z.literal('get_exits'),
    roomId: z.string().uuid().describe('Room ID')
});

const MoveSchema = z.object({
    action: z.literal('move'),
    characterId: z.string().uuid().describe('Character ID'),
    roomId: z.string().uuid().describe('Destination room ID')
});

const ListSchema = z.object({
    action: z.literal('list'),
    biome: BiomeEnum.optional().describe('Filter by biome')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleLook(args: z.infer<typeof LookSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleLookAtSurroundings({ observerId: args.observerId }, currentContext);
    return extractResultData(result, 'look');
}

async function handleGenerate(args: z.infer<typeof GenerateSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleGenerateRoomNode({
        name: args.name,
        baseDescription: args.baseDescription,
        biomeContext: args.biomeContext,
        atmospherics: args.atmospherics,
        previousNodeId: args.previousNodeId,
        direction: args.direction
    }, currentContext);
    return extractResultData(result, 'generate');
}

async function handleGetExits(args: z.infer<typeof GetExitsSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleGetRoomExits({ roomId: args.roomId }, currentContext);
    return extractResultData(result, 'get_exits');
}

async function handleMove(args: z.infer<typeof MoveSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleMoveCharacterToRoom({
        characterId: args.characterId,
        roomId: args.roomId
    }, currentContext);
    return extractResultData(result, 'move');
}

async function handleList(args: z.infer<typeof ListSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleListRooms({ biome: args.biome }, currentContext);
    return extractResultData(result, 'list');
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
Actions: look, generate, get_exits, move, list
Aliases: observe→look, create→generate, exits→get_exits, enter→move, rooms→list

🏠 SPATIAL WORKFLOW:
1. generate - Create a new room with description and atmospherics
2. look - View room from character's perspective (perception-filtered)
3. get_exits - Get all exits from a room
4. move - Move character to a room
5. list - List all rooms in the graph

Environmental effects: DARKNESS, FOG, ANTIMAGIC, SILENCE, BRIGHT, MAGICAL
Biomes: forest, mountain, urban, dungeon, coastal, cavern, divine, arcane`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        observerId: z.string().optional().describe('Observer character ID (for look)'),
        characterId: z.string().optional().describe('Character ID (for move)'),
        roomId: z.string().optional().describe('Room ID'),
        name: z.string().optional().describe('Room name (for generate)'),
        baseDescription: z.string().optional().describe('Room description (for generate)'),
        biomeContext: BiomeEnum.optional().describe('Biome type'),
        atmospherics: z.array(AtmosphericEnum).optional(),
        previousNodeId: z.string().optional(),
        direction: DirectionEnum.optional(),
        biome: BiomeEnum.optional().describe('Filter biome (for list)')
    })
};

export async function handleSpatialManage(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    currentContext = ctx;

    try {
        const result = await router(args as Record<string, unknown>);
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
                        parsed.exits.forEach((e: any) => {
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
                        'Linked': parsed.linkedToPrevious ? '✅' : '❌'
                    });
                    break;
                case 'get_exits':
                    output = RichFormatter.header(`Exits from ${parsed.roomName || 'Room'}`, '🚪');
                    if (parsed.exits?.length > 0) {
                        parsed.exits.forEach((e: any) => {
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
                        parsed.rooms.forEach((r: any) => {
                            output += `• **${r.name}** (\`${r.id}\`) - ${r.biomeContext}\n`;
                            output += `  Exits: ${r.exitCount} | Entities: ${r.entityCount} | Visits: ${r.visitedCount}\n`;
                        });
                    } else {
                        output += 'No rooms found.\n';
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
    } finally {
        currentContext = null;
    }
}
