/**
 * D&D 5e SRD Creature Presets
 *
 * Provides pre-configured creature stat blocks for common monsters.
 * These reduce token overhead by ~90% compared to manual specification.
 *
 * Usage:
 *   getCreaturePreset('goblin') -> full stat block
 *   expandCreatureTemplate('goblin:archer') -> goblin with shortbow
 *
 * Template syntax: "creature" or "creature:variant"
 */

/**
 * Partial character data for presets - id, createdAt, updatedAt generated on use
 */
export interface CreaturePreset {
    name: string;
    stats: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
    hp: number;
    maxHp: number;
    ac: number;
    level: number;
    characterType: 'enemy' | 'npc';
    race?: string;
    characterClass?: string;

    // Combat modifiers
    resistances?: string[];
    vulnerabilities?: string[];
    immunities?: string[];

    // Default attack info (for reference - actual attacks go in items)
    defaultAttack?: {
        name: string;
        damage: string;  // e.g., "1d6+2"
        damageType: string;
        toHit?: number;
    };

    // Movement and size
    size?: 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
    speed?: number;

    // Skill bonuses
    perceptionBonus?: number;
    stealthBonus?: number;

    // Challenge rating (for XP calculation)
    cr?: number;
    xpValue?: number;

    // Special traits description
    traits?: string[];
}

/**
 * Creature variant modifiers
 */
interface CreatureVariant {
    namePrefix?: string;
    nameSuffix?: string;
    hpModifier?: number;
    acModifier?: number;
    statModifiers?: Partial<{ str: number; dex: number; con: number; int: number; wis: number; cha: number }>;
    defaultAttack?: CreaturePreset['defaultAttack'];
    equipment?: string[];  // Item preset names to equip
}

// ═══════════════════════════════════════════════════════════════════════════
// BASE CREATURE PRESETS - D&D 5e SRD
// ═══════════════════════════════════════════════════════════════════════════

export const CREATURE_PRESETS: Record<string, CreaturePreset> = {
    // ─────────────────────────────────────────────────────────────────────────
    // HUMANOIDS - Low CR
    // ─────────────────────────────────────────────────────────────────────────
    goblin: {
        name: 'Goblin',
        stats: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        hp: 7,
        maxHp: 7,
        ac: 15, // Leather armor + shield
        level: 1,
        characterType: 'enemy',
        race: 'Goblin',
        size: 'small',
        speed: 30,
        stealthBonus: 6,
        cr: 0.25,
        xpValue: 50,
        defaultAttack: {
            name: 'Scimitar',
            damage: '1d6+2',
            damageType: 'slashing',
            toHit: 4
        },
        traits: ['Nimble Escape: Disengage or Hide as bonus action']
    },

    hobgoblin: {
        name: 'Hobgoblin',
        stats: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 9 },
        hp: 11,
        maxHp: 11,
        ac: 18, // Chain mail + shield
        level: 1,
        characterType: 'enemy',
        race: 'Hobgoblin',
        size: 'medium',
        speed: 30,
        cr: 0.5,
        xpValue: 100,
        defaultAttack: {
            name: 'Longsword',
            damage: '1d8+1',
            damageType: 'slashing',
            toHit: 3
        },
        traits: ['Martial Advantage: Extra 2d6 damage once per turn if ally is within 5 ft of target']
    },

    bugbear: {
        name: 'Bugbear',
        stats: { str: 15, dex: 14, con: 13, int: 8, wis: 11, cha: 9 },
        hp: 27,
        maxHp: 27,
        ac: 16, // Hide armor + shield
        level: 3,
        characterType: 'enemy',
        race: 'Bugbear',
        size: 'medium',
        speed: 30,
        stealthBonus: 6,
        perceptionBonus: 2,
        cr: 1,
        xpValue: 200,
        defaultAttack: {
            name: 'Morningstar',
            damage: '2d8+2',
            damageType: 'piercing',
            toHit: 4
        },
        traits: ['Surprise Attack: Extra 2d6 damage if creature is surprised', 'Brute: Extra damage die on melee hits']
    },

    orc: {
        name: 'Orc',
        stats: { str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 },
        hp: 15,
        maxHp: 15,
        ac: 13, // Hide armor
        level: 1,
        characterType: 'enemy',
        race: 'Orc',
        size: 'medium',
        speed: 30,
        cr: 0.5,
        xpValue: 100,
        defaultAttack: {
            name: 'Greataxe',
            damage: '1d12+3',
            damageType: 'slashing',
            toHit: 5
        },
        traits: ['Aggressive: Bonus action to move up to speed toward hostile creature']
    },

    bandit: {
        name: 'Bandit',
        stats: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
        hp: 11,
        maxHp: 11,
        ac: 12, // Leather armor
        level: 1,
        characterType: 'enemy',
        race: 'Human',
        characterClass: 'rogue',
        size: 'medium',
        speed: 30,
        cr: 0.125,
        xpValue: 25,
        defaultAttack: {
            name: 'Scimitar',
            damage: '1d6+1',
            damageType: 'slashing',
            toHit: 3
        }
    },

    bandit_captain: {
        name: 'Bandit Captain',
        stats: { str: 15, dex: 16, con: 14, int: 14, wis: 11, cha: 14 },
        hp: 65,
        maxHp: 65,
        ac: 15, // Studded leather
        level: 5,
        characterType: 'enemy',
        race: 'Human',
        characterClass: 'fighter',
        size: 'medium',
        speed: 30,
        cr: 2,
        xpValue: 450,
        defaultAttack: {
            name: 'Scimitar',
            damage: '1d6+3',
            damageType: 'slashing',
            toHit: 5
        },
        traits: ['Multiattack: Three melee attacks or two ranged']
    },

    thug: {
        name: 'Thug',
        stats: { str: 15, dex: 11, con: 14, int: 10, wis: 10, cha: 11 },
        hp: 32,
        maxHp: 32,
        ac: 11, // Leather armor
        level: 2,
        characterType: 'enemy',
        race: 'Human',
        size: 'medium',
        speed: 30,
        cr: 0.5,
        xpValue: 100,
        defaultAttack: {
            name: 'Mace',
            damage: '1d6+2',
            damageType: 'bludgeoning',
            toHit: 4
        },
        traits: ['Pack Tactics: Advantage when ally is within 5 ft of target']
    },

    cultist: {
        name: 'Cultist',
        stats: { str: 11, dex: 12, con: 10, int: 10, wis: 11, cha: 10 },
        hp: 9,
        maxHp: 9,
        ac: 12, // Leather armor
        level: 1,
        characterType: 'enemy',
        race: 'Human',
        size: 'medium',
        speed: 30,
        cr: 0.125,
        xpValue: 25,
        defaultAttack: {
            name: 'Scimitar',
            damage: '1d6+1',
            damageType: 'slashing',
            toHit: 3
        },
        traits: ['Dark Devotion: Advantage on saves vs charmed/frightened']
    },

    // ─────────────────────────────────────────────────────────────────────────
    // UNDEAD
    // ─────────────────────────────────────────────────────────────────────────
    skeleton: {
        name: 'Skeleton',
        stats: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
        hp: 13,
        maxHp: 13,
        ac: 13, // Armor scraps
        level: 1,
        characterType: 'enemy',
        race: 'Undead',
        size: 'medium',
        speed: 30,
        vulnerabilities: ['bludgeoning'],
        immunities: ['poison'],
        cr: 0.25,
        xpValue: 50,
        defaultAttack: {
            name: 'Shortsword',
            damage: '1d6+2',
            damageType: 'piercing',
            toHit: 4
        }
    },

    zombie: {
        name: 'Zombie',
        stats: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
        hp: 22,
        maxHp: 22,
        ac: 8,
        level: 1,
        characterType: 'enemy',
        race: 'Undead',
        size: 'medium',
        speed: 20,
        immunities: ['poison'],
        cr: 0.25,
        xpValue: 50,
        defaultAttack: {
            name: 'Slam',
            damage: '1d6+1',
            damageType: 'bludgeoning',
            toHit: 3
        },
        traits: ['Undead Fortitude: DC 5 + damage CON save to stay at 1 HP instead of 0']
    },

    ghoul: {
        name: 'Ghoul',
        stats: { str: 13, dex: 15, con: 10, int: 7, wis: 10, cha: 6 },
        hp: 22,
        maxHp: 22,
        ac: 12,
        level: 2,
        characterType: 'enemy',
        race: 'Undead',
        size: 'medium',
        speed: 30,
        immunities: ['poison'],
        cr: 1,
        xpValue: 200,
        defaultAttack: {
            name: 'Claws',
            damage: '2d4+2',
            damageType: 'slashing',
            toHit: 4
        },
        traits: ['Paralyzing Touch: DC 10 CON save or paralyzed for 1 minute']
    },

    wight: {
        name: 'Wight',
        stats: { str: 15, dex: 14, con: 16, int: 10, wis: 13, cha: 15 },
        hp: 45,
        maxHp: 45,
        ac: 14, // Studded leather
        level: 4,
        characterType: 'enemy',
        race: 'Undead',
        size: 'medium',
        speed: 30,
        resistances: ['necrotic', 'nonmagical bludgeoning/piercing/slashing'],
        immunities: ['poison'],
        cr: 3,
        xpValue: 700,
        defaultAttack: {
            name: 'Longsword',
            damage: '1d8+2',
            damageType: 'slashing',
            toHit: 4
        },
        traits: ['Life Drain: Necrotic attack reduces max HP', 'Sunlight Sensitivity: Disadvantage in sunlight']
    },

    // ─────────────────────────────────────────────────────────────────────────
    // BEASTS
    // ─────────────────────────────────────────────────────────────────────────
    wolf: {
        name: 'Wolf',
        stats: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
        hp: 11,
        maxHp: 11,
        ac: 13, // Natural armor
        level: 1,
        characterType: 'enemy',
        race: 'Beast',
        size: 'medium',
        speed: 40,
        perceptionBonus: 3,
        stealthBonus: 4,
        cr: 0.25,
        xpValue: 50,
        defaultAttack: {
            name: 'Bite',
            damage: '2d4+2',
            damageType: 'piercing',
            toHit: 4
        },
        traits: ['Pack Tactics: Advantage when ally within 5 ft', 'Keen Hearing and Smell: Advantage on Perception']
    },

    dire_wolf: {
        name: 'Dire Wolf',
        stats: { str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7 },
        hp: 37,
        maxHp: 37,
        ac: 14,
        level: 3,
        characterType: 'enemy',
        race: 'Beast',
        size: 'large',
        speed: 50,
        perceptionBonus: 3,
        stealthBonus: 4,
        cr: 1,
        xpValue: 200,
        defaultAttack: {
            name: 'Bite',
            damage: '2d6+3',
            damageType: 'piercing',
            toHit: 5
        },
        traits: ['Pack Tactics', 'Keen Hearing and Smell', 'Knockdown: DC 13 STR or prone']
    },

    giant_spider: {
        name: 'Giant Spider',
        stats: { str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4 },
        hp: 26,
        maxHp: 26,
        ac: 14,
        level: 2,
        characterType: 'enemy',
        race: 'Beast',
        size: 'large',
        speed: 30,
        stealthBonus: 7,
        cr: 1,
        xpValue: 200,
        defaultAttack: {
            name: 'Bite',
            damage: '1d8+3',
            damageType: 'piercing',
            toHit: 5
        },
        traits: ['Spider Climb', 'Web Sense', 'Web Walker', 'Poison: DC 11 CON or 2d8 poison damage']
    },

    giant_rat: {
        name: 'Giant Rat',
        stats: { str: 7, dex: 15, con: 11, int: 2, wis: 10, cha: 4 },
        hp: 7,
        maxHp: 7,
        ac: 12,
        level: 1,
        characterType: 'enemy',
        race: 'Beast',
        size: 'small',
        speed: 30,
        cr: 0.125,
        xpValue: 25,
        defaultAttack: {
            name: 'Bite',
            damage: '1d4+2',
            damageType: 'piercing',
            toHit: 4
        },
        traits: ['Pack Tactics', 'Keen Smell']
    },

    bear_black: {
        name: 'Black Bear',
        stats: { str: 15, dex: 10, con: 14, int: 2, wis: 12, cha: 7 },
        hp: 19,
        maxHp: 19,
        ac: 11,
        level: 2,
        characterType: 'enemy',
        race: 'Beast',
        size: 'medium',
        speed: 40,
        perceptionBonus: 3,
        cr: 0.5,
        xpValue: 100,
        defaultAttack: {
            name: 'Claws',
            damage: '2d4+2',
            damageType: 'slashing',
            toHit: 4
        },
        traits: ['Multiattack: Bite and claws', 'Keen Smell']
    },

    bear_brown: {
        name: 'Brown Bear',
        stats: { str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7 },
        hp: 34,
        maxHp: 34,
        ac: 11,
        level: 3,
        characterType: 'enemy',
        race: 'Beast',
        size: 'large',
        speed: 40,
        perceptionBonus: 3,
        cr: 1,
        xpValue: 200,
        defaultAttack: {
            name: 'Claws',
            damage: '2d6+4',
            damageType: 'slashing',
            toHit: 6
        },
        traits: ['Multiattack: Bite and claws', 'Keen Smell']
    },

    // ─────────────────────────────────────────────────────────────────────────
    // DRAGONS (Wyrmlings)
    // ─────────────────────────────────────────────────────────────────────────
    dragon_wyrmling_red: {
        name: 'Red Dragon Wyrmling',
        stats: { str: 19, dex: 10, con: 17, int: 12, wis: 11, cha: 15 },
        hp: 75,
        maxHp: 75,
        ac: 17,
        level: 6,
        characterType: 'enemy',
        race: 'Dragon',
        size: 'medium',
        speed: 30,
        immunities: ['fire'],
        perceptionBonus: 4,
        stealthBonus: 2,
        cr: 4,
        xpValue: 1100,
        defaultAttack: {
            name: 'Bite',
            damage: '1d10+4',
            damageType: 'piercing',
            toHit: 6
        },
        traits: ['Fire Breath: 15 ft cone, 7d6 fire, DC 13 DEX half']
    },

    dragon_wyrmling_white: {
        name: 'White Dragon Wyrmling',
        stats: { str: 14, dex: 10, con: 14, int: 5, wis: 10, cha: 11 },
        hp: 32,
        maxHp: 32,
        ac: 16,
        level: 4,
        characterType: 'enemy',
        race: 'Dragon',
        size: 'medium',
        speed: 30,
        immunities: ['cold'],
        perceptionBonus: 4,
        stealthBonus: 2,
        cr: 2,
        xpValue: 450,
        defaultAttack: {
            name: 'Bite',
            damage: '1d10+2',
            damageType: 'piercing',
            toHit: 4
        },
        traits: ['Cold Breath: 15 ft cone, 5d8 cold, DC 12 CON half']
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTS
    // ─────────────────────────────────────────────────────────────────────────
    animated_armor: {
        name: 'Animated Armor',
        stats: { str: 14, dex: 11, con: 13, int: 1, wis: 3, cha: 1 },
        hp: 33,
        maxHp: 33,
        ac: 18, // Natural armor
        level: 3,
        characterType: 'enemy',
        race: 'Construct',
        size: 'medium',
        speed: 25,
        immunities: ['poison', 'psychic'],
        cr: 1,
        xpValue: 200,
        defaultAttack: {
            name: 'Slam',
            damage: '1d6+2',
            damageType: 'bludgeoning',
            toHit: 4
        },
        traits: ['Antimagic Susceptibility: Incapacitated in antimagic', 'False Appearance: Looks like normal armor']
    },

    flying_sword: {
        name: 'Flying Sword',
        stats: { str: 12, dex: 15, con: 11, int: 1, wis: 5, cha: 1 },
        hp: 17,
        maxHp: 17,
        ac: 17, // Natural armor
        level: 1,
        characterType: 'enemy',
        race: 'Construct',
        size: 'small',
        speed: 50,
        immunities: ['poison', 'psychic'],
        cr: 0.25,
        xpValue: 50,
        defaultAttack: {
            name: 'Longsword',
            damage: '1d8+1',
            damageType: 'slashing',
            toHit: 3
        },
        traits: ['Antimagic Susceptibility', 'False Appearance']
    },

    // ─────────────────────────────────────────────────────────────────────────
    // MONSTROSITIES
    // ─────────────────────────────────────────────────────────────────────────
    mimic: {
        name: 'Mimic',
        stats: { str: 17, dex: 12, con: 15, int: 5, wis: 13, cha: 8 },
        hp: 58,
        maxHp: 58,
        ac: 12,
        level: 4,
        characterType: 'enemy',
        race: 'Monstrosity',
        size: 'medium',
        speed: 15,
        immunities: ['acid'],
        stealthBonus: 5,
        cr: 2,
        xpValue: 450,
        defaultAttack: {
            name: 'Pseudopod',
            damage: '1d8+3',
            damageType: 'bludgeoning',
            toHit: 5
        },
        traits: ['Shapechanger: Polymorph into object', 'Adhesive: Grapples on hit', 'False Appearance', 'Grappler']
    },

    owlbear: {
        name: 'Owlbear',
        stats: { str: 20, dex: 12, con: 17, int: 3, wis: 12, cha: 7 },
        hp: 59,
        maxHp: 59,
        ac: 13,
        level: 5,
        characterType: 'enemy',
        race: 'Monstrosity',
        size: 'large',
        speed: 40,
        perceptionBonus: 3,
        cr: 3,
        xpValue: 700,
        defaultAttack: {
            name: 'Claws',
            damage: '2d8+5',
            damageType: 'slashing',
            toHit: 7
        },
        traits: ['Multiattack: Beak and claws', 'Keen Sight and Smell']
    },

    harpy: {
        name: 'Harpy',
        stats: { str: 12, dex: 13, con: 12, int: 7, wis: 10, cha: 13 },
        hp: 38,
        maxHp: 38,
        ac: 11,
        level: 3,
        characterType: 'enemy',
        race: 'Monstrosity',
        size: 'medium',
        speed: 20,
        cr: 1,
        xpValue: 200,
        defaultAttack: {
            name: 'Claws',
            damage: '2d4+1',
            damageType: 'slashing',
            toHit: 3
        },
        traits: ['Multiattack: Claws and club', 'Luring Song: DC 11 WIS or charmed']
    },

    // ─────────────────────────────────────────────────────────────────────────
    // DEMONS & FIENDS
    // ─────────────────────────────────────────────────────────────────────────
    imp: {
        name: 'Imp',
        stats: { str: 6, dex: 17, con: 13, int: 11, wis: 12, cha: 14 },
        hp: 10,
        maxHp: 10,
        ac: 13,
        level: 2,
        characterType: 'enemy',
        race: 'Fiend',
        size: 'tiny',
        speed: 20,
        resistances: ['cold', 'nonmagical bludgeoning/piercing/slashing'],
        immunities: ['fire', 'poison'],
        stealthBonus: 5,
        cr: 1,
        xpValue: 200,
        defaultAttack: {
            name: 'Sting',
            damage: '1d4+3',
            damageType: 'piercing',
            toHit: 5
        },
        traits: ['Shapechanger', 'Devils Sight', 'Magic Resistance', 'Poison Sting: DC 11 CON or 3d6 poison']
    },

    quasit: {
        name: 'Quasit',
        stats: { str: 5, dex: 17, con: 10, int: 7, wis: 10, cha: 10 },
        hp: 7,
        maxHp: 7,
        ac: 13,
        level: 2,
        characterType: 'enemy',
        race: 'Fiend',
        size: 'tiny',
        speed: 40,
        resistances: ['cold', 'fire', 'lightning', 'nonmagical bludgeoning/piercing/slashing'],
        immunities: ['poison'],
        stealthBonus: 5,
        cr: 1,
        xpValue: 200,
        defaultAttack: {
            name: 'Claws',
            damage: '1d4+3',
            damageType: 'slashing',
            toHit: 5
        },
        traits: ['Shapechanger', 'Magic Resistance', 'Poison Claws: DC 10 CON or 2d4 poison']
    },

    // ─────────────────────────────────────────────────────────────────────────
    // GIANTS
    // ─────────────────────────────────────────────────────────────────────────
    ogre: {
        name: 'Ogre',
        stats: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
        hp: 59,
        maxHp: 59,
        ac: 11, // Hide armor
        level: 4,
        characterType: 'enemy',
        race: 'Giant',
        size: 'large',
        speed: 40,
        cr: 2,
        xpValue: 450,
        defaultAttack: {
            name: 'Greatclub',
            damage: '2d8+4',
            damageType: 'bludgeoning',
            toHit: 6
        }
    },

    troll: {
        name: 'Troll',
        stats: { str: 18, dex: 13, con: 20, int: 7, wis: 9, cha: 7 },
        hp: 84,
        maxHp: 84,
        ac: 15,
        level: 6,
        characterType: 'enemy',
        race: 'Giant',
        size: 'large',
        speed: 30,
        perceptionBonus: 2,
        cr: 5,
        xpValue: 1800,
        defaultAttack: {
            name: 'Claws',
            damage: '2d6+4',
            damageType: 'slashing',
            toHit: 7
        },
        traits: ['Multiattack: Bite and 2 claws', 'Regeneration: 10 HP per turn unless fire/acid damage', 'Keen Smell']
    },

    // ─────────────────────────────────────────────────────────────────────────
    // ELEMENTALS
    // ─────────────────────────────────────────────────────────────────────────
    fire_elemental: {
        name: 'Fire Elemental',
        stats: { str: 10, dex: 17, con: 16, int: 6, wis: 10, cha: 7 },
        hp: 102,
        maxHp: 102,
        ac: 13,
        level: 8,
        characterType: 'enemy',
        race: 'Elemental',
        size: 'large',
        speed: 50,
        resistances: ['nonmagical bludgeoning/piercing/slashing'],
        immunities: ['fire', 'poison'],
        cr: 5,
        xpValue: 1800,
        defaultAttack: {
            name: 'Touch',
            damage: '2d6+3',
            damageType: 'fire',
            toHit: 6
        },
        traits: ['Fire Form: Move through 1-inch spaces', 'Illumination: Bright light 30 ft', 'Water Susceptibility: 1 cold damage per gallon']
    },

    water_elemental: {
        name: 'Water Elemental',
        stats: { str: 18, dex: 14, con: 18, int: 5, wis: 10, cha: 8 },
        hp: 114,
        maxHp: 114,
        ac: 14,
        level: 8,
        characterType: 'enemy',
        race: 'Elemental',
        size: 'large',
        speed: 30,
        resistances: ['acid', 'nonmagical bludgeoning/piercing/slashing'],
        immunities: ['poison'],
        cr: 5,
        xpValue: 1800,
        defaultAttack: {
            name: 'Slam',
            damage: '2d8+4',
            damageType: 'bludgeoning',
            toHit: 7
        },
        traits: ['Water Form: Move through 1-inch spaces', 'Freeze: 1 cold damage freezes 1 ft', 'Whelm: Engulf and drown']
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// CREATURE VARIANTS
// ═══════════════════════════════════════════════════════════════════════════

export const CREATURE_VARIANTS: Record<string, Record<string, CreatureVariant>> = {
    goblin: {
        warrior: {
            nameSuffix: ' Warrior',
            hpModifier: 3,
            acModifier: 0,
            equipment: ['scimitar', 'shield']
        },
        archer: {
            nameSuffix: ' Archer',
            hpModifier: 0,
            acModifier: -2, // No shield
            defaultAttack: {
                name: 'Shortbow',
                damage: '1d6+2',
                damageType: 'piercing',
                toHit: 4
            },
            equipment: ['shortbow']
        },
        boss: {
            namePrefix: 'Goblin ',
            nameSuffix: ' Boss',
            hpModifier: 15,
            acModifier: 2,
            statModifiers: { str: 2, con: 2, cha: 4 },
            equipment: ['scimitar', 'shield']
        },
        shaman: {
            nameSuffix: ' Shaman',
            hpModifier: 5,
            acModifier: -3, // No armor
            statModifiers: { wis: 4, cha: 2 },
            equipment: ['quarterstaff']
        }
    },

    skeleton: {
        warrior: {
            nameSuffix: ' Warrior',
            hpModifier: 5,
            acModifier: 2,
            equipment: ['shortsword', 'shield']
        },
        archer: {
            nameSuffix: ' Archer',
            hpModifier: 0,
            defaultAttack: {
                name: 'Shortbow',
                damage: '1d6+2',
                damageType: 'piercing',
                toHit: 4
            },
            equipment: ['shortbow']
        },
        mage: {
            nameSuffix: ' Mage',
            hpModifier: 10,
            statModifiers: { int: 6, wis: 4 }
        }
    },

    orc: {
        warrior: {
            nameSuffix: ' Warrior',
            hpModifier: 5,
            equipment: ['greataxe']
        },
        berserker: {
            nameSuffix: ' Berserker',
            hpModifier: 10,
            acModifier: -2,
            statModifiers: { str: 2, con: 2 },
            equipment: ['greataxe']
        },
        warleader: {
            namePrefix: 'Orc ',
            nameSuffix: ' War Chief',
            hpModifier: 30,
            acModifier: 3,
            statModifiers: { str: 4, con: 4, cha: 4 },
            equipment: ['greataxe', 'chainmail']
        }
    },

    bandit: {
        thug: {
            nameSuffix: ' Thug',
            hpModifier: 10,
            statModifiers: { str: 2 },
            equipment: ['mace']
        },
        archer: {
            nameSuffix: ' Archer',
            hpModifier: 0,
            defaultAttack: {
                name: 'Light Crossbow',
                damage: '1d8+1',
                damageType: 'piercing',
                toHit: 3
            },
            equipment: ['light_crossbow']
        }
    },

    hobgoblin: {
        warrior: {
            nameSuffix: ' Warrior',
            hpModifier: 5,
            equipment: ['longsword', 'shield', 'chainmail']
        },
        captain: {
            namePrefix: 'Hobgoblin ',
            nameSuffix: ' Captain',
            hpModifier: 30,
            acModifier: 2,
            statModifiers: { str: 2, con: 2, cha: 4 },
            equipment: ['longsword', 'shield', 'chainmail']
        },
        archer: {
            nameSuffix: ' Archer',
            hpModifier: 0,
            acModifier: -4,
            defaultAttack: {
                name: 'Longbow',
                damage: '1d8+1',
                damageType: 'piercing',
                toHit: 3
            },
            equipment: ['longbow']
        }
    },

    zombie: {
        fast: {
            namePrefix: 'Fast ',
            hpModifier: -5,
            statModifiers: { dex: 6 }
        },
        brute: {
            nameSuffix: ' Brute',
            hpModifier: 15,
            acModifier: 2,
            statModifiers: { str: 4, con: 4 }
        }
    },

    wolf: {
        alpha: {
            namePrefix: 'Alpha ',
            hpModifier: 10,
            acModifier: 1,
            statModifiers: { str: 2, con: 2, cha: 4 }
        },
        dire: {
            namePrefix: 'Dire ',
            hpModifier: 26,
            acModifier: 1,
            statModifiers: { str: 5, con: 3 }
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a raw creature preset by name
 */
export function getCreaturePreset(name: string): CreaturePreset | null {
    const normalized = name.toLowerCase().replace(/[\s-]/g, '_');
    return CREATURE_PRESETS[normalized] || null;
}

/**
 * Parse a creature template string like "goblin:archer" or just "goblin"
 */
export function parseCreatureTemplate(template: string): { base: string; variant?: string } {
    const [base, variant] = template.toLowerCase().split(':');
    return { base: base.replace(/[\s-]/g, '_'), variant };
}

/**
 * Expand a creature template into a full preset with variant applied
 */
export function expandCreatureTemplate(template: string, nameOverride?: string): CreaturePreset | null {
    const { base, variant } = parseCreatureTemplate(template);
    const basePreset = getCreaturePreset(base);

    if (!basePreset) {
        return null;
    }

    // No variant - return base
    if (!variant) {
        if (nameOverride) {
            return { ...basePreset, name: nameOverride };
        }
        return { ...basePreset };
    }

    // Find variant
    const variantDef = CREATURE_VARIANTS[base]?.[variant];
    if (!variantDef) {
        // Variant not found, return base with warning in name
        console.warn(`Unknown variant "${variant}" for "${base}", using base preset`);
        if (nameOverride) {
            return { ...basePreset, name: nameOverride };
        }
        return { ...basePreset };
    }

    // Apply variant modifications
    const expanded: CreaturePreset = {
        ...basePreset,
        name: nameOverride || `${variantDef.namePrefix || ''}${basePreset.name}${variantDef.nameSuffix || ''}`,
        hp: basePreset.hp + (variantDef.hpModifier || 0),
        maxHp: basePreset.maxHp + (variantDef.hpModifier || 0),
        ac: basePreset.ac + (variantDef.acModifier || 0),
    };

    // Apply stat modifiers
    if (variantDef.statModifiers) {
        expanded.stats = {
            str: basePreset.stats.str + (variantDef.statModifiers.str || 0),
            dex: basePreset.stats.dex + (variantDef.statModifiers.dex || 0),
            con: basePreset.stats.con + (variantDef.statModifiers.con || 0),
            int: basePreset.stats.int + (variantDef.statModifiers.int || 0),
            wis: basePreset.stats.wis + (variantDef.statModifiers.wis || 0),
            cha: basePreset.stats.cha + (variantDef.statModifiers.cha || 0),
        };
    }

    // Override default attack if specified
    if (variantDef.defaultAttack) {
        expanded.defaultAttack = variantDef.defaultAttack;
    }

    return expanded;
}

/**
 * List all available creature presets
 */
export function listCreaturePresets(): string[] {
    return Object.keys(CREATURE_PRESETS);
}

/**
 * List all variants for a creature
 */
export function listCreatureVariants(creatureName: string): string[] {
    const normalized = creatureName.toLowerCase().replace(/[\s-]/g, '_');
    const variants = CREATURE_VARIANTS[normalized];
    return variants ? Object.keys(variants) : [];
}

/**
 * Get all available templates (base and variants) as strings
 */
export function listAllTemplates(): string[] {
    const templates: string[] = [];

    for (const base of Object.keys(CREATURE_PRESETS)) {
        templates.push(base);
        const variants = CREATURE_VARIANTS[base];
        if (variants) {
            for (const variant of Object.keys(variants)) {
                templates.push(`${base}:${variant}`);
            }
        }
    }

    return templates;
}
