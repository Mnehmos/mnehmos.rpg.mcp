/**
 * Tests for consolidated strategy_manage tool
 * Validates all 6 actions: create_nation, get_state, propose_alliance, claim_region, resolve_turn, list_nations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleStrategyManage, StrategyManageTool } from '../../../src/server/consolidated/strategy-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { WorldRepository } from '../../../src/storage/repos/world.repo.js';
import { RegionRepository } from '../../../src/storage/repos/region.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- STRATEGY_MANAGE_JSON\n([\s\S]*?)\nSTRATEGY_MANAGE_JSON -->/);
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

describe('strategy_manage consolidated tool', () => {
    let testWorldId: string;
    let testNationId: string;
    let testRegionId: string;
    const ctx = { sessionId: 'test-session' };

    beforeEach(async () => {
        closeDb();
        const db = getDb(':memory:');
        const now = new Date().toISOString();

        // Create a test world
        const worldRepo = new WorldRepository(db);
        testWorldId = randomUUID();
        worldRepo.create({
            id: testWorldId,
            name: 'Test Strategy World',
            seed: '12345',
            width: 100,
            height: 100,
            tileData: '{}',
            createdAt: now,
            updatedAt: now
        });

        // Create a test region
        const regionRepo = new RegionRepository(db);
        testRegionId = randomUUID();
        regionRepo.create({
            id: testRegionId,
            worldId: testWorldId,
            name: 'Central Plains',
            type: 'plains',
            centerX: 50,
            centerY: 50,
            color: '#90EE90',
            createdAt: now,
            updatedAt: now
        });

        // Create a test nation
        const createResult = await handleStrategyManage({
            action: 'create_nation',
            worldId: testWorldId,
            name: 'Test Empire',
            leader: 'Emperor Test',
            ideology: 'autocracy',
            aggression: 60,
            trust: 40,
            paranoia: 70
        }, ctx);
        testNationId = parseResult(createResult).nationId;
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(StrategyManageTool.name).toBe('strategy_manage');
        });

        it('should list all available actions in description', () => {
            expect(StrategyManageTool.description).toContain('create_nation');
            expect(StrategyManageTool.description).toContain('get_state');
            expect(StrategyManageTool.description).toContain('propose_alliance');
            expect(StrategyManageTool.description).toContain('claim_region');
            expect(StrategyManageTool.description).toContain('resolve_turn');
            expect(StrategyManageTool.description).toContain('list_nations');
        });
    });

    describe('create_nation action', () => {
        it('should create a new nation', async () => {
            const result = await handleStrategyManage({
                action: 'create_nation',
                worldId: testWorldId,
                name: 'Democratic Republic',
                leader: 'President Smith',
                ideology: 'democracy',
                aggression: 30,
                trust: 70,
                paranoia: 20
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('create_nation');
            expect(data.name).toBe('Democratic Republic');
            expect(data.leader).toBe('President Smith');
            expect(data.ideology).toBe('democracy');
            expect(data.nationId).toBeDefined();
        });

        it('should use default resources', async () => {
            const result = await handleStrategyManage({
                action: 'create_nation',
                worldId: testWorldId,
                name: 'Resource Nation',
                leader: 'Leader',
                ideology: 'tribal'
            }, ctx);

            const data = parseResult(result);
            expect(data.resources).toBeDefined();
            expect(data.resources.food).toBe(100);
            expect(data.resources.metal).toBe(50);
            expect(data.resources.oil).toBe(10);
        });

        it('should use custom starting resources', async () => {
            const result = await handleStrategyManage({
                action: 'create_nation',
                worldId: testWorldId,
                name: 'Rich Nation',
                leader: 'King Rich',
                ideology: 'autocracy',
                startingResources: {
                    food: 500,
                    metal: 200,
                    oil: 100
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.resources.food).toBe(500);
            expect(data.resources.metal).toBe(200);
            expect(data.resources.oil).toBe(100);
        });

        it('should accept "new_nation" alias', async () => {
            const result = await handleStrategyManage({
                action: 'new_nation',
                worldId: testWorldId,
                name: 'Alias Nation',
                leader: 'Alias Leader',
                ideology: 'theocracy'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('create_nation');
        });
    });

    describe('get_state action', () => {
        it('should get public state', async () => {
            const result = await handleStrategyManage({
                action: 'get_state',
                nationId: testNationId,
                viewType: 'public'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_state');
            expect(data.viewType).toBe('public');
            expect(data.nation.name).toBe('Test Empire');
            expect(data.nation.privateMemory).toBeUndefined(); // Should not expose private data
        });

        it('should get private state', async () => {
            const result = await handleStrategyManage({
                action: 'get_state',
                nationId: testNationId,
                viewType: 'private'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.viewType).toBe('private');
            expect(data.nation).toBeDefined();
        });

        it('should get fog of war state', async () => {
            const result = await handleStrategyManage({
                action: 'get_state',
                worldId: testWorldId,
                nationId: testNationId,
                viewType: 'fog_of_war'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.viewType).toBe('fog_of_war');
            expect(data.worldState).toBeDefined();
        });

        it('should return error for non-existent nation', async () => {
            const result = await handleStrategyManage({
                action: 'get_state',
                nationId: 'non-existent',
                viewType: 'public'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "nation_state" alias', async () => {
            const result = await handleStrategyManage({
                action: 'nation_state',
                nationId: testNationId,
                viewType: 'public'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_state');
        });
    });

    describe('propose_alliance action', () => {
        let secondNationId: string;

        beforeEach(async () => {
            const result = await handleStrategyManage({
                action: 'create_nation',
                worldId: testWorldId,
                name: 'Second Nation',
                leader: 'Second Leader',
                ideology: 'democracy',
                trust: 80
            }, ctx);
            secondNationId = parseResult(result).nationId;
        });

        it('should propose alliance between nations', async () => {
            const result = await handleStrategyManage({
                action: 'propose_alliance',
                fromNationId: testNationId,
                toNationId: secondNationId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('propose_alliance');
            expect(data.fromNation).toBe('Test Empire');
            expect(data.toNation).toBe('Second Nation');
        });

        it('should return error for non-existent nation', async () => {
            const result = await handleStrategyManage({
                action: 'propose_alliance',
                fromNationId: testNationId,
                toNationId: 'non-existent'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "alliance" alias', async () => {
            const result = await handleStrategyManage({
                action: 'alliance',
                fromNationId: testNationId,
                toNationId: secondNationId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('propose_alliance');
        });
    });

    describe('claim_region action', () => {
        it('should claim a region', async () => {
            const result = await handleStrategyManage({
                action: 'claim_region',
                nationId: testNationId,
                regionId: testRegionId,
                justification: 'Historical claim'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('claim_region');
            expect(data.nation).toBe('Test Empire');
            expect(data.region).toBe('Central Plains');
            expect(data.justification).toBe('Historical claim');
        });

        it('should return error for non-existent nation', async () => {
            const result = await handleStrategyManage({
                action: 'claim_region',
                nationId: 'non-existent',
                regionId: testRegionId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should return error for non-existent region', async () => {
            const result = await handleStrategyManage({
                action: 'claim_region',
                nationId: testNationId,
                regionId: 'non-existent'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "claim" alias', async () => {
            const result = await handleStrategyManage({
                action: 'claim',
                nationId: testNationId,
                regionId: testRegionId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('claim_region');
        });
    });

    describe('resolve_turn action', () => {
        it('should resolve a turn', async () => {
            const result = await handleStrategyManage({
                action: 'resolve_turn',
                worldId: testWorldId,
                turnNumber: 1
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('resolve_turn');
            expect(data.worldId).toBe(testWorldId);
            expect(data.turnNumber).toBe(1);
            expect(data.status).toBe('Turn Resolved');
        });

        it('should accept "process_turn" alias', async () => {
            const result = await handleStrategyManage({
                action: 'process_turn',
                worldId: testWorldId,
                turnNumber: 2
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('resolve_turn');
        });
    });

    describe('list_nations action', () => {
        it('should list all nations in a world', async () => {
            // Create another nation
            await handleStrategyManage({
                action: 'create_nation',
                worldId: testWorldId,
                name: 'Third Nation',
                leader: 'Third Leader',
                ideology: 'tribal'
            }, ctx);

            const result = await handleStrategyManage({
                action: 'list_nations',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('list_nations');
            expect(data.count).toBeGreaterThanOrEqual(2);
            expect(data.nations.length).toBeGreaterThanOrEqual(2);
        });

        it('should return empty list for world without nations', async () => {
            // Create a new world with no nations
            const db = getDb(':memory:');
            const worldRepo = new WorldRepository(db);
            const emptyWorldId = randomUUID();
            worldRepo.create({
                id: emptyWorldId,
                name: 'Empty World',
                seed: '99999',
                width: 50,
                height: 50,
                tileData: '{}',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            const result = await handleStrategyManage({
                action: 'list_nations',
                worldId: emptyWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.count).toBe(0);
        });

        it('should accept "nations" alias', async () => {
            const result = await handleStrategyManage({
                action: 'nations',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('list_nations');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleStrategyManage({
                action: 'creat_nation',  // Missing 'e'
                worldId: testWorldId,
                name: 'Typo Nation',
                leader: 'Typo Leader',
                ideology: 'democracy'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('create_nation');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleStrategyManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting', async () => {
            const result = await handleStrategyManage({
                action: 'list_nations',
                worldId: testWorldId
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('NATIONS LIST');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleStrategyManage({
                action: 'list_nations',
                worldId: testWorldId
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- STRATEGY_MANAGE_JSON');
        });
    });
});
