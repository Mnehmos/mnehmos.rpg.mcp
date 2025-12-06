import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { ItemRepository } from '../../../src/storage/repos/item.repo.js';
import { InventoryRepository } from '../../../src/storage/repos/inventory.repo.js';
import { migrate } from '../../../src/storage/migrations.js';
import {
    validateScrollUse,
    rollArcanaCheck,
    useSpellScroll,
    createSpellScroll,
    getScrollDetails,
    checkScrollUsability,
    getEffectiveScrollDC,
} from '../../../src/engine/magic/scroll.js';
import {
    calculateScrollDC,
    calculateScrollAttackBonus,
    calculateScrollValue,
    getScrollRarity,
} from '../../../src/schema/scroll.js';
import type { Character } from '../../../src/schema/character.js';
import type { Item } from '../../../src/schema/inventory.js';
import type { ScrollProperties } from '../../../src/schema/scroll.js';

describe('Spell Scroll System', () => {
    let db: Database.Database;
    let characterRepo: CharacterRepository;
    let itemRepo: ItemRepository;
    let inventoryRepo: InventoryRepository;

    // Test characters
    let wizard: Character;
    let fighter: Character;
    let lowLevelWizard: Character;

    // Test scrolls
    let fireballScroll: Item;
    let magicMissileScroll: Item;
    let wishScroll: Item;

    beforeEach(() => {
        // Create in-memory database for tests
        db = new Database(':memory:');
        migrate(db);

        characterRepo = new CharacterRepository(db);
        itemRepo = new ItemRepository(db);
        inventoryRepo = new InventoryRepository(db);

        // Create test wizard (level 5, can cast 3rd level spells)
        wizard = {
            id: 'wizard-1',
            name: 'Test Wizard',
            stats: {
                str: 10,
                dex: 14,
                con: 16,
                int: 18, // +4 modifier
                wis: 12,
                cha: 10,
            },
            hp: 30,
            maxHp: 30,
            ac: 12,
            level: 5,
            characterType: 'pc',
            characterClass: 'wizard',
            knownSpells: ['fireball', 'magic missile', 'shield'],
            preparedSpells: ['fireball', 'magic missile', 'shield'],
            cantripsKnown: ['fire bolt'],
            maxSpellLevel: 3,
            spellSaveDC: 15,
            spellAttackBonus: 7,
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

        // Create test fighter (no spellcasting)
        fighter = {
            id: 'fighter-1',
            name: 'Test Fighter',
            stats: {
                str: 18,
                dex: 14,
                con: 16,
                int: 10, // +0 modifier
                wis: 12,
                cha: 8,
            },
            hp: 50,
            maxHp: 50,
            ac: 18,
            level: 5,
            characterType: 'pc',
            characterClass: 'fighter',
            conditions: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // Create low-level wizard (level 1, can only cast 1st level spells)
        lowLevelWizard = {
            id: 'wizard-2',
            name: 'Apprentice Wizard',
            stats: {
                str: 8,
                dex: 14,
                con: 12,
                int: 16, // +3 modifier
                wis: 10,
                cha: 10,
            },
            hp: 8,
            maxHp: 8,
            ac: 11,
            level: 1,
            characterType: 'pc',
            characterClass: 'wizard',
            knownSpells: ['magic missile'],
            preparedSpells: ['magic missile'],
            cantripsKnown: ['fire bolt'],
            maxSpellLevel: 1,
            spellSaveDC: 13,
            spellAttackBonus: 5,
            spellSlots: {
                level1: { current: 2, max: 2 },
                level2: { current: 0, max: 0 },
                level3: { current: 0, max: 0 },
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

        characterRepo.create(wizard);
        characterRepo.create(fighter);
        characterRepo.create(lowLevelWizard);

        // Create test scrolls
        const fireballScrollData = createSpellScroll('Fireball', 3, 'wizard');
        fireballScroll = {
            ...fireballScrollData,
            id: 'scroll-fireball',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const magicMissileScrollData = createSpellScroll('Magic Missile', 1, 'wizard');
        magicMissileScroll = {
            ...magicMissileScrollData,
            id: 'scroll-magic-missile',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const wishScrollData = createSpellScroll('Wish', 9, 'wizard');
        wishScroll = {
            ...wishScrollData,
            id: 'scroll-wish',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        itemRepo.create(fireballScroll);
        itemRepo.create(magicMissileScroll);
        itemRepo.create(wishScroll);
    });

    describe('Scroll DC and Value Calculations', () => {
        it('should calculate correct DC for spell levels', () => {
            expect(calculateScrollDC(0)).toBe(13);
            expect(calculateScrollDC(1)).toBe(14);
            expect(calculateScrollDC(3)).toBe(16);
            expect(calculateScrollDC(9)).toBe(22);
        });

        it('should calculate correct attack bonus for spell levels', () => {
            expect(calculateScrollAttackBonus(0)).toBe(5);
            expect(calculateScrollAttackBonus(1)).toBe(6);
            expect(calculateScrollAttackBonus(3)).toBe(8);
            expect(calculateScrollAttackBonus(9)).toBe(14);
        });

        it('should calculate correct scroll values', () => {
            expect(calculateScrollValue(0)).toBe(25); // Cantrip
            expect(calculateScrollValue(1)).toBe(75); // 1st level
            expect(calculateScrollValue(3)).toBe(300); // 3rd level
            expect(calculateScrollValue(9)).toBe(50000); // 9th level
        });

        it('should determine correct scroll rarity', () => {
            expect(getScrollRarity(0)).toBe('common');
            expect(getScrollRarity(1)).toBe('uncommon');
            expect(getScrollRarity(3)).toBe('uncommon');
            expect(getScrollRarity(4)).toBe('rare');
            expect(getScrollRarity(6)).toBe('very_rare');
            expect(getScrollRarity(9)).toBe('legendary');
        });
    });

    describe('Scroll Creation', () => {
        it('should create a valid spell scroll', () => {
            const scroll = createSpellScroll('Lightning Bolt', 3, 'wizard');

            expect(scroll.name).toBe('Scroll of Lightning Bolt');
            expect(scroll.type).toBe('scroll');
            expect(scroll.weight).toBe(0.1);

            const props = scroll.properties as ScrollProperties;
            expect(props.spellName).toBe('Lightning Bolt');
            expect(props.spellLevel).toBe(3);
            expect(props.scrollDC).toBe(16);
            expect(props.scrollAttackBonus).toBe(8);
            expect(props.spellClass).toBe('wizard');
        });

        it('should allow custom DC and attack bonus', () => {
            const scroll = createSpellScroll('Fireball', 3, 'wizard', 18, 10);

            const props = scroll.properties as ScrollProperties;
            expect(props.scrollDC).toBe(18);
            expect(props.scrollAttackBonus).toBe(10);
        });

        it('should allow custom value', () => {
            const scroll = createSpellScroll('Fireball', 3, 'wizard', undefined, undefined, 500);
            expect(scroll.value).toBe(500);
        });
    });

    describe('Scroll Details', () => {
        it('should extract scroll details correctly', () => {
            const details = getScrollDetails(fireballScroll);

            expect(details.valid).toBe(true);
            expect(details.spellName).toBe('Fireball');
            expect(details.spellLevel).toBe(3);
            expect(details.scrollDC).toBe(16);
            expect(details.scrollAttackBonus).toBe(8);
            expect(details.spellClass).toBe('wizard');
            expect(details.rarity).toBe('uncommon');
        });

        it('should reject non-scroll items', () => {
            const sword: Item = {
                id: 'sword-1',
                name: 'Longsword',
                type: 'weapon',
                weight: 3,
                value: 15,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            const details = getScrollDetails(sword);
            expect(details.valid).toBe(false);
            expect(details.error).toBe('Item is not a scroll');
        });
    });

    describe('Scroll Use Validation', () => {
        it('should allow wizard to auto-cast wizard scroll of appropriate level', () => {
            const props = fireballScroll.properties as ScrollProperties;
            const validation = validateScrollUse(wizard, props);

            expect(validation.requiresCheck).toBe(false);
            expect(validation.checkDC).toBeNull();
            expect(validation.reason).toBe('auto_success');
        });

        it('should require check for wizard with spell level too high', () => {
            const props = wishScroll.properties as ScrollProperties;
            const validation = validateScrollUse(wizard, props);

            expect(validation.requiresCheck).toBe(true);
            expect(validation.checkDC).toBe(19); // 10 + spell level
            expect(validation.reason).toBe('spell_level_too_high');
        });

        it('should require check for non-spellcaster', () => {
            const props = fireballScroll.properties as ScrollProperties;
            const validation = validateScrollUse(fighter, props);

            expect(validation.requiresCheck).toBe(true);
            expect(validation.checkDC).toBe(13); // 10 + spell level
            expect(validation.reason).toBe('not_a_spellcaster');
        });

        it('should require check for low-level wizard using higher level scroll', () => {
            const props = fireballScroll.properties as ScrollProperties;
            const validation = validateScrollUse(lowLevelWizard, props);

            expect(validation.requiresCheck).toBe(true);
            expect(validation.checkDC).toBe(13);
            expect(validation.reason).toBe('spell_level_too_high');
        });
    });

    describe('Arcana Check Rolling', () => {
        it('should roll d20 and add Intelligence modifier', () => {
            const check = rollArcanaCheck(wizard);

            expect(check.roll).toBeGreaterThanOrEqual(1);
            expect(check.roll).toBeLessThanOrEqual(20);
            expect(check.modifier).toBe(4); // +4 INT
            expect(check.total).toBe(check.roll + 4);
        });

        it('should use 0 modifier for fighter with 10 INT', () => {
            const check = rollArcanaCheck(fighter);

            expect(check.modifier).toBe(0);
            expect(check.total).toBe(check.roll);
        });
    });

    describe('Using Scrolls', () => {
        it('should auto-succeed for appropriate wizard', () => {
            inventoryRepo.addItem(wizard.id, fireballScroll.id, 1);

            const result = useSpellScroll(wizard, fireballScroll, itemRepo, inventoryRepo);

            expect(result.success).toBe(true);
            expect(result.consumed).toBe(true);
            expect(result.requiresCheck).toBe(false);
            expect(result.reason).toBe('auto_success');

            // Verify scroll was consumed
            const inventory = inventoryRepo.getInventory(wizard.id);
            expect(inventory.items.length).toBe(0);
        });

        it('should consume scroll even if Arcana check fails', () => {
            inventoryRepo.addItem(fighter.id, wishScroll.id, 1);

            // Run the scroll use multiple times to get both pass and fail scenarios
            const results = [];
            for (let i = 0; i < 20; i++) {
                // Reset inventory for each attempt
                db.prepare('DELETE FROM inventory_items').run();
                inventoryRepo.addItem(fighter.id, wishScroll.id, 1);

                const result = useSpellScroll(fighter, wishScroll, itemRepo, inventoryRepo);
                results.push(result);

                // Scroll should always be consumed
                expect(result.consumed).toBe(true);

                // Verify scroll was removed from inventory
                const inventory = inventoryRepo.getInventory(fighter.id);
                expect(inventory.items.length).toBe(0);
            }

            // At least some should fail (DC 19 is very high for fighter with 0 INT)
            const failures = results.filter(r => !r.success);
            expect(failures.length).toBeGreaterThan(0);
        });

        it('should fail if character does not have scroll', () => {
            const result = useSpellScroll(wizard, fireballScroll, itemRepo, inventoryRepo);

            expect(result.success).toBe(false);
            expect(result.consumed).toBe(false);
            expect(result.reason).toBe('not_in_inventory');
        });

        it('should fail for invalid scroll type', () => {
            const sword: Item = {
                id: 'sword-1',
                name: 'Longsword',
                type: 'weapon',
                weight: 3,
                value: 15,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            itemRepo.create(sword);

            const result = useSpellScroll(wizard, sword, itemRepo, inventoryRepo);

            expect(result.success).toBe(false);
            expect(result.consumed).toBe(false);
            expect(result.reason).toBe('invalid_scroll');
        });

        it('should require check for scroll above character level', () => {
            inventoryRepo.addItem(lowLevelWizard.id, fireballScroll.id, 1);

            const result = useSpellScroll(lowLevelWizard, fireballScroll, itemRepo, inventoryRepo);

            expect(result.requiresCheck).toBe(true);
            expect(result.consumed).toBe(true);
            expect(result.checkDC).toBe(13); // 10 + 3
            expect(result.checkRoll).toBeDefined();
            expect(result.checkTotal).toBeDefined();
        });
    });

    describe('Scroll Usability Check', () => {
        it('should correctly identify auto-success scenarios', () => {
            const usability = checkScrollUsability(wizard, fireballScroll);

            expect(usability.canUse).toBe(true);
            expect(usability.requiresCheck).toBe(false);
            expect(usability.checkDC).toBeNull();
        });

        it('should correctly identify check-required scenarios', () => {
            const usability = checkScrollUsability(fighter, fireballScroll);

            expect(usability.canUse).toBe(true);
            expect(usability.requiresCheck).toBe(true);
            expect(usability.checkDC).toBe(13);
        });

        it('should handle invalid scrolls', () => {
            const sword: Item = {
                id: 'sword-1',
                name: 'Longsword',
                type: 'weapon',
                weight: 3,
                value: 15,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            const usability = checkScrollUsability(wizard, sword);

            expect(usability.canUse).toBe(false);
            expect(usability.requiresCheck).toBe(false);
        });
    });

    describe('Effective Scroll DC', () => {
        it('should use caster stats if higher than scroll defaults', () => {
            const effective = getEffectiveScrollDC(wizard, fireballScroll);

            // Wizard has DC 15, scroll has DC 16
            // Wizard has attack +7, scroll has attack +8
            expect(effective.spellDC).toBe(16); // Use scroll's higher DC
            expect(effective.spellAttackBonus).toBe(8); // Use scroll's higher attack
        });

        it('should use scroll defaults for non-casters', () => {
            const effective = getEffectiveScrollDC(fighter, fireballScroll);

            expect(effective.spellDC).toBe(16);
            expect(effective.spellAttackBonus).toBe(8);
            expect(effective.usingCasterStats).toBe(false);
        });

        it('should use character stats when they are higher', () => {
            // Create a powerful wizard with higher stats than scroll
            const powerfulWizard: Character = {
                ...wizard,
                id: 'wizard-powerful',
                spellSaveDC: 20,
                spellAttackBonus: 12,
            };
            characterRepo.create(powerfulWizard);

            const effective = getEffectiveScrollDC(powerfulWizard, fireballScroll);

            expect(effective.spellDC).toBe(20);
            expect(effective.spellAttackBonus).toBe(12);
            expect(effective.usingCasterStats).toBe(true);
        });
    });

    describe('D&D 5e Rule Compliance', () => {
        it('should follow rule: anyone can try to use a scroll', () => {
            // Even a fighter should be able to attempt
            const usability = checkScrollUsability(fighter, magicMissileScroll);
            expect(usability.canUse).toBe(true);
        });

        it('should follow rule: spell on class list and can cast = auto-success', () => {
            const usability = checkScrollUsability(wizard, magicMissileScroll);
            expect(usability.requiresCheck).toBe(false);
        });

        it('should follow rule: DC = 10 + spell level for checks', () => {
            const level1Validation = validateScrollUse(fighter, magicMissileScroll.properties as ScrollProperties);
            expect(level1Validation.checkDC).toBe(11); // 10 + 1

            const level3Validation = validateScrollUse(fighter, fireballScroll.properties as ScrollProperties);
            expect(level3Validation.checkDC).toBe(13); // 10 + 3

            const level9Validation = validateScrollUse(fighter, wishScroll.properties as ScrollProperties);
            expect(level9Validation.checkDC).toBe(19); // 10 + 9
        });

        it('should follow rule: scroll consumed on use regardless of success', () => {
            inventoryRepo.addItem(fighter.id, fireballScroll.id, 1);

            const result = useSpellScroll(fighter, fireballScroll, itemRepo, inventoryRepo);

            // Regardless of check result, scroll should be consumed
            expect(result.consumed).toBe(true);

            const inventory = inventoryRepo.getInventory(fighter.id);
            expect(inventory.items.length).toBe(0);
        });
    });

    describe('Edge Cases', () => {
        it('should handle scroll with missing properties', () => {
            const badScroll: Item = {
                id: 'bad-scroll',
                name: 'Bad Scroll',
                type: 'scroll',
                weight: 0.1,
                value: 100,
                properties: {}, // Missing required properties
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            itemRepo.create(badScroll);
            inventoryRepo.addItem(wizard.id, badScroll.id, 1);

            const result = useSpellScroll(wizard, badScroll, itemRepo, inventoryRepo);

            expect(result.success).toBe(false);
            expect(result.reason).toBe('invalid_scroll');
        });

        it('should handle multiple scrolls of same type', () => {
            inventoryRepo.addItem(wizard.id, fireballScroll.id, 3);

            const result1 = useSpellScroll(wizard, fireballScroll, itemRepo, inventoryRepo);
            expect(result1.success).toBe(true);

            const inventory = inventoryRepo.getInventory(wizard.id);
            const scrollItem = inventory.items.find(i => i.itemId === fireballScroll.id);
            expect(scrollItem?.quantity).toBe(2);

            const result2 = useSpellScroll(wizard, fireballScroll, itemRepo, inventoryRepo);
            expect(result2.success).toBe(true);

            const inventory2 = inventoryRepo.getInventory(wizard.id);
            const scrollItem2 = inventory2.items.find(i => i.itemId === fireballScroll.id);
            expect(scrollItem2?.quantity).toBe(1);
        });

        it('should handle cantrip scrolls (spell level 0)', () => {
            const cantripScrollData = createSpellScroll('Fire Bolt', 0, 'wizard');
            const cantripScroll: Item = {
                ...cantripScrollData,
                id: 'scroll-cantrip',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            itemRepo.create(cantripScroll);
            inventoryRepo.addItem(wizard.id, cantripScroll.id, 1);

            const result = useSpellScroll(wizard, cantripScroll, itemRepo, inventoryRepo);

            expect(result.success).toBe(true);
            expect(result.consumed).toBe(true);
        });
    });
});
