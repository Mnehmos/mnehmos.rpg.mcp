import { CombatEngine } from '../../engine/combat/engine.js';
import { onRollback } from '../../storage/unit-of-work.js';

/**
 * Live combat engines, keyed by `${sessionId}:${encounterId}`.
 *
 * The engines hold state in memory and write it to the `encounters` table as
 * they go. A database rollback cannot reach them, so the first time an engine
 * is touched inside a unit of work we snapshot it and register an undo: if the
 * unit rolls back, the engine returns to exactly what it was before the unit
 * began (or disappears, if the unit created it).
 */
export class CombatManager {
    private encounters: Map<string, CombatEngine> = new Map();

    private guard(id: string): void {
        const engine = this.encounters.get(id);
        const snapshot = engine ? cloneState(engine.getState()) : undefined;
        onRollback(() => {
            if (!engine) {
                this.encounters.delete(id);
                return;
            }
            engine.loadState(cloneState(snapshot) as any);
            this.encounters.set(id, engine);
        }, `combat:${id}`);
    }

    create(id: string, engine: CombatEngine): void {
        if (this.encounters.has(id)) {
            throw new Error(`Encounter ${id} already exists`);
        }
        this.guard(id);
        this.encounters.set(id, engine);
    }

    get(id: string): CombatEngine | null {
        if (this.encounters.has(id)) this.guard(id);
        return this.encounters.get(id) || null;
    }

    delete(id: string): boolean {
        if (this.encounters.has(id)) this.guard(id);
        return this.encounters.delete(id);
    }

    list(): string[] {
        return Array.from(this.encounters.keys());
    }

    clear(): void {
        this.encounters.clear();
    }

    /**
     * Check if a character is participating in any active encounter
     * Used to prevent resting during combat
     */
    isCharacterInCombat(characterId: string): boolean {
        for (const engine of this.encounters.values()) {
            const state = engine.getState();
            if (state?.participants.some(p => p.id === characterId)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get list of encounter IDs that a character is participating in
     * Useful for error messages
     */
    getEncountersForCharacter(characterId: string): string[] {
        const encounterIds: string[] = [];
        for (const [id, engine] of this.encounters.entries()) {
            const state = engine.getState();
            if (state?.participants.some(p => p.id === characterId)) {
                encounterIds.push(id);
            }
        }
        return encounterIds;
    }

    /**
     * Delete ALL encounters that contain a specific character
     * Used to clean up stale combat state after end_encounter
     * @returns Number of encounters deleted
     */
    deleteEncountersForCharacter(characterId: string): number {
        const toDelete: string[] = [];
        for (const [id, engine] of this.encounters.entries()) {
            const state = engine.getState();
            if (state?.participants.some(p => p.id === characterId)) {
                toDelete.push(id);
            }
        }
        
        for (const id of toDelete) {
            this.delete(id);
        }
        
        return toDelete.length;
    }
}

// Singleton for server lifetime
let instance: CombatManager | null = null;
export function getCombatManager(): CombatManager {
    if (!instance) instance = new CombatManager();
    return instance;
}

function cloneState<T>(state: T): T {
    return state == null ? state : structuredClone(state);
}
