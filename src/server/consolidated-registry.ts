/**
 * Consolidated Tool Registry for v1.0 Clean-Break Release
 *
 * Registers only the 28 consolidated tools (85% reduction from 195 tools).
 * Each tool uses action-based routing with fuzzy matching and guiding errors.
 */

import { ToolMetadata, ToolCategory, ToolRegistry } from './tool-metadata.js';
import { ConsolidatedTools } from './consolidated/index.js';
import { SessionContext } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// METADATA HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function meta(
    name: string,
    description: string,
    category: ToolCategory,
    keywords: string[],
    capabilities: string[],
    contextAware: boolean = false,
    estimatedTokenCost: 'low' | 'medium' | 'high' | 'variable' = 'medium',
    deferLoading: boolean = true
): ToolMetadata {
    return {
        name,
        description,
        category,
        keywords,
        capabilities,
        contextAware,
        estimatedTokenCost,
        usageExample: `${name}({ action: '...' })`,
        deferLoading
    };
}

// Map tool names to categories
const TOOL_CATEGORIES: Record<string, ToolCategory> = {
    secret_manage: 'secret',
    rest_manage: 'rest',
    concentration_manage: 'concentration',
    narrative_manage: 'narrative',
    scroll_manage: 'scroll',
    character_manage: 'character',
    party_manage: 'party',
    item_manage: 'inventory',
    inventory_manage: 'inventory',
    corpse_manage: 'corpse',
    combat_manage: 'combat',
    combat_action: 'combat',
    combat_map: 'combat',
    world_manage: 'world',
    world_map: 'world',
    spatial_manage: 'spatial',
    quest_manage: 'quest',
    npc_manage: 'npc',
    aura_manage: 'aura',
    theft_manage: 'theft',
    improvisation_manage: 'improvisation',
    math_manage: 'math',
    strategy_manage: 'strategy',
    turn_manage: 'turn-management',
    spawn_manage: 'world',
    session_manage: 'meta',
    travel_manage: 'party',
    batch_manage: 'meta',
    agent_manage: 'agent',
};

// Map tool names to keywords
const TOOL_KEYWORDS: Record<string, string[]> = {
    secret_manage: ['secret', 'dm', 'hidden', 'mystery', 'reveal', 'clue'],
    rest_manage: ['rest', 'long', 'short', 'heal', 'recovery', 'hit dice'],
    concentration_manage: ['concentration', 'spell', 'save', 'break', 'maintain'],
    narrative_manage: ['narrative', 'story', 'note', 'journal', 'log'],
    scroll_manage: ['scroll', 'spell', 'use', 'create', 'identify', 'arcana'],
    character_manage: ['character', 'pc', 'npc', 'create', 'update', 'stats', 'level'],
    party_manage: ['party', 'group', 'member', 'leader', 'formation', 'gold'],
    item_manage: ['item', 'weapon', 'armor', 'gear', 'equipment', 'create'],
    inventory_manage: ['inventory', 'give', 'take', 'equip', 'use', 'transfer'],
    corpse_manage: ['corpse', 'loot', 'harvest', 'decay', 'body', 'death'],
    combat_manage: ['combat', 'encounter', 'initiative', 'turn', 'end', 'start'],
    combat_action: ['attack', 'cast', 'move', 'action', 'damage', 'heal'],
    combat_map: ['map', 'terrain', 'grid', 'aoe', 'position', 'tactical'],
    world_manage: ['world', 'generate', 'seed', 'terrain', 'biome'],
    world_map: ['map', 'overview', 'region', 'patch', 'tiles'],
    spatial_manage: ['room', 'look', 'move', 'exits', 'dungeon', 'space'],
    quest_manage: ['quest', 'objective', 'assign', 'complete', 'reward'],
    npc_manage: ['npc', 'relationship', 'memory', 'conversation', 'social'],
    aura_manage: ['aura', 'effect', 'radius', 'buff', 'debuff', 'area'],
    theft_manage: ['theft', 'steal', 'fence', 'crime', 'recognition', 'heat'],
    improvisation_manage: ['stunt', 'improvise', 'creative', 'effect', 'homebrew'],
    math_manage: ['dice', 'roll', 'probability', 'algebra', 'physics', 'math'],
    strategy_manage: ['nation', 'alliance', 'territory', 'strategy', 'diplomacy'],
    turn_manage: ['turn', 'phase', 'ready', 'poll', 'results', 'async'],
    spawn_manage: ['spawn', 'create', 'encounter', 'location', 'tactical'],
    session_manage: ['session', 'initialize', 'context', 'start', 'resume'],
    travel_manage: ['travel', 'move', 'rest', 'loot', 'journey', 'party'],
    batch_manage: ['batch', 'bulk', 'create', 'workflow', 'template'],
    agent_manage: ['agent', 'llm', 'npc', 'ai', 'persona', 'invoke', 'prompt', 'memory', 'autonomous'],
};

// Map tool names to capabilities
const TOOL_CAPABILITIES: Record<string, string[]> = {
    secret_manage: ['Create/manage DM secrets', 'Reveal conditions', 'Leak detection'],
    rest_manage: ['Long/short rest processing', 'HP restoration', 'Hit dice management'],
    concentration_manage: ['Concentration checks', 'Break concentration', 'Duration tracking'],
    narrative_manage: ['Story notes', 'Search history', 'Context retrieval'],
    scroll_manage: ['Use scrolls', 'Create scrolls', 'Check usability'],
    character_manage: ['CRUD characters', 'Level up', 'Stats management'],
    party_manage: ['Party management', 'Member operations', 'Treasury'],
    item_manage: ['Item templates', 'CRUD items', 'Item search'],
    inventory_manage: ['Give/take items', 'Equip/use', 'Transfer between characters'],
    corpse_manage: ['Loot corpses', 'Harvest materials', 'Decay management'],
    combat_manage: ['Start/end encounters', 'Initiative', 'Death saves'],
    combat_action: ['Attacks', 'Spell casting', 'Movement', 'Standard actions'],
    combat_map: ['Terrain management', 'AoE calculation', 'Grid operations'],
    world_manage: ['World generation', 'State queries', 'Environment updates'],
    world_map: ['Map overview', 'Region details', 'Tile patching'],
    spatial_manage: ['Room generation', 'Movement', 'Exit management'],
    quest_manage: ['Quest lifecycle', 'Objectives', 'Rewards'],
    npc_manage: ['Relationships', 'Memory', 'Social interactions'],
    aura_manage: ['Create auras', 'Effect processing', 'Expiration'],
    theft_manage: ['Theft attempts', 'Fence operations', 'Heat tracking'],
    improvisation_manage: ['Stunts', 'Custom effects', 'Arcane synthesis'],
    math_manage: ['Dice rolling', 'Probability', 'Math operations'],
    strategy_manage: ['Nation management', 'Diplomacy', 'Territory'],
    turn_manage: ['Turn phases', 'Action submission', 'Result polling'],
    spawn_manage: ['Spawn characters', 'Create locations', 'Generate encounters'],
    session_manage: ['Session initialization', 'Context loading'],
    travel_manage: ['Party travel', 'Encounter looting', 'Camp/rest'],
    batch_manage: ['Bulk character creation', 'Workflows', 'Templates'],
    agent_manage: ['LLM-driven NPC minds', 'Modular prompt slices', 'Plain-text intent declarations', 'Auto-invoke on initiative'],
};

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRY BUILDER
// ═══════════════════════════════════════════════════════════════════════════

let cachedRegistry: ToolRegistry | null = null;

export function buildConsolidatedRegistry(): ToolRegistry {
    if (cachedRegistry) return cachedRegistry;

    cachedRegistry = {};

    for (const { tool, handler } of ConsolidatedTools) {
        const name = tool.name;
        const category = TOOL_CATEGORIES[name] || 'meta';
        const keywords = TOOL_KEYWORDS[name] || [name];
        const capabilities = TOOL_CAPABILITIES[name] || [];

        cachedRegistry[name] = {
            metadata: meta(
                name,
                tool.description,
                category,
                keywords,
                capabilities,
                false,  // contextAware
                'medium',  // estimatedTokenCost
                true  // deferLoading
            ),
            schema: tool.inputSchema,
            actionSchemas: (tool as { actionSchemas?: unknown }).actionSchemas,
            handler: handler as (args: unknown, ctx: SessionContext) => Promise<any>
        };
    }

    return cachedRegistry;
}

// ═══════════════════════════════════════════════════════════════════════════
// METADATA ACCESS FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function getAllConsolidatedToolMetadata(): ToolMetadata[] {
    const registry = buildConsolidatedRegistry();
    return Object.values(registry).map(entry => entry.metadata);
}

export function getConsolidatedToolCategories(): ToolCategory[] {
    return [
        'world', 'combat', 'character', 'inventory', 'quest', 'party',
        'math', 'strategy', 'secret', 'concentration', 'rest', 'scroll',
        'aura', 'npc', 'spatial', 'theft', 'corpse', 'improvisation',
        'turn-management', 'meta', 'narrative', 'agent'
    ];
}

export function getConsolidatedToolByName(name: string) {
    const registry = buildConsolidatedRegistry();
    return registry[name] || null;
}
