/**
 * Player's Handbook Weapons
 *
 * Complete weapons table from D&D 5e PHB.
 * All standard simple and martial weapons with accurate stats.
 */

import type { WeaponPreset, PresetSource } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// SIMPLE MELEE WEAPONS
// ═══════════════════════════════════════════════════════════════════════════

const SIMPLE_MELEE: Record<string, WeaponPreset> = {
    club: {
        name: 'Club',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d4',
        damageType: 'bludgeoning',
        properties: ['light'],
        weight: 2,
        value: 0.1, // 1 sp = 0.1 gp
        tags: ['melee', 'one-handed', 'bludgeon', 'simple'],
        source: 'PHB'
    },
    dagger: {
        name: 'Dagger',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d4',
        damageType: 'piercing',
        properties: ['finesse', 'light', 'thrown'],
        range: { normal: 20, long: 60 },
        weight: 1,
        value: 2,
        tags: ['melee', 'ranged', 'one-handed', 'blade', 'simple', 'finesse'],
        source: 'PHB'
    },
    greatclub: {
        name: 'Greatclub',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d8',
        damageType: 'bludgeoning',
        properties: ['two_handed'],
        weight: 10,
        value: 0.2, // 2 sp
        tags: ['melee', 'two-handed', 'bludgeon', 'simple'],
        source: 'PHB'
    },
    handaxe: {
        name: 'Handaxe',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d6',
        damageType: 'slashing',
        properties: ['light', 'thrown'],
        range: { normal: 20, long: 60 },
        weight: 2,
        value: 5,
        tags: ['melee', 'ranged', 'one-handed', 'axe', 'simple'],
        source: 'PHB'
    },
    javelin: {
        name: 'Javelin',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d6',
        damageType: 'piercing',
        properties: ['thrown'],
        range: { normal: 30, long: 120 },
        weight: 2,
        value: 0.5, // 5 sp
        tags: ['melee', 'ranged', 'one-handed', 'spear', 'simple'],
        source: 'PHB'
    },
    light_hammer: {
        name: 'Light Hammer',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d4',
        damageType: 'bludgeoning',
        properties: ['light', 'thrown'],
        range: { normal: 20, long: 60 },
        weight: 2,
        value: 2,
        tags: ['melee', 'ranged', 'one-handed', 'hammer', 'simple'],
        source: 'PHB'
    },
    mace: {
        name: 'Mace',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d6',
        damageType: 'bludgeoning',
        properties: [],
        weight: 4,
        value: 5,
        tags: ['melee', 'one-handed', 'bludgeon', 'simple'],
        source: 'PHB'
    },
    quarterstaff: {
        name: 'Quarterstaff',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d6',
        damageType: 'bludgeoning',
        properties: ['versatile', 'monk'],
        versatileDamage: '1d8',
        weight: 4,
        value: 0.2, // 2 sp
        tags: ['melee', 'one-handed', 'two-handed', 'staff', 'simple', 'monk'],
        source: 'PHB'
    },
    sickle: {
        name: 'Sickle',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d4',
        damageType: 'slashing',
        properties: ['light'],
        weight: 2,
        value: 1,
        tags: ['melee', 'one-handed', 'blade', 'simple'],
        source: 'PHB'
    },
    spear: {
        name: 'Spear',
        type: 'weapon',
        category: 'simple_melee',
        damage: '1d6',
        damageType: 'piercing',
        properties: ['thrown', 'versatile', 'monk'],
        range: { normal: 20, long: 60 },
        versatileDamage: '1d8',
        weight: 3,
        value: 1,
        tags: ['melee', 'ranged', 'one-handed', 'two-handed', 'spear', 'simple', 'monk'],
        source: 'PHB'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// SIMPLE RANGED WEAPONS
// ═══════════════════════════════════════════════════════════════════════════

const SIMPLE_RANGED: Record<string, WeaponPreset> = {
    light_crossbow: {
        name: 'Light Crossbow',
        type: 'weapon',
        category: 'simple_ranged',
        damage: '1d8',
        damageType: 'piercing',
        properties: ['ammunition', 'loading', 'two_handed'],
        range: { normal: 80, long: 320 },
        weight: 5,
        value: 25,
        tags: ['ranged', 'two-handed', 'crossbow', 'simple'],
        source: 'PHB'
    },
    dart: {
        name: 'Dart',
        type: 'weapon',
        category: 'simple_ranged',
        damage: '1d4',
        damageType: 'piercing',
        properties: ['finesse', 'thrown'],
        range: { normal: 20, long: 60 },
        weight: 0.25,
        value: 0.05, // 5 cp
        tags: ['ranged', 'thrown', 'simple', 'finesse'],
        source: 'PHB'
    },
    shortbow: {
        name: 'Shortbow',
        type: 'weapon',
        category: 'simple_ranged',
        damage: '1d6',
        damageType: 'piercing',
        properties: ['ammunition', 'two_handed'],
        range: { normal: 80, long: 320 },
        weight: 2,
        value: 25,
        tags: ['ranged', 'two-handed', 'bow', 'simple'],
        source: 'PHB'
    },
    sling: {
        name: 'Sling',
        type: 'weapon',
        category: 'simple_ranged',
        damage: '1d4',
        damageType: 'bludgeoning',
        properties: ['ammunition'],
        range: { normal: 30, long: 120 },
        weight: 0,
        value: 0.1, // 1 sp
        tags: ['ranged', 'one-handed', 'simple'],
        source: 'PHB'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// MARTIAL MELEE WEAPONS
// ═══════════════════════════════════════════════════════════════════════════

const MARTIAL_MELEE: Record<string, WeaponPreset> = {
    battleaxe: {
        name: 'Battleaxe',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d8',
        damageType: 'slashing',
        properties: ['versatile'],
        versatileDamage: '1d10',
        weight: 4,
        value: 10,
        tags: ['melee', 'one-handed', 'two-handed', 'axe', 'martial'],
        source: 'PHB'
    },
    flail: {
        name: 'Flail',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d8',
        damageType: 'bludgeoning',
        properties: [],
        weight: 2,
        value: 10,
        tags: ['melee', 'one-handed', 'bludgeon', 'martial'],
        source: 'PHB'
    },
    glaive: {
        name: 'Glaive',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d10',
        damageType: 'slashing',
        properties: ['heavy', 'reach', 'two_handed'],
        weight: 6,
        value: 20,
        tags: ['melee', 'two-handed', 'polearm', 'reach', 'martial'],
        source: 'PHB'
    },
    greataxe: {
        name: 'Greataxe',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d12',
        damageType: 'slashing',
        properties: ['heavy', 'two_handed'],
        weight: 7,
        value: 30,
        tags: ['melee', 'two-handed', 'axe', 'martial'],
        source: 'PHB'
    },
    greatsword: {
        name: 'Greatsword',
        type: 'weapon',
        category: 'martial_melee',
        damage: '2d6',
        damageType: 'slashing',
        properties: ['heavy', 'two_handed'],
        weight: 6,
        value: 50,
        tags: ['melee', 'two-handed', 'blade', 'martial'],
        source: 'PHB'
    },
    halberd: {
        name: 'Halberd',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d10',
        damageType: 'slashing',
        properties: ['heavy', 'reach', 'two_handed'],
        weight: 6,
        value: 20,
        tags: ['melee', 'two-handed', 'polearm', 'reach', 'martial'],
        source: 'PHB'
    },
    lance: {
        name: 'Lance',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d12',
        damageType: 'piercing',
        properties: ['reach', 'special'],
        weight: 6,
        value: 10,
        description: 'You have disadvantage when you use a lance to attack a target within 5 feet of you. Also, a lance requires two hands to wield when you aren\'t mounted.',
        tags: ['melee', 'one-handed', 'two-handed', 'reach', 'martial', 'mounted'],
        source: 'PHB'
    },
    longsword: {
        name: 'Longsword',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d8',
        damageType: 'slashing',
        properties: ['versatile'],
        versatileDamage: '1d10',
        weight: 3,
        value: 15,
        tags: ['melee', 'one-handed', 'two-handed', 'blade', 'martial'],
        source: 'PHB'
    },
    maul: {
        name: 'Maul',
        type: 'weapon',
        category: 'martial_melee',
        damage: '2d6',
        damageType: 'bludgeoning',
        properties: ['heavy', 'two_handed'],
        weight: 10,
        value: 10,
        tags: ['melee', 'two-handed', 'bludgeon', 'hammer', 'martial'],
        source: 'PHB'
    },
    morningstar: {
        name: 'Morningstar',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d8',
        damageType: 'piercing',
        properties: [],
        weight: 4,
        value: 15,
        tags: ['melee', 'one-handed', 'bludgeon', 'martial'],
        source: 'PHB'
    },
    pike: {
        name: 'Pike',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d10',
        damageType: 'piercing',
        properties: ['heavy', 'reach', 'two_handed'],
        weight: 18,
        value: 5,
        tags: ['melee', 'two-handed', 'polearm', 'reach', 'martial'],
        source: 'PHB'
    },
    rapier: {
        name: 'Rapier',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d8',
        damageType: 'piercing',
        properties: ['finesse'],
        weight: 2,
        value: 25,
        tags: ['melee', 'one-handed', 'blade', 'martial', 'finesse'],
        source: 'PHB'
    },
    scimitar: {
        name: 'Scimitar',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d6',
        damageType: 'slashing',
        properties: ['finesse', 'light'],
        weight: 3,
        value: 25,
        tags: ['melee', 'one-handed', 'blade', 'martial', 'finesse'],
        source: 'PHB'
    },
    shortsword: {
        name: 'Shortsword',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d6',
        damageType: 'piercing',
        properties: ['finesse', 'light'],
        weight: 2,
        value: 10,
        tags: ['melee', 'one-handed', 'blade', 'martial', 'finesse'],
        source: 'PHB'
    },
    trident: {
        name: 'Trident',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d6',
        damageType: 'piercing',
        properties: ['thrown', 'versatile'],
        range: { normal: 20, long: 60 },
        versatileDamage: '1d8',
        weight: 4,
        value: 5,
        tags: ['melee', 'ranged', 'one-handed', 'two-handed', 'spear', 'martial'],
        source: 'PHB'
    },
    war_pick: {
        name: 'War Pick',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d8',
        damageType: 'piercing',
        properties: [],
        weight: 2,
        value: 5,
        tags: ['melee', 'one-handed', 'martial'],
        source: 'PHB'
    },
    warhammer: {
        name: 'Warhammer',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d8',
        damageType: 'bludgeoning',
        properties: ['versatile'],
        versatileDamage: '1d10',
        weight: 2,
        value: 15,
        tags: ['melee', 'one-handed', 'two-handed', 'hammer', 'martial'],
        source: 'PHB'
    },
    whip: {
        name: 'Whip',
        type: 'weapon',
        category: 'martial_melee',
        damage: '1d4',
        damageType: 'slashing',
        properties: ['finesse', 'reach'],
        weight: 3,
        value: 2,
        tags: ['melee', 'one-handed', 'reach', 'martial', 'finesse'],
        source: 'PHB'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// MARTIAL RANGED WEAPONS
// ═══════════════════════════════════════════════════════════════════════════

const MARTIAL_RANGED: Record<string, WeaponPreset> = {
    blowgun: {
        name: 'Blowgun',
        type: 'weapon',
        category: 'martial_ranged',
        damage: '1',
        damageType: 'piercing',
        properties: ['ammunition', 'loading'],
        range: { normal: 25, long: 100 },
        weight: 1,
        value: 10,
        tags: ['ranged', 'one-handed', 'martial'],
        source: 'PHB'
    },
    hand_crossbow: {
        name: 'Hand Crossbow',
        type: 'weapon',
        category: 'martial_ranged',
        damage: '1d6',
        damageType: 'piercing',
        properties: ['ammunition', 'light', 'loading'],
        range: { normal: 30, long: 120 },
        weight: 3,
        value: 75,
        tags: ['ranged', 'one-handed', 'crossbow', 'martial'],
        source: 'PHB'
    },
    heavy_crossbow: {
        name: 'Heavy Crossbow',
        type: 'weapon',
        category: 'martial_ranged',
        damage: '1d10',
        damageType: 'piercing',
        properties: ['ammunition', 'heavy', 'loading', 'two_handed'],
        range: { normal: 100, long: 400 },
        weight: 18,
        value: 50,
        tags: ['ranged', 'two-handed', 'crossbow', 'martial'],
        source: 'PHB'
    },
    longbow: {
        name: 'Longbow',
        type: 'weapon',
        category: 'martial_ranged',
        damage: '1d8',
        damageType: 'piercing',
        properties: ['ammunition', 'heavy', 'two_handed'],
        range: { normal: 150, long: 600 },
        weight: 2,
        value: 50,
        tags: ['ranged', 'two-handed', 'bow', 'martial'],
        source: 'PHB'
    },
    net: {
        name: 'Net',
        type: 'weapon',
        category: 'martial_ranged',
        damage: '0',
        damageType: 'bludgeoning',
        properties: ['thrown', 'special'],
        range: { normal: 5, long: 15 },
        weight: 3,
        value: 1,
        description: 'A Large or smaller creature hit by a net is restrained until it is freed. A net has no effect on creatures that are formless, or creatures that are Huge or larger. A creature can use its action to make a DC 10 Strength check, freeing itself or another creature within its reach on a success. Dealing 5 slashing damage to the net (AC 10) also frees the creature without harming it, ending the effect and destroying the net.',
        tags: ['ranged', 'thrown', 'martial', 'control'],
        source: 'PHB'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED WEAPONS COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

const WEAPONS: Record<string, WeaponPreset> = {
    ...SIMPLE_MELEE,
    ...SIMPLE_RANGED,
    ...MARTIAL_MELEE,
    ...MARTIAL_RANGED
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED PRESET SOURCE
// ═══════════════════════════════════════════════════════════════════════════

export const WeaponsPHB: PresetSource = {
    id: 'weapons-phb',
    name: 'Player\'s Handbook Weapons',
    source: 'PHB',
    version: '1.0.0',
    presets: WEAPONS
};
