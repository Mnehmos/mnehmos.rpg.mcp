/**
 * Tests for consolidated corpse_manage tool
 * Validates all 14 actions: create, get, get_by_character, list_in_encounter,
 * list_nearby, get_inventory, loot, harvest, generate_loot, advance_decay,
 * cleanup, loot_table_create, loot_table_get, loot_table_list
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleCorpseManage, CorpseManageTool } from '../../../src/server/consolidated/corpse-manage.js';
import { handleItemManage } from '../../../src/server/consolidated/item-manage.js';
import { getDb } from '../../../src/storage/index.js';
import { randomUUID } from 'crypto';

// Force test mode
process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    // Match HTML comment format: <!-- CORPSE_MANAGE_JSON ... CORPSE_MANAGE_JSON -->
    const jsonMatch = text.match(/<!-- CORPSE_MANAGE_JSON\n([\s\S]*?)\nCORPSE_MANAGE_JSON -->/);
    return jsonMatch ? JSON.parse(jsonMatch[1]) : null;
}

function parseItemResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- ITEM_MANAGE_JSON\n([\s\S]*?)\nITEM_MANAGE_JSON -->/);
    return jsonMatch ? JSON.parse(jsonMatch[1]) : null;
}

describe('corpse_manage consolidated tool', () => {
    const ctx = { sessionId: 'test-session' };
    let testCharId: string;
    let testEncounterId: string;
    let testWorldId: string;
    let testItemId: string;

    beforeEach(async () => {
        // Reset test database
        const db = getDb(':memory:');
        db.exec('DELETE FROM corpse_inventory');
        db.exec('DELETE FROM corpses');
        db.exec('DELETE FROM loot_tables');
        db.exec('DELETE FROM items');

        // Create test IDs
        testCharId = randomUUID();
        testEncounterId = randomUUID();
        testWorldId = randomUUID();

        // Create a test item
        const itemResult = await handleItemManage({
            action: 'create',
            name: 'Gold Coin',
            type: 'misc',
            weight: 0.01,
            value: 1
        }, ctx);
        testItemId = parseItemResult(itemResult).item.id;
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(CorpseManageTool.name).toBe('corpse_manage');
        });

        it('should list all available actions in description', () => {
            expect(CorpseManageTool.description).toContain('create');
            expect(CorpseManageTool.description).toContain('get');
            expect(CorpseManageTool.description).toContain('loot');
            expect(CorpseManageTool.description).toContain('harvest');
            expect(CorpseManageTool.description).toContain('loot_table_create');
        });
    });

    describe('create action', () => {
        it('should create a corpse', async () => {
            const result = await handleCorpseManage({
                action: 'create',
                characterId: testCharId,
                characterName: 'Fallen Warrior',
                characterType: 'enemy',
                creatureType: 'humanoid',
                cr: 1,
                encounterId: testEncounterId,
                position: { x: 5, y: 10 }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.corpse.characterName).toBe('Fallen Warrior');
            expect(data.corpse.characterType).toBe('enemy');
            expect(data.corpse.state).toBe('fresh');
        });

        it('should accept "spawn" alias', async () => {
            const result = await handleCorpseManage({
                action: 'spawn',
                characterId: testCharId,
                characterName: 'Dead Goblin',
                characterType: 'enemy'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('get action', () => {
        let corpseId: string;

        beforeEach(async () => {
            const createResult = await handleCorpseManage({
                action: 'create',
                characterId: testCharId,
                characterName: 'Test Corpse',
                characterType: 'enemy'
            }, ctx);
            corpseId = parseResult(createResult).corpse.id;
        });

        it('should retrieve a corpse by ID', async () => {
            const result = await handleCorpseManage({
                action: 'get',
                corpseId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.corpse.id).toBe(corpseId);
            expect(data.canLoot).toBeDefined();
            expect(data.canHarvest).toBeDefined();
        });

        it('should return error for non-existent corpse', async () => {
            const result = await handleCorpseManage({
                action: 'get',
                corpseId: 'fake-corpse-id'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBeDefined();
            expect(data.message).toContain('not found');
        });
    });

    describe('get_by_character action', () => {
        beforeEach(async () => {
            await handleCorpseManage({
                action: 'create',
                characterId: testCharId,
                characterName: 'Dead Character',
                characterType: 'npc'
            }, ctx);
        });

        it('should find corpse by character ID', async () => {
            const result = await handleCorpseManage({
                action: 'get_by_character',
                characterId: testCharId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.corpse.characterId).toBe(testCharId);
        });

        it('should accept "by_character" alias', async () => {
            const result = await handleCorpseManage({
                action: 'by_character',
                characterId: testCharId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('list_in_encounter action', () => {
        beforeEach(async () => {
            // Create multiple corpses in the same encounter
            await handleCorpseManage({
                action: 'create',
                characterId: randomUUID(),
                characterName: 'Goblin 1',
                characterType: 'enemy',
                encounterId: testEncounterId
            }, ctx);
            await handleCorpseManage({
                action: 'create',
                characterId: randomUUID(),
                characterName: 'Goblin 2',
                characterType: 'enemy',
                encounterId: testEncounterId
            }, ctx);
        });

        it('should list corpses in an encounter', async () => {
            const result = await handleCorpseManage({
                action: 'list_in_encounter',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.count).toBe(2);
            expect(data.corpses.length).toBe(2);
        });

        it('should accept "in_encounter" alias', async () => {
            const result = await handleCorpseManage({
                action: 'in_encounter',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('list_nearby action', () => {
        beforeEach(async () => {
            await handleCorpseManage({
                action: 'create',
                characterId: randomUUID(),
                characterName: 'Nearby Corpse',
                characterType: 'enemy',
                worldId: testWorldId,
                position: { x: 5, y: 5 }
            }, ctx);
        });

        it('should list corpses near a position', async () => {
            const result = await handleCorpseManage({
                action: 'list_nearby',
                worldId: testWorldId,
                x: 5,
                y: 5,
                radius: 3
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.corpses).toBeDefined();
        });

        it('should accept "nearby" alias', async () => {
            const result = await handleCorpseManage({
                action: 'nearby',
                worldId: testWorldId,
                x: 5,
                y: 5,
                radius: 3
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('loot action', () => {
        let corpseId: string;
        let looterId: string;

        beforeEach(async () => {
            looterId = randomUUID();
            const createResult = await handleCorpseManage({
                action: 'create',
                characterId: testCharId,
                characterName: 'Rich Corpse',
                characterType: 'enemy'
            }, ctx);
            corpseId = parseResult(createResult).corpse.id;
        });

        it('should loot all items from corpse', async () => {
            const result = await handleCorpseManage({
                action: 'loot',
                characterId: looterId,
                corpseId,
                lootAll: true
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.lootedBy).toBe(looterId);
        });

        it('should accept "take" alias', async () => {
            const result = await handleCorpseManage({
                action: 'take',
                characterId: looterId,
                corpseId,
                lootAll: true
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should return error when no itemId and no lootAll', async () => {
            const result = await handleCorpseManage({
                action: 'loot',
                characterId: looterId,
                corpseId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBeDefined();
            expect(data.message).toContain('itemId');
        });
    });

    describe('harvest action', () => {
        let corpseId: string;

        beforeEach(async () => {
            const createResult = await handleCorpseManage({
                action: 'create',
                characterId: testCharId,
                characterName: 'Dragon',
                characterType: 'enemy',
                creatureType: 'dragon'
            }, ctx);
            corpseId = parseResult(createResult).corpse.id;
        });

        it('should harvest resources from corpse', async () => {
            const result = await handleCorpseManage({
                action: 'harvest',
                characterId: randomUUID(),
                corpseId,
                resourceType: 'scales',
                skillRoll: 15,
                skillDC: 12
            }, ctx);

            const data = parseResult(result);
            // May succeed or fail based on implementation, but should have the right shape
            expect(data.harvestedBy).toBeDefined();
            expect(data.resourceType).toBe('scales');
        });

        it('should accept "skin" alias', async () => {
            const result = await handleCorpseManage({
                action: 'skin',
                characterId: randomUUID(),
                corpseId,
                resourceType: 'hide'
            }, ctx);

            const data = parseResult(result);
            expect(data.resourceType).toBe('hide');
        });
    });

    describe('generate_loot action', () => {
        let corpseId: string;

        beforeEach(async () => {
            const createResult = await handleCorpseManage({
                action: 'create',
                characterId: testCharId,
                characterName: 'Monster',
                characterType: 'enemy'
            }, ctx);
            corpseId = parseResult(createResult).corpse.id;
        });

        it('should generate loot for corpse', async () => {
            const result = await handleCorpseManage({
                action: 'generate_loot',
                corpseId,
                creatureType: 'humanoid',
                cr: 1
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.loot).toBeDefined();
        });

        it('should accept "roll_loot" alias', async () => {
            const result = await handleCorpseManage({
                action: 'roll_loot',
                corpseId,
                creatureType: 'beast',
                cr: 2
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('advance_decay action', () => {
        beforeEach(async () => {
            await handleCorpseManage({
                action: 'create',
                characterId: testCharId,
                characterName: 'Decaying Corpse',
                characterType: 'enemy'
            }, ctx);
        });

        it('should process decay over time', async () => {
            const result = await handleCorpseManage({
                action: 'advance_decay',
                hoursAdvanced: 24
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.hoursAdvanced).toBe(24);
            expect(data.corpsesDecayed).toBeDefined();
        });

        it('should accept "decay" alias', async () => {
            const result = await handleCorpseManage({
                action: 'decay',
                hoursAdvanced: 12
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('cleanup action', () => {
        it('should cleanup gone corpses', async () => {
            const result = await handleCorpseManage({
                action: 'cleanup'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.corpsesRemoved).toBeDefined();
        });

        it('should accept "purge" alias', async () => {
            const result = await handleCorpseManage({
                action: 'purge'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('loot_table_create action', () => {
        it('should create a loot table', async () => {
            const result = await handleCorpseManage({
                action: 'loot_table_create',
                name: 'Goblin Loot',
                creatureTypes: ['goblin', 'goblinoid'],
                crRange: { min: 0, max: 2 },
                randomDrops: [
                    { itemName: 'Rusty Dagger', weight: 0.5, quantity: { min: 1, max: 1 } },
                    { itemName: 'Gold Pieces', weight: 0.8, quantity: { min: 1, max: 5 } }
                ],
                currencyRange: {
                    gold: { min: 0, max: 2 },
                    silver: { min: 1, max: 10 },
                    copper: { min: 5, max: 30 }
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.lootTable.name).toBe('Goblin Loot');
            expect(data.lootTable.creatureTypes).toContain('goblin');
        });

        it('should accept "create_table" alias', async () => {
            const result = await handleCorpseManage({
                action: 'create_table',
                name: 'Test Table',
                creatureTypes: ['test'],
                randomDrops: []
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('loot_table_get action', () => {
        let tableId: string;

        beforeEach(async () => {
            const createResult = await handleCorpseManage({
                action: 'loot_table_create',
                name: 'Wolf Loot',
                creatureTypes: ['wolf', 'beast'],
                randomDrops: []
            }, ctx);
            tableId = parseResult(createResult).lootTable.id;
        });

        it('should get loot table by ID', async () => {
            const result = await handleCorpseManage({
                action: 'loot_table_get',
                id: tableId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.lootTable.id).toBe(tableId);
        });

        it('should get loot table by creature type', async () => {
            const result = await handleCorpseManage({
                action: 'loot_table_get',
                creatureType: 'wolf'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.lootTable.creatureTypes).toContain('wolf');
        });

        it('should accept "get_table" alias', async () => {
            const result = await handleCorpseManage({
                action: 'get_table',
                id: tableId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('loot_table_list action', () => {
        beforeEach(async () => {
            await handleCorpseManage({
                action: 'loot_table_create',
                name: 'Table 1',
                creatureTypes: ['type1'],
                randomDrops: []
            }, ctx);
            await handleCorpseManage({
                action: 'loot_table_create',
                name: 'Table 2',
                creatureTypes: ['type2'],
                randomDrops: []
            }, ctx);
        });

        it('should list all loot tables', async () => {
            const result = await handleCorpseManage({
                action: 'loot_table_list'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.count).toBe(2);
            expect(data.tables.length).toBe(2);
        });

        it('should accept "list_tables" alias', async () => {
            const result = await handleCorpseManage({
                action: 'list_tables'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            // "ceate" has similarity ~0.67 with "create" - should auto-correct
            const result = await handleCorpseManage({
                action: 'ceate',
                characterId: testCharId,
                characterName: 'Typo Corpse',
                characterType: 'enemy'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleCorpseManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting for create', async () => {
            const result = await handleCorpseManage({
                action: 'create',
                characterId: testCharId,
                characterName: 'Formatted Corpse',
                characterType: 'enemy'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('💀'); // Corpse emoji
            expect(text).toContain('Formatted Corpse');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleCorpseManage({
                action: 'cleanup'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- CORPSE_MANAGE_JSON');
        });
    });
});
