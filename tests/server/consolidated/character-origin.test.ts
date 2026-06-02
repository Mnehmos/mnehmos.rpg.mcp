/**
 * Tests for character.origin field + silent-drop fix for background/alignment.
 *
 * Per CLAUDE.md: NO `import { describe, it, expect } from 'vitest'` — vitest globals
 * are configured and explicit imports break test collection on Windows + vitest 1.6.1.
 */

import { handleCharacterManage } from '../../../src/server/consolidated/character-manage.js';
import { handleNpcManage } from '../../../src/server/consolidated/npc-manage.js';
import { handleSpawnManage } from '../../../src/server/consolidated/spawn-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function extractCharacterJson(text: string): any {
    const m = text.match(/<!-- CHARACTER_MANAGE_JSON\n([\s\S]*?)\nCHARACTER_MANAGE_JSON -->/);
    if (m) return JSON.parse(m[1]);
    return JSON.parse(text);
}

function extractNpcJson(text: string): any {
    const m = text.match(/<!-- NPC_MANAGE_JSON\n([\s\S]*?)\nNPC_MANAGE_JSON -->/);
    if (m) return JSON.parse(m[1]);
    return JSON.parse(text);
}

function extractSpawnJson(text: string): any {
    const m = text.match(/<!-- SPAWN_MANAGE_JSON\n([\s\S]*?)\nSPAWN_MANAGE_JSON -->/);
    if (m) return JSON.parse(m[1]);
    return JSON.parse(text);
}

describe('character.origin field + background/alignment silent-drop fix', () => {
    const ctx = { sessionId: 'test-session', worldId: '', partyId: '', encounterContext: null } as any;

    beforeEach(() => {
        closeDb();
        // Force re-init of :memory: db so each test starts fresh
        getDb(':memory:');
    });

    describe('character_manage.create with origin', () => {
        it('persists origin {universe, native, arrivedAt} round-trip via get', async () => {
            const createRes = await handleCharacterManage({
                action: 'create',
                name: 'Mara of Arizona',
                class: 'Fighter',
                race: 'Human',
                background: 'Soldier',
                alignment: 'lawful_neutral',
                origin: {
                    universe: 'Contemporary Earth — Arizona Mine',
                    native: false,
                    arrivedAt: 'PD 47'
                },
                provisionEquipment: false
            }, ctx);

            const created = extractCharacterJson(createRes.content[0].text);
            expect(created.success).toBe(true);
            expect(created.id).toBeDefined();
            expect(created.origin).toBeDefined();
            expect(created.origin.universe).toBe('Contemporary Earth — Arizona Mine');
            expect(created.origin.native).toBe(false);
            expect(created.origin.arrivedAt).toBe('PD 47');

            // Round-trip: fetch via get
            const getRes = await handleCharacterManage({
                action: 'get',
                characterId: created.id
            }, ctx);
            const fetched = extractCharacterJson(getRes.content[0].text);
            expect(fetched.origin).toBeDefined();
            expect(fetched.origin.universe).toBe('Contemporary Earth — Arizona Mine');
            expect(fetched.origin.native).toBe(false);
            expect(fetched.origin.arrivedAt).toBe('PD 47');
        });

        it('persists origin with native=true (Bastion-born)', async () => {
            const createRes = await handleCharacterManage({
                action: 'create',
                name: 'Native Hero',
                origin: {
                    universe: 'Bastion',
                    native: true
                },
                provisionEquipment: false
            }, ctx);

            const created = extractCharacterJson(createRes.content[0].text);
            expect(created.success).toBe(true);
            expect(created.origin.native).toBe(true);
            expect(created.origin.universe).toBe('Bastion');
        });

        it('REGRESSION: persists background through round-trip (was silently dropped)', async () => {
            const createRes = await handleCharacterManage({
                action: 'create',
                name: 'Bg Test',
                background: 'Charlatan',
                provisionEquipment: false
            }, ctx);

            const created = extractCharacterJson(createRes.content[0].text);
            const id = created.id;
            expect(id).toBeDefined();

            const getRes = await handleCharacterManage({ action: 'get', characterId: id }, ctx);
            const fetched = extractCharacterJson(getRes.content[0].text);
            expect(fetched.background).toBe('Charlatan');
        });

        it('REGRESSION: persists alignment through round-trip (was silently dropped)', async () => {
            const createRes = await handleCharacterManage({
                action: 'create',
                name: 'Align Test',
                alignment: 'chaotic_good',
                provisionEquipment: false
            }, ctx);

            const created = extractCharacterJson(createRes.content[0].text);
            const id = created.id;
            expect(id).toBeDefined();

            const getRes = await handleCharacterManage({ action: 'get', characterId: id }, ctx);
            const fetched = extractCharacterJson(getRes.content[0].text);
            expect(fetched.alignment).toBe('chaotic_good');
        });
    });

    describe('character_manage.list filter by origin', () => {
        it('filters by nativeToBastion=true', async () => {
            await handleCharacterManage({
                action: 'create',
                name: 'Native A',
                origin: { universe: 'Bastion', native: true },
                provisionEquipment: false
            }, ctx);
            await handleCharacterManage({
                action: 'create',
                name: 'Summoned B',
                origin: { universe: 'Forgotten Realms', native: false },
                provisionEquipment: false
            }, ctx);
            await handleCharacterManage({
                action: 'create',
                name: 'Summoned C',
                origin: { universe: 'Konoha', native: false },
                provisionEquipment: false
            }, ctx);

            const listRes = await handleCharacterManage({
                action: 'list',
                nativeToBastion: true
            }, ctx);
            const data = extractCharacterJson(listRes.content[0].text);
            expect(data.characters.length).toBe(1);
            expect(data.characters[0].name).toBe('Native A');
        });

        it('filters by nativeToBastion=false', async () => {
            await handleCharacterManage({
                action: 'create',
                name: 'Native A2',
                origin: { universe: 'Bastion', native: true },
                provisionEquipment: false
            }, ctx);
            await handleCharacterManage({
                action: 'create',
                name: 'Summoned B2',
                origin: { universe: 'Forgotten Realms', native: false },
                provisionEquipment: false
            }, ctx);

            const listRes = await handleCharacterManage({
                action: 'list',
                nativeToBastion: false
            }, ctx);
            const data = extractCharacterJson(listRes.content[0].text);
            expect(data.characters.length).toBe(1);
            expect(data.characters[0].name).toBe('Summoned B2');
        });

        it('filters by sourceUniverse', async () => {
            await handleCharacterManage({
                action: 'create',
                name: 'Konoha Ninja',
                origin: { universe: 'Konoha', native: false },
                provisionEquipment: false
            }, ctx);
            await handleCharacterManage({
                action: 'create',
                name: 'Realms Wizard',
                origin: { universe: 'Forgotten Realms', native: false },
                provisionEquipment: false
            }, ctx);

            const listRes = await handleCharacterManage({
                action: 'list',
                sourceUniverse: 'Konoha'
            }, ctx);
            const data = extractCharacterJson(listRes.content[0].text);
            expect(data.characters.length).toBe(1);
            expect(data.characters[0].name).toBe('Konoha Ninja');
        });
    });

    describe('npc_manage.create passes origin through', () => {
        it('persists origin on the underlying character', async () => {
            const npcRes = await handleNpcManage({
                action: 'create',
                name: 'Otherworldly NPC',
                class: 'Sage',
                race: 'Human',
                background: 'Hermit',
                alignment: 'neutral',
                origin: {
                    universe: 'Forgotten Realms',
                    native: false,
                    arrivedAt: 'PD 12'
                }
            }, ctx);

            const npcData = extractNpcJson(npcRes.content[0].text);
            expect(npcData.characterId).toBeDefined();

            // Verify via direct repo read
            const db = getDb(':memory:');
            const repo = new CharacterRepository(db);
            const fetched = repo.findById(npcData.characterId) as any;
            expect(fetched).toBeTruthy();
            expect(fetched.origin).toBeDefined();
            expect(fetched.origin.universe).toBe('Forgotten Realms');
            expect(fetched.origin.native).toBe(false);
            expect(fetched.origin.arrivedAt).toBe('PD 12');
            expect(fetched.background).toBe('Hermit');
            expect(fetched.alignment).toBe('neutral');
        });
    });

    describe('spawn_manage.spawn_character passes origin through', () => {
        it('persists origin on the spawned character', async () => {
            const spawnRes = await handleSpawnManage({
                action: 'spawn_character',
                template: 'goblin',
                name: 'Summoned Goblin',
                origin: {
                    universe: 'Forgotten Realms',
                    native: false
                }
            }, ctx);

            const data = extractSpawnJson(spawnRes.content[0].text);
            expect(data.characterId).toBeDefined();

            const db = getDb(':memory:');
            const repo = new CharacterRepository(db);
            const fetched = repo.findById(data.characterId) as any;
            expect(fetched).toBeTruthy();
            expect(fetched.origin).toBeDefined();
            expect(fetched.origin.universe).toBe('Forgotten Realms');
            expect(fetched.origin.native).toBe(false);
        });
    });
});
