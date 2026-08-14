/**
 * Public-surface policy for the pre-consolidation world helpers.
 *
 * The file remains an internal compatibility adapter because the consolidated
 * world_map handler still delegates to its battle-tested persistence and DSL
 * implementation. It is not registered as a second public MCP surface.
 */
export const LEGACY_SURFACE_POLICY = Object.freeze({
    mode: 'compatibility',
    publicSurface: 'consolidated',
    adapter: 'src/server/tools.ts',
    supportedAdapters: Object.freeze([
        { legacyTool: 'get_world_map_overview', consolidatedAction: 'overview' },
        { legacyTool: 'get_region_map', consolidatedAction: 'region' },
        { legacyTool: 'get_world_tiles', consolidatedAction: 'tiles' },
        { legacyTool: 'apply_map_patch', consolidatedAction: 'patch' },
        { legacyTool: 'preview_map_patch', consolidatedAction: 'preview' },
        { legacyTool: 'find_valid_poi_location', consolidatedAction: 'find_poi' },
        { legacyTool: 'suggest_poi_locations', consolidatedAction: 'suggest_poi' },
    ])
} as const);
