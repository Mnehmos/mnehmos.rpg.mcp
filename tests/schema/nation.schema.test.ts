import { describe, it, expect } from 'vitest';
import { NationSchema } from '../../src/schema/nation.js';

describe('NationSchema', () => {
    const validNation = {
        id: 'nation-1',
        worldId: 'world-1',
        name: 'Kingdom of Avalon',
        leader: 'King Arthur',
        ideology: 'democracy',
        aggression: 50,
        trust: 70,
        paranoia: 20,
        gdp: 1000,
        resources: {
            food: 100,
            metal: 50,
            oil: 10
        },
        privateMemory: { plan: 'Expand north' },
        publicIntent: 'Peaceful cooperation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    it('validates a correct nation object', () => {
        const result = NationSchema.safeParse(validNation);
        expect(result.success).toBe(true);
    });

    it('rejects invalid aggression values', () => {
        const invalid = { ...validNation, aggression: 101 };
        const result = NationSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });

    it('rejects invalid ideology', () => {
        const invalid = { ...validNation, ideology: 'communism' }; // Not in enum
        const result = NationSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });

    it('defaults resources to 0 if missing', () => {
        const minimal = {
            ...validNation,
            resources: {}
        };
        const result = NationSchema.safeParse(minimal);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.resources.food).toBe(0);
            expect(result.data.resources.metal).toBe(0);
            expect(result.data.resources.oil).toBe(0);
        }
    });
});
