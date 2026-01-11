/**
 * Tests for consolidated travel_manage tool
 * Validates all 3 actions: travel, loot, rest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleTravelManage, TravelManageTool } from '../../../src/server/consolidated/travel-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { PartyRepository } from '../../../src/storage/repos/party.repo.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- TRAVEL_MANAGE_JSON\n([\s\S]*?)\nTRAVEL_MANAGE_JSON -->/);
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

describe('travel_manage consolidated tool', () => {
    let testPartyId: string;
    let testCharacterId: string;
    let testCharacter2Id: string;
    let testPoiId: string;
    let testEncounterId: string;
    const ctx = { sessionId: 'test-session' };

    beforeEach(async () => {
        closeDb();
        const db = getDb(':memory:');
        const now = new Date().toISOString();

        // Create pois table with snake_case column names (matching implementation)
        db.exec(`
            CREATE TABLE IF NOT EXISTS pois (
                id TEXT PRIMARY KEY,
                worldId TEXT,
                name TEXT,
                type TEXT,
                x INTEGER,
                y INTEGER,
                discoveryState TEXT DEFAULT 'unknown',
                discoveryDc INTEGER DEFAULT 15,
                networkId TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        `);

        // Create rooms table
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

        // Add currentLocation column to parties if needed
        try {
            db.exec(`ALTER TABLE parties ADD COLUMN currentLocation TEXT`);
        } catch {
            // Column might already exist
        }

        // Create test characters
        const charRepo = new CharacterRepository(db);
        testCharacterId = randomUUID();
        charRepo.create({
            id: testCharacterId,
            name: 'Test Fighter',
            race: 'Human',
            characterClass: 'Fighter',
            characterType: 'pc',
            level: 5,
            hp: 30,
            maxHp: 50,
            ac: 18,
            stats: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
            createdAt: now,
            updatedAt: now
        } as any);

        testCharacter2Id = randomUUID();
        charRepo.create({
            id: testCharacter2Id,
            name: 'Test Wizard',
            race: 'Elf',
            characterClass: 'Wizard',
            characterType: 'pc',
            level: 5,
            hp: 20,
            maxHp: 35,
            ac: 12,
            stats: { str: 8, dex: 14, con: 12, int: 18, wis: 14, cha: 10 },
            createdAt: now,
            updatedAt: now
        } as any);

        // Create test party
        const partyRepo = new PartyRepository(db);
        testPartyId = randomUUID();
        partyRepo.create({
            id: testPartyId,
            name: 'Test Party',
            createdAt: now,
            updatedAt: now
        });
        partyRepo.addMember({
            id: randomUUID(),
            partyId: testPartyId,
            characterId: testCharacterId,
            role: 'leader',
            isActive: true,
            position: 0,
            sharePercentage: 50,
            joinedAt: now,
            notes: ''
        });
        partyRepo.addMember({
            id: randomUUID(),
            partyId: testPartyId,
            characterId: testCharacter2Id,
            role: 'member',
            isActive: true,
            position: 1,
            sharePercentage: 50,
            joinedAt: now,
            notes: ''
        });

        // Create test POI
        testPoiId = randomUUID();
        db.prepare(`
            INSERT INTO pois (id, worldId, name, type, x, y, discoveryState, discoveryDc, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(testPoiId, 'world-1', 'Ancient Temple', 'dungeon', 50, 75, 'discovered', 15, now, now);

        // Create test encounter and corpses directly via SQL
        testEncounterId = randomUUID();
        db.prepare(`
            INSERT INTO corpses (
                id, character_id, character_name, character_type, creature_type, cr,
                world_id, region_id, position_x, position_y, encounter_id,
                state, state_updated_at, harvestable, harvestable_resources,
                currency, looted, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            randomUUID(), randomUUID(), 'Goblin Warrior', 'enemy', 'goblin', 0.25,
            null, null, 0, 0, testEncounterId,
            'fresh', now, 0, JSON.stringify([]),
            JSON.stringify({ gold: 5, silver: 10, copper: 25 }), 0, now, now
        );
        db.prepare(`
            INSERT INTO corpses (
                id, character_id, character_name, character_type, creature_type, cr,
                world_id, region_id, position_x, position_y, encounter_id,
                state, state_updated_at, harvestable, harvestable_resources,
                currency, looted, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            randomUUID(), randomUUID(), 'Goblin Archer', 'enemy', 'goblin', 0.25,
            null, null, 0, 0, testEncounterId,
            'fresh', now, 0, JSON.stringify([]),
            JSON.stringify({ gold: 3, silver: 5, copper: 15 }), 0, now, now
        );
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(TravelManageTool.name).toBe('travel_manage');
        });

        it('should list all available actions in description', () => {
            expect(TravelManageTool.description).toContain('travel');
            expect(TravelManageTool.description).toContain('loot');
            expect(TravelManageTool.description).toContain('rest');
        });
    });

    describe('travel action', () => {
        it('should travel to discovered POI', async () => {
            const result = await handleTravelManage({
                action: 'travel',
                partyId: testPartyId,
                poiId: testPoiId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('travel');
            expect(data.destination.name).toBe('Ancient Temple');
            expect(data.discovered).toBe(true);
        });

        it('should auto-discover undiscovered POI when flag set', async () => {
            // First set POI to unknown
            const db = getDb(':memory:');
            db.prepare('UPDATE pois SET discoveryState = ? WHERE id = ?')
                .run('unknown', testPoiId);

            const result = await handleTravelManage({
                action: 'travel',
                partyId: testPartyId,
                poiId: testPoiId,
                autoDiscover: true
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.discovered).toBe(true);
        });

        it('should return error for missing partyId', async () => {
            const result = await handleTravelManage({
                action: 'travel',
                poiId: testPoiId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should return error for non-existent party', async () => {
            const result = await handleTravelManage({
                action: 'travel',
                partyId: 'non-existent',
                poiId: testPoiId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should return error for non-existent POI', async () => {
            const result = await handleTravelManage({
                action: 'travel',
                partyId: testPartyId,
                poiId: 'non-existent'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "move" alias', async () => {
            const result = await handleTravelManage({
                action: 'move',
                partyId: testPartyId,
                poiId: testPoiId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('travel');
        });
    });

    describe('loot action', () => {
        it('should loot all corpses from encounter', async () => {
            const result = await handleTravelManage({
                action: 'loot',
                encounterId: testEncounterId,
                looterId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('loot');
            expect(data.corpsesLooted).toBe(2);
            expect(data.currency.gold).toBe(8); // 5 + 3
            expect(data.currency.silver).toBe(15); // 10 + 5
        });

        it('should distribute loot evenly to party', async () => {
            const result = await handleTravelManage({
                action: 'loot',
                encounterId: testEncounterId,
                partyId: testPartyId,
                distributeEvenly: true
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.distributions.length).toBe(2); // Two party members
        });

        it('should return error for missing encounterId', async () => {
            const result = await handleTravelManage({
                action: 'loot',
                looterId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should return error when no looter specified', async () => {
            const result = await handleTravelManage({
                action: 'loot',
                encounterId: testEncounterId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "loot_encounter" alias', async () => {
            const result = await handleTravelManage({
                action: 'loot_encounter',
                encounterId: testEncounterId,
                looterId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('loot');
        });
    });

    describe('rest action', () => {
        it('should perform long rest and restore HP', async () => {
            const result = await handleTravelManage({
                action: 'rest',
                partyId: testPartyId,
                restType: 'long'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('rest');
            expect(data.restType).toBe('long');
            expect(data.members.length).toBe(2);
            // Check that HP was restored
            const fighter = data.members.find((m: any) => m.characterName === 'Test Fighter');
            expect(fighter.hpAfter).toBe(50); // maxHp
        });

        it('should perform short rest with hit dice', async () => {
            const result = await handleTravelManage({
                action: 'rest',
                partyId: testPartyId,
                restType: 'short',
                hitDicePerMember: 2
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.restType).toBe('short');
            // HP should increase (but not necessarily to max)
            expect(data.totalHealed).toBeGreaterThanOrEqual(0);
        });

        it('should use custom hit dice allocation', async () => {
            const result = await handleTravelManage({
                action: 'rest',
                partyId: testPartyId,
                restType: 'short',
                hitDiceAllocation: {
                    [testCharacterId]: 3,
                    [testCharacter2Id]: 1
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should return error for missing partyId', async () => {
            const result = await handleTravelManage({
                action: 'rest',
                restType: 'long'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should return error for non-existent party', async () => {
            const result = await handleTravelManage({
                action: 'rest',
                partyId: 'non-existent',
                restType: 'long'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "long_rest" alias', async () => {
            const result = await handleTravelManage({
                action: 'long_rest',
                partyId: testPartyId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('rest');
        });

        it('should accept "camp" alias', async () => {
            const result = await handleTravelManage({
                action: 'camp',
                partyId: testPartyId,
                restType: 'long'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('rest');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleTravelManage({
                action: 'travl',  // Missing 'e'
                partyId: testPartyId,
                poiId: testPoiId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('travel');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleTravelManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting for travel', async () => {
            const result = await handleTravelManage({
                action: 'travel',
                partyId: testPartyId,
                poiId: testPoiId
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('TRAVEL');
        });

        it('should include rich text formatting for loot', async () => {
            const result = await handleTravelManage({
                action: 'loot',
                encounterId: testEncounterId,
                looterId: testCharacterId
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('LOOT');
        });

        it('should include rich text formatting for rest', async () => {
            const result = await handleTravelManage({
                action: 'rest',
                partyId: testPartyId,
                restType: 'long'
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('REST');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleTravelManage({
                action: 'rest',
                partyId: testPartyId,
                restType: 'long'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- TRAVEL_MANAGE_JSON');
        });
    });
});
