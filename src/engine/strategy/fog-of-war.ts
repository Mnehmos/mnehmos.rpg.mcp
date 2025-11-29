import { Nation } from '../../schema/nation.js';
import { Region } from '../../schema/region.js';
import { DiplomacyRepository } from '../../storage/repos/diplomacy.repo.js';

export class FogOfWar {
    constructor(
        private diplomacyRepo: DiplomacyRepository
    ) { }

    filterWorldState(
        viewerNationId: string,
        allNations: Nation[],
        allRegions: Region[]
    ): { nations: Partial<Nation>[]; regions: Region[] } {
        // 1. Identify visible regions
        // Visible if: Owned by viewer OR Adjacent to owned region OR Owned by ally

        // const ownedRegions = allRegions.filter(r => r.ownerNationId === viewerNationId);
        const allies = allNations.filter(n => {
            if (n.id === viewerNationId) return false;
            const rel = this.diplomacyRepo.getRelation(viewerNationId, n.id);
            return rel?.isAllied;
        });
        const allyIds = new Set(allies.map(a => a.id));

        const visibleRegionIds = new Set<string>();

        // Add owned and allied regions
        for (const r of allRegions) {
            if (r.ownerNationId === viewerNationId || (r.ownerNationId && allyIds.has(r.ownerNationId))) {
                visibleRegionIds.add(r.id);
            }
        }

        // Add adjacent to owned (Naive adjacency: distance check or grid check)
        // Since we don't have a graph yet, we'll use a simple distance heuristic if coordinates exist
        // Or for MVP, just reveal everything but hide DETAILS of nations.
        // The spec says: "if not adjacent and not allied: hide exact GDP..."

        // Let's implement the Nation masking first, as that's the critical part for LLMs.

        const maskedNations = allNations.map(nation => {
            if (nation.id === viewerNationId) return nation; // See self fully

            const isAlly = allyIds.has(nation.id);
            // Check adjacency (do we share a border?)
            // We need a way to check border. 
            // For MVP, let's assume if we see any of their regions, we have some info.

            const hasContact = isAlly; // Simplified

            if (hasContact) {
                // Allies see almost everything except private memory
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { privateMemory, ...publicData } = nation;
                return publicData;
            } else {
                // Strangers/Enemies see fuzzy data
                return {
                    id: nation.id,
                    worldId: nation.worldId,
                    name: nation.name,
                    leader: nation.leader,
                    ideology: nation.ideology,
                    publicIntent: nation.publicIntent,
                    // Hide exact stats
                    aggression: this.fuzz(nation.aggression),
                    trust: this.fuzz(nation.trust),
                    paranoia: this.fuzz(nation.paranoia),
                    gdp: this.fuzz(nation.gdp),
                    // Hide resources completely or fuzz them? Spec says "hide exact resource amounts"
                    resources: {
                        food: this.fuzz(nation.resources.food),
                        metal: this.fuzz(nation.resources.metal),
                        oil: this.fuzz(nation.resources.oil)
                    },
                    // Hide relations? Maybe show public alliances?
                    relations: {}, // Hide their private opinion map
                    createdAt: nation.createdAt,
                    updatedAt: nation.updatedAt
                };
            }
        });

        return {
            nations: maskedNations,
            regions: allRegions // For now, map is fully visible, just ownership might be stale? 
            // Actually spec says "Fog-of-war (no perfect info)". 
            // Usually map geography is known, but maybe not units (we have no units).
            // So regions are fine to show.
        };
    }

    private fuzz(value: number): number {
        // Round to nearest 10 or 100?
        if (value < 100) return Math.round(value / 10) * 10;
        return Math.round(value / 100) * 100;
    }
}
