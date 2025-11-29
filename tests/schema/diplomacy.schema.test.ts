import { describe, it, expect } from 'vitest';
import { DiplomaticRelationSchema, TerritorialClaimSchema, NationEventSchema } from '../../src/schema/diplomacy.js';

describe('Diplomacy Schemas', () => {
    describe('DiplomaticRelationSchema', () => {
        const validRelation = {
            fromNationId: 'nation-1',
            toNationId: 'nation-2',
            opinion: 50,
            isAllied: true,
            updatedAt: new Date().toISOString()
        };

        it('validates correct relation', () => {
            const result = DiplomaticRelationSchema.safeParse(validRelation);
            expect(result.success).toBe(true);
        });

        it('enforces opinion range', () => {
            const invalid = { ...validRelation, opinion: 150 };
            const result = DiplomaticRelationSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });

    describe('TerritorialClaimSchema', () => {
        const validClaim = {
            id: 'claim-1',
            nationId: 'nation-1',
            regionId: 'region-1',
            claimStrength: 80,
            justification: 'Ancestral lands',
            createdAt: new Date().toISOString()
        };

        it('validates correct claim', () => {
            const result = TerritorialClaimSchema.safeParse(validClaim);
            expect(result.success).toBe(true);
        });
    });

    describe('NationEventSchema', () => {
        const validEvent = {
            worldId: 'world-1',
            turnNumber: 1,
            eventType: 'ALLIANCE_FORMED',
            involvedNations: ['nation-1', 'nation-2'],
            details: { reason: 'Mutual defense' },
            timestamp: new Date().toISOString()
        };

        it('validates correct event', () => {
            const result = NationEventSchema.safeParse(validEvent);
            expect(result.success).toBe(true);
        });
    });
});
