import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Tools, handleGenerateWorld, handleGetWorldState, handleApplyMapPatch, handleGetWorldMapOverview, handleGetRegionMap, handleGetWorldTiles, handlePreviewMapPatch, handleFindValidPoiLocation, handleSuggestPoiLocations, setWorldPubSub } from './tools.js';
import { CombatTools, handleCreateEncounter, handleGetEncounterState, handleExecuteCombatAction, handleAdvanceTurn, handleEndEncounter, handleLoadEncounter, handleRollDeathSave, handleExecuteLairAction, setCombatPubSub } from './combat-tools.js';
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
import { PubSub } from '../engine/pubsub.js';
import { registerEventTools } from './events.js';
import { AuditLogger } from './audit.js';
import { withSession } from './types.js';
import { closeDb, getDbPath } from '../storage/index.js';

/**
 * Setup graceful shutdown handlers to ensure database is properly closed.
 */
function setupShutdownHandlers(): void {
    let isShuttingDown = false;

    const shutdown = (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        console.error(`[Server] Received ${signal}, shutting down gracefully...`);

        try {
            closeDb();
            console.error('[Server] Shutdown complete');
            process.exit(0);
        } catch (e) {
            console.error('[Server] Error during shutdown:', (e as Error).message);
            process.exit(1);
        }
    };

    // Handle various termination signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGHUP', () => shutdown('SIGHUP'));

    // Handle Windows-specific events
    if (process.platform === 'win32') {
        // On Windows, SIGINT is emulated when Ctrl+C is pressed
        process.on('SIGBREAK', () => shutdown('SIGBREAK'));
    }

    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
        console.error('[Server] Uncaught exception:', error);
        shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
        console.error('[Server] Unhandled rejection:', reason);
        shutdown('unhandledRejection');
    });

    // Handle normal exit
    process.on('exit', (code) => {
        if (!isShuttingDown) {
            console.error(`[Server] Process exiting with code ${code}`);
            closeDb();
        }
    });
}

async function main() {
    // Setup graceful shutdown handlers first
    setupShutdownHandlers();

    // Log database path for debugging
    console.error(`[Server] Database path: ${getDbPath()}`);

    // Create server instance
    const server = new McpServer({
        name: 'rpg-mcp',
        version: '1.1.0'
    });

    // Initialize PubSub
    const pubsub = new PubSub();
    setCombatPubSub(pubsub);
    setWorldPubSub(pubsub);

    // Register Event Tools
    registerEventTools(server, pubsub);

    // Initialize AuditLogger
    const auditLogger = new AuditLogger();

    // Register Core Tools
    server.tool(
        Tools.GENERATE_WORLD.name,
        Tools.GENERATE_WORLD.description,
        Tools.GENERATE_WORLD.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.GENERATE_WORLD.name, withSession(Tools.GENERATE_WORLD.inputSchema, handleGenerateWorld))
    );

    server.tool(
        Tools.GET_WORLD_STATE.name,
        Tools.GET_WORLD_STATE.description,
        Tools.GET_WORLD_STATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.GET_WORLD_STATE.name, withSession(Tools.GET_WORLD_STATE.inputSchema, handleGetWorldState))
    );

    server.tool(
        Tools.APPLY_MAP_PATCH.name,
        Tools.APPLY_MAP_PATCH.description,
        Tools.APPLY_MAP_PATCH.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.APPLY_MAP_PATCH.name, withSession(Tools.APPLY_MAP_PATCH.inputSchema, handleApplyMapPatch))
    );

    server.tool(
        Tools.GET_WORLD_MAP_OVERVIEW.name,
        Tools.GET_WORLD_MAP_OVERVIEW.description,
        Tools.GET_WORLD_MAP_OVERVIEW.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.GET_WORLD_MAP_OVERVIEW.name, withSession(Tools.GET_WORLD_MAP_OVERVIEW.inputSchema, handleGetWorldMapOverview))
    );

    server.tool(
        Tools.GET_REGION_MAP.name,
        Tools.GET_REGION_MAP.description,
        Tools.GET_REGION_MAP.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.GET_REGION_MAP.name, withSession(Tools.GET_REGION_MAP.inputSchema, handleGetRegionMap))
    );

    server.tool(
        Tools.GET_WORLD_TILES.name,
        Tools.GET_WORLD_TILES.description,
        Tools.GET_WORLD_TILES.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.GET_WORLD_TILES.name, withSession(Tools.GET_WORLD_TILES.inputSchema, handleGetWorldTiles))
    );

    server.tool(
        Tools.PREVIEW_MAP_PATCH.name,
        Tools.PREVIEW_MAP_PATCH.description,
        Tools.PREVIEW_MAP_PATCH.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.PREVIEW_MAP_PATCH.name, withSession(Tools.PREVIEW_MAP_PATCH.inputSchema, handlePreviewMapPatch))
    );

    // Register POI Location Tools (terrain-aware placement)
    server.tool(
        Tools.FIND_VALID_POI_LOCATION.name,
        Tools.FIND_VALID_POI_LOCATION.description,
        Tools.FIND_VALID_POI_LOCATION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.FIND_VALID_POI_LOCATION.name, withSession(Tools.FIND_VALID_POI_LOCATION.inputSchema, handleFindValidPoiLocation))
    );

    server.tool(
        Tools.SUGGEST_POI_LOCATIONS.name,
        Tools.SUGGEST_POI_LOCATIONS.description,
        Tools.SUGGEST_POI_LOCATIONS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(Tools.SUGGEST_POI_LOCATIONS.name, withSession(Tools.SUGGEST_POI_LOCATIONS.inputSchema, handleSuggestPoiLocations))
    );

    // Register Combat Tools
    server.tool(
        CombatTools.CREATE_ENCOUNTER.name,
        CombatTools.CREATE_ENCOUNTER.description,
        CombatTools.CREATE_ENCOUNTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.CREATE_ENCOUNTER.name, withSession(CombatTools.CREATE_ENCOUNTER.inputSchema, handleCreateEncounter))
    );

    server.tool(
        CombatTools.GET_ENCOUNTER_STATE.name,
        CombatTools.GET_ENCOUNTER_STATE.description,
        CombatTools.GET_ENCOUNTER_STATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.GET_ENCOUNTER_STATE.name, withSession(CombatTools.GET_ENCOUNTER_STATE.inputSchema, handleGetEncounterState))
    );

    server.tool(
        CombatTools.EXECUTE_COMBAT_ACTION.name,
        CombatTools.EXECUTE_COMBAT_ACTION.description,
        CombatTools.EXECUTE_COMBAT_ACTION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.EXECUTE_COMBAT_ACTION.name, withSession(CombatTools.EXECUTE_COMBAT_ACTION.inputSchema, handleExecuteCombatAction))
    );

    server.tool(
        CombatTools.ADVANCE_TURN.name,
        CombatTools.ADVANCE_TURN.description,
        CombatTools.ADVANCE_TURN.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.ADVANCE_TURN.name, withSession(CombatTools.ADVANCE_TURN.inputSchema, handleAdvanceTurn))
    );

    server.tool(
        CombatTools.END_ENCOUNTER.name,
        CombatTools.END_ENCOUNTER.description,
        CombatTools.END_ENCOUNTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.END_ENCOUNTER.name, withSession(CombatTools.END_ENCOUNTER.inputSchema, handleEndEncounter))
    );

    server.tool(
        CombatTools.LOAD_ENCOUNTER.name,
        CombatTools.LOAD_ENCOUNTER.description,
        CombatTools.LOAD_ENCOUNTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.LOAD_ENCOUNTER.name, withSession(CombatTools.LOAD_ENCOUNTER.inputSchema, handleLoadEncounter))
    );

    // MED-003: Death Saving Throw Tool
    server.tool(
        CombatTools.ROLL_DEATH_SAVE.name,
        CombatTools.ROLL_DEATH_SAVE.description,
        CombatTools.ROLL_DEATH_SAVE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.ROLL_DEATH_SAVE.name, withSession(CombatTools.ROLL_DEATH_SAVE.inputSchema, handleRollDeathSave))
    );

    // HIGH-006: Lair Action Tool
    server.tool(
        CombatTools.EXECUTE_LAIR_ACTION.name,
        CombatTools.EXECUTE_LAIR_ACTION.description,
        CombatTools.EXECUTE_LAIR_ACTION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CombatTools.EXECUTE_LAIR_ACTION.name, withSession(CombatTools.EXECUTE_LAIR_ACTION.inputSchema, handleExecuteLairAction))
    );

    // Register CRUD Tools
    server.tool(
        CRUDTools.CREATE_WORLD.name,
        CRUDTools.CREATE_WORLD.description,
        CRUDTools.CREATE_WORLD.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.CREATE_WORLD.name, withSession(CRUDTools.CREATE_WORLD.inputSchema, handleCreateWorld))
    );

    server.tool(
        CRUDTools.GET_WORLD.name,
        CRUDTools.GET_WORLD.description,
        CRUDTools.GET_WORLD.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.GET_WORLD.name, withSession(CRUDTools.GET_WORLD.inputSchema, handleGetWorld))
    );

    server.tool(
        CRUDTools.LIST_WORLDS.name,
        CRUDTools.LIST_WORLDS.description,
        CRUDTools.LIST_WORLDS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.LIST_WORLDS.name, withSession(CRUDTools.LIST_WORLDS.inputSchema, handleListWorlds))
    );

    server.tool(
        CRUDTools.UPDATE_WORLD_ENVIRONMENT.name,
        CRUDTools.UPDATE_WORLD_ENVIRONMENT.description,
        CRUDTools.UPDATE_WORLD_ENVIRONMENT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.UPDATE_WORLD_ENVIRONMENT.name, withSession(CRUDTools.UPDATE_WORLD_ENVIRONMENT.inputSchema, handleUpdateWorldEnvironment))
    );

    server.tool(
        CRUDTools.DELETE_WORLD.name,
        CRUDTools.DELETE_WORLD.description,
        CRUDTools.DELETE_WORLD.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.DELETE_WORLD.name, withSession(CRUDTools.DELETE_WORLD.inputSchema, handleDeleteWorld))
    );

    server.tool(
        CRUDTools.CREATE_CHARACTER.name,
        CRUDTools.CREATE_CHARACTER.description,
        CRUDTools.CREATE_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.CREATE_CHARACTER.name, withSession(CRUDTools.CREATE_CHARACTER.inputSchema, handleCreateCharacter))
    );

    server.tool(
        CRUDTools.GET_CHARACTER.name,
        CRUDTools.GET_CHARACTER.description,
        CRUDTools.GET_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.GET_CHARACTER.name, withSession(CRUDTools.GET_CHARACTER.inputSchema, handleGetCharacter))
    );

    server.tool(
        CRUDTools.UPDATE_CHARACTER.name,
        CRUDTools.UPDATE_CHARACTER.description,
        CRUDTools.UPDATE_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.UPDATE_CHARACTER.name, withSession(CRUDTools.UPDATE_CHARACTER.inputSchema, handleUpdateCharacter))
    );

    server.tool(
        CRUDTools.LIST_CHARACTERS.name,
        CRUDTools.LIST_CHARACTERS.description,
        CRUDTools.LIST_CHARACTERS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.LIST_CHARACTERS.name, withSession(CRUDTools.LIST_CHARACTERS.inputSchema, handleListCharacters))
    );

    server.tool(
        CRUDTools.DELETE_CHARACTER.name,
        CRUDTools.DELETE_CHARACTER.description,
        CRUDTools.DELETE_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CRUDTools.DELETE_CHARACTER.name, withSession(CRUDTools.DELETE_CHARACTER.inputSchema, handleDeleteCharacter))
    );

    // Register Party Tools
    server.tool(
        PartyTools.CREATE_PARTY.name,
        PartyTools.CREATE_PARTY.description,
        PartyTools.CREATE_PARTY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.CREATE_PARTY.name, withSession(PartyTools.CREATE_PARTY.inputSchema, handleCreateParty))
    );

    server.tool(
        PartyTools.GET_PARTY.name,
        PartyTools.GET_PARTY.description,
        PartyTools.GET_PARTY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.GET_PARTY.name, withSession(PartyTools.GET_PARTY.inputSchema, handleGetParty))
    );

    server.tool(
        PartyTools.LIST_PARTIES.name,
        PartyTools.LIST_PARTIES.description,
        PartyTools.LIST_PARTIES.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.LIST_PARTIES.name, withSession(PartyTools.LIST_PARTIES.inputSchema, handleListParties))
    );

    server.tool(
        PartyTools.UPDATE_PARTY.name,
        PartyTools.UPDATE_PARTY.description,
        PartyTools.UPDATE_PARTY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.UPDATE_PARTY.name, withSession(PartyTools.UPDATE_PARTY.inputSchema, handleUpdateParty))
    );

    server.tool(
        PartyTools.DELETE_PARTY.name,
        PartyTools.DELETE_PARTY.description,
        PartyTools.DELETE_PARTY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.DELETE_PARTY.name, withSession(PartyTools.DELETE_PARTY.inputSchema, handleDeleteParty))
    );

    server.tool(
        PartyTools.ADD_PARTY_MEMBER.name,
        PartyTools.ADD_PARTY_MEMBER.description,
        PartyTools.ADD_PARTY_MEMBER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.ADD_PARTY_MEMBER.name, withSession(PartyTools.ADD_PARTY_MEMBER.inputSchema, handleAddPartyMember))
    );

    server.tool(
        PartyTools.REMOVE_PARTY_MEMBER.name,
        PartyTools.REMOVE_PARTY_MEMBER.description,
        PartyTools.REMOVE_PARTY_MEMBER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.REMOVE_PARTY_MEMBER.name, withSession(PartyTools.REMOVE_PARTY_MEMBER.inputSchema, handleRemovePartyMember))
    );

    server.tool(
        PartyTools.UPDATE_PARTY_MEMBER.name,
        PartyTools.UPDATE_PARTY_MEMBER.description,
        PartyTools.UPDATE_PARTY_MEMBER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.UPDATE_PARTY_MEMBER.name, withSession(PartyTools.UPDATE_PARTY_MEMBER.inputSchema, handleUpdatePartyMember))
    );

    server.tool(
        PartyTools.SET_PARTY_LEADER.name,
        PartyTools.SET_PARTY_LEADER.description,
        PartyTools.SET_PARTY_LEADER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.SET_PARTY_LEADER.name, withSession(PartyTools.SET_PARTY_LEADER.inputSchema, handleSetPartyLeader))
    );

    server.tool(
        PartyTools.SET_ACTIVE_CHARACTER.name,
        PartyTools.SET_ACTIVE_CHARACTER.description,
        PartyTools.SET_ACTIVE_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.SET_ACTIVE_CHARACTER.name, withSession(PartyTools.SET_ACTIVE_CHARACTER.inputSchema, handleSetActiveCharacter))
    );

    server.tool(
        PartyTools.GET_PARTY_MEMBERS.name,
        PartyTools.GET_PARTY_MEMBERS.description,
        PartyTools.GET_PARTY_MEMBERS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.GET_PARTY_MEMBERS.name, withSession(PartyTools.GET_PARTY_MEMBERS.inputSchema, handleGetPartyMembers))
    );

    server.tool(
        PartyTools.GET_PARTY_CONTEXT.name,
        PartyTools.GET_PARTY_CONTEXT.description,
        PartyTools.GET_PARTY_CONTEXT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.GET_PARTY_CONTEXT.name, withSession(PartyTools.GET_PARTY_CONTEXT.inputSchema, handleGetPartyContext))
    );

    server.tool(
        PartyTools.GET_UNASSIGNED_CHARACTERS.name,
        PartyTools.GET_UNASSIGNED_CHARACTERS.description,
        PartyTools.GET_UNASSIGNED_CHARACTERS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.GET_UNASSIGNED_CHARACTERS.name, withSession(PartyTools.GET_UNASSIGNED_CHARACTERS.inputSchema, handleGetUnassignedCharacters))
    );

    // Register Party Movement Tools (world map positioning)
    server.tool(
        PartyTools.MOVE_PARTY.name,
        PartyTools.MOVE_PARTY.description,
        PartyTools.MOVE_PARTY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.MOVE_PARTY.name, withSession(PartyTools.MOVE_PARTY.inputSchema, handleMoveParty))
    );

    server.tool(
        PartyTools.GET_PARTY_POSITION.name,
        PartyTools.GET_PARTY_POSITION.description,
        PartyTools.GET_PARTY_POSITION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.GET_PARTY_POSITION.name, withSession(PartyTools.GET_PARTY_POSITION.inputSchema, handleGetPartyPosition))
    );

    server.tool(
        PartyTools.GET_PARTIES_IN_REGION.name,
        PartyTools.GET_PARTIES_IN_REGION.description,
        PartyTools.GET_PARTIES_IN_REGION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(PartyTools.GET_PARTIES_IN_REGION.name, withSession(PartyTools.GET_PARTIES_IN_REGION.inputSchema, handleGetPartiesInRegion))
    );

    // Register Inventory Tools
    server.tool(
        InventoryTools.CREATE_ITEM_TEMPLATE.name,
        InventoryTools.CREATE_ITEM_TEMPLATE.description,
        InventoryTools.CREATE_ITEM_TEMPLATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.CREATE_ITEM_TEMPLATE.name, withSession(InventoryTools.CREATE_ITEM_TEMPLATE.inputSchema, handleCreateItemTemplate))
    );

    server.tool(
        InventoryTools.GIVE_ITEM.name,
        InventoryTools.GIVE_ITEM.description,
        InventoryTools.GIVE_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.GIVE_ITEM.name, withSession(InventoryTools.GIVE_ITEM.inputSchema, handleGiveItem))
    );

    server.tool(
        InventoryTools.REMOVE_ITEM.name,
        InventoryTools.REMOVE_ITEM.description,
        InventoryTools.REMOVE_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.REMOVE_ITEM.name, withSession(InventoryTools.REMOVE_ITEM.inputSchema, handleRemoveItem))
    );

    server.tool(
        InventoryTools.EQUIP_ITEM.name,
        InventoryTools.EQUIP_ITEM.description,
        InventoryTools.EQUIP_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.EQUIP_ITEM.name, withSession(InventoryTools.EQUIP_ITEM.inputSchema, handleEquipItem))
    );

    server.tool(
        InventoryTools.UNEQUIP_ITEM.name,
        InventoryTools.UNEQUIP_ITEM.description,
        InventoryTools.UNEQUIP_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.UNEQUIP_ITEM.name, withSession(InventoryTools.UNEQUIP_ITEM.inputSchema, handleUnequipItem))
    );

    server.tool(
        InventoryTools.GET_INVENTORY.name,
        InventoryTools.GET_INVENTORY.description,
        InventoryTools.GET_INVENTORY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.GET_INVENTORY.name, withSession(InventoryTools.GET_INVENTORY.inputSchema, handleGetInventory))
    );

    server.tool(
        InventoryTools.GET_ITEM.name,
        InventoryTools.GET_ITEM.description,
        InventoryTools.GET_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.GET_ITEM.name, withSession(InventoryTools.GET_ITEM.inputSchema, handleGetItem))
    );

    server.tool(
        InventoryTools.LIST_ITEMS.name,
        InventoryTools.LIST_ITEMS.description,
        InventoryTools.LIST_ITEMS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.LIST_ITEMS.name, withSession(InventoryTools.LIST_ITEMS.inputSchema, handleListItems))
    );

    server.tool(
        InventoryTools.SEARCH_ITEMS.name,
        InventoryTools.SEARCH_ITEMS.description,
        InventoryTools.SEARCH_ITEMS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.SEARCH_ITEMS.name, withSession(InventoryTools.SEARCH_ITEMS.inputSchema, handleSearchItems))
    );

    server.tool(
        InventoryTools.UPDATE_ITEM.name,
        InventoryTools.UPDATE_ITEM.description,
        InventoryTools.UPDATE_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.UPDATE_ITEM.name, withSession(InventoryTools.UPDATE_ITEM.inputSchema, handleUpdateItem))
    );

    server.tool(
        InventoryTools.DELETE_ITEM.name,
        InventoryTools.DELETE_ITEM.description,
        InventoryTools.DELETE_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.DELETE_ITEM.name, withSession(InventoryTools.DELETE_ITEM.inputSchema, handleDeleteItem))
    );

    server.tool(
        InventoryTools.TRANSFER_ITEM.name,
        InventoryTools.TRANSFER_ITEM.description,
        InventoryTools.TRANSFER_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.TRANSFER_ITEM.name, withSession(InventoryTools.TRANSFER_ITEM.inputSchema, handleTransferItem))
    );

    server.tool(
        InventoryTools.USE_ITEM.name,
        InventoryTools.USE_ITEM.description,
        InventoryTools.USE_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.USE_ITEM.name, withSession(InventoryTools.USE_ITEM.inputSchema, handleUseItem))
    );

    server.tool(
        InventoryTools.GET_INVENTORY_DETAILED.name,
        InventoryTools.GET_INVENTORY_DETAILED.description,
        InventoryTools.GET_INVENTORY_DETAILED.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(InventoryTools.GET_INVENTORY_DETAILED.name, withSession(InventoryTools.GET_INVENTORY_DETAILED.inputSchema, handleGetInventoryDetailed))
    );

    // Register Quest Tools
    server.tool(
        QuestTools.CREATE_QUEST.name,
        QuestTools.CREATE_QUEST.description,
        QuestTools.CREATE_QUEST.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.CREATE_QUEST.name, withSession(QuestTools.CREATE_QUEST.inputSchema, handleCreateQuest))
    );

    server.tool(
        QuestTools.GET_QUEST.name,
        QuestTools.GET_QUEST.description,
        QuestTools.GET_QUEST.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.GET_QUEST.name, withSession(QuestTools.GET_QUEST.inputSchema, handleGetQuest))
    );

    server.tool(
        QuestTools.LIST_QUESTS.name,
        QuestTools.LIST_QUESTS.description,
        QuestTools.LIST_QUESTS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.LIST_QUESTS.name, withSession(QuestTools.LIST_QUESTS.inputSchema, handleListQuests))
    );

    server.tool(
        QuestTools.ASSIGN_QUEST.name,
        QuestTools.ASSIGN_QUEST.description,
        QuestTools.ASSIGN_QUEST.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.ASSIGN_QUEST.name, withSession(QuestTools.ASSIGN_QUEST.inputSchema, handleAssignQuest))
    );

    server.tool(
        QuestTools.UPDATE_OBJECTIVE.name,
        QuestTools.UPDATE_OBJECTIVE.description,
        QuestTools.UPDATE_OBJECTIVE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.UPDATE_OBJECTIVE.name, withSession(QuestTools.UPDATE_OBJECTIVE.inputSchema, handleUpdateObjective))
    );

    server.tool(
        QuestTools.COMPLETE_OBJECTIVE.name,
        QuestTools.COMPLETE_OBJECTIVE.description,
        QuestTools.COMPLETE_OBJECTIVE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.COMPLETE_OBJECTIVE.name, withSession(QuestTools.COMPLETE_OBJECTIVE.inputSchema, handleCompleteObjective))
    );

    server.tool(
        QuestTools.COMPLETE_QUEST.name,
        QuestTools.COMPLETE_QUEST.description,
        QuestTools.COMPLETE_QUEST.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.COMPLETE_QUEST.name, withSession(QuestTools.COMPLETE_QUEST.inputSchema, handleCompleteQuest))
    );

    server.tool(
        QuestTools.GET_QUEST_LOG.name,
        QuestTools.GET_QUEST_LOG.description,
        QuestTools.GET_QUEST_LOG.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(QuestTools.GET_QUEST_LOG.name, withSession(QuestTools.GET_QUEST_LOG.inputSchema, handleGetQuestLog))
    );

    // Register Math Tools
    server.tool(
        MathTools.DICE_ROLL.name,
        MathTools.DICE_ROLL.description,
        MathTools.DICE_ROLL.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.DICE_ROLL.name, withSession(MathTools.DICE_ROLL.inputSchema, handleDiceRoll))
    );

    server.tool(
        MathTools.PROBABILITY_CALCULATE.name,
        MathTools.PROBABILITY_CALCULATE.description,
        MathTools.PROBABILITY_CALCULATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.PROBABILITY_CALCULATE.name, withSession(MathTools.PROBABILITY_CALCULATE.inputSchema, handleProbabilityCalculate))
    );

    server.tool(
        MathTools.ALGEBRA_SOLVE.name,
        MathTools.ALGEBRA_SOLVE.description,
        MathTools.ALGEBRA_SOLVE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.ALGEBRA_SOLVE.name, withSession(MathTools.ALGEBRA_SOLVE.inputSchema, handleAlgebraSolve))
    );

    server.tool(
        MathTools.ALGEBRA_SIMPLIFY.name,
        MathTools.ALGEBRA_SIMPLIFY.description,
        MathTools.ALGEBRA_SIMPLIFY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.ALGEBRA_SIMPLIFY.name, withSession(MathTools.ALGEBRA_SIMPLIFY.inputSchema, handleAlgebraSimplify))
    );

    server.tool(
        MathTools.PHYSICS_PROJECTILE.name,
        MathTools.PHYSICS_PROJECTILE.description,
        MathTools.PHYSICS_PROJECTILE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(MathTools.PHYSICS_PROJECTILE.name, withSession(MathTools.PHYSICS_PROJECTILE.inputSchema, handlePhysicsProjectile))
    );

    // Register Strategy Tools
    server.tool(
        StrategyTools.CREATE_NATION.name,
        StrategyTools.CREATE_NATION.description,
        StrategyTools.CREATE_NATION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(StrategyTools.CREATE_NATION.name, withSession(StrategyTools.CREATE_NATION.inputSchema, handleStrategyTool.bind(null, StrategyTools.CREATE_NATION.name)))
    );

    server.tool(
        StrategyTools.GET_STRATEGY_STATE.name,
        StrategyTools.GET_STRATEGY_STATE.description,
        StrategyTools.GET_STRATEGY_STATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(StrategyTools.GET_STRATEGY_STATE.name, withSession(StrategyTools.GET_STRATEGY_STATE.inputSchema, handleStrategyTool.bind(null, StrategyTools.GET_STRATEGY_STATE.name)))
    );

    server.tool(
        StrategyTools.GET_NATION_STATE.name,
        StrategyTools.GET_NATION_STATE.description,
        StrategyTools.GET_NATION_STATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(StrategyTools.GET_NATION_STATE.name, withSession(StrategyTools.GET_NATION_STATE.inputSchema, handleStrategyTool.bind(null, StrategyTools.GET_NATION_STATE.name)))
    );

    server.tool(
        StrategyTools.PROPOSE_ALLIANCE.name,
        StrategyTools.PROPOSE_ALLIANCE.description,
        StrategyTools.PROPOSE_ALLIANCE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(StrategyTools.PROPOSE_ALLIANCE.name, withSession(StrategyTools.PROPOSE_ALLIANCE.inputSchema, handleStrategyTool.bind(null, StrategyTools.PROPOSE_ALLIANCE.name)))
    );

    server.tool(
        StrategyTools.CLAIM_REGION.name,
        StrategyTools.CLAIM_REGION.description,
        StrategyTools.CLAIM_REGION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(StrategyTools.CLAIM_REGION.name, withSession(StrategyTools.CLAIM_REGION.inputSchema, handleStrategyTool.bind(null, StrategyTools.CLAIM_REGION.name)))
    );

    server.tool(
        StrategyTools.RESOLVE_TURN.name,
        StrategyTools.RESOLVE_TURN.description,
        StrategyTools.RESOLVE_TURN.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(StrategyTools.RESOLVE_TURN.name, withSession(StrategyTools.RESOLVE_TURN.inputSchema, handleStrategyTool.bind(null, StrategyTools.RESOLVE_TURN.name)))
    );

    // Turn Management Tools
    server.tool(
        TurnManagementTools.INIT_TURN_STATE.name,
        TurnManagementTools.INIT_TURN_STATE.description,
        TurnManagementTools.INIT_TURN_STATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TurnManagementTools.INIT_TURN_STATE.name, withSession(TurnManagementTools.INIT_TURN_STATE.inputSchema, handleTurnManagementTool.bind(null, TurnManagementTools.INIT_TURN_STATE.name)))
    );

    server.tool(
        TurnManagementTools.GET_TURN_STATUS.name,
        TurnManagementTools.GET_TURN_STATUS.description,
        TurnManagementTools.GET_TURN_STATUS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TurnManagementTools.GET_TURN_STATUS.name, withSession(TurnManagementTools.GET_TURN_STATUS.inputSchema, handleTurnManagementTool.bind(null, TurnManagementTools.GET_TURN_STATUS.name)))
    );

    server.tool(
        TurnManagementTools.SUBMIT_TURN_ACTIONS.name,
        TurnManagementTools.SUBMIT_TURN_ACTIONS.description,
        TurnManagementTools.SUBMIT_TURN_ACTIONS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TurnManagementTools.SUBMIT_TURN_ACTIONS.name, withSession(TurnManagementTools.SUBMIT_TURN_ACTIONS.inputSchema, handleTurnManagementTool.bind(null, TurnManagementTools.SUBMIT_TURN_ACTIONS.name)))
    );

    server.tool(
        TurnManagementTools.MARK_READY.name,
        TurnManagementTools.MARK_READY.description,
        TurnManagementTools.MARK_READY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TurnManagementTools.MARK_READY.name, withSession(TurnManagementTools.MARK_READY.inputSchema, handleTurnManagementTool.bind(null, TurnManagementTools.MARK_READY.name)))
    );

    server.tool(
        TurnManagementTools.POLL_TURN_RESULTS.name,
        TurnManagementTools.POLL_TURN_RESULTS.description,
        TurnManagementTools.POLL_TURN_RESULTS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TurnManagementTools.POLL_TURN_RESULTS.name, withSession(TurnManagementTools.POLL_TURN_RESULTS.inputSchema, handleTurnManagementTool.bind(null, TurnManagementTools.POLL_TURN_RESULTS.name)))
    );

    // Register Secret Tools (DM Secret Keeper System)
    server.tool(
        SecretTools.CREATE_SECRET.name,
        SecretTools.CREATE_SECRET.description,
        SecretTools.CREATE_SECRET.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SecretTools.CREATE_SECRET.name, withSession(SecretTools.CREATE_SECRET.inputSchema, handleCreateSecret))
    );

    server.tool(
        SecretTools.GET_SECRET.name,
        SecretTools.GET_SECRET.description,
        SecretTools.GET_SECRET.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SecretTools.GET_SECRET.name, withSession(SecretTools.GET_SECRET.inputSchema, handleGetSecret))
    );

    server.tool(
        SecretTools.LIST_SECRETS.name,
        SecretTools.LIST_SECRETS.description,
        SecretTools.LIST_SECRETS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SecretTools.LIST_SECRETS.name, withSession(SecretTools.LIST_SECRETS.inputSchema, handleListSecrets))
    );

    server.tool(
        SecretTools.UPDATE_SECRET.name,
        SecretTools.UPDATE_SECRET.description,
        SecretTools.UPDATE_SECRET.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SecretTools.UPDATE_SECRET.name, withSession(SecretTools.UPDATE_SECRET.inputSchema, handleUpdateSecret))
    );

    server.tool(
        SecretTools.DELETE_SECRET.name,
        SecretTools.DELETE_SECRET.description,
        SecretTools.DELETE_SECRET.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SecretTools.DELETE_SECRET.name, withSession(SecretTools.DELETE_SECRET.inputSchema, handleDeleteSecret))
    );

    server.tool(
        SecretTools.REVEAL_SECRET.name,
        SecretTools.REVEAL_SECRET.description,
        SecretTools.REVEAL_SECRET.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SecretTools.REVEAL_SECRET.name, withSession(SecretTools.REVEAL_SECRET.inputSchema, handleRevealSecret))
    );

    server.tool(
        SecretTools.CHECK_REVEAL_CONDITIONS.name,
        SecretTools.CHECK_REVEAL_CONDITIONS.description,
        SecretTools.CHECK_REVEAL_CONDITIONS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SecretTools.CHECK_REVEAL_CONDITIONS.name, withSession(SecretTools.CHECK_REVEAL_CONDITIONS.inputSchema, handleCheckRevealConditions))
    );

    server.tool(
        SecretTools.GET_SECRETS_FOR_CONTEXT.name,
        SecretTools.GET_SECRETS_FOR_CONTEXT.description,
        SecretTools.GET_SECRETS_FOR_CONTEXT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SecretTools.GET_SECRETS_FOR_CONTEXT.name, withSession(SecretTools.GET_SECRETS_FOR_CONTEXT.inputSchema, handleGetSecretsForContext))
    );

    server.tool(
        SecretTools.CHECK_FOR_LEAKS.name,
        SecretTools.CHECK_FOR_LEAKS.description,
        SecretTools.CHECK_FOR_LEAKS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SecretTools.CHECK_FOR_LEAKS.name, withSession(SecretTools.CHECK_FOR_LEAKS.inputSchema, handleCheckForLeaks))
    );

    // Register Rest Tools (CRIT-002 Fix: HP recovery via resting)
    server.tool(
        RestTools.TAKE_LONG_REST.name,
        RestTools.TAKE_LONG_REST.description,
        RestTools.TAKE_LONG_REST.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(RestTools.TAKE_LONG_REST.name, withSession(RestTools.TAKE_LONG_REST.inputSchema, handleTakeLongRest))
    );

    server.tool(
        RestTools.TAKE_SHORT_REST.name,
        RestTools.TAKE_SHORT_REST.description,
        RestTools.TAKE_SHORT_REST.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(RestTools.TAKE_SHORT_REST.name, withSession(RestTools.TAKE_SHORT_REST.inputSchema, handleTakeShortRest))
    );

    // Register Concentration Tools (Concentration Management System)
    server.tool(
        ConcentrationTools.CHECK_CONCENTRATION_SAVE.name,
        ConcentrationTools.CHECK_CONCENTRATION_SAVE.description,
        ConcentrationTools.CHECK_CONCENTRATION_SAVE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ConcentrationTools.CHECK_CONCENTRATION_SAVE.name, withSession(ConcentrationTools.CHECK_CONCENTRATION_SAVE.inputSchema, handleCheckConcentrationSave))
    );

    server.tool(
        ConcentrationTools.BREAK_CONCENTRATION.name,
        ConcentrationTools.BREAK_CONCENTRATION.description,
        ConcentrationTools.BREAK_CONCENTRATION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ConcentrationTools.BREAK_CONCENTRATION.name, withSession(ConcentrationTools.BREAK_CONCENTRATION.inputSchema, handleBreakConcentration))
    );

    server.tool(
        ConcentrationTools.GET_CONCENTRATION_STATE.name,
        ConcentrationTools.GET_CONCENTRATION_STATE.description,
        ConcentrationTools.GET_CONCENTRATION_STATE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ConcentrationTools.GET_CONCENTRATION_STATE.name, withSession(ConcentrationTools.GET_CONCENTRATION_STATE.inputSchema, handleGetConcentrationState))
    );

    server.tool(
        ConcentrationTools.CHECK_CONCENTRATION_DURATION.name,
        ConcentrationTools.CHECK_CONCENTRATION_DURATION.description,
        ConcentrationTools.CHECK_CONCENTRATION_DURATION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ConcentrationTools.CHECK_CONCENTRATION_DURATION.name, withSession(ConcentrationTools.CHECK_CONCENTRATION_DURATION.inputSchema, handleCheckConcentrationDuration))
    );

    server.tool(
        ConcentrationTools.CHECK_AUTO_BREAK.name,
        ConcentrationTools.CHECK_AUTO_BREAK.description,
        ConcentrationTools.CHECK_AUTO_BREAK.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ConcentrationTools.CHECK_AUTO_BREAK.name, withSession(ConcentrationTools.CHECK_AUTO_BREAK.inputSchema, handleCheckAutoBreak))
    );

    // Register Scroll Tools (Spell Scroll System)
    server.tool(
        ScrollTools.USE_SPELL_SCROLL.name,
        ScrollTools.USE_SPELL_SCROLL.description,
        ScrollTools.USE_SPELL_SCROLL.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ScrollTools.USE_SPELL_SCROLL.name, withSession(ScrollTools.USE_SPELL_SCROLL.inputSchema, handleUseSpellScroll))
    );

    server.tool(
        ScrollTools.CREATE_SPELL_SCROLL.name,
        ScrollTools.CREATE_SPELL_SCROLL.description,
        ScrollTools.CREATE_SPELL_SCROLL.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ScrollTools.CREATE_SPELL_SCROLL.name, withSession(ScrollTools.CREATE_SPELL_SCROLL.inputSchema, handleCreateSpellScroll))
    );

    server.tool(
        ScrollTools.IDENTIFY_SCROLL.name,
        ScrollTools.IDENTIFY_SCROLL.description,
        ScrollTools.IDENTIFY_SCROLL.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ScrollTools.IDENTIFY_SCROLL.name, withSession(ScrollTools.IDENTIFY_SCROLL.inputSchema, handleIdentifyScroll))
    );

    server.tool(
        ScrollTools.GET_SCROLL_USE_DC.name,
        ScrollTools.GET_SCROLL_USE_DC.description,
        ScrollTools.GET_SCROLL_USE_DC.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ScrollTools.GET_SCROLL_USE_DC.name, withSession(ScrollTools.GET_SCROLL_USE_DC.inputSchema, handleGetScrollUseDC))
    );

    server.tool(
        ScrollTools.GET_SCROLL_DETAILS.name,
        ScrollTools.GET_SCROLL_DETAILS.description,
        ScrollTools.GET_SCROLL_DETAILS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ScrollTools.GET_SCROLL_DETAILS.name, withSession(ScrollTools.GET_SCROLL_DETAILS.inputSchema, handleGetScrollDetails))
    );

    server.tool(
        ScrollTools.CHECK_SCROLL_USABILITY.name,
        ScrollTools.CHECK_SCROLL_USABILITY.description,
        ScrollTools.CHECK_SCROLL_USABILITY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ScrollTools.CHECK_SCROLL_USABILITY.name, withSession(ScrollTools.CHECK_SCROLL_USABILITY.inputSchema, handleCheckScrollUsability))
    );

    // Register Aura Tools (Area Effect Aura System)
    server.tool(
        AuraTools.CREATE_AURA.name,
        AuraTools.CREATE_AURA.description,
        AuraTools.CREATE_AURA.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(AuraTools.CREATE_AURA.name, withSession(AuraTools.CREATE_AURA.inputSchema, handleCreateAura))
    );

    server.tool(
        AuraTools.GET_ACTIVE_AURAS.name,
        AuraTools.GET_ACTIVE_AURAS.description,
        AuraTools.GET_ACTIVE_AURAS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(AuraTools.GET_ACTIVE_AURAS.name, withSession(AuraTools.GET_ACTIVE_AURAS.inputSchema, handleGetActiveAuras))
    );

    server.tool(
        AuraTools.GET_AURAS_AFFECTING_CHARACTER.name,
        AuraTools.GET_AURAS_AFFECTING_CHARACTER.description,
        AuraTools.GET_AURAS_AFFECTING_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(AuraTools.GET_AURAS_AFFECTING_CHARACTER.name, withSession(AuraTools.GET_AURAS_AFFECTING_CHARACTER.inputSchema, handleGetAurasAffectingCharacter))
    );

    server.tool(
        AuraTools.PROCESS_AURA_EFFECTS.name,
        AuraTools.PROCESS_AURA_EFFECTS.description,
        AuraTools.PROCESS_AURA_EFFECTS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(AuraTools.PROCESS_AURA_EFFECTS.name, withSession(AuraTools.PROCESS_AURA_EFFECTS.inputSchema, handleProcessAuraEffects))
    );

    server.tool(
        AuraTools.REMOVE_AURA.name,
        AuraTools.REMOVE_AURA.description,
        AuraTools.REMOVE_AURA.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(AuraTools.REMOVE_AURA.name, withSession(AuraTools.REMOVE_AURA.inputSchema, handleRemoveAura))
    );

    server.tool(
        AuraTools.REMOVE_CHARACTER_AURAS.name,
        AuraTools.REMOVE_CHARACTER_AURAS.description,
        AuraTools.REMOVE_CHARACTER_AURAS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(AuraTools.REMOVE_CHARACTER_AURAS.name, withSession(AuraTools.REMOVE_CHARACTER_AURAS.inputSchema, handleRemoveCharacterAuras))
    );

    server.tool(
        AuraTools.EXPIRE_AURAS.name,
        AuraTools.EXPIRE_AURAS.description,
        AuraTools.EXPIRE_AURAS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(AuraTools.EXPIRE_AURAS.name, withSession(AuraTools.EXPIRE_AURAS.inputSchema, handleExpireAuras))
    );

    // Register NPC Memory Tools (HIGH-004: NPC Relationship & Memory System)
    server.tool(
        NpcMemoryTools.GET_NPC_RELATIONSHIP.name,
        NpcMemoryTools.GET_NPC_RELATIONSHIP.description,
        NpcMemoryTools.GET_NPC_RELATIONSHIP.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(NpcMemoryTools.GET_NPC_RELATIONSHIP.name, withSession(NpcMemoryTools.GET_NPC_RELATIONSHIP.inputSchema, handleGetNpcRelationship))
    );

    server.tool(
        NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.name,
        NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.description,
        NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.name, withSession(NpcMemoryTools.UPDATE_NPC_RELATIONSHIP.inputSchema, handleUpdateNpcRelationship))
    );

    server.tool(
        NpcMemoryTools.RECORD_CONVERSATION_MEMORY.name,
        NpcMemoryTools.RECORD_CONVERSATION_MEMORY.description,
        NpcMemoryTools.RECORD_CONVERSATION_MEMORY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(NpcMemoryTools.RECORD_CONVERSATION_MEMORY.name, withSession(NpcMemoryTools.RECORD_CONVERSATION_MEMORY.inputSchema, handleRecordConversationMemory))
    );

    server.tool(
        NpcMemoryTools.GET_CONVERSATION_HISTORY.name,
        NpcMemoryTools.GET_CONVERSATION_HISTORY.description,
        NpcMemoryTools.GET_CONVERSATION_HISTORY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(NpcMemoryTools.GET_CONVERSATION_HISTORY.name, withSession(NpcMemoryTools.GET_CONVERSATION_HISTORY.inputSchema, handleGetConversationHistory))
    );

    server.tool(
        NpcMemoryTools.GET_RECENT_INTERACTIONS.name,
        NpcMemoryTools.GET_RECENT_INTERACTIONS.description,
        NpcMemoryTools.GET_RECENT_INTERACTIONS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(NpcMemoryTools.GET_RECENT_INTERACTIONS.name, withSession(NpcMemoryTools.GET_RECENT_INTERACTIONS.inputSchema, handleGetRecentInteractions))
    );

    server.tool(
        NpcMemoryTools.GET_NPC_CONTEXT.name,
        NpcMemoryTools.GET_NPC_CONTEXT.description,
        NpcMemoryTools.GET_NPC_CONTEXT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(NpcMemoryTools.GET_NPC_CONTEXT.name, withSession(NpcMemoryTools.GET_NPC_CONTEXT.inputSchema, handleGetNpcContext))
    );

    server.tool(
        NpcMemoryTools.INTERACT_SOCIALLY.name,
        NpcMemoryTools.INTERACT_SOCIALLY.description,
        NpcMemoryTools.INTERACT_SOCIALLY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(NpcMemoryTools.INTERACT_SOCIALLY.name, withSession(NpcMemoryTools.INTERACT_SOCIALLY.inputSchema, handleInteractSocially))
    );

    // Register Spatial Tools (PHASE-1: Spatial Graph System)
    server.tool(
        SpatialTools.LOOK_AT_SURROUNDINGS.name,
        SpatialTools.LOOK_AT_SURROUNDINGS.description,
        SpatialTools.LOOK_AT_SURROUNDINGS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SpatialTools.LOOK_AT_SURROUNDINGS.name, withSession(SpatialTools.LOOK_AT_SURROUNDINGS.inputSchema, handleLookAtSurroundings))
    );

    server.tool(
        SpatialTools.GENERATE_ROOM_NODE.name,
        SpatialTools.GENERATE_ROOM_NODE.description,
        SpatialTools.GENERATE_ROOM_NODE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SpatialTools.GENERATE_ROOM_NODE.name, withSession(SpatialTools.GENERATE_ROOM_NODE.inputSchema, handleGenerateRoomNode))
    );

    server.tool(
        SpatialTools.GET_ROOM_EXITS.name,
        SpatialTools.GET_ROOM_EXITS.description,
        SpatialTools.GET_ROOM_EXITS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SpatialTools.GET_ROOM_EXITS.name, withSession(SpatialTools.GET_ROOM_EXITS.inputSchema, handleGetRoomExits))
    );

    server.tool(
        SpatialTools.MOVE_CHARACTER_TO_ROOM.name,
        SpatialTools.MOVE_CHARACTER_TO_ROOM.description,
        SpatialTools.MOVE_CHARACTER_TO_ROOM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(SpatialTools.MOVE_CHARACTER_TO_ROOM.name, withSession(SpatialTools.MOVE_CHARACTER_TO_ROOM.inputSchema, handleMoveCharacterToRoom))
    );

    // Register Theft Tools (HIGH-008: Stolen Item Tracking System)
    server.tool(
        TheftTools.STEAL_ITEM.name,
        TheftTools.STEAL_ITEM.description,
        TheftTools.STEAL_ITEM.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.STEAL_ITEM.name, withSession(TheftTools.STEAL_ITEM.inputSchema, handleStealItem))
    );

    server.tool(
        TheftTools.CHECK_ITEM_STOLEN.name,
        TheftTools.CHECK_ITEM_STOLEN.description,
        TheftTools.CHECK_ITEM_STOLEN.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.CHECK_ITEM_STOLEN.name, withSession(TheftTools.CHECK_ITEM_STOLEN.inputSchema, handleCheckItemStolen))
    );

    server.tool(
        TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.name,
        TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.description,
        TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.name, withSession(TheftTools.CHECK_STOLEN_ITEMS_ON_CHARACTER.inputSchema, handleCheckStolenItemsOnCharacter))
    );

    server.tool(
        TheftTools.CHECK_ITEM_RECOGNITION.name,
        TheftTools.CHECK_ITEM_RECOGNITION.description,
        TheftTools.CHECK_ITEM_RECOGNITION.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.CHECK_ITEM_RECOGNITION.name, withSession(TheftTools.CHECK_ITEM_RECOGNITION.inputSchema, handleCheckItemRecognition))
    );

    server.tool(
        TheftTools.SELL_TO_FENCE.name,
        TheftTools.SELL_TO_FENCE.description,
        TheftTools.SELL_TO_FENCE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.SELL_TO_FENCE.name, withSession(TheftTools.SELL_TO_FENCE.inputSchema, handleSellToFence))
    );

    server.tool(
        TheftTools.REGISTER_FENCE.name,
        TheftTools.REGISTER_FENCE.description,
        TheftTools.REGISTER_FENCE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.REGISTER_FENCE.name, withSession(TheftTools.REGISTER_FENCE.inputSchema, handleRegisterFence))
    );

    server.tool(
        TheftTools.REPORT_THEFT.name,
        TheftTools.REPORT_THEFT.description,
        TheftTools.REPORT_THEFT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.REPORT_THEFT.name, withSession(TheftTools.REPORT_THEFT.inputSchema, handleReportTheft))
    );

    server.tool(
        TheftTools.ADVANCE_HEAT_DECAY.name,
        TheftTools.ADVANCE_HEAT_DECAY.description,
        TheftTools.ADVANCE_HEAT_DECAY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.ADVANCE_HEAT_DECAY.name, withSession(TheftTools.ADVANCE_HEAT_DECAY.inputSchema, handleAdvanceHeatDecay))
    );

    server.tool(
        TheftTools.GET_FENCE.name,
        TheftTools.GET_FENCE.description,
        TheftTools.GET_FENCE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.GET_FENCE.name, withSession(TheftTools.GET_FENCE.inputSchema, handleGetFence))
    );

    server.tool(
        TheftTools.LIST_FENCES.name,
        TheftTools.LIST_FENCES.description,
        TheftTools.LIST_FENCES.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(TheftTools.LIST_FENCES.name, withSession(TheftTools.LIST_FENCES.inputSchema, handleListFences))
    );

    // Register Corpse/Loot Tools (FAILED-004: Loot & Corpse System)
    server.tool(
        CorpseTools.GET_CORPSE.name,
        CorpseTools.GET_CORPSE.description,
        CorpseTools.GET_CORPSE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.GET_CORPSE.name, withSession(CorpseTools.GET_CORPSE.inputSchema, handleGetCorpse))
    );

    server.tool(
        CorpseTools.GET_CORPSE_BY_CHARACTER.name,
        CorpseTools.GET_CORPSE_BY_CHARACTER.description,
        CorpseTools.GET_CORPSE_BY_CHARACTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.GET_CORPSE_BY_CHARACTER.name, withSession(CorpseTools.GET_CORPSE_BY_CHARACTER.inputSchema, handleGetCorpseByCharacter))
    );

    server.tool(
        CorpseTools.LIST_CORPSES_IN_ENCOUNTER.name,
        CorpseTools.LIST_CORPSES_IN_ENCOUNTER.description,
        CorpseTools.LIST_CORPSES_IN_ENCOUNTER.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.LIST_CORPSES_IN_ENCOUNTER.name, withSession(CorpseTools.LIST_CORPSES_IN_ENCOUNTER.inputSchema, handleListCorpsesInEncounter))
    );

    server.tool(
        CorpseTools.LIST_CORPSES_NEARBY.name,
        CorpseTools.LIST_CORPSES_NEARBY.description,
        CorpseTools.LIST_CORPSES_NEARBY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.LIST_CORPSES_NEARBY.name, withSession(CorpseTools.LIST_CORPSES_NEARBY.inputSchema, handleListCorpsesNearby))
    );

    server.tool(
        CorpseTools.LOOT_CORPSE.name,
        CorpseTools.LOOT_CORPSE.description,
        CorpseTools.LOOT_CORPSE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.LOOT_CORPSE.name, withSession(CorpseTools.LOOT_CORPSE.inputSchema, handleLootCorpse))
    );

    server.tool(
        CorpseTools.HARVEST_CORPSE.name,
        CorpseTools.HARVEST_CORPSE.description,
        CorpseTools.HARVEST_CORPSE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.HARVEST_CORPSE.name, withSession(CorpseTools.HARVEST_CORPSE.inputSchema, handleHarvestCorpse))
    );

    server.tool(
        CorpseTools.CREATE_CORPSE.name,
        CorpseTools.CREATE_CORPSE.description,
        CorpseTools.CREATE_CORPSE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.CREATE_CORPSE.name, withSession(CorpseTools.CREATE_CORPSE.inputSchema, handleCreateCorpse))
    );

    server.tool(
        CorpseTools.GENERATE_LOOT.name,
        CorpseTools.GENERATE_LOOT.description,
        CorpseTools.GENERATE_LOOT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.GENERATE_LOOT.name, withSession(CorpseTools.GENERATE_LOOT.inputSchema, handleGenerateLoot))
    );

    server.tool(
        CorpseTools.GET_CORPSE_INVENTORY.name,
        CorpseTools.GET_CORPSE_INVENTORY.description,
        CorpseTools.GET_CORPSE_INVENTORY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.GET_CORPSE_INVENTORY.name, withSession(CorpseTools.GET_CORPSE_INVENTORY.inputSchema, handleGetCorpseInventory))
    );

    server.tool(
        CorpseTools.CREATE_LOOT_TABLE.name,
        CorpseTools.CREATE_LOOT_TABLE.description,
        CorpseTools.CREATE_LOOT_TABLE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.CREATE_LOOT_TABLE.name, withSession(CorpseTools.CREATE_LOOT_TABLE.inputSchema, handleCreateLootTable))
    );

    server.tool(
        CorpseTools.GET_LOOT_TABLE.name,
        CorpseTools.GET_LOOT_TABLE.description,
        CorpseTools.GET_LOOT_TABLE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.GET_LOOT_TABLE.name, withSession(CorpseTools.GET_LOOT_TABLE.inputSchema, handleGetLootTable))
    );

    server.tool(
        CorpseTools.LIST_LOOT_TABLES.name,
        CorpseTools.LIST_LOOT_TABLES.description,
        CorpseTools.LIST_LOOT_TABLES.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.LIST_LOOT_TABLES.name, withSession(CorpseTools.LIST_LOOT_TABLES.inputSchema, handleListLootTables))
    );

    server.tool(
        CorpseTools.ADVANCE_CORPSE_DECAY.name,
        CorpseTools.ADVANCE_CORPSE_DECAY.description,
        CorpseTools.ADVANCE_CORPSE_DECAY.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.ADVANCE_CORPSE_DECAY.name, withSession(CorpseTools.ADVANCE_CORPSE_DECAY.inputSchema, handleAdvanceCorpseDecay))
    );

    server.tool(
        CorpseTools.CLEANUP_CORPSES.name,
        CorpseTools.CLEANUP_CORPSES.description,
        CorpseTools.CLEANUP_CORPSES.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(CorpseTools.CLEANUP_CORPSES.name, withSession(CorpseTools.CLEANUP_CORPSES.inputSchema, handleCleanupCorpses))
    );

    // Register Improvisation Tools (Rule of Cool, Custom Effects, Arcane Synthesis)
    server.tool(
        ImprovisationTools.RESOLVE_IMPROVISED_STUNT.name,
        ImprovisationTools.RESOLVE_IMPROVISED_STUNT.description,
        ImprovisationTools.RESOLVE_IMPROVISED_STUNT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ImprovisationTools.RESOLVE_IMPROVISED_STUNT.name, withSession(ImprovisationTools.RESOLVE_IMPROVISED_STUNT.inputSchema, handleResolveImprovisedStunt))
    );

    server.tool(
        ImprovisationTools.APPLY_CUSTOM_EFFECT.name,
        ImprovisationTools.APPLY_CUSTOM_EFFECT.description,
        ImprovisationTools.APPLY_CUSTOM_EFFECT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ImprovisationTools.APPLY_CUSTOM_EFFECT.name, withSession(ImprovisationTools.APPLY_CUSTOM_EFFECT.inputSchema, handleApplyCustomEffect))
    );

    server.tool(
        ImprovisationTools.GET_CUSTOM_EFFECTS.name,
        ImprovisationTools.GET_CUSTOM_EFFECTS.description,
        ImprovisationTools.GET_CUSTOM_EFFECTS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ImprovisationTools.GET_CUSTOM_EFFECTS.name, withSession(ImprovisationTools.GET_CUSTOM_EFFECTS.inputSchema, handleGetCustomEffects))
    );

    server.tool(
        ImprovisationTools.REMOVE_CUSTOM_EFFECT.name,
        ImprovisationTools.REMOVE_CUSTOM_EFFECT.description,
        ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ImprovisationTools.REMOVE_CUSTOM_EFFECT.name, withSession(ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema, handleRemoveCustomEffect))
    );

    server.tool(
        ImprovisationTools.PROCESS_EFFECT_TRIGGERS.name,
        ImprovisationTools.PROCESS_EFFECT_TRIGGERS.description,
        ImprovisationTools.PROCESS_EFFECT_TRIGGERS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ImprovisationTools.PROCESS_EFFECT_TRIGGERS.name, withSession(ImprovisationTools.PROCESS_EFFECT_TRIGGERS.inputSchema, handleProcessEffectTriggers))
    );

    server.tool(
        ImprovisationTools.ADVANCE_EFFECT_DURATIONS.name,
        ImprovisationTools.ADVANCE_EFFECT_DURATIONS.description,
        ImprovisationTools.ADVANCE_EFFECT_DURATIONS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ImprovisationTools.ADVANCE_EFFECT_DURATIONS.name, withSession(ImprovisationTools.ADVANCE_EFFECT_DURATIONS.inputSchema, handleAdvanceEffectDurations))
    );

    server.tool(
        ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.name,
        ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.description,
        ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.name, withSession(ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.inputSchema, handleAttemptArcaneSynthesis))
    );

    server.tool(
        ImprovisationTools.GET_SYNTHESIZED_SPELLS.name,
        ImprovisationTools.GET_SYNTHESIZED_SPELLS.description,
        ImprovisationTools.GET_SYNTHESIZED_SPELLS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        auditLogger.wrapHandler(ImprovisationTools.GET_SYNTHESIZED_SPELLS.name, withSession(ImprovisationTools.GET_SYNTHESIZED_SPELLS.inputSchema, handleGetSynthesizedSpells))
    );

    // Connect transport
    const args = process.argv.slice(2);
    const transportType = args.includes('--tcp') ? 'tcp'
        : (args.includes('--unix') || args.includes('--socket')) ? 'unix'
            : (args.includes('--ws') || args.includes('--websocket')) ? 'websocket'
                : 'stdio';

    if (transportType === 'tcp') {
        const { TCPServerTransport } = await import('./transport/tcp.js');
        const portIndex = args.indexOf('--port');
        const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3000;

        const transport = new TCPServerTransport(port);
        await server.connect(transport);
        console.error(`RPG MCP Server running on TCP port ${port}`);
    } else if (transportType === 'unix') {
        const { UnixServerTransport } = await import('./transport/unix.js');
        let socketPath = '';
        const unixIndex = args.indexOf('--unix');
        const socketIndex = args.indexOf('--socket');

        if (unixIndex !== -1 && args[unixIndex + 1]) {
            socketPath = args[unixIndex + 1];
        } else if (socketIndex !== -1 && args[socketIndex + 1]) {
            socketPath = args[socketIndex + 1];
        }

        if (!socketPath) {
            // Default path based on OS
            socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\rpg-mcp' : '/tmp/rpg-mcp.sock';
        }

        const transport = new UnixServerTransport(socketPath);
        await server.connect(transport);
        console.error(`RPG MCP Server running on Unix socket ${socketPath}`);
    } else if (transportType === 'websocket') {
        const { WebSocketServerTransport } = await import('./transport/websocket.js');
        const portIndex = args.indexOf('--port');
        const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3001;

        const transport = new WebSocketServerTransport(port);
        await server.connect(transport);
        console.error(`RPG MCP Server running on WebSocket port ${port}`);
    } else {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('RPG MCP Server running on stdio');
    }
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
