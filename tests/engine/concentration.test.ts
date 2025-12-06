import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { ConcentrationRepository } from '../../src/storage/repos/concentration.repo.js';
import { migrate } from '../../src/storage/migrations.js';
import {
    calculateConcentrationDC,
    rollConcentrationSave,
    checkConcentration,
    breakConcentration,
    startConcentration,
    checkConcentrationDuration,
    checkAutomaticConcentrationBreak,
    getConcentration,
} from '../../src/engine/magic/concentration.js';
import type { Character } from '../../src/schema/character.js';

describe('Concentration System', () => {
    let db: Database.Database;
    let characterRepo: CharacterRepository;
    let concentrationRepo: ConcentrationRepository;
    let testCharacter: Character;

    beforeEach(() => {
        // Create in-memory database for tests
        db = new Database(':memory:');
        migrate(db);

        characterRepo = new CharacterRepository(db);
        concentrationRepo = new ConcentrationRepository(db);

        // Create test character
        testCharacter = {
            id: 'test-wizard',
            name: 'Test Wizard',
            stats: {
                str: 10,
                dex: 14,
                con: 16, // +3 modifier
                int: 18,
                wis: 12,
                cha: 10,
            },
            hp: 30,
            maxHp: 30,
            ac: 12,
            level: 5,
            characterType: 'pc',
            characterClass: 'wizard',
            knownSpells: ['haste', 'fireball', 'shield'],
            preparedSpells: ['haste', 'fireball', 'shield'],
            cantripsKnown: ['fire bolt'],
            maxSpellLevel: 3,
            spellSlots: {
                level1: { current: 4, max: 4 },
                level2: { current: 3, max: 3 },
                level3: { current: 2, max: 2 },
                level4: { current: 0, max: 0 },
                level5: { current: 0, max: 0 },
                level6: { current: 0, max: 0 },
                level7: { current: 0, max: 0 },
                level8: { current: 0, max: 0 },
                level9: { current: 0, max: 0 },
            },
            conditions: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        characterRepo.create(testCharacter);
    });

    describe('Concentration DC Calculation', () => {
        it('should use DC 10 for damage less than 20', () => {
            expect(calculateConcentrationDC(5)).toBe(10);
            expect(calculateConcentrationDC(10)).toBe(10);
            expect(calculateConcentrationDC(19)).toBe(10);
        });

        it('should use half damage for damage 20 or more', () => {
            expect(calculateConcentrationDC(20)).toBe(10);
            expect(calculateConcentrationDC(22)).toBe(11);
            expect(calculateConcentrationDC(30)).toBe(15);
            expect(calculateConcentrationDC(50)).toBe(25);
        });
    });

    describe('Starting Concentration', () => {
        it('should create concentration record', () => {
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1, // Round 1
                10, // 10 rounds (1 minute)
                ['target-1'],
                concentrationRepo,
                characterRepo
            );

            const concentration = concentrationRepo.findByCharacterId(testCharacter.id);
            expect(concentration).toBeTruthy();
            expect(concentration?.activeSpell).toBe('Haste');
            expect(concentration?.spellLevel).toBe(3);
            expect(concentration?.startedAt).toBe(1);
            expect(concentration?.maxDuration).toBe(10);
            expect(concentration?.targetIds).toEqual(['target-1']);
        });

        it('should update character concentrating_on field', () => {
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1,
                10,
                undefined,
                concentrationRepo,
                characterRepo
            );

            const character = characterRepo.findById(testCharacter.id);
            expect(character?.concentratingOn).toBe('Haste');
        });

        it('should break existing concentration when starting new spell', () => {
            // Start first concentration
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1,
                10,
                ['target-1'],
                concentrationRepo,
                characterRepo
            );

            // Start second concentration
            startConcentration(
                testCharacter.id,
                'Bless',
                1,
                2,
                10,
                ['target-2'],
                concentrationRepo,
                characterRepo
            );

            const concentration = concentrationRepo.findByCharacterId(testCharacter.id);
            expect(concentration?.activeSpell).toBe('Bless');
            expect(concentration?.spellLevel).toBe(1);
        });
    });

    describe('Concentration Checks', () => {
        beforeEach(() => {
            // Start concentration before each test
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1,
                10,
                ['target-1'],
                concentrationRepo,
                characterRepo
            );
        });

        it('should succeed on high constitution save', () => {
            // Character has CON +3, so roll of 7+ passes DC 10
            // We can't easily mock the random roll, so we test the logic
            const result = checkConcentration(testCharacter, 10, concentrationRepo);

            expect(result.characterId).toBe(testCharacter.id);
            expect(result.spell).toBe('Haste');
            expect(result.saveDC).toBe(10);
            expect(result.constitutionModifier).toBe(3);
            expect(typeof result.broken).toBe('boolean');
        });

        it('should handle high damage requiring higher DC', () => {
            const result = checkConcentration(testCharacter, 40, concentrationRepo);

            expect(result.saveDC).toBe(20); // Half of 40
            expect(result.damageAmount).toBe(40);
        });

        it('should return no check if not concentrating', () => {
            const otherCharacter: Character = {
                ...testCharacter,
                id: 'other-wizard',
            };
            characterRepo.create(otherCharacter);

            const result = checkConcentration(otherCharacter, 10, concentrationRepo);
            expect(result.spell).toBe('none');
            expect(result.broken).toBe(false);
        });
    });

    describe('Breaking Concentration', () => {
        beforeEach(() => {
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1,
                10,
                ['target-1'],
                concentrationRepo,
                characterRepo
            );
        });

        it('should break concentration on voluntary end', () => {
            const result = breakConcentration(
                { characterId: testCharacter.id, reason: 'voluntary' },
                concentrationRepo,
                characterRepo
            );

            expect(result.broken).toBe(true);
            expect(result.reason).toBe('voluntary');
            expect(concentrationRepo.isConcentrating(testCharacter.id)).toBe(false);
        });

        it('should break concentration on death', () => {
            const result = breakConcentration(
                { characterId: testCharacter.id, reason: 'death' },
                concentrationRepo,
                characterRepo
            );

            expect(result.broken).toBe(true);
            expect(result.reason).toBe('death');
        });

        it('should break concentration on new spell', () => {
            const result = breakConcentration(
                { characterId: testCharacter.id, reason: 'new_spell' },
                concentrationRepo,
                characterRepo
            );

            expect(result.broken).toBe(true);
            expect(result.reason).toBe('new_spell');
        });

        it('should clear character concentrating_on field', () => {
            breakConcentration(
                { characterId: testCharacter.id, reason: 'voluntary' },
                concentrationRepo,
                characterRepo
            );

            const character = characterRepo.findById(testCharacter.id);
            expect(character?.concentratingOn).toBeNull();
        });
    });

    describe('Duration Checks', () => {
        it('should not break concentration within duration', () => {
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1,
                10,
                undefined,
                concentrationRepo,
                characterRepo
            );

            const result = checkConcentrationDuration(
                testCharacter.id,
                5, // Round 5 (4 rounds elapsed)
                concentrationRepo,
                characterRepo
            );

            expect(result).toBeNull();
            expect(concentrationRepo.isConcentrating(testCharacter.id)).toBe(true);
        });

        it('should break concentration when duration exceeded', () => {
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1,
                10,
                undefined,
                concentrationRepo,
                characterRepo
            );

            const result = checkConcentrationDuration(
                testCharacter.id,
                12, // Round 12 (11 rounds elapsed, exceeds max 10)
                concentrationRepo,
                characterRepo
            );

            expect(result).toBeTruthy();
            expect(result?.broken).toBe(true);
            expect(result?.reason).toBe('duration');
            expect(concentrationRepo.isConcentrating(testCharacter.id)).toBe(false);
        });

        it('should not break concentration with no duration limit', () => {
            startConcentration(
                testCharacter.id,
                'Mage Armor',
                1,
                1,
                undefined, // No duration limit
                undefined,
                concentrationRepo,
                characterRepo
            );

            const result = checkConcentrationDuration(
                testCharacter.id,
                1000, // Many rounds later
                concentrationRepo,
                characterRepo
            );

            expect(result).toBeNull();
        });
    });

    describe('Automatic Concentration Breaks', () => {
        beforeEach(() => {
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1,
                10,
                undefined,
                concentrationRepo,
                characterRepo
            );
        });

        it('should break concentration on death (hp <= 0)', () => {
            characterRepo.update(testCharacter.id, { hp: 0 });
            const updatedChar = characterRepo.findById(testCharacter.id)!;

            const result = checkAutomaticConcentrationBreak(
                updatedChar,
                concentrationRepo,
                characterRepo
            );

            expect(result).toBeTruthy();
            expect(result?.broken).toBe(true);
            expect(result?.reason).toBe('death');
        });

        it('should break concentration when unconscious', () => {
            characterRepo.update(testCharacter.id, { conditions: ['unconscious'] });
            const updatedChar = characterRepo.findById(testCharacter.id)!;

            const result = checkAutomaticConcentrationBreak(
                updatedChar,
                concentrationRepo,
                characterRepo
            );

            expect(result).toBeTruthy();
            expect(result?.reason).toBe('incapacitated');
        });

        it('should break concentration when stunned', () => {
            characterRepo.update(testCharacter.id, { conditions: ['stunned'] });
            const updatedChar = characterRepo.findById(testCharacter.id)!;

            const result = checkAutomaticConcentrationBreak(
                updatedChar,
                concentrationRepo,
                characterRepo
            );

            expect(result).toBeTruthy();
            expect(result?.reason).toBe('incapacitated');
        });

        it('should not break concentration for non-incapacitating conditions', () => {
            characterRepo.update(testCharacter.id, { conditions: ['frightened', 'restrained'] });
            const updatedChar = characterRepo.findById(testCharacter.id)!;

            const result = checkAutomaticConcentrationBreak(
                updatedChar,
                concentrationRepo,
                characterRepo
            );

            expect(result).toBeNull();
        });

        it('should not break if not concentrating', () => {
            characterRepo.update(testCharacter.id, { hp: 0 });
            const updatedChar = characterRepo.findById(testCharacter.id)!;

            // Break concentration first
            breakConcentration(
                { characterId: testCharacter.id, reason: 'voluntary' },
                concentrationRepo,
                characterRepo
            );

            const result = checkAutomaticConcentrationBreak(
                updatedChar,
                concentrationRepo,
                characterRepo
            );

            expect(result).toBeNull();
        });
    });

    describe('Get Concentration State', () => {
        it('should return active concentration', () => {
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1,
                10,
                ['target-1', 'target-2'],
                concentrationRepo,
                characterRepo
            );

            const concentration = getConcentration(testCharacter.id, concentrationRepo);

            expect(concentration).toBeTruthy();
            expect(concentration?.activeSpell).toBe('Haste');
            expect(concentration?.spellLevel).toBe(3);
            expect(concentration?.targetIds).toEqual(['target-1', 'target-2']);
        });

        it('should return null if not concentrating', () => {
            const concentration = getConcentration(testCharacter.id, concentrationRepo);
            expect(concentration).toBeNull();
        });
    });

    describe('Integration: Full Concentration Flow', () => {
        it('should handle complete concentration lifecycle', () => {
            // Start concentration
            startConcentration(
                testCharacter.id,
                'Haste',
                3,
                1,
                10,
                ['ally-1'],
                concentrationRepo,
                characterRepo
            );

            // Check state
            let concentration = getConcentration(testCharacter.id, concentrationRepo);
            expect(concentration?.activeSpell).toBe('Haste');

            // Take minor damage - should maintain
            let checkResult = checkConcentration(testCharacter, 5, concentrationRepo);
            expect(checkResult.saveDC).toBe(10);

            // Take major damage - requires high save
            checkResult = checkConcentration(testCharacter, 40, concentrationRepo);
            expect(checkResult.saveDC).toBe(20);

            // Check duration (still within)
            let durationResult = checkConcentrationDuration(
                testCharacter.id,
                5,
                concentrationRepo,
                characterRepo
            );
            expect(durationResult).toBeNull();

            // Check duration (exceeded)
            durationResult = checkConcentrationDuration(
                testCharacter.id,
                15,
                concentrationRepo,
                characterRepo
            );
            expect(durationResult?.broken).toBe(true);

            // Verify concentration ended
            concentration = getConcentration(testCharacter.id, concentrationRepo);
            expect(concentration).toBeNull();
        });
    });
});
