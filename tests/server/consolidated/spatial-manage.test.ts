/**
 * Tests for consolidated spatial_manage tool
 * Validates all 5 actions: look, generate, get_exits, move, list
 */

import { handleSpatialManage, SpatialManageTool } from '../../../src/server/consolidated/spatial-manage.js';
import { getDb } from '../../../src/storage/index.js';
import { SpatialRepository } from '../../../src/storage/repos/spatial.repo.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- SPATIAL_MANAGE_JSON\n([\s\S]*?)\nSPATIAL_MANAGE_JSON -->/);
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

describe('spatial_manage consolidated tool', () => {
    let ctx: { sessionId: string };
    let testRoomId: string;
    let testCharacterId: string;

    beforeEach(async () => {
        ctx = { sessionId: `test-session-${randomUUID()}` };
        const db = getDb(':memory:');
        db.exec('DELETE FROM room_nodes');
        db.exec('DELETE FROM characters');

        // Create a test room
        const spatialRepo = new SpatialRepository(db);
        testRoomId = randomUUID();
        spatialRepo.create({
            id: testRoomId,
            name: 'Test Room',
            baseDescription: 'A test room for spatial testing.',
            biomeContext: 'urban',
            atmospherics: [],
            exits: [],
            entityIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            visitedCount: 0
        });

        // Create a test character
        const characterRepo = new CharacterRepository(db);
        testCharacterId = randomUUID();
        characterRepo.create({
            id: testCharacterId,
            name: 'Test Character',
            level: 1,
            hp: 20,
            maxHp: 20,
            ac: 12,
            stats: {
                str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10
            },
            inventory: [],
            currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        } as any);
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(SpatialManageTool.name).toBe('spatial_manage');
        });

        it('should list all available actions in description', () => {
            expect(SpatialManageTool.description).toContain('look');
            expect(SpatialManageTool.description).toContain('generate');
            expect(SpatialManageTool.description).toContain('get_exits');
            expect(SpatialManageTool.description).toContain('move');
            expect(SpatialManageTool.description).toContain('list');
        });
    });

    describe('generate action', () => {
        it('should generate a new room', async () => {
            const result = await handleSpatialManage({
                action: 'generate',
                name: 'New Room',
                baseDescription: 'A newly generated room for testing purposes.',
                biomeContext: 'dungeon',
                atmospherics: ['DARKNESS']
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('generate');
            expect(data.roomId).toBeDefined();
            expect(data.name).toBe('New Room');
        });

        it('should accept "create" alias', async () => {
            const result = await handleSpatialManage({
                action: 'create',
                name: 'Alias Room',
                baseDescription: 'A room created via alias.',
                biomeContext: 'forest'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('generate');
        });

        it('should link to previous room when specified', async () => {
            const result = await handleSpatialManage({
                action: 'generate',
                name: 'Linked Room',
                baseDescription: 'A room linked to the test room.',
                biomeContext: 'urban',
                previousNodeId: testRoomId,
                direction: 'north'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.linkedToPrevious).toBe(true);
        });

        it('should not report linkedToPrevious when previous room does not exist', async () => {
            const result = await handleSpatialManage({
                action: 'generate',
                name: 'Unlinked Room',
                baseDescription: 'A room whose requested previous room does not exist.',
                biomeContext: 'urban',
                previousNodeId: randomUUID(),
                direction: 'north'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.linkedToPrevious).toBe(false);
        });

        it('should create a room with network coordinates', async () => {
            const network = await handleSpatialManage({
                action: 'network_create',
                name: 'Test Network',
                networkType: 'cluster',
                worldId: 'world-1',
                centerX: 10,
                centerY: 20
            }, ctx);
            const networkData = parseResult(network);

            const result = await handleSpatialManage({
                action: 'generate',
                name: 'Mapped Room',
                baseDescription: 'A room with committed local coordinates.',
                biomeContext: 'urban',
                networkId: networkData.networkId,
                localX: 2,
                localY: 3
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.networkId).toBe(networkData.networkId);
            expect(data.localX).toBe(2);
            expect(data.localY).toBe(3);
        });
    });

    describe('update action', () => {
        it('should update room metadata', async () => {
            const result = await handleSpatialManage({
                action: 'update',
                roomId: testRoomId,
                baseDescription: 'An updated test room description with enough detail.',
                atmospherics: ['FOG'],
                biomeContext: 'dungeon'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('update');
            expect(data.roomId).toBe(testRoomId);
            expect(data.description).toContain('updated test room');
            expect(data.atmospherics).toEqual(['FOG']);
            expect(data.biomeContext).toBe('dungeon');
        });
    });

    describe('network actions', () => {
        it('should create, get, and list node networks', async () => {
            const created = await handleSpatialManage({
                action: 'network_create',
                name: 'Market District',
                networkType: 'cluster',
                worldId: 'world-1',
                centerX: 12,
                centerY: 34,
                boundingBox: { minX: 10, maxX: 14, minY: 32, maxY: 36 }
            }, ctx);
            const createdData = parseResult(created);
            expect(createdData.success).toBe(true);
            expect(createdData.actionType).toBe('network_create');
            expect(createdData.networkId).toBeDefined();

            const got = await handleSpatialManage({
                action: 'network_get',
                networkId: createdData.networkId
            }, ctx);
            const gotData = parseResult(got);
            expect(gotData.success).toBe(true);
            expect(gotData.name).toBe('Market District');
            expect(gotData.boundingBox.maxX).toBe(14);

            const listed = await handleSpatialManage({
                action: 'network_list',
                worldId: 'world-1'
            }, ctx);
            const listedData = parseResult(listed);
            expect(listedData.success).toBe(true);
            expect(listedData.networks.some((n: any) => n.id === createdData.networkId)).toBe(true);
        });
    });

    describe('list action', () => {
        it('should list all rooms', async () => {
            const result = await handleSpatialManage({
                action: 'list'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('list');
            expect(data.count).toBeGreaterThanOrEqual(1);
        });

        it('should accept "rooms" alias', async () => {
            const result = await handleSpatialManage({
                action: 'rooms'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('list');
        });

        it('should filter by biome', async () => {
            // Create rooms with different biomes
            await handleSpatialManage({
                action: 'generate',
                name: 'Forest Room',
                baseDescription: 'A forest room for testing.',
                biomeContext: 'forest'
            }, ctx);

            const result = await handleSpatialManage({
                action: 'list',
                biome: 'forest'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.rooms.every((r: any) => r.biomeContext === 'forest')).toBe(true);
        });
    });

    describe('get_exits action', () => {
        it('should get exits from a room', async () => {
            const result = await handleSpatialManage({
                action: 'get_exits',
                roomId: testRoomId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_exits');
            expect(data.exits).toBeDefined();
        });

        it('should accept "exits" alias', async () => {
            const result = await handleSpatialManage({
                action: 'exits',
                roomId: testRoomId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_exits');
        });

        it('should include travel metadata on exits', async () => {
            const spatialRepo = new SpatialRepository(getDb(':memory:'));
            const targetRoomId = randomUUID();
            spatialRepo.create({
                id: targetRoomId,
                name: 'Target Room',
                baseDescription: 'A target room for travel metadata testing.',
                biomeContext: 'urban',
                atmospherics: [],
                exits: [],
                entityIds: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                visitedCount: 0
            });
            spatialRepo.addExit(testRoomId, {
                direction: 'east',
                targetNodeId: targetRoomId,
                type: 'OPEN',
                travelTime: 5,
                terrain: 'paved',
                difficulty: 12,
                description: 'A paved corridor runs east.'
            });

            const result = await handleSpatialManage({
                action: 'get_exits',
                roomId: testRoomId
            }, ctx);

            const data = parseResult(result);
            const exit = data.exits.find((e: any) => e.direction === 'east');
            expect(exit.travelTime).toBe(5);
            expect(exit.terrain).toBe('paved');
            expect(exit.difficulty).toBe(12);
        });
    });

    describe('move action', () => {
        it('should move character to room', async () => {
            const result = await handleSpatialManage({
                action: 'move',
                characterId: testCharacterId,
                roomId: testRoomId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('move');
            expect(data.newRoomId).toBe(testRoomId);
        });

        it('should accept "enter" alias', async () => {
            const result = await handleSpatialManage({
                action: 'enter',
                characterId: testCharacterId,
                roomId: testRoomId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('move');
        });
    });

    describe('look action', () => {
        it('should require character to be in a room', async () => {
            const result = await handleSpatialManage({
                action: 'look',
                observerId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            // Character not in room yet - should fail
            expect(data.success).toBe(false);
            expect(data.error).toContain('not in any room');
        });

        it('should look at surroundings after moving to room', async () => {
            // Move character to room first
            await handleSpatialManage({
                action: 'move',
                characterId: testCharacterId,
                roomId: testRoomId
            }, ctx);

            const result = await handleSpatialManage({
                action: 'look',
                observerId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('look');
            expect(data.roomName).toBe('Test Room');
        });

        it('should include travel metadata when looking at visible exits', async () => {
            const spatialRepo = new SpatialRepository(getDb(':memory:'));
            const targetRoomId = randomUUID();
            spatialRepo.create({
                id: targetRoomId,
                name: 'Look Target',
                baseDescription: 'A target room for visible travel metadata testing.',
                biomeContext: 'urban',
                atmospherics: [],
                exits: [],
                entityIds: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                visitedCount: 0
            });
            spatialRepo.addExit(testRoomId, {
                direction: 'south',
                targetNodeId: targetRoomId,
                type: 'OPEN',
                travelTime: 1,
                terrain: 'indoor',
                difficulty: 10
            });
            await handleSpatialManage({
                action: 'move',
                characterId: testCharacterId,
                roomId: testRoomId
            }, ctx);

            const result = await handleSpatialManage({
                action: 'look',
                observerId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            const exit = data.exits.find((e: any) => e.direction === 'south');
            expect(exit.travelTime).toBe(1);
            expect(exit.terrain).toBe('indoor');
            expect(exit.difficulty).toBe(10);
        });

        it('should accept "observe" alias', async () => {
            await handleSpatialManage({
                action: 'move',
                characterId: testCharacterId,
                roomId: testRoomId
            }, ctx);

            const result = await handleSpatialManage({
                action: 'observe',
                observerId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('look');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleSpatialManage({
                action: 'genrate',  // Typo for 'generate'
                name: 'Fuzzy Room',
                baseDescription: 'A room created via fuzzy matching.',
                biomeContext: 'cavern'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('generate');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleSpatialManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting', async () => {
            const result = await handleSpatialManage({
                action: 'list'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('🏠');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleSpatialManage({
                action: 'generate',
                name: 'JSON Test Room',
                baseDescription: 'A room to test JSON embedding.',
                biomeContext: 'arcane'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- SPATIAL_MANAGE_JSON');
        });
    });
});
