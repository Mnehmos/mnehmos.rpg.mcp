import { DiplomacyRepository } from '../../storage/repos/diplomacy.repo.js';
import { NationRepository } from '../../storage/repos/nation.repo.js';

export class DiplomacyEngine {
    constructor(
        private diplomacyRepo: DiplomacyRepository,
        private nationRepo: NationRepository
    ) { }

    proposeAlliance(fromNationId: string, toNationId: string): { success: boolean; reason?: string } {
        const fromNation = this.nationRepo.findById(fromNationId);
        const toNation = this.nationRepo.findById(toNationId);

        if (!fromNation || !toNation) return { success: false, reason: 'Nation not found' };

        // Check existing relation
        const relation = this.diplomacyRepo.getRelation(fromNationId, toNationId);
        if (relation?.isAllied) return { success: false, reason: 'Already allied' };

        // Simple logic: Accept if opinion > 50 + paranoia check
        // In a real LLM system, this might be an LLM decision, but for the engine we need deterministic rules
        // or we just record the proposal.
        // The spec says "LLMs to negotiate", so maybe this just records the proposal?
        // But the tool is "propose_alliance".

        // For MVP, we'll implement a simple threshold check for "auto-accept" if it's an NPC,
        // or just set a "pending" state?
        // The schema doesn't have "pending".
        // Let's assume for now we just create the alliance if opinion is high enough.

        const opinion = relation?.opinion || 0;
        const acceptanceThreshold = 50 + (toNation.paranoia / 2);

        if (opinion >= acceptanceThreshold) {
            this.establishAlliance(fromNationId, toNationId);
            return { success: true };
        }

        return { success: false, reason: 'Refused: Opinion too low' };
    }

    breakAlliance(fromNationId: string, toNationId: string): void {
        this.diplomacyRepo.upsertRelation({
            fromNationId,
            toNationId,
            opinion: -20, // Penalty for breaking alliance
            isAllied: false,
            updatedAt: new Date().toISOString()
        });

        // Symmetric
        this.diplomacyRepo.upsertRelation({
            fromNationId: toNationId,
            toNationId: fromNationId,
            opinion: -50, // They hate you now
            isAllied: false,
            updatedAt: new Date().toISOString()
        });

        this.logEvent(fromNationId, 'ALLIANCE_BROKEN', [fromNationId, toNationId], { initiator: fromNationId });
    }

    adjustOpinion(fromNationId: string, toNationId: string, delta: number): void {
        const current = this.diplomacyRepo.getRelation(fromNationId, toNationId);
        const newOpinion = Math.max(-100, Math.min(100, (current?.opinion || 0) + delta));

        this.diplomacyRepo.upsertRelation({
            fromNationId,
            toNationId,
            opinion: newOpinion,
            isAllied: current?.isAllied || false,
            truceUntil: current?.truceUntil,
            updatedAt: new Date().toISOString()
        });
    }

    sendMessage(fromNationId: string, toNationId: string, message: string): void {
        this.logEvent(fromNationId, 'DIPLOMATIC_MESSAGE', [fromNationId, toNationId], { message });
    }

    private establishAlliance(id1: string, id2: string): void {
        const now = new Date().toISOString();
        this.diplomacyRepo.upsertRelation({
            fromNationId: id1,
            toNationId: id2,
            opinion: 75, // Boost opinion
            isAllied: true,
            updatedAt: now
        });
        this.diplomacyRepo.upsertRelation({
            fromNationId: id2,
            toNationId: id1,
            opinion: 75,
            isAllied: true,
            updatedAt: now
        });

        this.logEvent(id1, 'ALLIANCE_FORMED', [id1, id2], {});
    }

    private logEvent(worldIdFromNation: string, type: any, involved: string[], details: any): void {
        const nation = this.nationRepo.findById(worldIdFromNation);
        if (!nation) return;

        this.diplomacyRepo.logEvent({
            worldId: nation.worldId,
            turnNumber: 0, // TODO: Get from TurnProcessor
            eventType: type,
            involvedNations: involved,
            details,
            timestamp: new Date().toISOString()
        });
    }
}
