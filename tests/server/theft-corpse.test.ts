/**
 * THEFT AND CORPSE SYSTEMS TESTS
 * Comprehensive edge case testing for HIGH-008 (Theft) and FAILED-004 (Corpse/Loot)
 *
 * Run: npm test -- tests/server/theft-corpse.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { migrate } from '../../src/storage/migrations.js';
import { TheftRepository } from '../../src/storage/repos/theft.repo.js';
import { CorpseRepository } from '../../src/storage/repos/corpse.repo.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { InventoryRepository } from '../../src/storage/repos/inventory.repo.js';
import type { HeatLevel } from '../../src/schema/theft.js';
import type { CorpseState } from '../../src/schema/corpse.js';
import { HEAT_VALUES, HEAT_DECAY_RULES, compareHeatLevels } from '../../src/schema/theft.js';
import { CORPSE_DECAY_RULES } from '../../src/schema/corpse.js';

// Test utilities
let db: Database.Database;
let theftRepo: TheftRepository;
let corpseRepo: CorpseRepository;
let charRepo: CharacterRepository;
let invRepo: InventoryRepository;

beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    theftRepo = new TheftRepository(db);
    corpseRepo = new CorpseRepository(db);
    charRepo = new CharacterRepository(db);
    invRepo = new InventoryRepository(db);
});

afterEach(() => {
    db.close();
});

// Helper functions
function createCharacter(overrides: Partial<any> = {}) {
    const id = overrides.id || uuid();
    charRepo.create({
        id,
        name: overrides.name || 'Test Character',
        worldId: 'test-world',
        type: overrides.type || 'npc',
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: 20,
        maxHp: 20,
        ac: 10,
        level: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides
    });
    return charRepo.findById(id)!;
}

function createItem(name: string, value: number = 100) {
    const itemId = uuid();
    const now = new Date().toISOString();
    // Create item in items table
    db.prepare(`
        INSERT INTO items (id, name, description, type, weight, value, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, name, '', 'misc', 1, value, now, now);
    return itemId;
}

function addItemToInventory(charId: string, itemId: string, quantity: number = 1) {
    invRepo.addItem(charId, itemId, quantity);
}

// ============================================================================
// CATEGORY 1: THEFT RECORDING
// ============================================================================
describe('Category 1: Theft Recording', () => {

    test('1.1 - recording a theft creates stolen item record', () => {
        const merchant = createCharacter({ name: 'Merchant' });
        const thief = createCharacter({ name: 'Thief' });
        const itemId = createItem('Ruby Necklace', 500);
        addItemToInventory(merchant.id, itemId);

        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id,
            stolenLocation: 'market-square'
        });

        expect(record.itemId).toBe(itemId);
        expect(record.stolenFrom).toBe(merchant.id);
        expect(record.stolenBy).toBe(thief.id);
        expect(record.stolenLocation).toBe('market-square');
    });

    test('1.2 - new theft starts at burning heat level', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Gold Ring');

        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        expect(record.heatLevel).toBe('burning');
    });

    test('1.3 - theft record includes witnesses', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const witness1 = createCharacter({ name: 'Witness 1' });
        const witness2 = createCharacter({ name: 'Witness 2' });
        const itemId = createItem('Diamond');

        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id,
            witnesses: [witness1.id, witness2.id]
        });

        expect(record.witnesses).toHaveLength(2);
        expect(record.witnesses).toContain(witness1.id);
        expect(record.witnesses).toContain(witness2.id);
    });

    test('1.4 - theft record not reported to guards by default', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Sword');

        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        expect(record.reportedToGuards).toBe(false);
        expect(record.bounty).toBe(0);
    });

    test('1.5 - can check if item is stolen', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const stolenItem = createItem('Stolen Item');
        const legitimateItem = createItem('Legitimate Item');

        theftRepo.recordTheft({
            itemId: stolenItem,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        expect(theftRepo.isStolen(stolenItem)).toBe(true);
        expect(theftRepo.isStolen(legitimateItem)).toBe(false);
    });

    test('1.6 - theft without location is valid', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Ring');

        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        expect(record.stolenLocation).toBeNull();
    });

    test('1.7 - theft without witnesses is valid', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Coin Purse');

        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        expect(record.witnesses).toEqual([]);
    });
});

// ============================================================================
// CATEGORY 2: HEAT SYSTEM
// ============================================================================
describe('Category 2: Heat System', () => {

    test('2.1 - heat levels have correct values', () => {
        expect(HEAT_VALUES.burning).toBe(100);
        expect(HEAT_VALUES.hot).toBe(50);
        expect(HEAT_VALUES.warm).toBe(25);
        expect(HEAT_VALUES.cool).toBe(10);
        expect(HEAT_VALUES.cold).toBe(5);
    });

    test('2.2 - heat decay rules are correct', () => {
        expect(HEAT_DECAY_RULES.burning_to_hot).toBe(1);
        expect(HEAT_DECAY_RULES.hot_to_warm).toBe(3);
        expect(HEAT_DECAY_RULES.warm_to_cool).toBe(7);
        expect(HEAT_DECAY_RULES.cool_to_cold).toBe(14);
    });

    test('2.3 - heat comparison works correctly', () => {
        expect(compareHeatLevels('burning', 'cold')).toBeGreaterThan(0);
        expect(compareHeatLevels('cold', 'burning')).toBeLessThan(0);
        expect(compareHeatLevels('hot', 'hot')).toBe(0);
    });

    test('2.4 - can update heat level', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Gem');

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        theftRepo.updateHeatLevel(itemId, 'hot');

        const record = theftRepo.getTheftRecord(itemId);
        expect(record?.heatLevel).toBe('hot');
    });

    test('2.5 - heat decay processing advances heat levels', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Bracelet');

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        // Advance 2 days - should decay from burning to hot
        const changes = theftRepo.processHeatDecay(2);

        expect(changes.length).toBeGreaterThanOrEqual(1);
        const change = changes.find(c => c.itemId === itemId);
        expect(change?.oldHeat).toBe('burning');
        expect(change?.newHeat).toBe('hot');
    });

    test('2.6 - heat decay respects thresholds', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Tiara');

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        // Advance 0 days - should not change
        const changes = theftRepo.processHeatDecay(0);
        const itemChange = changes.find(c => c.itemId === itemId);
        expect(itemChange).toBeUndefined();

        const record = theftRepo.getTheftRecord(itemId);
        expect(record?.heatLevel).toBe('burning');
    });
});

// ============================================================================
// CATEGORY 3: FENCE OPERATIONS
// ============================================================================
describe('Category 3: Fence Operations', () => {

    test('3.1 - can register a fence', () => {
        const fenceNpc = createCharacter({ name: 'Shady Dealer' });

        const fence = theftRepo.registerFence({
            npcId: fenceNpc.id,
            buyRate: 0.4,
            maxHeatLevel: 'hot',
            dailyHeatCapacity: 100
        });

        expect(fence.npcId).toBe(fenceNpc.id);
        expect(fence.buyRate).toBe(0.4);
        expect(fence.maxHeatLevel).toBe('hot');
    });

    test('3.2 - fence has default values', () => {
        const fenceNpc = createCharacter();

        const fence = theftRepo.registerFence({
            npcId: fenceNpc.id
        });

        expect(fence.buyRate).toBe(0.4);
        expect(fence.maxHeatLevel).toBe('hot');
        expect(fence.dailyHeatCapacity).toBe(100);
        expect(fence.cooldownDays).toBe(7);
        expect(fence.reputation).toBe(50);
    });

    test('3.3 - can list all fences', () => {
        const fence1 = createCharacter({ name: 'Fence 1' });
        const fence2 = createCharacter({ name: 'Fence 2' });

        theftRepo.registerFence({ npcId: fence1.id });
        theftRepo.registerFence({ npcId: fence2.id });

        const fences = theftRepo.listFences();
        expect(fences.length).toBe(2);
    });

    test('3.4 - can list fences by faction', () => {
        const guildFence = createCharacter({ name: 'Guild Fence' });
        const independentFence = createCharacter({ name: 'Independent' });

        theftRepo.registerFence({ npcId: guildFence.id, factionId: 'thieves-guild' });
        theftRepo.registerFence({ npcId: independentFence.id });

        const guildFences = theftRepo.listFences('thieves-guild');
        expect(guildFences.length).toBe(1);
        expect(guildFences[0].npcId).toBe(guildFence.id);
    });

    test('3.5 - fence accepts items within heat tolerance', () => {
        const fenceNpc = createCharacter();
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Loot', 200);

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            maxHeatLevel: 'hot',
            buyRate: 0.5
        });

        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        // Burning is hotter than hot - should reject
        const result = theftRepo.canFenceAccept(fenceNpc.id, record, 200);
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('too hot');
    });

    test('3.6 - fence accepts cooled down items', () => {
        const fenceNpc = createCharacter();
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Cooled Loot', 200);

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            maxHeatLevel: 'hot',
            buyRate: 0.5,
            dailyHeatCapacity: 200
        });

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        // Cool it down
        theftRepo.updateHeatLevel(itemId, 'warm');

        const record = theftRepo.getTheftRecord(itemId)!;
        const result = theftRepo.canFenceAccept(fenceNpc.id, record, 200);
        expect(result.accepted).toBe(true);
        expect(result.price).toBe(100); // 200 * 0.5
    });

    test('3.7 - fence respects daily capacity', () => {
        const fenceNpc = createCharacter();
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Heavy Item', 500);

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            maxHeatLevel: 'warm',
            dailyHeatCapacity: 20
        });

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        // Cool it to warm (value 25)
        theftRepo.updateHeatLevel(itemId, 'warm');

        const record = theftRepo.getTheftRecord(itemId)!;
        const result = theftRepo.canFenceAccept(fenceNpc.id, record, 500);
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('capacity');
    });

    test('3.8 - fence transaction updates heat capacity', () => {
        const fenceNpc = createCharacter();
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Small Item', 100);

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            maxHeatLevel: 'cold',
            dailyHeatCapacity: 100
        });

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        theftRepo.updateHeatLevel(itemId, 'cold');
        theftRepo.recordFenceTransaction(fenceNpc.id, itemId, 'cold');

        const fence = theftRepo.getFence(fenceNpc.id);
        expect(fence?.currentDailyHeat).toBe(5); // cold = 5
    });

    test('3.9 - daily capacity resets', () => {
        const fenceNpc = createCharacter();

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            dailyHeatCapacity: 100
        });

        // Manually update current heat
        db.prepare('UPDATE fence_npcs SET current_daily_heat = 50 WHERE npc_id = ?')
            .run(fenceNpc.id);

        theftRepo.resetFenceDailyCapacity();

        const fence = theftRepo.getFence(fenceNpc.id);
        expect(fence?.currentDailyHeat).toBe(0);
    });
});

// ============================================================================
// CATEGORY 4: THEFT RESOLUTION
// ============================================================================
describe('Category 4: Theft Resolution', () => {

    test('4.1 - can report theft to guards', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Valuable');

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        theftRepo.reportToGuards(itemId, 100);

        const record = theftRepo.getTheftRecord(itemId);
        expect(record?.reportedToGuards).toBe(true);
        expect(record?.bounty).toBe(100);
    });

    test('4.2 - can mark item as recovered', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Recovered Item');

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        theftRepo.markRecovered(itemId);

        expect(theftRepo.isStolen(itemId)).toBe(false);
    });

    test('4.3 - can mark item as fenced', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const fenceNpc = createCharacter();
        const itemId = createItem('Fenced Item');

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        theftRepo.markFenced(itemId, fenceNpc.id);

        const record = theftRepo.getTheftRecord(itemId);
        expect(record?.fenced).toBe(true);
        expect(record?.fencedTo).toBe(fenceNpc.id);
    });

    test('4.4 - can clear stolen flag completely', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Cleared Item');

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        theftRepo.clearStolenFlag(itemId);

        const record = theftRepo.getTheftRecord(itemId);
        expect(record).toBeNull();
    });

    test('4.5 - get all active thefts', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const item1 = createItem('Item 1');
        const item2 = createItem('Item 2');
        const item3 = createItem('Item 3');

        theftRepo.recordTheft({ itemId: item1, stolenFrom: merchant.id, stolenBy: thief.id });
        theftRepo.recordTheft({ itemId: item2, stolenFrom: merchant.id, stolenBy: thief.id });
        theftRepo.recordTheft({ itemId: item3, stolenFrom: merchant.id, stolenBy: thief.id });

        // Recover one
        theftRepo.markRecovered(item2);

        const active = theftRepo.getAllActiveThefts();
        expect(active.length).toBe(2);
    });
});

// ============================================================================
// CATEGORY 5: CORPSE CREATION
// ============================================================================
describe('Category 5: Corpse Creation', () => {

    test('5.1 - can create corpse from character', () => {
        const character = createCharacter({ name: 'Fallen Hero' });

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'pc',
            { worldId: 'test-world', position: { x: 5, y: 10 } }
        );

        expect(corpse.characterId).toBe(character.id);
        expect(corpse.characterName).toBe('Fallen Hero');
        expect(corpse.state).toBe('fresh');
    });

    test('5.2 - corpse starts as fresh', () => {
        const character = createCharacter();

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'npc',
            { worldId: 'test-world' }
        );

        expect(corpse.state).toBe('fresh');
    });

    test('5.3 - corpse includes position', () => {
        const character = createCharacter();

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { worldId: 'test-world', position: { x: 10, y: 20 } }
        );

        expect(corpse.position?.x).toBe(10);
        expect(corpse.position?.y).toBe(20);
    });

    test('5.4 - corpse can have creature type for loot lookup', () => {
        const goblin = createCharacter({ name: 'Goblin Scout' });

        const corpse = corpseRepo.createFromDeath(
            goblin.id,
            goblin.name,
            'enemy',
            { creatureType: 'goblin', cr: 0.25, worldId: 'test-world' }
        );

        expect(corpse.creatureType).toBe('goblin');
        expect(corpse.cr).toBe(0.25);
    });

    test('5.5 - corpse can be linked to encounter', () => {
        const character = createCharacter();
        const encounterId = uuid();

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { worldId: 'test-world', encounterId }
        );

        expect(corpse.encounterId).toBe(encounterId);
    });

    test('5.6 - can find corpse by ID', () => {
        const character = createCharacter();

        const created = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'npc',
            { worldId: 'test-world' }
        );

        const found = corpseRepo.findById(created.id);
        expect(found?.id).toBe(created.id);
    });

    test('5.7 - can find corpse by character ID', () => {
        const character = createCharacter();

        corpseRepo.createFromDeath(
            character.id,
            character.name,
            'pc',
            { worldId: 'test-world' }
        );

        const found = corpseRepo.findByCharacterId(character.id);
        expect(found?.characterId).toBe(character.id);
    });

    test('5.8 - can find corpses in encounter', () => {
        const encounterId = uuid();
        const char1 = createCharacter({ name: 'Goblin 1' });
        const char2 = createCharacter({ name: 'Goblin 2' });

        corpseRepo.createFromDeath(
            char1.id,
            char1.name,
            'enemy',
            { worldId: 'test-world', encounterId }
        );

        corpseRepo.createFromDeath(
            char2.id,
            char2.name,
            'enemy',
            { worldId: 'test-world', encounterId }
        );

        const corpses = corpseRepo.findByEncounterId(encounterId);
        expect(corpses.length).toBe(2);
    });
});

// ============================================================================
// CATEGORY 6: CORPSE DECAY
// ============================================================================
describe('Category 6: Corpse Decay', () => {

    test('6.1 - decay rules are correct', () => {
        expect(CORPSE_DECAY_RULES.fresh_to_decaying).toBe(24);
        expect(CORPSE_DECAY_RULES.decaying_to_skeletal).toBe(168);
        expect(CORPSE_DECAY_RULES.skeletal_to_gone).toBe(720);
    });

    test('6.2 - decay processing advances corpse state', () => {
        const character = createCharacter();

        corpseRepo.createFromDeath(
            character.id,
            character.name,
            'npc',
            { worldId: 'test-world' }
        );

        // Advance 30 hours
        const changes = corpseRepo.processDecay(30);

        expect(changes.length).toBeGreaterThanOrEqual(1);
        expect(changes[0].newState).toBe('decaying');
    });

    test('6.3 - cleanup removes gone corpses', () => {
        const character = createCharacter();

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'npc',
            { worldId: 'test-world' }
        );

        // Manually set state to gone
        db.prepare('UPDATE corpses SET state = ? WHERE id = ?').run('gone', corpse.id);

        const removed = corpseRepo.cleanupGoneCorpses();
        expect(removed).toBe(1);

        const found = corpseRepo.findById(corpse.id);
        expect(found).toBeNull();
    });

    test('6.4 - fresh corpse does not decay without time', () => {
        const character = createCharacter();

        corpseRepo.createFromDeath(
            character.id,
            character.name,
            'npc',
            { worldId: 'test-world' }
        );

        const changes = corpseRepo.processDecay(0);
        expect(changes.length).toBe(0);
    });
});

// ============================================================================
// CATEGORY 7: CORPSE LOOTING
// ============================================================================
describe('Category 7: Corpse Looting', () => {

    test('7.1 - can add items to corpse inventory', () => {
        const character = createCharacter();

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { worldId: 'test-world' }
        );

        const itemId = createItem('Goblin Sword');
        corpseRepo.addToCorpseInventory(corpse.id, itemId, 1);

        const inventory = corpseRepo.getCorpseInventory(corpse.id);
        expect(inventory.length).toBe(1);
        expect(inventory[0].itemId).toBe(itemId);
    });

    test('7.2 - can loot single item from corpse', () => {
        const character = createCharacter();
        const looter = createCharacter({ name: 'Looter' });

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { worldId: 'test-world' }
        );

        const itemId = createItem('Gold Coins');
        corpseRepo.addToCorpseInventory(corpse.id, itemId, 10);

        const looted = corpseRepo.lootItem(corpse.id, itemId, looter.id);
        expect(looted.success).toBe(true);
        expect(looted.quantity).toBe(10);

        // Item should be removed from corpse (looted flag set)
        const available = corpseRepo.getAvailableLoot(corpse.id);
        expect(available.length).toBe(0);
    });

    test('7.3 - can loot all items from corpse', () => {
        const character = createCharacter();
        const looter = createCharacter({ name: 'Greedy Looter' });

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { worldId: 'test-world' }
        );

        corpseRepo.addToCorpseInventory(corpse.id, createItem('Item 1'), 1);
        corpseRepo.addToCorpseInventory(corpse.id, createItem('Item 2'), 1);
        corpseRepo.addToCorpseInventory(corpse.id, createItem('Item 3'), 1);

        const looted = corpseRepo.lootAll(corpse.id, looter.id);
        expect(looted.length).toBe(3);

        const available = corpseRepo.getAvailableLoot(corpse.id);
        expect(available.length).toBe(0);

        const corpseAfter = corpseRepo.findById(corpse.id);
        expect(corpseAfter?.looted).toBe(true);
    });

    test('7.4 - looting marks corpse as looted', () => {
        const character = createCharacter();
        const looter = createCharacter();

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { worldId: 'test-world' }
        );

        corpseRepo.addToCorpseInventory(corpse.id, createItem('Loot'), 1);
        corpseRepo.lootAll(corpse.id, looter.id);

        const updated = corpseRepo.findById(corpse.id);
        expect(updated?.looted).toBe(true);
        expect(updated?.lootedBy).toBe(looter.id);
    });
});

// ============================================================================
// CATEGORY 8: LOOT GENERATION
// ============================================================================
describe('Category 8: Loot Generation', () => {

    test('8.1 - can create loot table', () => {
        const table = corpseRepo.createLootTable({
            name: 'Test Loot',
            creatureTypes: ['test'],
            guaranteedDrops: [],
            randomDrops: []
        });

        expect(table.name).toBe('Test Loot');
        expect(table.creatureTypes).toContain('test');
    });

    test('8.2 - can find loot table by creature type', () => {
        corpseRepo.createLootTable({
            name: 'Goblin Loot',
            creatureTypes: ['goblin', 'hobgoblin'],
            guaranteedDrops: [],
            randomDrops: []
        });

        const found = corpseRepo.findLootTableByCreatureType('goblin');
        expect(found).not.toBeNull();
        expect(found?.name).toBe('Goblin Loot');
    });

    test('8.3 - can list all loot tables', () => {
        corpseRepo.createLootTable({
            name: 'Table 1',
            creatureTypes: ['type1'],
            guaranteedDrops: [],
            randomDrops: []
        });

        corpseRepo.createLootTable({
            name: 'Table 2',
            creatureTypes: ['type2'],
            guaranteedDrops: [],
            randomDrops: []
        });

        const tables = corpseRepo.listLootTables();
        expect(tables.length).toBe(2);
    });

    test('8.4 - loot table supports CR ranges', () => {
        corpseRepo.createLootTable({
            name: 'Low CR Loot',
            creatureTypes: ['lowcr'],
            crRange: { min: 0, max: 2 },
            guaranteedDrops: [],
            randomDrops: []
        });

        const found = corpseRepo.findLootTableByCreatureType('lowcr', 1);
        expect(found).not.toBeNull();
    });

    test('8.5 - loot generation creates inventory items', () => {
        const character = createCharacter({ name: 'Goblin' });

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { creatureType: 'goblin', cr: 0.25, worldId: 'test-world' }
        );

        // Create a simple loot table
        corpseRepo.createLootTable({
            name: 'Test Goblin Loot',
            creatureTypes: ['goblin'],
            guaranteedDrops: [
                { itemId: null, itemTemplateId: null, itemName: 'Goblin Ear', quantity: { min: 1, max: 1 }, weight: 1 }
            ],
            randomDrops: []
        });

        const result = corpseRepo.generateLoot(corpse.id, 'goblin', 0.25);

        const updated = corpseRepo.findById(corpse.id);
        expect(updated?.lootGenerated).toBe(true);

        // Check that items were generated
        expect(result.itemsAdded.length).toBeGreaterThanOrEqual(1);
    });
});

// ============================================================================
// CATEGORY 9: HARVESTING
// ============================================================================
describe('Category 9: Harvesting', () => {

    test('9.1 - corpse can have harvestable resources', () => {
        const character = createCharacter({ name: 'Wolf' });

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            {
                creatureType: 'wolf',
                worldId: 'test-world'
            }
        );

        // Add harvestable resources via direct SQL (as would be done by generateLoot)
        const resources = [
            { resourceType: 'wolf pelt', quantity: 1, harvested: false },
            { resourceType: 'wolf fang', quantity: 2, harvested: false }
        ];
        db.prepare('UPDATE corpses SET harvestable = 1, harvestable_resources = ? WHERE id = ?')
            .run(JSON.stringify(resources), corpse.id);

        const updated = corpseRepo.findById(corpse.id)!;

        expect(updated.harvestable).toBe(true);
        expect(updated.harvestableResources.length).toBe(2);
    });

    test('9.2 - can harvest resources', () => {
        const character = createCharacter({ name: 'Dead Wolf' });
        const harvester = createCharacter({ name: 'Hunter' });

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { worldId: 'test-world' }
        );

        // Add harvestable resources via direct SQL
        const resources = [{ resourceType: 'wolf pelt', quantity: 1, harvested: false }];
        db.prepare('UPDATE corpses SET harvestable = 1, harvestable_resources = ? WHERE id = ?')
            .run(JSON.stringify(resources), corpse.id);

        const result = corpseRepo.harvestResource(corpse.id, 'wolf pelt', harvester.id);
        expect(result.success).toBe(true);
        expect(result.quantity).toBe(1);
    });

    test('9.3 - harvesting marks resource as harvested', () => {
        const character = createCharacter();
        const harvester = createCharacter();

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { worldId: 'test-world' }
        );

        // Add harvestable resources via direct SQL
        const resources = [{ resourceType: 'hide', quantity: 1, harvested: false }];
        db.prepare('UPDATE corpses SET harvestable = 1, harvestable_resources = ? WHERE id = ?')
            .run(JSON.stringify(resources), corpse.id);

        corpseRepo.harvestResource(corpse.id, 'hide', harvester.id);

        const updated = corpseRepo.findById(corpse.id);
        const resource = updated?.harvestableResources.find(r => r.resourceType === 'hide');
        expect(resource?.harvested).toBe(true);
    });

    test('9.4 - cannot harvest already harvested resource', () => {
        const character = createCharacter();
        const harvester = createCharacter();

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'enemy',
            { worldId: 'test-world' }
        );

        // Add harvestable resources via direct SQL
        const resources = [{ resourceType: 'bone', quantity: 1, harvested: false }];
        db.prepare('UPDATE corpses SET harvestable = 1, harvestable_resources = ? WHERE id = ?')
            .run(JSON.stringify(resources), corpse.id);

        // First harvest succeeds
        const first = corpseRepo.harvestResource(corpse.id, 'bone', harvester.id);
        expect(first.success).toBe(true);

        // Second harvest fails
        const second = corpseRepo.harvestResource(corpse.id, 'bone', harvester.id);
        expect(second.success).toBe(false);
    });
});

// ============================================================================
// CATEGORY 10: EDGE CASES
// ============================================================================
describe('Category 10: Edge Cases', () => {

    test('10.1 - non-existent fence returns null', () => {
        const fence = theftRepo.getFence('non-existent');
        expect(fence).toBeNull();
    });

    test('10.2 - non-existent theft record returns null', () => {
        const record = theftRepo.getTheftRecord('non-existent');
        expect(record).toBeNull();
    });

    test('10.3 - non-existent corpse returns null', () => {
        const corpse = corpseRepo.findById('non-existent');
        expect(corpse).toBeNull();
    });

    test('10.4 - empty fence list returns empty array', () => {
        const fences = theftRepo.listFences();
        expect(fences).toEqual([]);
    });

    test('10.5 - empty loot table list returns empty array', () => {
        const tables = corpseRepo.listLootTables();
        expect(tables).toEqual([]);
    });

    test('10.6 - looting empty corpse returns empty array', () => {
        const character = createCharacter();
        const looter = createCharacter();

        const corpse = corpseRepo.createFromDeath(
            character.id,
            character.name,
            'npc',
            { worldId: 'test-world' }
        );

        const looted = corpseRepo.lootAll(corpse.id, looter.id);
        expect(looted).toEqual([]);
    });

    test('10.7 - heat decay with no stolen items returns empty array', () => {
        const changes = theftRepo.processHeatDecay(100);
        expect(changes).toEqual([]);
    });

    test('10.8 - corpse decay with no corpses returns empty array', () => {
        const changes = corpseRepo.processDecay(100);
        expect(changes).toEqual([]);
    });

    test('10.9 - cleanup with no gone corpses returns 0', () => {
        const removed = corpseRepo.cleanupGoneCorpses();
        expect(removed).toBe(0);
    });

    test('10.10 - fence specializations are stored correctly', () => {
        const fenceNpc = createCharacter();

        const fence = theftRepo.registerFence({
            npcId: fenceNpc.id,
            specializations: ['jewelry', 'gems', 'art']
        });

        expect(fence.specializations).toHaveLength(3);
        expect(fence.specializations).toContain('jewelry');
    });
});

// ============================================================================
// CATEGORY 11: OPTIONAL ITEM TRANSFERS
// ============================================================================
describe('Category 11: Optional Item Transfers', () => {

    test('11.1 - theft without transfer keeps item in victim inventory', () => {
        const merchant = createCharacter({ name: 'Merchant' });
        const thief = createCharacter({ name: 'Thief' });
        const itemId = createItem('Stolen Ring', 100);
        addItemToInventory(merchant.id, itemId);

        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id,
            transferItem: false
        });

        expect(record.transferred).toBe(false);

        // Item still in merchant inventory
        const merchantInv = invRepo.getInventory(merchant.id);
        expect(merchantInv.items.some(i => i.itemId === itemId)).toBe(true);

        // Not in thief inventory
        const thiefInv = invRepo.getInventory(thief.id);
        expect(thiefInv.items.some(i => i.itemId === itemId)).toBe(false);
    });

    test('11.2 - theft with transfer moves item to thief inventory', () => {
        const merchant = createCharacter({ name: 'Victim' });
        const thief = createCharacter({ name: 'Burglar' });
        const itemId = createItem('Golden Chalice', 500);
        addItemToInventory(merchant.id, itemId);

        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id,
            transferItem: true
        });

        expect(record.transferred).toBe(true);

        // Item removed from merchant inventory
        const merchantInv = invRepo.getInventory(merchant.id);
        expect(merchantInv.items.some(i => i.itemId === itemId)).toBe(false);

        // Item now in thief inventory
        const thiefInv = invRepo.getInventory(thief.id);
        expect(thiefInv.items.some(i => i.itemId === itemId)).toBe(true);
    });

    test('11.3 - loot without transfer tracks but does not add to inventory', () => {
        const enemy = createCharacter({ name: 'Goblin' });
        const hero = createCharacter({ name: 'Hero' });

        const corpse = corpseRepo.createFromDeath(
            enemy.id,
            enemy.name,
            'enemy',
            { worldId: 'test-world' }
        );

        const lootItem = createItem('Goblin Dagger');
        corpseRepo.addToCorpseInventory(corpse.id, lootItem, 1);

        const result = corpseRepo.lootItem(corpse.id, lootItem, hero.id, 1, false);

        expect(result.success).toBe(true);
        expect(result.transferred).toBe(false);

        // Item NOT in hero inventory (narrative only)
        const heroInv = invRepo.getInventory(hero.id);
        expect(heroInv.items.some(i => i.itemId === lootItem)).toBe(false);
    });

    test('11.4 - loot with transfer adds item to looter inventory', () => {
        const enemy = createCharacter({ name: 'Orc' });
        const hero = createCharacter({ name: 'Adventurer' });

        const corpse = corpseRepo.createFromDeath(
            enemy.id,
            enemy.name,
            'enemy',
            { worldId: 'test-world' }
        );

        const lootItem = createItem('Orc Blade');
        corpseRepo.addToCorpseInventory(corpse.id, lootItem, 1);

        const result = corpseRepo.lootItem(corpse.id, lootItem, hero.id, 1, true);

        expect(result.success).toBe(true);
        expect(result.transferred).toBe(true);

        // Item IS in hero inventory
        const heroInv = invRepo.getInventory(hero.id);
        expect(heroInv.items.some(i => i.itemId === lootItem)).toBe(true);
    });

    test('11.5 - lootAll with transfer adds all items to looter', () => {
        const enemy = createCharacter({ name: 'Bandit' });
        const hero = createCharacter({ name: 'Sheriff' });

        const corpse = corpseRepo.createFromDeath(
            enemy.id,
            enemy.name,
            'enemy',
            { worldId: 'test-world' }
        );

        const item1 = createItem('Gold Coins');
        const item2 = createItem('Silver Ring');
        const item3 = createItem('Dagger');
        corpseRepo.addToCorpseInventory(corpse.id, item1, 10);
        corpseRepo.addToCorpseInventory(corpse.id, item2, 1);
        corpseRepo.addToCorpseInventory(corpse.id, item3, 1);

        const results = corpseRepo.lootAll(corpse.id, hero.id, true);

        expect(results.length).toBe(3);
        expect(results.every(r => r.transferred)).toBe(true);

        // All items in hero inventory
        const heroInv = invRepo.getInventory(hero.id);
        expect(heroInv.items.some(i => i.itemId === item1)).toBe(true);
        expect(heroInv.items.some(i => i.itemId === item2)).toBe(true);
        expect(heroInv.items.some(i => i.itemId === item3)).toBe(true);
    });

    test('11.6 - theft transfer with quantity moves correct amount', () => {
        const merchant = createCharacter({ name: 'Coin Vendor' });
        const thief = createCharacter({ name: 'Pickpocket' });
        const coinId = createItem('Gold Coins', 1);
        addItemToInventory(merchant.id, coinId, 100); // 100 coins

        const record = theftRepo.recordTheft({
            itemId: coinId,
            stolenFrom: merchant.id,
            stolenBy: thief.id,
            transferItem: true,
            quantity: 25 // Steal only 25
        });

        expect(record.transferred).toBe(true);

        // Merchant has 75 left
        const merchantInv = invRepo.getInventory(merchant.id);
        const merchantCoins = merchantInv.items.find(i => i.itemId === coinId);
        expect(merchantCoins?.quantity).toBe(75);

        // Thief has 25
        const thiefInv = invRepo.getInventory(thief.id);
        const thiefCoins = thiefInv.items.find(i => i.itemId === coinId);
        expect(thiefCoins?.quantity).toBe(25);
    });

    test('11.7 - default behavior is no transfer (backwards compatible)', () => {
        const merchant = createCharacter();
        const thief = createCharacter();
        const itemId = createItem('Test Item');
        addItemToInventory(merchant.id, itemId);

        // No transferItem parameter
        const record = theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        // Should default to no transfer
        expect(record.transferred).toBe(false);
    });
});

// ============================================================================
// CATEGORY 12: CURRENCY OPERATIONS
// ============================================================================
describe('Category 12: Currency Operations', () => {

    test('12.1 - new character starts with zero currency', () => {
        const character = createCharacter({ name: 'Penniless' });

        const currency = invRepo.getCurrency(character.id);

        expect(currency.gold).toBe(0);
        expect(currency.silver).toBe(0);
        expect(currency.copper).toBe(0);
    });

    test('12.2 - can set currency for character', () => {
        const character = createCharacter({ name: 'Wealthy' });

        invRepo.setCurrency(character.id, { gold: 100, silver: 50, copper: 25 });

        const currency = invRepo.getCurrency(character.id);
        expect(currency.gold).toBe(100);
        expect(currency.silver).toBe(50);
        expect(currency.copper).toBe(25);
    });

    test('12.3 - can add currency to character', () => {
        const character = createCharacter({ name: 'Earner' });
        invRepo.setCurrency(character.id, { gold: 10 });

        const updated = invRepo.addCurrency(character.id, { gold: 5, silver: 30 });

        expect(updated.gold).toBe(15);
        expect(updated.silver).toBe(30);
        expect(updated.copper).toBe(0);
    });

    test('12.4 - can remove currency from character', () => {
        const character = createCharacter({ name: 'Spender' });
        invRepo.setCurrency(character.id, { gold: 50, silver: 20 });

        const success = invRepo.removeCurrency(character.id, { gold: 30, silver: 10 });

        expect(success).toBe(true);
        const currency = invRepo.getCurrency(character.id);
        expect(currency.gold).toBe(20);
        expect(currency.silver).toBe(10);
    });

    test('12.5 - cannot remove more currency than available', () => {
        const character = createCharacter({ name: 'Poor' });
        invRepo.setCurrency(character.id, { gold: 10 });

        const success = invRepo.removeCurrency(character.id, { gold: 50 });

        expect(success).toBe(false);
        // Currency should be unchanged
        const currency = invRepo.getCurrency(character.id);
        expect(currency.gold).toBe(10);
    });

    test('12.6 - can transfer currency between characters', () => {
        const giver = createCharacter({ name: 'Giver' });
        const receiver = createCharacter({ name: 'Receiver' });
        invRepo.setCurrency(giver.id, { gold: 100 });

        const success = invRepo.transferCurrency(giver.id, receiver.id, { gold: 40 });

        expect(success).toBe(true);
        expect(invRepo.getCurrency(giver.id).gold).toBe(60);
        expect(invRepo.getCurrency(receiver.id).gold).toBe(40);
    });

    test('12.7 - currency transfer fails if insufficient funds', () => {
        const giver = createCharacter({ name: 'Broke Giver' });
        const receiver = createCharacter({ name: 'Hopeful Receiver' });
        invRepo.setCurrency(giver.id, { gold: 10 });

        const success = invRepo.transferCurrency(giver.id, receiver.id, { gold: 50 });

        expect(success).toBe(false);
        // Neither should have changed
        expect(invRepo.getCurrency(giver.id).gold).toBe(10);
        expect(invRepo.getCurrency(receiver.id).gold).toBe(0);
    });

    test('12.8 - hasCurrency checks correctly', () => {
        const character = createCharacter({ name: 'Checker' });
        invRepo.setCurrency(character.id, { gold: 50, silver: 25 });

        expect(invRepo.hasCurrency(character.id, { gold: 30 })).toBe(true);
        expect(invRepo.hasCurrency(character.id, { gold: 50, silver: 25 })).toBe(true);
        expect(invRepo.hasCurrency(character.id, { gold: 100 })).toBe(false);
    });

    test('12.9 - hasCurrency works with mixed denominations', () => {
        const character = createCharacter({ name: 'Mixed' });
        // 50 gold = 5000 copper, 25 silver = 250 copper, 10 copper = 10 copper
        // Total: 5260 copper
        invRepo.setCurrency(character.id, { gold: 50, silver: 25, copper: 10 });

        // 52 gold 60 copper = 5260 copper - should have exactly enough
        expect(invRepo.hasCurrency(character.id, { gold: 52, copper: 60 })).toBe(true);
        // 53 gold = 5300 copper - should not have enough
        expect(invRepo.hasCurrency(character.id, { gold: 53 })).toBe(false);
    });

    test('12.10 - inventory includes currency', () => {
        const character = createCharacter({ name: 'Investor' });
        invRepo.setCurrency(character.id, { gold: 75, silver: 50, copper: 100 });

        const inventory = invRepo.getInventory(character.id);

        expect(inventory.currency.gold).toBe(75);
        expect(inventory.currency.silver).toBe(50);
        expect(inventory.currency.copper).toBe(100);
    });
});

// ============================================================================
// CATEGORY 13: FENCE PAYMENT
// ============================================================================
describe('Category 13: Fence Payment', () => {

    test('13.1 - fence transaction without payment (narrative only)', () => {
        const fenceNpc = createCharacter({ name: 'Narrative Fence' });
        const thief = createCharacter({ name: 'Narrative Thief' });
        const merchant = createCharacter({ name: 'Victim' });
        const itemId = createItem('Stolen Goods', 200);

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            maxHeatLevel: 'cold',
            buyRate: 0.5
        });

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        // Cool the item down
        theftRepo.updateHeatLevel(itemId, 'cold');

        const result = theftRepo.recordFenceTransaction(fenceNpc.id, itemId, 'cold');

        expect(result.fenced).toBe(true);
        expect(result.paid).toBe(false);
        expect(result.amountPaid).toBeUndefined();

        // Thief should have no gold
        expect(invRepo.getCurrency(thief.id).gold).toBe(0);
    });

    test('13.2 - fence transaction with payment', () => {
        const fenceNpc = createCharacter({ name: 'Paying Fence' });
        const thief = createCharacter({ name: 'Paid Thief' });
        const merchant = createCharacter({ name: 'Another Victim' });
        const itemId = createItem('Valuable Loot', 500);

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            maxHeatLevel: 'cold',
            buyRate: 0.4 // 40%
        });

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });

        // Cool the item down
        theftRepo.updateHeatLevel(itemId, 'cold');

        // Calculate price (500 * 0.4 = 200 gold)
        const result = theftRepo.recordFenceTransaction(fenceNpc.id, itemId, 'cold', {
            paySeller: true,
            sellerId: thief.id,
            price: 200
        });

        expect(result.fenced).toBe(true);
        expect(result.paid).toBe(true);
        expect(result.amountPaid).toBe(200);

        // Thief should have the gold
        expect(invRepo.getCurrency(thief.id).gold).toBe(200);
    });

    test('13.3 - fence payment accumulates with existing gold', () => {
        const fenceNpc = createCharacter({ name: 'Second Fence' });
        const thief = createCharacter({ name: 'Repeat Thief' });
        const merchant = createCharacter({ name: 'Merchant 2' });

        // Thief already has some gold
        invRepo.setCurrency(thief.id, { gold: 50 });

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            maxHeatLevel: 'cold',
            buyRate: 0.5
        });

        const itemId = createItem('Another Item', 100);
        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });
        theftRepo.updateHeatLevel(itemId, 'cold');

        theftRepo.recordFenceTransaction(fenceNpc.id, itemId, 'cold', {
            paySeller: true,
            sellerId: thief.id,
            price: 50 // 100 * 0.5
        });

        // Thief should have 50 + 50 = 100 gold
        expect(invRepo.getCurrency(thief.id).gold).toBe(100);
    });

    test('13.4 - canFenceAccept calculates correct price', () => {
        const fenceNpc = createCharacter({ name: 'Price Fence' });
        const merchant = createCharacter({ name: 'Price Victim' });
        const thief = createCharacter({ name: 'Price Thief' });
        const itemId = createItem('Priced Item', 1000);

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            maxHeatLevel: 'cold',
            buyRate: 0.35, // 35%
            dailyHeatCapacity: 100
        });

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });
        theftRepo.updateHeatLevel(itemId, 'cold');

        const record = theftRepo.getTheftRecord(itemId)!;
        const result = theftRepo.canFenceAccept(fenceNpc.id, record, 1000);

        expect(result.accepted).toBe(true);
        expect(result.price).toBe(350); // 1000 * 0.35
    });

    test('13.5 - default fence transaction behavior is no payment (backwards compatible)', () => {
        const fenceNpc = createCharacter({ name: 'Default Fence' });
        const merchant = createCharacter({ name: 'Default Victim' });
        const thief = createCharacter({ name: 'Default Thief' });
        const itemId = createItem('Default Item', 100);

        theftRepo.registerFence({
            npcId: fenceNpc.id,
            maxHeatLevel: 'cold'
        });

        theftRepo.recordTheft({
            itemId,
            stolenFrom: merchant.id,
            stolenBy: thief.id
        });
        theftRepo.updateHeatLevel(itemId, 'cold');

        // Call without options (backwards compatible)
        const result = theftRepo.recordFenceTransaction(fenceNpc.id, itemId, 'cold');

        expect(result.fenced).toBe(true);
        expect(result.paid).toBe(false);
        expect(invRepo.getCurrency(thief.id).gold).toBe(0);
    });
});
