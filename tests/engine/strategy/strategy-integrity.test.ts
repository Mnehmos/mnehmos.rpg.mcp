import { describe, it, expect, vi } from 'vitest';
import { ConflictResolver } from '../../../src/engine/strategy/conflict-resolver.js';
import { TurnProcessor } from '../../../src/engine/strategy/turn-processor.js';
import { DiplomacyEngine } from '../../../src/engine/strategy/diplomacy-engine.js';

const nation = (id: string, gdp: number) => ({
    id, name: id, gdp, resources: { food: 100, metal: 0, oil: 0 }, aggression: 50, paranoia: 50,
});

describe('conflict resolution', () => {
    const resolver = new ConflictResolver();

    it('never produces a control level above 100, however lopsided the fight', () => {
        const region = { id: 'r', controlLevel: 50, ownerNationId: 'weak' };
        const result = resolver.resolveRegionConflict(
            region as any, [nation('weak', 100) as any, nation('empire', 50_000) as any], 'seed'
        );

        expect(result.conquered).toBe(true);
        expect(result.newOwnerId).toBe('empire');
        expect(result.newControlLevel).toBeGreaterThan(0);
        expect(result.newControlLevel).toBeLessThanOrEqual(100);
    });

    it('a conqueror always ends up holding the region, even when control lands on zero', () => {
        // Defender's control (10) is exactly what the minimum blow removes.
        const region = { id: 'r', controlLevel: 10, ownerNationId: 'defender' };
        const attacker = { ...nation('attacker', 1_000), aggression: 0, paranoia: 0 };
        const defender = { ...nation('defender', 1_000), aggression: 0, paranoia: 0 };

        // Try seeds until the attacker wins by a margin under 20 (damage = 10).
        let result;
        for (let i = 0; i < 500 && !result; i++) {
            const r = resolver.resolveRegionConflict(region as any, [attacker as any, defender as any], `s-${i}`);
            if (r.conquered && r.battleWinnerId === 'attacker') result = r;
        }
        expect(result).toBeDefined();
        expect(result!.newOwnerId).toBe('attacker');
        expect(result!.newControlLevel).toBeGreaterThan(0);
    });

    it('names the battle winner and the owner separately when an attack falls short', () => {
        const region = { id: 'r', controlLevel: 100, ownerNationId: 'defender' };
        let result;
        for (let i = 0; i < 500 && !result; i++) {
            const r = resolver.resolveRegionConflict(
                region as any, [nation('attacker', 1_010) as any, nation('defender', 1_000) as any], `s-${i}`
            );
            if (r.battleWinnerId === 'attacker') result = r;
        }
        expect(result).toBeDefined();
        expect(result!.conquered).toBe(false);
        expect(result!.newOwnerId).toBe('defender');
        expect(result!.loserId).toBe('defender');
    });
});

describe('turn processing', () => {
    function processor(region: any, claims: any[], nations: Record<string, any>) {
        const regionRepo = { findByWorldId: vi.fn(() => [region]), updateOwnership: vi.fn() };
        const nationRepo = {
            findByWorldId: vi.fn(() => Object.values(nations)),
            findById: vi.fn((id: string) => nations[id] ?? null),
            updateResources: vi.fn(),
        };
        const diplomacyRepo = { getClaimsByRegion: vi.fn(() => claims), logEvent: vi.fn() };
        const resolver = new ConflictResolver();
        const spy = vi.spyOn(resolver, 'resolveRegionConflict');
        return { run: () => new TurnProcessor(nationRepo as any, regionRepo as any, diplomacyRepo as any, resolver).processTurn('w', 1), regionRepo, diplomacyRepo, spy };
    }

    it('a nation cannot fight itself, or buy extra rolls, by claiming a region twice', () => {
        const owner = nation('owner', 1_000);
        const region = { id: 'r', name: 'Vale', controlLevel: 40, ownerNationId: 'owner' };
        const claims = [{ nationId: 'owner' }, { nationId: 'owner' }, { nationId: 'owner' }];
        const { run, regionRepo, spy } = processor(region, claims, { owner });

        run();

        expect(spy).not.toHaveBeenCalled();
        expect(regionRepo.updateOwnership).not.toHaveBeenCalled();
    });

    it('counts each claimant once in a contested region', () => {
        const a = nation('a', 1_000);
        const b = nation('b', 1_000);
        const region = { id: 'r', name: 'Vale', controlLevel: 0, ownerNationId: null };
        const claims = [{ nationId: 'a' }, { nationId: 'a' }, { nationId: 'a' }, { nationId: 'b' }];
        const { run, spy } = processor(region, claims, { a, b });

        run();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][1].map((n: any) => n.id).sort()).toEqual(['a', 'b']);
    });

    it('hands a conquered region to the conqueror', () => {
        const weak = nation('weak', 100);
        const empire = nation('empire', 50_000);
        const region = { id: 'r', name: 'Vale', controlLevel: 50, ownerNationId: 'weak' };
        const { run, regionRepo, diplomacyRepo } = processor(region, [{ nationId: 'empire' }], { weak, empire });

        run();

        const [, owner, control] = regionRepo.updateOwnership.mock.calls[0];
        expect(owner).toBe('empire');
        expect(control).toBeGreaterThan(0);
        expect(control).toBeLessThanOrEqual(100);
        expect(diplomacyRepo.logEvent.mock.calls[0][0].eventType).toBe('REGION_CONQUERED');
        expect(diplomacyRepo.logEvent.mock.calls[0][0].involvedNations).toEqual(['empire', 'weak']);
    });
});

describe('diplomacy', () => {
    it('a nation cannot ally with itself', () => {
        const repo = { getRelation: vi.fn(() => ({ opinion: 100, isAllied: false })), upsertRelation: vi.fn(), logEvent: vi.fn() };
        const nations = { findById: vi.fn(() => ({ id: 'a', worldId: 'w', paranoia: 0 })) };
        const engine = new DiplomacyEngine(repo as any, nations as any);

        const result = engine.proposeAlliance('a', 'a');

        expect(result.success).toBe(false);
        expect(repo.upsertRelation).not.toHaveBeenCalled();
    });
});
