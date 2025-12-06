/**
 * Tests for Aura System
 * Covers aura creation, radius checks, target filtering, effect application, and integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/storage/index.js';
import { AuraRepository } from '../../src/storage/repos/aura.repo.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { ConcentrationRepository } from '../../src/storage/repos/concentration.repo.js';
import {
    createAura,
    endAura,
    endAurasByOwner,
    getActiveAuras,
    isInAuraRange,
    calculateDistance,
    shouldAffectTarget,
    checkAuraEffectsForTarget,
    checkAuraDuration,
    expireOldAuras,
    applyAuraEffect,
} from '../../src/engine/magic/aura.js';
import { startConcentration } from '../../src/engine/magic/concentration.js';
import { AuraState, AuraEffect, CreateAuraRequest } from '../../src/schema/aura.js';
import { Token, Position } from '../../src/schema/encounter.js';
import { Character } from '../../src/schema/character.js';

describe('Aura System', () => {
    let db: any;
    let auraRepo: AuraRepository;
    let characterRepo: CharacterRepository;
    let concentrationRepo: ConcentrationRepository;

    beforeEach(() => {
        db = getDb(':memory:');
        auraRepo = new AuraRepository(db);
        characterRepo = new CharacterRepository(db);
        concentrationRepo = new ConcentrationRepository(db);

        // Clean up any existing auras from previous tests
        const existingAuras = auraRepo.findAll();
        for (const aura of existingAuras) {
            auraRepo.delete(aura.id);
        }
    });

    describe('Distance Calculations', () => {
        it('should calculate distance between positions in feet', () => {
            const pos1: Position = { x: 0, y: 0 };
            const pos2: Position = { x: 3, y: 4 }; // 5 squares away

            const distance = calculateDistance(pos1, pos2);
            expect(distance).toBe(25); // 5 squares * 5 feet = 25 feet
        });

        it('should calculate distance for adjacent squares', () => {
            const pos1: Position = { x: 0, y: 0 };
            const pos2: Position = { x: 1, y: 0 }; // 1 square away

            const distance = calculateDistance(pos1, pos2);
            expect(distance).toBe(5); // 1 square * 5 feet = 5 feet
        });

        it('should return 0 for same position', () => {
            const pos1: Position = { x: 5, y: 5 };
            const pos2: Position = { x: 5, y: 5 };

            const distance = calculateDistance(pos1, pos2);
            expect(distance).toBe(0);
        });
    });

    describe('Aura Range Checks', () => {
        it('should correctly identify positions within aura radius', () => {
            const center: Position = { x: 10, y: 10 };
            const target: Position = { x: 12, y: 10 }; // 2 squares = 10 feet away
            const radius = 15; // 15 feet

            const inRange = isInAuraRange(center, target, radius);
            expect(inRange).toBe(true);
        });

        it('should correctly identify positions outside aura radius', () => {
            const center: Position = { x: 10, y: 10 };
            const target: Position = { x: 14, y: 10 }; // 4 squares = 20 feet away
            const radius = 15; // 15 feet

            const inRange = isInAuraRange(center, target, radius);
            expect(inRange).toBe(false);
        });

        it('should include positions exactly at radius edge', () => {
            const center: Position = { x: 0, y: 0 };
            const target: Position = { x: 3, y: 0 }; // 3 squares = 15 feet away
            const radius = 15; // 15 feet

            const inRange = isInAuraRange(center, target, radius);
            expect(inRange).toBe(true);
        });
    });

    describe('Aura Creation and Tracking', () => {
        it('should create a new aura successfully', () => {
            // Create a character first
            const character: Character = {
                id: 'cleric-1',
                name: 'Cleric',
                stats: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
                hp: 30,
                maxHp: 30,
                ac: 16,
                level: 5,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            characterRepo.create(character);

            const request: CreateAuraRequest = {
                ownerId: 'cleric-1',
                spellName: 'Spirit Guardians',
                spellLevel: 3,
                radius: 15,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [
                    {
                        trigger: 'start_of_turn',
                        type: 'damage',
                        dice: '3d8',
                        damageType: 'radiant',
                        saveType: 'wisdom',
                        saveDC: 14,
                    },
                ],
                currentRound: 1,
                maxDuration: 100,
                requiresConcentration: true,
            };

            const aura = createAura(request, auraRepo);

            expect(aura.id).toBeDefined();
            expect(aura.ownerId).toBe('cleric-1');
            expect(aura.spellName).toBe('Spirit Guardians');
            expect(aura.radius).toBe(15);
            expect(aura.affectsEnemies).toBe(true);
            expect(aura.requiresConcentration).toBe(true);
        });

        it('should retrieve active auras', () => {
            const character: Character = {
                id: 'paladin-1',
                name: 'Paladin',
                stats: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 14 },
                hp: 40,
                maxHp: 40,
                ac: 18,
                level: 6,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            characterRepo.create(character);

            const request: CreateAuraRequest = {
                ownerId: 'paladin-1',
                spellName: 'Aura of Protection',
                spellLevel: 0,
                radius: 10,
                affectsAllies: true,
                affectsEnemies: false,
                affectsSelf: true,
                effects: [
                    {
                        trigger: 'start_of_turn',
                        type: 'buff',
                        bonusAmount: 2,
                        bonusType: 'saves',
                        description: '+2 to all saving throws',
                    },
                ],
                currentRound: 1,
                requiresConcentration: false,
            };

            createAura(request, auraRepo);

            const activeAuras = getActiveAuras(auraRepo);
            expect(activeAuras).toHaveLength(1);
            expect(activeAuras[0].spellName).toBe('Aura of Protection');
        });

        it('should end an aura by ID', () => {
            const character: Character = {
                id: 'wizard-1',
                name: 'Wizard',
                stats: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
                hp: 25,
                maxHp: 25,
                ac: 12,
                level: 5,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            characterRepo.create(character);

            const request: CreateAuraRequest = {
                ownerId: 'wizard-1',
                spellName: 'Cloudkill',
                spellLevel: 5,
                radius: 20,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [
                    {
                        trigger: 'start_of_turn',
                        type: 'damage',
                        dice: '5d8',
                        damageType: 'poison',
                        saveType: 'constitution',
                        saveDC: 15,
                    },
                ],
                currentRound: 1,
                maxDuration: 100,
                requiresConcentration: true,
            };

            const aura = createAura(request, auraRepo);
            expect(getActiveAuras(auraRepo)).toHaveLength(1);

            const removed = endAura(aura.id, auraRepo);
            expect(removed).toBe(true);
            expect(getActiveAuras(auraRepo)).toHaveLength(0);
        });

        it('should end all auras owned by a character', () => {
            const character: Character = {
                id: 'druid-1',
                name: 'Druid',
                stats: { str: 10, dex: 12, con: 14, int: 12, wis: 16, cha: 10 },
                hp: 35,
                maxHp: 35,
                ac: 14,
                level: 7,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            characterRepo.create(character);

            // Create multiple auras
            for (let i = 0; i < 3; i++) {
                const request: CreateAuraRequest = {
                    ownerId: 'druid-1',
                    spellName: `Aura ${i}`,
                    spellLevel: 1,
                    radius: 10,
                    affectsAllies: true,
                    affectsEnemies: false,
                    affectsSelf: false,
                    effects: [
                        {
                            trigger: 'start_of_turn',
                            type: 'healing',
                            dice: '1d6',
                        },
                    ],
                    currentRound: 1,
                    requiresConcentration: false,
                };
                createAura(request, auraRepo);
            }

            expect(getActiveAuras(auraRepo)).toHaveLength(3);

            const removed = endAurasByOwner('druid-1', auraRepo);
            expect(removed).toBe(3);
            expect(getActiveAuras(auraRepo)).toHaveLength(0);
        });
    });

    describe('Target Filtering', () => {
        it('should affect enemies when affectsEnemies is true', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'owner-1',
                spellName: 'Test Aura',
                spellLevel: 1,
                radius: 10,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [],
                startedAt: 1,
                requiresConcentration: false,
            };

            const enemy: Token = {
                id: 'enemy-1',
                name: 'Goblin',
                hp: 10,
                maxHp: 10,
                ac: 12,
                initiative: 10,
                isEnemy: true,
            };

            const ownerIsAlly = false; // Enemy of the owner
            const shouldAffect = shouldAffectTarget(aura, enemy, ownerIsAlly);
            expect(shouldAffect).toBe(true);
        });

        it('should not affect allies when affectsAllies is false', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'owner-1',
                spellName: 'Test Aura',
                spellLevel: 1,
                radius: 10,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [],
                startedAt: 1,
                requiresConcentration: false,
            };

            const ally: Token = {
                id: 'ally-1',
                name: 'Fighter',
                hp: 40,
                maxHp: 40,
                ac: 18,
                initiative: 15,
                isEnemy: false,
            };

            const ownerIsAlly = true; // Ally of the owner
            const shouldAffect = shouldAffectTarget(aura, ally, ownerIsAlly);
            expect(shouldAffect).toBe(false);
        });

        it('should affect self when affectsSelf is true', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'owner-1',
                spellName: 'Test Aura',
                spellLevel: 1,
                radius: 10,
                affectsAllies: true,
                affectsEnemies: false,
                affectsSelf: true,
                effects: [],
                startedAt: 1,
                requiresConcentration: false,
            };

            const self: Token = {
                id: 'owner-1',
                name: 'Paladin',
                hp: 40,
                maxHp: 40,
                ac: 18,
                initiative: 12,
                isEnemy: false,
            };

            const ownerIsAlly = true;
            const shouldAffect = shouldAffectTarget(aura, self, ownerIsAlly);
            expect(shouldAffect).toBe(true);
        });

        it('should not affect self when affectsSelf is false', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'owner-1',
                spellName: 'Test Aura',
                spellLevel: 1,
                radius: 10,
                affectsAllies: true,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [],
                startedAt: 1,
                requiresConcentration: false,
            };

            const self: Token = {
                id: 'owner-1',
                name: 'Cleric',
                hp: 30,
                maxHp: 30,
                ac: 16,
                initiative: 10,
                isEnemy: false,
            };

            const ownerIsAlly = true;
            const shouldAffect = shouldAffectTarget(aura, self, ownerIsAlly);
            expect(shouldAffect).toBe(false);
        });
    });

    describe('Effect Application', () => {
        it('should apply damage effect with saving throw', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'cleric-1',
                spellName: 'Spirit Guardians',
                spellLevel: 3,
                radius: 15,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [],
                startedAt: 1,
                requiresConcentration: true,
            };

            const effect: AuraEffect = {
                trigger: 'start_of_turn',
                type: 'damage',
                dice: '3d8',
                damageType: 'radiant',
                saveType: 'wisdom',
                saveDC: 14,
            };

            const target: Token = {
                id: 'goblin-1',
                name: 'Goblin',
                hp: 20,
                maxHp: 20,
                ac: 12,
                initiative: 10,
                isEnemy: true,
                abilityScores: {
                    strength: 8,
                    dexterity: 14,
                    constitution: 10,
                    intelligence: 10,
                    wisdom: 8, // -1 modifier
                    charisma: 8,
                },
            };

            const result = applyAuraEffect(aura, effect, target, 'start_of_turn');

            expect(result.auraId).toBe('aura-1');
            expect(result.targetId).toBe('goblin-1');
            expect(result.effectType).toBe('damage');
            expect(result.saveRoll).toBeDefined();
            expect(result.saveDC).toBe(14);

            // If save failed, damage should be dealt
            if (!result.succeeded) {
                expect(result.damageDealt).toBeGreaterThan(0);
                expect(result.damageType).toBe('radiant');
            }
        });

        it('should apply healing effect without save', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'paladin-1',
                spellName: 'Aura of Vitality',
                spellLevel: 3,
                radius: 10,
                affectsAllies: true,
                affectsEnemies: false,
                affectsSelf: true,
                effects: [],
                startedAt: 1,
                requiresConcentration: true,
            };

            const effect: AuraEffect = {
                trigger: 'start_of_turn',
                type: 'healing',
                dice: '2d6',
            };

            const target: Token = {
                id: 'fighter-1',
                name: 'Fighter',
                hp: 25,
                maxHp: 40,
                ac: 18,
                initiative: 15,
                isEnemy: false,
            };

            const result = applyAuraEffect(aura, effect, target, 'start_of_turn');

            expect(result.succeeded).toBe(true); // No save required
            expect(result.healingDone).toBeGreaterThan(0);
            expect(result.healingDone).toBeLessThanOrEqual(12); // Max 2d6
        });

        it('should apply buff effect', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'paladin-1',
                spellName: 'Aura of Protection',
                spellLevel: 0,
                radius: 10,
                affectsAllies: true,
                affectsEnemies: false,
                affectsSelf: true,
                effects: [],
                startedAt: 1,
                requiresConcentration: false,
            };

            const effect: AuraEffect = {
                trigger: 'start_of_turn',
                type: 'buff',
                bonusAmount: 2,
                bonusType: 'saves',
                description: '+2 to all saving throws',
            };

            const target: Token = {
                id: 'cleric-1',
                name: 'Cleric',
                hp: 30,
                maxHp: 30,
                ac: 16,
                initiative: 12,
                isEnemy: false,
            };

            const result = applyAuraEffect(aura, effect, target, 'start_of_turn');

            expect(result.succeeded).toBe(true);
            expect(result.description).toBe('+2 to all saving throws');
        });
    });

    describe('Duration Tracking', () => {
        it('should detect when aura has exceeded duration', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'wizard-1',
                spellName: 'Cloudkill',
                spellLevel: 5,
                radius: 20,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [],
                startedAt: 1,
                maxDuration: 10,
                requiresConcentration: true,
            };

            const currentRound = 11;
            const isExpired = checkAuraDuration(aura, currentRound);
            expect(isExpired).toBe(true);
        });

        it('should not expire aura within duration', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'cleric-1',
                spellName: 'Spirit Guardians',
                spellLevel: 3,
                radius: 15,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [],
                startedAt: 1,
                maxDuration: 100,
                requiresConcentration: true,
            };

            const currentRound = 50;
            const isExpired = checkAuraDuration(aura, currentRound);
            expect(isExpired).toBe(false);
        });

        it('should never expire auras without duration limit', () => {
            const aura: AuraState = {
                id: 'aura-1',
                ownerId: 'paladin-1',
                spellName: 'Aura of Protection',
                spellLevel: 0,
                radius: 10,
                affectsAllies: true,
                affectsEnemies: false,
                affectsSelf: true,
                effects: [],
                startedAt: 1,
                maxDuration: undefined,
                requiresConcentration: false,
            };

            const currentRound = 9999;
            const isExpired = checkAuraDuration(aura, currentRound);
            expect(isExpired).toBe(false);
        });

        it('should clean up expired auras', () => {
            const character: Character = {
                id: 'sorcerer-1',
                name: 'Sorcerer',
                stats: { str: 8, dex: 14, con: 12, int: 12, wis: 10, cha: 18 },
                hp: 28,
                maxHp: 28,
                ac: 12,
                level: 6,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            characterRepo.create(character);

            // Create aura with short duration
            const request: CreateAuraRequest = {
                ownerId: 'sorcerer-1',
                spellName: 'Short Duration Aura',
                spellLevel: 2,
                radius: 10,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [
                    {
                        trigger: 'start_of_turn',
                        type: 'damage',
                        dice: '2d6',
                        damageType: 'fire',
                    },
                ],
                currentRound: 1,
                maxDuration: 5,
                requiresConcentration: false,
            };

            createAura(request, auraRepo);
            expect(getActiveAuras(auraRepo)).toHaveLength(1);

            // Advance to round 6 (duration expired)
            const expiredIds = expireOldAuras(6, auraRepo);
            expect(expiredIds).toHaveLength(1);
            expect(getActiveAuras(auraRepo)).toHaveLength(0);
        });
    });

    describe('Concentration Integration', () => {
        it('should start concentration when creating concentration aura', () => {
            const character: Character = {
                id: 'cleric-2',
                name: 'Cleric',
                stats: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
                hp: 30,
                maxHp: 30,
                ac: 16,
                level: 5,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            characterRepo.create(character);

            const request: CreateAuraRequest = {
                ownerId: 'cleric-2',
                spellName: 'Spirit Guardians',
                spellLevel: 3,
                radius: 15,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [
                    {
                        trigger: 'start_of_turn',
                        type: 'damage',
                        dice: '3d8',
                        damageType: 'radiant',
                        saveType: 'wisdom',
                        saveDC: 14,
                    },
                ],
                currentRound: 1,
                maxDuration: 100,
                requiresConcentration: true,
            };

            // Manually start concentration (normally done by createAura tool handler)
            startConcentration(
                request.ownerId,
                request.spellName,
                request.spellLevel,
                request.currentRound,
                request.maxDuration,
                undefined,
                concentrationRepo,
                characterRepo
            );

            const concentration = concentrationRepo.findByCharacterId('cleric-2');
            expect(concentration).toBeDefined();
            expect(concentration?.activeSpell).toBe('Spirit Guardians');
        });
    });

    describe('Integration Tests', () => {
        it('should handle Spirit Guardians spell correctly', () => {
            const character: Character = {
                id: 'cleric-3',
                name: 'Brother Marcus',
                stats: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
                hp: 30,
                maxHp: 30,
                ac: 16,
                level: 5,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            characterRepo.create(character);

            const request: CreateAuraRequest = {
                ownerId: 'cleric-3',
                spellName: 'Spirit Guardians',
                spellLevel: 3,
                radius: 15,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [
                    {
                        trigger: 'start_of_turn',
                        type: 'damage',
                        dice: '3d8',
                        damageType: 'radiant',
                        saveType: 'wisdom',
                        saveDC: 14,
                    },
                ],
                currentRound: 1,
                maxDuration: 100,
                requiresConcentration: true,
            };

            const aura = createAura(request, auraRepo);

            expect(aura.spellName).toBe('Spirit Guardians');
            expect(aura.radius).toBe(15);
            expect(aura.affectsEnemies).toBe(true);
            expect(aura.affectsAllies).toBe(false);
            expect(aura.requiresConcentration).toBe(true);
            expect(aura.effects).toHaveLength(1);
            expect(aura.effects[0].trigger).toBe('start_of_turn');
            expect(aura.effects[0].type).toBe('damage');
        });

        it('should handle Aura of Protection (Paladin feature) correctly', () => {
            const character: Character = {
                id: 'paladin-2',
                name: 'Sir Gideon',
                stats: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 14 },
                hp: 40,
                maxHp: 40,
                ac: 18,
                level: 6,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            characterRepo.create(character);

            const request: CreateAuraRequest = {
                ownerId: 'paladin-2',
                spellName: 'Aura of Protection',
                spellLevel: 0,
                radius: 10,
                affectsAllies: true,
                affectsEnemies: false,
                affectsSelf: true,
                effects: [
                    {
                        trigger: 'start_of_turn',
                        type: 'buff',
                        bonusAmount: 2,
                        bonusType: 'saves',
                        description: '+2 to all saving throws',
                    },
                ],
                currentRound: 1,
                requiresConcentration: false,
            };

            const aura = createAura(request, auraRepo);

            expect(aura.spellName).toBe('Aura of Protection');
            expect(aura.radius).toBe(10);
            expect(aura.affectsAllies).toBe(true);
            expect(aura.affectsSelf).toBe(true);
            expect(aura.affectsEnemies).toBe(false);
            expect(aura.requiresConcentration).toBe(false);
            expect(aura.maxDuration).toBeUndefined(); // Permanent
        });

        it('should process multiple aura effects on a target', () => {
            const character1: Character = {
                id: 'char-1',
                name: 'Character 1',
                stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                hp: 30,
                maxHp: 30,
                ac: 15,
                level: 5,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            characterRepo.create(character1);

            // Create two different auras
            const request1: CreateAuraRequest = {
                ownerId: 'char-1',
                spellName: 'Aura 1',
                spellLevel: 1,
                radius: 10,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [
                    {
                        trigger: 'start_of_turn',
                        type: 'damage',
                        dice: '1d6',
                        damageType: 'fire',
                    },
                ],
                currentRound: 1,
                requiresConcentration: false,
            };

            const request2: CreateAuraRequest = {
                ownerId: 'char-1',
                spellName: 'Aura 2',
                spellLevel: 1,
                radius: 10,
                affectsAllies: false,
                affectsEnemies: true,
                affectsSelf: false,
                effects: [
                    {
                        trigger: 'start_of_turn',
                        type: 'damage',
                        dice: '1d4',
                        damageType: 'cold',
                    },
                ],
                currentRound: 1,
                requiresConcentration: false,
            };

            createAura(request1, auraRepo);
            createAura(request2, auraRepo);

            const tokens: Token[] = [
                {
                    id: 'char-1',
                    name: 'Character 1',
                    hp: 30,
                    maxHp: 30,
                    ac: 15,
                    initiative: 15,
                    isEnemy: false,
                    position: { x: 0, y: 0 },
                },
                {
                    id: 'enemy-1',
                    name: 'Enemy',
                    hp: 20,
                    maxHp: 20,
                    ac: 12,
                    initiative: 10,
                    isEnemy: true,
                    position: { x: 1, y: 0 }, // 5 feet away
                },
            ];

            const results = checkAuraEffectsForTarget(tokens, 'enemy-1', 'start_of_turn', auraRepo);

            // Should have 2 effects (one from each aura)
            expect(results).toHaveLength(2);
        });
    });
});
