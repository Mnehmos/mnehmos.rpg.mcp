/**
 * Domain service boundary for MCP handlers.
 *
 * Handlers should ask this facade for the repositories they need instead of
 * opening a database and constructing repositories themselves.  The facade is
 * scoped with AsyncLocalStorage so tests can inject doubles without a mutable
 * process-wide singleton, while HTTP requests still resolve the verified
 * tenant through getDb().
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import Database from 'better-sqlite3';
import { getDb } from '../storage/index.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { CombatActionLogRepository } from '../storage/repos/combat-action-log.repo.js';
import { ConcentrationRepository } from '../storage/repos/concentration.repo.js';
import { EncounterRepository } from '../storage/repos/encounter.repo.js';
import { EventInboxRepository } from '../storage/repos/event-inbox.repo.js';
import { InventoryRepository } from '../storage/repos/inventory.repo.js';
import { ItemRepository } from '../storage/repos/item.repo.js';
import { WorldRepository } from '../storage/repos/world.repo.js';
import { WorldSnapshotRepository } from '../storage/repos/world-snapshot.repo.js';

export interface DomainServices {
    readonly db: Database.Database;
    readonly character: CharacterRepository;
    readonly combatActionLog: CombatActionLogRepository;
    readonly concentration: ConcentrationRepository;
    readonly encounter: EncounterRepository;
    readonly eventInbox: EventInboxRepository;
    readonly inventory: InventoryRepository;
    readonly item: ItemRepository;
    readonly world: WorldRepository;
    readonly worldSnapshot: WorldSnapshotRepository;
}

const scopedServices = new AsyncLocalStorage<DomainServices>();

/** Build the default repository facade for one database handle. */
export function createDomainServices(db: Database.Database): DomainServices {
    return {
        db,
        character: new CharacterRepository(db),
        combatActionLog: new CombatActionLogRepository(db),
        concentration: new ConcentrationRepository(db),
        encounter: new EncounterRepository(db),
        eventInbox: new EventInboxRepository(db),
        inventory: new InventoryRepository(db),
        item: new ItemRepository(db),
        world: new WorldRepository(db),
        worldSnapshot: new WorldSnapshotRepository(db),
    };
}

/**
 * Resolve services for the current request, or for a direct test invocation
 * using the storage test database override.
 */
export function getDomainServices(): DomainServices {
    return scopedServices.getStore() ?? createDomainServices(getDb());
}

/** Execute a handler with an explicitly injected facade. */
export function runWithDomainServices<T>(services: DomainServices, fn: () => T): T {
    return scopedServices.run(services, fn);
}
