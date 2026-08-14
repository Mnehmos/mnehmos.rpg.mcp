import { closeDb, getDb } from '../../../src/storage/index.js';
import {
    findOpen5eBackground,
    findOpen5eItem,
    getOpen5eCatalog,
} from '../../../src/content/open5e-catalog.js';
import { handleCharacterManage } from '../../../src/server/consolidated/character-manage.js';
import { handleBatchManage } from '../../../src/server/consolidated/batch-manage.js';
import { handleInventoryManage } from '../../../src/server/consolidated/inventory-manage.js';
import { handleItemManage } from '../../../src/server/consolidated/item-manage.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { InventoryRepository } from '../../../src/storage/repos/inventory.repo.js';

const ctx = { sessionId: 'open5e-authority-test' };

function embeddedJson(result: { content: Array<{ text: string }> }): any {
    const match = result.content[0].text.match(/<!-- \w+_JSON\n([\s\S]*?)\n\w+_JSON -->/u);
    if (!match) throw new Error(`Missing embedded JSON in response: ${result.content[0].text}`);
    return JSON.parse(match[1]);
}

describe('pinned Open5e engine authority', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
    });

    it('loads the reviewed mechanics-only SRD catalog with exact provenance', () => {
        const catalog = getOpen5eCatalog();

        expect(catalog.provenance.packHash).toBe('fbd846cf7b7833560b22f4ebffaf950fb6b2adf62cf9c6fff469266325ac31fa');
        expect(catalog.provenance.gamesystem).toBe('5e-2014');
        expect(catalog.provenance.documents).toEqual(['core', 'srd-2014']);
        expect(catalog.classes).toHaveLength(12);
        expect(catalog.species).toHaveLength(13);
        expect(catalog.backgrounds).toHaveLength(1);
        expect(catalog.skills).toHaveLength(18);
        expect(catalog.languages).toHaveLength(16);
        expect(catalog.alignments).toHaveLength(9);
        expect(catalog.items).toHaveLength(237);
    });

    it('carries exact item and background mechanics instead of name heuristics', () => {
        const chainMail = findOpen5eItem('Chain Mail');
        expect(chainMail).toMatchObject({
            sourceKey: 'srd_chain-mail',
            type: 'armor',
            weight: 55,
            valueCopper: 7500,
            properties: {
                baseAC: 16,
                maxDexBonus: 0,
                stealthDisadvantage: true,
                strengthRequired: 13,
                equipSlots: ['armor'],
            },
        });

        const longsword = findOpen5eItem('srd_longsword');
        expect(longsword).toMatchObject({
            name: 'Longsword',
            type: 'weapon',
            properties: {
                damageDice: '1d8',
                damageType: 'slashing',
                isMartial: true,
                equipSlots: ['mainhand', 'offhand'],
            },
        });

        const acolyte = findOpen5eBackground('Acolyte');
        expect(acolyte).toMatchObject({
            skillProficiencies: ['insight', 'religion'],
            languageChoiceCount: 2,
            startingCurrencyCopper: 1500,
        });
        expect(acolyte?.startingEquipmentDescription).toContain('holy symbol');
    });

    it('exposes creation options without writing campaign state', async () => {
        const db = getDb();
        const before = db.prepare('SELECT COUNT(*) AS count FROM characters').get() as { count: number };

        const response = embeddedJson(await handleCharacterManage({
            action: 'options',
            category: 'classes',
            query: 'fighter',
        }, ctx as any));

        const after = db.prepare('SELECT COUNT(*) AS count FROM characters').get() as { count: number };
        expect(response.success).toBe(true);
        expect(response.classes).toHaveLength(1);
        expect(response.classes[0]).toMatchObject({ name: 'Fighter', hitDie: 10 });
        expect(after.count).toBe(before.count);
    });

    it('searches and reads source items without materializing them', async () => {
        const db = getDb();
        const search = embeddedJson(await handleItemManage({
            action: 'catalog_search',
            query: 'longsword',
            type: 'weapon',
            limit: 5,
        }, ctx as any));

        expect(search.catalogOnly).toBe(true);
        expect(search.items).toHaveLength(1);
        expect(search.items[0]).toMatchObject({
            sourceKey: 'srd_longsword',
            name: 'Longsword',
            value: 15,
        });

        const get = embeddedJson(await handleItemManage({
            action: 'catalog_get',
            sourceKey: 'srd_chain-mail',
        }, ctx as any));
        expect(get.catalogItem).toMatchObject({ name: 'Chain mail', value: 75 });

        const count = db.prepare('SELECT COUNT(*) AS count FROM items').get() as { count: number };
        expect(count.count).toBe(0);
    });

    it('creates a source-backed character and provisions exact source items', async () => {
        const created = embeddedJson(await handleCharacterManage({
            action: 'create',
            name: 'Source Knight',
            class: 'Fighter',
            race: 'Human',
            background: 'Acolyte',
            stats: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
            languages: ['Celestial', 'Elvish', 'Draconic'],
        }, ctx as any));

        expect(created).toMatchObject({
            characterClass: 'Fighter',
            race: 'Human',
            background: 'Acolyte',
            hp: 12,
            maxHp: 12,
            ac: 12,
            saveProficiencies: ['str', 'con'],
        });
        expect(created.skillProficiencies).toEqual(expect.arrayContaining(['insight', 'religion']));
        expect(created.languages).toEqual(expect.arrayContaining(['Common', 'Celestial', 'Elvish', 'Draconic']));
        expect(created.armorProficiencies).toEqual(['all armor', 'shields']);
        expect(created._rules.class).toMatchObject({ sourceKey: 'srd_fighter', hitDie: 10 });
        expect(created._rules.background).toMatchObject({ sourceKey: 'srd_acolyte', languageChoiceCount: 2 });
        expect(created._provisioning.startingGold).toBe(15);
        expect(created._provisioning.errors).toBeUndefined();

        const inventory = new InventoryRepository(getDb()).getInventoryWithDetails(created.id);
        const chainMail = inventory.items.find((entry) => entry.item.name === 'Chain mail');
        expect(chainMail?.item).toMatchObject({
            id: 'open5e-srd-2014-srd_chain-mail',
            type: 'armor',
            properties: {
                baseAC: 16,
                open5e: {
                    packHash: 'fbd846cf7b7833560b22f4ebffaf950fb6b2adf62cf9c6fff469266325ac31fa',
                    sourceKey: 'srd_chain-mail',
                },
            },
        });

        const unresolvedChoice = inventory.items.find((entry) => entry.item.name === 'Martial Weapon');
        expect(unresolvedChoice?.item).toMatchObject({
            type: 'weapon',
            properties: { requiresSelection: true, weaponClass: 'martial' },
        });
    });

    it('applies species ability bonuses only when explicitly requested', async () => {
        const created = embeddedJson(await handleCharacterManage({
            action: 'create',
            name: 'Dwarven Scholar',
            class: 'Wizard',
            race: 'Dwarf',
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
            applySpeciesAbilityBonuses: true,
            provisionEquipment: false,
        }, ctx as any));

        expect(created.stats.con).toBe(12);
        expect(created.hp).toBe(7);
        expect(created.languages).toEqual(['Common', 'Dwarvish']);
        expect(created._rules.species.abilityBonusesApplied).toBe(true);
    });

    it('routes batch character creation through the same source-backed path', async () => {
        const batch = embeddedJson(await handleBatchManage({
            action: 'create_characters',
            characters: [{
                name: 'Batch Fighter',
                class: 'Fighter',
                race: 'Human',
                stats: { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
            }],
        }, ctx as any));

        expect(batch.success).toBe(true);
        const characterId = batch.created[0].id;
        const character = new CharacterRepository(getDb()).findById(characterId);
        expect(character).toMatchObject({ hp: 12, maxHp: 12, saveProficiencies: ['str', 'con'] });

        const inventory = new InventoryRepository(getDb()).getInventoryWithDetails(characterId);
        expect(inventory.items.find((entry) => entry.item.name === 'Chain mail')?.item.properties?.open5e)
            .toMatchObject({ sourceKey: 'srd_chain-mail' });
    });

    it('materializes source items idempotently and enforces their equip slots', async () => {
        const longswordFirst = embeddedJson(await handleItemManage({
            action: 'materialize',
            sourceKey: 'srd_longsword',
        }, ctx as any));
        const longswordAgain = embeddedJson(await handleItemManage({
            action: 'materialize',
            sourceKey: 'Longsword',
        }, ctx as any));
        const chainMail = embeddedJson(await handleItemManage({
            action: 'materialize',
            sourceKey: 'Chain mail',
        }, ctx as any));
        const shield = embeddedJson(await handleItemManage({
            action: 'materialize',
            sourceKey: 'Shield',
        }, ctx as any));

        expect(longswordFirst.created).toBe(true);
        expect(longswordAgain.created).toBe(false);
        expect(longswordAgain.item.id).toBe(longswordFirst.item.id);

        const characterId = 'open5e-equip-test-character';
        new CharacterRepository(getDb()).create({
            id: characterId,
            name: 'Equip Tester',
            stats: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
            hp: 10,
            maxHp: 10,
            ac: 12,
            level: 1,
            characterClass: 'Fighter',
            race: 'Human',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        for (const itemId of [longswordFirst.item.id, chainMail.item.id, shield.item.id]) {
            const given = embeddedJson(await handleInventoryManage({
                action: 'give', characterId, itemId, quantity: 1,
            }, ctx as any));
            expect(given.success).toBe(true);
        }

        const invalid = embeddedJson(await handleInventoryManage({
            action: 'equip', characterId, itemId: longswordFirst.item.id, slot: 'armor',
        }, ctx as any));
        expect(invalid.error).toBe(true);
        expect(invalid.message).toContain('Allowed slots: mainhand, offhand');

        const armorEquip = embeddedJson(await handleInventoryManage({
            action: 'equip', characterId, itemId: chainMail.item.id, slot: 'armor',
        }, ctx as any));
        expect(armorEquip.success).toBe(true);
        expect(new CharacterRepository(getDb()).findById(characterId)?.ac).toBe(16);

        const shieldEquip = embeddedJson(await handleInventoryManage({
            action: 'equip', characterId, itemId: shield.item.id, slot: 'offhand',
        }, ctx as any));
        expect(shieldEquip.success).toBe(true);
        expect(new CharacterRepository(getDb()).findById(characterId)?.ac).toBe(18);
    });
});
