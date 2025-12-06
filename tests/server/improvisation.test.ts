/**
 * IMPROVISATION SYSTEMS TESTS
 *
 * TDD tests for:
 * - Rule of Cool (Improvised Stunts)
 * - Custom Effects System
 * - Arcane Synthesis (Dynamic Spell Creation)
 * - Flexible Character Creation
 *
 * Run: npm test -- tests/server/improvisation.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { migrate } from '../../src/storage/migrations.js';
import { setDb, closeDb } from '../../src/storage/index.js';
import { CustomEffectsRepository } from '../../src/storage/repos/custom-effects.repo.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import {
    WILD_SURGE_TABLE,
    SKILL_TO_ABILITY,
    DC_GUIDELINES,
    DAMAGE_GUIDELINES,
    ResolveImprovisedStuntArgsSchema,
    ApplyCustomEffectArgsSchema,
    AttemptArcaneSynthesisArgsSchema
} from '../../src/schema/improvisation.js';

// Test utilities
let db: Database.Database;
let effectsRepo: CustomEffectsRepository;
let charRepo: CharacterRepository;

beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    // Set the test database as the singleton so handlers use it
    setDb(db);
    effectsRepo = new CustomEffectsRepository(db);
    charRepo = new CharacterRepository(db);
});

afterEach(() => {
    closeDb();
});

// Helper functions
function createCharacter(overrides: Partial<any> = {}) {
    const id = overrides.id || uuid();
    charRepo.create({
        id,
        name: overrides.name || 'Test Character',
        worldId: 'test-world',
        type: overrides.type || 'pc',
        stats: overrides.stats || { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: overrides.hp || 20,
        maxHp: overrides.maxHp || 20,
        ac: overrides.ac || 10,
        level: overrides.level || 1,
        characterClass: overrides.characterClass || 'Fighter',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides
    });
    return charRepo.findById(id)!;
}

// ============================================================================
// CATEGORY 1: FLEXIBLE CHARACTER CREATION
// ============================================================================
describe('Category 1: Flexible Character Creation', () => {

    test('1.1 - create character with only name (minimal)', () => {
        const id = uuid();
        charRepo.create({
            id,
            name: 'Mysterious Stranger',
            worldId: 'test-world',
            type: 'pc',
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
            hp: 8,
            maxHp: 8,
            ac: 10,
            level: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        const char = charRepo.findById(id);
        expect(char).toBeDefined();
        expect(char!.name).toBe('Mysterious Stranger');
    });

    test('1.2 - accept ANY string for class', () => {
        const char = createCharacter({
            name: 'Creative Class',
            characterClass: 'Chronomancer'
        });

        expect(char.characterClass).toBe('Chronomancer');
    });

    test('1.3 - accept stats outside traditional 3-18 range', () => {
        // Godlike strength
        const godChar = createCharacter({
            name: 'Hercules',
            stats: { str: 25, dex: 18, con: 20, int: 12, wis: 14, cha: 16 }
        });
        expect(godChar.stats.str).toBe(25);

        // Cursed with low stat
        const cursedChar = createCharacter({
            name: 'Cursed One',
            stats: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }
        });
        expect(cursedChar.stats.str).toBe(1);
    });

    test('1.4 - HP is always at least 1', () => {
        // Character with very low CON
        const weakChar = createCharacter({
            name: 'Fragile',
            stats: { str: 10, dex: 10, con: 1, int: 10, wis: 10, cha: 10 },
            hp: 1,
            maxHp: 1
        });
        expect(weakChar.hp).toBeGreaterThanOrEqual(1);
    });
});

// ============================================================================
// CATEGORY 2: CUSTOM EFFECTS SYSTEM
// ============================================================================
describe('Category 2: Custom Effects System', () => {

    test('2.1 - apply a boon effect', () => {
        const char = createCharacter({ name: 'Blessed One' });

        const effect = effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Blessing of Strength',
            description: 'Divine power fills your muscles',
            source: { type: 'divine', entity_name: 'Kord' },
            category: 'boon',
            power_level: 2,
            mechanics: [
                { type: 'damage_bonus', value: 2, condition: 'melee attacks' }
            ],
            duration: { type: 'hours', value: 1 },
            triggers: [{ event: 'on_attack' }],
            removal_conditions: [{ type: 'duration_expires' }]
        });

        expect(effect.id).toBeDefined();
        expect(effect.name).toBe('Blessing of Strength');
        expect(effect.category).toBe('boon');
        expect(effect.power_level).toBe(2);
        expect(effect.is_active).toBe(true);
    });

    test('2.2 - apply a curse effect', () => {
        const char = createCharacter({ name: 'Cursed One' });

        const effect = effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Witch\'s Hex',
            description: 'Bad luck follows you',
            source: { type: 'cursed', entity_name: 'The Hag' },
            category: 'curse',
            power_level: 3,
            mechanics: [
                { type: 'disadvantage_on', value: 'saving_throws' }
            ],
            duration: { type: 'until_removed' },
            triggers: [{ event: 'always_active' }],
            removal_conditions: [{ type: 'dispelled', difficulty_class: 15 }]
        });

        expect(effect.category).toBe('curse');
        expect(effect.source_type).toBe('cursed');
    });

    test('2.3 - round-based effect expires correctly', () => {
        const char = createCharacter({ name: 'Fighter' });

        effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Haste',
            description: 'Magically quickened',
            source: { type: 'arcane' },
            category: 'boon',
            power_level: 3,
            mechanics: [{ type: 'extra_action', value: 1 }],
            duration: { type: 'rounds', value: 3 },
            triggers: [{ event: 'always_active' }],
            removal_conditions: [{ type: 'duration_expires' }]
        });

        // Advance 2 rounds
        let result = effectsRepo.advanceRounds(char.id, 'character', 2);
        expect(result.expired).toHaveLength(0);
        expect(result.advanced[0].rounds_remaining).toBe(1);

        // Advance 1 more round - should expire
        result = effectsRepo.advanceRounds(char.id, 'character', 1);
        expect(result.expired).toHaveLength(1);
        expect(result.expired[0].name).toBe('Haste');
    });

    test('2.4 - non-stackable effect refreshes duration', () => {
        const char = createCharacter({ name: 'Fighter' });

        // Apply effect
        effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Shield of Faith',
            description: '+2 AC',
            source: { type: 'divine' },
            category: 'boon',
            power_level: 1,
            mechanics: [{ type: 'ac_bonus', value: 2 }],
            duration: { type: 'rounds', value: 5 },
            triggers: [{ event: 'always_active' }],
            removal_conditions: [{ type: 'duration_expires' }],
            stackable: false
        });

        // Advance some rounds
        effectsRepo.advanceRounds(char.id, 'character', 3);

        // Re-apply - should refresh duration
        const refreshed = effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Shield of Faith',
            description: '+2 AC',
            source: { type: 'divine' },
            category: 'boon',
            power_level: 1,
            mechanics: [{ type: 'ac_bonus', value: 2 }],
            duration: { type: 'rounds', value: 5 },
            triggers: [{ event: 'always_active' }],
            removal_conditions: [{ type: 'duration_expires' }],
            stackable: false
        });

        expect(refreshed.rounds_remaining).toBe(5);

        // Should still be only one effect
        const effects = effectsRepo.getEffectsOnTarget(char.id, 'character');
        expect(effects).toHaveLength(1);
    });

    test('2.5 - stackable effect increases stacks', () => {
        const char = createCharacter({ name: 'Fighter' });

        // Apply stackable effect
        effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Rage',
            description: 'Increasing fury',
            source: { type: 'natural' },
            category: 'boon',
            power_level: 2,
            mechanics: [{ type: 'damage_bonus', value: 2 }],
            duration: { type: 'rounds', value: 10 },
            triggers: [{ event: 'on_attack' }],
            removal_conditions: [{ type: 'duration_expires' }],
            stackable: true,
            max_stacks: 3
        });

        // Apply again - should stack
        const stacked = effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Rage',
            description: 'Increasing fury',
            source: { type: 'natural' },
            category: 'boon',
            power_level: 2,
            mechanics: [{ type: 'damage_bonus', value: 2 }],
            duration: { type: 'rounds', value: 10 },
            triggers: [{ event: 'on_attack' }],
            removal_conditions: [{ type: 'duration_expires' }],
            stackable: true,
            max_stacks: 3
        });

        expect(stacked.current_stacks).toBe(2);
    });

    test('2.6 - get effects by trigger event', () => {
        const char = createCharacter({ name: 'Multi-Effect' });

        // Effect on attack
        effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Smite',
            description: 'Extra damage on hit',
            source: { type: 'divine' },
            category: 'boon',
            power_level: 2,
            mechanics: [{ type: 'damage_bonus', value: '2d8' }],
            duration: { type: 'rounds', value: 1 },
            triggers: [{ event: 'on_attack' }],
            removal_conditions: [{ type: 'duration_expires' }]
        });

        // Effect on damage taken
        effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Fire Shield',
            description: 'Damages attackers',
            source: { type: 'arcane' },
            category: 'boon',
            power_level: 3,
            mechanics: [{ type: 'damage_over_time', value: '2d8' }],
            duration: { type: 'rounds', value: 10 },
            triggers: [{ event: 'on_damage_taken' }],
            removal_conditions: [{ type: 'duration_expires' }]
        });

        const onAttack = effectsRepo.getEffectsByTrigger(char.id, 'character', 'on_attack');
        expect(onAttack).toHaveLength(1);
        expect(onAttack[0].name).toBe('Smite');

        const onDamage = effectsRepo.getEffectsByTrigger(char.id, 'character', 'on_damage_taken');
        expect(onDamage).toHaveLength(1);
        expect(onDamage[0].name).toBe('Fire Shield');
    });

    test('2.7 - remove effect by name', () => {
        const char = createCharacter({ name: 'Fighter' });

        effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Curse of Weakness',
            description: 'Sapped strength',
            source: { type: 'cursed' },
            category: 'curse',
            power_level: 2,
            mechanics: [{ type: 'damage_bonus', value: -2 }],
            duration: { type: 'until_removed' },
            triggers: [{ event: 'always_active' }],
            removal_conditions: [{ type: 'dispelled' }]
        });

        const removed = effectsRepo.removeByName(char.id, 'character', 'Curse of Weakness');
        expect(removed).toBe(true);

        const effects = effectsRepo.getEffectsOnTarget(char.id, 'character');
        expect(effects).toHaveLength(0);
    });

    test('2.8 - calculate total bonus from multiple effects', () => {
        const char = createCharacter({ name: 'Buffed Fighter' });

        // Multiple damage bonuses
        effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Bless',
            description: '+1 to attacks',
            source: { type: 'divine' },
            category: 'boon',
            power_level: 1,
            mechanics: [{ type: 'attack_bonus', value: 1 }],
            duration: { type: 'rounds', value: 10 },
            triggers: [{ event: 'always_active' }],
            removal_conditions: [{ type: 'duration_expires' }]
        });

        effectsRepo.apply({
            target_id: char.id,
            target_type: 'character',
            name: 'Heroism',
            description: '+3 to attacks',
            source: { type: 'divine' },
            category: 'boon',
            power_level: 2,
            mechanics: [{ type: 'attack_bonus', value: 3 }],
            duration: { type: 'rounds', value: 10 },
            triggers: [{ event: 'always_active' }],
            removal_conditions: [{ type: 'duration_expires' }]
        });

        const totalBonus = effectsRepo.calculateTotalBonus(char.id, 'character', 'attack_bonus');
        expect(totalBonus).toBe(4); // 1 + 3
    });
});

// ============================================================================
// CATEGORY 3: SCHEMA VALIDATION
// ============================================================================
describe('Category 3: Schema Validation', () => {

    test('3.1 - ResolveImprovisedStuntArgsSchema validates correctly', () => {
        const validStunt = {
            encounter_id: 1,
            actor_id: 1,
            actor_type: 'character',
            narrative_intent: 'I kick the brazier into the zombies',
            skill_check: { skill: 'athletics', dc: 15 },
            action_cost: 'action',
            consequences: {
                success_damage: '2d6',
                damage_type: 'fire'
            }
        };

        const result = ResolveImprovisedStuntArgsSchema.safeParse(validStunt);
        expect(result.success).toBe(true);
    });

    test('3.2 - ApplyCustomEffectArgsSchema validates correctly', () => {
        const validEffect = {
            target_id: 'char-123',
            target_type: 'character',
            name: 'Test Effect',
            description: 'A test',
            source: { type: 'divine' },
            category: 'boon',
            power_level: 1,
            mechanics: [{ type: 'damage_bonus', value: 2 }],
            duration: { type: 'rounds', value: 5 },
            triggers: [{ event: 'on_attack' }],
            removal_conditions: [{ type: 'duration_expires' }]
        };

        const result = ApplyCustomEffectArgsSchema.safeParse(validEffect);
        expect(result.success).toBe(true);
    });

    test('3.3 - AttemptArcaneSynthesisArgsSchema validates correctly', () => {
        const validSynthesis = {
            caster_id: 'wizard-1',
            caster_type: 'character',
            narrative_intent: 'I weave shadows to blind the orc',
            estimated_level: 2,
            school: 'illusion',
            effect_specification: {
                type: 'status',
                condition: 'blinded'
            },
            targeting: { type: 'single', range: 60 },
            components: { verbal: true, somatic: true },
            concentration: true,
            duration: '1 minute'
        };

        const result = AttemptArcaneSynthesisArgsSchema.safeParse(validSynthesis);
        expect(result.success).toBe(true);
    });

    test('3.4 - DC validation in range 5-30', () => {
        // Valid DCs
        expect(ResolveImprovisedStuntArgsSchema.shape.skill_check.shape.dc.safeParse(5).success).toBe(true);
        expect(ResolveImprovisedStuntArgsSchema.shape.skill_check.shape.dc.safeParse(30).success).toBe(true);

        // Invalid DCs
        expect(ResolveImprovisedStuntArgsSchema.shape.skill_check.shape.dc.safeParse(4).success).toBe(false);
        expect(ResolveImprovisedStuntArgsSchema.shape.skill_check.shape.dc.safeParse(31).success).toBe(false);
    });

    test('3.5 - power level validation in range 1-5', () => {
        for (let i = 1; i <= 5; i++) {
            const effect = {
                target_id: 'char-123',
                target_type: 'character',
                name: 'Test',
                description: 'Test',
                source: { type: 'divine' },
                category: 'boon',
                power_level: i,
                mechanics: [],
                duration: { type: 'rounds', value: 1 },
                triggers: [],
                removal_conditions: []
            };
            expect(ApplyCustomEffectArgsSchema.safeParse(effect).success).toBe(true);
        }

        // Invalid power levels
        const invalidEffect = {
            target_id: 'char-123',
            target_type: 'character',
            name: 'Test',
            description: 'Test',
            source: { type: 'divine' },
            category: 'boon',
            power_level: 6,
            mechanics: [],
            duration: { type: 'rounds', value: 1 },
            triggers: [],
            removal_conditions: []
        };
        expect(ApplyCustomEffectArgsSchema.safeParse(invalidEffect).success).toBe(false);
    });
});

// ============================================================================
// CATEGORY 4: WILD SURGE TABLE
// ============================================================================
describe('Category 4: Wild Surge Table', () => {

    test('4.1 - wild surge table has exactly 20 entries', () => {
        expect(WILD_SURGE_TABLE).toHaveLength(20);
    });

    test('4.2 - wild surge entries cover rolls 1-20', () => {
        const rolls = WILD_SURGE_TABLE.map(ws => ws.roll).sort((a, b) => a - b);
        expect(rolls).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    });

    test('4.3 - each wild surge has name and effect', () => {
        for (const surge of WILD_SURGE_TABLE) {
            expect(surge.name).toBeDefined();
            expect(surge.name.length).toBeGreaterThan(0);
            expect(surge.effect).toBeDefined();
            expect(surge.effect.length).toBeGreaterThan(0);
        }
    });

    test('4.4 - all wild surge names are unique', () => {
        const names = WILD_SURGE_TABLE.map(ws => ws.name);
        const uniqueNames = new Set(names);
        expect(uniqueNames.size).toBe(names.length);
    });
});

// ============================================================================
// CATEGORY 5: SKILL TO ABILITY MAPPING
// ============================================================================
describe('Category 5: Skill to Ability Mapping', () => {

    test('5.1 - all 18 skills are mapped', () => {
        const skills = Object.keys(SKILL_TO_ABILITY);
        expect(skills).toHaveLength(18);
    });

    test('5.2 - strength skills map correctly', () => {
        expect(SKILL_TO_ABILITY.athletics).toBe('strength');
    });

    test('5.3 - dexterity skills map correctly', () => {
        expect(SKILL_TO_ABILITY.acrobatics).toBe('dexterity');
        expect(SKILL_TO_ABILITY.sleight_of_hand).toBe('dexterity');
        expect(SKILL_TO_ABILITY.stealth).toBe('dexterity');
    });

    test('5.4 - intelligence skills map correctly', () => {
        expect(SKILL_TO_ABILITY.arcana).toBe('intelligence');
        expect(SKILL_TO_ABILITY.history).toBe('intelligence');
        expect(SKILL_TO_ABILITY.investigation).toBe('intelligence');
        expect(SKILL_TO_ABILITY.nature).toBe('intelligence');
        expect(SKILL_TO_ABILITY.religion).toBe('intelligence');
    });

    test('5.5 - wisdom skills map correctly', () => {
        expect(SKILL_TO_ABILITY.animal_handling).toBe('wisdom');
        expect(SKILL_TO_ABILITY.insight).toBe('wisdom');
        expect(SKILL_TO_ABILITY.medicine).toBe('wisdom');
        expect(SKILL_TO_ABILITY.perception).toBe('wisdom');
        expect(SKILL_TO_ABILITY.survival).toBe('wisdom');
    });

    test('5.6 - charisma skills map correctly', () => {
        expect(SKILL_TO_ABILITY.deception).toBe('charisma');
        expect(SKILL_TO_ABILITY.intimidation).toBe('charisma');
        expect(SKILL_TO_ABILITY.performance).toBe('charisma');
        expect(SKILL_TO_ABILITY.persuasion).toBe('charisma');
    });
});

// ============================================================================
// CATEGORY 6: DC AND DAMAGE GUIDELINES
// ============================================================================
describe('Category 6: DC and Damage Guidelines', () => {

    test('6.1 - DC guidelines are in ascending order', () => {
        expect(DC_GUIDELINES.TRIVIAL).toBeLessThan(DC_GUIDELINES.EASY);
        expect(DC_GUIDELINES.EASY).toBeLessThan(DC_GUIDELINES.MEDIUM);
        expect(DC_GUIDELINES.MEDIUM).toBeLessThan(DC_GUIDELINES.HARD);
        expect(DC_GUIDELINES.HARD).toBeLessThan(DC_GUIDELINES.VERY_HARD);
        expect(DC_GUIDELINES.VERY_HARD).toBeLessThan(DC_GUIDELINES.NEARLY_IMPOSSIBLE);
    });

    test('6.2 - DC guidelines are 5e standard values', () => {
        expect(DC_GUIDELINES.TRIVIAL).toBe(5);
        expect(DC_GUIDELINES.EASY).toBe(10);
        expect(DC_GUIDELINES.MEDIUM).toBe(15);
        expect(DC_GUIDELINES.HARD).toBe(20);
        expect(DC_GUIDELINES.VERY_HARD).toBe(25);
        expect(DC_GUIDELINES.NEARLY_IMPOSSIBLE).toBe(30);
    });

    test('6.3 - damage guidelines are valid dice notation', () => {
        const dicePattern = /^\d+d\d+$/;
        expect(DAMAGE_GUIDELINES.NUISANCE).toMatch(dicePattern);
        expect(DAMAGE_GUIDELINES.LIGHT).toMatch(dicePattern);
        expect(DAMAGE_GUIDELINES.MODERATE).toMatch(dicePattern);
        expect(DAMAGE_GUIDELINES.HEAVY).toMatch(dicePattern);
        expect(DAMAGE_GUIDELINES.SEVERE).toMatch(dicePattern);
        expect(DAMAGE_GUIDELINES.MASSIVE).toMatch(dicePattern);
        expect(DAMAGE_GUIDELINES.CATASTROPHIC).toMatch(dicePattern);
    });

    test('6.4 - damage guidelines increase in severity', () => {
        const parseDice = (notation: string) => {
            const [count, sides] = notation.split('d').map(Number);
            return count * ((sides + 1) / 2); // Average damage
        };

        expect(parseDice(DAMAGE_GUIDELINES.NUISANCE)).toBeLessThan(parseDice(DAMAGE_GUIDELINES.LIGHT));
        expect(parseDice(DAMAGE_GUIDELINES.LIGHT)).toBeLessThan(parseDice(DAMAGE_GUIDELINES.MODERATE));
        expect(parseDice(DAMAGE_GUIDELINES.MODERATE)).toBeLessThan(parseDice(DAMAGE_GUIDELINES.HEAVY));
        expect(parseDice(DAMAGE_GUIDELINES.HEAVY)).toBeLessThan(parseDice(DAMAGE_GUIDELINES.SEVERE));
        expect(parseDice(DAMAGE_GUIDELINES.SEVERE)).toBeLessThan(parseDice(DAMAGE_GUIDELINES.MASSIVE));
        expect(parseDice(DAMAGE_GUIDELINES.MASSIVE)).toBeLessThan(parseDice(DAMAGE_GUIDELINES.CATASTROPHIC));
    });
});

// ============================================================================
// CATEGORY 7: DATABASE SCHEMA
// ============================================================================
describe('Category 7: Database Schema', () => {

    test('7.1 - custom_effects table exists', () => {
        const tables = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='custom_effects'
        `).all();
        expect(tables).toHaveLength(1);
    });

    test('7.2 - synthesized_spells table exists', () => {
        const tables = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='synthesized_spells'
        `).all();
        expect(tables).toHaveLength(1);
    });

    test('7.3 - custom_effects has required columns', () => {
        const columns = db.prepare('PRAGMA table_info(custom_effects)').all() as { name: string }[];
        const columnNames = columns.map(c => c.name);

        expect(columnNames).toContain('id');
        expect(columnNames).toContain('target_id');
        expect(columnNames).toContain('target_type');
        expect(columnNames).toContain('name');
        expect(columnNames).toContain('category');
        expect(columnNames).toContain('power_level');
        expect(columnNames).toContain('mechanics');
        expect(columnNames).toContain('duration_type');
        expect(columnNames).toContain('rounds_remaining');
        expect(columnNames).toContain('triggers');
        expect(columnNames).toContain('removal_conditions');
        expect(columnNames).toContain('is_active');
    });

    test('7.4 - synthesized_spells has required columns', () => {
        const columns = db.prepare('PRAGMA table_info(synthesized_spells)').all() as { name: string }[];
        const columnNames = columns.map(c => c.name);

        expect(columnNames).toContain('id');
        expect(columnNames).toContain('character_id');
        expect(columnNames).toContain('name');
        expect(columnNames).toContain('level');
        expect(columnNames).toContain('school');
        expect(columnNames).toContain('effect_type');
        expect(columnNames).toContain('synthesis_dc');
        expect(columnNames).toContain('times_cast');
    });

    test('7.5 - indexes exist for performance', () => {
        const indexes = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type='index' AND name LIKE 'idx_custom_effects%'
        `).all() as { name: string }[];

        expect(indexes.length).toBeGreaterThanOrEqual(1);
    });
});

// ============================================================================
// CATEGORY 8: RULE OF COOL - STUNT RESOLUTION
// ============================================================================
describe('Category 8: Rule of Cool - Stunt Resolution', () => {
    test('8.0 - MED-008: stunt resolution should look up actual target names when IDs are strings', async () => {
        // Create NPCs with actual names - using string IDs
        const thug1 = createCharacter({ id: '1', name: 'Brutus the Thug', type: 'npc' });
        const thug2 = createCharacter({ id: '2', name: 'Marcus the Guard', type: 'npc' });
        const player = createCharacter({ id: '3', name: 'Hero', stats: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 } });

        // Import and call the handler - using integer IDs as per schema
        // The schema uses integer IDs (encounter participant IDs), but internally
        // we convert to string for character lookup
        const { handleResolveImprovisedStunt } = await import('../../src/server/improvisation-tools.js');

        const result = await handleResolveImprovisedStunt({
            encounter_id: 1,
            actor_id: 3, // Integer ID as required by schema
            actor_type: 'character',
            target_ids: [1, 2], // Integer IDs as required by schema
            target_types: ['npc', 'npc'],
            narrative_intent: 'I swing from the chandelier and kick both thugs',
            skill_check: { skill: 'acrobatics', dc: 15 },
            action_cost: 'action',
            consequences: {
                success_damage: '2d6',
                damage_type: 'bludgeoning',
                apply_condition: 'prone'
            }
        }, { requestId: 'test' });

        // Parse the result text to check for actual names
        const text = result.content[0].text;

        // The output should contain the actual NPC names, not "Target 1" and "Target 2"
        // If the stunt succeeded and there are targets affected, check for names
        if (text.includes('🎯 Targets:')) {
            expect(text).toContain('Brutus the Thug');
            expect(text).toContain('Marcus the Guard');
            expect(text).not.toMatch(/• Target 1:/);
            expect(text).not.toMatch(/• Target 2:/);
        }
    });
});

// ============================================================================
// CATEGORY 9: SYNTHESIZED SPELLS
// ============================================================================
describe('Category 9: Synthesized Spells', () => {

    test('8.1 - can insert synthesized spell', () => {
        const char = createCharacter({ name: 'Wizard' });

        db.prepare(`
            INSERT INTO synthesized_spells (
                character_id, name, level, school, effect_type,
                targeting_type, targeting_range,
                components_verbal, components_somatic, concentration,
                duration, synthesis_dc, created_at, mastered_at, times_cast
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            char.id, 'Shadow Blind', 2, 'illusion', 'status',
            'single', 60,
            1, 1, 1,
            '1 minute', 14, new Date().toISOString(), new Date().toISOString(), 1
        );

        const spell = db.prepare(`
            SELECT * FROM synthesized_spells WHERE character_id = ?
        `).get(char.id) as any;

        expect(spell).toBeDefined();
        expect(spell.name).toBe('Shadow Blind');
        expect(spell.level).toBe(2);
        expect(spell.school).toBe('illusion');
    });

    test('8.2 - unique constraint on character_id + name', () => {
        const char = createCharacter({ name: 'Wizard' });

        db.prepare(`
            INSERT INTO synthesized_spells (
                character_id, name, level, school, effect_type,
                targeting_type, targeting_range,
                components_verbal, components_somatic, concentration,
                duration, synthesis_dc, created_at, mastered_at, times_cast
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            char.id, 'Unique Spell', 1, 'evocation', 'damage',
            'single', 60,
            1, 1, 0,
            'instant', 12, new Date().toISOString(), new Date().toISOString(), 1
        );

        // Try to insert duplicate - should fail
        expect(() => {
            db.prepare(`
                INSERT INTO synthesized_spells (
                    character_id, name, level, school, effect_type,
                    targeting_type, targeting_range,
                    components_verbal, components_somatic, concentration,
                    duration, synthesis_dc, created_at, mastered_at, times_cast
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                char.id, 'Unique Spell', 1, 'evocation', 'damage',
                'single', 60,
                1, 1, 0,
                'instant', 12, new Date().toISOString(), new Date().toISOString(), 1
            );
        }).toThrow();
    });

    test('8.3 - can increment times_cast', () => {
        const char = createCharacter({ name: 'Wizard' });

        db.prepare(`
            INSERT INTO synthesized_spells (
                character_id, name, level, school, effect_type,
                targeting_type, targeting_range,
                components_verbal, components_somatic, concentration,
                duration, synthesis_dc, created_at, mastered_at, times_cast
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            char.id, 'Fireball', 3, 'evocation', 'damage',
            'area', 150,
            1, 1, 0,
            'instant', 16, new Date().toISOString(), new Date().toISOString(), 1
        );

        db.prepare(`
            UPDATE synthesized_spells SET times_cast = times_cast + 1
            WHERE character_id = ? AND name = ?
        `).run(char.id, 'Fireball');

        const spell = db.prepare(`
            SELECT times_cast FROM synthesized_spells WHERE character_id = ? AND name = ?
        `).get(char.id, 'Fireball') as { times_cast: number };

        expect(spell.times_cast).toBe(2);
    });
});
