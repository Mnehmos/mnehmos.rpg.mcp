/**
 * Regression tests for spell-validator class-lookup robustness.
 *
 * The original bug: combat_action cast_spell threw
 *   "Cannot read properties of undefined (reading 'canCast')"
 * because SPELLCASTING_CONFIG is keyed lowercase ('cleric') but characters
 * created with class: "Cleric" (capitalized) caused the indexed lookup to
 * return undefined, and downstream code accessed `config.canCast` blindly.
 *
 * These tests pin the case-insensitive lookup behavior so the regression
 * cannot reappear.
 */

import {
    calculateSpellSaveDC,
    calculateSpellAttackBonus,
    getMaxSpellLevel,
    getInitialSpellSlots,
    hasSpellSlotAvailable,
    consumeSpellSlot
} from '../../../src/engine/magic/spell-validator.js';
import type { Character } from '../../../src/schema/character.js';
import { FIXED_TIMESTAMP } from '../../fixtures.js';

function clericChar(classCase: string): Character {
    return {
        id: 'c1',
        name: 'Iren',
        stats: { str: 11, dex: 10, con: 13, int: 12, wis: 16, cha: 13 },
        hp: 24,
        maxHp: 24,
        ac: 16,
        level: 3,
        characterType: 'pc',
        characterClass: classCase,
        race: 'Human',
        spellSlots: {
            level1: { current: 4, max: 4 },
            level2: { current: 2, max: 2 },
            level3: { current: 0, max: 0 },
            level4: { current: 0, max: 0 },
            level5: { current: 0, max: 0 },
            level6: { current: 0, max: 0 },
            level7: { current: 0, max: 0 },
            level8: { current: 0, max: 0 },
            level9: { current: 0, max: 0 }
        },
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP
    } as Character;
}

describe('spell-validator case-insensitive class lookup', () => {
    // ─── calculateSpellSaveDC ───
    it.each(['cleric', 'Cleric', 'CLERIC', 'ClErIc'])(
        'calculateSpellSaveDC handles class="%s" without crashing',
        (cls) => {
            const dc = calculateSpellSaveDC(clericChar(cls));
            // L3 cleric, WIS 16 (+3), prof +2 → DC 13
            expect(dc).toBe(13);
        }
    );

    // ─── calculateSpellAttackBonus ───
    it.each(['cleric', 'Cleric', 'CLERIC'])(
        'calculateSpellAttackBonus handles class="%s" without crashing',
        (cls) => {
            const bonus = calculateSpellAttackBonus(clericChar(cls));
            // L3 cleric, WIS 16 (+3), prof +2 → +5
            expect(bonus).toBe(5);
        }
    );

    // ─── getMaxSpellLevel ───
    it.each(['cleric', 'Cleric', 'CLERIC'])(
        'getMaxSpellLevel handles class="%s" without crashing',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cls: any) => {
            const lvl = getMaxSpellLevel(cls, 3);
            expect(lvl).toBe(2);
        }
    );

    // ─── getInitialSpellSlots ───
    it.each(['cleric', 'Cleric', 'CLERIC'])(
        'getInitialSpellSlots handles class="%s" without crashing',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cls: any) => {
            const slots = getInitialSpellSlots(cls, 3);
            expect(slots.level1.max).toBe(4);
            expect(slots.level2.max).toBe(2);
        }
    );

    // ─── hasSpellSlotAvailable ───
    it.each(['cleric', 'Cleric', 'CLERIC'])(
        'hasSpellSlotAvailable handles class="%s" without crashing',
        (cls) => {
            const result = hasSpellSlotAvailable(clericChar(cls), 1);
            expect(result.available).toBe(true);
            expect(result.availableLevel).toBe(1);
        }
    );

    // ─── consumeSpellSlot ───
    it.each(['cleric', 'Cleric', 'CLERIC'])(
        'consumeSpellSlot handles class="%s" without crashing',
        (cls) => {
            const before = clericChar(cls);
            const after = consumeSpellSlot(before, 1);
            expect(after.spellSlots?.level1.current).toBe(3);
        }
    );

    // ─── Unknown / custom classes return safe defaults rather than crashing ───
    describe('unknown/custom class names', () => {
        it('calculateSpellSaveDC returns 0 for non-spellcaster class', () => {
            const c = clericChar('chronomancer');
            expect(calculateSpellSaveDC(c)).toBe(0);
        });

        it('calculateSpellSaveDC returns 0 for empty/null class', () => {
            const c = clericChar('');
            expect(calculateSpellSaveDC(c)).toBe(0);
        });

        it('hasSpellSlotAvailable reports unknown class cleanly', () => {
            const c = clericChar('homebrew_class');
            const result = hasSpellSlotAvailable(c, 1);
            expect(result.available).toBe(false);
            expect(result.reason).toContain('Unknown');
        });
    });
});
