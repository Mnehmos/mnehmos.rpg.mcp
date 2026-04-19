/**
 * Spell-database lookup regression tests.
 * Issue #41: spells were registered under "name.toLowerCase()" (e.g. "fire bolt")
 * but callers passed kebab-case ids (e.g. "fire-bolt"), so getSpell returned undefined
 * for nearly every common spell despite them existing in the database.
 */

import {
    getSpell,
    spellExists,
    getSpellsByLevel,
    getSpellsForClass,
    SPELL_DATABASE,
    SPELL_COUNT
} from '../../../src/engine/magic/spell-database';

describe('spell-database key normalization', () => {
    const synonyms: Array<[string, string[]]> = [
        ['Fire Bolt', ['fire-bolt', 'fire bolt', 'firebolt', 'FIRE-BOLT', 'Fire_Bolt']],
        ['Magic Missile', ['magic-missile', 'magic missile', 'magicmissile']],
        ['Sacred Flame', ['sacred-flame', 'sacred flame', 'SACREDFLAME']],
        ['Eldritch Blast', ['eldritch-blast', 'eldritch blast']],
        ['Cure Wounds', ['cure-wounds', 'cure wounds']],
        ['Hold Person', ['hold-person', 'hold person']],
        ['Spiritual Weapon', ['spiritual-weapon', 'spiritual weapon']],
        ['Bless', ['bless', 'BLESS']]
    ];

    for (const [canonical, variants] of synonyms) {
        it(`resolves "${canonical}" via every variant: ${variants.join(', ')}`, () => {
            const expected = getSpell(canonical);
            expect(expected, `canonical lookup of "${canonical}" failed`).toBeDefined();
            for (const v of variants) {
                expect(getSpell(v), `variant "${v}" did not resolve`).toBe(expected);
                expect(spellExists(v), `spellExists("${v}") returned false`).toBe(true);
            }
        });
    }

    it('returns undefined for an actually-unknown spell', () => {
        expect(getSpell('totally-made-up-spell-xyz')).toBeUndefined();
        expect(spellExists('totally-made-up-spell-xyz')).toBe(false);
    });

    it('SPELL_COUNT counts unique spells, not key aliases', () => {
        const uniqueSpells = new Set(SPELL_DATABASE.values()).size;
        expect(SPELL_COUNT).toBe(uniqueSpells);
    });
});

describe('spell-database iteration helpers (no duplicates)', () => {
    // After dual-key registration, iterating SPELL_DATABASE.values() directly
    // would yield each spell twice. The helpers must dedupe.
    it('getSpellsByLevel returns unique spells per level', () => {
        for (const level of [0, 1, 2, 3]) {
            const list = getSpellsByLevel(level);
            const ids = list.map((s) => s.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it('getSpellsForClass returns unique spells per class', () => {
        for (const klass of ['wizard', 'cleric', 'sorcerer', 'warlock'] as const) {
            const list = getSpellsForClass(klass);
            const ids = list.map((s) => s.id);
            expect(new Set(ids).size, `${klass} contained duplicates`).toBe(ids.length);
        }
    });
});
