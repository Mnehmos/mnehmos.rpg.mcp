import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NationManager } from '../../../src/engine/strategy/nation-manager.js';
import { NationRepository } from '../../../src/storage/repos/nation.repo.js';

describe('NationManager', () => {
    let manager: NationManager;
    let mockRepo: any;

    beforeEach(() => {
        mockRepo = {
            create: vi.fn(),
            findById: vi.fn(),
            updateResources: vi.fn(),
            updateTraits: vi.fn()
        };
        manager = new NationManager(mockRepo as unknown as NationRepository);
    });

    it('creates a nation with defaults', () => {
        const params = {
            worldId: 'world-1',
            name: 'Test Nation',
            leader: 'Leader',
            ideology: 'democracy' as const,
            aggression: 50,
            trust: 50,
            paranoia: 50,
            gdp: 1000,
            resources: { food: 100, metal: 100, oil: 100 },
            privateMemory: {},
            publicIntent: 'Peace'
        };

        const nation = manager.createNation(params);

        expect(nation.id).toBeDefined();
        expect(nation.relations).toEqual({});
        expect(mockRepo.create).toHaveBeenCalledWith(nation);
    });

    it('calculates power correctly', () => {
        const nation = {
            gdp: 1000,
            resources: { food: 100, metal: 50, oil: 20 }
        };

        // Power = GDP + (Oil * 2) + Metal
        // 1000 + 40 + 50 = 1090
        const power = manager.calculatePower(nation as any);
        expect(power).toBe(1090);
    });
});
