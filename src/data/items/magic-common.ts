/**
 * Magic Items: Common & Uncommon
 *
 * Common and uncommon magic items from the D&D 5e DMG.
 * Includes weapons, armor, wondrous items, and potions.
 */

import type { MagicItemPreset, PresetSource } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// MAGIC WEAPONS
// ═══════════════════════════════════════════════════════════════════════════

const magicWeapons: Record<string, MagicItemPreset> = {
    'weapon_plus_1': {
        name: '+1 Weapon',
        type: 'magic',
        baseItem: 'any weapon',
        rarity: 'uncommon',
        requiresAttunement: false,
        attackBonus: 1,
        damageBonus: 1,
        description: 'You have a +1 bonus to attack and damage rolls made with this magic weapon.',
        tags: ['weapon', 'combat', 'enhancement'],
        source: 'DMG',
    },

    'longsword_plus_1': {
        name: '+1 Longsword',
        type: 'magic',
        baseItem: 'longsword',
        rarity: 'uncommon',
        requiresAttunement: false,
        attackBonus: 1,
        damageBonus: 1,
        weight: 3,
        description: 'You have a +1 bonus to attack and damage rolls made with this magic longsword.',
        tags: ['weapon', 'combat', 'enhancement', 'martial', 'melee'],
        source: 'DMG',
    },

    'shortsword_plus_1': {
        name: '+1 Shortsword',
        type: 'magic',
        baseItem: 'shortsword',
        rarity: 'uncommon',
        requiresAttunement: false,
        attackBonus: 1,
        damageBonus: 1,
        weight: 2,
        description: 'You have a +1 bonus to attack and damage rolls made with this magic shortsword.',
        tags: ['weapon', 'combat', 'enhancement', 'martial', 'melee', 'finesse'],
        source: 'DMG',
    },

    'dagger_plus_1': {
        name: '+1 Dagger',
        type: 'magic',
        baseItem: 'dagger',
        rarity: 'uncommon',
        requiresAttunement: false,
        attackBonus: 1,
        damageBonus: 1,
        weight: 1,
        description: 'You have a +1 bonus to attack and damage rolls made with this magic dagger.',
        tags: ['weapon', 'combat', 'enhancement', 'simple', 'melee', 'thrown', 'finesse'],
        source: 'DMG',
    },

    'flame_tongue': {
        name: 'Flame Tongue',
        type: 'magic',
        baseItem: 'longsword',
        rarity: 'rare',
        requiresAttunement: true,
        weight: 3,
        description: 'You can use a bonus action to speak this magic sword\'s command word, causing flames to erupt from the blade. These flames shed bright light in a 40-foot radius and dim light for an additional 40 feet. While the sword is ablaze, it deals an extra 2d6 fire damage to any target it hits. The flames last until you use a bonus action to speak the command word again or until you drop or sheathe the sword.',
        effects: [
            'Bonus action to ignite/extinguish flames',
            '+2d6 fire damage while ignited',
            'Sheds light (40 ft bright, 40 ft dim)',
        ],
        tags: ['weapon', 'combat', 'fire', 'martial', 'melee', 'damage'],
        source: 'DMG',
    },

    'javelin_of_lightning': {
        name: 'Javelin of Lightning',
        type: 'magic',
        baseItem: 'javelin',
        rarity: 'uncommon',
        requiresAttunement: false,
        weight: 2,
        description: 'This javelin is a magic weapon. When you hurl it and speak its command word, it transforms into a bolt of lightning, forming a line 5 feet wide that extends out from you to a target within 120 feet. Each creature in the line excluding you and the target must make a DC 13 Dexterity saving throw, taking 4d6 lightning damage on a failed save, and half as much damage on a successful one. The lightning bolt turns back into a javelin when it reaches the target. Make a ranged weapon attack against the target. On a hit, the target takes damage from the javelin plus 4d6 lightning damage. The javelin\'s property can\'t be used again until the next dawn. In the meantime, the javelin can still be used as a magic weapon.',
        charges: { max: 1, recharge: 'dawn' },
        effects: [
            'Command word: transforms into lightning bolt',
            'Line 5 ft wide, 120 ft long',
            'DC 13 DEX save, 4d6 lightning damage',
            'Target takes javelin damage + 4d6 lightning',
            'Recharges at dawn',
        ],
        tags: ['weapon', 'combat', 'lightning', 'ranged', 'thrown', 'aoe'],
        source: 'DMG',
    },

    'vicious_weapon': {
        name: 'Vicious Weapon',
        type: 'magic',
        baseItem: 'any weapon',
        rarity: 'rare',
        requiresAttunement: false,
        description: 'When you roll a 20 on your attack roll with this magic weapon, the target takes an extra 7 damage of the weapon\'s type.',
        effects: [
            'Critical hit: +7 damage',
        ],
        tags: ['weapon', 'combat', 'damage', 'critical'],
        source: 'DMG',
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// MAGIC ARMOR
// ═══════════════════════════════════════════════════════════════════════════

const magicArmor: Record<string, MagicItemPreset> = {
    'armor_plus_1': {
        name: '+1 Armor',
        type: 'magic',
        baseItem: 'any armor',
        rarity: 'rare',
        requiresAttunement: false,
        acBonus: 1,
        description: 'You have a +1 bonus to AC while you wear this armor.',
        tags: ['armor', 'defense', 'enhancement', 'ac'],
        source: 'DMG',
    },

    'shield_plus_1': {
        name: '+1 Shield',
        type: 'magic',
        baseItem: 'shield',
        rarity: 'uncommon',
        requiresAttunement: false,
        acBonus: 1,
        weight: 6,
        description: 'While holding this shield, you have a +1 bonus to AC. This bonus is in addition to the shield\'s normal bonus to AC.',
        tags: ['armor', 'shield', 'defense', 'enhancement', 'ac'],
        source: 'DMG',
    },

    'mithral_armor': {
        name: 'Mithral Armor',
        type: 'magic',
        baseItem: 'medium or heavy armor',
        rarity: 'uncommon',
        requiresAttunement: false,
        description: 'Mithral is a light, flexible metal. A mithral chain shirt or breastplate can be worn under normal clothes. If the armor normally imposes disadvantage on Dexterity (Stealth) checks or has a Strength requirement, the mithral version of the armor doesn\'t.',
        properties: [
            'No Stealth disadvantage',
            'No Strength requirement',
            'Can be worn under clothes (chain shirt/breastplate)',
        ],
        tags: ['armor', 'defense', 'stealth', 'medium', 'heavy'],
        source: 'DMG',
    },

    'adamantine_armor': {
        name: 'Adamantine Armor',
        type: 'magic',
        baseItem: 'medium or heavy armor',
        rarity: 'uncommon',
        requiresAttunement: false,
        description: 'This suit of armor is reinforced with adamantine, one of the hardest substances in existence. While you\'re wearing it, any critical hit against you becomes a normal hit.',
        effects: [
            'Immune to critical hits',
        ],
        tags: ['armor', 'defense', 'adamantine', 'medium', 'heavy', 'protection'],
        source: 'DMG',
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// WONDROUS ITEMS
// ═══════════════════════════════════════════════════════════════════════════

const wondrousItems: Record<string, MagicItemPreset> = {
    'bag_of_holding': {
        name: 'Bag of Holding',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        weight: 15,
        description: 'This bag has an interior space considerably larger than its outside dimensions, roughly 2 feet in diameter at the mouth and 4 feet deep. The bag can hold up to 500 pounds, not exceeding a volume of 64 cubic feet. The bag weighs 15 pounds, regardless of its contents. Retrieving an item from the bag requires an action. If the bag is overloaded, pierced, or torn, it ruptures and is destroyed, and its contents are scattered in the Astral Plane. If the bag is turned inside out, its contents spill forth, unharmed, but the bag must be put right before it can be used again. Breathing creatures inside the bag can survive up to a number of minutes equal to 10 divided by the number of creatures (minimum 1 minute), after which time they begin to suffocate. Placing a bag of holding inside an extradimensional space created by a handy haversack, portable hole, or similar item instantly destroys both items and opens a gate to the Astral Plane.',
        properties: [
            'Capacity: 500 lbs, 64 cubic feet',
            'Weighs 15 lbs regardless of contents',
            'Action to retrieve item',
            'Contains breathable air for limited time',
            'WARNING: Extradimensional nesting causes explosion',
        ],
        tags: ['wondrous', 'utility', 'storage', 'extradimensional'],
        source: 'DMG',
    },

    'cloak_of_protection': {
        name: 'Cloak of Protection',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: true,
        acBonus: 1,
        saveDCBonus: 1,
        description: 'You gain a +1 bonus to AC and saving throws while you wear this cloak.',
        tags: ['wondrous', 'defense', 'ac', 'saves', 'protection'],
        source: 'DMG',
    },

    'ring_of_protection': {
        name: 'Ring of Protection',
        type: 'magic',
        rarity: 'rare',
        requiresAttunement: true,
        acBonus: 1,
        saveDCBonus: 1,
        description: 'You gain a +1 bonus to AC and saving throws while wearing this ring.',
        tags: ['wondrous', 'defense', 'ac', 'saves', 'protection', 'ring'],
        source: 'DMG',
    },

    'boots_of_elvenkind': {
        name: 'Boots of Elvenkind',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        description: 'While you wear these boots, your steps make no sound, regardless of the surface you are moving across. You also have advantage on Dexterity (Stealth) checks that rely on moving silently.',
        effects: [
            'Silent movement',
            'Advantage on Stealth checks (silent movement)',
        ],
        tags: ['wondrous', 'stealth', 'utility', 'boots', 'advantage'],
        source: 'DMG',
    },

    'cloak_of_elvenkind': {
        name: 'Cloak of Elvenkind',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: true,
        description: 'While you wear this cloak with its hood up, Wisdom (Perception) checks made to see you have disadvantage, and you have advantage on Dexterity (Stealth) checks made to hide, as the cloak\'s color shifts to camouflage you. Pulling the hood up or down requires an action.',
        effects: [
            'Hood up: Perception checks to see you have disadvantage',
            'Hood up: Advantage on Stealth checks to hide',
            'Camouflage effect',
        ],
        tags: ['wondrous', 'stealth', 'utility', 'cloak', 'advantage', 'disadvantage'],
        source: 'DMG',
    },

    'goggles_of_night': {
        name: 'Goggles of Night',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        description: 'While wearing these dark lenses, you have darkvision out to a range of 60 feet. If you already have darkvision, wearing the goggles increases its range by 60 feet.',
        effects: [
            'Darkvision 60 ft',
            'Or +60 ft to existing darkvision',
        ],
        tags: ['wondrous', 'utility', 'vision', 'darkvision', 'goggles'],
        source: 'DMG',
    },

    'amulet_of_health': {
        name: 'Amulet of Health',
        type: 'magic',
        rarity: 'rare',
        requiresAttunement: true,
        description: 'Your Constitution score is 19 while you wear this amulet. It has no effect on you if your Constitution is already 19 or higher.',
        effects: [
            'Sets Constitution to 19',
        ],
        tags: ['wondrous', 'ability score', 'constitution', 'amulet', 'enhancement'],
        source: 'DMG',
    },

    'gauntlets_of_ogre_power': {
        name: 'Gauntlets of Ogre Power',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: true,
        description: 'Your Strength score is 19 while you wear these gauntlets. They have no effect on you if your Strength is already 19 or higher.',
        effects: [
            'Sets Strength to 19',
        ],
        tags: ['wondrous', 'ability score', 'strength', 'gauntlets', 'enhancement'],
        source: 'DMG',
    },

    'belt_of_giant_strength_hill': {
        name: 'Belt of Giant Strength (Hill)',
        type: 'magic',
        rarity: 'rare',
        requiresAttunement: true,
        description: 'While wearing this belt, your Strength score changes to 21. The item has no effect on you if your Strength without the belt is equal to or greater than 21.',
        effects: [
            'Sets Strength to 21',
        ],
        tags: ['wondrous', 'ability score', 'strength', 'belt', 'giant', 'enhancement'],
        source: 'DMG',
    },

    'headband_of_intellect': {
        name: 'Headband of Intellect',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: true,
        description: 'Your Intelligence score is 19 while you wear this headband. It has no effect on you if your Intelligence is already 19 or higher.',
        effects: [
            'Sets Intelligence to 19',
        ],
        tags: ['wondrous', 'ability score', 'intelligence', 'headband', 'enhancement'],
        source: 'DMG',
    },

    'periapt_of_wound_closure': {
        name: 'Periapt of Wound Closure',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: true,
        description: 'While you wear this pendant, you stabilize whenever you are dying at the start of your turn. In addition, whenever you roll a Hit Die to regain hit points, double the number of hit points it restores.',
        effects: [
            'Auto-stabilize when dying',
            'Double healing from Hit Dice',
        ],
        tags: ['wondrous', 'healing', 'survival', 'periapt', 'pendant'],
        source: 'DMG',
    },

    'immovable_rod': {
        name: 'Immovable Rod',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        weight: 2,
        description: 'This flat iron rod has a button on one end. You can use an action to press the button, which causes the rod to become magically fixed in place. Until you or another creature uses an action to push the button again, the rod doesn\'t move, even if it is defying gravity. The rod can hold up to 8,000 pounds of weight. More weight causes the rod to deactivate and fall. A creature can use an action to make a DC 30 Strength check, moving the fixed rod up to 10 feet on a success.',
        properties: [
            'Action to activate/deactivate',
            'Holds up to 8,000 lbs',
            'DC 30 Strength check to move 10 ft',
        ],
        tags: ['wondrous', 'utility', 'rod', 'immovable', 'gravity'],
        source: 'DMG',
    },

    'rope_of_climbing': {
        name: 'Rope of Climbing',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        weight: 3,
        description: 'This 60-foot length of silk rope weighs 3 pounds and can hold up to 3,000 pounds. If you hold one end of the rope and use an action to speak the command word, the rope animates. As a bonus action, you can command the other end to move toward a destination you choose. That end moves 10 feet on your turn when you first command it and 10 feet on each of your turns until reaching its destination, up to its maximum length away, or until you tell it to stop. You can also tell the rope to fasten itself securely to an object or to unfasten itself, to knot or unknot itself, or to coil itself for carrying. If you tell the rope to knot, large knots appear at 1-foot intervals along the rope. While knotted, the rope shortens to a 50-foot length and grants advantage on checks made to climb it. The rope has AC 20 and 20 hit points. It regains 1 hit point every 5 minutes as long as it has at least 1 hit point. If the rope drops to 0 hit points, it is destroyed.',
        properties: [
            'Length: 60 ft (50 ft knotted)',
            'Capacity: 3,000 lbs',
            'Action to command, bonus action to move',
            'Moves 10 ft/turn',
            'Can fasten, knot, coil',
            'Knotted: Advantage on climb checks',
            'AC 20, 20 HP, regenerates 1 HP/5 min',
        ],
        tags: ['wondrous', 'utility', 'rope', 'climbing', 'movement'],
        source: 'DMG',
    },

    'decanter_of_endless_water': {
        name: 'Decanter of Endless Water',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        weight: 2,
        description: 'This stoppered flask sloshes when shaken, as if it contains water. The decanter weighs 2 pounds. You can use an action to remove the stopper and speak one of three command words, whereupon an amount of fresh water or salt water (your choice) pours out of the flask. The water stops pouring out at the start of your next turn. Choose from the following options:\n\n"Stream" produces 1 gallon of water.\n\n"Fountain" produces 5 gallons of water.\n\n"Geyser" produces 30 gallons of water that gushes forth in a geyser 30 feet long and 1 foot wide. As a bonus action while holding the decanter, you can aim the geyser at a creature you can see within 30 feet of you. The target must succeed on a DC 13 Strength saving throw or take 1d4 bludgeoning damage and fall prone. Instead of a creature, you can target an object that isn\'t being worn or carried and that weighs no more than 200 pounds. The object is either knocked over or pushed up to 15 feet away from you.',
        properties: [
            'Stream: 1 gallon',
            'Fountain: 5 gallons',
            'Geyser: 30 gallons, 30 ft long, 1 ft wide',
            'Geyser combat: DC 13 STR save or 1d4 bludgeoning + prone',
            'Can knock over objects up to 200 lbs',
        ],
        tags: ['wondrous', 'utility', 'water', 'decanter', 'combat', 'environmental'],
        source: 'DMG',
    },

    'sending_stones': {
        name: 'Sending Stones',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        description: 'Sending stones come in pairs, with each smooth stone carved to match the other so the pairing is easily recognized. While you touch one stone, you can use an action to cast the sending spell from it. The target is the bearer of the other stone. If no creature bears the other stone, you know that fact as soon as you use the stone and don\'t cast the spell. Once sending is cast through the stones, they can\'t be used again until the next dawn.',
        charges: { max: 1, recharge: 'dawn' },
        effects: [
            'Cast sending spell to paired stone',
            'Once per day',
            'Must touch stone',
        ],
        tags: ['wondrous', 'utility', 'communication', 'sending', 'stones', 'paired'],
        source: 'DMG',
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// POTIONS
// ═══════════════════════════════════════════════════════════════════════════

const potions: Record<string, MagicItemPreset> = {
    'potion_of_healing': {
        name: 'Potion of Healing',
        type: 'magic',
        rarity: 'common',
        requiresAttunement: false,
        weight: 0.5,
        description: 'You regain 2d4 + 2 hit points when you drink this potion. The potion\'s red liquid glimmers when agitated.',
        effects: [
            'Restores 2d4 + 2 HP',
            'Action to drink',
        ],
        tags: ['potion', 'consumable', 'healing', 'hp'],
        source: 'DMG',
    },

    'potion_of_greater_healing': {
        name: 'Potion of Greater Healing',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        weight: 0.5,
        description: 'You regain 4d4 + 4 hit points when you drink this potion. The potion\'s red liquid glimmers when agitated.',
        effects: [
            'Restores 4d4 + 4 HP',
            'Action to drink',
        ],
        tags: ['potion', 'consumable', 'healing', 'hp'],
        source: 'DMG',
    },

    'potion_of_superior_healing': {
        name: 'Potion of Superior Healing',
        type: 'magic',
        rarity: 'rare',
        requiresAttunement: false,
        weight: 0.5,
        description: 'You regain 8d4 + 8 hit points when you drink this potion. The potion\'s red liquid glimmers when agitated.',
        effects: [
            'Restores 8d4 + 8 HP',
            'Action to drink',
        ],
        tags: ['potion', 'consumable', 'healing', 'hp'],
        source: 'DMG',
    },

    'potion_of_supreme_healing': {
        name: 'Potion of Supreme Healing',
        type: 'magic',
        rarity: 'very_rare',
        requiresAttunement: false,
        weight: 0.5,
        description: 'You regain 10d4 + 20 hit points when you drink this potion. The potion\'s red liquid glimmers when agitated.',
        effects: [
            'Restores 10d4 + 20 HP',
            'Action to drink',
        ],
        tags: ['potion', 'consumable', 'healing', 'hp'],
        source: 'DMG',
    },

    'potion_of_fire_resistance': {
        name: 'Potion of Fire Resistance',
        type: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        weight: 0.5,
        description: 'When you drink this potion, you gain resistance to fire damage for 1 hour. The potion\'s orange liquid flickers, and smoke fills the top of the container and wafts out whenever it is opened.',
        effects: [
            'Resistance to fire damage',
            'Duration: 1 hour',
        ],
        tags: ['potion', 'consumable', 'resistance', 'fire', 'protection'],
        source: 'DMG',
    },

    'potion_of_invisibility': {
        name: 'Potion of Invisibility',
        type: 'magic',
        rarity: 'very_rare',
        requiresAttunement: false,
        weight: 0.5,
        description: 'When you drink this potion, you become invisible for 1 hour. Anything you wear or carry is invisible with you. The effect ends early if you attack or cast a spell. This potion\'s container looks empty but feels as though it holds liquid.',
        effects: [
            'Invisibility for 1 hour',
            'Ends if you attack or cast a spell',
            'Includes worn/carried items',
        ],
        tags: ['potion', 'consumable', 'invisibility', 'stealth', 'utility'],
        source: 'DMG',
    },

    'potion_of_speed': {
        name: 'Potion of Speed',
        type: 'magic',
        rarity: 'very_rare',
        requiresAttunement: false,
        weight: 0.5,
        description: 'When you drink this potion, you gain the effect of the haste spell for 1 minute (no concentration required). The potion\'s yellow fluid is streaked with black and swirls on its own.',
        effects: [
            'Haste effect for 1 minute',
            'No concentration required',
            '+2 AC',
            'Advantage on DEX saves',
            'Double movement speed',
            'Extra action (limited)',
        ],
        tags: ['potion', 'consumable', 'haste', 'combat', 'speed', 'buff'],
        source: 'DMG',
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

const allPresets: Record<string, MagicItemPreset> = {
    ...magicWeapons,
    ...magicArmor,
    ...wondrousItems,
    ...potions,
};

export const magicCommonSource: PresetSource = {
    id: 'magic-common',
    name: 'Magic Items: Common & Uncommon',
    source: 'DMG',
    version: '1.0.0',
    presets: allPresets,
};

export default magicCommonSource;
