
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { initDB } from '../../src/storage/db';
import { migrate } from '../../src/storage/migrations';
import { WorldRepository } from '../../src/storage/repos/world.repo';
import { World } from '../../src/schema/world';
import { FIXED_TIMESTAMP } from '../fixtures';

const TEST_DB_PATH = 'test-world-repo.db';

describe('WorldRepository', () => {
    let db: ReturnType<typeof initDB>;
    let repo: WorldRepository;

    beforeEach(() => {
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        db = initDB(TEST_DB_PATH);
        migrate(db);
        repo = new WorldRepository(db);
    });

    afterEach(() => {
        db.close();
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
    });

    it('should create and retrieve a world', () => {
        const world: World = {
            id: 'world-1',
            name: 'Test World',
            seed: 'seed-123',
            width: 100,
            height: 100,
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };

        repo.create(world);

        const retrieved = repo.findById('world-1');
        // Retrieved world may have additional fields like 'environment'
        expect(retrieved).toMatchObject(world);
    });

    it('should return null for non-existent world', () => {
        const retrieved = repo.findById('non-existent');
        expect(retrieved).toBeNull();
    });

    it('should list all worlds', () => {
        const world1: World = {
            id: 'world-1',
            name: 'World 1',
            seed: 'seed-1',
            width: 100,
            height: 100,
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };
        const world2: World = {
            id: 'world-2',
            name: 'World 2',
            seed: 'seed-2',
            width: 200,
            height: 200,
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };

        repo.create(world1);
        repo.create(world2);

        const all = repo.findAll();
        expect(all).toHaveLength(2);
        // Use toMatchObject to allow for extra fields like 'environment'
        expect(all.find(w => w.id === 'world-1')).toMatchObject(world1);
        expect(all.find(w => w.id === 'world-2')).toMatchObject(world2);
    });

    it('should delete a world', () => {
        const world: World = {
            id: 'world-1',
            name: 'To Delete',
            seed: 'seed-del',
            width: 100,
            height: 100,
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        };

        repo.create(world);
        repo.delete('world-1');

        const retrieved = repo.findById('world-1');
        expect(retrieved).toBeNull();
    });
});
