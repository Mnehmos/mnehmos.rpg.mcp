import { CombatEngine } from '../../engine/combat/engine.js';

export class CombatManager {
    private encounters: Map<string, CombatEngine> = new Map();

    create(id: string, engine: CombatEngine): void {
        if (this.encounters.has(id)) {
            throw new Error(`Encounter ${id} already exists`);
        }
        this.encounters.set(id, engine);
    }

    get(id: string): CombatEngine | null {
        return this.encounters.get(id) || null;
    }

    delete(id: string): boolean {
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
            this.encounters.delete(id);
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
