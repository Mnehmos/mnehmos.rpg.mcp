/**
 * D&D 5e SRD Class Starting Data
 * 
 * Contains starting equipment, hit dice, spell slots, and starting spells
 * for each core class. Used by create_character to auto-provision new characters.
 */

// Type for valid D&D 5e class names
export type D5EClass = 'barbarian' | 'bard' | 'cleric' | 'druid' | 'fighter' | 
                       'monk' | 'paladin' | 'ranger' | 'rogue' | 'sorcerer' | 
                       'warlock' | 'wizard';

export interface ClassStartingData {
    hitDice: string;
    startingHP: (conMod: number) => number;
    savingThrows: string[];
    armorProficiencies: string[];
    weaponProficiencies: string[];
    startingEquipment: StartingEquipmentChoice[];
    spellcasting?: SpellcastingInfo;
    // Added for provisioning service
    startingGold?: number;
    spellcastingAbility?: 'int' | 'wis' | 'cha';
    startingCantrips?: string[];
    startingSpells?: string[];
}

export interface StartingEquipmentChoice {
    // Either a fixed item or a choice between options
    fixed?: string[];
    choose?: {
        count: number;
        from: string[][];  // Array of item sets to choose from
    };
}

export interface SpellcastingInfo {
    ability: 'int' | 'wis' | 'cha';
    cantripsKnown: number[];  // By level (index 0 = level 1)
    spellsKnown?: number[];   // By level (for known-casters like Sorcerer)
    spellsPrepared?: boolean; // Prepared casters calculate from level + ability mod
    slotsByLevel: Record<number, number[]>;  // Character level -> [1st, 2nd, 3rd, 4th, 5th, 6th, 7th, 8th, 9th]
    startingCantrips: string[];
    startingSpells: string[];
}

// Default starting items for any class (explorer's pack contents simplified)
const EXPLORERS_PACK = [
    'Backpack',
    'Bedroll',
    'Mess Kit',
    'Tinderbox',
    'Torches x10',
    'Rations x10',
    'Waterskin',
    'Hempen Rope (50 feet)'
];

const DUNGEONEERS_PACK = [
    'Backpack',
    'Crowbar',
    'Hammer',
    'Pitons x10',
    'Torches x10',
    'Tinderbox',
    'Rations x10',
    'Waterskin',
    'Hempen Rope (50 feet)'
];

const PRIESTS_PACK = [
    'Backpack',
    'Blanket',
    'Candles x10',
    'Tinderbox',
    'Alms Box',
    'Incense x2',
    'Censer',
    'Vestments',
    'Rations x2',
    'Waterskin'
];

const SCHOLARS_PACK = [
    'Backpack',
    'Book of Lore',
    'Ink',
    'Ink Pen',
    'Parchment x10',
    'Little Bag of Sand',
    'Small Knife'
];

const BURGLAR_PACK = [
    'Backpack',
    'Ball Bearings (bag of 1000)',
    'String (10 feet)',
    'Bell',
    'Candles x5',
    'Crowbar',
    'Hammer',
    'Pitons x10',
    'Hooded Lantern',
    'Oil x2',
    'Rations x5',
    'Tinderbox',
    'Waterskin',
    'Hempen Rope (50 feet)'
];

// Export pack contents for external use
export const EquipmentPacks = {
    explorersPack: EXPLORERS_PACK,
    dungeoneersPack: DUNGEONEERS_PACK,
    priestsPack: PRIESTS_PACK,
    scholarsPack: SCHOLARS_PACK,
    burglarsPack: BURGLAR_PACK,
    diplomatsPack: ['Backpack', 'Fine Clothes', 'Perfume', 'Sealing Wax', 'Paper x5'],
    entertainersPack: ['Backpack', 'Bedroll', 'Costume x2', 'Candles x5', 'Rations x5', 'Waterskin', 'Disguise Kit']
};

// Spell slot progression for full casters (Bard, Cleric, Druid, Sorcerer, Wizard)
const FULL_CASTER_SLOTS: Record<number, number[]> = {
    1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
    11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
    12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
    13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
    14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
    15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
    16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
    17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
    18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
    19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
    20: [4, 3, 3, 3, 3, 2, 2, 1, 1]
};

// Half-caster spell slots (Paladin, Ranger)
const HALF_CASTER_SLOTS: Record<number, number[]> = {
    1: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    3: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    4: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    5: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    6: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    7: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    8: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    9: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    10: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    11: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    12: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    13: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    14: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    15: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    16: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    17: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    18: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    19: [4, 3, 3, 3, 2, 0, 0, 0, 0],
    20: [4, 3, 3, 3, 2, 0, 0, 0, 0]
};

export const CLASS_DATA: Record<string, ClassStartingData> = {
    // ═══════════════════════════════════════════════════════════════════════════
    // BARBARIAN
    // ═══════════════════════════════════════════════════════════════════════════
    barbarian: {
        hitDice: 'd12',
        startingHP: (conMod) => 12 + conMod,
        savingThrows: ['strength', 'constitution'],
        armorProficiencies: ['light', 'medium', 'shields'],
        weaponProficiencies: ['simple', 'martial'],
        startingEquipment: [
            { choose: { count: 1, from: [['Greataxe'], ['Martial Melee Weapon']] } },
            { choose: { count: 1, from: [['Handaxe', 'Handaxe'], ['Simple Weapon']] } },
            { fixed: [...EXPLORERS_PACK, 'Javelin', 'Javelin', 'Javelin', 'Javelin'] }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // BARD
    // ═══════════════════════════════════════════════════════════════════════════
    bard: {
        hitDice: 'd8',
        startingHP: (conMod) => 8 + conMod,
        savingThrows: ['dexterity', 'charisma'],
        armorProficiencies: ['light'],
        weaponProficiencies: ['simple', 'hand crossbows', 'longswords', 'rapiers', 'shortswords'],
        startingEquipment: [
            { choose: { count: 1, from: [['Rapier'], ['Longsword'], ['Simple Weapon']] } },
            { choose: { count: 1, from: [[...DUNGEONEERS_PACK], [...EXPLORERS_PACK]] } },
            { fixed: ['Leather Armor', 'Dagger', 'Lute'] }
        ],
        spellcasting: {
            ability: 'cha',
            cantripsKnown: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
            spellsKnown: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
            slotsByLevel: FULL_CASTER_SLOTS,
            startingCantrips: ['Vicious Mockery', 'Light'],
            startingSpells: ['Healing Word', 'Dissonant Whispers', 'Faerie Fire', 'Thunderwave']
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // CLERIC
    // ═══════════════════════════════════════════════════════════════════════════
    cleric: {
        hitDice: 'd8',
        startingHP: (conMod) => 8 + conMod,
        savingThrows: ['wisdom', 'charisma'],
        armorProficiencies: ['light', 'medium', 'shields'],
        weaponProficiencies: ['simple'],
        startingEquipment: [
            { choose: { count: 1, from: [['Mace'], ['Warhammer']] } },
            { choose: { count: 1, from: [['Scale Mail'], ['Leather Armor'], ['Chain Mail']] } },
            { choose: { count: 1, from: [['Light Crossbow', 'Crossbow Bolts x20'], ['Simple Weapon']] } },
            { choose: { count: 1, from: [[...PRIESTS_PACK], [...EXPLORERS_PACK]] } },
            { fixed: ['Shield', 'Holy Symbol'] }
        ],
        spellcasting: {
            ability: 'wis',
            cantripsKnown: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
            spellsPrepared: true,  // WIS mod + cleric level
            slotsByLevel: FULL_CASTER_SLOTS,
            startingCantrips: ['Sacred Flame', 'Guidance', 'Spare the Dying'],
            startingSpells: ['Cure Wounds', 'Bless', 'Shield of Faith', 'Guiding Bolt']
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // DRUID
    // ═══════════════════════════════════════════════════════════════════════════
    druid: {
        hitDice: 'd8',
        startingHP: (conMod) => 8 + conMod,
        savingThrows: ['intelligence', 'wisdom'],
        armorProficiencies: ['light', 'medium', 'shields'],
        weaponProficiencies: ['clubs', 'daggers', 'darts', 'javelins', 'maces', 'quarterstaffs', 'scimitars', 'sickles', 'slings', 'spears'],
        startingEquipment: [
            { choose: { count: 1, from: [['Shield'], ['Simple Weapon']] } },
            { choose: { count: 1, from: [['Scimitar'], ['Simple Melee Weapon']] } },
            { fixed: ['Leather Armor', ...EXPLORERS_PACK, 'Druidic Focus'] }
        ],
        spellcasting: {
            ability: 'wis',
            cantripsKnown: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
            spellsPrepared: true,
            slotsByLevel: FULL_CASTER_SLOTS,
            startingCantrips: ['Produce Flame', 'Druidcraft'],
            startingSpells: ['Entangle', 'Healing Word', 'Faerie Fire', 'Thunderwave']
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // FIGHTER
    // ═══════════════════════════════════════════════════════════════════════════
    fighter: {
        hitDice: 'd10',
        startingHP: (conMod) => 10 + conMod,
        savingThrows: ['strength', 'constitution'],
        armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
        weaponProficiencies: ['simple', 'martial'],
        startingEquipment: [
            { choose: { count: 1, from: [['Chain Mail'], ['Leather Armor', 'Longbow', 'Arrows x20']] } },
            { choose: { count: 1, from: [['Martial Weapon', 'Shield'], ['Martial Weapon', 'Martial Weapon']] } },
            { choose: { count: 1, from: [['Light Crossbow', 'Crossbow Bolts x20'], ['Handaxe', 'Handaxe']] } },
            { choose: { count: 1, from: [[...DUNGEONEERS_PACK], [...EXPLORERS_PACK]] } }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // MONK
    // ═══════════════════════════════════════════════════════════════════════════
    monk: {
        hitDice: 'd8',
        startingHP: (conMod) => 8 + conMod,
        savingThrows: ['strength', 'dexterity'],
        armorProficiencies: [],
        weaponProficiencies: ['simple', 'shortswords'],
        startingEquipment: [
            { choose: { count: 1, from: [['Shortsword'], ['Simple Weapon']] } },
            { choose: { count: 1, from: [[...DUNGEONEERS_PACK], [...EXPLORERS_PACK]] } },
            { fixed: ['Dart', 'Dart', 'Dart', 'Dart', 'Dart', 'Dart', 'Dart', 'Dart', 'Dart', 'Dart'] }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // PALADIN
    // ═══════════════════════════════════════════════════════════════════════════
    paladin: {
        hitDice: 'd10',
        startingHP: (conMod) => 10 + conMod,
        savingThrows: ['wisdom', 'charisma'],
        armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
        weaponProficiencies: ['simple', 'martial'],
        startingEquipment: [
            { choose: { count: 1, from: [['Martial Weapon', 'Shield'], ['Martial Weapon', 'Martial Weapon']] } },
            { choose: { count: 1, from: [['Javelin', 'Javelin', 'Javelin', 'Javelin', 'Javelin'], ['Simple Melee Weapon']] } },
            { choose: { count: 1, from: [[...PRIESTS_PACK], [...EXPLORERS_PACK]] } },
            { fixed: ['Chain Mail', 'Holy Symbol'] }
        ],
        spellcasting: {
            ability: 'cha',
            cantripsKnown: [],  // Paladins don't get cantrips
            spellsPrepared: true,
            slotsByLevel: HALF_CASTER_SLOTS,
            startingCantrips: [],
            startingSpells: ['Divine Smite', 'Cure Wounds', 'Shield of Faith', 'Thunderous Smite']
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // RANGER
    // ═══════════════════════════════════════════════════════════════════════════
    ranger: {
        hitDice: 'd10',
        startingHP: (conMod) => 10 + conMod,
        savingThrows: ['strength', 'dexterity'],
        armorProficiencies: ['light', 'medium', 'shields'],
        weaponProficiencies: ['simple', 'martial'],
        startingEquipment: [
            { choose: { count: 1, from: [['Scale Mail'], ['Leather Armor']] } },
            { choose: { count: 1, from: [['Shortsword', 'Shortsword'], ['Simple Melee Weapon', 'Simple Melee Weapon']] } },
            { choose: { count: 1, from: [[...DUNGEONEERS_PACK], [...EXPLORERS_PACK]] } },
            { fixed: ['Longbow', 'Arrows x20', 'Quiver'] }
        ],
        spellcasting: {
            ability: 'wis',
            cantripsKnown: [],  // Rangers don't get cantrips (without Druidic Warrior)
            spellsKnown: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
            slotsByLevel: HALF_CASTER_SLOTS,
            startingCantrips: [],
            startingSpells: ["Hunter's Mark", 'Cure Wounds']
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ROGUE
    // ═══════════════════════════════════════════════════════════════════════════
    rogue: {
        hitDice: 'd8',
        startingHP: (conMod) => 8 + conMod,
        savingThrows: ['dexterity', 'intelligence'],
        armorProficiencies: ['light'],
        weaponProficiencies: ['simple', 'hand crossbows', 'longswords', 'rapiers', 'shortswords'],
        startingEquipment: [
            { choose: { count: 1, from: [['Rapier'], ['Shortsword']] } },
            { choose: { count: 1, from: [['Shortbow', 'Quiver', 'Arrows x20'], ['Shortsword']] } },
            { choose: { count: 1, from: [[...BURGLAR_PACK], [...DUNGEONEERS_PACK], [...EXPLORERS_PACK]] } },
            { fixed: ['Leather Armor', 'Dagger', 'Dagger', "Thieves' Tools"] }
        ]
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SORCERER
    // ═══════════════════════════════════════════════════════════════════════════
    sorcerer: {
        hitDice: 'd6',
        startingHP: (conMod) => 6 + conMod,
        savingThrows: ['constitution', 'charisma'],
        armorProficiencies: [],
        weaponProficiencies: ['daggers', 'darts', 'slings', 'quarterstaffs', 'light crossbows'],
        startingEquipment: [
            { choose: { count: 1, from: [['Light Crossbow', 'Crossbow Bolts x20'], ['Simple Weapon']] } },
            { choose: { count: 1, from: [['Component Pouch'], ['Arcane Focus']] } },
            { choose: { count: 1, from: [[...DUNGEONEERS_PACK], [...EXPLORERS_PACK]] } },
            { fixed: ['Dagger', 'Dagger'] }
        ],
        spellcasting: {
            ability: 'cha',
            cantripsKnown: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
            spellsKnown: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
            slotsByLevel: FULL_CASTER_SLOTS,
            startingCantrips: ['Fire Bolt', 'Ray of Frost', 'Prestidigitation', 'Light'],
            startingSpells: ['Magic Missile', 'Shield']
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // WARLOCK
    // ═══════════════════════════════════════════════════════════════════════════
    warlock: {
        hitDice: 'd8',
        startingHP: (conMod) => 8 + conMod,
        savingThrows: ['wisdom', 'charisma'],
        armorProficiencies: ['light'],
        weaponProficiencies: ['simple'],
        startingEquipment: [
            { choose: { count: 1, from: [['Light Crossbow', 'Crossbow Bolts x20'], ['Simple Weapon']] } },
            { choose: { count: 1, from: [['Component Pouch'], ['Arcane Focus']] } },
            { choose: { count: 1, from: [[...SCHOLARS_PACK], [...DUNGEONEERS_PACK]] } },
            { fixed: ['Leather Armor', 'Simple Weapon', 'Dagger', 'Dagger'] }
        ],
        spellcasting: {
            ability: 'cha',
            cantripsKnown: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
            spellsKnown: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
            // Warlock has pact magic, not standard slots - handled separately
            slotsByLevel: {
                1: [1, 0, 0, 0, 0, 0, 0, 0, 0],
                2: [2, 0, 0, 0, 0, 0, 0, 0, 0],
                3: [0, 2, 0, 0, 0, 0, 0, 0, 0],
                4: [0, 2, 0, 0, 0, 0, 0, 0, 0],
                5: [0, 0, 2, 0, 0, 0, 0, 0, 0],
                6: [0, 0, 2, 0, 0, 0, 0, 0, 0],
                7: [0, 0, 0, 2, 0, 0, 0, 0, 0],
                8: [0, 0, 0, 2, 0, 0, 0, 0, 0],
                9: [0, 0, 0, 0, 2, 0, 0, 0, 0],
                10: [0, 0, 0, 0, 2, 0, 0, 0, 0],
                11: [0, 0, 0, 0, 3, 0, 0, 0, 0],
                12: [0, 0, 0, 0, 3, 0, 0, 0, 0],
                13: [0, 0, 0, 0, 3, 0, 0, 0, 0],
                14: [0, 0, 0, 0, 3, 0, 0, 0, 0],
                15: [0, 0, 0, 0, 3, 0, 0, 0, 0],
                16: [0, 0, 0, 0, 3, 0, 0, 0, 0],
                17: [0, 0, 0, 0, 4, 0, 0, 0, 0],
                18: [0, 0, 0, 0, 4, 0, 0, 0, 0],
                19: [0, 0, 0, 0, 4, 0, 0, 0, 0],
                20: [0, 0, 0, 0, 4, 0, 0, 0, 0]
            },
            startingCantrips: ['Eldritch Blast', 'Minor Illusion'],
            startingSpells: ['Hex', 'Armor of Agathys']
        }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // WIZARD
    // ═══════════════════════════════════════════════════════════════════════════
    wizard: {
        hitDice: 'd6',
        startingHP: (conMod) => 6 + conMod,
        savingThrows: ['intelligence', 'wisdom'],
        armorProficiencies: [],
        weaponProficiencies: ['daggers', 'darts', 'slings', 'quarterstaffs', 'light crossbows'],
        startingEquipment: [
            { choose: { count: 1, from: [['Quarterstaff'], ['Dagger']] } },
            { choose: { count: 1, from: [['Component Pouch'], ['Arcane Focus']] } },
            { choose: { count: 1, from: [[...SCHOLARS_PACK], [...EXPLORERS_PACK]] } },
            { fixed: ['Spellbook'] }
        ],
        spellcasting: {
            ability: 'int',
            cantripsKnown: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
            spellsPrepared: true,  // INT mod + wizard level
            slotsByLevel: FULL_CASTER_SLOTS,
            startingCantrips: ['Fire Bolt', 'Mage Hand', 'Prestidigitation'],
            startingSpells: ['Magic Missile', 'Shield', 'Mage Armor', 'Sleep', 'Detect Magic', 'Identify']
        }
    }
};

/**
 * Get starting data for a class (case-insensitive)
 */
export function getClassStartingData(className: string): ClassStartingData | null {
    const normalized = className.toLowerCase().trim();
    return CLASS_DATA[normalized] || null;
}

/**
 * Get all simple starting equipment for a class (resolves choices to first option)
 * This is used for auto-provisioning when the LLM doesn't specify choices
 */
export function getDefaultStartingEquipment(className: string): string[] {
    const classData = getClassStartingData(className);
    if (!classData) return [];

    const equipment: string[] = [];

    for (const choice of classData.startingEquipment) {
        if (choice.fixed) {
            equipment.push(...choice.fixed);
        } else if (choice.choose) {
            // Default to first option
            const firstOption = choice.choose.from[0];
            if (firstOption) {
                equipment.push(...firstOption);
            }
        }
    }

    return equipment;
}

/**
 * Get spell slot array for a class at a given level
 * Returns [level1, level2, ..., level9] slot counts
 */
export function getSpellSlots(className: string, characterLevel: number): number[] {
    const classData = getClassStartingData(className);
    if (!classData?.spellcasting) return [0, 0, 0, 0, 0, 0, 0, 0, 0];

    const level = Math.min(Math.max(characterLevel, 1), 20);
    return classData.spellcasting.slotsByLevel[level] || [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * Get starting cantrips for a class
 */
export function getStartingCantrips(className: string): string[] {
    const classData = getClassStartingData(className);
    return classData?.spellcasting?.startingCantrips || [];
}

/**
 * Get starting spells for a class
 */
export function getStartingSpells(className: string): string[] {
    const classData = getClassStartingData(className);
    return classData?.spellcasting?.startingSpells || [];
}

/**
 * Calculate starting HP for a class given constitution modifier
 */
export function calculateStartingHP(className: string, conMod: number): number {
    const classData = getClassStartingData(className);
    if (!classData) return 10 + conMod;  // Fallback
    return classData.startingHP(conMod);
}

/**
 * Check if a class is a spellcaster
 */
export function isSpellcaster(className: string): boolean {
    const classData = getClassStartingData(className);
    return !!classData?.spellcasting;
}
