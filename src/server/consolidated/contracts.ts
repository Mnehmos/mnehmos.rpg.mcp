import { ToolContract, ToolCategory, ToolMetadata } from '../tool-metadata.js';

interface ToolDescriptor {
    category: ToolCategory;
    keywords: string[];
    capabilities: string[];
    contextAware?: boolean;
    estimatedTokenCost?: ToolMetadata['estimatedTokenCost'];
    deferLoading?: boolean;
}

/**
 * One authoritative descriptor table used only while constructing contracts.
 * The registry never maintains a parallel category/keyword/capability map.
 */
const TOOL_DESCRIPTORS: Readonly<Record<string, ToolDescriptor>> = {
    secret_manage: { category: 'secret', keywords: ['secret', 'dm', 'hidden', 'mystery', 'reveal', 'clue'], capabilities: ['Create/manage DM secrets', 'Reveal conditions', 'Leak detection'] },
    rest_manage: { category: 'rest', keywords: ['rest', 'long', 'short', 'heal', 'recovery', 'hit dice'], capabilities: ['Long/short rest processing', 'HP restoration', 'Hit dice management'] },
    concentration_manage: { category: 'concentration', keywords: ['concentration', 'spell', 'save', 'break', 'maintain'], capabilities: ['Concentration checks', 'Break concentration', 'Duration tracking'] },
    narrative_manage: { category: 'narrative', keywords: ['narrative', 'story', 'note', 'journal', 'log'], capabilities: ['Story notes', 'Search history', 'Context retrieval'] },
    scroll_manage: { category: 'scroll', keywords: ['scroll', 'spell', 'use', 'create', 'identify', 'arcana'], capabilities: ['Use scrolls', 'Create scrolls', 'Check usability'] },
    character_manage: { category: 'character', keywords: ['character', 'pc', 'npc', 'create', 'update', 'stats', 'level'], capabilities: ['CRUD characters', 'Level up', 'Stats management'] },
    party_manage: { category: 'party', keywords: ['party', 'group', 'member', 'leader', 'formation', 'gold'], capabilities: ['Party management', 'Member operations', 'Treasury'] },
    item_manage: { category: 'inventory', keywords: ['item', 'weapon', 'armor', 'gear', 'equipment', 'create'], capabilities: ['Item templates', 'CRUD items', 'Item search'] },
    inventory_manage: { category: 'inventory', keywords: ['inventory', 'give', 'take', 'equip', 'use', 'transfer'], capabilities: ['Give/take items', 'Equip/use', 'Transfer between characters'] },
    corpse_manage: { category: 'corpse', keywords: ['corpse', 'loot', 'harvest', 'decay', 'body', 'death'], capabilities: ['Loot corpses', 'Harvest materials', 'Decay management'] },
    combat_manage: { category: 'combat', keywords: ['combat', 'encounter', 'initiative', 'turn', 'end', 'start'], capabilities: ['Start/end encounters', 'Initiative', 'Death saves'] },
    combat_action: { category: 'combat', keywords: ['attack', 'cast', 'move', 'action', 'damage', 'heal'], capabilities: ['Attacks', 'Spell casting', 'Movement', 'Standard actions'] },
    combat_map: { category: 'combat', keywords: ['map', 'terrain', 'grid', 'aoe', 'position', 'tactical'], capabilities: ['Terrain management', 'AoE calculation', 'Grid operations'] },
    world_manage: { category: 'world', keywords: ['world', 'generate', 'seed', 'terrain', 'biome'], capabilities: ['World generation', 'State queries', 'Environment updates'] },
    world_map: { category: 'world', keywords: ['map', 'overview', 'region', 'patch', 'tiles'], capabilities: ['Map overview', 'Region details', 'Tile patching'] },
    spatial_manage: { category: 'spatial', keywords: ['room', 'look', 'move', 'exits', 'dungeon', 'space'], capabilities: ['Room generation', 'Movement', 'Exit management'] },
    quest_manage: { category: 'quest', keywords: ['quest', 'objective', 'assign', 'complete', 'reward'], capabilities: ['Quest lifecycle', 'Objectives', 'Rewards'] },
    npc_manage: { category: 'npc', keywords: ['npc', 'relationship', 'memory', 'conversation', 'social'], capabilities: ['Relationships', 'Memory', 'Social interactions'] },
    aura_manage: { category: 'aura', keywords: ['aura', 'effect', 'radius', 'buff', 'debuff', 'area'], capabilities: ['Create auras', 'Effect processing', 'Expiration'] },
    theft_manage: { category: 'theft', keywords: ['theft', 'steal', 'fence', 'crime', 'recognition', 'heat'], capabilities: ['Theft attempts', 'Fence operations', 'Heat tracking'] },
    improvisation_manage: { category: 'improvisation', keywords: ['stunt', 'improvise', 'creative', 'effect', 'homebrew'], capabilities: ['Stunts', 'Custom effects', 'Arcane synthesis'] },
    math_manage: { category: 'math', keywords: ['dice', 'roll', 'probability', 'algebra', 'physics', 'math'], capabilities: ['Dice rolling', 'Probability', 'Math operations'] },
    strategy_manage: { category: 'strategy', keywords: ['nation', 'alliance', 'territory', 'strategy', 'diplomacy'], capabilities: ['Nation management', 'Diplomacy', 'Territory'] },
    turn_manage: { category: 'turn-management', keywords: ['turn', 'phase', 'ready', 'poll', 'results', 'async'], capabilities: ['Turn phases', 'Action submission', 'Result polling'] },
    spawn_manage: { category: 'world', keywords: ['spawn', 'create', 'encounter', 'location', 'tactical'], capabilities: ['Spawn characters', 'Create locations', 'Generate encounters'] },
    session_manage: { category: 'meta', keywords: ['session', 'initialize', 'context', 'start', 'resume'], capabilities: ['Session initialization', 'Context loading'] },
    travel_manage: { category: 'party', keywords: ['travel', 'move', 'rest', 'loot', 'journey', 'party'], capabilities: ['Party travel', 'Encounter looting', 'Camp/rest'] },
    batch_manage: { category: 'meta', keywords: ['batch', 'bulk', 'create', 'workflow', 'template'], capabilities: ['Bulk character creation', 'Workflows', 'Templates'] },
    agent_manage: { category: 'agent', keywords: ['agent', 'llm', 'npc', 'ai', 'persona', 'invoke', 'prompt', 'memory', 'autonomous'], capabilities: ['LLM-driven NPC minds', 'Modular prompt slices', 'Plain-text intent declarations', 'Auto-invoke on initiative'] },
    perception_manage: { category: 'meta', keywords: ['perception', 'hazard', 'control', 'safety', 'sight', 'blind-spot', 'attention', 'operator'], capabilities: ['Hierarchy-of-Controls hazard scanning', 'Attentional-capacity metering', 'Blind-spot detection (§3.5)', 'Disposition discipline'] },
    scene_manage: { category: 'narrative', keywords: ['scene', 'set_scene', 'frame', 'dm', 'narration', 'shared', 'state', 'context'], capabilities: ['DM-committed shared scenes', 'Auto-injected into agent prompts', 'Engine-side source of truth for "what is happening now"'] },
};

type ToolShape = {
    name: string;
    description: string;
    inputSchema: any;
    actionSchemas?: any;
};

type ToolHandler = Function;

/** Construct the single source-of-truth contract consumed by the registry. */
export function defineToolContract(tool: ToolShape, handler: ToolHandler): ToolContract {
    const descriptor = TOOL_DESCRIPTORS[tool.name];
    if (!descriptor) {
        throw new Error(`Missing consolidated tool descriptor for ${tool.name}`);
    }

    const metadata: ToolMetadata = {
        name: tool.name,
        description: tool.description,
        category: descriptor.category,
        keywords: descriptor.keywords,
        capabilities: descriptor.capabilities,
        contextAware: descriptor.contextAware ?? false,
        estimatedTokenCost: descriptor.estimatedTokenCost ?? 'medium',
        usageExample: `${tool.name}({ action: '...' })`,
        deferLoading: descriptor.deferLoading ?? true,
    };

    return {
        ...tool,
        metadata,
        schema: tool.inputSchema,
        actionSchemas: tool.actionSchemas,
        handler,
    };
}

export function getToolDescriptors(): Readonly<Record<string, ToolDescriptor>> {
    return TOOL_DESCRIPTORS;
}
