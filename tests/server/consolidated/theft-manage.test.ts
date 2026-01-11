/**
 * Tests for consolidated theft_manage tool
 * Validates all 10 actions: steal, check, search, recognize, sell, register_fence, report, decay, get_fence, list_fences
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleTheftManage, TheftManageTool } from '../../../src/server/consolidated/theft-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { WorldRepository } from '../../../src/storage/repos/world.repo.js';
import { ItemRepository } from '../../../src/storage/repos/item.repo.js';
import { InventoryRepository } from '../../../src/storage/repos/inventory.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- THEFT_MANAGE_JSON\n([\s\S]*?)\nTHEFT_MANAGE_JSON -->/);
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

describe('theft_manage consolidated tool', () => {
    let testThiefId: string;
    let testVictimId: string;
    let testItemId: string;
    let testWitnessId: string;
    let testFenceId: string;
    let testWorldId: string;
    const ctx = { sessionId: 'test-session' };

    beforeEach(() => {
        closeDb();
        const db = getDb(':memory:');
        const now = new Date().toISOString();

        // Create test world
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

        // Create test characters
        const characterRepo = new CharacterRepository(db);
        testThiefId = randomUUID();
        testVictimId = randomUUID();
        testWitnessId = randomUUID();
        testFenceId = randomUUID();

        characterRepo.create({
            id: testThiefId,
            name: 'Sneaky Rogue',
            class: 'Rogue',
            level: 5,
            race: 'Halfling',
            stats: { str: 10, dex: 18, con: 12, int: 14, wis: 12, cha: 14 },
            hp: 33,
            maxHp: 33,
            ac: 15,
            worldId: testWorldId,
            createdAt: now,
            updatedAt: now
        });

        characterRepo.create({
            id: testVictimId,
            name: 'Wealthy Merchant',
            class: 'Commoner',
            level: 1,
            race: 'Human',
            stats: { str: 10, dex: 10, con: 10, int: 12, wis: 10, cha: 14 },
            hp: 4,
            maxHp: 4,
            ac: 10,
            worldId: testWorldId,
            createdAt: now,
            updatedAt: now
        });

        characterRepo.create({
            id: testWitnessId,
            name: 'Guard Captain',
            class: 'Fighter',
            level: 5,
            race: 'Human',
            stats: { str: 16, dex: 12, con: 14, int: 10, wis: 14, cha: 10 },
            hp: 44,
            maxHp: 44,
            ac: 18,
            worldId: testWorldId,
            createdAt: now,
            updatedAt: now
        });

        characterRepo.create({
            id: testFenceId,
            name: 'Shady Dealer',
            class: 'Rogue',
            level: 3,
            race: 'Human',
            stats: { str: 10, dex: 14, con: 10, int: 14, wis: 12, cha: 16 },
            hp: 18,
            maxHp: 18,
            ac: 12,
            worldId: testWorldId,
            createdAt: now,
            updatedAt: now
        });

        // Create test item
        const itemRepo = new ItemRepository(db);
        testItemId = randomUUID();
        itemRepo.create({
            id: testItemId,
            name: 'Gold Necklace',
            type: 'misc',
            rarity: 'uncommon',
            value: 100,
            weight: 0.1,
            description: 'A fine gold necklace',
            properties: {},
            createdAt: now,
            updatedAt: now
        });

        // Add item to victim's inventory
        const inventoryRepo = new InventoryRepository(db);
        inventoryRepo.addItem(testVictimId, testItemId, 1);
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(TheftManageTool.name).toBe('theft_manage');
        });

        it('should list all available actions in description', () => {
            expect(TheftManageTool.description).toContain('steal');
            expect(TheftManageTool.description).toContain('check');
            expect(TheftManageTool.description).toContain('search');
            expect(TheftManageTool.description).toContain('recognize');
            expect(TheftManageTool.description).toContain('sell');
            expect(TheftManageTool.description).toContain('register_fence');
            expect(TheftManageTool.description).toContain('report');
            expect(TheftManageTool.description).toContain('decay');
            expect(TheftManageTool.description).toContain('get_fence');
            expect(TheftManageTool.description).toContain('list_fences');
        });
    });

    describe('steal action', () => {
        it('should record a theft', async () => {
            const result = await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('steal');
            expect(data.record.itemId).toBe(testItemId);
            expect(data.record.stolenBy).toBe(testThiefId);
            expect(data.record.stolenFrom).toBe(testVictimId);
            expect(data.heatLevel).toBe('burning');
        });

        it('should record witnesses', async () => {
            const result = await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId,
                witnesses: [testWitnessId]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.witnesses).toBe(1);
        });

        it('should prevent self-theft', async () => {
            const result = await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testThiefId,
                itemId: testItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
            expect(data.message).toContain('cannot steal from themselves');
        });

        it('should accept "record_theft" alias', async () => {
            const result = await handleTheftManage({
                action: 'record_theft',
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('steal');
        });
    });

    describe('check action', () => {
        it('should check if item is not stolen', async () => {
            const result = await handleTheftManage({
                action: 'check',
                itemId: testItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('check');
            expect(data.isStolen).toBe(false);
        });

        it('should return stolen item info', async () => {
            // First steal the item
            await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId
            }, ctx);

            const result = await handleTheftManage({
                action: 'check',
                itemId: testItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.isStolen).toBe(true);
            expect(data.heatLevel).toBe('burning');
            expect(data.originalOwner).toBe(testVictimId);
            expect(data.thief).toBe(testThiefId);
        });

        it('should accept "provenance" alias', async () => {
            const result = await handleTheftManage({
                action: 'provenance',
                itemId: testItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('check');
        });
    });

    describe('search action', () => {
        it('should find no stolen items on clean character', async () => {
            const result = await handleTheftManage({
                action: 'search',
                characterId: testThiefId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('search');
            expect(data.stolenItemCount).toBe(0);
            expect(data.detectionRisk).toBe('none');
        });

        it('should find stolen items on thief', async () => {
            // Steal an item and transfer it to thief's inventory
            await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId
            }, ctx);

            // Manually move item to thief's inventory (simulates physical theft)
            const db = getDb();
            const inventoryRepo = new InventoryRepository(db);
            inventoryRepo.removeItem(testVictimId, testItemId, 1);
            inventoryRepo.addItem(testThiefId, testItemId, 1);

            const result = await handleTheftManage({
                action: 'search',
                characterId: testThiefId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.stolenItemCount).toBe(1);
            expect(data.hottestItem).toBe('burning');
            expect(data.detectionRisk).toBe('very high');
        });

        it('should accept "frisk" alias', async () => {
            const result = await handleTheftManage({
                action: 'frisk',
                characterId: testThiefId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('search');
        });
    });

    describe('recognize action', () => {
        beforeEach(async () => {
            await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId,
                witnesses: [testWitnessId]
            }, ctx);
        });

        it('should return false for non-stolen item', async () => {
            const cleanItemId = randomUUID();
            const result = await handleTheftManage({
                action: 'recognize',
                npcId: testVictimId,
                characterId: testThiefId,
                itemId: cleanItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.recognized).toBe(false);
            expect(data.isStolen).toBe(false);
        });

        it('should have original owner recognize their item', async () => {
            const result = await handleTheftManage({
                action: 'recognize',
                npcId: testVictimId,
                characterId: testThiefId,
                itemId: testItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.recognized).toBe(true);
            expect(data.recognizedBy).toBe('original_owner');
            expect(data.reaction).toBe('hostile');
        });

        it('should have witness recognize stolen item', async () => {
            const result = await handleTheftManage({
                action: 'recognize',
                npcId: testWitnessId,
                characterId: testThiefId,
                itemId: testItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.recognized).toBe(true);
            expect(data.recognizedBy).toBe('witness');
        });
    });

    describe('register_fence action', () => {
        it('should register an NPC as a fence', async () => {
            const result = await handleTheftManage({
                action: 'register_fence',
                npcId: testFenceId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('register_fence');
            expect(data.fence.npcId).toBe(testFenceId);
            expect(data.fence.buyRate).toBe(0.4); // default
        });

        it('should register fence with custom rates', async () => {
            const result = await handleTheftManage({
                action: 'register_fence',
                npcId: testFenceId,
                buyRate: 0.6,
                maxHeatLevel: 'burning'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.fence.buyRate).toBe(0.6);
            expect(data.fence.maxHeatLevel).toBe('burning');
        });

        it('should prevent theft victim from being a fence', async () => {
            // First steal from the intended fence
            await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testFenceId,
                itemId: testItemId
            }, ctx);

            const result = await handleTheftManage({
                action: 'register_fence',
                npcId: testFenceId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
            expect(data.message).toContain('theft victim');
        });
    });

    describe('sell action', () => {
        beforeEach(async () => {
            // Register a fence
            await handleTheftManage({
                action: 'register_fence',
                npcId: testFenceId,
                buyRate: 0.5,
                maxHeatLevel: 'burning'
            }, ctx);

            // Steal an item
            await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId
            }, ctx);
        });

        it('should sell stolen item to fence', async () => {
            const result = await handleTheftManage({
                action: 'sell',
                sellerId: testThiefId,
                fenceId: testFenceId,
                itemId: testItemId,
                itemValue: 100
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('sell');
            expect(data.price).toBeGreaterThan(0);
            expect(data.price).toBeLessThanOrEqual(100);
        });

        it('should refuse to sell non-stolen item', async () => {
            const cleanItemId = randomUUID();
            const result = await handleTheftManage({
                action: 'sell',
                sellerId: testThiefId,
                fenceId: testFenceId,
                itemId: cleanItemId,
                itemValue: 100
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
            expect(data.message).toContain('not stolen');
        });
    });

    describe('report action', () => {
        beforeEach(async () => {
            await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId
            }, ctx);
        });

        it('should report theft to guards', async () => {
            const result = await handleTheftManage({
                action: 'report',
                reporterId: testVictimId,
                itemId: testItemId,
                bountyOffered: 50
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('report');
            expect(data.bounty).toBe(50);
        });

        it('should fail for non-stolen item', async () => {
            const cleanItemId = randomUUID();
            const result = await handleTheftManage({
                action: 'report',
                reporterId: testVictimId,
                itemId: cleanItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });
    });

    describe('decay action', () => {
        it('should process heat decay', async () => {
            // Steal an item first
            await handleTheftManage({
                action: 'steal',
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId
            }, ctx);

            const result = await handleTheftManage({
                action: 'decay',
                daysAdvanced: 7
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('decay');
            expect(data.daysAdvanced).toBe(7);
            expect(data.itemsDecayed).toBeGreaterThanOrEqual(0);
        });

        it('should accept "heat_decay" alias', async () => {
            const result = await handleTheftManage({
                action: 'heat_decay',
                daysAdvanced: 1
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('decay');
        });
    });

    describe('get_fence action', () => {
        it('should return not found for non-fence', async () => {
            const result = await handleTheftManage({
                action: 'get_fence',
                npcId: testFenceId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.found).toBe(false);
        });

        it('should return fence info', async () => {
            // Register fence first
            await handleTheftManage({
                action: 'register_fence',
                npcId: testFenceId,
                buyRate: 0.5
            }, ctx);

            const result = await handleTheftManage({
                action: 'get_fence',
                npcId: testFenceId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.found).toBe(true);
            expect(data.fence.npcId).toBe(testFenceId);
            expect(data.fence.buyRate).toBe(0.5);
        });
    });

    describe('list_fences action', () => {
        it('should return empty list when no fences', async () => {
            const result = await handleTheftManage({
                action: 'list_fences'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('list_fences');
            expect(data.count).toBe(0);
        });

        it('should list all registered fences', async () => {
            // Register two fences (testFenceId and testWitnessId are both valid characters)
            await handleTheftManage({
                action: 'register_fence',
                npcId: testFenceId
            }, ctx);

            // Use testWitnessId as second fence (already created as character)
            await handleTheftManage({
                action: 'register_fence',
                npcId: testWitnessId
            }, ctx);

            const result = await handleTheftManage({
                action: 'list_fences'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.count).toBe(2);
        });

        it('should accept "fences" alias', async () => {
            const result = await handleTheftManage({
                action: 'fences'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('list_fences');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleTheftManage({
                action: 'stea',  // Missing 'l'
                thiefId: testThiefId,
                victimId: testVictimId,
                itemId: testItemId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('steal');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleTheftManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should embed JSON for parsing', async () => {
            const result = await handleTheftManage({
                action: 'list_fences'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- THEFT_MANAGE_JSON');
        });
    });
});
