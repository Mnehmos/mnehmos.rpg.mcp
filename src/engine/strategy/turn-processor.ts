import { NationRepository } from '../../storage/repos/nation.repo.js';
import { RegionRepository } from '../../storage/repos/region.repo.js';
import { DiplomacyRepository } from '../../storage/repos/diplomacy.repo.js';
import { ConflictResolver } from './conflict-resolver.js';
import { Nation } from '../../schema/nation.js';

export class TurnProcessor {
    constructor(
        private nationRepo: NationRepository,
        private regionRepo: RegionRepository,
        private diplomacyRepo: DiplomacyRepository,
        private conflictResolver: ConflictResolver
    ) { }

    processTurn(worldId: string, turnNumber: number): void {
        const nations = this.nationRepo.findByWorldId(worldId);

        // 1. Economic Growth
        this.processEconomy(nations);

        // 2. Resolve Conflicts
        this.processConflicts(worldId, turnNumber);

        // 3. Resource Drift (Consumption)
        this.processConsumption(nations);
    }

    private processEconomy(nations: Nation[]): void {
        for (const nation of nations) {
            // Simple GDP growth: 1% per turn base + resources
            // const growthRate = 1.01;
            // const newGdp = nation.gdp * growthRate; // TODO: Persist GDP update

            // Resource production based on owned regions (simplified for now)
            const newResources = {
                food: nation.resources.food + 10,
                metal: nation.resources.metal + 5,
                oil: nation.resources.oil + 2
            };

            this.nationRepo.updateResources(nation.id, newResources);
            nation.resources = newResources; // Update local state
        }
    }

    private processConflicts(worldId: string, turnNumber: number): void {
        const regions = this.regionRepo.findByWorldId(worldId);

        for (const region of regions) {
            const claims = this.diplomacyRepo.getClaimsByRegion(region.id);
            if (claims.length === 0) continue;

            const claimantNations = claims.map(c => this.nationRepo.findById(c.nationId)).filter((n): n is Nation => !!n);

            if (claimantNations.length === 0) continue;

            // Case 1: Uncontested claim on unowned region -> Auto-win
            if (claimantNations.length === 1 && !region.ownerNationId) {
                const winner = claimantNations[0];
                this.regionRepo.updateOwnership(region.id, winner.id, 10); // Initial control
                this.diplomacyRepo.logEvent({
                    worldId,
                    turnNumber,
                    eventType: 'REGION_CLAIMED',
                    involvedNations: [winner.id],
                    details: { log: `${winner.name} established control over ${region.name}`, regionId: region.id },
                    timestamp: new Date().toISOString()
                });
                continue;
            }

            // Case 2: Contested claim OR Claim on owned region
            if (claimantNations.length > 1 || (region.ownerNationId && claimantNations[0].id !== region.ownerNationId)) {
                const participants = [...claimantNations];
                if (region.ownerNationId && !participants.find(n => n.id === region.ownerNationId)) {
                    const owner = this.nationRepo.findById(region.ownerNationId);
                    if (owner) participants.push(owner);
                }

                if (participants.length < 2) continue; // Should not happen if logic is correct, but safety check

                const result = this.conflictResolver.resolveRegionConflict(
                    region,
                    participants,
                    `${worldId}-${turnNumber}-${region.id}`
                );

                this.regionRepo.updateOwnership(
                    region.id,
                    result.newControlLevel <= 0 ? null : (result.log.includes('conquered') ? result.winnerId : region.ownerNationId || null),
                    result.newControlLevel
                );

                this.diplomacyRepo.logEvent({
                    worldId,
                    turnNumber,
                    eventType: result.log.includes('conquered') ? 'REGION_CONQUERED' : 'REGION_CLAIMED',
                    involvedNations: [result.winnerId, result.loserId],
                    details: { log: result.log, regionId: region.id },
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    private processConsumption(nations: Nation[]): void {
        for (const nation of nations) {
            const consumed = {
                food: Math.max(0, nation.resources.food - 5),
                metal: nation.resources.metal,
                oil: nation.resources.oil
            };
            this.nationRepo.updateResources(nation.id, consumed);
        }
    }
}
