
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { initDB } from '../../src/storage/db';
import { migrate } from '../../src/storage/migrations';
import { RegionRepository } from '../../src/storage/repos/region.repo';
import { WorldRepository } from '../../src/storage/repos/world.repo';
import { Region } from '../../src/schema/region';
import { World } from '../../src/schema/world';
import { FIXED_TIMESTAMP } from '../fixtures';

const TEST_DB_PATH = 'test-region-repo.db';

describe('RegionRepository', () => {
    let db: ReturnType<typeof initDB>;
    let repo: RegionRepository;
    let worldRepo: WorldRepository;

    beforeEach(() => {
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        db = initDB(TEST_DB_PATH);
        migrate(db);
        repo = new RegionRepository(db);
        worldRepo = new WorldRepository(db);

        // Create a world for foreign key constraint
        const world: World = {
            id: 'world-1',
            name: 'Test World',
            seed: 'seed-1',
            width: 100,
            height: 100,
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };
        worldRepo.create(world);
    });

    afterEach(() => {
        db.close();
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
    });

    it('should create and retrieve a region', () => {
        const region: Region = {
            id: 'region-1',
            worldId: 'world-1',
            name: 'Kingdom of Test',
            type: 'kingdom',
            centerX: 50,
            centerY: 50,
            color: '#ff0000',
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
            controlLevel: 0,
        };

        repo.create(region);

        const retrieved = repo.findById('region-1');
        expect(retrieved).toEqual(expect.objectContaining(region));
    });

    it('should find regions by worldId', () => {
        const r1: Region = {
            id: 'r1',
            worldId: 'world-1',
            name: 'R1',
            type: 'kingdom',
            centerX: 10,
            centerY: 10,
            color: '#000',
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
            controlLevel: 0,
        };
        const r2: Region = {
            id: 'r2',
            worldId: 'world-1',
            name: 'R2',
            type: 'wilderness',
            centerX: 20,
            centerY: 20,
            color: '#fff',
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
            controlLevel: 0,
        };

        repo.create(r1);
        repo.create(r2);

        const regions = repo.findByWorldId('world-1');
        expect(regions).toHaveLength(2);
        expect(regions).toContainEqual(expect.objectContaining(r1));
        expect(regions).toContainEqual(expect.objectContaining(r2));
    });
});
