/**
 * Tests for consolidated spawn_manage tool
 * Validates all 5 actions: spawn_character, spawn_location, spawn_encounter, spawn_preset_location, spawn_tactical
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleSpawnManage, SpawnManageTool } from '../../../src/server/consolidated/spawn-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { WorldRepository } from '../../../src/storage/repos/world.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- SPAWN_MANAGE_JSON\n([\s\S]*?)\nSPAWN_MANAGE_JSON -->/);
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

describe('spawn_manage consolidated tool', () => {
    let testWorldId: string;
    const ctx = { sessionId: 'test-session' };

    beforeEach(async () => {
        closeDb();
        const db = getDb(':memory:');
        const now = new Date().toISOString();

        // Create rooms table for location spawning
        db.exec(`
            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                networkId TEXT,
                name TEXT,
                description TEXT,
                exits TEXT,
                createdAt TEXT,
                updatedAt TEXT
            )
        `);

        // Create pois table for preset locations
        db.exec(`
            CREATE TABLE IF NOT EXISTS pois (
                id TEXT PRIMARY KEY,
                worldId TEXT,
                name TEXT,
                type TEXT,
                x INTEGER,
                y INTEGER,
                discoveryState TEXT,
                networkId TEXT,
                createdAt TEXT,
                updatedAt TEXT
            )
        `);

        // Create a test world
        const worldRepo = new WorldRepository(db);
        testWorldId = randomUUID();
        worldRepo.create({
            id: testWorldId,
            name: 'Test World',
            seed: '12345',
            width: 100,
            height: 100,
            tileData: '{}',
            createdAt: now,
            updatedAt: now
        });
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(SpawnManageTool.name).toBe('spawn_manage');
        });

        it('should list all available actions in description', () => {
            expect(SpawnManageTool.description).toContain('spawn_character');
            expect(SpawnManageTool.description).toContain('spawn_location');
            expect(SpawnManageTool.description).toContain('spawn_encounter');
            expect(SpawnManageTool.description).toContain('spawn_preset_location');
            expect(SpawnManageTool.description).toContain('spawn_tactical');
        });
    });

    describe('spawn_character action', () => {
        it('should spawn a character from template', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_character',
                template: 'goblin',
                position: '5,5'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('spawn_character');
            expect(data.template).toBe('goblin');
            expect(data.characterId).toBeDefined();
            expect(data.position).toMatchObject({ x: 5, y: 5 });
        });

        it('should spawn character with custom name', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_character',
                template: 'orc',
                name: 'Grukk the Slayer',
                position: '10,10'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.name).toContain('Grukk');
        });

        it('should spawn character with equipment', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_character',
                template: 'goblin',
                equipment: ['Rusty Sword', 'Leather Armor'],
                position: '0,0'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.equipment).toContain('Rusty Sword');
            expect(data.equipment).toContain('Leather Armor');
        });

        it('should return error for missing template', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_character',
                position: '5,5'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "character" alias', async () => {
            const result = await handleSpawnManage({
                action: 'character',
                template: 'skeleton',
                position: '3,3'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('spawn_character');
        });
    });

    describe('spawn_location action', () => {
        it('should spawn a populated location', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_location',
                name: 'The Golden Goblet Inn',
                locationType: 'tavern',
                npcs: [
                    { name: 'Barkeep Martha', role: 'Innkeeper', race: 'Human' },
                    { name: 'Tom', role: 'Server', race: 'Human' }
                ],
                rooms: [
                    { name: 'Common Room', description: 'A cozy tavern room' },
                    { name: 'Kitchen', description: 'Where food is prepared' }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('spawn_location');
            expect(data.name).toBe('The Golden Goblet Inn');
            expect(data.npcs.length).toBe(2);
            expect(data.rooms.length).toBe(2);
        });

        it('should create location without NPCs', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_location',
                name: 'Abandoned Warehouse',
                locationType: 'warehouse'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.npcs).toEqual([]);
        });

        it('should accept "location" alias', async () => {
            const result = await handleSpawnManage({
                action: 'location',
                name: 'Test Place',
                locationType: 'generic'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('spawn_location');
        });
    });

    describe('spawn_encounter action', () => {
        it('should spawn encounter from preset', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_encounter',
                preset: 'goblin_ambush',
                seed: 'test-seed'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('spawn_encounter');
            expect(data.encounterId).toBeDefined();
            expect(data.participants).toBeDefined();
        });

        it('should spawn random encounter by difficulty', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_encounter',
                random: true,
                difficulty: 'medium',
                seed: 'random-test'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.encounterId).toBeDefined();
        });

        it('should spawn random encounter by tags', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_encounter',
                random: true,
                tags: ['undead'],
                seed: 'undead-test'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should return error for unknown preset', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_encounter',
                preset: 'non_existent_preset'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "encounter" alias', async () => {
            const result = await handleSpawnManage({
                action: 'encounter',
                preset: 'goblin_ambush',
                seed: 'alias-test'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('spawn_encounter');
        });
    });

    describe('spawn_preset_location action', () => {
        it('should spawn preset location at coordinates', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_preset_location',
                preset: 'generic_tavern',
                worldId: testWorldId,
                x: 50,
                y: 75
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('spawn_preset_location');
            expect(data.poiId).toBeDefined();
            expect(data.preset).toBe('generic_tavern');
            expect(data.position).toEqual({ x: 50, y: 75 });
        });

        it('should spawn with custom name', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_preset_location',
                preset: 'generic_tavern',
                worldId: testWorldId,
                x: 10,
                y: 20,
                customName: 'The Prancing Pony'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.name).toBe('The Prancing Pony');
        });

        it('should spawn with NPCs when requested', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_preset_location',
                preset: 'generic_tavern',
                worldId: testWorldId,
                x: 30,
                y: 40,
                spawnNpcs: true
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.npcs.length).toBeGreaterThan(0);
        });

        it('should return error for missing coordinates', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_preset_location',
                preset: 'generic_tavern',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should return error for unknown preset', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_preset_location',
                preset: 'unknown_preset',
                worldId: testWorldId,
                x: 0,
                y: 0
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "preset" alias', async () => {
            const result = await handleSpawnManage({
                action: 'preset',
                preset: 'forest_clearing',
                worldId: testWorldId,
                x: 25,
                y: 30
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('spawn_preset_location');
        });
    });

    describe('spawn_tactical action', () => {
        it('should create tactical encounter with participants', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_tactical',
                participants: [
                    { template: 'goblin', position: '5,5', isEnemy: true },
                    { template: 'goblin', position: '7,5', isEnemy: true },
                    { template: 'skeleton', position: '6,8', isEnemy: true }
                ],
                seed: 'tactical-test'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('spawn_tactical');
            expect(data.encounterId).toBeDefined();
            expect(data.participants.length).toBe(3);
        });

        it('should create encounter with terrain', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_tactical',
                participants: [
                    { template: 'goblin', position: '5,5' }
                ],
                terrain: {
                    obstacles: ['3,3', '4,4'],
                    difficultTerrain: ['6,6', '7,7']
                },
                gridSize: { width: 15, height: 15 },
                seed: 'terrain-test'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.terrain.obstacles.length).toBeGreaterThan(0);
            expect(data.gridSize).toEqual({ width: 15, height: 15 });
        });

        it('should return error for missing participants', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_tactical'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should return error for unknown template in participants', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_tactical',
                participants: [
                    { template: 'nonexistent_creature', position: '5,5' }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "tactical" alias', async () => {
            const result = await handleSpawnManage({
                action: 'tactical',
                participants: [
                    { template: 'goblin', position: '5,5' }
                ],
                seed: 'alias-tactical'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('spawn_tactical');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_charactr',  // Missing 'e'
                template: 'goblin',
                position: '0,0'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('spawn_character');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleSpawnManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting for character spawn', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_character',
                template: 'goblin',
                position: '5,5'
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('CHARACTER');
            expect(text.toUpperCase()).toContain('SPAWNED');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleSpawnManage({
                action: 'spawn_character',
                template: 'goblin',
                position: '5,5'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- SPAWN_MANAGE_JSON');
        });
    });
});
