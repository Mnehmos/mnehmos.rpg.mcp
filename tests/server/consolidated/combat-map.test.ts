/**
 * Tests for consolidated combat_map tool
 * Validates all 7 actions: render, aoe, update_terrain, place_prop, measure, generate_patch, generate_pattern
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleCombatMap, CombatMapTool } from '../../../src/server/consolidated/combat-map.js';
import { handleCombatManage } from '../../../src/server/consolidated/combat-manage.js';
import { clearCombatState } from '../../../src/server/handlers/combat-handlers.js';
import { getDb } from '../../../src/storage/index.js';
import { randomUUID } from 'crypto';

// Force test mode
process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- COMBAT_MAP_JSON\n([\s\S]*?)\nCOMBAT_MAP_JSON -->/);
    return jsonMatch ? JSON.parse(jsonMatch[1]) : null;
}

function parseManageResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- COMBAT_MANAGE_JSON\n([\s\S]*?)\nCOMBAT_MANAGE_JSON -->/);
    return jsonMatch ? JSON.parse(jsonMatch[1]) : null;
}

describe('combat_map consolidated tool', () => {
    const ctx = { sessionId: `test-session-${randomUUID()}` };
    let testEncounterId: string;

    beforeEach(async () => {
        // Reset test database
        const db = getDb(':memory:');
        db.exec('DELETE FROM encounters');

        // Clear in-memory combat state
        clearCombatState();

        // Create a test encounter with terrain
        const result = await handleCombatManage({
            action: 'create',
            seed: 'map-test',
            participants: [
                {
                    id: 'hero-1',
                    name: 'Test Hero',
                    initiativeBonus: 10,
                    hp: 30,
                    maxHp: 30,
                    isEnemy: false,
                    position: { x: 5, y: 5 }
                },
                {
                    id: 'goblin-1',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 7,
                    maxHp: 7,
                    isEnemy: true,
                    position: { x: 15, y: 15 }
                }
            ],
            terrain: {
                obstacles: ['10,10', '10,11', '11,10'],
                water: ['3,3', '3,4', '4,3']
            }
        }, ctx);
        testEncounterId = parseManageResult(result).encounterId;
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(CombatMapTool.name).toBe('combat_map');
        });

        it('should list all available actions in description', () => {
            expect(CombatMapTool.description).toContain('render');
            expect(CombatMapTool.description).toContain('aoe');
            expect(CombatMapTool.description).toContain('update_terrain');
            expect(CombatMapTool.description).toContain('place_prop');
            expect(CombatMapTool.description).toContain('measure');
            expect(CombatMapTool.description).toContain('generate_patch');
            expect(CombatMapTool.description).toContain('generate_pattern');
        });
    });

    describe('render action', () => {
        it('should render ASCII map', async () => {
            const result = await handleCombatMap({
                action: 'render',
                encounterId: testEncounterId,
                width: 20,
                height: 20
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('render');
        });

        it('should accept "map" alias', async () => {
            const result = await handleCombatMap({
                action: 'map',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should include legend when requested', async () => {
            const result = await handleCombatMap({
                action: 'render',
                encounterId: testEncounterId,
                showLegend: true
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('aoe action', () => {
        it('should calculate circle AoE', async () => {
            const result = await handleCombatMap({
                action: 'aoe',
                encounterId: testEncounterId,
                shape: 'circle',
                origin: { x: 10, y: 10 },
                radius: 4
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('aoe');
        });

        it('should calculate cone AoE', async () => {
            const result = await handleCombatMap({
                action: 'aoe',
                encounterId: testEncounterId,
                shape: 'cone',
                origin: { x: 5, y: 5 },
                direction: { x: 1, y: 0 },
                length: 3,
                angle: 90
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should calculate line AoE', async () => {
            const result = await handleCombatMap({
                action: 'aoe',
                encounterId: testEncounterId,
                shape: 'line',
                origin: { x: 0, y: 5 },
                direction: { x: 1, y: 0 },
                length: 20
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should accept "blast" alias', async () => {
            const result = await handleCombatMap({
                action: 'blast',
                encounterId: testEncounterId,
                shape: 'circle',
                origin: { x: 10, y: 10 },
                radius: 2
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('measure action', () => {
        it('should measure distance between positions', async () => {
            const result = await handleCombatMap({
                action: 'measure',
                encounterId: testEncounterId,
                from: { type: 'position', value: '5,5' },
                to: { type: 'position', value: '10,10' }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('measure');
        });

        it('should measure distance between entities', async () => {
            const result = await handleCombatMap({
                action: 'measure',
                encounterId: testEncounterId,
                from: { type: 'entity', value: 'hero-1' },
                to: { type: 'entity', value: 'goblin-1' }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should accept "distance" alias', async () => {
            const result = await handleCombatMap({
                action: 'distance',
                encounterId: testEncounterId,
                from: { type: 'position', value: '0,0' },
                to: { type: 'position', value: '3,4' }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('update_terrain action', () => {
        it('should add obstacles', async () => {
            const result = await handleCombatMap({
                action: 'update_terrain',
                encounterId: testEncounterId,
                operation: 'add',
                terrainType: 'obstacles',
                tiles: ['20,20', '21,20']
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('update_terrain');
        });

        it('should remove terrain', async () => {
            const result = await handleCombatMap({
                action: 'update_terrain',
                encounterId: testEncounterId,
                operation: 'remove',
                terrainType: 'obstacles',
                tiles: ['10,10']
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should use range shortcuts', async () => {
            const result = await handleCombatMap({
                action: 'update_terrain',
                encounterId: testEncounterId,
                operation: 'add',
                terrainType: 'difficultTerrain',
                ranges: ['row:5'],
                gridWidth: 20,
                gridHeight: 20
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should accept "terrain" alias', async () => {
            const result = await handleCombatMap({
                action: 'terrain',
                encounterId: testEncounterId,
                operation: 'add',
                terrainType: 'water',
                tiles: ['1,1']
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('place_prop action', () => {
        it('should place a prop', async () => {
            const result = await handleCombatMap({
                action: 'place_prop',
                encounterId: testEncounterId,
                position: '12,12',
                label: 'Burning Cart',
                propType: 'hazard',
                cover: 'half',
                description: 'A cart on fire, provides half cover but deals fire damage'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('place_prop');
        });

        it('should place climbable prop', async () => {
            const result = await handleCombatMap({
                action: 'place_prop',
                encounterId: testEncounterId,
                position: '8,8',
                label: 'Stone Tower',
                propType: 'climbable',
                heightFeet: 30,
                climbable: true,
                climbDC: 15
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should accept "prop" alias', async () => {
            const result = await handleCombatMap({
                action: 'prop',
                encounterId: testEncounterId,
                position: '1,1',
                label: 'Tree',
                propType: 'decoration'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('generate_patch action', () => {
        it('should generate forest terrain', async () => {
            const result = await handleCombatMap({
                action: 'generate_patch',
                encounterId: testEncounterId,
                biome: 'forest',
                origin: { x: 0, y: 0 },
                width: 15,
                height: 15,
                density: 0.4,
                seed: 'test-forest'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('generate_patch');
        });

        it('should generate dungeon terrain', async () => {
            const result = await handleCombatMap({
                action: 'generate_patch',
                encounterId: testEncounterId,
                biome: 'dungeon',
                origin: { x: 0, y: 0 },
                width: 20,
                height: 20,
                density: 0.6
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should accept "biome" alias', async () => {
            const result = await handleCombatMap({
                action: 'biome',
                encounterId: testEncounterId,
                biome: 'cave',
                origin: { x: 0, y: 0 },
                width: 10,
                height: 10
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('generate_pattern action', () => {
        it('should generate maze pattern', async () => {
            const result = await handleCombatMap({
                action: 'generate_pattern',
                encounterId: testEncounterId,
                pattern: 'maze',
                origin: { x: 0, y: 0 },
                width: 30,
                height: 30,
                seed: 'test-maze'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('generate_pattern');
        });

        it('should generate arena pattern', async () => {
            const result = await handleCombatMap({
                action: 'generate_pattern',
                encounterId: testEncounterId,
                pattern: 'arena',
                width: 40,
                height: 40
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should generate maze with rooms', async () => {
            const result = await handleCombatMap({
                action: 'generate_pattern',
                encounterId: testEncounterId,
                pattern: 'maze_rooms',
                width: 50,
                height: 50,
                roomCount: 5,
                corridorWidth: 2
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should accept "maze" alias', async () => {
            const result = await handleCombatMap({
                action: 'maze',
                encounterId: testEncounterId,
                pattern: 'maze',
                width: 20,
                height: 20
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleCombatMap({
                action: 'rendr',  // Missing 'e' - similarity with "render" is 0.83
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleCombatMap({
                action: 'xyz',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting', async () => {
            const result = await handleCombatMap({
                action: 'render',
                encounterId: testEncounterId
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('🗺️'); // Map emoji
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleCombatMap({
                action: 'measure',
                encounterId: testEncounterId,
                from: { type: 'position', value: '0,0' },
                to: { type: 'position', value: '5,5' }
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- COMBAT_MAP_JSON');
        });
    });
});
