import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiplomacyEngine } from '../../../src/engine/strategy/diplomacy-engine.js';

describe('DiplomacyEngine', () => {
    let engine: DiplomacyEngine;
    let mockDiplomacyRepo: any;
    let mockNationRepo: any;

    beforeEach(() => {
        mockDiplomacyRepo = {
            getRelation: vi.fn(),
            upsertRelation: vi.fn(),
            logEvent: vi.fn()
        };
        mockNationRepo = {
            findById: vi.fn()
        };
        engine = new DiplomacyEngine(mockDiplomacyRepo, mockNationRepo);
    });

    it('proposes alliance successfully when opinion is high', () => {
        mockNationRepo.findById.mockReturnValue({ id: 'nation', paranoia: 20, worldId: 'world-1' });
        mockDiplomacyRepo.getRelation.mockReturnValue({ opinion: 80, isAllied: false });

        const result = engine.proposeAlliance('n1', 'n2');

        expect(result.success).toBe(true);
        expect(mockDiplomacyRepo.upsertRelation).toHaveBeenCalledTimes(2); // Symmetric
        expect(mockDiplomacyRepo.logEvent).toHaveBeenCalled();
    });

    it('rejects alliance when opinion is low', () => {
        mockNationRepo.findById.mockReturnValue({ id: 'nation', paranoia: 20 });
        mockDiplomacyRepo.getRelation.mockReturnValue({ opinion: 10, isAllied: false });

        const result = engine.proposeAlliance('n1', 'n2');

        expect(result.success).toBe(false);
        expect(mockDiplomacyRepo.upsertRelation).not.toHaveBeenCalled();
    });
});
