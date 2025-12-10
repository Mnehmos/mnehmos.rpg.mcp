/**
 * Player's Handbook Adventuring Gear Presets
 *
 * Common adventuring equipment from the D&D 5e Player's Handbook.
 * Includes containers, lights, tools, consumables, and essential gear.
 */

import type { GearPreset, PresetSource } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONTAINERS & STORAGE
// ═══════════════════════════════════════════════════════════════════════════

const BACKPACK: GearPreset = {
    name: 'Backpack',
    type: 'gear',
    subtype: 'container',
    weight: 5,
    value: 2,
    capacity: 30, // 1 cubic foot (30 lbs of gear)
    description: 'A leather pack with shoulder straps. Holds 1 cubic foot or 30 pounds of gear.',
    tags: ['container', 'storage', 'essential'],
    source: 'PHB'
};

const POUCH: GearPreset = {
    name: 'Pouch',
    type: 'gear',
    subtype: 'container',
    weight: 1,
    value: 0.5,
    capacity: 6, // 1/5 cubic foot (6 lbs)
    description: 'A cloth or leather pouch. Holds 1/5 cubic foot or 6 pounds of gear, such as a belt pouch.',
    tags: ['container', 'storage', 'belt', 'small'],
    source: 'PHB'
};

const SACK: GearPreset = {
    name: 'Sack',
    type: 'gear',
    subtype: 'container',
    weight: 0.5,
    value: 0.01,
    capacity: 30, // 1 cubic foot (30 lbs)
    description: 'A simple cloth sack. Holds 1 cubic foot or 30 pounds of gear.',
    tags: ['container', 'storage', 'cheap'],
    source: 'PHB'
};

const CHEST: GearPreset = {
    name: 'Chest',
    type: 'gear',
    subtype: 'container',
    weight: 25,
    value: 5,
    capacity: 300, // 12 cubic feet (300 lbs)
    description: 'A wooden chest with a hinged lid. Holds 12 cubic feet or 300 pounds of gear.',
    tags: ['container', 'storage', 'large', 'lockable'],
    source: 'PHB'
};

const BARREL: GearPreset = {
    name: 'Barrel',
    type: 'gear',
    subtype: 'container',
    weight: 70,
    value: 2,
    capacity: 40, // 40 gallons of liquid
    description: 'A wooden barrel. Holds 40 gallons of liquid or 4 cubic feet of solid goods.',
    tags: ['container', 'storage', 'liquid', 'large'],
    source: 'PHB'
};

const BASKET: GearPreset = {
    name: 'Basket',
    type: 'gear',
    subtype: 'container',
    weight: 2,
    value: 0.4,
    capacity: 40, // 2 cubic feet (40 lbs)
    description: 'A woven wicker basket. Holds 2 cubic feet or 40 pounds of gear.',
    tags: ['container', 'storage'],
    source: 'PHB'
};

const BOTTLE_GLASS: GearPreset = {
    name: 'Bottle, Glass',
    type: 'gear',
    subtype: 'container',
    weight: 2,
    value: 2,
    capacity: 1.5, // 1.5 pints of liquid
    description: 'A glass bottle with a cork. Holds 1½ pints of liquid.',
    tags: ['container', 'liquid', 'fragile'],
    source: 'PHB'
};

const FLASK_TANKARD: GearPreset = {
    name: 'Flask or Tankard',
    type: 'gear',
    subtype: 'container',
    weight: 1,
    value: 0.02,
    capacity: 1, // 1 pint
    description: 'A metal or ceramic drinking vessel. Holds 1 pint of liquid.',
    tags: ['container', 'liquid', 'drinking'],
    source: 'PHB'
};

const JUG_PITCHER: GearPreset = {
    name: 'Jug or Pitcher',
    type: 'gear',
    subtype: 'container',
    weight: 4,
    value: 0.02,
    capacity: 1, // 1 gallon
    description: 'A ceramic jug or pitcher. Holds 1 gallon of liquid.',
    tags: ['container', 'liquid'],
    source: 'PHB'
};

const VIAL: GearPreset = {
    name: 'Vial',
    type: 'gear',
    subtype: 'container',
    weight: 0,
    value: 1,
    capacity: 0.25, // 4 ounces
    description: 'A small glass vial. Holds 4 ounces of liquid.',
    tags: ['container', 'liquid', 'small', 'potion'],
    source: 'PHB'
};

const WATERSKIN: GearPreset = {
    name: 'Waterskin',
    type: 'gear',
    subtype: 'container',
    weight: 5, // when full
    value: 0.2,
    capacity: 4, // 4 pints (0.5 gallons)
    description: 'A leather waterskin. Holds 4 pints (½ gallon) of liquid. Weighs 5 lbs when full.',
    tags: ['container', 'liquid', 'water', 'essential'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// LIGHT SOURCES
// ═══════════════════════════════════════════════════════════════════════════

const CANDLE: GearPreset = {
    name: 'Candle',
    type: 'consumable',
    subtype: 'light',
    weight: 0,
    value: 0.01,
    uses: 1,
    effect: 'Sheds bright light in a 5-foot radius and dim light for an additional 5 feet. Burns for 1 hour.',
    description: 'A wax candle. Burns for 1 hour.',
    tags: ['light', 'consumable', 'fire'],
    source: 'PHB'
};

const TORCH: GearPreset = {
    name: 'Torch',
    type: 'consumable',
    subtype: 'light',
    weight: 1,
    value: 0.01,
    uses: 1,
    effect: 'Sheds bright light in a 20-foot radius and dim light for an additional 20 feet. Burns for 1 hour. Can be used to make a melee attack (1 fire damage).',
    description: 'A wooden torch soaked in pitch. Burns for 1 hour.',
    tags: ['light', 'consumable', 'fire', 'weapon'],
    source: 'PHB'
};

const LAMP: GearPreset = {
    name: 'Lamp',
    type: 'gear',
    subtype: 'light',
    weight: 1,
    value: 0.5,
    description: 'A simple oil lamp. Sheds bright light in a 15-foot radius and dim light for an additional 30 feet. Burns for 6 hours on a flask of oil.',
    tags: ['light', 'oil', 'reusable'],
    source: 'PHB'
};

const LANTERN_BULLSEYE: GearPreset = {
    name: 'Lantern, Bullseye',
    type: 'gear',
    subtype: 'light',
    weight: 2,
    value: 10,
    description: 'A hooded lantern that focuses light. Sheds bright light in a 60-foot cone and dim light for an additional 60 feet. Burns for 6 hours on a flask of oil.',
    tags: ['light', 'oil', 'directional', 'reusable'],
    source: 'PHB'
};

const LANTERN_HOODED: GearPreset = {
    name: 'Lantern, Hooded',
    type: 'gear',
    subtype: 'light',
    weight: 2,
    value: 5,
    description: 'A lantern with shutters. Sheds bright light in a 30-foot radius and dim light for an additional 30 feet. Burns for 6 hours on a flask of oil. Can be hooded to reduce light to dim in a 5-foot radius.',
    tags: ['light', 'oil', 'adjustable', 'reusable'],
    source: 'PHB'
};

const OIL_FLASK: GearPreset = {
    name: 'Oil (flask)',
    type: 'consumable',
    subtype: 'light',
    weight: 1,
    value: 0.1,
    uses: 1,
    effect: 'Fuels a lantern for 6 hours or lamp for 6 hours. Can be thrown as a splash weapon (5-foot radius, DC 10 DEX save or take 5 fire damage on first turn, then burn for 2 rounds dealing 5 damage each round).',
    description: 'A clay flask of oil. Used as fuel or as a fire weapon.',
    tags: ['light', 'fuel', 'consumable', 'fire', 'weapon'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSUMABLES & PROVISIONS
// ═══════════════════════════════════════════════════════════════════════════

const RATIONS: GearPreset = {
    name: 'Rations (1 day)',
    type: 'consumable',
    subtype: 'food',
    weight: 2,
    value: 0.5,
    uses: 1,
    effect: 'Provides sufficient food for one day. Includes dried fruits, hardtack, and jerky.',
    description: 'Dry foods suitable for travel. One day of sustenance.',
    tags: ['food', 'consumable', 'survival', 'essential'],
    source: 'PHB'
};

const POTION_HEALING: GearPreset = {
    name: 'Potion of Healing',
    type: 'consumable',
    subtype: 'potion',
    weight: 0.5,
    value: 50,
    uses: 1,
    effect: 'Restores 2d4+2 hit points. Drinking or administering takes an action.',
    description: 'A red liquid that glimmers when agitated. Restores health when consumed.',
    tags: ['potion', 'healing', 'consumable', 'magic'],
    source: 'PHB'
};

const ANTITOXIN: GearPreset = {
    name: 'Antitoxin (vial)',
    type: 'consumable',
    subtype: 'potion',
    weight: 0,
    value: 50,
    uses: 1,
    effect: 'Grants advantage on saving throws against poison for 1 hour. Does not cure existing poison.',
    description: 'A medicinal vial that helps resist poison.',
    tags: ['potion', 'consumable', 'poison', 'medicine'],
    source: 'PHB'
};

const HOLY_WATER: GearPreset = {
    name: 'Holy Water (flask)',
    type: 'consumable',
    subtype: 'holy',
    weight: 1,
    value: 25,
    uses: 1,
    effect: 'As an action, splash the contents on a creature within 5 feet or throw it up to 20 feet. Make a ranged attack. On hit, undead or fiend takes 2d6 radiant damage.',
    description: 'Water blessed by a cleric. Harmful to undead and fiends.',
    tags: ['holy', 'consumable', 'weapon', 'undead', 'radiant'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS & UTILITY
// ═══════════════════════════════════════════════════════════════════════════

const THIEVES_TOOLS: GearPreset = {
    name: "Thieves' Tools",
    type: 'tool',
    subtype: 'lockpicking',
    weight: 1,
    value: 25,
    description: 'A set of small tools including a file, lockpicks, small mirror, narrow scissors, and pliers. Required for picking locks and disarming traps.',
    tags: ['tool', 'lockpicking', 'thieves', 'essential', 'rogue'],
    source: 'PHB'
};

const CROWBAR: GearPreset = {
    name: 'Crowbar',
    type: 'tool',
    subtype: 'utility',
    weight: 5,
    value: 2,
    description: 'An iron pry bar. Grants advantage on Strength checks where leverage can be applied.',
    tags: ['tool', 'utility', 'strength', 'leverage'],
    source: 'PHB'
};

const HAMMER: GearPreset = {
    name: 'Hammer',
    type: 'tool',
    subtype: 'utility',
    weight: 3,
    value: 1,
    description: 'A simple hammer. Used for driving pitons, breaking objects, or general construction.',
    tags: ['tool', 'utility', 'construction'],
    source: 'PHB'
};

const GRAPPLING_HOOK: GearPreset = {
    name: 'Grappling Hook',
    type: 'gear',
    subtype: 'utility',
    weight: 4,
    value: 2,
    description: 'A metal hook with multiple flukes. Can be tied to rope and thrown to catch on ledges. Requires DC 10 Athletics check to secure properly.',
    tags: ['climbing', 'utility', 'rope', 'exploration'],
    source: 'PHB'
};

const PITON: GearPreset = {
    name: 'Piton',
    type: 'gear',
    subtype: 'climbing',
    weight: 0.25,
    value: 0.05,
    description: 'A metal spike. Can be driven into rock, wood, or other surfaces to secure rope.',
    tags: ['climbing', 'utility', 'spike', 'rope'],
    source: 'PHB'
};

const ROPE_HEMPEN: GearPreset = {
    name: 'Rope, Hempen (50 feet)',
    type: 'gear',
    subtype: 'utility',
    weight: 10,
    value: 1,
    description: 'Fifty feet of hempen rope. Has 2 hit points and can be burst with a DC 17 Strength check.',
    tags: ['rope', 'climbing', 'utility', 'essential'],
    source: 'PHB'
};

const ROPE_SILK: GearPreset = {
    name: 'Rope, Silk (50 feet)',
    type: 'gear',
    subtype: 'utility',
    weight: 5,
    value: 10,
    description: 'Fifty feet of silk rope. Has 2 hit points and can be burst with a DC 17 Strength check. Lighter and stronger than hempen rope.',
    tags: ['rope', 'climbing', 'utility', 'silk', 'premium'],
    source: 'PHB'
};

const CHAIN: GearPreset = {
    name: 'Chain (10 feet)',
    type: 'gear',
    subtype: 'utility',
    weight: 10,
    value: 5,
    description: 'Ten feet of metal chain. Has 10 hit points and can be burst with a DC 20 Strength check.',
    tags: ['chain', 'utility', 'binding', 'strong'],
    source: 'PHB'
};

const MANACLES: GearPreset = {
    name: 'Manacles',
    type: 'gear',
    subtype: 'restraint',
    weight: 6,
    value: 2,
    description: 'Metal restraints that bind a Small or Medium creature. DC 20 Strength check to break, DC 20 Dexterity check (thieves\' tools) to pick the lock. Comes with one key.',
    tags: ['restraint', 'binding', 'metal', 'lockable'],
    source: 'PHB'
};

const LOCK: GearPreset = {
    name: 'Lock',
    type: 'gear',
    subtype: 'security',
    weight: 1,
    value: 10,
    description: 'A metal lock with a key. DC 15 Dexterity check (thieves\' tools) to pick.',
    tags: ['lock', 'security', 'lockable'],
    source: 'PHB'
};

const SHOVEL: GearPreset = {
    name: 'Shovel',
    type: 'tool',
    subtype: 'utility',
    weight: 5,
    value: 2,
    description: 'A sturdy shovel. Used for digging trenches, graves, or excavating.',
    tags: ['tool', 'digging', 'utility', 'excavation'],
    source: 'PHB'
};

const PICK_MINERS: GearPreset = {
    name: "Pick, Miner's",
    type: 'tool',
    subtype: 'utility',
    weight: 10,
    value: 2,
    description: 'A heavy mining pick. Used for breaking through rock or hard earth.',
    tags: ['tool', 'mining', 'utility', 'excavation'],
    source: 'PHB'
};

const TINDERBOX: GearPreset = {
    name: 'Tinderbox',
    type: 'gear',
    subtype: 'utility',
    weight: 1,
    value: 0.5,
    description: 'A small container with flint, fire steel, and tinder. Lighting a torch takes an action; lighting anything else takes 1 minute.',
    tags: ['fire', 'utility', 'essential', 'survival'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// KITS & EQUIPMENT BUNDLES
// ═══════════════════════════════════════════════════════════════════════════

const MESS_KIT: GearPreset = {
    name: 'Mess Kit',
    type: 'gear',
    subtype: 'kit',
    weight: 1,
    value: 0.2,
    description: 'A metal box containing a cup, bowl, plate, fork, knife, and spoon.',
    tags: ['kit', 'cooking', 'eating', 'camping'],
    source: 'PHB'
};

const HEALERS_KIT: GearPreset = {
    name: "Healer's Kit",
    type: 'tool',
    subtype: 'kit',
    weight: 3,
    value: 5,
    uses: 10,
    effect: 'Used to stabilize a dying creature (DC 10 Medicine check not required). Has 10 uses.',
    description: 'A leather pouch containing bandages, salves, and splints.',
    tags: ['kit', 'healing', 'medicine', 'tool', 'stabilize'],
    source: 'PHB'
};

const CLIMBERS_KIT: GearPreset = {
    name: "Climber's Kit",
    type: 'tool',
    subtype: 'kit',
    weight: 12,
    value: 25,
    description: 'Includes pitons, boot tips, gloves, and a harness. While climbing, you can anchor yourself to avoid falling more than 25 feet (if within 25 feet of last anchor point).',
    tags: ['kit', 'climbing', 'tool', 'safety', 'exploration'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// CAMPING & REST
// ═══════════════════════════════════════════════════════════════════════════

const BEDROLL: GearPreset = {
    name: 'Bedroll',
    type: 'gear',
    subtype: 'camping',
    weight: 7,
    value: 1,
    description: 'A rolled-up sleeping pad and blanket. Essential for comfortable rest while traveling.',
    tags: ['camping', 'rest', 'sleep', 'essential'],
    source: 'PHB'
};

const BLANKET: GearPreset = {
    name: 'Blanket',
    type: 'gear',
    subtype: 'camping',
    weight: 3,
    value: 0.5,
    description: 'A wool blanket. Provides warmth while sleeping or traveling in cold weather.',
    tags: ['camping', 'warmth', 'sleep', 'cold'],
    source: 'PHB'
};

const TENT: GearPreset = {
    name: 'Tent, Two-Person',
    type: 'gear',
    subtype: 'camping',
    weight: 20,
    value: 2,
    description: 'A simple canvas tent that sleeps two people.',
    tags: ['camping', 'shelter', 'rest', 'weather'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// SPELLCASTING FOCUSES
// ═══════════════════════════════════════════════════════════════════════════

const ARCANE_FOCUS_CRYSTAL: GearPreset = {
    name: 'Arcane Focus (Crystal)',
    type: 'gear',
    subtype: 'focus',
    weight: 1,
    value: 10,
    description: 'A crystal orb used by sorcerers, warlocks, and wizards as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'arcane', 'spellcasting', 'crystal', 'sorcerer', 'warlock', 'wizard'],
    source: 'PHB'
};

const ARCANE_FOCUS_ORB: GearPreset = {
    name: 'Arcane Focus (Orb)',
    type: 'gear',
    subtype: 'focus',
    weight: 3,
    value: 20,
    description: 'A polished orb used by sorcerers, warlocks, and wizards as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'arcane', 'spellcasting', 'orb', 'sorcerer', 'warlock', 'wizard'],
    source: 'PHB'
};

const ARCANE_FOCUS_ROD: GearPreset = {
    name: 'Arcane Focus (Rod)',
    type: 'gear',
    subtype: 'focus',
    weight: 2,
    value: 10,
    description: 'A metal rod used by sorcerers, warlocks, and wizards as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'arcane', 'spellcasting', 'rod', 'sorcerer', 'warlock', 'wizard'],
    source: 'PHB'
};

const ARCANE_FOCUS_STAFF: GearPreset = {
    name: 'Arcane Focus (Staff)',
    type: 'gear',
    subtype: 'focus',
    weight: 4,
    value: 5,
    description: 'A wooden staff used by sorcerers, warlocks, and wizards as a spellcasting focus. Can replace material components without a cost. Can also be used as a quarterstaff.',
    tags: ['focus', 'arcane', 'spellcasting', 'staff', 'sorcerer', 'warlock', 'wizard', 'weapon'],
    source: 'PHB'
};

const ARCANE_FOCUS_WAND: GearPreset = {
    name: 'Arcane Focus (Wand)',
    type: 'gear',
    subtype: 'focus',
    weight: 1,
    value: 10,
    description: 'A wand used by sorcerers, warlocks, and wizards as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'arcane', 'spellcasting', 'wand', 'sorcerer', 'warlock', 'wizard'],
    source: 'PHB'
};

const COMPONENT_POUCH: GearPreset = {
    name: 'Component Pouch',
    type: 'gear',
    subtype: 'focus',
    weight: 2,
    value: 25,
    description: 'A leather belt pouch with compartments for spell components. Can replace material components without a cost. Used by all spellcasters.',
    tags: ['focus', 'components', 'spellcasting', 'pouch', 'universal'],
    source: 'PHB'
};

const HOLY_SYMBOL_AMULET: GearPreset = {
    name: 'Holy Symbol (Amulet)',
    type: 'gear',
    subtype: 'focus',
    weight: 1,
    value: 5,
    description: 'A holy symbol worn as an amulet. Used by clerics and paladins as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'holy', 'spellcasting', 'amulet', 'cleric', 'paladin', 'divine'],
    source: 'PHB'
};

const HOLY_SYMBOL_EMBLEM: GearPreset = {
    name: 'Holy Symbol (Emblem)',
    type: 'gear',
    subtype: 'focus',
    weight: 0,
    value: 5,
    description: 'A holy symbol worn as an emblem on clothing or a shield. Used by clerics and paladins as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'holy', 'spellcasting', 'emblem', 'cleric', 'paladin', 'divine'],
    source: 'PHB'
};

const HOLY_SYMBOL_RELIQUARY: GearPreset = {
    name: 'Holy Symbol (Reliquary)',
    type: 'gear',
    subtype: 'focus',
    weight: 2,
    value: 5,
    description: 'A holy symbol in a small container holding a sacred relic. Used by clerics and paladins as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'holy', 'spellcasting', 'reliquary', 'cleric', 'paladin', 'divine'],
    source: 'PHB'
};

const DRUIDIC_FOCUS_MISTLETOE: GearPreset = {
    name: 'Druidic Focus (Sprig of Mistletoe)',
    type: 'gear',
    subtype: 'focus',
    weight: 0,
    value: 1,
    description: 'A sprig of mistletoe used by druids as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'druidic', 'spellcasting', 'nature', 'druid', 'plant'],
    source: 'PHB'
};

const DRUIDIC_FOCUS_TOTEM: GearPreset = {
    name: 'Druidic Focus (Totem)',
    type: 'gear',
    subtype: 'focus',
    weight: 0,
    value: 1,
    description: 'A totem incorporating feathers, fur, bones, and teeth from sacred animals. Used by druids as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'druidic', 'spellcasting', 'nature', 'druid', 'totem'],
    source: 'PHB'
};

const DRUIDIC_FOCUS_STAFF: GearPreset = {
    name: 'Druidic Focus (Wooden Staff)',
    type: 'gear',
    subtype: 'focus',
    weight: 4,
    value: 5,
    description: 'A wooden staff drawn from a living tree. Used by druids as a spellcasting focus. Can replace material components without a cost. Can also be used as a quarterstaff.',
    tags: ['focus', 'druidic', 'spellcasting', 'nature', 'druid', 'staff', 'weapon'],
    source: 'PHB'
};

const DRUIDIC_FOCUS_WAND: GearPreset = {
    name: 'Druidic Focus (Yew Wand)',
    type: 'gear',
    subtype: 'focus',
    weight: 1,
    value: 10,
    description: 'A wand made of yew or other special wood. Used by druids as a spellcasting focus. Can replace material components without a cost.',
    tags: ['focus', 'druidic', 'spellcasting', 'nature', 'druid', 'wand'],
    source: 'PHB'
};

const SPELLBOOK: GearPreset = {
    name: 'Spellbook',
    type: 'gear',
    subtype: 'book',
    weight: 3,
    value: 50,
    description: 'A leather-bound tome with 100 blank pages. Essential for wizards to prepare spells. Recording a spell takes 2 hours and 50 gp per spell level.',
    tags: ['book', 'spellcasting', 'wizard', 'arcane', 'essential'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// WRITING SUPPLIES
// ═══════════════════════════════════════════════════════════════════════════

const INK: GearPreset = {
    name: 'Ink (1 ounce bottle)',
    type: 'gear',
    subtype: 'writing',
    weight: 0,
    value: 10,
    description: 'A small bottle of black ink. Sufficient for writing approximately 500 pages.',
    tags: ['writing', 'ink', 'scribing'],
    source: 'PHB'
};

const INK_PEN: GearPreset = {
    name: 'Ink Pen',
    type: 'gear',
    subtype: 'writing',
    weight: 0,
    value: 0.02,
    description: 'A wooden pen with a metal nib. Used for writing with ink.',
    tags: ['writing', 'pen', 'scribing'],
    source: 'PHB'
};

const PAPER: GearPreset = {
    name: 'Paper (one sheet)',
    type: 'gear',
    subtype: 'writing',
    weight: 0,
    value: 0.2,
    description: 'A single sheet of paper. More expensive but smoother than parchment.',
    tags: ['writing', 'paper', 'scribing'],
    source: 'PHB'
};

const PARCHMENT: GearPreset = {
    name: 'Parchment (one sheet)',
    type: 'gear',
    subtype: 'writing',
    weight: 0,
    value: 0.1,
    description: 'A single sheet of parchment made from animal skin. Common writing surface.',
    tags: ['writing', 'parchment', 'scribing'],
    source: 'PHB'
};

const BOOK: GearPreset = {
    name: 'Book',
    type: 'gear',
    subtype: 'book',
    weight: 5,
    value: 25,
    description: 'A hardcover book with up to 100 pages. Could contain lore, notes, or records.',
    tags: ['book', 'reading', 'knowledge', 'lore'],
    source: 'PHB'
};

const CASE_MAP_SCROLL: GearPreset = {
    name: 'Case, Map or Scroll',
    type: 'gear',
    subtype: 'container',
    weight: 1,
    value: 1,
    description: 'A cylindrical leather case for holding rolled-up maps or scrolls. Holds up to ten sheets.',
    tags: ['container', 'maps', 'scrolls', 'storage', 'waterproof'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// TACTICAL ITEMS
// ═══════════════════════════════════════════════════════════════════════════

const BALL_BEARINGS: GearPreset = {
    name: 'Ball Bearings (bag of 1,000)',
    type: 'gear',
    subtype: 'tactical',
    weight: 2,
    value: 1,
    uses: 1,
    effect: 'As an action, spill on ground to cover 10-foot square. Creatures moving through must succeed DC 10 DEX save or fall prone. Creatures moving at half speed don\'t need to save.',
    description: 'A bag containing 1,000 small metal ball bearings. Used to create difficult terrain.',
    tags: ['tactical', 'trap', 'prone', 'crowd control'],
    source: 'PHB'
};

const CALTROPS: GearPreset = {
    name: 'Caltrops (bag of 20)',
    type: 'gear',
    subtype: 'tactical',
    weight: 2,
    value: 1,
    uses: 1,
    effect: 'As an action, spread on ground to cover 5-foot square. Creatures moving through take 1 piercing damage and must succeed DC 15 DEX save or stop moving. Takes 1 damage for every 5 feet traveled. DC 10 Perception to spot.',
    description: 'A bag of spiked metal devices designed to slow pursuit.',
    tags: ['tactical', 'trap', 'damage', 'crowd control', 'piercing'],
    source: 'PHB'
};

const HUNTING_TRAP: GearPreset = {
    name: 'Hunting Trap',
    type: 'gear',
    subtype: 'tactical',
    weight: 25,
    value: 5,
    uses: 1,
    effect: 'Set with an action. Creature stepping on it must succeed DC 13 DEX save or take 1d4 piercing damage and be restrained. Trapped creature can use action to make DC 13 STR check to free itself. DC 10 Perception to spot.',
    description: 'A metal trap with serrated jaws that spring shut when triggered.',
    tags: ['tactical', 'trap', 'restrained', 'damage', 'piercing'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// OBSERVATION & DETECTION
// ═══════════════════════════════════════════════════════════════════════════

const MIRROR_STEEL: GearPreset = {
    name: 'Mirror, Steel',
    type: 'gear',
    subtype: 'observation',
    weight: 0.5,
    value: 5,
    description: 'A polished steel mirror. Useful for looking around corners, signaling, or checking for invisible creatures.',
    tags: ['observation', 'utility', 'detection', 'signaling'],
    source: 'PHB'
};

const SPYGLASS: GearPreset = {
    name: 'Spyglass',
    type: 'gear',
    subtype: 'observation',
    weight: 1,
    value: 1000,
    description: 'A brass telescope. Objects viewed through it are magnified to twice their size.',
    tags: ['observation', 'magnification', 'distance', 'scouting', 'expensive'],
    source: 'PHB'
};

const MAGNIFYING_GLASS: GearPreset = {
    name: 'Magnifying Glass',
    type: 'gear',
    subtype: 'observation',
    weight: 0,
    value: 100,
    description: 'A convex lens in a metal frame. Grants advantage on Intelligence (Investigation) checks to appraise or inspect small objects. Can be used to start a fire (takes 5 minutes in bright sunlight).',
    tags: ['observation', 'investigation', 'magnification', 'fire', 'expensive'],
    source: 'PHB'
};

const BELL: GearPreset = {
    name: 'Bell',
    type: 'gear',
    subtype: 'alarm',
    weight: 0,
    value: 1,
    description: 'A small brass bell. Can be attached to a string or wire as an alarm.',
    tags: ['alarm', 'sound', 'detection', 'tripwire'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// MISCELLANEOUS
// ═══════════════════════════════════════════════════════════════════════════

const CHALK: GearPreset = {
    name: 'Chalk (1 piece)',
    type: 'gear',
    subtype: 'marking',
    weight: 0,
    value: 0.01,
    description: 'A piece of white chalk. Used for marking surfaces, tracking explored areas, or illustrating plans.',
    tags: ['marking', 'exploration', 'utility', 'cheap'],
    source: 'PHB'
};

const BUCKET: GearPreset = {
    name: 'Bucket',
    type: 'gear',
    subtype: 'container',
    weight: 2,
    value: 0.05,
    capacity: 3, // 3 gallons
    description: 'A wooden or metal bucket. Holds 3 gallons of liquid.',
    tags: ['container', 'liquid', 'utility'],
    source: 'PHB'
};

const FISHING_TACKLE: GearPreset = {
    name: 'Fishing Tackle',
    type: 'tool',
    subtype: 'utility',
    weight: 4,
    value: 1,
    description: 'Includes a wooden rod, silken line, hooks, cork bobbers, lures, and narrow netting. Used for catching fish.',
    tags: ['tool', 'fishing', 'survival', 'food'],
    source: 'PHB'
};

const HOURGLASS: GearPreset = {
    name: 'Hourglass',
    type: 'gear',
    subtype: 'timekeeping',
    weight: 1,
    value: 25,
    description: 'A glass timepiece that measures one hour of time.',
    tags: ['timekeeping', 'utility', 'time'],
    source: 'PHB'
};

const POLE_10FT: GearPreset = {
    name: 'Pole (10-foot)',
    type: 'gear',
    subtype: 'utility',
    weight: 7,
    value: 0.05,
    description: 'A ten-foot wooden pole. Essential dungeoneering tool for poking suspicious floors, doors, and objects from a safe distance.',
    tags: ['utility', 'dungeoneering', 'detection', 'classic'],
    source: 'PHB'
};

const SIGNAL_WHISTLE: GearPreset = {
    name: 'Signal Whistle',
    type: 'gear',
    subtype: 'signaling',
    weight: 0,
    value: 0.05,
    description: 'A small whistle that produces a loud, piercing sound. Can be heard up to 600 feet away.',
    tags: ['signaling', 'alarm', 'sound', 'communication'],
    source: 'PHB'
};

const SOAP: GearPreset = {
    name: 'Soap',
    type: 'consumable',
    subtype: 'hygiene',
    weight: 0,
    value: 0.02,
    description: 'A bar of soap. Used for bathing and cleaning.',
    tags: ['hygiene', 'cleaning', 'consumable'],
    source: 'PHB'
};

// ═══════════════════════════════════════════════════════════════════════════
// PRESET SOURCE EXPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize item name to a lookup key
 * Removes special characters, converts to lowercase, replaces spaces with underscores
 */
function normalize(name: string): string {
    return name
        .toLowerCase()
        .replace(/[',()]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_');
}

/**
 * Player's Handbook Adventuring Gear Collection
 * Contains 75+ common items every adventurer needs
 */
export const gearPhb: PresetSource = {
    id: 'gear-phb',
    name: 'Player\'s Handbook Adventuring Gear',
    source: 'PHB',
    version: '1.0.0',
    presets: {
        // Containers
        [normalize(BACKPACK.name)]: BACKPACK,
        [normalize(POUCH.name)]: POUCH,
        [normalize(SACK.name)]: SACK,
        [normalize(CHEST.name)]: CHEST,
        [normalize(BARREL.name)]: BARREL,
        [normalize(BASKET.name)]: BASKET,
        [normalize(BOTTLE_GLASS.name)]: BOTTLE_GLASS,
        [normalize(FLASK_TANKARD.name)]: FLASK_TANKARD,
        [normalize(JUG_PITCHER.name)]: JUG_PITCHER,
        [normalize(VIAL.name)]: VIAL,
        [normalize(WATERSKIN.name)]: WATERSKIN,
        [normalize(BUCKET.name)]: BUCKET,
        [normalize(CASE_MAP_SCROLL.name)]: CASE_MAP_SCROLL,

        // Light sources
        [normalize(CANDLE.name)]: CANDLE,
        [normalize(TORCH.name)]: TORCH,
        [normalize(LAMP.name)]: LAMP,
        [normalize(LANTERN_BULLSEYE.name)]: LANTERN_BULLSEYE,
        [normalize(LANTERN_HOODED.name)]: LANTERN_HOODED,
        [normalize(OIL_FLASK.name)]: OIL_FLASK,

        // Consumables
        [normalize(RATIONS.name)]: RATIONS,
        [normalize(POTION_HEALING.name)]: POTION_HEALING,
        [normalize(ANTITOXIN.name)]: ANTITOXIN,
        [normalize(HOLY_WATER.name)]: HOLY_WATER,
        [normalize(SOAP.name)]: SOAP,

        // Tools
        [normalize(THIEVES_TOOLS.name)]: THIEVES_TOOLS,
        [normalize(CROWBAR.name)]: CROWBAR,
        [normalize(HAMMER.name)]: HAMMER,
        [normalize(GRAPPLING_HOOK.name)]: GRAPPLING_HOOK,
        [normalize(PITON.name)]: PITON,
        [normalize(ROPE_HEMPEN.name)]: ROPE_HEMPEN,
        [normalize(ROPE_SILK.name)]: ROPE_SILK,
        [normalize(CHAIN.name)]: CHAIN,
        [normalize(MANACLES.name)]: MANACLES,
        [normalize(LOCK.name)]: LOCK,
        [normalize(SHOVEL.name)]: SHOVEL,
        [normalize(PICK_MINERS.name)]: PICK_MINERS,
        [normalize(TINDERBOX.name)]: TINDERBOX,
        [normalize(FISHING_TACKLE.name)]: FISHING_TACKLE,

        // Kits
        [normalize(MESS_KIT.name)]: MESS_KIT,
        [normalize(HEALERS_KIT.name)]: HEALERS_KIT,
        [normalize(CLIMBERS_KIT.name)]: CLIMBERS_KIT,

        // Camping
        [normalize(BEDROLL.name)]: BEDROLL,
        [normalize(BLANKET.name)]: BLANKET,
        [normalize(TENT.name)]: TENT,

        // Arcane focuses
        [normalize(ARCANE_FOCUS_CRYSTAL.name)]: ARCANE_FOCUS_CRYSTAL,
        [normalize(ARCANE_FOCUS_ORB.name)]: ARCANE_FOCUS_ORB,
        [normalize(ARCANE_FOCUS_ROD.name)]: ARCANE_FOCUS_ROD,
        [normalize(ARCANE_FOCUS_STAFF.name)]: ARCANE_FOCUS_STAFF,
        [normalize(ARCANE_FOCUS_WAND.name)]: ARCANE_FOCUS_WAND,
        [normalize(COMPONENT_POUCH.name)]: COMPONENT_POUCH,

        // Holy symbols
        [normalize(HOLY_SYMBOL_AMULET.name)]: HOLY_SYMBOL_AMULET,
        [normalize(HOLY_SYMBOL_EMBLEM.name)]: HOLY_SYMBOL_EMBLEM,
        [normalize(HOLY_SYMBOL_RELIQUARY.name)]: HOLY_SYMBOL_RELIQUARY,

        // Druidic focuses
        [normalize(DRUIDIC_FOCUS_MISTLETOE.name)]: DRUIDIC_FOCUS_MISTLETOE,
        [normalize(DRUIDIC_FOCUS_TOTEM.name)]: DRUIDIC_FOCUS_TOTEM,
        [normalize(DRUIDIC_FOCUS_STAFF.name)]: DRUIDIC_FOCUS_STAFF,
        [normalize(DRUIDIC_FOCUS_WAND.name)]: DRUIDIC_FOCUS_WAND,

        // Spellbook
        [normalize(SPELLBOOK.name)]: SPELLBOOK,

        // Writing
        [normalize(INK.name)]: INK,
        [normalize(INK_PEN.name)]: INK_PEN,
        [normalize(PAPER.name)]: PAPER,
        [normalize(PARCHMENT.name)]: PARCHMENT,
        [normalize(BOOK.name)]: BOOK,

        // Tactical
        [normalize(BALL_BEARINGS.name)]: BALL_BEARINGS,
        [normalize(CALTROPS.name)]: CALTROPS,
        [normalize(HUNTING_TRAP.name)]: HUNTING_TRAP,

        // Observation
        [normalize(MIRROR_STEEL.name)]: MIRROR_STEEL,
        [normalize(SPYGLASS.name)]: SPYGLASS,
        [normalize(MAGNIFYING_GLASS.name)]: MAGNIFYING_GLASS,
        [normalize(BELL.name)]: BELL,

        // Miscellaneous
        [normalize(CHALK.name)]: CHALK,
        [normalize(HOURGLASS.name)]: HOURGLASS,
        [normalize(POLE_10FT.name)]: POLE_10FT,
        [normalize(SIGNAL_WHISTLE.name)]: SIGNAL_WHISTLE,
    }
};

export default gearPhb;
