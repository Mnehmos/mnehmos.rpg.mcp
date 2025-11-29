import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DiplomacyRepository } from '../../src/storage/repos/diplomacy.repo.js';
import { NationRepository } from '../../src/storage/repos/nation.repo.js';
import { RegionRepository } from '../../src/storage/repos/region.repo.js';
import { migrate } from '../../src/storage/migrations.js';
import { Nation } from '../../src/schema/nation.js';

describe('DiplomacyRepository', () => {
    let db: Database.Database;
    let repo: DiplomacyRepository;
    let nationRepo: NationRepository;
    let regionRepo: RegionRepository;

    const nation1: Nation = {
        id: 'nation-1',
        worldId: 'world-1',
        name: 'Nation 1',
        leader: 'Leader 1',
        ideology: 'democracy',
        aggression: 50,
        trust: 50,
        paranoia: 50,
        gdp: 1000,
        resources: { food: 100, metal: 100, oil: 100 },
        relations: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    const nation2 = { ...nation1, id: 'nation-2', name: 'Nation 2' };

    beforeEach(() => {
        db = new Database(':memory:');
        migrate(db);

        // Setup world and nations
        db.prepare(`
      INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at)
      VALUES ('world-1', 'Test World', 'seed', 100, 100, ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString());

        nationRepo = new NationRepository(db);
        nationRepo.create(nation1);
        nationRepo.create(nation2);

        repo = new DiplomacyRepository(db);
        regionRepo = new RegionRepository(db);
    });

    it('upserts and retrieves diplomatic relations', () => {
        const relation = {
            fromNationId: nation1.id,
            toNationId: nation2.id,
            opinion: 75,
            isAllied: true,
            updatedAt: new Date().toISOString()
        };

        repo.upsertRelation(relation);
        const retrieved = repo.getRelation(nation1.id, nation2.id);
        expect(retrieved).toEqual(expect.objectContaining({
            opinion: 75,
            isAllied: true
        }));

        // Update
        repo.upsertRelation({ ...relation, opinion: 80, updatedAt: new Date().toISOString() });
        const updated = repo.getRelation(nation1.id, nation2.id);
        console.log('Updated relation:', updated);
        expect(updated?.opinion).toBe(80);
    });

    it('creates and retrieves territorial claims', () => {
        // Create region first
        regionRepo.create({
            id: 'region-1',
            worldId: 'world-1',
            name: 'Region 1',
            type: 'wilderness',
            centerX: 0,
            centerY: 0,
            color: '#000000',
            controlLevel: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        const claim = {
            id: 'claim-1',
            nationId: nation1.id,
            regionId: 'region-1',
            claimStrength: 100,
            justification: 'Mine',
            createdAt: new Date().toISOString()
        };

        repo.createClaim(claim);
        const claims = repo.getClaimsByRegion('region-1');
        expect(claims).toHaveLength(1);
        expect(claims[0].nationId).toBe(nation1.id);
    });

    it('logs and retrieves nation events', () => {
        const event = {
            worldId: 'world-1',
            turnNumber: 1,
            eventType: 'ALLIANCE_FORMED' as const,
            involvedNations: [nation1.id, nation2.id],
            details: { reason: 'Test' },
            timestamp: new Date().toISOString()
        };

        repo.logEvent(event);
        const events = repo.getEventsByWorld('world-1');
        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe('ALLIANCE_FORMED');
    });
});
