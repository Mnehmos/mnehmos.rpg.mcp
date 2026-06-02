/**
 * Agent runtime dependency registrar.
 *
 * Wired once at server startup in src/server/index.ts (mirrors setCombatPubSub).
 * Tools that need to invoke agents (agent_manage invoke, combat_manage advance
 * auto-invoke hook) read the singleton via getAgentRuntime().
 */

import Database from 'better-sqlite3';
import { ProviderFactory } from '../provider/factory.js';
import { AgentRepository } from '../../storage/repos/agent.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../../storage/repos/concentration.repo.js';
import { InventoryRepository } from '../../storage/repos/inventory.repo.js';
import { NpcMemoryRepository } from '../../storage/repos/npc-memory.repo.js';
import { EventInboxRepository } from '../../storage/repos/event-inbox.repo.js';
import { EncounterRepository } from '../../storage/repos/encounter.repo.js';

export interface AgentRuntimeDeps {
    db: Database.Database;
    providerFactory: ProviderFactory;
    agentRepo: AgentRepository;
    characterRepo: CharacterRepository;
    concentrationRepo: ConcentrationRepository;
    inventoryRepo: InventoryRepository;
    npcMemoryRepo: NpcMemoryRepository;
    eventInboxRepo: EventInboxRepository;
    encounterRepo: EncounterRepository;
}

let defaultDeps: AgentRuntimeDeps | null = null;

export function setAgentRuntime(deps: AgentRuntimeDeps): void {
    defaultDeps = deps;
}

export function getAgentRuntime(): AgentRuntimeDeps | null {
    return defaultDeps;
}

export function clearAgentRuntime(): void {
    defaultDeps = null;
}

/**
 * Convenience: build runtime deps from a db handle + provider factory.
 * Used by both production wiring and tests.
 */
export function buildAgentRuntime(db: Database.Database, providerFactory: ProviderFactory): AgentRuntimeDeps {
    return {
        db,
        providerFactory,
        agentRepo: new AgentRepository(db),
        characterRepo: new CharacterRepository(db),
        concentrationRepo: new ConcentrationRepository(db),
        inventoryRepo: new InventoryRepository(db),
        npcMemoryRepo: new NpcMemoryRepository(db),
        eventInboxRepo: new EventInboxRepository(db),
        encounterRepo: new EncounterRepository(db)
    };
}
