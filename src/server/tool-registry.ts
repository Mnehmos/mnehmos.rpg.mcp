/**
 * Tool Registry - Aggregates all tools with metadata for dynamic loading
 * 
 * This registry enables:
 * - search_tools: Discovery by keyword/category
 * - load_tool_schema: On-demand schema loading
 */

import { ToolRegistry, ToolMetadata, ToolCategory } from './tool-metadata.js';

// Import all tool definitions (minimal schemas for token efficiency)
import { Tools, handleGenerateWorld, handleGetWorldState, handleApplyMapPatch, handleGetWorldMapOverview, handleGetRegionMap, handleGetWorldTiles, handlePreviewMapPatch, handleFindValidPoiLocation, handleSuggestPoiLocations } from './tools.js';
import { CombatTools, handleCreateEncounter, handleGetEncounterState, handleExecuteCombatAction, handleAdvanceTurn, handleEndEncounter, handleLoadEncounter, handleRollDeathSave, handleExecuteLairAction, handleRenderMap, handleCalculateAoe, handleUpdateTerrain, handlePlaceProp, handleMeasureDistance, handleGenerateTerrainPatch, handleGenerateTerrainPattern } from './combat-tools.js';
import { CRUDTools, handleCreateWorld, handleGetWorld, handleListWorlds, handleDeleteWorld, handleCreateCharacter, handleGetCharacter, handleUpdateCharacter, handleListCharacters, handleDeleteCharacter, handleUpdateWorldEnvironment } from './crud-tools.js';
import { InventoryTools, handleCreateItemTemplate, handleGiveItem, handleRemoveItem, handleEquipItem, handleUnequipItem, handleGetInventory, handleGetItem, handleListItems, handleSearchItems, handleUpdateItem, handleDeleteItem, handleTransferItem, handleUseItem, handleGetInventoryDetailed } from './inventory-tools.js';
import { QuestTools, handleCreateQuest, handleGetQuest, handleListQuests, handleAssignQuest, handleUpdateObjective, handleCompleteObjective, handleCompleteQuest, handleGetQuestLog } from './quest-tools.js';
import { MathTools, handleDiceRoll, handleProbabilityCalculate, handleAlgebraSolve, handleAlgebraSimplify, handlePhysicsProjectile } from './math-tools.js';
import { StrategyTools, handleStrategyTool } from './strategy-tools.js';
import { TurnManagementTools, handleTurnManagementTool } from './turn-management-tools.js';
import { SecretTools, handleCreateSecret, handleGetSecret, handleListSecrets, handleUpdateSecret, handleDeleteSecret, handleRevealSecret, handleCheckRevealConditions, handleGetSecretsForContext, handleCheckForLeaks } from './secret-tools.js';
import { PartyTools, handleCreateParty, handleGetParty, handleListParties, handleUpdateParty, handleDeleteParty, handleAddPartyMember, handleRemovePartyMember, handleUpdatePartyMember, handleSetPartyLeader, handleSetActiveCharacter, handleGetPartyMembers, handleGetPartyContext, handleGetUnassignedCharacters, handleMoveParty, handleGetPartyPosition, handleGetPartiesInRegion } from './party-tools.js';
import { RestTools, handleTakeLongRest, handleTakeShortRest } from './rest-tools.js';
import { ConcentrationTools, handleCheckConcentrationSave, handleBreakConcentration, handleGetConcentrationState, handleCheckConcentrationDuration, handleCheckAutoBreak } from './concentration-tools.js';
import { ScrollTools, handleUseSpellScroll, handleCreateSpellScroll, handleIdentifyScroll, handleGetScrollUseDC, handleGetScrollDetails, handleCheckScrollUsability } from './scroll-tools.js';
import { AuraTools, handleCreateAura, handleGetActiveAuras, handleGetAurasAffectingCharacter, handleProcessAuraEffects, handleRemoveAura, handleRemoveCharacterAuras, handleExpireAuras } from './aura-tools.js';
import { NpcMemoryTools, handleGetNpcRelationship, handleUpdateNpcRelationship, handleRecordConversationMemory, handleGetConversationHistory, handleGetRecentInteractions, handleGetNpcContext, handleInteractSocially } from './npc-memory-tools.js';
import { TheftTools, handleStealItem, handleCheckItemStolen, handleCheckStolenItemsOnCharacter, handleCheckItemRecognition, handleSellToFence, handleRegisterFence, handleReportTheft, handleAdvanceHeatDecay, handleGetFence, handleListFences } from './theft-tools.js';
import { CorpseTools, handleGetCorpse, handleGetCorpseByCharacter, handleListCorpsesInEncounter, handleListCorpsesNearby, handleLootCorpse, handleHarvestCorpse, handleCreateCorpse, handleGenerateLoot, handleGetCorpseInventory, handleCreateLootTable, handleGetLootTable, handleListLootTables, handleAdvanceCorpseDecay, handleCleanupCorpses } from './corpse-tools.js';
import { ImprovisationTools, handleResolveImprovisedStunt, handleApplyCustomEffect, handleGetCustomEffects, handleRemoveCustomEffect, handleProcessEffectTriggers, handleAdvanceEffectDurations, handleAttemptArcaneSynthesis, handleGetSynthesizedSpells } from './improvisation-tools.js';
import { SpatialTools, handleLookAtSurroundings, handleGenerateRoomNode, handleGetRoomExits, handleMoveCharacterToRoom } from './spatial-tools.js';
import { BatchTools, handleBatchCreateCharacters, handleBatchCreateNpcs, handleBatchDistributeItems } from './batch-tools.js';
import { WorkflowTools, handleExecuteWorkflow, handleListTemplates, handleGetTemplate } from './workflow-tools.js';
import { EventInboxTools, handlePollEvents, handlePushEvent, handleGetEventHistory, handleGetPendingCount } from './event-inbox-tools.js';

// Helper to create metadata
// deferLoading defaults to true (most tools should be deferred)
function meta(
  name: string,
  description: string,
  category: ToolCategory,
  keywords: string[],
  capabilities: string[],
  contextAware: boolean = false,
  estimatedTokenCost: 'low' | 'medium' | 'high' | 'variable' = 'medium',
  deferLoading: boolean = true  // MCP spec: defer by default, only core tools are immediate
): ToolMetadata {
  return {
    name,
    description,
    category,
    keywords,
    capabilities,
    contextAware,
    estimatedTokenCost,
    usageExample: `${name}({ ... })`,
    deferLoading
  };
}

// Build the complete tool registry
let cachedRegistry: ToolRegistry | null = null;

export function buildToolRegistry(): ToolRegistry {
  if (cachedRegistry) return cachedRegistry;

  cachedRegistry = {
    // === WORLD TOOLS ===
    [Tools.GENERATE_WORLD.name]: {
      metadata: meta(Tools.GENERATE_WORLD.name, Tools.GENERATE_WORLD.description, 'world',
        ['world', 'generation', 'seed', 'terrain', 'biome', 'procedural'],
        ['Procedural world generation', 'Biome distribution', 'River generation'], true, 'high'),
      schema: Tools.GENERATE_WORLD.inputSchema,
      handler: handleGenerateWorld
    },
    [Tools.GET_WORLD_STATE.name]: {
      metadata: meta(Tools.GET_WORLD_STATE.name, Tools.GET_WORLD_STATE.description, 'world',
        ['world', 'state', 'query', 'environment'],
        ['World state retrieval', 'Environment info'], true, 'high'),
      schema: Tools.GET_WORLD_STATE.inputSchema,
      handler: handleGetWorldState
    },
    [Tools.APPLY_MAP_PATCH.name]: {
      metadata: meta(Tools.APPLY_MAP_PATCH.name, Tools.APPLY_MAP_PATCH.description, 'world',
        ['map', 'patch', 'edit', 'terrain', 'structure'],
        ['Terrain modification', 'Structure placement'], false, 'medium'),
      schema: Tools.APPLY_MAP_PATCH.inputSchema,
      handler: handleApplyMapPatch
    },
    [Tools.GET_WORLD_MAP_OVERVIEW.name]: {
      metadata: meta(Tools.GET_WORLD_MAP_OVERVIEW.name, Tools.GET_WORLD_MAP_OVERVIEW.description, 'world',
        ['map', 'overview', 'biome', 'region', 'statistics'],
        ['Map overview', 'Biome distribution'], true, 'high'),
      schema: Tools.GET_WORLD_MAP_OVERVIEW.inputSchema,
      handler: handleGetWorldMapOverview
    },
    [Tools.GET_REGION_MAP.name]: {
      metadata: meta(Tools.GET_REGION_MAP.name, Tools.GET_REGION_MAP.description, 'world',
        ['region', 'map', 'terrain', 'tiles'],
        ['Regional mapping', 'Tile details'], false, 'medium'),
      schema: Tools.GET_REGION_MAP.inputSchema,
      handler: handleGetRegionMap
    },
    [Tools.GET_WORLD_TILES.name]: {
      metadata: meta(Tools.GET_WORLD_TILES.name, Tools.GET_WORLD_TILES.description, 'world',
        ['tiles', 'grid', 'render', 'map', 'visualization'],
        ['Full tile grid', 'Visualization data'], true, 'high'),
      schema: Tools.GET_WORLD_TILES.inputSchema,
      handler: handleGetWorldTiles
    },
    [Tools.PREVIEW_MAP_PATCH.name]: {
      metadata: meta(Tools.PREVIEW_MAP_PATCH.name, Tools.PREVIEW_MAP_PATCH.description, 'world',
        ['preview', 'patch', 'simulate', 'dsl'],
        ['Non-destructive preview', 'DSL validation'], false, 'low'),
      schema: Tools.PREVIEW_MAP_PATCH.inputSchema,
      handler: handlePreviewMapPatch
    },
    [Tools.FIND_VALID_POI_LOCATION.name]: {
      metadata: meta(Tools.FIND_VALID_POI_LOCATION.name, Tools.FIND_VALID_POI_LOCATION.description, 'world',
        ['poi', 'location', 'placement', 'terrain', 'valid'],
        ['Terrain-aware placement', 'Suitability scoring'], false, 'medium'),
      schema: Tools.FIND_VALID_POI_LOCATION.inputSchema,
      handler: handleFindValidPoiLocation
    },
    [Tools.SUGGEST_POI_LOCATIONS.name]: {
      metadata: meta(Tools.SUGGEST_POI_LOCATIONS.name, Tools.SUGGEST_POI_LOCATIONS.description, 'world',
        ['poi', 'suggestions', 'locations', 'batch', 'placement'],
        ['Multiple suggestions', 'Suitability ranking'], false, 'medium'),
      schema: Tools.SUGGEST_POI_LOCATIONS.inputSchema,
      handler: handleSuggestPoiLocations
    },

    // === COMBAT TOOLS ===
    [CombatTools.CREATE_ENCOUNTER.name]: {
      metadata: meta(CombatTools.CREATE_ENCOUNTER.name, CombatTools.CREATE_ENCOUNTER.description, 'combat',
        ['encounter', 'combat', 'battle', 'initiative', 'fight'],
        ['Initiative rolling', 'Participant setup', 'Combat state'], false, 'medium', false),
      schema: CombatTools.CREATE_ENCOUNTER.inputSchema,
      handler: handleCreateEncounter
    },
    [CombatTools.GET_ENCOUNTER_STATE.name]: {
      metadata: meta(CombatTools.GET_ENCOUNTER_STATE.name, CombatTools.GET_ENCOUNTER_STATE.description, 'combat',
        ['encounter', 'state', 'turn', 'status', 'combat'],
        ['Encounter status', 'Combatant info', 'Turn order'], true, 'high', false),
      schema: CombatTools.GET_ENCOUNTER_STATE.inputSchema,
      handler: handleGetEncounterState
    },
    [CombatTools.EXECUTE_COMBAT_ACTION.name]: {
      metadata: meta(CombatTools.EXECUTE_COMBAT_ACTION.name, CombatTools.EXECUTE_COMBAT_ACTION.description, 'combat',
        ['action', 'attack', 'heal', 'move', 'combat', 'damage'],
        ['Attack resolution', 'Damage calculation', 'Movement'], false, 'medium'),
      schema: CombatTools.EXECUTE_COMBAT_ACTION.inputSchema,
      handler: handleExecuteCombatAction
    },
    [CombatTools.ADVANCE_TURN.name]: {
      metadata: meta(CombatTools.ADVANCE_TURN.name, CombatTools.ADVANCE_TURN.description, 'combat',
        ['turn', 'advance', 'next', 'combat', 'initiative'],
        ['Turn progression', 'Initiative tracking'], false, 'low'),
      schema: CombatTools.ADVANCE_TURN.inputSchema,
      handler: handleAdvanceTurn
    },
    [CombatTools.END_ENCOUNTER.name]: {
      metadata: meta(CombatTools.END_ENCOUNTER.name, CombatTools.END_ENCOUNTER.description, 'combat',
        ['end', 'encounter', 'combat', 'conclude', 'finish'],
        ['Combat resolution', 'Cleanup'], false, 'low'),
      schema: CombatTools.END_ENCOUNTER.inputSchema,
      handler: handleEndEncounter
    },
    [CombatTools.LOAD_ENCOUNTER.name]: {
      metadata: meta(CombatTools.LOAD_ENCOUNTER.name, CombatTools.LOAD_ENCOUNTER.description, 'combat',
        ['load', 'encounter', 'restore', 'resume'],
        ['Encounter persistence'], false, 'medium'),
      schema: CombatTools.LOAD_ENCOUNTER.inputSchema,
      handler: handleLoadEncounter
    },
    [CombatTools.ROLL_DEATH_SAVE.name]: {
      metadata: meta(CombatTools.ROLL_DEATH_SAVE.name, CombatTools.ROLL_DEATH_SAVE.description, 'combat',
        ['death', 'save', 'dying', 'unconscious', 'd20'],
        ['Death saving throw', 'Unconsciousness tracking'], false, 'low'),
      schema: CombatTools.ROLL_DEATH_SAVE.inputSchema,
      handler: handleRollDeathSave
    },
    [CombatTools.EXECUTE_LAIR_ACTION.name]: {
      metadata: meta(CombatTools.EXECUTE_LAIR_ACTION.name, CombatTools.EXECUTE_LAIR_ACTION.description, 'combat',
        ['lair', 'action', 'legendary', 'environment', 'boss'],
        ['Lair action resolution', 'Environmental effects'], false, 'medium'),
      schema: CombatTools.EXECUTE_LAIR_ACTION.inputSchema,
      handler: handleExecuteLairAction
    },
    // === COMBAT VISUALIZATION TOOLS ===
    [CombatTools.RENDER_MAP.name]: {
      metadata: meta(CombatTools.RENDER_MAP.name, CombatTools.RENDER_MAP.description, 'combat',
        ['map', 'grid', 'visualization', 'ascii', 'combat', 'position', 'spatial'],
        ['Combat map visualization', 'Participant positions', 'Terrain display'], true, 'medium'),
      schema: CombatTools.RENDER_MAP.inputSchema,
      handler: handleRenderMap
    },
    [CombatTools.CALCULATE_AOE.name]: {
      metadata: meta(CombatTools.CALCULATE_AOE.name, CombatTools.CALCULATE_AOE.description, 'combat',
        ['aoe', 'area', 'effect', 'fireball', 'cone', 'line', 'spell', 'radius'],
        ['AoE calculation', 'Target detection', 'Spell area'], false, 'medium'),
      schema: CombatTools.CALCULATE_AOE.inputSchema,
      handler: handleCalculateAoe
    },
    [CombatTools.UPDATE_TERRAIN.name]: {
      metadata: meta(CombatTools.UPDATE_TERRAIN.name, CombatTools.UPDATE_TERRAIN.description, 'combat',
        ['terrain', 'update', 'add', 'remove', 'obstacle', 'water', 'difficult', 'battlefield'],
        ['Dynamic terrain', 'On-the-fly map editing', 'Mid-combat terrain changes'], false, 'medium'),
      schema: CombatTools.UPDATE_TERRAIN.inputSchema,
      handler: handleUpdateTerrain
    },
    [CombatTools.PLACE_PROP.name]: {
      metadata: meta(CombatTools.PLACE_PROP.name, CombatTools.PLACE_PROP.description, 'combat',
        ['prop', 'object', 'terrain', 'tree', 'ladder', 'building', 'cover', 'improv', 'battlefield'],
        ['Improvised props', 'Battlefield objects', 'Cover placement'], false, 'medium'),
      schema: CombatTools.PLACE_PROP.inputSchema,
      handler: handlePlaceProp
    },
    [CombatTools.MEASURE_DISTANCE.name]: {
      metadata: meta(CombatTools.MEASURE_DISTANCE.name, CombatTools.MEASURE_DISTANCE.description, 'combat',
        ['distance', 'measure', 'range', 'feet', 'squares', 'movement', 'spatial'],
        ['Distance calculation', 'Range measurement', 'Movement planning'], true, 'low'),
      schema: CombatTools.MEASURE_DISTANCE.inputSchema,
      handler: handleMeasureDistance
    },
    [CombatTools.GENERATE_TERRAIN_PATCH.name]: {
      metadata: meta(CombatTools.GENERATE_TERRAIN_PATCH.name, CombatTools.GENERATE_TERRAIN_PATCH.description, 'combat',
        ['terrain', 'biome', 'generate', 'procedural', 'forest', 'cave', 'dungeon', 'village', 'swamp', 'battlefield'],
        ['Procedural terrain generation', 'Biome presets', 'Mass terrain placement'], false, 'medium'),
      schema: CombatTools.GENERATE_TERRAIN_PATCH.inputSchema,
      handler: handleGenerateTerrainPatch
    },
    [CombatTools.GENERATE_TERRAIN_PATTERN.name]: {
      metadata: meta(CombatTools.GENERATE_TERRAIN_PATTERN.name, CombatTools.GENERATE_TERRAIN_PATTERN.description, 'combat',
        ['terrain', 'pattern', 'generate', 'river', 'canyon', 'arena', 'valley', 'geometric', 'layout'],
        ['Geometric terrain patterns', 'Consistent layouts', 'River valleys, canyons, arenas'], false, 'medium'),
      schema: CombatTools.GENERATE_TERRAIN_PATTERN.inputSchema,
      handler: handleGenerateTerrainPattern
    },

    // === CHARACTER/CRUD TOOLS ===
    [CRUDTools.CREATE_WORLD.name]: {
      metadata: meta(CRUDTools.CREATE_WORLD.name, CRUDTools.CREATE_WORLD.description, 'world',
        ['world', 'create', 'new', 'initialize'],
        ['World creation', 'Initialization'], false, 'medium'),
      schema: CRUDTools.CREATE_WORLD.inputSchema,
      handler: handleCreateWorld
    },
    [CRUDTools.GET_WORLD.name]: {
      metadata: meta(CRUDTools.GET_WORLD.name, CRUDTools.GET_WORLD.description, 'world',
        ['world', 'get', 'retrieve', 'fetch'],
        ['World retrieval'], false, 'medium'),
      schema: CRUDTools.GET_WORLD.inputSchema,
      handler: handleGetWorld
    },
    [CRUDTools.LIST_WORLDS.name]: {
      metadata: meta(CRUDTools.LIST_WORLDS.name, CRUDTools.LIST_WORLDS.description, 'world',
        ['world', 'list', 'all', 'query'],
        ['World listing'], false, 'medium'),
      schema: CRUDTools.LIST_WORLDS.inputSchema,
      handler: handleListWorlds
    },
    [CRUDTools.UPDATE_WORLD_ENVIRONMENT.name]: {
      metadata: meta(CRUDTools.UPDATE_WORLD_ENVIRONMENT.name, CRUDTools.UPDATE_WORLD_ENVIRONMENT.description, 'world',
        ['world', 'environment', 'time', 'weather', 'season'],
        ['Environmental updates', 'Season/time'], false, 'low'),
      schema: CRUDTools.UPDATE_WORLD_ENVIRONMENT.inputSchema,
      handler: handleUpdateWorldEnvironment
    },
    [CRUDTools.DELETE_WORLD.name]: {
      metadata: meta(CRUDTools.DELETE_WORLD.name, CRUDTools.DELETE_WORLD.description, 'world',
        ['world', 'delete', 'remove'],
        ['World deletion'], false, 'low'),
      schema: CRUDTools.DELETE_WORLD.inputSchema,
      handler: handleDeleteWorld
    },
    [CRUDTools.CREATE_CHARACTER.name]: {
      metadata: meta(CRUDTools.CREATE_CHARACTER.name, CRUDTools.CREATE_CHARACTER.description, 'character',
        ['character', 'create', 'new', 'player', 'npc', 'pc'],
        ['Character creation', 'Class/race setup'], false, 'medium', false),
      schema: CRUDTools.CREATE_CHARACTER.inputSchema,
      handler: handleCreateCharacter
    },
    [CRUDTools.GET_CHARACTER.name]: {
      metadata: meta(CRUDTools.GET_CHARACTER.name, CRUDTools.GET_CHARACTER.description, 'character',
        ['character', 'get', 'retrieve', 'info', 'sheet'],
        ['Character retrieval', 'Full character sheet'], false, 'medium', false),
      schema: CRUDTools.GET_CHARACTER.inputSchema,
      handler: handleGetCharacter
    },
    [CRUDTools.UPDATE_CHARACTER.name]: {
      metadata: meta(CRUDTools.UPDATE_CHARACTER.name, CRUDTools.UPDATE_CHARACTER.description, 'character',
        ['character', 'update', 'modify', 'change', 'edit'],
        ['Character modification', 'Stat updates'], false, 'medium'),
      schema: CRUDTools.UPDATE_CHARACTER.inputSchema,
      handler: handleUpdateCharacter
    },
    [CRUDTools.LIST_CHARACTERS.name]: {
      metadata: meta(CRUDTools.LIST_CHARACTERS.name, CRUDTools.LIST_CHARACTERS.description, 'character',
        ['character', 'list', 'all', 'query', 'search'],
        ['Character listing', 'Filtering'], true, 'medium'),
      schema: CRUDTools.LIST_CHARACTERS.inputSchema,
      handler: handleListCharacters
    },
    [CRUDTools.DELETE_CHARACTER.name]: {
      metadata: meta(CRUDTools.DELETE_CHARACTER.name, CRUDTools.DELETE_CHARACTER.description, 'character',
        ['character', 'delete', 'remove'],
        ['Character deletion'], false, 'low'),
      schema: CRUDTools.DELETE_CHARACTER.inputSchema,
      handler: handleDeleteCharacter
    },

    // === PARTY TOOLS ===
    [PartyTools.CREATE_PARTY.name]: {
      metadata: meta(PartyTools.CREATE_PARTY.name, PartyTools.CREATE_PARTY.description, 'party',
        ['party', 'create', 'new', 'group', 'adventuring'],
        ['Party formation', 'Member setup'], false, 'medium'),
      schema: PartyTools.CREATE_PARTY.inputSchema,
      handler: handleCreateParty
    },
    [PartyTools.GET_PARTY.name]: {
      metadata: meta(PartyTools.GET_PARTY.name, PartyTools.GET_PARTY.description, 'party',
        ['party', 'get', 'retrieve', 'info', 'members'],
        ['Full party info', 'Member details'], true, 'high'),
      schema: PartyTools.GET_PARTY.inputSchema,
      handler: handleGetParty
    },
    [PartyTools.LIST_PARTIES.name]: {
      metadata: meta(PartyTools.LIST_PARTIES.name, PartyTools.LIST_PARTIES.description, 'party',
        ['party', 'list', 'all', 'groups'],
        ['Party listing', 'Multiple parties'], true, 'medium'),
      schema: PartyTools.LIST_PARTIES.inputSchema,
      handler: handleListParties
    },
    [PartyTools.UPDATE_PARTY.name]: {
      metadata: meta(PartyTools.UPDATE_PARTY.name, PartyTools.UPDATE_PARTY.description, 'party',
        ['party', 'update', 'modify', 'edit'],
        ['Party metadata update'], false, 'low'),
      schema: PartyTools.UPDATE_PARTY.inputSchema,
      handler: handleUpdateParty
    },
    [PartyTools.DELETE_PARTY.name]: {
      metadata: meta(PartyTools.DELETE_PARTY.name, PartyTools.DELETE_PARTY.description, 'party',
        ['party', 'delete', 'remove', 'disband'],
        ['Party deletion'], false, 'low'),
      schema: PartyTools.DELETE_PARTY.inputSchema,
      handler: handleDeleteParty
    },
    [PartyTools.ADD_PARTY_MEMBER.name]: {
      metadata: meta(PartyTools.ADD_PARTY_MEMBER.name, PartyTools.ADD_PARTY_MEMBER.description, 'party',
        ['party', 'member', 'add', 'join', 'recruit'],
        ['Member addition', 'Role assignment'], false, 'low'),
      schema: PartyTools.ADD_PARTY_MEMBER.inputSchema,
      handler: handleAddPartyMember
    },
    [PartyTools.REMOVE_PARTY_MEMBER.name]: {
      metadata: meta(PartyTools.REMOVE_PARTY_MEMBER.name, PartyTools.REMOVE_PARTY_MEMBER.description, 'party',
        ['party', 'member', 'remove', 'leave', 'kick'],
        ['Member removal'], false, 'low'),
      schema: PartyTools.REMOVE_PARTY_MEMBER.inputSchema,
      handler: handleRemovePartyMember
    },
    [PartyTools.UPDATE_PARTY_MEMBER.name]: {
      metadata: meta(PartyTools.UPDATE_PARTY_MEMBER.name, PartyTools.UPDATE_PARTY_MEMBER.description, 'party',
        ['party', 'member', 'update', 'role', 'position'],
        ['Member role/position update'], false, 'low'),
      schema: PartyTools.UPDATE_PARTY_MEMBER.inputSchema,
      handler: handleUpdatePartyMember
    },
    [PartyTools.SET_PARTY_LEADER.name]: {
      metadata: meta(PartyTools.SET_PARTY_LEADER.name, PartyTools.SET_PARTY_LEADER.description, 'party',
        ['party', 'leader', 'designate', 'captain'],
        ['Leader assignment'], false, 'low'),
      schema: PartyTools.SET_PARTY_LEADER.inputSchema,
      handler: handleSetPartyLeader
    },
    [PartyTools.SET_ACTIVE_CHARACTER.name]: {
      metadata: meta(PartyTools.SET_ACTIVE_CHARACTER.name, PartyTools.SET_ACTIVE_CHARACTER.description, 'party',
        ['party', 'active', 'player', 'character', 'pov', 'focus'],
        ['Active character selection', 'POV'], false, 'low'),
      schema: PartyTools.SET_ACTIVE_CHARACTER.inputSchema,
      handler: handleSetActiveCharacter
    },
    [PartyTools.GET_PARTY_MEMBERS.name]: {
      metadata: meta(PartyTools.GET_PARTY_MEMBERS.name, PartyTools.GET_PARTY_MEMBERS.description, 'party',
        ['party', 'member', 'list', 'all', 'roster'],
        ['Member listing with details'], true, 'high'),
      schema: PartyTools.GET_PARTY_MEMBERS.inputSchema,
      handler: handleGetPartyMembers
    },
    [PartyTools.GET_PARTY_CONTEXT.name]: {
      metadata: meta(PartyTools.GET_PARTY_CONTEXT.name, PartyTools.GET_PARTY_CONTEXT.description, 'party',
        ['party', 'context', 'summary', 'brief', 'llm'],
        ['Condensed party context', 'LLM-friendly format'], true, 'medium'),
      schema: PartyTools.GET_PARTY_CONTEXT.inputSchema,
      handler: handleGetPartyContext
    },
    [PartyTools.GET_UNASSIGNED_CHARACTERS.name]: {
      metadata: meta(PartyTools.GET_UNASSIGNED_CHARACTERS.name, PartyTools.GET_UNASSIGNED_CHARACTERS.description, 'character',
        ['character', 'unassigned', 'available', 'free'],
        ['Available character listing'], false, 'medium'),
      schema: PartyTools.GET_UNASSIGNED_CHARACTERS.inputSchema,
      handler: handleGetUnassignedCharacters
    },
    [PartyTools.MOVE_PARTY.name]: {
      metadata: meta(PartyTools.MOVE_PARTY.name, PartyTools.MOVE_PARTY.description, 'spatial',
        ['party', 'move', 'travel', 'location', 'position'],
        ['Party positioning', 'World map movement'], false, 'low'),
      schema: PartyTools.MOVE_PARTY.inputSchema,
      handler: handleMoveParty
    },
    [PartyTools.GET_PARTY_POSITION.name]: {
      metadata: meta(PartyTools.GET_PARTY_POSITION.name, PartyTools.GET_PARTY_POSITION.description, 'spatial',
        ['party', 'position', 'location', 'coordinates', 'where'],
        ['Party location retrieval'], false, 'low'),
      schema: PartyTools.GET_PARTY_POSITION.inputSchema,
      handler: handleGetPartyPosition
    },
    [PartyTools.GET_PARTIES_IN_REGION.name]: {
      metadata: meta(PartyTools.GET_PARTIES_IN_REGION.name, PartyTools.GET_PARTIES_IN_REGION.description, 'spatial',
        ['party', 'region', 'nearby', 'proximity', 'search'],
        ['Regional party discovery'], false, 'medium'),
      schema: PartyTools.GET_PARTIES_IN_REGION.inputSchema,
      handler: handleGetPartiesInRegion
    },

    // === INVENTORY TOOLS ===
    [InventoryTools.CREATE_ITEM_TEMPLATE.name]: {
      metadata: meta(InventoryTools.CREATE_ITEM_TEMPLATE.name, InventoryTools.CREATE_ITEM_TEMPLATE.description, 'inventory',
        ['item', 'template', 'create', 'type', 'define'],
        ['Item type creation', 'Properties'], false, 'low'),
      schema: InventoryTools.CREATE_ITEM_TEMPLATE.inputSchema,
      handler: handleCreateItemTemplate
    },
    [InventoryTools.GIVE_ITEM.name]: {
      metadata: meta(InventoryTools.GIVE_ITEM.name, InventoryTools.GIVE_ITEM.description, 'inventory',
        ['item', 'give', 'grant', 'add', 'receive'],
        ['Item assignment', 'Quantity tracking'], false, 'low'),
      schema: InventoryTools.GIVE_ITEM.inputSchema,
      handler: handleGiveItem
    },
    [InventoryTools.REMOVE_ITEM.name]: {
      metadata: meta(InventoryTools.REMOVE_ITEM.name, InventoryTools.REMOVE_ITEM.description, 'inventory',
        ['item', 'remove', 'drop', 'delete', 'discard'],
        ['Item removal'], false, 'low'),
      schema: InventoryTools.REMOVE_ITEM.inputSchema,
      handler: handleRemoveItem
    },
    [InventoryTools.EQUIP_ITEM.name]: {
      metadata: meta(InventoryTools.EQUIP_ITEM.name, InventoryTools.EQUIP_ITEM.description, 'inventory',
        ['item', 'equip', 'wield', 'wear', 'slot'],
        ['Equipment slot management'], false, 'low'),
      schema: InventoryTools.EQUIP_ITEM.inputSchema,
      handler: handleEquipItem
    },
    [InventoryTools.UNEQUIP_ITEM.name]: {
      metadata: meta(InventoryTools.UNEQUIP_ITEM.name, InventoryTools.UNEQUIP_ITEM.description, 'inventory',
        ['item', 'unequip', 'remove', 'store', 'doff'],
        ['Equipment removal'], false, 'low'),
      schema: InventoryTools.UNEQUIP_ITEM.inputSchema,
      handler: handleUnequipItem
    },
    [InventoryTools.GET_INVENTORY.name]: {
      metadata: meta(InventoryTools.GET_INVENTORY.name, InventoryTools.GET_INVENTORY.description, 'inventory',
        ['inventory', 'items', 'list', 'bag', 'backpack'],
        ['Inventory listing', 'Item tracking'], true, 'medium'),
      schema: InventoryTools.GET_INVENTORY.inputSchema,
      handler: handleGetInventory
    },
    [InventoryTools.GET_ITEM.name]: {
      metadata: meta(InventoryTools.GET_ITEM.name, InventoryTools.GET_ITEM.description, 'inventory',
        ['item', 'get', 'retrieve', 'details', 'info'],
        ['Item details'], false, 'low'),
      schema: InventoryTools.GET_ITEM.inputSchema,
      handler: handleGetItem
    },
    [InventoryTools.LIST_ITEMS.name]: {
      metadata: meta(InventoryTools.LIST_ITEMS.name, InventoryTools.LIST_ITEMS.description, 'inventory',
        ['item', 'list', 'all', 'template', 'catalog'],
        ['Item type listing'], false, 'medium'),
      schema: InventoryTools.LIST_ITEMS.inputSchema,
      handler: handleListItems
    },
    [InventoryTools.SEARCH_ITEMS.name]: {
      metadata: meta(InventoryTools.SEARCH_ITEMS.name, InventoryTools.SEARCH_ITEMS.description, 'inventory',
        ['item', 'search', 'filter', 'find', 'query'],
        ['Item search/filtering'], false, 'medium'),
      schema: InventoryTools.SEARCH_ITEMS.inputSchema,
      handler: handleSearchItems
    },
    [InventoryTools.UPDATE_ITEM.name]: {
      metadata: meta(InventoryTools.UPDATE_ITEM.name, InventoryTools.UPDATE_ITEM.description, 'inventory',
        ['item', 'update', 'modify', 'edit'],
        ['Item property updates'], false, 'low'),
      schema: InventoryTools.UPDATE_ITEM.inputSchema,
      handler: handleUpdateItem
    },
    [InventoryTools.DELETE_ITEM.name]: {
      metadata: meta(InventoryTools.DELETE_ITEM.name, InventoryTools.DELETE_ITEM.description, 'inventory',
        ['item', 'delete', 'remove', 'type'],
        ['Item type deletion'], false, 'low'),
      schema: InventoryTools.DELETE_ITEM.inputSchema,
      handler: handleDeleteItem
    },
    [InventoryTools.TRANSFER_ITEM.name]: {
      metadata: meta(InventoryTools.TRANSFER_ITEM.name, InventoryTools.TRANSFER_ITEM.description, 'inventory',
        ['item', 'transfer', 'trade', 'exchange', 'give'],
        ['Item exchange between characters'], false, 'low'),
      schema: InventoryTools.TRANSFER_ITEM.inputSchema,
      handler: handleTransferItem
    },
    [InventoryTools.USE_ITEM.name]: {
      metadata: meta(InventoryTools.USE_ITEM.name, InventoryTools.USE_ITEM.description, 'inventory',
        ['item', 'use', 'consume', 'activate', 'potion'],
        ['Consumable item usage'], false, 'medium'),
      schema: InventoryTools.USE_ITEM.inputSchema,
      handler: handleUseItem
    },
    [InventoryTools.GET_INVENTORY_DETAILED.name]: {
      metadata: meta(InventoryTools.GET_INVENTORY_DETAILED.name, InventoryTools.GET_INVENTORY_DETAILED.description, 'inventory',
        ['inventory', 'detailed', 'full', 'equipped', 'complete'],
        ['Detailed inventory with equipped items'], true, 'high'),
      schema: InventoryTools.GET_INVENTORY_DETAILED.inputSchema,
      handler: handleGetInventoryDetailed
    },

    // === QUEST TOOLS ===
    [QuestTools.CREATE_QUEST.name]: {
      metadata: meta(QuestTools.CREATE_QUEST.name, QuestTools.CREATE_QUEST.description, 'quest',
        ['quest', 'create', 'new', 'mission', 'objective'],
        ['Quest creation', 'Objective setup'], false, 'medium'),
      schema: QuestTools.CREATE_QUEST.inputSchema,
      handler: handleCreateQuest
    },
    [QuestTools.GET_QUEST.name]: {
      metadata: meta(QuestTools.GET_QUEST.name, QuestTools.GET_QUEST.description, 'quest',
        ['quest', 'get', 'retrieve', 'details', 'info'],
        ['Quest retrieval with objectives'], false, 'medium'),
      schema: QuestTools.GET_QUEST.inputSchema,
      handler: handleGetQuest
    },
    [QuestTools.LIST_QUESTS.name]: {
      metadata: meta(QuestTools.LIST_QUESTS.name, QuestTools.LIST_QUESTS.description, 'quest',
        ['quest', 'list', 'all', 'query', 'active'],
        ['Quest listing', 'Filtering'], true, 'medium'),
      schema: QuestTools.LIST_QUESTS.inputSchema,
      handler: handleListQuests
    },
    [QuestTools.ASSIGN_QUEST.name]: {
      metadata: meta(QuestTools.ASSIGN_QUEST.name, QuestTools.ASSIGN_QUEST.description, 'quest',
        ['quest', 'assign', 'give', 'character', 'accept'],
        ['Quest assignment to character'], false, 'low'),
      schema: QuestTools.ASSIGN_QUEST.inputSchema,
      handler: handleAssignQuest
    },
    [QuestTools.UPDATE_OBJECTIVE.name]: {
      metadata: meta(QuestTools.UPDATE_OBJECTIVE.name, QuestTools.UPDATE_OBJECTIVE.description, 'quest',
        ['quest', 'objective', 'progress', 'update', 'track'],
        ['Objective progress tracking'], false, 'low'),
      schema: QuestTools.UPDATE_OBJECTIVE.inputSchema,
      handler: handleUpdateObjective
    },
    [QuestTools.COMPLETE_OBJECTIVE.name]: {
      metadata: meta(QuestTools.COMPLETE_OBJECTIVE.name, QuestTools.COMPLETE_OBJECTIVE.description, 'quest',
        ['quest', 'objective', 'complete', 'finish', 'done'],
        ['Objective completion'], false, 'low'),
      schema: QuestTools.COMPLETE_OBJECTIVE.inputSchema,
      handler: handleCompleteObjective
    },
    [QuestTools.COMPLETE_QUEST.name]: {
      metadata: meta(QuestTools.COMPLETE_QUEST.name, QuestTools.COMPLETE_QUEST.description, 'quest',
        ['quest', 'complete', 'finish', 'reward', 'turn-in'],
        ['Quest completion', 'Reward granting'], false, 'medium'),
      schema: QuestTools.COMPLETE_QUEST.inputSchema,
      handler: handleCompleteQuest
    },
    [QuestTools.GET_QUEST_LOG.name]: {
      metadata: meta(QuestTools.GET_QUEST_LOG.name, QuestTools.GET_QUEST_LOG.description, 'quest',
        ['quest', 'log', 'character', 'journal', 'active'],
        ['Character quest history', 'Active quests'], true, 'medium'),
      schema: QuestTools.GET_QUEST_LOG.inputSchema,
      handler: handleGetQuestLog
    },

    // === MATH TOOLS ===
    [MathTools.DICE_ROLL.name]: {
      metadata: meta(MathTools.DICE_ROLL.name, MathTools.DICE_ROLL.description, 'math',
        ['dice', 'roll', 'random', 'd20', 'd6', 'probability'],
        ['Dice rolling', 'Probability notation support'], false, 'low', false),
      schema: MathTools.DICE_ROLL.inputSchema,
      handler: handleDiceRoll
    },
    [MathTools.PROBABILITY_CALCULATE.name]: {
      metadata: meta(MathTools.PROBABILITY_CALCULATE.name, MathTools.PROBABILITY_CALCULATE.description, 'math',
        ['probability', 'calculate', 'chance', 'odds', 'statistics'],
        ['Probability calculation', 'Distribution analysis'], false, 'low'),
      schema: MathTools.PROBABILITY_CALCULATE.inputSchema,
      handler: handleProbabilityCalculate
    },
    [MathTools.ALGEBRA_SOLVE.name]: {
      metadata: meta(MathTools.ALGEBRA_SOLVE.name, MathTools.ALGEBRA_SOLVE.description, 'math',
        ['algebra', 'solve', 'equation', 'math', 'variable'],
        ['Equation solving', 'Variable isolation'], false, 'low'),
      schema: MathTools.ALGEBRA_SOLVE.inputSchema,
      handler: handleAlgebraSolve
    },
    [MathTools.ALGEBRA_SIMPLIFY.name]: {
      metadata: meta(MathTools.ALGEBRA_SIMPLIFY.name, MathTools.ALGEBRA_SIMPLIFY.description, 'math',
        ['algebra', 'simplify', 'expression', 'reduce'],
        ['Expression simplification'], false, 'low'),
      schema: MathTools.ALGEBRA_SIMPLIFY.inputSchema,
      handler: handleAlgebraSimplify
    },
    [MathTools.PHYSICS_PROJECTILE.name]: {
      metadata: meta(MathTools.PHYSICS_PROJECTILE.name, MathTools.PHYSICS_PROJECTILE.description, 'math',
        ['physics', 'projectile', 'trajectory', 'motion', 'ballistics'],
        ['Projectile motion calculation', 'Range/impact'], false, 'low'),
      schema: MathTools.PHYSICS_PROJECTILE.inputSchema,
      handler: handlePhysicsProjectile
    },

    // === STRATEGY TOOLS ===
    [StrategyTools.CREATE_NATION.name]: {
      metadata: meta(StrategyTools.CREATE_NATION.name, StrategyTools.CREATE_NATION.description, 'strategy',
        ['nation', 'create', 'new', 'country', 'faction'],
        ['Nation creation', 'Ideology/resources setup'], false, 'medium'),
      schema: StrategyTools.CREATE_NATION.inputSchema,
      handler: (args: any) => handleStrategyTool(StrategyTools.CREATE_NATION.name, args)
    },
    [StrategyTools.GET_STRATEGY_STATE.name]: {
      metadata: meta(StrategyTools.GET_STRATEGY_STATE.name, StrategyTools.GET_STRATEGY_STATE.description, 'strategy',
        ['strategy', 'state', 'world', 'nations', 'fog'],
        ['World strategy state', 'Fog of war'], true, 'high'),
      schema: StrategyTools.GET_STRATEGY_STATE.inputSchema,
      handler: (args: any) => handleStrategyTool(StrategyTools.GET_STRATEGY_STATE.name, args)
    },
    [StrategyTools.GET_NATION_STATE.name]: {
      metadata: meta(StrategyTools.GET_NATION_STATE.name, StrategyTools.GET_NATION_STATE.description, 'strategy',
        ['nation', 'state', 'private', 'info', 'resources'],
        ['Nation private state', 'Resources'], false, 'medium'),
      schema: StrategyTools.GET_NATION_STATE.inputSchema,
      handler: (args: any) => handleStrategyTool(StrategyTools.GET_NATION_STATE.name, args)
    },
    [StrategyTools.PROPOSE_ALLIANCE.name]: {
      metadata: meta(StrategyTools.PROPOSE_ALLIANCE.name, StrategyTools.PROPOSE_ALLIANCE.description, 'strategy',
        ['alliance', 'propose', 'diplomacy', 'treaty', 'pact'],
        ['Alliance proposal', 'Diplomacy'], false, 'low'),
      schema: StrategyTools.PROPOSE_ALLIANCE.inputSchema,
      handler: (args: any) => handleStrategyTool(StrategyTools.PROPOSE_ALLIANCE.name, args)
    },
    [StrategyTools.CLAIM_REGION.name]: {
      metadata: meta(StrategyTools.CLAIM_REGION.name, StrategyTools.CLAIM_REGION.description, 'strategy',
        ['claim', 'region', 'territory', 'nation', 'expand'],
        ['Territorial claim', 'Justification'], false, 'low'),
      schema: StrategyTools.CLAIM_REGION.inputSchema,
      handler: (args: any) => handleStrategyTool(StrategyTools.CLAIM_REGION.name, args)
    },
    [StrategyTools.RESOLVE_TURN.name]: {
      metadata: meta(StrategyTools.RESOLVE_TURN.name, StrategyTools.RESOLVE_TURN.description, 'strategy',
        ['turn', 'resolve', 'process', 'strategy', 'economy'],
        ['Turn processing', 'Conflict resolution'], true, 'high'),
      schema: StrategyTools.RESOLVE_TURN.inputSchema,
      handler: (args: any) => handleStrategyTool(StrategyTools.RESOLVE_TURN.name, args)
    },

    // === TURN MANAGEMENT TOOLS ===
    [TurnManagementTools.INIT_TURN_STATE.name]: {
      metadata: meta(TurnManagementTools.INIT_TURN_STATE.name, TurnManagementTools.INIT_TURN_STATE.description, 'turn-management',
        ['turn', 'init', 'initialize', 'state', 'setup'],
        ['Turn state initialization'], false, 'low'),
      schema: TurnManagementTools.INIT_TURN_STATE.inputSchema,
      handler: (args: any) => handleTurnManagementTool(TurnManagementTools.INIT_TURN_STATE.name, args)
    },
    [TurnManagementTools.GET_TURN_STATUS.name]: {
      metadata: meta(TurnManagementTools.GET_TURN_STATUS.name, TurnManagementTools.GET_TURN_STATUS.description, 'turn-management',
        ['turn', 'status', 'ready', 'nations', 'phase'],
        ['Current turn status', 'Ready status'], false, 'medium'),
      schema: TurnManagementTools.GET_TURN_STATUS.inputSchema,
      handler: (args: any) => handleTurnManagementTool(TurnManagementTools.GET_TURN_STATUS.name, args)
    },
    [TurnManagementTools.SUBMIT_TURN_ACTIONS.name]: {
      metadata: meta(TurnManagementTools.SUBMIT_TURN_ACTIONS.name, TurnManagementTools.SUBMIT_TURN_ACTIONS.description, 'turn-management',
        ['turn', 'action', 'submit', 'batch', 'orders'],
        ['Batch action submission'], false, 'medium'),
      schema: TurnManagementTools.SUBMIT_TURN_ACTIONS.inputSchema,
      handler: (args: any) => handleTurnManagementTool(TurnManagementTools.SUBMIT_TURN_ACTIONS.name, args)
    },
    [TurnManagementTools.MARK_READY.name]: {
      metadata: meta(TurnManagementTools.MARK_READY.name, TurnManagementTools.MARK_READY.description, 'turn-management',
        ['turn', 'ready', 'mark', 'status', 'done'],
        ['Turn readiness marking'], false, 'low'),
      schema: TurnManagementTools.MARK_READY.inputSchema,
      handler: (args: any) => handleTurnManagementTool(TurnManagementTools.MARK_READY.name, args)
    },
    [TurnManagementTools.POLL_TURN_RESULTS.name]: {
      metadata: meta(TurnManagementTools.POLL_TURN_RESULTS.name, TurnManagementTools.POLL_TURN_RESULTS.description, 'turn-management',
        ['turn', 'results', 'poll', 'outcome', 'resolution'],
        ['Turn result polling', 'Outcome'], false, 'medium'),
      schema: TurnManagementTools.POLL_TURN_RESULTS.inputSchema,
      handler: (args: any) => handleTurnManagementTool(TurnManagementTools.POLL_TURN_RESULTS.name, args)
    },

    // === SECRET TOOLS ===
    [SecretTools.CREATE_SECRET.name]: {
      metadata: meta(SecretTools.CREATE_SECRET.name, SecretTools.CREATE_SECRET.description, 'secret',
        ['secret', 'create', 'dm', 'hidden', 'mystery'],
        ['Secret creation', 'Reveal conditions'], false, 'medium'),
      schema: SecretTools.CREATE_SECRET.inputSchema,
      handler: handleCreateSecret
    },
    [SecretTools.GET_SECRET.name]: {
      metadata: meta(SecretTools.GET_SECRET.name, SecretTools.GET_SECRET.description, 'secret',
        ['secret', 'get', 'retrieve', 'dm', 'view'],
        ['Secret retrieval (DM only)'], false, 'low'),
      schema: SecretTools.GET_SECRET.inputSchema,
      handler: handleGetSecret
    },
    [SecretTools.LIST_SECRETS.name]: {
      metadata: meta(SecretTools.LIST_SECRETS.name, SecretTools.LIST_SECRETS.description, 'secret',
        ['secret', 'list', 'all', 'dm', 'query'],
        ['Secret listing (DM only)'], true, 'medium'),
      schema: SecretTools.LIST_SECRETS.inputSchema,
      handler: handleListSecrets
    },
    [SecretTools.UPDATE_SECRET.name]: {
      metadata: meta(SecretTools.UPDATE_SECRET.name, SecretTools.UPDATE_SECRET.description, 'secret',
        ['secret', 'update', 'modify', 'dm', 'edit'],
        ['Secret modification'], false, 'low'),
      schema: SecretTools.UPDATE_SECRET.inputSchema,
      handler: handleUpdateSecret
    },
    [SecretTools.DELETE_SECRET.name]: {
      metadata: meta(SecretTools.DELETE_SECRET.name, SecretTools.DELETE_SECRET.description, 'secret',
        ['secret', 'delete', 'remove', 'dm'],
        ['Secret deletion'], false, 'low'),
      schema: SecretTools.DELETE_SECRET.inputSchema,
      handler: handleDeleteSecret
    },
    [SecretTools.REVEAL_SECRET.name]: {
      metadata: meta(SecretTools.REVEAL_SECRET.name, SecretTools.REVEAL_SECRET.description, 'secret',
        ['secret', 'reveal', 'disclosure', 'player', 'spoiler'],
        ['Secret revealing', 'Spoiler formatting'], false, 'medium'),
      schema: SecretTools.REVEAL_SECRET.inputSchema,
      handler: handleRevealSecret
    },
    [SecretTools.CHECK_REVEAL_CONDITIONS.name]: {
      metadata: meta(SecretTools.CHECK_REVEAL_CONDITIONS.name, SecretTools.CHECK_REVEAL_CONDITIONS.description, 'secret',
        ['secret', 'reveal', 'check', 'condition', 'trigger'],
        ['Reveal condition evaluation'], false, 'medium'),
      schema: SecretTools.CHECK_REVEAL_CONDITIONS.inputSchema,
      handler: handleCheckRevealConditions
    },
    [SecretTools.GET_SECRETS_FOR_CONTEXT.name]: {
      metadata: meta(SecretTools.GET_SECRETS_FOR_CONTEXT.name, SecretTools.GET_SECRETS_FOR_CONTEXT.description, 'secret',
        ['secret', 'context', 'dm', 'prompt', 'inject'],
        ['Context-injected secrets (DM prompts)'], true, 'high'),
      schema: SecretTools.GET_SECRETS_FOR_CONTEXT.inputSchema,
      handler: handleGetSecretsForContext
    },
    [SecretTools.CHECK_FOR_LEAKS.name]: {
      metadata: meta(SecretTools.CHECK_FOR_LEAKS.name, SecretTools.CHECK_FOR_LEAKS.description, 'secret',
        ['secret', 'leak', 'detect', 'check', 'safety'],
        ['Secret leak detection'], false, 'low'),
      schema: SecretTools.CHECK_FOR_LEAKS.inputSchema,
      handler: handleCheckForLeaks
    },

    // === REST TOOLS ===
    [RestTools.TAKE_LONG_REST.name]: {
      metadata: meta(RestTools.TAKE_LONG_REST.name, RestTools.TAKE_LONG_REST.description, 'rest',
        ['rest', 'long', 'sleep', 'recovery', 'heal', '8hours'],
        ['Long rest (8 hours)', 'HP recovery'], false, 'low'),
      schema: RestTools.TAKE_LONG_REST.inputSchema,
      handler: handleTakeLongRest
    },
    [RestTools.TAKE_SHORT_REST.name]: {
      metadata: meta(RestTools.TAKE_SHORT_REST.name, RestTools.TAKE_SHORT_REST.description, 'rest',
        ['rest', 'short', 'sleep', 'recovery', 'hit-dice', '1hour'],
        ['Short rest (1 hour)', 'Hit die usage'], false, 'low'),
      schema: RestTools.TAKE_SHORT_REST.inputSchema,
      handler: handleTakeShortRest
    },

    // === CONCENTRATION TOOLS ===
    [ConcentrationTools.CHECK_CONCENTRATION_SAVE.name]: {
      metadata: meta(ConcentrationTools.CHECK_CONCENTRATION_SAVE.name, ConcentrationTools.CHECK_CONCENTRATION_SAVE.description, 'concentration',
        ['concentration', 'save', 'damage', 'maintain', 'constitution'],
        ['Concentration save throwing'], false, 'low'),
      schema: ConcentrationTools.CHECK_CONCENTRATION_SAVE.inputSchema,
      handler: handleCheckConcentrationSave
    },
    [ConcentrationTools.BREAK_CONCENTRATION.name]: {
      metadata: meta(ConcentrationTools.BREAK_CONCENTRATION.name, ConcentrationTools.BREAK_CONCENTRATION.description, 'concentration',
        ['concentration', 'break', 'end', 'spell', 'drop'],
        ['Voluntary concentration break'], false, 'low'),
      schema: ConcentrationTools.BREAK_CONCENTRATION.inputSchema,
      handler: handleBreakConcentration
    },
    [ConcentrationTools.GET_CONCENTRATION_STATE.name]: {
      metadata: meta(ConcentrationTools.GET_CONCENTRATION_STATE.name, ConcentrationTools.GET_CONCENTRATION_STATE.description, 'concentration',
        ['concentration', 'state', 'spell', 'duration', 'active'],
        ['Current concentration info'], false, 'low'),
      schema: ConcentrationTools.GET_CONCENTRATION_STATE.inputSchema,
      handler: handleGetConcentrationState
    },
    [ConcentrationTools.CHECK_CONCENTRATION_DURATION.name]: {
      metadata: meta(ConcentrationTools.CHECK_CONCENTRATION_DURATION.name, ConcentrationTools.CHECK_CONCENTRATION_DURATION.description, 'concentration',
        ['concentration', 'duration', 'expire', 'round', 'time'],
        ['Duration checking', 'Auto-expiration'], false, 'low'),
      schema: ConcentrationTools.CHECK_CONCENTRATION_DURATION.inputSchema,
      handler: handleCheckConcentrationDuration
    },
    [ConcentrationTools.CHECK_AUTO_BREAK.name]: {
      metadata: meta(ConcentrationTools.CHECK_AUTO_BREAK.name, ConcentrationTools.CHECK_AUTO_BREAK.description, 'concentration',
        ['concentration', 'break', 'condition', 'auto', 'incapacitated'],
        ['Automatic break detection'], false, 'low'),
      schema: ConcentrationTools.CHECK_AUTO_BREAK.inputSchema,
      handler: handleCheckAutoBreak
    },

    // === SCROLL TOOLS ===
    [ScrollTools.USE_SPELL_SCROLL.name]: {
      metadata: meta(ScrollTools.USE_SPELL_SCROLL.name, ScrollTools.USE_SPELL_SCROLL.description, 'scroll',
        ['scroll', 'use', 'spell', 'cast', 'arcana'],
        ['Spell scroll usage', 'Arcana checks'], false, 'medium'),
      schema: ScrollTools.USE_SPELL_SCROLL.inputSchema,
      handler: handleUseSpellScroll
    },
    [ScrollTools.CREATE_SPELL_SCROLL.name]: {
      metadata: meta(ScrollTools.CREATE_SPELL_SCROLL.name, ScrollTools.CREATE_SPELL_SCROLL.description, 'scroll',
        ['scroll', 'create', 'spell', 'new', 'scribe'],
        ['Spell scroll creation', 'DC setup'], false, 'low'),
      schema: ScrollTools.CREATE_SPELL_SCROLL.inputSchema,
      handler: handleCreateSpellScroll
    },
    [ScrollTools.IDENTIFY_SCROLL.name]: {
      metadata: meta(ScrollTools.IDENTIFY_SCROLL.name, ScrollTools.IDENTIFY_SCROLL.description, 'scroll',
        ['scroll', 'identify', 'arcana', 'check', 'read'],
        ['Scroll identification', 'Arcana DC'], false, 'low'),
      schema: ScrollTools.IDENTIFY_SCROLL.inputSchema,
      handler: handleIdentifyScroll
    },
    [ScrollTools.GET_SCROLL_USE_DC.name]: {
      metadata: meta(ScrollTools.GET_SCROLL_USE_DC.name, ScrollTools.GET_SCROLL_USE_DC.description, 'scroll',
        ['scroll', 'dc', 'difficulty', 'class', 'level'],
        ['DC calculation for scroll usage'], false, 'low'),
      schema: ScrollTools.GET_SCROLL_USE_DC.inputSchema,
      handler: handleGetScrollUseDC
    },
    [ScrollTools.GET_SCROLL_DETAILS.name]: {
      metadata: meta(ScrollTools.GET_SCROLL_DETAILS.name, ScrollTools.GET_SCROLL_DETAILS.description, 'scroll',
        ['scroll', 'details', 'info', 'spell', 'properties'],
        ['Scroll details retrieval'], false, 'low'),
      schema: ScrollTools.GET_SCROLL_DETAILS.inputSchema,
      handler: handleGetScrollDetails
    },
    [ScrollTools.CHECK_SCROLL_USABILITY.name]: {
      metadata: meta(ScrollTools.CHECK_SCROLL_USABILITY.name, ScrollTools.CHECK_SCROLL_USABILITY.description, 'scroll',
        ['scroll', 'usable', 'check', 'class', 'can-use'],
        ['Scroll usability checking'], false, 'low'),
      schema: ScrollTools.CHECK_SCROLL_USABILITY.inputSchema,
      handler: handleCheckScrollUsability
    },

    // === AURA TOOLS ===
    [AuraTools.CREATE_AURA.name]: {
      metadata: meta(AuraTools.CREATE_AURA.name, AuraTools.CREATE_AURA.description, 'aura',
        ['aura', 'create', 'effect', 'area', 'spirit-guardians'],
        ['Aura creation', 'Effect setup', 'Concentration'], false, 'medium'),
      schema: AuraTools.CREATE_AURA.inputSchema,
      handler: handleCreateAura
    },
    [AuraTools.GET_ACTIVE_AURAS.name]: {
      metadata: meta(AuraTools.GET_ACTIVE_AURAS.name, AuraTools.GET_ACTIVE_AURAS.description, 'aura',
        ['aura', 'active', 'list', 'effect', 'current'],
        ['Active aura listing'], true, 'medium'),
      schema: AuraTools.GET_ACTIVE_AURAS.inputSchema,
      handler: handleGetActiveAuras
    },
    [AuraTools.GET_AURAS_AFFECTING_CHARACTER.name]: {
      metadata: meta(AuraTools.GET_AURAS_AFFECTING_CHARACTER.name, AuraTools.GET_AURAS_AFFECTING_CHARACTER.description, 'aura',
        ['aura', 'character', 'affecting', 'effect', 'check'],
        ['Character-specific aura list'], false, 'medium'),
      schema: AuraTools.GET_AURAS_AFFECTING_CHARACTER.inputSchema,
      handler: handleGetAurasAffectingCharacter
    },
    [AuraTools.PROCESS_AURA_EFFECTS.name]: {
      metadata: meta(AuraTools.PROCESS_AURA_EFFECTS.name, AuraTools.PROCESS_AURA_EFFECTS.description, 'aura',
        ['aura', 'effect', 'process', 'trigger', 'apply'],
        ['Aura effect processing'], false, 'low'),
      schema: AuraTools.PROCESS_AURA_EFFECTS.inputSchema,
      handler: handleProcessAuraEffects
    },
    [AuraTools.REMOVE_AURA.name]: {
      metadata: meta(AuraTools.REMOVE_AURA.name, AuraTools.REMOVE_AURA.description, 'aura',
        ['aura', 'remove', 'end', 'effect', 'dismiss'],
        ['Aura removal'], false, 'low'),
      schema: AuraTools.REMOVE_AURA.inputSchema,
      handler: handleRemoveAura
    },
    [AuraTools.REMOVE_CHARACTER_AURAS.name]: {
      metadata: meta(AuraTools.REMOVE_CHARACTER_AURAS.name, AuraTools.REMOVE_CHARACTER_AURAS.description, 'aura',
        ['aura', 'character', 'remove', 'all', 'clear'],
        ['Bulk aura removal for character'], false, 'low'),
      schema: AuraTools.REMOVE_CHARACTER_AURAS.inputSchema,
      handler: handleRemoveCharacterAuras
    },
    [AuraTools.EXPIRE_AURAS.name]: {
      metadata: meta(AuraTools.EXPIRE_AURAS.name, AuraTools.EXPIRE_AURAS.description, 'aura',
        ['aura', 'expire', 'duration', 'check', 'cleanup'],
        ['Expired aura cleanup'], false, 'low'),
      schema: AuraTools.EXPIRE_AURAS.inputSchema,
      handler: handleExpireAuras
    },

    // === NPC MEMORY TOOLS ===
    [NpcMemoryTools.GET_NPC_RELATIONSHIP.name]: {
      metadata: meta(NpcMemoryTools.GET_NPC_RELATIONSHIP.name, NpcMemoryTools.GET_NPC_RELATIONSHIP.description, 'npc',
        ['npc', 'relationship', 'disposition', 'familiarity', 'status'],
        ['Relationship retrieval', 'Status info'], false, 'low'),
      schema: NpcMemoryTools.GET_NPC_RELATIONSHIP.inputSchema,
      handler: handleGetNpcRelationship
    },
    [NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.name]: {
      metadata: meta(NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.name, NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.description, 'npc',
        ['npc', 'relationship', 'update', 'disposition', 'change'],
        ['Relationship modification'], false, 'low'),
      schema: NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.inputSchema,
      handler: handleUpdateNpcRelationship
    },
    [NpcMemoryTools.RECORD_CONVERSATION_MEMORY.name]: {
      metadata: meta(NpcMemoryTools.RECORD_CONVERSATION_MEMORY.name, NpcMemoryTools.RECORD_CONVERSATION_MEMORY.description, 'npc',
        ['npc', 'memory', 'conversation', 'record', 'log'],
        ['Conversation logging', 'Importance tracking'], false, 'low'),
      schema: NpcMemoryTools.RECORD_CONVERSATION_MEMORY.inputSchema,
      handler: handleRecordConversationMemory
    },
    [NpcMemoryTools.GET_CONVERSATION_HISTORY.name]: {
      metadata: meta(NpcMemoryTools.GET_CONVERSATION_HISTORY.name, NpcMemoryTools.GET_CONVERSATION_HISTORY.description, 'npc',
        ['npc', 'conversation', 'history', 'memory', 'past'],
        ['Interaction history retrieval'], true, 'medium'),
      schema: NpcMemoryTools.GET_CONVERSATION_HISTORY.inputSchema,
      handler: handleGetConversationHistory
    },
    [NpcMemoryTools.GET_RECENT_INTERACTIONS.name]: {
      metadata: meta(NpcMemoryTools.GET_RECENT_INTERACTIONS.name, NpcMemoryTools.GET_RECENT_INTERACTIONS.description, 'npc',
        ['npc', 'recent', 'interaction', 'history', 'latest'],
        ['Recent interaction listing'], true, 'medium'),
      schema: NpcMemoryTools.GET_RECENT_INTERACTIONS.inputSchema,
      handler: handleGetRecentInteractions
    },
    [NpcMemoryTools.GET_NPC_CONTEXT.name]: {
      metadata: meta(NpcMemoryTools.GET_NPC_CONTEXT.name, NpcMemoryTools.GET_NPC_CONTEXT.description, 'npc',
        ['npc', 'context', 'info', 'relationship', 'llm'],
        ['NPC context injection', 'LLM-friendly'], true, 'medium'),
      schema: NpcMemoryTools.GET_NPC_CONTEXT.inputSchema,
      handler: handleGetNpcContext
    },
    [NpcMemoryTools.INTERACT_SOCIALLY.name]: {
      metadata: meta(NpcMemoryTools.INTERACT_SOCIALLY.name, NpcMemoryTools.INTERACT_SOCIALLY.description, 'npc',
        ['npc', 'interact', 'social', 'conversation', 'speak'],
        ['Social interaction', 'Stealth vs Perception'], false, 'medium'),
      schema: NpcMemoryTools.INTERACT_SOCIALLY.inputSchema,
      handler: handleInteractSocially
    },

    // === SPATIAL TOOLS ===
    [SpatialTools.LOOK_AT_SURROUNDINGS.name]: {
      metadata: meta(SpatialTools.LOOK_AT_SURROUNDINGS.name, SpatialTools.LOOK_AT_SURROUNDINGS.description, 'spatial',
        ['spatial', 'surroundings', 'look', 'perception', 'room'],
        ['Environment description', 'Darkness handling'], true, 'high'),
      schema: SpatialTools.LOOK_AT_SURROUNDINGS.inputSchema,
      handler: handleLookAtSurroundings
    },
    [SpatialTools.GENERATE_ROOM_NODE.name]: {
      metadata: meta(SpatialTools.GENERATE_ROOM_NODE.name, SpatialTools.GENERATE_ROOM_NODE.description, 'spatial',
        ['spatial', 'room', 'generate', 'node', 'create'],
        ['Room generation', 'Atmosphere setup'], false, 'medium'),
      schema: SpatialTools.GENERATE_ROOM_NODE.inputSchema,
      handler: handleGenerateRoomNode
    },
    [SpatialTools.GET_ROOM_EXITS.name]: {
      metadata: meta(SpatialTools.GET_ROOM_EXITS.name, SpatialTools.GET_ROOM_EXITS.description, 'spatial',
        ['spatial', 'exit', 'room', 'direction', 'doors'],
        ['Exit listing', 'Navigation'], false, 'low'),
      schema: SpatialTools.GET_ROOM_EXITS.inputSchema,
      handler: handleGetRoomExits
    },
    [SpatialTools.MOVE_CHARACTER_TO_ROOM.name]: {
      metadata: meta(SpatialTools.MOVE_CHARACTER_TO_ROOM.name, SpatialTools.MOVE_CHARACTER_TO_ROOM.description, 'spatial',
        ['spatial', 'move', 'character', 'room', 'enter'],
        ['Character positioning', 'Location tracking'], false, 'low'),
      schema: SpatialTools.MOVE_CHARACTER_TO_ROOM.inputSchema,
      handler: handleMoveCharacterToRoom
    },

    // === THEFT TOOLS ===
    [TheftTools.STEAL_ITEM.name]: {
      metadata: meta(TheftTools.STEAL_ITEM.name, TheftTools.STEAL_ITEM.description, 'theft',
        ['theft', 'steal', 'item', 'heat', 'crime'],
        ['Item theft', 'Heat generation'], false, 'low'),
      schema: TheftTools.STEAL_ITEM.inputSchema,
      handler: handleStealItem
    },
    [TheftTools.CHECK_ITEM_STOLEN.name]: {
      metadata: meta(TheftTools.CHECK_ITEM_STOLEN.name, TheftTools.CHECK_ITEM_STOLEN.description, 'theft',
        ['theft', 'stolen', 'check', 'status', 'provenance'],
        ['Theft status checking'], false, 'low'),
      schema: TheftTools.CHECK_ITEM_STOLEN.inputSchema,
      handler: handleCheckItemStolen
    },
    [TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.name]: {
      metadata: meta(TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.name, TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.description, 'theft',
        ['theft', 'stolen', 'check', 'inventory', 'search'],
        ['Character theft detection'], false, 'medium'),
      schema: TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.inputSchema,
      handler: handleCheckStolenItemsOnCharacter
    },
    [TheftTools.CHECK_ITEM_RECOGNITION.name]: {
      metadata: meta(TheftTools.CHECK_ITEM_RECOGNITION.name, TheftTools.CHECK_ITEM_RECOGNITION.description, 'theft',
        ['theft', 'recognition', 'npc', 'detection', 'owner'],
        ['NPC item recognition'], false, 'low'),
      schema: TheftTools.CHECK_ITEM_RECOGNITION.inputSchema,
      handler: handleCheckItemRecognition
    },
    [TheftTools.SELL_TO_FENCE.name]: {
      metadata: meta(TheftTools.SELL_TO_FENCE.name, TheftTools.SELL_TO_FENCE.description, 'theft',
        ['theft', 'fence', 'sell', 'stolen', 'black-market'],
        ['Stolen item fencing'], false, 'low'),
      schema: TheftTools.SELL_TO_FENCE.inputSchema,
      handler: handleSellToFence
    },
    [TheftTools.REGISTER_FENCE.name]: {
      metadata: meta(TheftTools.REGISTER_FENCE.name, TheftTools.REGISTER_FENCE.description, 'theft',
        ['theft', 'fence', 'register', 'npc', 'dealer'],
        ['Fence NPC registration'], false, 'low'),
      schema: TheftTools.REGISTER_FENCE.inputSchema,
      handler: handleRegisterFence
    },
    [TheftTools.REPORT_THEFT.name]: {
      metadata: meta(TheftTools.REPORT_THEFT.name, TheftTools.REPORT_THEFT.description, 'theft',
        ['theft', 'report', 'guards', 'bounty', 'crime'],
        ['Theft reporting', 'Bounty setting'], false, 'low'),
      schema: TheftTools.REPORT_THEFT.inputSchema,
      handler: handleReportTheft
    },
    [TheftTools.ADVANCE_HEAT_DECAY.name]: {
      metadata: meta(TheftTools.ADVANCE_HEAT_DECAY.name, TheftTools.ADVANCE_HEAT_DECAY.description, 'theft',
        ['theft', 'heat', 'decay', 'time', 'cooldown'],
        ['Heat level decay tracking'], false, 'low'),
      schema: TheftTools.ADVANCE_HEAT_DECAY.inputSchema,
      handler: handleAdvanceHeatDecay
    },
    [TheftTools.GET_FENCE.name]: {
      metadata: meta(TheftTools.GET_FENCE.name, TheftTools.GET_FENCE.description, 'theft',
        ['theft', 'fence', 'info', 'npc', 'dealer'],
        ['Fence information retrieval'], false, 'low'),
      schema: TheftTools.GET_FENCE.inputSchema,
      handler: handleGetFence
    },
    [TheftTools.LIST_FENCES.name]: {
      metadata: meta(TheftTools.LIST_FENCES.name, TheftTools.LIST_FENCES.description, 'theft',
        ['theft', 'fence', 'list', 'all', 'dealers'],
        ['Fence listing'], false, 'medium'),
      schema: TheftTools.LIST_FENCES.inputSchema,
      handler: handleListFences
    },

    // === CORPSE/LOOT TOOLS ===
    [CorpseTools.GET_CORPSE.name]: {
      metadata: meta(CorpseTools.GET_CORPSE.name, CorpseTools.GET_CORPSE.description, 'corpse',
        ['corpse', 'get', 'loot', 'body', 'dead'],
        ['Corpse retrieval with loot'], false, 'medium'),
      schema: CorpseTools.GET_CORPSE.inputSchema,
      handler: handleGetCorpse
    },
    [CorpseTools.GET_CORPSE_BY_CHARACTER.name]: {
      metadata: meta(CorpseTools.GET_CORPSE_BY_CHARACTER.name, CorpseTools.GET_CORPSE_BY_CHARACTER.description, 'corpse',
        ['corpse', 'character', 'body', 'death', 'remains'],
        ["Dead character's corpse"], false, 'low'),
      schema: CorpseTools.GET_CORPSE_BY_CHARACTER.inputSchema,
      handler: handleGetCorpseByCharacter
    },
    [CorpseTools.LIST_CORPSES_IN_ENCOUNTER.name]: {
      metadata: meta(CorpseTools.LIST_CORPSES_IN_ENCOUNTER.name, CorpseTools.LIST_CORPSES_IN_ENCOUNTER.description, 'corpse',
        ['corpse', 'encounter', 'list', 'battle', 'dead'],
        ['Encounter corpse listing'], true, 'medium'),
      schema: CorpseTools.LIST_CORPSES_IN_ENCOUNTER.inputSchema,
      handler: handleListCorpsesInEncounter
    },
    [CorpseTools.LIST_CORPSES_NEARBY.name]: {
      metadata: meta(CorpseTools.LIST_CORPSES_NEARBY.name, CorpseTools.LIST_CORPSES_NEARBY.description, 'corpse',
        ['corpse', 'nearby', 'proximity', 'region', 'search'],
        ['Spatial corpse discovery'], false, 'medium'),
      schema: CorpseTools.LIST_CORPSES_NEARBY.inputSchema,
      handler: handleListCorpsesNearby
    },
    [CorpseTools.LOOT_CORPSE.name]: {
      metadata: meta(CorpseTools.LOOT_CORPSE.name, CorpseTools.LOOT_CORPSE.description, 'corpse',
        ['corpse', 'loot', 'item', 'take', 'pickup'],
        ['Corpse looting', 'Item extraction'], false, 'low'),
      schema: CorpseTools.LOOT_CORPSE.inputSchema,
      handler: handleLootCorpse
    },
    [CorpseTools.HARVEST_CORPSE.name]: {
      metadata: meta(CorpseTools.HARVEST_CORPSE.name, CorpseTools.HARVEST_CORPSE.description, 'corpse',
        ['corpse', 'harvest', 'resource', 'material', 'skin'],
        ['Resource harvesting', 'Skill checks'], false, 'low'),
      schema: CorpseTools.HARVEST_CORPSE.inputSchema,
      handler: handleHarvestCorpse
    },
    [CorpseTools.CREATE_CORPSE.name]: {
      metadata: meta(CorpseTools.CREATE_CORPSE.name, CorpseTools.CREATE_CORPSE.description, 'corpse',
        ['corpse', 'create', 'death', 'body', 'manual'],
        ['Corpse creation for dead NPCs'], false, 'low'),
      schema: CorpseTools.CREATE_CORPSE.inputSchema,
      handler: handleCreateCorpse
    },
    [CorpseTools.GENERATE_LOOT.name]: {
      metadata: meta(CorpseTools.GENERATE_LOOT.name, CorpseTools.GENERATE_LOOT.description, 'corpse',
        ['corpse', 'loot', 'generate', 'table', 'random'],
        ['Loot generation by CR/type'], false, 'medium'),
      schema: CorpseTools.GENERATE_LOOT.inputSchema,
      handler: handleGenerateLoot
    },
    [CorpseTools.GET_CORPSE_INVENTORY.name]: {
      metadata: meta(CorpseTools.GET_CORPSE_INVENTORY.name, CorpseTools.GET_CORPSE_INVENTORY.description, 'corpse',
        ['corpse', 'inventory', 'items', 'loot', 'contents'],
        ['Corpse inventory listing'], true, 'medium'),
      schema: CorpseTools.GET_CORPSE_INVENTORY.inputSchema,
      handler: handleGetCorpseInventory
    },
    [CorpseTools.CREATE_LOOT_TABLE.name]: {
      metadata: meta(CorpseTools.CREATE_LOOT_TABLE.name, CorpseTools.CREATE_LOOT_TABLE.description, 'corpse',
        ['corpse', 'loot', 'table', 'template', 'create'],
        ['Loot table creation', 'Customization'], false, 'medium'),
      schema: CorpseTools.CREATE_LOOT_TABLE.inputSchema,
      handler: handleCreateLootTable
    },
    [CorpseTools.GET_LOOT_TABLE.name]: {
      metadata: meta(CorpseTools.GET_LOOT_TABLE.name, CorpseTools.GET_LOOT_TABLE.description, 'corpse',
        ['corpse', 'loot', 'table', 'query', 'get'],
        ['Loot table retrieval'], false, 'medium'),
      schema: CorpseTools.GET_LOOT_TABLE.inputSchema,
      handler: handleGetLootTable
    },
    [CorpseTools.LIST_LOOT_TABLES.name]: {
      metadata: meta(CorpseTools.LIST_LOOT_TABLES.name, CorpseTools.LIST_LOOT_TABLES.description, 'corpse',
        ['corpse', 'loot', 'table', 'all', 'list'],
        ['Loot table listing'], false, 'medium'),
      schema: CorpseTools.LIST_LOOT_TABLES.inputSchema,
      handler: handleListLootTables
    },
    [CorpseTools.ADVANCE_CORPSE_DECAY.name]: {
      metadata: meta(CorpseTools.ADVANCE_CORPSE_DECAY.name, CorpseTools.ADVANCE_CORPSE_DECAY.description, 'corpse',
        ['corpse', 'decay', 'time', 'rot', 'advance'],
        ['Corpse decay progression'], false, 'low'),
      schema: CorpseTools.ADVANCE_CORPSE_DECAY.inputSchema,
      handler: handleAdvanceCorpseDecay
    },
    [CorpseTools.CLEANUP_CORPSES.name]: {
      metadata: meta(CorpseTools.CLEANUP_CORPSES.name, CorpseTools.CLEANUP_CORPSES.description, 'corpse',
        ['corpse', 'cleanup', 'decay', 'remove', 'gone'],
        ['Decayed corpse cleanup'], false, 'low'),
      schema: CorpseTools.CLEANUP_CORPSES.inputSchema,
      handler: handleCleanupCorpses
    },

    // === IMPROVISATION TOOLS ===
    [ImprovisationTools.RESOLVE_IMPROVISED_STUNT.name]: {
      metadata: meta(ImprovisationTools.RESOLVE_IMPROVISED_STUNT.name, ImprovisationTools.RESOLVE_IMPROVISED_STUNT.description, 'improvisation',
        ['stunt', 'improvise', 'cool', 'action', 'creative'],
        ['Rule of Cool resolution', 'Skill checks'], false, 'medium'),
      schema: ImprovisationTools.RESOLVE_IMPROVISED_STUNT.inputSchema,
      handler: handleResolveImprovisedStunt
    },
    [ImprovisationTools.APPLY_CUSTOM_EFFECT.name]: {
      metadata: meta(ImprovisationTools.APPLY_CUSTOM_EFFECT.name, ImprovisationTools.APPLY_CUSTOM_EFFECT.description, 'improvisation',
        ['effect', 'custom', 'apply', 'buff', 'curse', 'boon'],
        ['Custom effect application', 'Power levels'], false, 'medium'),
      schema: ImprovisationTools.APPLY_CUSTOM_EFFECT.inputSchema,
      handler: handleApplyCustomEffect
    },
    [ImprovisationTools.GET_CUSTOM_EFFECTS.name]: {
      metadata: meta(ImprovisationTools.GET_CUSTOM_EFFECTS.name, ImprovisationTools.GET_CUSTOM_EFFECTS.description, 'improvisation',
        ['effect', 'custom', 'list', 'character', 'active'],
        ['Active effect listing'], true, 'medium'),
      schema: ImprovisationTools.GET_CUSTOM_EFFECTS.inputSchema,
      handler: handleGetCustomEffects
    },
    [ImprovisationTools.REMOVE_CUSTOM_EFFECT.name]: {
      metadata: meta(ImprovisationTools.REMOVE_CUSTOM_EFFECT.name, ImprovisationTools.REMOVE_CUSTOM_EFFECT.description, 'improvisation',
        ['effect', 'custom', 'remove', 'end', 'dispel'],
        ['Effect removal'], false, 'low'),
      schema: ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema,
      handler: handleRemoveCustomEffect
    },
    [ImprovisationTools.PROCESS_EFFECT_TRIGGERS.name]: {
      metadata: meta(ImprovisationTools.PROCESS_EFFECT_TRIGGERS.name, ImprovisationTools.PROCESS_EFFECT_TRIGGERS.description, 'improvisation',
        ['effect', 'trigger', 'process', 'event', 'fire'],
        ['Effect trigger evaluation'], false, 'low'),
      schema: ImprovisationTools.PROCESS_EFFECT_TRIGGERS.inputSchema,
      handler: handleProcessEffectTriggers
    },
    [ImprovisationTools.ADVANCE_EFFECT_DURATIONS.name]: {
      metadata: meta(ImprovisationTools.ADVANCE_EFFECT_DURATIONS.name, ImprovisationTools.ADVANCE_EFFECT_DURATIONS.description, 'improvisation',
        ['effect', 'duration', 'advance', 'round', 'time'],
        ['Duration progression', 'Expiration'], false, 'low'),
      schema: ImprovisationTools.ADVANCE_EFFECT_DURATIONS.inputSchema,
      handler: handleAdvanceEffectDurations
    },
    [ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.name]: {
      metadata: meta(ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.name, ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.description, 'improvisation',
        ['spell', 'synthesis', 'create', 'new', 'wild-magic', 'arcane'],
        ['Spell creation via Arcane Synthesis', 'Wild Magic'], false, 'high'),
      schema: ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.inputSchema,
      handler: handleAttemptArcaneSynthesis
    },
    [ImprovisationTools.GET_SYNTHESIZED_SPELLS.name]: {
      metadata: meta(ImprovisationTools.GET_SYNTHESIZED_SPELLS.name, ImprovisationTools.GET_SYNTHESIZED_SPELLS.description, 'improvisation',
        ['spell', 'synthesis', 'learned', 'list', 'created'],
        ['Learned synthesized spells listing'], false, 'medium'),
      schema: ImprovisationTools.GET_SYNTHESIZED_SPELLS.inputSchema,
      handler: handleGetSynthesizedSpells
    },

    // === BATCH TOOLS ===
    [BatchTools.BATCH_CREATE_CHARACTERS.name]: {
      metadata: meta(BatchTools.BATCH_CREATE_CHARACTERS.name, BatchTools.BATCH_CREATE_CHARACTERS.description, 'batch',
        ['batch', 'character', 'create', 'multiple', 'party', 'squad'],
        ['Batch character creation', 'Party generation'], false, 'medium'),
      schema: BatchTools.BATCH_CREATE_CHARACTERS.inputSchema,
      handler: handleBatchCreateCharacters
    },
    [BatchTools.BATCH_CREATE_NPCS.name]: {
      metadata: meta(BatchTools.BATCH_CREATE_NPCS.name, BatchTools.BATCH_CREATE_NPCS.description, 'batch',
        ['batch', 'npc', 'create', 'multiple', 'settlement', 'population'],
        ['Batch NPC generation', 'Settlement population'], false, 'medium'),
      schema: BatchTools.BATCH_CREATE_NPCS.inputSchema,
      handler: handleBatchCreateNpcs
    },
    [BatchTools.BATCH_DISTRIBUTE_ITEMS.name]: {
      metadata: meta(BatchTools.BATCH_DISTRIBUTE_ITEMS.name, BatchTools.BATCH_DISTRIBUTE_ITEMS.description, 'batch',
        ['batch', 'item', 'distribute', 'loot', 'equipment', 'give'],
        ['Batch item distribution', 'Loot sharing'], false, 'medium'),
      schema: BatchTools.BATCH_DISTRIBUTE_ITEMS.inputSchema,
      handler: handleBatchDistributeItems
    },

    // === WORKFLOW TOOLS ===
    [WorkflowTools.EXECUTE_WORKFLOW.name]: {
      metadata: meta(WorkflowTools.EXECUTE_WORKFLOW.name, WorkflowTools.EXECUTE_WORKFLOW.description, 'batch',
        ['workflow', 'execute', 'automation', 'template', 'batch'],
        ['Workflow execution', 'Multi-step automation'], false, 'high'),
      schema: WorkflowTools.EXECUTE_WORKFLOW.inputSchema,
      handler: handleExecuteWorkflow
    },
    [WorkflowTools.LIST_TEMPLATES.name]: {
      metadata: meta(WorkflowTools.LIST_TEMPLATES.name, WorkflowTools.LIST_TEMPLATES.description, 'batch',
        ['workflow', 'template', 'list', 'available'],
        ['Template listing'], false, 'low'),
      schema: WorkflowTools.LIST_TEMPLATES.inputSchema,
      handler: handleListTemplates
    },
    [WorkflowTools.GET_TEMPLATE.name]: {
      metadata: meta(WorkflowTools.GET_TEMPLATE.name, WorkflowTools.GET_TEMPLATE.description, 'batch',
        ['workflow', 'template', 'get', 'details'],
        ['Template details'], false, 'low'),
      schema: WorkflowTools.GET_TEMPLATE.inputSchema,
      handler: handleGetTemplate
    },

    // === EVENT INBOX TOOLS ===
    [EventInboxTools.POLL_EVENTS.name]: {
      metadata: meta(EventInboxTools.POLL_EVENTS.name, EventInboxTools.POLL_EVENTS.description, 'meta',
        ['event', 'poll', 'inbox', 'npc', 'autonomous', 'notification'],
        ['Event polling', 'NPC autonomy'], false, 'low'),
      schema: EventInboxTools.POLL_EVENTS.inputSchema,
      handler: handlePollEvents
    },
    [EventInboxTools.PUSH_EVENT.name]: {
      metadata: meta(EventInboxTools.PUSH_EVENT.name, EventInboxTools.PUSH_EVENT.description, 'meta',
        ['event', 'push', 'queue', 'npc', 'action', 'notification'],
        ['Event creation', 'NPC action simulation'], false, 'low'),
      schema: EventInboxTools.PUSH_EVENT.inputSchema,
      handler: handlePushEvent
    },
    [EventInboxTools.GET_EVENT_HISTORY.name]: {
      metadata: meta(EventInboxTools.GET_EVENT_HISTORY.name, EventInboxTools.GET_EVENT_HISTORY.description, 'meta',
        ['event', 'history', 'log', 'recent'],
        ['Event history'], false, 'low'),
      schema: EventInboxTools.GET_EVENT_HISTORY.inputSchema,
      handler: handleGetEventHistory
    },
    [EventInboxTools.GET_PENDING_COUNT.name]: {
      metadata: meta(EventInboxTools.GET_PENDING_COUNT.name, EventInboxTools.GET_PENDING_COUNT.description, 'meta',
        ['event', 'count', 'pending', 'unread'],
        ['Pending event count'], false, 'low'),
      schema: EventInboxTools.GET_PENDING_COUNT.inputSchema,
      handler: handleGetPendingCount
    }
    // Note: search_tools and load_tool_schema are registered separately in index.ts with full handlers
  };

  return cachedRegistry;
}

// Get all tool metadata for search
export function getAllToolMetadata(): ToolMetadata[] {
  const registry = buildToolRegistry();
  return Object.values(registry).map(entry => entry.metadata);
}

// Get tool schema by name
export function getToolSchema(toolName: string): any | undefined {
  const registry = buildToolRegistry();
  return registry[toolName]?.schema;
}

// Get tool handler by name
export function getToolHandler(toolName: string): Function | undefined {
  const registry = buildToolRegistry();
  return registry[toolName]?.handler;
}

// Get categories with tool counts
export function getToolCategories(): { category: string; count: number }[] {
  const registry = buildToolRegistry();
  const counts: Record<string, number> = {};
  
  for (const entry of Object.values(registry)) {
    const cat = entry.metadata.category;
    counts[cat] = (counts[cat] || 0) + 1;
  }
  
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
