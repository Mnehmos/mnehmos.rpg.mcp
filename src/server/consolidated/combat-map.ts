/**
 * Consolidated Combat Map Tool
 * Replaces 7 separate tools for visualization and terrain:
 * render_map, calculate_aoe, update_terrain, place_prop,
 * measure_distance, generate_terrain_patch, generate_terrain_pattern
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import {
    handleRenderMap,
    handleCalculateAoe,
    handleUpdateTerrain,
    handlePlaceProp,
    handleMeasureDistance,
    handleGenerateTerrainPatch,
    handleGenerateTerrainPattern
} from '../handlers/combat-handlers.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['render', 'aoe', 'update_terrain', 'place_prop', 'measure', 'generate_patch', 'generate_pattern'] as const;
type CombatMapAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const RenderSchema = z.object({
    action: z.literal('render'),
    encounterId: z.string(),
    width: z.number().int().min(5).max(50).default(20),
    height: z.number().int().min(5).max(50).default(20),
    showLegend: z.boolean().default(true)
});

const AoeSchema = z.object({
    action: z.literal('aoe'),
    encounterId: z.string(),
    shape: z.enum(['circle', 'cone', 'line']),
    origin: z.object({ x: z.number(), y: z.number() }),
    radius: z.number().optional(),
    direction: z.object({ x: z.number(), y: z.number() }).optional(),
    length: z.number().optional(),
    angle: z.number().optional()
});

const UpdateTerrainSchema = z.object({
    action: z.literal('update_terrain'),
    encounterId: z.string(),
    operation: z.enum(['add', 'remove']),
    terrainType: z.enum(['obstacles', 'difficultTerrain', 'water']),
    tiles: z.array(z.string()).optional(),
    ranges: z.array(z.string()).optional(),
    gridWidth: z.number().int().min(1).max(500).default(100),
    gridHeight: z.number().int().min(1).max(500).default(100)
});

const PlacePropSchema = z.object({
    action: z.literal('place_prop'),
    encounterId: z.string(),
    position: z.string(),
    label: z.string(),
    propType: z.enum(['structure', 'cover', 'climbable', 'hazard', 'interactive', 'decoration']),
    heightFeet: z.number().int().min(0).optional(),
    cover: z.enum(['none', 'half', 'three_quarter', 'full']).optional().default('none'),
    climbable: z.boolean().optional().default(false),
    climbDC: z.number().int().min(0).max(30).optional(),
    breakable: z.boolean().optional().default(false),
    hp: z.number().int().min(1).optional(),
    description: z.string().optional()
});

const MeasureSchema = z.object({
    action: z.literal('measure'),
    encounterId: z.string(),
    from: z.object({
        type: z.enum(['position', 'entity']),
        value: z.string()
    }),
    to: z.object({
        type: z.enum(['position', 'entity']),
        value: z.string()
    })
});

const GeneratePatchSchema = z.object({
    action: z.literal('generate_patch'),
    encounterId: z.string(),
    biome: z.enum(['forest', 'cave', 'village', 'dungeon', 'swamp', 'battlefield']),
    origin: z.object({ x: z.number().int(), y: z.number().int() }),
    width: z.number().int().min(5).max(100),
    height: z.number().int().min(5).max(100),
    density: z.number().min(0.1).max(1.0).default(0.5),
    seed: z.string().optional(),
    clearCenter: z.boolean().optional().default(false),
    pattern: z.enum(['river_valley', 'canyon', 'arena', 'mountain_pass']).optional()
});

const GeneratePatternSchema = z.object({
    action: z.literal('generate_pattern'),
    encounterId: z.string(),
    pattern: z.enum(['river_valley', 'canyon', 'arena', 'mountain_pass', 'maze', 'maze_rooms']),
    origin: z.object({ x: z.number().int(), y: z.number().int() }).default({ x: 0, y: 0 }),
    width: z.number().int().min(10).max(500).default(100),
    height: z.number().int().min(10).max(500).default(100),
    seed: z.string().optional(),
    corridorWidth: z.number().int().min(1).max(5).default(1),
    roomCount: z.number().int().min(0).max(20).default(5)
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT HOLDER
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ACTION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<CombatMapAction, ActionDefinition> = {
    render: {
        schema: RenderSchema,
        handler: async (params: z.infer<typeof RenderSchema>, ctx?: SessionContext) => {
            if (!ctx) throw new Error('No session context');
            const { action, ...renderParams } = params;
            const result = await handleRenderMap(renderParams, ctx);
            return extractResultData(result, 'render');
        },
        aliases: ['map', 'show_map', 'display', 'view']
    },

    aoe: {
        schema: AoeSchema,
        handler: async (params: z.infer<typeof AoeSchema>, ctx?: SessionContext) => {
            if (!ctx) throw new Error('No session context');
            const { action, ...aoeParams } = params;
            const result = await handleCalculateAoe(aoeParams, ctx);
            return extractResultData(result, 'aoe');
        },
        aliases: ['calculate_aoe', 'area', 'area_of_effect', 'blast']
    },

    update_terrain: {
        schema: UpdateTerrainSchema,
        handler: async (params: z.infer<typeof UpdateTerrainSchema>, ctx?: SessionContext) => {
            if (!ctx) throw new Error('No session context');
            const { action, ...terrainParams } = params;
            const result = await handleUpdateTerrain(terrainParams, ctx);
            return extractResultData(result, 'update_terrain');
        },
        aliases: ['terrain', 'modify_terrain', 'add_terrain', 'remove_terrain']
    },

    place_prop: {
        schema: PlacePropSchema,
        handler: async (params: z.infer<typeof PlacePropSchema>, ctx?: SessionContext) => {
            if (!ctx) throw new Error('No session context');
            const { action, ...propParams } = params;
            const result = await handlePlaceProp(propParams, ctx);
            return extractResultData(result, 'place_prop');
        },
        aliases: ['prop', 'add_prop', 'object', 'feature']
    },

    measure: {
        schema: MeasureSchema,
        handler: async (params: z.infer<typeof MeasureSchema>, ctx?: SessionContext) => {
            if (!ctx) throw new Error('No session context');
            const { action, ...measureParams } = params;
            const result = await handleMeasureDistance(measureParams, ctx);
            return extractResultData(result, 'measure');
        },
        aliases: ['distance', 'measure_distance', 'range', 'how_far']
    },

    generate_patch: {
        schema: GeneratePatchSchema,
        handler: async (params: z.infer<typeof GeneratePatchSchema>, ctx?: SessionContext) => {
            if (!ctx) throw new Error('No session context');
            const { action, ...patchParams } = params;
            const result = await handleGenerateTerrainPatch(patchParams, ctx);
            return extractResultData(result, 'generate_patch');
        },
        aliases: ['patch', 'gen_patch', 'biome']
    },

    generate_pattern: {
        schema: GeneratePatternSchema,
        handler: async (params: z.infer<typeof GeneratePatternSchema>, ctx?: SessionContext) => {
            if (!ctx) throw new Error('No session context');
            const { action, ...patternParams } = params;
            const result = await handleGenerateTerrainPattern(patternParams, ctx);
            return extractResultData(result, 'generate_pattern');
        },
        aliases: ['pattern', 'gen_pattern', 'maze', 'arena']
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function extractResultData(result: McpResponse, actionType: string): Record<string, unknown> {
    const text = result.content[0].text;

    // Try to extract JSON from various formats
    const jsonMatch = text.match(/<!-- (\w+_JSON)\n([\s\S]*?)\n\1 -->/);
    if (jsonMatch) {
        try {
            const data = JSON.parse(jsonMatch[2]);
            return {
                success: true,
                actionType,
                ...data,
                rawText: text.replace(/<!-- \w+_JSON[\s\S]*?\w+_JSON -->/, '').trim()
            };
        } catch {
            // Fall through
        }
    }

    // Return as success with text
    return {
        success: true,
        actionType,
        message: text
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER & TOOL DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

export const CombatMapTool = {
    name: 'combat_map',
    description: `Unified combat map and terrain operations. Actions: ${ACTIONS.join(', ')}.

🗺️ VISUALIZATION:
- render - ASCII map of combat state (positions, terrain, combatants)
- aoe - Calculate area of effect (circle/cone/line)
- measure - Distance between points or entities

🏔️ TERRAIN:
- update_terrain - Add/remove obstacles, difficult terrain, water
- place_prop - Add props (structures, cover, climbables, hazards)

🎲 GENERATION:
- generate_patch - Procedural terrain by biome (forest, cave, dungeon, etc.)
- generate_pattern - Geometric patterns (maze, arena, river_valley, canyon)

Use combat_manage for encounter lifecycle (create, end, advance).
Use combat_action for combat actions (attack, move, cast).`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        encounterId: z.string().describe('Encounter ID'),
        // Render params
        width: z.number().optional(),
        height: z.number().optional(),
        showLegend: z.boolean().optional(),
        // AoE params
        shape: z.enum(['circle', 'cone', 'line']).optional(),
        origin: z.object({ x: z.number(), y: z.number() }).optional(),
        radius: z.number().optional(),
        direction: z.object({ x: z.number(), y: z.number() }).optional(),
        length: z.number().optional(),
        angle: z.number().optional(),
        // Terrain params
        operation: z.enum(['add', 'remove']).optional(),
        terrainType: z.enum(['obstacles', 'difficultTerrain', 'water']).optional(),
        tiles: z.array(z.string()).optional(),
        ranges: z.array(z.string()).optional(),
        gridWidth: z.number().optional(),
        gridHeight: z.number().optional(),
        // Prop params
        position: z.string().optional(),
        label: z.string().optional(),
        propType: z.enum(['structure', 'cover', 'climbable', 'hazard', 'interactive', 'decoration']).optional(),
        heightFeet: z.number().optional(),
        cover: z.enum(['none', 'half', 'three_quarter', 'full']).optional(),
        climbable: z.boolean().optional(),
        climbDC: z.number().optional(),
        breakable: z.boolean().optional(),
        hp: z.number().optional(),
        description: z.string().optional(),
        // Measure params
        from: z.object({ type: z.enum(['position', 'entity']), value: z.string() }).optional(),
        to: z.object({ type: z.enum(['position', 'entity']), value: z.string() }).optional(),
        // Generation params
        biome: z.enum(['forest', 'cave', 'village', 'dungeon', 'swamp', 'battlefield']).optional(),
        pattern: z.enum(['river_valley', 'canyon', 'arena', 'mountain_pass', 'maze', 'maze_rooms']).optional(),
        density: z.number().optional(),
        seed: z.string().optional(),
        clearCenter: z.boolean().optional(),
        corridorWidth: z.number().optional(),
        roomCount: z.number().optional()
    })
};

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function handleCombatMap(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    try {
        const result = await router(args as Record<string, unknown>, ctx);
        const parsed = JSON.parse(result.content[0].text);

        let output = '';

        if (parsed.error) {
            output = RichFormatter.header('Error', '❌');
            output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
            if (parsed.suggestions) {
                output += '\n**Did you mean:**\n';
                parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                    output += `  • ${s.action} (${s.similarity}% match)\n`;
                });
            }
        } else {
            // Format based on action type
            switch (parsed.actionType) {
                case 'render':
                    output = RichFormatter.header('Combat Map', '🗺️');
                    break;
                case 'aoe':
                    output = RichFormatter.header('Area of Effect', '💥');
                    if (parsed.affectedTiles) {
                        output += RichFormatter.keyValue({
                            'Tiles Affected': parsed.affectedTiles.length,
                            'Entities Hit': parsed.affectedEntities?.length || 0
                        });
                    }
                    break;
                case 'measure':
                    output = RichFormatter.header('Distance', '📏');
                    if (parsed.distance !== undefined) {
                        output += RichFormatter.keyValue({ 'Distance': `${parsed.distance} ft` });
                    }
                    break;
                case 'update_terrain':
                    output = RichFormatter.header('Terrain Updated', '🏔️');
                    break;
                case 'place_prop':
                    output = RichFormatter.header('Prop Placed', '🏗️');
                    break;
                case 'generate_patch':
                    output = RichFormatter.header('Terrain Generated', '🌲');
                    break;
                case 'generate_pattern':
                    output = RichFormatter.header('Pattern Generated', '🔷');
                    break;
                default:
                    output = RichFormatter.header('Map Operation', '🗺️');
            }

            // Add raw text/map if present
            if (parsed.rawText) {
                output += '\n```\n' + parsed.rawText + '\n```\n';
            } else if (parsed.message && parsed.message.includes('\n')) {
                // Multi-line messages are likely ASCII art
                output += '\n```\n' + parsed.message + '\n```\n';
            } else if (parsed.message) {
                output += '\n' + parsed.message + '\n';
            }
        }

        output += RichFormatter.embedJson(parsed, 'COMBAT_MAP');

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
