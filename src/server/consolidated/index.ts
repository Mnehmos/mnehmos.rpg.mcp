/**
 * Consolidated Tools Index
 *
 * Exports all 28 consolidated tools for the v1.0 clean-break release.
 * Each tool uses action-based routing with fuzzy matching and guiding errors.
 */

// Batch 1 - Simple CRUD
export { SecretManageTool, handleSecretManage } from './secret-manage.js';
export { RestManageTool, handleRestManage } from './rest-manage.js';
export { ConcentrationManageTool, handleConcentrationManage } from './concentration-manage.js';
export { NarrativeManageTool, handleNarrativeManage } from './narrative-manage.js';
export { ScrollManageTool, handleScrollManage } from './scroll-manage.js';

// Batch 2 - Character/Party
export { CharacterManageTool, handleCharacterManage } from './character-manage.js';
export { PartyManageTool, handlePartyManage } from './party-manage.js';

// Batch 3 - Inventory/Loot
export { ItemManageTool, handleItemManage } from './item-manage.js';
export { InventoryManageTool, handleInventoryManage } from './inventory-manage.js';
export { CorpseManageTool, handleCorpseManage } from './corpse-manage.js';

// Batch 4 - Combat (High Risk)
export { CombatManageTool, handleCombatManage } from './combat-manage.js';
export { CombatActionTool, handleCombatAction } from './combat-action.js';
export { CombatMapTool, handleCombatMap } from './combat-map.js';

// Batch 5 - World/Spatial
export { WorldManageTool, handleWorldManage } from './world-manage.js';
export { WorldMapTool, handleWorldMap } from './world-map.js';
export { SpatialManageTool, handleSpatialManage } from './spatial-manage.js';

// Batch 6a - NPC/Quest/Social
export { QuestManageTool, handleQuestManage } from './quest-manage.js';
export { NpcManageTool, handleNpcManage } from './npc-manage.js';
export { AuraManageTool, handleAuraManage } from './aura-manage.js';
export { TheftManageTool, handleTheftManage } from './theft-manage.js';

// Batch 6b - Utility
export { ImprovisationManageTool, handleImprovisationManage } from './improvisation-manage.js';
export { MathManageTool, handleMathManage } from './math-manage.js';
export { StrategyManageTool, handleStrategyManage } from './strategy-manage.js';
export { TurnManageTool, handleTurnManage } from './turn-manage.js';

// Batch 6c - Session/Travel/Batch
export { SpawnManageTool, handleSpawnManage } from './spawn-manage.js';
export { SessionManageTool, handleSessionManage } from './session-manage.js';
export { TravelManageTool, handleTravelManage } from './travel-manage.js';
export { BatchManageTool, handleBatchManage } from './batch-manage.js';

// Batch 7 - Agent (LLM-driven NPCs)
export { AgentManageTool, handleAgentManage } from './agent-manage.js';

/**
 * Array of all consolidated tool definitions for easy iteration
 */
import { SecretManageTool, handleSecretManage } from './secret-manage.js';
import { RestManageTool, handleRestManage } from './rest-manage.js';
import { ConcentrationManageTool, handleConcentrationManage } from './concentration-manage.js';
import { NarrativeManageTool, handleNarrativeManage } from './narrative-manage.js';
import { ScrollManageTool, handleScrollManage } from './scroll-manage.js';
import { CharacterManageTool, handleCharacterManage } from './character-manage.js';
import { PartyManageTool, handlePartyManage } from './party-manage.js';
import { ItemManageTool, handleItemManage } from './item-manage.js';
import { InventoryManageTool, handleInventoryManage } from './inventory-manage.js';
import { CorpseManageTool, handleCorpseManage } from './corpse-manage.js';
import { CombatManageTool, handleCombatManage } from './combat-manage.js';
import { CombatActionTool, handleCombatAction } from './combat-action.js';
import { CombatMapTool, handleCombatMap } from './combat-map.js';
import { WorldManageTool, handleWorldManage } from './world-manage.js';
import { WorldMapTool, handleWorldMap } from './world-map.js';
import { SpatialManageTool, handleSpatialManage } from './spatial-manage.js';
import { QuestManageTool, handleQuestManage } from './quest-manage.js';
import { NpcManageTool, handleNpcManage } from './npc-manage.js';
import { AuraManageTool, handleAuraManage } from './aura-manage.js';
import { TheftManageTool, handleTheftManage } from './theft-manage.js';
import { ImprovisationManageTool, handleImprovisationManage } from './improvisation-manage.js';
import { MathManageTool, handleMathManage } from './math-manage.js';
import { StrategyManageTool, handleStrategyManage } from './strategy-manage.js';
import { TurnManageTool, handleTurnManage } from './turn-manage.js';
import { SpawnManageTool, handleSpawnManage } from './spawn-manage.js';
import { SessionManageTool, handleSessionManage } from './session-manage.js';
import { TravelManageTool, handleTravelManage } from './travel-manage.js';
import { BatchManageTool, handleBatchManage } from './batch-manage.js';
import { AgentManageTool, handleAgentManage } from './agent-manage.js';

export const ConsolidatedTools = [
    { tool: SecretManageTool, handler: handleSecretManage },
    { tool: RestManageTool, handler: handleRestManage },
    { tool: ConcentrationManageTool, handler: handleConcentrationManage },
    { tool: NarrativeManageTool, handler: handleNarrativeManage },
    { tool: ScrollManageTool, handler: handleScrollManage },
    { tool: CharacterManageTool, handler: handleCharacterManage },
    { tool: PartyManageTool, handler: handlePartyManage },
    { tool: ItemManageTool, handler: handleItemManage },
    { tool: InventoryManageTool, handler: handleInventoryManage },
    { tool: CorpseManageTool, handler: handleCorpseManage },
    { tool: CombatManageTool, handler: handleCombatManage },
    { tool: CombatActionTool, handler: handleCombatAction },
    { tool: CombatMapTool, handler: handleCombatMap },
    { tool: WorldManageTool, handler: handleWorldManage },
    { tool: WorldMapTool, handler: handleWorldMap },
    { tool: SpatialManageTool, handler: handleSpatialManage },
    { tool: QuestManageTool, handler: handleQuestManage },
    { tool: NpcManageTool, handler: handleNpcManage },
    { tool: AuraManageTool, handler: handleAuraManage },
    { tool: TheftManageTool, handler: handleTheftManage },
    { tool: ImprovisationManageTool, handler: handleImprovisationManage },
    { tool: MathManageTool, handler: handleMathManage },
    { tool: StrategyManageTool, handler: handleStrategyManage },
    { tool: TurnManageTool, handler: handleTurnManage },
    { tool: SpawnManageTool, handler: handleSpawnManage },
    { tool: SessionManageTool, handler: handleSessionManage },
    { tool: TravelManageTool, handler: handleTravelManage },
    { tool: BatchManageTool, handler: handleBatchManage },
    { tool: AgentManageTool, handler: handleAgentManage },
];
