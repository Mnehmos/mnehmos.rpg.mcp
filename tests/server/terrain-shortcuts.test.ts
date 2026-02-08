import {
    handleCreateEncounter,
    handleUpdateTerrain,
    handleGenerateTerrainPattern,
    clearCombatState
} from '../../src/server/handlers/combat-handlers';
import { generateMaze, generateMazeWithRooms } from '../../src/server/terrain-patterns';

let testCounter = 0;
const getMockCtx = () => ({ sessionId: `test-terrain-session-${testCounter++}` });

function extractStateJson(responseText: string): any {
    const match = responseText.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/);
    if (match) {
        return JSON.parse(match[1]);
    }
    throw new Error('Could not extract state JSON from response');
}

describe('Terrain Range Shortcuts', () => {
    let encounterId: string;
    let mockCtx: { sessionId: string };

    beforeEach(async () => {
        clearCombatState();
        mockCtx = getMockCtx();
        const result = await handleCreateEncounter({
            seed: `terrain-test-${testCounter}`,
            participants: [{
                id: 'p1',
                name: 'Test',
                initiativeBonus: 0,
                hp: 10,
                maxHp: 10,
                conditions: []
            }]
        }, mockCtx);
        encounterId = extractStateJson(result.content[0].text).encounterId;
    });

    describe('update_terrain with ranges', () => {
        it('should add obstacles using row shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['row:5'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // Row 5 should have tiles from x=0 to x=9
            expect(state.terrain.obstacles).toContain('0,5');
            expect(state.terrain.obstacles).toContain('9,5');
            expect(state.terrain.obstacles.length).toBe(10);
        });

        it('should add obstacles using col shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['col:3'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            expect(state.terrain.obstacles).toContain('3,0');
            expect(state.terrain.obstacles).toContain('3,9');
            expect(state.terrain.obstacles.length).toBe(10);
        });

        it('should add obstacles using x= shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['x=7:2:5'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // x=7 from y=2 to y=5
            expect(state.terrain.obstacles).toContain('7,2');
            expect(state.terrain.obstacles).toContain('7,5');
            expect(state.terrain.obstacles).not.toContain('7,1');
            expect(state.terrain.obstacles.length).toBe(4);
        });

        it('should add obstacles using y= shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['y=3:1:4'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // y=3 from x=1 to x=4
            expect(state.terrain.obstacles).toContain('1,3');
            expect(state.terrain.obstacles).toContain('4,3');
            expect(state.terrain.obstacles.length).toBe(4);
        });

        it('should add obstacles using line shortcut (Bresenham)', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['line:0,0,9,9'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // Diagonal line from (0,0) to (9,9)
            expect(state.terrain.obstacles).toContain('0,0');
            expect(state.terrain.obstacles).toContain('9,9');
            expect(state.terrain.obstacles.length).toBe(10); // Bresenham diagonal
        });

        it('should add obstacles using rect shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['rect:2,2,3,3'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // 3x3 filled rectangle at (2,2)
            expect(state.terrain.obstacles).toContain('2,2');
            expect(state.terrain.obstacles).toContain('4,4');
            expect(state.terrain.obstacles.length).toBe(9);
        });

        it('should add obstacles using box shortcut (hollow)', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['box:1,1,4,4'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // 4x4 hollow box - should have perimeter only
            expect(state.terrain.obstacles).toContain('1,1');
            expect(state.terrain.obstacles).toContain('4,1');
            expect(state.terrain.obstacles).toContain('1,4');
            expect(state.terrain.obstacles).toContain('4,4');
            // Center should be empty
            expect(state.terrain.obstacles).not.toContain('2,2');
            expect(state.terrain.obstacles).not.toContain('3,3');
            expect(state.terrain.obstacles.length).toBe(12); // 4*4 - 2*2 = 12
        });

        it('should add obstacles using border shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['border:0'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // Border at margin 0 = outer edge
            expect(state.terrain.obstacles).toContain('0,0');
            expect(state.terrain.obstacles).toContain('9,0');
            expect(state.terrain.obstacles).toContain('0,9');
            expect(state.terrain.obstacles).toContain('9,9');
            // Center should be empty
            expect(state.terrain.obstacles).not.toContain('5,5');
            // 10*4 - 4 corners counted once = 36
            expect(state.terrain.obstacles.length).toBe(36);
        });

        it('should add obstacles using circle shortcut', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['circle:5,5,2'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // Center should be in circle
            expect(state.terrain.obstacles).toContain('5,5');
            // Should not contain distant points
            expect(state.terrain.obstacles).not.toContain('0,0');
        });

        it('should add multiple ranges in one call', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['row:0', 'row:9', 'col:0', 'col:9'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // Should form a border (with some overlap at corners)
            expect(state.terrain.obstacles).toContain('0,0');
            expect(state.terrain.obstacles).toContain('9,9');
            expect(state.terrain.obstacles).toContain('5,0');
            expect(state.terrain.obstacles).toContain('0,5');
        });

        it('should support algebraic expressions', async () => {
            const result = await handleUpdateTerrain({
                encounterId,
                operation: 'add',
                terrainType: 'obstacles',
                ranges: ['y=x:0:9'],
                gridWidth: 10,
                gridHeight: 10
            }, mockCtx);

            const state = extractStateJson(result.content[0].text);
            // y=x diagonal
            expect(state.terrain.obstacles).toContain('0,0');
            expect(state.terrain.obstacles).toContain('5,5');
            expect(state.terrain.obstacles).toContain('9,9');
            expect(state.terrain.obstacles.length).toBe(10);
        });
    });
});

describe('Maze Generator', () => {
    it('should generate a maze with corridors and walls', () => {
        const result = generateMaze(0, 0, 20, 20, 'test-seed', 1);

        expect(result.obstacles.length).toBeGreaterThan(0);
        // Maze should have some passable areas (not all walls)
        expect(result.obstacles.length).toBeLessThan(20 * 20);
        // Should have outer walls
        expect(result.obstacles).toContain('0,0');
    });

    it('should generate reproducible mazes with same seed', () => {
        const result1 = generateMaze(0, 0, 30, 30, 'same-seed', 1);
        const result2 = generateMaze(0, 0, 30, 30, 'same-seed', 1);

        expect(result1.obstacles).toEqual(result2.obstacles);
    });

    it('should generate different mazes with different seeds', () => {
        const result1 = generateMaze(0, 0, 30, 30, 'seed-a', 1);
        const result2 = generateMaze(0, 0, 30, 30, 'seed-b', 1);

        expect(result1.obstacles).not.toEqual(result2.obstacles);
    });

    it('should support wider corridors', () => {
        const narrow = generateMaze(0, 0, 30, 30, 'test', 1);
        const wide = generateMaze(0, 0, 30, 30, 'test', 2);

        // Wider corridors = fewer walls
        expect(wide.obstacles.length).toBeLessThan(narrow.obstacles.length);
    });
});

describe('Maze with Rooms Generator', () => {
    it('should generate a maze with carved-out rooms', () => {
        const result = generateMazeWithRooms(0, 0, 50, 50, 'room-test', 5, 4, 8);

        expect(result.obstacles.length).toBeGreaterThan(0);
        // Should have room markers as props
        expect(result.props.length).toBeGreaterThan(0);
        expect(result.props[0].label).toContain('Chamber');
    });

    it('should generate reproducible mazes with rooms', () => {
        const result1 = generateMazeWithRooms(0, 0, 50, 50, 'room-seed', 5);
        const result2 = generateMazeWithRooms(0, 0, 50, 50, 'room-seed', 5);

        expect(result1.obstacles).toEqual(result2.obstacles);
        expect(result1.props.length).toBe(result2.props.length);
    });
});

describe('generate_terrain_pattern tool with maze', () => {
    let encounterId: string;
    let mazeCtx: { sessionId: string };

    beforeEach(async () => {
        clearCombatState();
        mazeCtx = getMockCtx();
        const result = await handleCreateEncounter({
            seed: `maze-pattern-test-${testCounter}`,
            participants: [{
                id: 'runner',
                name: 'Thomas',
                initiativeBonus: 3,
                hp: 30,
                maxHp: 30,
                conditions: [],
                position: { x: 50, y: 50, z: 0 }
            }]
        }, mazeCtx);
        encounterId = extractStateJson(result.content[0].text).encounterId;
    });

    it('should generate a full 100x100 maze in one call', async () => {
        const result = await handleGenerateTerrainPattern({
            encounterId,
            pattern: 'maze',
            origin: { x: 0, y: 0 },
            width: 100,
            height: 100,
            seed: 'maze-runner-001'
        }, mazeCtx);

        const text = result.content[0].text;
        expect(text).toContain('TERRAIN PATTERN GENERATED');
        expect(text).toContain('MAZE');

        // Extract obstacle count from output
        const obstacleMatch = text.match(/Obstacles: (\d+)/);
        expect(obstacleMatch).toBeTruthy();
        const obstacleCount = parseInt(obstacleMatch![1], 10);

        // A 100x100 maze should have significant walls but not all walls
        expect(obstacleCount).toBeGreaterThan(1000);
        expect(obstacleCount).toBeLessThan(9000);
    });

    it('should generate maze_rooms pattern', async () => {
        const result = await handleGenerateTerrainPattern({
            encounterId,
            pattern: 'maze_rooms',
            origin: { x: 0, y: 0 },
            width: 60,
            height: 60,
            seed: 'dungeon-001',
            roomCount: 8
        }, mazeCtx);

        const text = result.content[0].text;
        expect(text).toContain('TERRAIN PATTERN GENERATED');
        expect(text).toContain('Props:');
    });
});
