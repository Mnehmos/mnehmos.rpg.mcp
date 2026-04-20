import { handleCharacterManage, CharacterManageTool } from '../../../src/server/consolidated/character-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { randomUUID } from 'crypto';

/**
 * Extract embedded JSON from ASCII-formatted response
 * Looks for <!-- TAG_JSON ... TAG_JSON --> pattern
 */
function extractJson(text: string): unknown {
    // Try embedded JSON first (new format)
    const jsonMatch = text.match(/<!-- \w+_JSON\n([\s\S]*?)\n\w+_JSON -->/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
    }
    // Fall back to direct JSON parse (old format)
    return JSON.parse(text);
}

describe('character_manage consolidated tool', () => {
    let db: ReturnType<typeof getDb>;
    let characterRepo: CharacterRepository;

    beforeEach(() => {
        closeDb();
        db = getDb(':memory:');
        characterRepo = new CharacterRepository(db);
    });

    const ctx = { worldId: '', partyId: '', encounterContext: null };

    describe('tool definition', () => {
        it('should have correct name and description', () => {
            expect(CharacterManageTool.name).toBe('character_manage');
            expect(CharacterManageTool.description).toContain('character');
        });

        it('should list all actions in description', () => {
            expect(CharacterManageTool.description).toContain('create');
            expect(CharacterManageTool.description).toContain('get');
            expect(CharacterManageTool.description).toContain('update');
            expect(CharacterManageTool.description).toContain('list');
            expect(CharacterManageTool.description).toContain('delete');
            expect(CharacterManageTool.description).toContain('add_xp');
            expect(CharacterManageTool.description).toContain('level_up');
        });
    });

    describe('action: create', () => {
        it('should create a character with minimal params', async () => {
            const result = await handleCharacterManage({
                action: 'create',
                name: 'Test Hero'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.id).toBeDefined();
            expect(parsed.name).toBe('Test Hero');
            expect(parsed.characterType).toBe('pc');
            expect(parsed.level).toBe(1);
        });

        it('should create a character with full params', async () => {
            const result = await handleCharacterManage({
                action: 'create',
                name: 'Valeros',
                class: 'Fighter',
                race: 'Human',
                level: 5,
                hp: 45,
                maxHp: 45,
                ac: 18,
                stats: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
                characterType: 'pc'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.name).toBe('Valeros');
            expect(parsed.characterClass).toBe('Fighter');
            expect(parsed.race).toBe('Human');
            expect(parsed.level).toBe(5);
        });

        it('should provision equipment by default for PCs', async () => {
            const result = await handleCharacterManage({
                action: 'create',
                name: 'Test Wizard',
                class: 'Wizard',
                level: 1
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            // Should have _provisioning info
            expect(parsed._provisioning).toBeDefined();
        });

        // Regression for issue #45: provisioning ran before character row was
        // inserted, so every starting-item grant failed FOREIGN KEY check on
        // inventory_items.character_id and characters spawned with empty bags.
        it('actually grants starting equipment without FK errors', async () => {
            const classes = ['Paladin', 'Rogue', 'Wizard', 'Cleric', 'Fighter'];
            for (const klass of classes) {
                const result = await handleCharacterManage({
                    action: 'create',
                    name: `${klass}-Equip`,
                    class: klass,
                    level: 4
                }, ctx);
                const parsed = extractJson(result.content[0].text);
                expect(parsed._provisioning, `${klass}: missing _provisioning`).toBeDefined();
                expect(parsed._provisioning.errors, `${klass}: equipment errors leaked`).toBeUndefined();
                expect(parsed._provisioning.equipmentGranted.length, `${klass}: nothing granted`).toBeGreaterThan(0);
            }
        });

        // Regression for issue #44: spell slot array was being read with the
        // wrong index (slots[1] for level1, etc.), so half-casters got nothing
        // and full casters reported one level too low. Reviewers asked for
        // L1–L9 coverage on the create path plus a level_up assertion.

        // Source-of-truth tables (PHB). Indexes 0..8 = level1..level9 slots.
        const FULL_CASTER: Record<number, number[]> = {
            1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
            2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
            3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
            4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
            5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
            6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
            7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
            8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
            9: [4, 3, 3, 3, 1, 0, 0, 0, 0]
        };
        const HALF_CASTER: Record<number, number[]> = {
            1: [0, 0, 0, 0, 0, 0, 0, 0, 0],
            2: [2, 0, 0, 0, 0, 0, 0, 0, 0],
            3: [3, 0, 0, 0, 0, 0, 0, 0, 0],
            4: [3, 0, 0, 0, 0, 0, 0, 0, 0],
            5: [4, 2, 0, 0, 0, 0, 0, 0, 0],
            6: [4, 2, 0, 0, 0, 0, 0, 0, 0],
            7: [4, 3, 0, 0, 0, 0, 0, 0, 0],
            8: [4, 3, 0, 0, 0, 0, 0, 0, 0],
            9: [4, 3, 2, 0, 0, 0, 0, 0, 0]
        };

        function assertSlots(actual: any, expected: number[], label: string) {
            for (let i = 0; i < 9; i++) {
                const key = `level${i + 1}` as const;
                expect(actual[key].max, `${label} ${key}.max`).toBe(expected[i]);
                expect(actual[key].current, `${label} ${key}.current`).toBe(expected[i]);
            }
        }

        it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
            'seeds Wizard L%i with full-caster slots',
            async (level) => {
                const result = await handleCharacterManage({
                    action: 'create', name: `Wizard-L${level}`, class: 'Wizard', level
                }, ctx);
                const parsed = extractJson(result.content[0].text);
                assertSlots(parsed.spellSlots, FULL_CASTER[level], `Wizard L${level}`);
            }
        );

        it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
            'seeds Cleric L%i with full-caster slots',
            async (level) => {
                const result = await handleCharacterManage({
                    action: 'create', name: `Cleric-L${level}`, class: 'Cleric', level
                }, ctx);
                const parsed = extractJson(result.content[0].text);
                assertSlots(parsed.spellSlots, FULL_CASTER[level], `Cleric L${level}`);
            }
        );

        it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
            'seeds Paladin L%i with half-caster slots',
            async (level) => {
                const result = await handleCharacterManage({
                    action: 'create', name: `Paladin-L${level}`, class: 'Paladin', level
                }, ctx);
                const parsed = extractJson(result.content[0].text);
                assertSlots(parsed.spellSlots, HALF_CASTER[level], `Paladin L${level}`);
            }
        );

        it('level_up recomputes spell slots so a wizard going L4 → L5 gains 2nd-level slot', async () => {
            const create = await handleCharacterManage({
                action: 'create', name: 'Aspiring Wizard', class: 'Wizard', level: 4
            }, ctx);
            const created = extractJson(create.content[0].text);
            assertSlots(created.spellSlots, FULL_CASTER[4], 'Wizard L4 (create)');

            const lu = await handleCharacterManage({
                action: 'level_up', characterId: created.id, targetLevel: 5
            }, ctx);
            const leveled = extractJson(lu.content[0].text);
            expect(leveled.newLevel).toBe(5);
            assertSlots(leveled.spellSlots, FULL_CASTER[5], 'Wizard L5 (level_up)');
        });

        it('level_up grants paladin their first spell slots when crossing L1 → L2', async () => {
            const create = await handleCharacterManage({
                action: 'create', name: 'Squire', class: 'Paladin', level: 1
            }, ctx);
            const created = extractJson(create.content[0].text);
            assertSlots(created.spellSlots, HALF_CASTER[1], 'Paladin L1 (create)');

            const lu = await handleCharacterManage({
                action: 'level_up', characterId: created.id, targetLevel: 2
            }, ctx);
            const leveled = extractJson(lu.content[0].text);
            assertSlots(leveled.spellSlots, HALF_CASTER[2], 'Paladin L2 (level_up)');
        });

        // Reviewer follow-up: with provisioning now running after the character
        // is inserted, also confirm that the slot-array → slot-object conversion
        // is zero-indexed. Without this fix bundled in, paladin L4 / wizard L4
        // persisted 0 / 3 first-level slots respectively.
        it('persists spell slots from the correct array index after the FK reorder', async () => {
            const wizard = await handleCharacterManage({
                action: 'create', name: 'IndexCheck-Wizard', class: 'Wizard', level: 4
            }, ctx);
            const w = extractJson(wizard.content[0].text);
            expect(w.spellSlots.level1.max).toBe(4);
            expect(w.spellSlots.level2.max).toBe(3);

            const paladin = await handleCharacterManage({
                action: 'create', name: 'IndexCheck-Paladin', class: 'Paladin', level: 4
            }, ctx);
            const p = extractJson(paladin.content[0].text);
            expect(p.spellSlots.level1.max).toBe(3);
        });

        it('should skip provisioning when provisionEquipment is false', async () => {
            const result = await handleCharacterManage({
                action: 'create',
                name: 'Simple NPC',
                provisionEquipment: false
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed._provisioning).toBeUndefined();
        });

        it('should accept alias "new"', async () => {
            const result = await handleCharacterManage({
                action: 'new',
                name: 'Alias Test'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should accept alias "spawn"', async () => {
            const result = await handleCharacterManage({
                action: 'spawn',
                name: 'Spawn Test'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.success).toBe(true);
        });
    });

    describe('action: get', () => {
        let characterId: string;

        beforeEach(async () => {
            const result = await handleCharacterManage({
                action: 'create',
                name: 'Get Test Hero',
                class: 'Rogue',
                level: 3
            }, ctx);
            characterId = extractJson(result.content[0].text).id;
        });

        it('should get character by ID', async () => {
            const result = await handleCharacterManage({
                action: 'get',
                characterId
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.name).toBe('Get Test Hero');
            expect(parsed.characterClass).toBe('Rogue');
            expect(parsed.level).toBe(3);
        });

        it('should return error for non-existent character', async () => {
            const result = await handleCharacterManage({
                action: 'get',
                characterId: randomUUID()
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('not found');
        });

        it('should accept alias "fetch"', async () => {
            const result = await handleCharacterManage({
                action: 'fetch',
                characterId
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.name).toBe('Get Test Hero');
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: update', () => {
        let characterId: string;

        beforeEach(async () => {
            const result = await handleCharacterManage({
                action: 'create',
                name: 'Update Test',
                hp: 20,
                maxHp: 20,
                level: 1
            }, ctx);
            characterId = extractJson(result.content[0].text).id;
        });

        it('should update character properties', async () => {
            const result = await handleCharacterManage({
                action: 'update',
                characterId,
                name: 'Updated Name',
                hp: 15,
                level: 2
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.name).toBe('Updated Name');
            expect(parsed.hp).toBe(15);
            expect(parsed.level).toBe(2);
        });

        it('should add conditions', async () => {
            const result = await handleCharacterManage({
                action: 'update',
                characterId,
                addConditions: [{ name: 'Poisoned', duration: 3 }]
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.conditions).toBeDefined();
            expect(parsed.conditions.some((c: any) => c.name === 'Poisoned')).toBe(true);
        });

        it('should remove conditions', async () => {
            // First add a condition
            await handleCharacterManage({
                action: 'update',
                characterId,
                addConditions: [{ name: 'Blinded' }]
            }, ctx);

            // Then remove it
            const result = await handleCharacterManage({
                action: 'update',
                characterId,
                removeConditions: ['Blinded']
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.conditions.some((c: any) => c.name === 'Blinded')).toBe(false);
        });

        it('should accept alias "modify"', async () => {
            const result = await handleCharacterManage({
                action: 'modify',
                characterId,
                ac: 15
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.ac).toBe(15);
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: list', () => {
        beforeEach(async () => {
            await handleCharacterManage({ action: 'create', name: 'PC 1', characterType: 'pc' }, ctx);
            await handleCharacterManage({ action: 'create', name: 'PC 2', characterType: 'pc' }, ctx);
            await handleCharacterManage({ action: 'create', name: 'Enemy 1', characterType: 'enemy' }, ctx);
        });

        it('should list all characters', async () => {
            const result = await handleCharacterManage({
                action: 'list'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.count).toBe(3);
            expect(parsed.characters).toHaveLength(3);
        });

        it('should filter by character type', async () => {
            const result = await handleCharacterManage({
                action: 'list',
                characterType: 'pc'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.count).toBe(2);
            expect(parsed.filter).toBe('pc');
        });

        it('should accept alias "all"', async () => {
            const result = await handleCharacterManage({
                action: 'all'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.count).toBe(3);
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: delete', () => {
        let characterId: string;

        beforeEach(async () => {
            const result = await handleCharacterManage({
                action: 'create',
                name: 'Delete Me'
            }, ctx);
            characterId = extractJson(result.content[0].text).id;
        });

        it('should delete a character', async () => {
            const result = await handleCharacterManage({
                action: 'delete',
                characterId
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.success).toBe(true);

            // Verify deleted
            const getResult = await handleCharacterManage({
                action: 'get',
                characterId
            }, ctx);
            const getParsed = extractJson(getResult.content[0].text) as any;
            expect(getParsed.error).toBe(true);
        });

        it('should accept alias "remove"', async () => {
            const result = await handleCharacterManage({
                action: 'remove',
                characterId
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: add_xp', () => {
        let characterId: string;

        beforeEach(async () => {
            const result = await handleCharacterManage({
                action: 'create',
                name: 'XP Test',
                level: 1
            }, ctx);
            characterId = extractJson(result.content[0].text).id;
        });

        it('should add XP to character', async () => {
            const result = await handleCharacterManage({
                action: 'add_xp',
                characterId,
                amount: 100
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.oldXp).toBe(0);
            expect(parsed.newXp).toBe(100);
            expect(parsed.canLevelUp).toBe(false);
        });

        it('should signal level up when threshold reached', async () => {
            const result = await handleCharacterManage({
                action: 'add_xp',
                characterId,
                amount: 300 // Level 2 threshold
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.newXp).toBe(300);
            expect(parsed.canLevelUp).toBe(true);
            expect(parsed.message).toContain('LEVEL UP');
        });

        it('should accept alias "xp"', async () => {
            const result = await handleCharacterManage({
                action: 'xp',
                characterId,
                amount: 50
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.newXp).toBe(50);
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: get_progression', () => {
        it('should return XP requirements for a level', async () => {
            const result = await handleCharacterManage({
                action: 'get_progression',
                level: 5
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.level).toBe(5);
            expect(parsed.xpRequiredForLevel).toBe(6500);
            expect(parsed.xpForNextLevel).toBe(14000);
            expect(parsed.xpToNext).toBe(7500);
        });

        it('should handle max level', async () => {
            const result = await handleCharacterManage({
                action: 'get_progression',
                level: 20
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.level).toBe(20);
            expect(parsed.maxLevel).toBe(true);
        });

        it('should accept alias "progression"', async () => {
            const result = await handleCharacterManage({
                action: 'progression',
                level: 3
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.level).toBe(3);
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: level_up', () => {
        let characterId: string;

        beforeEach(async () => {
            const result = await handleCharacterManage({
                action: 'create',
                name: 'Level Up Test',
                level: 1,
                hp: 10,
                maxHp: 10
            }, ctx);
            characterId = extractJson(result.content[0].text).id;
        });

        it('should level up a character', async () => {
            const result = await handleCharacterManage({
                action: 'level_up',
                characterId
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.oldLevel).toBe(1);
            expect(parsed.newLevel).toBe(2);
            expect(parsed.message).toContain('Leveled up');
        });

        it('should increase HP when specified', async () => {
            const result = await handleCharacterManage({
                action: 'level_up',
                characterId,
                hpIncrease: 8
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.hpIncrease).toBe(8);
            expect(parsed.newMaxHp).toBe(18);
        });

        it('should level up to specific target level', async () => {
            const result = await handleCharacterManage({
                action: 'level_up',
                characterId,
                targetLevel: 5
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.newLevel).toBe(5);
        });

        it('should reject lower target level', async () => {
            // First level up to 3
            await handleCharacterManage({
                action: 'level_up',
                characterId,
                targetLevel: 3
            }, ctx);

            // Try to set to 2 (should fail)
            const result = await handleCharacterManage({
                action: 'level_up',
                characterId,
                targetLevel: 2
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('must be greater');
        });

        it('should accept alias "levelup"', async () => {
            const result = await handleCharacterManage({
                action: 'levelup',
                characterId
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.newLevel).toBe(2);
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('fuzzy matching', () => {
        it('should match typo "creat" to "create"', async () => {
            const result = await handleCharacterManage({
                action: 'creat',
                name: 'Fuzzy Test'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            console.log('FUZZY TEST RESULT:', JSON.stringify(parsed, null, 2));
            expect(parsed.success).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should match typo "updat" to "update"', async () => {
            const createResult = await handleCharacterManage({
                action: 'create',
                name: 'Typo Update Test'
            }, ctx);
            const characterId = (extractJson(createResult.content[0].text) as any).id;

            const result = await handleCharacterManage({
                action: 'updat',
                characterId,
                hp: 5
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.success).toBe(true);
        });
    });

    describe('error handling', () => {
        it('should return guiding error for invalid action', async () => {
            const result = await handleCharacterManage({
                action: 'xyz'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.error).toBe('invalid_action');
            expect(parsed.suggestions).toBeDefined();
            expect(parsed.message).toContain('Did you mean');
        });

        it('should return error for missing action', async () => {
            const result = await handleCharacterManage({
                name: 'No Action'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('action');
        });

        it('should return validation error for missing name on create', async () => {
            const result = await handleCharacterManage({
                action: 'create'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.error).toBe('validation_error');
            expect(parsed.issues).toBeDefined();
        });

        it('should return validation error for missing characterId on get', async () => {
            const result = await handleCharacterManage({
                action: 'get'
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.error).toBe('validation_error');
        });

        it('should return error for non-existent character on add_xp', async () => {
            const result = await handleCharacterManage({
                action: 'add_xp',
                characterId: randomUUID(),
                amount: 100
            }, ctx);

            const parsed = extractJson(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('not found');
        });
    });
});
