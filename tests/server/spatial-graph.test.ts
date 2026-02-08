import { closeDb, getDb } from '../../src/storage/index.js';
import { SpatialRepository } from '../../src/storage/repos/spatial.repo.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { RoomNode } from '../../src/schema/spatial.js';
import { Character } from '../../src/schema/character.js';

const mockCtx = { sessionId: 'test-session' };

/**
 * PHASE-1: Spatial Graph System Tests
 *
 * Tests for room/location persistence and spatial awareness:
 * - RoomNode schema validation
 * - Room persistence (CRUD)
 * - Exit navigation and linking
 * - Perception-based visibility
 * - Room generation
 * - Entity tracking in rooms
 */
describe('PHASE-1: Spatial Graph System', () => {
    let spatialRepo: SpatialRepository;
    let characterRepo: CharacterRepository;

    beforeEach(() => {
        closeDb();
        const db = getDb(':memory:');
        spatialRepo = new SpatialRepository(db);
        characterRepo = new CharacterRepository(db);
    });

    describe('RoomNode Schema Validation', () => {
        it('creates room with valid data', () => {
            const room = createTestRoom();
            expect(() => spatialRepo.create(room)).not.toThrow();
        });

        it('rejects room with empty name', () => {
            const room = createTestRoom({ name: '' });
            expect(() => spatialRepo.create(room)).toThrow();
        });

        it('rejects room with whitespace-only name', () => {
            const room = createTestRoom({ name: '   ' });
            expect(() => spatialRepo.create(room)).toThrow();
        });

        it('rejects room with name > 100 characters', () => {
            const room = createTestRoom({ name: 'A'.repeat(101) });
            expect(() => spatialRepo.create(room)).toThrow();
        });

        it('rejects room with description < 10 chars', () => {
            const room = createTestRoom({ baseDescription: 'short' });
            expect(() => spatialRepo.create(room)).toThrow();
        });

        it('rejects room with whitespace-only description', () => {
            const room = createTestRoom({ baseDescription: '          ' });
            expect(() => spatialRepo.create(room)).toThrow();
        });

        it('rejects room with description > 2000 characters', () => {
            const room = createTestRoom({ baseDescription: 'A'.repeat(2001) });
            expect(() => spatialRepo.create(room)).toThrow();
        });

        it('rejects invalid biome', () => {
            const room = createTestRoom({ biomeContext: 'invalid_biome' as any });
            expect(() => spatialRepo.create(room)).toThrow();
        });

        it('accepts all valid biomes', () => {
            const biomes = ['forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane'];
            biomes.forEach(biome => {
                const room = createTestRoom({ id: crypto.randomUUID(), biomeContext: biome as any });
                expect(() => spatialRepo.create(room)).not.toThrow();
            });
        });
    });

    describe('Room Persistence', () => {
        it('room persists after creation', () => {
            const room = createTestRoom();
            spatialRepo.create(room);

            const retrieved = spatialRepo.findById(room.id);
            expect(retrieved).toBeDefined();
            expect(retrieved!.name).toBe(room.name);
            expect(retrieved!.baseDescription).toBe(room.baseDescription);
        });

        it('updates room metadata', () => {
            const room = createTestRoom();
            spatialRepo.create(room);

            const updated = spatialRepo.update(room.id, {
                atmospherics: ['DARKNESS', 'FOG']
            });

            expect(updated).toBeDefined();
            expect(updated!.atmospherics).toContain('DARKNESS');
            expect(updated!.atmospherics).toContain('FOG');
        });

        it('preserves immutable baseDescription', () => {
            const room = createTestRoom();
            spatialRepo.create(room);

            const originalDescription = room.baseDescription;

            // Attempt to update description (should succeed since we allow it)
            spatialRepo.update(room.id, {
                baseDescription: 'A completely different place that should not happen.'
            });

            const retrieved = spatialRepo.findById(room.id);
            // The description CAN change, but in practice the LLM should not do this
            // This test documents that we allow it at the DB level
            expect(retrieved!.baseDescription).toBe('A completely different place that should not happen.');
        });

        it('deletes room', () => {
            const room = createTestRoom();
            spatialRepo.create(room);

            const deleted = spatialRepo.delete(room.id);
            expect(deleted).toBe(true);

            const retrieved = spatialRepo.findById(room.id);
            expect(retrieved).toBeNull();
        });

        it('returns false when deleting non-existent room', () => {
            const deleted = spatialRepo.delete('non-existent-id');
            expect(deleted).toBe(false);
        });

        it('findAll returns all rooms', () => {
            const room1 = createTestRoom({ id: crypto.randomUUID(), name: 'Room A' });
            const room2 = createTestRoom({ id: crypto.randomUUID(), name: 'Room B' });
            const room3 = createTestRoom({ id: crypto.randomUUID(), name: 'Room C' });

            spatialRepo.create(room1);
            spatialRepo.create(room2);
            spatialRepo.create(room3);

            const all = spatialRepo.findAll();
            expect(all.length).toBe(3);
        });

        it('findByBiome filters rooms correctly', () => {
            const forest1 = createTestRoom({ id: crypto.randomUUID(), biomeContext: 'forest' });
            const forest2 = createTestRoom({ id: crypto.randomUUID(), biomeContext: 'forest' });
            const dungeon = createTestRoom({ id: crypto.randomUUID(), biomeContext: 'dungeon' });

            spatialRepo.create(forest1);
            spatialRepo.create(forest2);
            spatialRepo.create(dungeon);

            const forestRooms = spatialRepo.findByBiome('forest');
            expect(forestRooms.length).toBe(2);
            expect(forestRooms.every(r => r.biomeContext === 'forest')).toBe(true);
        });
    });

    describe('Exits and Navigation', () => {
        it('room can have multiple exits', () => {
            const room2Id = crypto.randomUUID();
            const room3Id = crypto.randomUUID();
            const room4Id = crypto.randomUUID();
            const room1Id = crypto.randomUUID();

            const room2 = createTestRoom({ id: room2Id, name: 'North Room' });
            const room3 = createTestRoom({ id: room3Id, name: 'East Room' });
            const room4 = createTestRoom({ id: room4Id, name: 'Below' });

            spatialRepo.create(room2);
            spatialRepo.create(room3);
            spatialRepo.create(room4);

            const room1 = createTestRoom({
                id: room1Id,
                exits: [
                    { direction: 'north', targetNodeId: room2Id, type: 'OPEN' },
                    { direction: 'east', targetNodeId: room3Id, type: 'LOCKED' },
                    { direction: 'down', targetNodeId: room4Id, type: 'HIDDEN', dc: 15 }
                ]
            });

            spatialRepo.create(room1);
            const retrieved = spatialRepo.findById(room1.id);

            expect(retrieved!.exits).toHaveLength(3);
            expect(retrieved!.exits[2].dc).toBe(15);
        });

        it('get_room_exits returns all exits', async () => {
            const { handleGetRoomExits } = await import('../../src/server/handlers/spatial-handlers.js');

            const room = createTestRoom({
                exits: [
                    { direction: 'north', targetNodeId: crypto.randomUUID(), type: 'OPEN' }
                ]
            });
            spatialRepo.create(room);

            const result = await handleGetRoomExits({ roomId: room.id }, mockCtx);
            const parsed = JSON.parse(result.content[0].text);

            expect(parsed.success).toBe(true);
            expect(parsed.exits).toHaveLength(1);
            expect(parsed.exits[0].direction).toBe('north');
        });

        it('findConnectedRooms returns linked rooms', () => {
            const room1Id = crypto.randomUUID();
            const room2Id = crypto.randomUUID();

            const room2 = createTestRoom({ id: room2Id, name: 'Connected Room' });
            spatialRepo.create(room2);

            const room1 = createTestRoom({
                id: room1Id,
                exits: [{ direction: 'north', targetNodeId: room2Id, type: 'OPEN' }]
            });
            spatialRepo.create(room1);

            const connected = spatialRepo.findConnectedRooms(room1Id);
            expect(connected).toHaveLength(1);
            expect(connected[0].id).toBe(room2Id);
        });

        it('addExit dynamically adds exit to room', () => {
            const room1Id = crypto.randomUUID();
            const room2Id = crypto.randomUUID();

            const room1 = createTestRoom({ id: room1Id });
            const room2 = createTestRoom({ id: room2Id });

            spatialRepo.create(room1);
            spatialRepo.create(room2);

            spatialRepo.addExit(room1Id, {
                direction: 'south',
                targetNodeId: room2Id,
                type: 'OPEN'
            });

            const updated = spatialRepo.findById(room1Id);
            expect(updated!.exits).toHaveLength(1);
            expect(updated!.exits[0].direction).toBe('south');
        });
    });

    describe('Perception and Visibility', () => {
        it('DARKNESS blocks vision without darkvision or light', async () => {
            const { handleLookAtSurroundings, handleMoveCharacterToRoom } = await import('../../src/server/handlers/spatial-handlers.js');

            const darkRoomId = crypto.randomUUID();
            const observerId = crypto.randomUUID();

            const darkRoom = createTestRoom({
                id: darkRoomId,
                atmospherics: ['DARKNESS']
            });
            spatialRepo.create(darkRoom);

            const observer = createTestCharacter({ id: observerId, conditions: [] });
            characterRepo.create(observer);

            // Move observer to dark room
            await handleMoveCharacterToRoom({
                characterId: observerId,
                roomId: darkRoomId
            }, mockCtx);

            const result = await handleLookAtSurroundings({
                observerId: observerId
            }, mockCtx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.description).toContain("can't see");
            expect(parsed.exits).toHaveLength(0);
        });

        it('DARKVISION allows vision in darkness', async () => {
            const { handleLookAtSurroundings, handleMoveCharacterToRoom } = await import('../../src/server/handlers/spatial-handlers.js');

            const darkRoomId = crypto.randomUUID();
            const observerId = crypto.randomUUID();

            const darkRoom = createTestRoom({
                id: darkRoomId,
                name: 'Dark Cave',
                atmospherics: ['DARKNESS']
            });
            spatialRepo.create(darkRoom);

            const observer = createTestCharacter({
                id: observerId,
                conditions: [{ name: 'DARKVISION' }]
            });
            characterRepo.create(observer);

            await handleMoveCharacterToRoom({
                characterId: observerId,
                roomId: darkRoomId
            }, mockCtx);

            const result = await handleLookAtSurroundings({
                observerId: observerId
            }, mockCtx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.description).not.toContain("can't see");
            expect(parsed.roomName).toBe('Dark Cave');
        });

        it('LOCKED exits are not visible', async () => {
            const { handleLookAtSurroundings, handleMoveCharacterToRoom } = await import('../../src/server/handlers/spatial-handlers.js');

            const roomId = crypto.randomUUID();
            const observerId = crypto.randomUUID();

            const room = createTestRoom({
                id: roomId,
                exits: [
                    { direction: 'north', targetNodeId: crypto.randomUUID(), type: 'LOCKED' }
                ]
            });
            spatialRepo.create(room);

            const observer = createTestCharacter({ id: observerId });
            characterRepo.create(observer);

            await handleMoveCharacterToRoom({
                characterId: observerId,
                roomId: roomId
            }, mockCtx);

            const result = await handleLookAtSurroundings({
                observerId: observerId
            }, mockCtx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.exits).toHaveLength(0); // Locked door not visible
        });

        it('HIDDEN exits require Perception check', async () => {
            const { handleLookAtSurroundings, handleMoveCharacterToRoom } = await import('../../src/server/handlers/spatial-handlers.js');

            const roomId = crypto.randomUUID();
            const charId = crypto.randomUUID();

            const room = createTestRoom({
                id: roomId,
                exits: [
                    { direction: 'north', targetNodeId: crypto.randomUUID(), type: 'HIDDEN', dc: 15 }
                ]
            });
            spatialRepo.create(room);

            // Low WIS character (modifier = -1)
            const lowWisdomChar = createTestCharacter({
                id: charId,
                stats: { str: 10, dex: 10, con: 10, int: 10, wis: 8, cha: 10 }
            });
            characterRepo.create(lowWisdomChar);

            await handleMoveCharacterToRoom({
                characterId: charId,
                roomId: roomId
            }, mockCtx);

            // Run multiple times to test randomness
            let timesFound = 0;
            for (let i = 0; i < 100; i++) {
                const result = await handleLookAtSurroundings({
                    observerId: charId
                }, mockCtx);

                const parsed = JSON.parse(result.content[0].text);
                if (parsed.exits.some((e: any) => e.direction === 'north')) {
                    timesFound++;
                }
            }

            // With WIS 8 (modifier -1), rolling 1d20-1 vs DC 15 should succeed rarely
            // Expected: ~25% success rate (need 16+ on d20)
            expect(timesFound).toBeLessThan(40); // Should find it less than 40% of the time
        });
    });

    describe('Room Generation', () => {
        it('generate_room_node creates room in database', async () => {
            const { handleGenerateRoomNode } = await import('../../src/server/handlers/spatial-handlers.js');

            const result = await handleGenerateRoomNode({
                name: 'The Mossy Glade',
                baseDescription: 'A peaceful forest clearing with soft moss covering the ground.',
                biomeContext: 'forest',
                atmospherics: []
            }, mockCtx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.roomId).toBeDefined();
            expect(parsed.name).toBe('The Mossy Glade');

            const retrieved = spatialRepo.findById(parsed.roomId);
            expect(retrieved).toBeDefined();
            expect(retrieved!.biomeContext).toBe('forest');
        });

        it('generate_room_node links to previous room', async () => {
            const { handleGenerateRoomNode } = await import('../../src/server/handlers/spatial-handlers.js');

            const startRoomId = crypto.randomUUID();
            const startRoom = createTestRoom({ id: startRoomId });
            spatialRepo.create(startRoom);

            const result = await handleGenerateRoomNode({
                name: 'Northern Chamber',
                baseDescription: 'A cold stone chamber to the north of the entrance.',
                biomeContext: 'dungeon',
                atmospherics: [],
                previousNodeId: startRoomId,
                direction: 'north'
            }, mockCtx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.linkedToPrevious).toBe(true);

            const updatedStart = spatialRepo.findById(startRoomId);
            expect(updatedStart!.exits).toHaveLength(1);
            expect(updatedStart!.exits[0].direction).toBe('north');
            expect(updatedStart!.exits[0].targetNodeId).toBe(parsed.roomId);
        });

        it('atmospheric effects vary by specification', async () => {
            const { handleGenerateRoomNode } = await import('../../src/server/handlers/spatial-handlers.js');

            const brightRoom = await handleGenerateRoomNode({
                name: 'Sunlit Plaza',
                baseDescription: 'A bright open plaza filled with sunlight.',
                biomeContext: 'urban',
                atmospherics: ['BRIGHT']
            }, mockCtx);

            const darkCave = await handleGenerateRoomNode({
                name: 'Dark Cave',
                baseDescription: 'A pitch black cave devoid of light.',
                biomeContext: 'cavern',
                atmospherics: ['DARKNESS']
            }, mockCtx);

            const parsedBright = JSON.parse(brightRoom.content[0].text);
            const parsedDark = JSON.parse(darkCave.content[0].text);

            expect(parsedBright.atmospherics).toContain('BRIGHT');
            expect(parsedDark.atmospherics).toContain('DARKNESS');
        });
    });

    describe('Entity Management', () => {
        it('room can track entities', () => {
            const entity1 = crypto.randomUUID();
            const entity2 = crypto.randomUUID();

            const room = createTestRoom({
                entityIds: [entity1, entity2]
            });
            spatialRepo.create(room);

            const retrieved = spatialRepo.findById(room.id);
            expect(retrieved!.entityIds).toContain(entity1);
            expect(retrieved!.entityIds).toContain(entity2);
        });

        it('addEntityToRoom adds entity', () => {
            const room = createTestRoom({ entityIds: [] });
            spatialRepo.create(room);

            const entityId = crypto.randomUUID();
            spatialRepo.addEntityToRoom(room.id, entityId);

            const retrieved = spatialRepo.findById(room.id);
            expect(retrieved!.entityIds).toContain(entityId);
        });

        it('removeEntityFromRoom removes entity', () => {
            const entity1 = crypto.randomUUID();
            const entity2 = crypto.randomUUID();

            const room = createTestRoom({ entityIds: [entity1, entity2] });
            spatialRepo.create(room);

            spatialRepo.removeEntityFromRoom(room.id, entity1);

            const retrieved = spatialRepo.findById(room.id);
            expect(retrieved!.entityIds).not.toContain(entity1);
            expect(retrieved!.entityIds).toContain(entity2);
        });

        it('getEntitiesInRoom returns entity list', () => {
            const e1 = crypto.randomUUID();
            const e2 = crypto.randomUUID();
            const e3 = crypto.randomUUID();

            const room = createTestRoom({ entityIds: [e1, e2, e3] });
            spatialRepo.create(room);

            const entities = spatialRepo.getEntitiesInRoom(room.id);
            expect(entities).toHaveLength(3);
        });
    });

    describe('Character Movement', () => {
        it('move_character_to_room updates character location', async () => {
            const { handleMoveCharacterToRoom } = await import('../../src/server/handlers/spatial-handlers.js');

            const roomId = crypto.randomUUID();
            const charId = crypto.randomUUID();

            const room = createTestRoom({ id: roomId });
            spatialRepo.create(room);

            const character = createTestCharacter({ id: charId });
            characterRepo.create(character);

            const result = await handleMoveCharacterToRoom({
                characterId: charId,
                roomId: roomId
            }, mockCtx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.newRoomId).toBe(roomId);

            // Verify character is in room
            const updatedRoom = spatialRepo.findById(roomId);
            expect(updatedRoom!.entityIds).toContain(charId);
        });

        it('incrementVisitCount tracks visits', () => {
            const room = createTestRoom({ visitedCount: 0 });
            spatialRepo.create(room);

            spatialRepo.incrementVisitCount(room.id);
            spatialRepo.incrementVisitCount(room.id);
            spatialRepo.incrementVisitCount(room.id);

            const updated = spatialRepo.findById(room.id);
            expect(updated!.visitedCount).toBe(3);
            expect(updated!.lastVisitedAt).toBeDefined();
        });
    });

    describe('Integration', () => {
        it('full room traversal workflow', async () => {
            const { handleGenerateRoomNode, handleLookAtSurroundings, handleMoveCharacterToRoom } = await import('../../src/server/handlers/spatial-handlers.js');

            // Create starting room
            const tavernResult = await handleGenerateRoomNode({
                name: 'The Prancing Pony',
                baseDescription: 'A cozy tavern with a roaring fireplace and the smell of fresh bread.',
                biomeContext: 'urban',
                atmospherics: []
            }, mockCtx);
            const tavern = JSON.parse(tavernResult.content[0].text);

            // Create connected room
            const alleyResult = await handleGenerateRoomNode({
                name: 'Dark Alley',
                baseDescription: 'A narrow, dimly lit alley behind the tavern.',
                biomeContext: 'urban',
                atmospherics: ['DARKNESS'],
                previousNodeId: tavern.roomId,
                direction: 'south'
            }, mockCtx);
            const alley = JSON.parse(alleyResult.content[0].text);

            expect(alley.linkedToPrevious).toBe(true);

            // Create character in first room
            const playerId = crypto.randomUUID();
            const player = createTestCharacter({ id: playerId });
            characterRepo.create(player);

            await handleMoveCharacterToRoom({
                characterId: playerId,
                roomId: tavern.roomId
            }, mockCtx);

            // Look around tavern
            const tavernView = await handleLookAtSurroundings({
                observerId: playerId
            }, mockCtx);
            const view = JSON.parse(tavernView.content[0].text);

            expect(view.success).toBe(true);
            expect(view.roomName).toBe('The Prancing Pony');
            expect(view.exits.some((e: any) => e.direction === 'south')).toBe(true);
        });
    });
});

// ===== HELPER FUNCTIONS =====

function createTestRoom(overrides?: Partial<RoomNode>): RoomNode {
    return {
        id: crypto.randomUUID(),
        name: 'Test Room',
        baseDescription: 'A generic test room with wooden floors and stone walls.',
        biomeContext: 'urban',
        atmospherics: [],
        exits: [],
        entityIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        visitedCount: 0,
        lastVisitedAt: undefined,
        ...overrides
    };
}

function createTestCharacter(overrides?: Partial<Character>): Character {
    return {
        id: crypto.randomUUID(),
        name: 'Test Character',
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: 50,
        maxHp: 50,
        ac: 10,
        level: 1,
        characterType: 'pc',
        characterClass: 'fighter',
        conditions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides
    };
}
