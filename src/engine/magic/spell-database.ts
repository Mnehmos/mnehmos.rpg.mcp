/**
 * Spell Database - Core D&D 5e SRD Spells
 * Used for validation against LLM hallucination (CRIT-006)
 */

import type { Spell, SpellcastingClass } from '../../schema/spell.js';

// Full spell database
export const SPELL_DATABASE: Map<string, Spell> = new Map();

// Input type for spell registration (ritual defaults to false)
type SpellInput = Omit<Spell, 'ritual'> & { ritual?: boolean };

/**
 * Normalize a spell name/id for lookup.
 * Accepts "Fire Bolt", "fire-bolt", "fire_bolt", "FIREBOLT" — all collapse to "firebolt".
 */
function normalizeSpellKey(name: string): string {
    return name.toLowerCase().replace(/[\s\-_]+/g, '');
}

// Helper to add spell to database — registers under both the spaced name
// and the kebab-case id so all reasonable callers can find the spell.
function registerSpell(input: SpellInput): void {
    const spell: Spell = {
        ...input,
        ritual: input.ritual ?? false
    };
    SPELL_DATABASE.set(normalizeSpellKey(spell.name), spell);
    SPELL_DATABASE.set(normalizeSpellKey(spell.id), spell);
}

// ============================================================================
// CANTRIPS (Level 0)
// ============================================================================

registerSpell({
    id: 'fire-bolt',
    name: 'Fire Bolt',
    level: 0,
    school: 'evocation',
    castingTime: 'action',
    range: 120,
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'You hurl a mote of fire at a creature or object within range.',
    classes: ['sorcerer', 'wizard', 'artificer'],
    targetType: 'creature',
    effects: [{
        type: 'damage',
        dice: '1d10', // Scales: 2d10 at 5th, 3d10 at 11th, 4d10 at 17th
        damageType: 'fire',
        saveType: 'none'
    }],
    autoHit: false
});

registerSpell({
    id: 'sacred-flame',
    name: 'Sacred Flame',
    level: 0,
    school: 'evocation',
    castingTime: 'action',
    range: 60,
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'Flame-like radiance descends on a creature that you can see within range.',
    classes: ['cleric'],
    targetType: 'creature',
    effects: [{
        type: 'damage',
        dice: '1d8', // Scales like Fire Bolt
        damageType: 'radiant',
        saveType: 'dexterity',
        saveEffect: 'none'
    }],
    autoHit: false
});

registerSpell({
    id: 'eldritch-blast',
    name: 'Eldritch Blast',
    level: 0,
    school: 'evocation',
    castingTime: 'action',
    range: 120,
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'A beam of crackling energy streaks toward a creature within range.',
    classes: ['warlock'],
    targetType: 'creature',
    effects: [{
        type: 'damage',
        dice: '1d10', // Multiple beams at higher levels
        damageType: 'force',
        saveType: 'none'
    }],
    autoHit: false
});

// ============================================================================
// 1ST LEVEL SPELLS
// ============================================================================

registerSpell({
    id: 'magic-missile',
    name: 'Magic Missile',
    level: 1,
    school: 'evocation',
    castingTime: 'action',
    range: 120,
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'You create three glowing darts of magical force. Each dart hits and deals 1d4+1 force damage.',
    higherLevels: 'One additional dart for each slot level above 1st.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'creature',
    effects: [{
        type: 'damage',
        dice: '3d4+3', // 3 darts at 1d4+1 each
        damageType: 'force',
        saveType: 'none',
        upcastBonus: { dice: '1d4+1', perLevel: 1 } // +1 dart per level
    }],
    autoHit: true // Magic Missile never misses
});

registerSpell({
    id: 'shield',
    name: 'Shield',
    level: 1,
    school: 'abjuration',
    castingTime: 'reaction',
    range: 'self',
    components: { verbal: true, somatic: true, material: false },
    duration: '1 round',
    concentration: false,
    description: 'An invisible barrier of magical force appears and protects you. +5 AC until the start of your next turn.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'self',
    effects: [{
        type: 'buff',
        conditions: ['AC_BONUS_5']
    }],
    autoHit: false
});

registerSpell({
    id: 'cure-wounds',
    name: 'Cure Wounds',
    level: 1,
    school: 'evocation',
    castingTime: 'action',
    range: 'touch',
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.',
    higherLevels: 'Healing increases by 1d8 for each slot level above 1st.',
    classes: ['bard', 'cleric', 'druid', 'paladin', 'ranger', 'artificer'],
    targetType: 'creature',
    effects: [{
        type: 'healing',
        dice: '1d8',
        upcastBonus: { dice: '1d8', perLevel: 1 }
    }],
    autoHit: false
});

registerSpell({
    id: 'hex',
    name: 'Hex',
    level: 1,
    school: 'enchantment',
    castingTime: 'bonus_action',
    range: 90,
    components: { verbal: true, somatic: true, material: true, materialDescription: 'the petrified eye of a newt' },
    duration: 'Concentration, up to 1 hour',
    concentration: true,
    description: 'You place a curse on a creature that you can see within range. Deal extra 1d6 necrotic damage on hits.',
    higherLevels: 'Duration increases with higher slots.',
    classes: ['warlock'],
    targetType: 'creature',
    effects: [{
        type: 'debuff',
        dice: '1d6',
        damageType: 'necrotic',
        conditions: ['HEXED']
    }],
    autoHit: false
});

registerSpell({
    id: 'burning-hands',
    name: 'Burning Hands',
    level: 1,
    school: 'evocation',
    castingTime: 'action',
    range: 'self',
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'A thin sheet of flames shoots forth from your outstretched fingertips.',
    higherLevels: 'Damage increases by 1d6 for each slot level above 1st.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'area',
    areaOfEffect: { shape: 'cone', size: 15 },
    effects: [{
        type: 'damage',
        dice: '3d6',
        damageType: 'fire',
        saveType: 'dexterity',
        saveEffect: 'half',
        upcastBonus: { dice: '1d6', perLevel: 1 }
    }],
    autoHit: false
});

registerSpell({
    id: 'misty-step',
    name: 'Misty Step',
    level: 2,
    school: 'conjuration',
    castingTime: 'bonus_action',
    range: 'self',
    components: { verbal: true, somatic: false, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'Briefly surrounded by silvery mist, you teleport up to 30 feet to an unoccupied space.',
    classes: ['sorcerer', 'warlock', 'wizard'],
    targetType: 'self',
    effects: [{
        type: 'utility'
    }],
    autoHit: false
});

registerSpell({
    id: 'healing-word',
    name: 'Healing Word',
    level: 1,
    school: 'evocation',
    castingTime: 'bonus_action',
    range: 60,
    components: { verbal: true, somatic: false, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'A creature of your choice within range regains 1d4 + your spellcasting ability modifier.',
    higherLevels: 'Healing increases by 1d4 for each slot level above 1st.',
    classes: ['bard', 'cleric', 'druid'],
    targetType: 'creature',
    effects: [{
        type: 'healing',
        dice: '1d4',
        upcastBonus: { dice: '1d4', perLevel: 1 }
    }],
    autoHit: false
});

// ============================================================================
// 2ND LEVEL SPELLS
// ============================================================================

registerSpell({
    id: 'scorching-ray',
    name: 'Scorching Ray',
    level: 2,
    school: 'evocation',
    castingTime: 'action',
    range: 120,
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'You create three rays of fire and hurl them at targets within range. Each ray deals 2d6 fire on a hit.',
    higherLevels: 'You create one additional ray for each slot level above 2nd.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'creature',
    effects: [{
        type: 'damage',
        dice: '6d6',
        damageType: 'fire',
        saveType: 'none',
        upcastBonus: { dice: '2d6', perLevel: 1 }
    }],
    autoHit: false
});

registerSpell({
    id: 'web',
    name: 'Web',
    level: 2,
    school: 'conjuration',
    castingTime: 'action',
    range: 60,
    components: { verbal: true, somatic: true, material: true, materialDescription: 'a bit of spiderweb' },
    duration: 'Concentration, up to 1 hour',
    concentration: true,
    description: 'You conjure a mass of thick, sticky webbing in a 20-foot cube. Creatures starting their turn in the webs or entering them on their turn must make a Dexterity saving throw or become restrained.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'area',
    areaOfEffect: { shape: 'cube', size: 20 },
    effects: [{
        type: 'debuff',
        saveType: 'dexterity',
        saveEffect: 'none',
        conditions: ['RESTRAINED']
    }],
    autoHit: false
});

registerSpell({
    id: 'hold-person',
    name: 'Hold Person',
    level: 2,
    school: 'enchantment',
    castingTime: 'action',
    range: 60,
    components: { verbal: true, somatic: true, material: true, materialDescription: 'a small, straight piece of iron' },
    duration: 'Concentration, up to 1 minute',
    concentration: true,
    description: 'Choose a humanoid that you can see within range. The target must succeed on a Wisdom saving throw or be paralyzed.',
    higherLevels: 'Target one additional humanoid for each slot level above 2nd.',
    classes: ['bard', 'cleric', 'druid', 'sorcerer', 'warlock', 'wizard'],
    targetType: 'creature',
    effects: [{
        type: 'debuff',
        saveType: 'wisdom',
        saveEffect: 'none',
        conditions: ['PARALYZED']
    }],
    autoHit: false
});

registerSpell({
    id: 'spiritual-weapon',
    name: 'Spiritual Weapon',
    level: 2,
    school: 'evocation',
    castingTime: 'bonus_action',
    range: 60,
    components: { verbal: true, somatic: true, material: false },
    duration: '1 minute',
    concentration: false,
    description: 'You create a floating, spectral weapon within range that lasts for the duration.',
    higherLevels: 'Damage increases by 1d8 for every two slot levels above 2nd.',
    classes: ['cleric'],
    targetType: 'point',
    effects: [{
        type: 'damage',
        dice: '1d8',
        damageType: 'force',
        upcastBonus: { dice: '1d8', perLevel: 2 }
    }],
    autoHit: false
});

// ============================================================================
// 3RD LEVEL SPELLS
// ============================================================================

registerSpell({
    id: 'fireball',
    name: 'Fireball',
    level: 3,
    school: 'evocation',
    castingTime: 'action',
    range: 150,
    components: { verbal: true, somatic: true, material: true, materialDescription: 'a tiny ball of bat guano and sulfur' },
    duration: 'Instantaneous',
    concentration: false,
    description: 'A bright streak flashes from your pointing finger to a point you choose within range and then blossoms with a low roar into an explosion of flame.',
    higherLevels: 'Damage increases by 1d6 for each slot level above 3rd.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'point',
    areaOfEffect: { shape: 'sphere', size: 20 },
    effects: [{
        type: 'damage',
        dice: '8d6',
        damageType: 'fire',
        saveType: 'dexterity',
        saveEffect: 'half',
        upcastBonus: { dice: '1d6', perLevel: 1 }
    }],
    autoHit: false
});

registerSpell({
    id: 'lightning-bolt',
    name: 'Lightning Bolt',
    level: 3,
    school: 'evocation',
    castingTime: 'action',
    range: 'self',
    components: { verbal: true, somatic: true, material: true, materialDescription: 'a bit of fur and a rod of amber, crystal, or glass' },
    duration: 'Instantaneous',
    concentration: false,
    description: 'A stroke of lightning forming a line 100 feet long and 5 feet wide blasts out from you.',
    higherLevels: 'Damage increases by 1d6 for each slot level above 3rd.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'area',
    areaOfEffect: { shape: 'line', size: 100 },
    effects: [{
        type: 'damage',
        dice: '8d6',
        damageType: 'lightning',
        saveType: 'dexterity',
        saveEffect: 'half',
        upcastBonus: { dice: '1d6', perLevel: 1 }
    }],
    autoHit: false
});

registerSpell({
    id: 'counterspell',
    name: 'Counterspell',
    level: 3,
    school: 'abjuration',
    castingTime: 'reaction',
    range: 60,
    components: { verbal: false, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'You attempt to interrupt a creature in the process of casting a spell.',
    higherLevels: 'Automatically counter spells of 3rd level or lower. Higher levels require ability check.',
    classes: ['sorcerer', 'warlock', 'wizard'],
    targetType: 'creature',
    effects: [{
        type: 'utility'
    }],
    autoHit: false
});

// ============================================================================
// 4TH LEVEL SPELLS
// ============================================================================

registerSpell({
    id: 'dimension-door',
    name: 'Dimension Door',
    level: 4,
    school: 'conjuration',
    castingTime: 'action',
    range: 500,
    components: { verbal: true, somatic: false, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'You teleport yourself to any spot within range.',
    classes: ['bard', 'sorcerer', 'warlock', 'wizard'],
    targetType: 'self',
    effects: [{
        type: 'utility'
    }],
    autoHit: false
});

// ============================================================================
// 5TH LEVEL SPELLS
// ============================================================================

registerSpell({
    id: 'haste',
    name: 'Haste',
    level: 3,
    school: 'transmutation',
    castingTime: 'action',
    range: 30,
    components: { verbal: true, somatic: true, material: true, materialDescription: 'a shaving of licorice root' },
    duration: 'Concentration, up to 1 minute',
    concentration: true,
    description: 'Choose a willing creature. Until the spell ends, the target\'s speed is doubled, it gains +2 AC, has advantage on Dexterity saving throws, and gains an additional action.',
    classes: ['sorcerer', 'wizard', 'artificer'],
    targetType: 'creature',
    effects: [{
        type: 'buff',
        conditions: ['HASTED']
    }],
    autoHit: false
});

registerSpell({
    id: 'fly',
    name: 'Fly',
    level: 3,
    school: 'transmutation',
    castingTime: 'action',
    range: 'touch',
    components: { verbal: true, somatic: true, material: true, materialDescription: 'a wing feather from any bird' },
    duration: 'Concentration, up to 10 minutes',
    concentration: true,
    description: 'You touch a willing creature. The target gains a flying speed of 60 feet for the duration.',
    higherLevels: 'Target one additional creature for each slot level above 3rd.',
    classes: ['sorcerer', 'warlock', 'wizard', 'artificer'],
    targetType: 'creature',
    effects: [{
        type: 'buff',
        conditions: ['FLYING']
    }],
    autoHit: false
});

// ============================================================================
// 6TH LEVEL SPELLS
// ============================================================================

registerSpell({
    id: 'disintegrate',
    name: 'Disintegrate',
    level: 6,
    school: 'transmutation',
    castingTime: 'action',
    range: 60,
    components: { verbal: true, somatic: true, material: true, materialDescription: 'a lodestone and a pinch of dust' },
    duration: 'Instantaneous',
    concentration: false,
    description: 'A thin green ray springs from your pointing finger. The target takes 10d6+40 force damage.',
    higherLevels: 'Damage increases by 3d6 for each slot level above 6th.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'creature',
    effects: [{
        type: 'damage',
        dice: '10d6+40',
        damageType: 'force',
        saveType: 'dexterity',
        saveEffect: 'none', // All or nothing
        upcastBonus: { dice: '3d6', perLevel: 1 }
    }],
    autoHit: false
});

// ============================================================================
// 9TH LEVEL SPELLS
// ============================================================================

registerSpell({
    id: 'meteor-swarm',
    name: 'Meteor Swarm',
    level: 9,
    school: 'evocation',
    castingTime: 'action',
    range: 'self', // 1 mile actually but self for targeting
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'Blazing orbs of fire plummet to the ground at four different points you can see within range.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'point',
    areaOfEffect: { shape: 'sphere', size: 40 },
    effects: [{
        type: 'damage',
        dice: '40d6', // 20d6 fire + 20d6 bludgeoning
        damageType: 'fire',
        saveType: 'dexterity',
        saveEffect: 'half'
    }],
    autoHit: false
});

registerSpell({
    id: 'power-word-kill',
    name: 'Power Word Kill',
    level: 9,
    school: 'enchantment',
    castingTime: 'action',
    range: 60,
    components: { verbal: true, somatic: false, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'You utter a word of power that can compel one creature you can see within range to die instantly if it has 100 HP or less.',
    classes: ['bard', 'sorcerer', 'warlock', 'wizard'],
    targetType: 'creature',
    effects: [{
        type: 'damage',
        conditions: ['INSTANT_DEATH']
    }],
    autoHit: true
});

registerSpell({
    id: 'wish',
    name: 'Wish',
    level: 9,
    school: 'conjuration',
    castingTime: 'action',
    range: 'self',
    components: { verbal: true, somatic: false, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'Wish is the mightiest spell a mortal creature can cast. By simply speaking aloud, you can alter the very foundations of reality in accord with your desires.',
    classes: ['sorcerer', 'wizard'],
    targetType: 'self',
    effects: [{
        type: 'utility'
    }],
    autoHit: false
});

registerSpell({
    id: 'bless',
    name: 'Bless',
    level: 1,
    school: 'enchantment',
    castingTime: 'action',
    range: 30,
    components: { verbal: true, somatic: true, material: true, materialDescription: 'a sprinkling of holy water' },
    duration: 'Concentration, up to 1 minute',
    concentration: true,
    description: 'You bless up to three creatures of your choice within range. Whenever a target makes an attack roll or saving throw, they can roll a d4 and add to the roll.',
    higherLevels: 'One additional creature for each slot level above 1st.',
    classes: ['cleric', 'paladin'],
    targetType: 'creatures',
    effects: [{
        type: 'buff',
        dice: '1d4',
        conditions: ['BLESSED']
    }],
    autoHit: false
});

registerSpell({
    id: 'guiding-bolt',
    name: 'Guiding Bolt',
    level: 1,
    school: 'evocation',
    castingTime: 'action',
    range: 120,
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    description: 'A flash of light streaks toward a creature of your choice within range. On hit, the target takes 4d6 radiant damage and the next attack against it has advantage.',
    higherLevels: 'Damage increases by 1d6 for each slot level above 1st.',
    classes: ['cleric'],
    targetType: 'creature',
    effects: [{
        type: 'damage',
        dice: '4d6',
        damageType: 'radiant',
        saveType: 'none',
        upcastBonus: { dice: '1d6', perLevel: 1 },
        conditions: ['GLOWING']
    }],
    autoHit: false
});

// ============================================================================
// SPELL LOOKUP FUNCTIONS
// ============================================================================

/**
 * Get spell by name or id (case-insensitive, ignores spaces/hyphens/underscores)
 */
export function getSpell(name: string): Spell | undefined {
    return SPELL_DATABASE.get(normalizeSpellKey(name));
}

/**
 * Check if spell exists in database
 */
export function spellExists(name: string): boolean {
    return SPELL_DATABASE.has(normalizeSpellKey(name));
}

/**
 * Iterate the deduplicated spell set. Each spell may live under multiple
 * keys (name + id), so iterating SPELL_DATABASE.values() directly would
 * yield duplicates.
 */
function uniqueSpells(): Spell[] {
    return Array.from(new Set(SPELL_DATABASE.values()));
}

/**
 * Get all spells of a specific level
 */
export function getSpellsByLevel(level: number): Spell[] {
    return uniqueSpells().filter(s => s.level === level);
}

/**
 * Get all spells available to a class
 */
export function getSpellsForClass(characterClass: SpellcastingClass): Spell[] {
    return uniqueSpells().filter(s =>
        s.classes.includes(characterClass)
    );
}

/**
 * Check if a spell is available to a specific class
 */
export function isSpellAvailableToClass(spellName: string, characterClass: SpellcastingClass): boolean {
    const spell = getSpell(spellName);
    if (!spell) return false;
    return spell.classes.includes(characterClass);
}

/**
 * Get all cantrips
 */
export function getCantrips(): Spell[] {
    return getSpellsByLevel(0);
}

/**
 * Calculate cantrip damage dice based on character level
 * Cantrips scale at 5th, 11th, and 17th level
 */
export function getCantripDice(baseCount: number, characterLevel: number): string {
    let diceCount = baseCount;
    if (characterLevel >= 5) diceCount = baseCount * 2;
    if (characterLevel >= 11) diceCount = baseCount * 3;
    if (characterLevel >= 17) diceCount = baseCount * 4;
    return `${diceCount}`;
}

/**
 * Calculate upcast damage dice
 */
export function calculateUpcastDice(spell: Spell, slotLevel: number): string {
    const effect = spell.effects.find(e => e.dice);
    if (!effect?.dice) return '';

    const baseDice = effect.dice;
    const upcastBonus = effect.upcastBonus;

    if (!upcastBonus || slotLevel <= spell.level) {
        return baseDice;
    }

    const levelsAbove = slotLevel - spell.level;
    const bonusLevels = Math.floor(levelsAbove / upcastBonus.perLevel);

    // Parse base dice (e.g., "8d6" -> {count: 8, size: 6})
    const baseDiceMatch = baseDice.match(/(\d+)d(\d+)/);
    const bonusDiceMatch = upcastBonus.dice.match(/(\d+)d(\d+)/);

    if (!baseDiceMatch) return baseDice;

    let totalCount = parseInt(baseDiceMatch[1]);
    const diceSize = baseDiceMatch[2];

    if (bonusDiceMatch) {
        totalCount += parseInt(bonusDiceMatch[1]) * bonusLevels;
    }

    // Handle modifiers (e.g., "3d4+3")
    const modMatch = baseDice.match(/([+-]\d+)$/);
    const modifier = modMatch ? modMatch[1] : '';

    return `${totalCount}d${diceSize}${modifier}`;
}

// Export total unique-spell count for tests (each spell may be indexed under
// multiple keys, so dedupe before counting).
export const SPELL_COUNT = new Set(SPELL_DATABASE.values()).size;
