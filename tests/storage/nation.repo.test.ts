import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { NationRepository } from '../../src/storage/repos/nation.repo.js';
import { migrate } from '../../src/storage/migrations.js';
import { Nation } from '../../src/schema/nation.js';

describe('NationRepository', () => {
    let db: Database.Database;
    let repo: NationRepository;

    const testNation: Nation = {
        id: 'nation-1',
        worldId: 'world-1',
        name: 'Test Kingdom',
        leader: 'King Test',
        ideology: 'democracy',
        aggression: 50,
        trust: 50,
        paranoia: 50,
        gdp: 1000,
        resources: { food: 100, metal: 100, oil: 100 },
        relations: {},
        privateMemory: {},
        publicIntent: 'Peace',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    beforeEach(() => {
        db = new Database(':memory:');
        migrate(db);
        // Create world first due to FK constraint
        db.prepare(`
      INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at)
      VALUES ('world-1', 'Test World', 'seed', 100, 100, ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString());

        repo = new NationRepository(db);
    });

    it('creates and retrieves a nation', () => {
        repo.create(testNation);
        const retrieved = repo.findById(testNation.id);
        expect(retrieved).toEqual(testNation);
    });

    it('finds nations by world id', () => {
        repo.create(testNation);
        const nations = repo.findByWorldId('world-1');
        expect(nations).toHaveLength(1);
        expect(nations[0].id).toBe(testNation.id);
    });

    it('updates resources', () => {
        repo.create(testNation);
        const newResources = { food: 200, metal: 200, oil: 200 };
        repo.updateResources(testNation.id, newResources);

        const updated = repo.findById(testNation.id);
        expect(updated?.resources).toEqual(newResources);
    });

    it('updates traits', () => {
        repo.create(testNation);
        repo.updateTraits(testNation.id, { aggression: 80, trust: 20 });

        const updated = repo.findById(testNation.id);
        expect(updated?.aggression).toBe(80);
        expect(updated?.trust).toBe(20);
        expect(updated?.paranoia).toBe(50); // Unchanged
    });
});
