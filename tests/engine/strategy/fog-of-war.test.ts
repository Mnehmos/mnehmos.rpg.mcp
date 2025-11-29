import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FogOfWar } from '../../../src/engine/strategy/fog-of-war.js';

describe('FogOfWar', () => {
    let fow: FogOfWar;
    let mockDiplomacyRepo: any;
    let mockRegionRepo: any;

    beforeEach(() => {
        mockDiplomacyRepo = {
            getRelation: vi.fn()
        };
        mockRegionRepo = {};
        fow = new FogOfWar(mockDiplomacyRepo, mockRegionRepo);
    });

    it('hides details for non-allied nations', () => {
        const viewerId = 'viewer';
        const otherId = 'other';

        const nations = [
            { id: viewerId, name: 'Viewer' },
            {
                id: otherId,
                name: 'Other',
                gdp: 1234,
                resources: { food: 123, metal: 45, oil: 12 },
                aggression: 55,
                trust: 45,
                paranoia: 65
            }
        ];

        mockDiplomacyRepo.getRelation.mockReturnValue({ isAllied: false });

        const result = fow.filterWorldState(viewerId, nations as any[], []);
        const maskedOther = result.nations.find(n => n.id === otherId);

        expect(maskedOther?.gdp).not.toBe(1234); // Should be fuzzed
        expect(maskedOther?.gdp).toBe(1200); // Rounded to nearest 100
        expect(maskedOther?.aggression).toBe(60); // Rounded to nearest 10
    });

    it('reveals details for allies', () => {
        const viewerId = 'viewer';
        const allyId = 'ally';

        const nations = [
            { id: viewerId },
            {
                id: allyId,
                gdp: 1234,
                resources: { food: 123, metal: 45, oil: 12 }
            }
        ];

        mockDiplomacyRepo.getRelation.mockReturnValue({ isAllied: true });

        const result = fow.filterWorldState(viewerId, nations as any[], []);
        const ally = result.nations.find(n => n.id === allyId);

        expect(ally?.gdp).toBe(1234); // Exact value
    });
});
