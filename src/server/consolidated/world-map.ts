/**
 * Consolidated World Map Tool
 * Replaces 7 separate tools for world map operations:
 * get_world_map_overview, get_region_map, get_world_tiles, apply_map_patch,
 * preview_map_patch, find_valid_poi_location, suggest_poi_locations
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import {
    handleGetWorldMapOverview,
    handleGetRegionMap,
    handleGetWorldTiles,
    handleApplyMapPatch,
    handlePreviewMapPatch,
    handleFindValidPoiLocation,
    handleSuggestPoiLocations
} from '../tools.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['overview', 'region', 'tiles', 'patch', 'preview', 'find_poi', 'suggest_poi'] as const;
type WorldMapAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT HOLDER
// ═══════════════════════════════════════════════════════════════════════════

let currentContext: SessionContext | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const OverviewSchema = z.object({
    action: z.literal('overview'),
    worldId: z.string().describe('World ID')
});

const RegionSchema = z.object({
    action: z.literal('region'),
    worldId: z.string().describe('World ID'),
    regionId: z.number().int().min(0).describe('Region ID')
});

const TilesSchema = z.object({
    action: z.literal('tiles'),
    worldId: z.string().describe('World ID')
});

const PatchSchema = z.object({
    action: z.literal('patch'),
    worldId: z.string().describe('World ID'),
    script: z.string().describe('DSL patch script')
});

const PreviewSchema = z.object({
    action: z.literal('preview'),
    worldId: z.string().describe('World ID'),
    script: z.string().describe('DSL patch script to preview')
});

const FindPoiSchema = z.object({
    action: z.literal('find_poi'),
    worldId: z.string().describe('World ID'),
    poiType: z.enum(['city', 'town', 'village', 'castle', 'ruins', 'dungeon', 'temple']).describe('Type of POI'),
    nearWater: z.boolean().optional().describe('Prefer locations near water'),
    preferredBiomes: z.array(z.string()).optional().describe('Preferred biome types'),
    avoidExistingPOIs: z.boolean().optional().default(true),
    minDistanceFromPOI: z.number().optional().default(5),
    regionId: z.number().optional().describe('Limit search to region'),
    count: z.number().int().min(1).max(10).optional().default(3)
});

const SuggestPoiSchema = z.object({
    action: z.literal('suggest_poi'),
    worldId: z.string().describe('World ID'),
    requests: z.array(z.object({
        poiType: z.enum(['city', 'town', 'village', 'castle', 'ruins', 'dungeon', 'temple']),
        count: z.number().int().min(1).max(10).default(1),
        nearWater: z.boolean().optional(),
        preferredBiomes: z.array(z.string()).optional()
    })).describe('List of POI placement requests')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleOverview(args: z.infer<typeof OverviewSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleGetWorldMapOverview({ worldId: args.worldId }, currentContext);
    return extractResultData(result, 'overview');
}

async function handleRegion(args: z.infer<typeof RegionSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleGetRegionMap({
        worldId: args.worldId,
        regionId: args.regionId
    }, currentContext);
    return extractResultData(result, 'region');
}

async function handleTiles(args: z.infer<typeof TilesSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleGetWorldTiles({ worldId: args.worldId }, currentContext);
    return extractResultData(result, 'tiles');
}

async function handlePatch(args: z.infer<typeof PatchSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleApplyMapPatch({
        worldId: args.worldId,
        script: args.script
    }, currentContext);
    return extractResultData(result, 'patch');
}

async function handlePreview(args: z.infer<typeof PreviewSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handlePreviewMapPatch({
        worldId: args.worldId,
        script: args.script
    }, currentContext);
    return extractResultData(result, 'preview');
}

async function handleFindPoi(args: z.infer<typeof FindPoiSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleFindValidPoiLocation({
        worldId: args.worldId,
        poiType: args.poiType,
        nearWater: args.nearWater,
        preferredBiomes: args.preferredBiomes,
        avoidExistingPOIs: args.avoidExistingPOIs,
        minDistanceFromPOI: args.minDistanceFromPOI,
        regionId: args.regionId,
        count: args.count
    }, currentContext);
    return extractResultData(result, 'find_poi');
}

async function handleSuggestPoi(args: z.infer<typeof SuggestPoiSchema>): Promise<object> {
    if (!currentContext) throw new Error('No session context');
    const result = await handleSuggestPoiLocations({
        worldId: args.worldId,
        requests: args.requests
    }, currentContext);
    return extractResultData(result, 'suggest_poi');
}

function extractResultData(result: McpResponse, actionType: string): Record<string, unknown> {
    try {
        const data = JSON.parse(result.content[0].text);
        return { success: true, actionType, ...data };
    } catch {
        return { success: true, actionType, rawData: result.content[0].text };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<WorldMapAction, ActionDefinition> = {
    overview: {
        schema: OverviewSchema,
        handler: handleOverview,
        aliases: ['summary', 'stats'],
        description: 'Get world map overview with biome distribution and statistics'
    },
    region: {
        schema: RegionSchema,
        handler: handleRegion,
        aliases: ['get_region', 'region_map'],
        description: 'Get detailed region map with tiles and structures'
    },
    tiles: {
        schema: TilesSchema,
        handler: handleTiles,
        aliases: ['grid', 'get_tiles'],
        description: 'Get full tile grid for rendering'
    },
    patch: {
        schema: PatchSchema,
        handler: handlePatch,
        aliases: ['apply', 'modify'],
        description: 'Apply DSL patch script to modify world map'
    },
    preview: {
        schema: PreviewSchema,
        handler: handlePreview,
        aliases: ['dry_run', 'preview_patch'],
        description: 'Preview what a patch would do without applying'
    },
    find_poi: {
        schema: FindPoiSchema,
        handler: handleFindPoi,
        aliases: ['find_location', 'locate'],
        description: 'Find valid locations for placing a POI/structure'
    },
    suggest_poi: {
        schema: SuggestPoiSchema,
        handler: handleSuggestPoi,
        aliases: ['batch_poi', 'suggest_locations'],
        description: 'Batch suggest locations for multiple POI types'
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

export const WorldMapTool = {
    name: 'world_map',
    description: `World map operations - viewing, rendering, and modification.
Actions: overview, region, tiles, patch, preview, find_poi, suggest_poi
Aliases: summary→overview, grid→tiles, apply→patch, dry_run→preview, locate→find_poi

🗺️ MAP WORKFLOW:
1. overview - Get high-level world stats
2. region - View specific region details
3. tiles - Get full tile grid for rendering
4. find_poi - Find valid POI placement locations
5. patch - Apply modifications via DSL script
6. preview - Preview changes before applying

For world creation/management, use world_manage tool instead.`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        worldId: z.string().describe('World ID'),
        regionId: z.number().optional().describe('Region ID (for region action)'),
        script: z.string().optional().describe('DSL patch script'),
        poiType: z.enum(['city', 'town', 'village', 'castle', 'ruins', 'dungeon', 'temple']).optional(),
        nearWater: z.boolean().optional(),
        preferredBiomes: z.array(z.string()).optional(),
        avoidExistingPOIs: z.boolean().optional(),
        minDistanceFromPOI: z.number().optional(),
        count: z.number().optional(),
        requests: z.array(z.any()).optional()
    })
};

export async function handleWorldMap(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    currentContext = ctx;

    try {
        const result = await router(args as Record<string, unknown>);
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
            switch (parsed.actionType) {
                case 'overview':
                    output = RichFormatter.header('World Map Overview', '🗺️');
                    if (parsed.dimensions) {
                        output += RichFormatter.keyValue({
                            'Dimensions': `${parsed.dimensions.width}x${parsed.dimensions.height}`,
                            'Regions': parsed.regionCount,
                            'Structures': parsed.structureCount,
                            'River Tiles': parsed.riverTileCount
                        });
                    }
                    if (parsed.biomeDistribution) {
                        output += '\n**Biome Distribution:**\n';
                        for (const [biome, pct] of Object.entries(parsed.biomeDistribution)) {
                            output += `  • ${biome}: ${pct}%\n`;
                        }
                    }
                    break;
                case 'region':
                    output = RichFormatter.header('Region Map', '📍');
                    if (parsed.region) {
                        output += RichFormatter.keyValue({
                            'ID': parsed.region.id,
                            'Name': parsed.region.name,
                            'Biome': parsed.region.dominantBiome,
                            'Tiles': parsed.tileCount
                        });
                    }
                    break;
                case 'tiles':
                    output = RichFormatter.header('World Tiles', '🔲');
                    output += RichFormatter.keyValue({
                        'Width': parsed.width,
                        'Height': parsed.height,
                        'Biome Types': parsed.biomes?.length
                    });
                    output += '\n_Tile data attached for rendering._\n';
                    break;
                case 'patch':
                    output = RichFormatter.header('Map Patch Applied', '✏️');
                    output += parsed.message || 'Patch applied successfully.\n';
                    break;
                case 'preview':
                    output = RichFormatter.header('Patch Preview', '👁️');
                    output += RichFormatter.keyValue({
                        'Valid': parsed.valid ? '✅' : '❌',
                        'Commands': parsed.commandCount
                    });
                    if (parsed.errors?.length) {
                        output += `\n**Errors:** ${parsed.errors.join(', ')}\n`;
                    }
                    break;
                case 'find_poi':
                    output = RichFormatter.header('POI Locations Found', '📌');
                    if (parsed.candidates) {
                        output += `Found ${parsed.candidates.length} candidate locations:\n`;
                        parsed.candidates.forEach((c: { x: number; y: number; biome: string; score: number }, i: number) => {
                            output += `  ${i + 1}. (${c.x}, ${c.y}) - ${c.biome} - Score: ${c.score}\n`;
                        });
                    }
                    break;
                case 'suggest_poi':
                    output = RichFormatter.header('POI Suggestions', '📍');
                    if (parsed.dslScript) {
                        output += '**DSL Script:**\n```\n' + parsed.dslScript + '\n```\n';
                    }
                    break;
                default:
                    output = RichFormatter.header('World Map', '🗺️');
                    if (parsed.message) output += parsed.message + '\n';
            }
        }

        output += RichFormatter.embedJson(parsed, 'WORLD_MAP');

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
