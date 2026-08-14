/**
 * Tests for consolidated world_manage tool
 * Validates all 7 actions: create, get, list, delete, update, generate, get_state
 */

import { handleWorldManage, WorldManageTool } from '../../../src/server/consolidated/world-manage.js';
import { getDb } from '../../../src/storage/index.js';
import { RegionRepository } from '../../../src/storage/repos/region.repo.js';
import { StructureRepository } from '../../../src/storage/repos/structure.repo.js';
import { getWorldManager } from '../../../src/server/state/world-manager.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- WORLD_MANAGE_JSON\n([\s\S]*?)\nWORLD_MANAGE_JSON -->/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
    }
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
    } catch {
        // Not valid JSON
    }
    return { error: 'parse_failed', rawText: text };
}

describe('world_manage consolidated tool', () => {
    let ctx: { sessionId: string };

    beforeEach(async () => {
        ctx = { sessionId: `test-session-${randomUUID()}` };
        const db = getDb(':memory:');
        db.exec('DELETE FROM worlds');
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(WorldManageTool.name).toBe('world_manage');
        });

        it('should list all available actions in description', () => {
            expect(WorldManageTool.description).toContain('create');
            expect(WorldManageTool.description).toContain('get');
            expect(WorldManageTool.description).toContain('list');
            expect(WorldManageTool.description).toContain('delete');
            expect(WorldManageTool.description).toContain('update');
            expect(WorldManageTool.description).toContain('generate');
            expect(WorldManageTool.description).toContain('get_state');
        });
    });

    describe('create action', () => {
        it('should create a new world', async () => {
            const result = await handleWorldManage({
                action: 'create',
                name: 'Test World',
                seed: 'test-seed',
                width: 50,
                height: 50
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('create');
            expect(data.name).toBe('Test World');
            expect(data.worldId).toBeDefined();
        });

        it('should accept "new" alias', async () => {
            const result = await handleWorldManage({
                action: 'new',
                name: 'Alias World',
                seed: 'alias-seed',
                width: 30,
                height: 30
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('create');
        });
    });

    describe('list action', () => {
        it('should list all worlds', async () => {
            // Create a world first
            await handleWorldManage({
                action: 'create',
                name: 'List Test World',
                seed: 'list-seed',
                width: 20,
                height: 20
            }, ctx);

            const result = await handleWorldManage({
                action: 'list'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('list');
            expect(data.count).toBeGreaterThanOrEqual(1);
        });

        it('should accept "all" alias', async () => {
            const result = await handleWorldManage({
                action: 'all'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('list');
        });
    });

    describe('get action', () => {
        it('should get a world by ID', async () => {
            const createResult = await handleWorldManage({
                action: 'create',
                name: 'Get Test World',
                seed: 'get-seed',
                width: 25,
                height: 25
            }, ctx);
            const worldId = parseResult(createResult).worldId;

            const result = await handleWorldManage({
                action: 'get',
                id: worldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get');
            expect(data.world.name).toBe('Get Test World');
        });

        it('should return error for non-existent world', async () => {
            const result = await handleWorldManage({
                action: 'get',
                id: 'non-existent-id'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });
    });

    describe('delete action', () => {
        it('should delete a world', async () => {
            const createResult = await handleWorldManage({
                action: 'create',
                name: 'Delete Test World',
                seed: 'delete-seed',
                width: 20,
                height: 20
            }, ctx);
            const worldId = parseResult(createResult).worldId;

            const result = await handleWorldManage({
                action: 'delete',
                id: worldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('delete');
            expect(data.deletedId).toBe(worldId);
        });

        it('should accept "remove" alias', async () => {
            const createResult = await handleWorldManage({
                action: 'create',
                name: 'Remove Alias World',
                seed: 'remove-seed',
                width: 20,
                height: 20
            }, ctx);
            const worldId = parseResult(createResult).worldId;

            const result = await handleWorldManage({
                action: 'remove',
                id: worldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('delete');
        });
    });

    describe('update action', () => {
        it('should update world environment', async () => {
            const createResult = await handleWorldManage({
                action: 'create',
                name: 'Update Test World',
                seed: 'update-seed',
                width: 20,
                height: 20
            }, ctx);
            const worldId = parseResult(createResult).worldId;

            const result = await handleWorldManage({
                action: 'update',
                id: worldId,
                environment: {
                    timeOfDay: 'night',
                    weatherConditions: 'stormy'
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('update');
        });

        it('should accept "environment" alias', async () => {
            const createResult = await handleWorldManage({
                action: 'create',
                name: 'Env Alias World',
                seed: 'env-seed',
                width: 20,
                height: 20
            }, ctx);
            const worldId = parseResult(createResult).worldId;

            const result = await handleWorldManage({
                action: 'environment',
                id: worldId,
                environment: { season: 'winter' }
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('update');
        });
    });

    describe('generate action', () => {
        it('should generate a procedural world', async () => {
            const result = await handleWorldManage({
                action: 'generate',
                seed: 'gen-test',
                width: 30,
                height: 30
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('generate');
            expect(data.worldId).toBeDefined();
            expect(data.tileCount).toBeGreaterThan(0);
            expect(data.regionCount).toBeGreaterThan(0);
        });

        it('should persist generated regions and structures with stable string IDs', async () => {
            const result = await handleWorldManage({
                action: 'generate',
                seed: 'entity-persistence-test',
                width: 50,
                height: 50
            }, ctx);

            const data = parseResult(result);
            const generated = getWorldManager().get(data.worldId);
            const db = getDb();
            const regions = new RegionRepository(db).findByWorldId(data.worldId);
            const structures = new StructureRepository(db).findByWorldId(data.worldId);

            expect(generated).toBeDefined();
            expect(regions).toHaveLength(generated!.regions.length);
            expect(structures).toHaveLength(generated!.structures.length);
            expect(regions.every(region => region.id.startsWith(`${data.worldId}:region:`))).toBe(true);
            expect(structures.every(structure => structure.id.startsWith(`${data.worldId}:structure:`))).toBe(true);
            expect(structures.every(structure => !structure.regionId || structure.regionId.startsWith(`${data.worldId}:region:`))).toBe(true);
        });

        it('should accept "gen" alias', async () => {
            const result = await handleWorldManage({
                action: 'gen',
                seed: 'alias-gen',
                width: 20,
                height: 20
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('generate');
        });

        it('should support landRatio option', async () => {
            const result = await handleWorldManage({
                action: 'generate',
                seed: 'land-ratio-test',
                width: 30,
                height: 30,
                landRatio: 0.7
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('get_state action', () => {
        it('should get world state', async () => {
            const genResult = await handleWorldManage({
                action: 'generate',
                seed: 'state-test',
                width: 20,
                height: 20
            }, ctx);
            const worldId = parseResult(genResult).worldId;

            const result = await handleWorldManage({
                action: 'get_state',
                worldId: worldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_state');
            expect(data.inMemory).toBe(true);
            expect(data.inDatabase).toBe(true);
        });

        it('should accept "state" alias', async () => {
            const genResult = await handleWorldManage({
                action: 'generate',
                seed: 'state-alias',
                width: 20,
                height: 20
            }, ctx);
            const worldId = parseResult(genResult).worldId;

            const result = await handleWorldManage({
                action: 'state',
                worldId: worldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_state');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleWorldManage({
                action: 'creat',  // Missing 'e'
                name: 'Fuzzy World',
                seed: 'fuzzy',
                width: 20,
                height: 20
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('create');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleWorldManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting', async () => {
            const result = await handleWorldManage({
                action: 'create',
                name: 'Format Test',
                seed: 'format',
                width: 20,
                height: 20
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('🌍');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleWorldManage({
                action: 'list'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- WORLD_MANAGE_JSON');
        });
    });
});
