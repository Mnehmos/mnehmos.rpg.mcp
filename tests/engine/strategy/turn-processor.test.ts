import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TurnProcessor } from '../../../src/engine/strategy/turn-processor.js';

describe('TurnProcessor', () => {
    let processor: TurnProcessor;
    let mockNationRepo: any;
    let mockRegionRepo: any;
    let mockDiplomacyRepo: any;
    let mockConflictResolver: any;

    beforeEach(() => {
        mockNationRepo = {
            findByWorldId: vi.fn(),
            updateResources: vi.fn()
        };
        mockRegionRepo = {
            findByWorldId: vi.fn(),
            updateOwnership: vi.fn()
        };
        mockDiplomacyRepo = {
            getClaimsByRegion: vi.fn(),
            logEvent: vi.fn()
        };
        mockConflictResolver = {
            resolveRegionConflict: vi.fn()
        };

        processor = new TurnProcessor(
            mockNationRepo,
            mockRegionRepo,
            mockDiplomacyRepo,
            mockConflictResolver
        );
    });

    it('processes economy growth', () => {
        const nation = {
            id: 'n1',
            gdp: 1000,
            resources: { food: 100, metal: 100, oil: 100 }
        };
        mockNationRepo.findByWorldId.mockReturnValue([nation]);
        mockRegionRepo.findByWorldId.mockReturnValue([]);

        processor.processTurn('world-1', 1);

        expect(mockNationRepo.updateResources).toHaveBeenCalled();
        // Check that resources increased (growth) then decreased (consumption)
        // Growth: +10 food, +5 metal, +2 oil -> 110, 105, 102
        // Consumption: -5 food -> 105, 105, 102
        expect(mockNationRepo.updateResources).toHaveBeenLastCalledWith(
            'n1',
            { food: 105, metal: 105, oil: 102 }
        );
    });
});
