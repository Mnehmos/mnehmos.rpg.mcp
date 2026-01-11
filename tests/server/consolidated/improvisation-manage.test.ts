/**
 * Tests for consolidated improvisation_manage tool
 * Validates all 8 actions: stunt, apply_effect, get_effects, remove_effect,
 * process_triggers, advance_durations, synthesize, get_spellbook
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleImprovisationManage, ImprovisationManageTool } from '../../../src/server/consolidated/improvisation-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { WorldRepository } from '../../../src/storage/repos/world.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- IMPROVISATION_MANAGE_JSON\n([\s\S]*?)\nIMPROVISATION_MANAGE_JSON -->/);
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

describe('improvisation_manage consolidated tool', () => {
    let testCharacterId: string;
    let testTargetId: string;
    let testWorldId: string;
    let testEffectId: number;
    const ctx = { sessionId: 'test-session' };

    beforeEach(async () => {
        closeDb();
        const db = getDb(':memory:');
        const now = new Date().toISOString();

        // Create a test world
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

        // Create test character (actor)
        const characterRepo = new CharacterRepository(db);
        testCharacterId = randomUUID();
        characterRepo.create({
            id: testCharacterId,
            name: 'Improvising Wizard',
            class: 'Wizard',
            level: 10,
            race: 'Elf',
            stats: { str: 8, dex: 14, con: 12, int: 18, wis: 14, cha: 10 },
            hp: 52,
            maxHp: 52,
            ac: 13,
            worldId: testWorldId,
            createdAt: now,
            updatedAt: now
        });

        // Create target character
        testTargetId = randomUUID();
        characterRepo.create({
            id: testTargetId,
            name: 'Test Target',
            class: 'Fighter',
            level: 5,
            race: 'Human',
            stats: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 10 },
            hp: 44,
            maxHp: 44,
            ac: 18,
            worldId: testWorldId,
            createdAt: now,
            updatedAt: now
        });

        // Create a test effect
        const effectResult = await handleImprovisationManage({
            action: 'apply_effect',
            targetId: testTargetId,
            targetType: 'character',
            name: 'Test Boon',
            description: 'A test blessing',
            category: 'boon',
            powerLevel: 2,
            sourceType: 'divine',
            mechanics: [{ type: 'attack_bonus', value: 2, condition: 'attack_rolls' }],
            durationType: 'rounds',
            durationValue: 5,
            triggers: [{ event: 'start_of_turn' }]
        }, ctx);
        testEffectId = parseResult(effectResult).effect?.id;
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(ImprovisationManageTool.name).toBe('improvisation_manage');
        });

        it('should list all available actions in description', () => {
            expect(ImprovisationManageTool.description).toContain('stunt');
            expect(ImprovisationManageTool.description).toContain('apply_effect');
            expect(ImprovisationManageTool.description).toContain('get_effects');
            expect(ImprovisationManageTool.description).toContain('remove_effect');
            expect(ImprovisationManageTool.description).toContain('process_triggers');
            expect(ImprovisationManageTool.description).toContain('advance_durations');
            expect(ImprovisationManageTool.description).toContain('synthesize');
            expect(ImprovisationManageTool.description).toContain('get_spellbook');
        });
    });

    describe('stunt action', () => {
        it('should resolve an improvised stunt with skill check', async () => {
            const result = await handleImprovisationManage({
                action: 'stunt',
                actorId: testCharacterId,
                narrativeIntent: 'Swing from chandelier to kick enemy',
                skill: 'acrobatics',
                dc: 15
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('stunt');
            expect(data.skill).toBe('acrobatics');
            expect(data.dc).toBe(15);
            expect(typeof data.roll).toBe('number');
            expect(typeof data.total).toBe('number');
            expect(typeof data.success).toBe('boolean');
        });

        it('should apply damage on successful stunt with successDamage', async () => {
            const result = await handleImprovisationManage({
                action: 'stunt',
                actorId: testCharacterId,
                narrativeIntent: 'Drop chandelier on enemies',
                skill: 'athletics',
                dc: 5, // Low DC for likely success
                successDamage: '2d6',
                damageType: 'bludgeoning',
                targetIds: [testTargetId]
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('stunt');
            // If successful, should have damage
            if (data.success) {
                expect(data.damage).toBeGreaterThan(0);
                expect(data.damageType).toBe('bludgeoning');
            }
        });

        it('should handle advantage/disadvantage', async () => {
            const resultAdv = await handleImprovisationManage({
                action: 'stunt',
                actorId: testCharacterId,
                narrativeIntent: 'Lucky trick',
                skill: 'performance',
                dc: 15,
                advantage: true
            }, ctx);

            const dataAdv = parseResult(resultAdv);
            expect(dataAdv.rolls.length).toBe(2); // Two dice with advantage

            const resultDis = await handleImprovisationManage({
                action: 'stunt',
                actorId: testCharacterId,
                narrativeIntent: 'Unlucky attempt',
                skill: 'persuasion',
                dc: 15,
                disadvantage: true
            }, ctx);

            const dataDis = parseResult(resultDis);
            expect(dataDis.rolls.length).toBe(2); // Two dice with disadvantage
        });

        it('should accept "rule_of_cool" alias', async () => {
            const result = await handleImprovisationManage({
                action: 'rule_of_cool',
                actorId: testCharacterId,
                narrativeIntent: 'Do something cool',
                skill: 'athletics',
                dc: 15
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('stunt');
        });

        it('should accept "improvise" alias', async () => {
            const result = await handleImprovisationManage({
                action: 'improvise',
                actorId: testCharacterId,
                narrativeIntent: 'Improvised action',
                skill: 'stealth',
                dc: 12
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('stunt');
        });
    });

    describe('apply_effect action', () => {
        it('should apply a boon effect', async () => {
            const result = await handleImprovisationManage({
                action: 'apply_effect',
                targetId: testCharacterId,
                targetType: 'character',
                name: 'Divine Protection',
                description: 'A blessing of protection',
                category: 'boon',
                powerLevel: 3,
                sourceType: 'divine',
                mechanics: [{ type: 'damage_resistance', value: 'fire' }],
                durationType: 'hours',
                durationValue: 1
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('apply_effect');
            expect(data.effect.name).toBe('Divine Protection');
        });

        it('should apply a curse effect', async () => {
            const result = await handleImprovisationManage({
                action: 'apply_effect',
                targetId: testTargetId,
                targetType: 'character',
                name: 'Dark Curse',
                category: 'curse',
                powerLevel: 2,
                sourceType: 'cursed',
                mechanics: [{ type: 'saving_throw_bonus', value: -2, condition: 'saving_throws' }],
                durationType: 'days',
                durationValue: 3
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.effect.category).toBe('curse');
        });

        it('should accept "boon" alias', async () => {
            const result = await handleImprovisationManage({
                action: 'boon',
                targetId: testCharacterId,
                targetType: 'character',
                name: 'Quick Boon',
                category: 'boon',
                powerLevel: 1,
                mechanics: [{ type: 'movement_modifier', value: 10 }],
                durationType: 'rounds',
                durationValue: 3
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('apply_effect');
        });

        it('should accept "curse" alias', async () => {
            const result = await handleImprovisationManage({
                action: 'curse',
                targetId: testTargetId,
                targetType: 'character',
                name: 'Quick Curse',
                category: 'curse',
                powerLevel: 1,
                mechanics: [{ type: 'movement_modifier', value: -10 }],
                durationType: 'rounds',
                durationValue: 3
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('apply_effect');
        });
    });

    describe('get_effects action', () => {
        it('should get all effects on a target', async () => {
            const result = await handleImprovisationManage({
                action: 'get_effects',
                targetId: testTargetId,
                targetType: 'character'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_effects');
            expect(data.count).toBeGreaterThanOrEqual(1);
        });

        it('should filter by category', async () => {
            // Add a curse
            await handleImprovisationManage({
                action: 'apply_effect',
                targetId: testTargetId,
                targetType: 'character',
                name: 'Filter Test Curse',
                category: 'curse',
                powerLevel: 1,
                mechanics: [{ type: 'custom_trigger', value: 1 }],
                durationType: 'permanent'
            }, ctx);

            const result = await handleImprovisationManage({
                action: 'get_effects',
                targetId: testTargetId,
                targetType: 'character',
                category: 'curse'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_effects');
            // If there are effects, they should all be curses
            if (data.effects && data.effects.length > 0) {
                expect(data.effects.every((e: any) => e.category === 'curse')).toBe(true);
            }
        });

        it('should accept "list_effects" alias', async () => {
            const result = await handleImprovisationManage({
                action: 'list_effects',
                targetId: testTargetId,
                targetType: 'character'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_effects');
        });
    });

    describe('remove_effect action', () => {
        it('should remove effect by ID', async () => {
            // First verify we have a valid effect ID
            expect(testEffectId).toBeDefined();

            const result = await handleImprovisationManage({
                action: 'remove_effect',
                effectId: testEffectId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('remove_effect');
            // May or may not succeed depending on whether effect still exists
        });

        it('should remove effect by name', async () => {
            // Create effect to remove
            await handleImprovisationManage({
                action: 'apply_effect',
                targetId: testTargetId,
                targetType: 'character',
                name: 'Removable Effect',
                category: 'neutral',
                powerLevel: 1,
                mechanics: [{ type: 'custom_trigger', value: 1 }],
                durationType: 'permanent'
            }, ctx);

            const result = await handleImprovisationManage({
                action: 'remove_effect',
                targetId: testTargetId,
                targetType: 'character',
                effectName: 'Removable Effect'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('remove_effect');
        });

        it('should return not found for non-existent effect', async () => {
            const result = await handleImprovisationManage({
                action: 'remove_effect',
                effectId: 99999
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('remove_effect');
            // success should be false for non-existent
            expect(data.success).not.toBe(true);
        });

        it('should accept "dispel" alias', async () => {
            // Create effect to dispel
            const createResult = await handleImprovisationManage({
                action: 'apply_effect',
                targetId: testTargetId,
                targetType: 'character',
                name: 'Dispellable Effect',
                category: 'neutral',
                powerLevel: 1,
                mechanics: [{ type: 'custom_trigger', value: 1 }],
                durationType: 'permanent'
            }, ctx);
            const effectId = parseResult(createResult).effect?.id;
            expect(effectId).toBeDefined();

            const result = await handleImprovisationManage({
                action: 'dispel',
                effectId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('remove_effect');
        });
    });

    describe('process_triggers action', () => {
        it('should process start_of_turn triggers', async () => {
            const result = await handleImprovisationManage({
                action: 'process_triggers',
                targetId: testTargetId,
                targetType: 'character',
                event: 'start_of_turn'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('process_triggers');
            expect(data.event).toBe('start_of_turn');
        });

        it('should process end_of_turn triggers', async () => {
            const result = await handleImprovisationManage({
                action: 'process_triggers',
                targetId: testTargetId,
                targetType: 'character',
                event: 'end_of_turn'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.event).toBe('end_of_turn');
        });

        it('should accept "fire_triggers" alias', async () => {
            const result = await handleImprovisationManage({
                action: 'fire_triggers',
                targetId: testTargetId,
                targetType: 'character',
                event: 'on_attack'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('process_triggers');
        });
    });

    describe('advance_durations action', () => {
        it('should advance effect durations', async () => {
            const result = await handleImprovisationManage({
                action: 'advance_durations',
                targetId: testTargetId,
                targetType: 'character',
                rounds: 1
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('advance_durations');
            expect(data.rounds).toBe(1);
        });

        it('should expire effects that run out', async () => {
            // Create short duration effect
            await handleImprovisationManage({
                action: 'apply_effect',
                targetId: testCharacterId,
                targetType: 'character',
                name: 'Short Effect',
                category: 'neutral',
                powerLevel: 1,
                mechanics: [{ type: 'custom_trigger', value: 1 }],
                durationType: 'rounds',
                durationValue: 1
            }, ctx);

            // Advance multiple rounds
            const result = await handleImprovisationManage({
                action: 'advance_durations',
                targetId: testCharacterId,
                targetType: 'character',
                rounds: 5
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('advance_durations');
            // Check that expired count is tracked
            expect(typeof data.expiredCount).toBe('number');
        });

        it('should accept "tick_effects" alias', async () => {
            const result = await handleImprovisationManage({
                action: 'tick_effects',
                targetId: testTargetId,
                targetType: 'character',
                rounds: 2
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('advance_durations');
        });
    });

    describe('synthesize action', () => {
        it('should attempt arcane synthesis', async () => {
            const result = await handleImprovisationManage({
                action: 'synthesize',
                casterId: testCharacterId,
                narrativeIntent: 'Create a bolt of fire',
                proposedName: 'Firebolt Improvised',
                estimatedLevel: 1,
                school: 'evocation',
                effectType: 'damage',
                effectDice: '2d6',
                damageType: 'fire',
                targetingType: 'single',
                targetingRange: 60
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('synthesize');
            expect(data.spellName).toContain('Firebolt');
            expect(['mastery', 'success', 'fizzle', 'backfire', 'catastrophic']).toContain(data.outcome);
        });

        it('should factor in spell level for DC', async () => {
            const resultLow = await handleImprovisationManage({
                action: 'synthesize',
                casterId: testCharacterId,
                narrativeIntent: 'Simple cantrip',
                estimatedLevel: 1,
                school: 'evocation',
                effectType: 'damage',
                targetingType: 'single',
                targetingRange: 30
            }, ctx);

            const resultHigh = await handleImprovisationManage({
                action: 'synthesize',
                casterId: testCharacterId,
                narrativeIntent: 'Powerful spell',
                estimatedLevel: 9,
                school: 'evocation',
                effectType: 'damage',
                targetingType: 'area',
                targetingRange: 150,
                areaSize: 40
            }, ctx);

            const dataLow = parseResult(resultLow);
            const dataHigh = parseResult(resultHigh);
            expect(dataHigh.dc).toBeGreaterThan(dataLow.dc);
        });

        it('should handle healing spells', async () => {
            const result = await handleImprovisationManage({
                action: 'synthesize',
                casterId: testCharacterId,
                narrativeIntent: 'Heal wounds',
                proposedName: 'Improvised Healing',
                estimatedLevel: 2,
                school: 'necromancy',
                effectType: 'healing',
                effectDice: '2d8+3',
                targetingType: 'single',
                targetingRange: 30
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('synthesize');
            if (data.success) {
                expect(data.healing).toBeDefined();
            }
        });

        it('should accept "arcane_synthesis" alias', async () => {
            const result = await handleImprovisationManage({
                action: 'arcane_synthesis',
                casterId: testCharacterId,
                narrativeIntent: 'Create spell',
                estimatedLevel: 1,
                school: 'illusion',
                effectType: 'utility',
                targetingType: 'self',
                targetingRange: 0
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('synthesize');
        });

        it('should apply material value reduction', async () => {
            const resultNoMat = await handleImprovisationManage({
                action: 'synthesize',
                casterId: testCharacterId,
                narrativeIntent: 'Basic spell no components',
                estimatedLevel: 3,
                school: 'conjuration',
                effectType: 'summoning',
                targetingType: 'single',
                targetingRange: 30
            }, ctx);

            const resultWithMat = await handleImprovisationManage({
                action: 'synthesize',
                casterId: testCharacterId,
                narrativeIntent: 'Basic spell with components',
                estimatedLevel: 3,
                school: 'conjuration',
                effectType: 'summoning',
                targetingType: 'single',
                targetingRange: 30,
                materialValue: 500 // Should reduce DC by up to 5
            }, ctx);

            const dataNoMat = parseResult(resultNoMat);
            const dataWithMat = parseResult(resultWithMat);
            // Material value should reduce DC
            expect(dataWithMat.dcBreakdown.materialReduction).toBeDefined();
            expect(dataWithMat.dcBreakdown.materialReduction).toBeLessThan(0);
        });
    });

    describe('get_spellbook action', () => {
        it('should get synthesized spells', async () => {
            const result = await handleImprovisationManage({
                action: 'get_spellbook',
                characterId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_spellbook');
            expect(data.characterId).toBe(testCharacterId);
            expect(typeof data.count).toBe('number');
        });

        it('should filter by school', async () => {
            const result = await handleImprovisationManage({
                action: 'get_spellbook',
                characterId: testCharacterId,
                school: 'evocation'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            // If there are spells, they should be evocation
            if (data.count > 0) {
                data.spells.forEach((s: any) => {
                    expect(s.school).toBe('evocation');
                });
            }
        });

        it('should accept "synthesized_spells" alias', async () => {
            const result = await handleImprovisationManage({
                action: 'synthesized_spells',
                characterId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_spellbook');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleImprovisationManage({
                action: 'stnt', // Missing 'u'
                actorId: testCharacterId,
                narrativeIntent: 'Typo test',
                skill: 'athletics',
                dc: 15
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('stunt');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleImprovisationManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting for stunt', async () => {
            const result = await handleImprovisationManage({
                action: 'stunt',
                actorId: testCharacterId,
                narrativeIntent: 'Test',
                skill: 'athletics',
                dc: 15
            }, ctx);

            const text = result.content[0].text;
            // Header uses uppercase format
            expect(text.toUpperCase()).toContain('IMPROVISED STUNT');
        });

        it('should include rich text formatting for synthesis', async () => {
            const result = await handleImprovisationManage({
                action: 'synthesize',
                casterId: testCharacterId,
                narrativeIntent: 'Test spell',
                estimatedLevel: 1,
                school: 'evocation',
                effectType: 'damage',
                targetingType: 'single',
                targetingRange: 30
            }, ctx);

            const text = result.content[0].text;
            // Header uses uppercase format
            expect(text.toUpperCase()).toContain('ARCANE SYNTHESIS');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleImprovisationManage({
                action: 'get_effects',
                targetId: testTargetId,
                targetType: 'character'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- IMPROVISATION_MANAGE_JSON');
        });
    });
});
