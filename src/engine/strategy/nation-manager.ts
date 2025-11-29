import { Nation } from '../../schema/nation.js';
import { NationRepository } from '../../storage/repos/nation.repo.js';
import { v4 as uuidv4 } from 'uuid';

export class NationManager {
    constructor(private nationRepo: NationRepository) { }

    createNation(params: Omit<Nation, 'id' | 'createdAt' | 'updatedAt' | 'relations'>): Nation {
        const nation: Nation = {
            ...params,
            id: uuidv4(),
            relations: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.nationRepo.create(nation);
        return nation;
    }

    getNation(nationId: string): Nation | null {
        return this.nationRepo.findById(nationId);
    }

    updateNationState(nationId: string, updates: Partial<Nation>): void {
        const nation = this.nationRepo.findById(nationId);
        if (!nation) throw new Error(`Nation ${nationId} not found`);

        // For now, we only support updating specific fields via specific repo methods
        // But for general state updates we might need a more generic update method in repo
        // or use specific methods.

        if (updates.resources) {
            this.nationRepo.updateResources(nationId, updates.resources);
        }

        if (updates.aggression !== undefined || updates.trust !== undefined || updates.paranoia !== undefined) {
            this.nationRepo.updateTraits(nationId, {
                aggression: updates.aggression,
                trust: updates.trust,
                paranoia: updates.paranoia
            });
        }
    }

    calculatePower(nation: Nation): number {
        // Power = GDP + (Oil * 2) + Metal
        return nation.gdp + (nation.resources.oil * 2) + nation.resources.metal;
    }
}
