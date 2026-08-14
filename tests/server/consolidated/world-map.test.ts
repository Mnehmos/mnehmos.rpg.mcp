/**
 * Tests for consolidated world_map tool
 * Validates all 7 actions: overview, region, tiles, patch, preview, find_poi, suggest_poi
 */

import { handleWorldMap, WorldMapTool } from '../../../src/server/consolidated/world-map.js';
import { handleWorldManage } from '../../../src/server/consolidated/world-manage.js';
import { getWorldManager } from '../../../src/server/state/world-manager.js';
import { BiomeType } from '../../../src/schema/biome.js';
import { getDb } from '../../../src/storage/index.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- WORLD_MAP_JSON\n([\s\S]*?)\nWORLD_MAP_JSON -->/);
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

function parseWorldResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- WORLD_MANAGE_JSON\n([\s\S]*?)\nWORLD_MANAGE_JSON -->/);
    return jsonMatch ? JSON.parse(jsonMatch[1]) : null;
}

describe('world_map consolidated tool', () => {
    let ctx: { sessionId: string };
    let testWorldId: string;

    beforeEach(async () => {
        ctx = { sessionId: `test-session-${randomUUID()}` };
        const db = getDb(':memory:');
        db.exec('DELETE FROM worlds');

        // Generate a test world
        const genResult = await handleWorldManage({
            action: 'generate',
            seed: 'map-test',
            width: 30,
            height: 30
        }, ctx);
        testWorldId = parseWorldResult(genResult).worldId;
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(WorldMapTool.name).toBe('world_map');
        });

        it('should list all available actions in description', () => {
            expect(WorldMapTool.description).toContain('overview');
            expect(WorldMapTool.description).toContain('region');
            expect(WorldMapTool.description).toContain('tiles');
            expect(WorldMapTool.description).toContain('patch');
            expect(WorldMapTool.description).toContain('preview');
            expect(WorldMapTool.description).toContain('find_poi');
            expect(WorldMapTool.description).toContain('suggest_poi');
        });
    });

    describe('overview action', () => {
        it('should get world map overview', async () => {
            const result = await handleWorldMap({
                action: 'overview',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('overview');
            expect(data.dimensions).toBeDefined();
        });

        it('should accept "summary" alias', async () => {
            const result = await handleWorldMap({
                action: 'summary',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('overview');
        });

        it('should restore the generated snapshot after runtime cache eviction', async () => {
            const before = parseResult(await handleWorldMap({
                action: 'overview',
                worldId: testWorldId
            }, ctx));

            expect(getWorldManager().delete(testWorldId)).toBe(true);

            const after = parseResult(await handleWorldMap({
                action: 'overview',
                worldId: testWorldId
            }, ctx));

            expect(after.success).toBe(true);
            expect(after.dimensions).toEqual(before.dimensions);
            expect(after.biomeDistribution).toEqual(before.biomeDistribution);
            expect(after.regionCount).toBe(before.regionCount);
            expect(after.structureCount).toBe(before.structureCount);
            expect(after.riverTileCount).toBe(before.riverTileCount);
        });
    });

    describe('region action', () => {
        it('should get region map', async () => {
            const result = await handleWorldMap({
                action: 'region',
                worldId: testWorldId,
                regionId: 0
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('region');
        });

        it('should accept "get_region" alias', async () => {
            const result = await handleWorldMap({
                action: 'get_region',
                worldId: testWorldId,
                regionId: 0
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('region');
        });
    });

    describe('tiles action', () => {
        it('should get world tiles', async () => {
            const result = await handleWorldMap({
                action: 'tiles',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('tiles');
            expect(data.width).toBe(30);
            expect(data.height).toBe(30);
        });

        it('should accept "grid" alias', async () => {
            const result = await handleWorldMap({
                action: 'grid',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('tiles');
        });
    });

    describe('preview action', () => {
        it('should preview a patch without applying', async () => {
            const result = await handleWorldMap({
                action: 'preview',
                worldId: testWorldId,
                script: 'ADD_STRUCTURE city 15 15 "Test City"'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('preview');
            expect(data.valid).toBeDefined();
        });

        it('should accept "dry_run" alias', async () => {
            const result = await handleWorldMap({
                action: 'dry_run',
                worldId: testWorldId,
                script: 'ADD_STRUCTURE town 10 10 "Test Town"'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('preview');
        });
    });

    describe('patch action', () => {
        it('should apply a map patch', async () => {
            const result = await handleWorldMap({
                action: 'patch',
                worldId: testWorldId,
                script: 'ADD_STRUCTURE city 15 15 "Patch City"'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('patch');
            // success depends on terrain validity at coords - just verify response format
            expect(typeof data.success).toBe('boolean');
        });

        it('should report invalid DSL patches as failures', async () => {
            const data = parseResult(await handleWorldMap({
                action: 'patch',
                worldId: testWorldId,
                script: 'THIS IS NOT VALID MAP DSL'
            }, ctx));

            expect(data.success).toBe(false);
        });

        it('should accept "apply" alias', async () => {
            const result = await handleWorldMap({
                action: 'apply',
                worldId: testWorldId,
                script: 'ADD_STRUCTURE town 10 10 "Apply Town"'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('patch');
        });

        it('should restore an applied map patch after runtime cache eviction', async () => {
            const generated = getWorldManager().get(testWorldId)!;
            const replacement = generated.biomes[0][0] === BiomeType.OCEAN
                ? BiomeType.GRASSLAND
                : BiomeType.OCEAN;

            const patchResult = parseResult(await handleWorldMap({
                action: 'patch',
                worldId: testWorldId,
                script: `SET_BIOME ${replacement} 0 0`
            }, ctx));
            expect(patchResult.success).toBe(true);
            expect(patchResult.commandsExecuted).toBe(1);

            expect(getWorldManager().delete(testWorldId)).toBe(true);

            const restoredTiles = parseResult(await handleWorldMap({
                action: 'tiles',
                worldId: testWorldId
            }, ctx));
            expect(restoredTiles.success).toBe(true);
            expect(restoredTiles.biomes[restoredTiles.tiles[0][0]]).toBe(replacement);
        });
    });

    describe('find_poi action', () => {
        it('should find valid POI locations', async () => {
            const result = await handleWorldMap({
                action: 'find_poi',
                worldId: testWorldId,
                poiType: 'city',
                count: 3
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('find_poi');
        });

        it('should accept "locate" alias', async () => {
            const result = await handleWorldMap({
                action: 'locate',
                worldId: testWorldId,
                poiType: 'town'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('find_poi');
        });
    });

    describe('suggest_poi action', () => {
        it('should suggest POI locations in batch', async () => {
            const result = await handleWorldMap({
                action: 'suggest_poi',
                worldId: testWorldId,
                requests: [
                    { poiType: 'city', count: 1 },
                    { poiType: 'town', count: 2 }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('suggest_poi');
        });

        it('should accept "batch_poi" alias', async () => {
            const result = await handleWorldMap({
                action: 'batch_poi',
                worldId: testWorldId,
                requests: [
                    { poiType: 'village', count: 1 }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('suggest_poi');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleWorldMap({
                action: 'overvew',  // Typo for 'overview'
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('overview');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleWorldMap({
                action: 'xyz',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting', async () => {
            const result = await handleWorldMap({
                action: 'overview',
                worldId: testWorldId
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('🗺️');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleWorldMap({
                action: 'tiles',
                worldId: testWorldId
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- WORLD_MAP_JSON');
        });
    });
});
