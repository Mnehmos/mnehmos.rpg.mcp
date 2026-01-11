import { describe, it, expect, beforeEach } from 'vitest';
import { handleScrollManage, ScrollManageTool } from '../../../src/server/consolidated/scroll-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { ItemRepository } from '../../../src/storage/repos/item.repo.js';
import { InventoryRepository } from '../../../src/storage/repos/inventory.repo.js';
import { randomUUID } from 'crypto';

describe('scroll_manage consolidated tool', () => {
    let characterId: string;
    let db: ReturnType<typeof getDb>;
    let characterRepo: CharacterRepository;
    let itemRepo: ItemRepository;
    let inventoryRepo: InventoryRepository;

    beforeEach(() => {
        closeDb();
        db = getDb(':memory:');
        characterRepo = new CharacterRepository(db);
        itemRepo = new ItemRepository(db);
        inventoryRepo = new InventoryRepository(db);

        // Create a test wizard character
        characterId = randomUUID();
        const now = new Date().toISOString();
        characterRepo.create({
            id: characterId,
            name: 'Test Wizard',
            characterType: 'pc',
            level: 5,
            hp: 25,
            maxHp: 25,
            ac: 12,
            stats: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
            characterClass: 'wizard',
            createdAt: now,
            updatedAt: now
        });
    });

    const ctx = { worldId: '', partyId: '', encounterContext: null };

    describe('tool definition', () => {
        it('should have correct name and description', () => {
            expect(ScrollManageTool.name).toBe('scroll_manage');
            expect(ScrollManageTool.description).toContain('scroll');
        });

        it('should list all actions in description', () => {
            expect(ScrollManageTool.description).toContain('use');
            expect(ScrollManageTool.description).toContain('create');
            expect(ScrollManageTool.description).toContain('identify');
            expect(ScrollManageTool.description).toContain('get_dc');
            expect(ScrollManageTool.description).toContain('get');
            expect(ScrollManageTool.description).toContain('check');
        });
    });

    describe('action: create', () => {
        it('should create a spell scroll', async () => {
            const result = await handleScrollManage({
                action: 'create',
                spellName: 'Fireball',
                spellLevel: 3,
                spellClass: 'wizard'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.scrollId).toBeDefined();
            expect(parsed.spellName).toBe('Fireball');
            expect(parsed.spellLevel).toBe(3);
            expect(parsed.spellClass).toBe('wizard');
            expect(parsed.message).toContain('Created scroll');
        });

        it('should create cantrip scroll (level 0)', async () => {
            const result = await handleScrollManage({
                action: 'create',
                spellName: 'Fire Bolt',
                spellLevel: 0
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.spellLevel).toBe(0);
        });

        it('should use custom DC and attack bonus', async () => {
            const result = await handleScrollManage({
                action: 'create',
                spellName: 'Lightning Bolt',
                spellLevel: 3,
                scrollDC: 15,
                scrollAttackBonus: 7
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.scrollDC).toBe(15);
            expect(parsed.scrollAttackBonus).toBe(7);
        });

        it('should accept alias "craft"', async () => {
            const result = await handleScrollManage({
                action: 'craft',
                spellName: 'Magic Missile',
                spellLevel: 1
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should accept alias "make"', async () => {
            const result = await handleScrollManage({
                action: 'make',
                spellName: 'Shield',
                spellLevel: 1
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
        });
    });

    describe('action: get', () => {
        let scrollId: string;

        beforeEach(async () => {
            const result = await handleScrollManage({
                action: 'create',
                spellName: 'Counterspell',
                spellLevel: 3,
                spellClass: 'wizard',
                value: 500
            }, ctx);
            scrollId = JSON.parse(result.content[0].text).scrollId;
        });

        it('should get scroll details', async () => {
            const result = await handleScrollManage({
                action: 'get',
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.spellName).toBe('Counterspell');
            expect(parsed.spellLevel).toBe(3);
            expect(parsed.spellClass).toBe('wizard');
            expect(parsed.value).toBe(500);
        });

        it('should return error for non-existent scroll', async () => {
            const result = await handleScrollManage({
                action: 'get',
                scrollItemId: randomUUID()
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('not found');
        });

        it('should accept alias "details"', async () => {
            const result = await handleScrollManage({
                action: 'details',
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.spellName).toBe('Counterspell');
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: identify', () => {
        let scrollId: string;

        beforeEach(async () => {
            const result = await handleScrollManage({
                action: 'create',
                spellName: 'Fly',
                spellLevel: 3
            }, ctx);
            scrollId = JSON.parse(result.content[0].text).scrollId;
        });

        it('should auto-succeed with Identify spell', async () => {
            const result = await handleScrollManage({
                action: 'identify',
                characterId,
                scrollItemId: scrollId,
                useIdentifySpell: true
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.method).toBe('identify_spell');
            expect(parsed.spellName).toBe('Fly');
            expect(parsed.spellLevel).toBe(3);
        });

        it('should roll Arcana check without Identify spell', async () => {
            const result = await handleScrollManage({
                action: 'identify',
                characterId,
                scrollItemId: scrollId,
                useIdentifySpell: false
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.method).toBe('arcana_check');
            expect(parsed.roll).toBeDefined();
            expect(parsed.total).toBeDefined();
            expect(parsed.dc).toBe(13); // 10 + spell level 3
        });

        it('should accept alias "id"', async () => {
            const result = await handleScrollManage({
                action: 'id',
                characterId,
                scrollItemId: scrollId,
                useIdentifySpell: true
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should return error for non-existent character', async () => {
            const result = await handleScrollManage({
                action: 'identify',
                characterId: randomUUID(),
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('not found');
        });
    });

    describe('action: check', () => {
        let scrollId: string;

        beforeEach(async () => {
            const result = await handleScrollManage({
                action: 'create',
                spellName: 'Haste',
                spellLevel: 3,
                spellClass: 'wizard'
            }, ctx);
            scrollId = JSON.parse(result.content[0].text).scrollId;
        });

        it('should check scroll usability', async () => {
            const result = await handleScrollManage({
                action: 'check',
                characterId,
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.characterName).toBe('Test Wizard');
            expect(parsed.scrollName).toBeDefined();
            expect(typeof parsed.canUse).toBe('boolean');
            expect(typeof parsed.requiresCheck).toBe('boolean');
        });

        it('should accept alias "usability"', async () => {
            const result = await handleScrollManage({
                action: 'usability',
                characterId,
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.characterName).toBe('Test Wizard');
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should accept alias "can_use"', async () => {
            const result = await handleScrollManage({
                action: 'can_use',
                characterId,
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.characterName).toBeDefined();
        });
    });

    describe('action: get_dc', () => {
        let scrollId: string;

        beforeEach(async () => {
            const result = await handleScrollManage({
                action: 'create',
                spellName: 'Polymorph',
                spellLevel: 4,
                spellClass: 'wizard'
            }, ctx);
            scrollId = JSON.parse(result.content[0].text).scrollId;
        });

        it('should get DC for scroll use', async () => {
            const result = await handleScrollManage({
                action: 'get_dc',
                characterId,
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.scrollName).toBeDefined();
            expect(typeof parsed.canUse).toBe('boolean');
            expect(typeof parsed.requiresCheck).toBe('boolean');
        });

        it('should accept alias "dc"', async () => {
            const result = await handleScrollManage({
                action: 'dc',
                characterId,
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.scrollName).toBeDefined();
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: use', () => {
        let scrollId: string;

        beforeEach(async () => {
            // Create a scroll
            const createResult = await handleScrollManage({
                action: 'create',
                spellName: 'Mage Armor',
                spellLevel: 1,
                spellClass: 'wizard'
            }, ctx);
            scrollId = JSON.parse(createResult.content[0].text).scrollId;

            // Give scroll to character
            inventoryRepo.addItem(characterId, scrollId, 1);
        });

        it('should use a spell scroll', async () => {
            const result = await handleScrollManage({
                action: 'use',
                characterId,
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.consumed).toBe(true);
            expect(parsed.spellName).toBe('Mage Armor');
            expect(typeof parsed.success).toBe('boolean');
        });

        it('should accept alias "cast"', async () => {
            const result = await handleScrollManage({
                action: 'cast',
                characterId,
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.consumed).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should return error for non-existent character', async () => {
            const result = await handleScrollManage({
                action: 'use',
                characterId: randomUUID(),
                scrollItemId: scrollId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('not found');
        });
    });

    describe('fuzzy matching', () => {
        it('should match typo "creat" to "create"', async () => {
            const result = await handleScrollManage({
                action: 'creat',
                spellName: 'Web',
                spellLevel: 2
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should match typo "identfy" to "identify"', async () => {
            // Create scroll first
            const createResult = await handleScrollManage({
                action: 'create',
                spellName: 'Hold Person',
                spellLevel: 2
            }, ctx);
            const scrollId = JSON.parse(createResult.content[0].text).scrollId;

            const result = await handleScrollManage({
                action: 'identfy',
                characterId,
                scrollItemId: scrollId,
                useIdentifySpell: true
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
        });
    });

    describe('error handling', () => {
        it('should return guiding error for invalid action', async () => {
            const result = await handleScrollManage({
                action: 'xyz',
                characterId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe('invalid_action');
            expect(parsed.suggestions).toBeDefined();
            expect(parsed.message).toContain('Did you mean');
        });

        it('should return error for missing action', async () => {
            const result = await handleScrollManage({
                characterId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('action');
        });

        it('should return validation error for missing required params on create', async () => {
            const result = await handleScrollManage({
                action: 'create'
                // Missing: spellName, spellLevel
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe('validation_error');
            expect(parsed.issues).toBeDefined();
        });

        it('should return validation error for missing scrollItemId on get', async () => {
            const result = await handleScrollManage({
                action: 'get'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe('validation_error');
        });
    });
});
