/**
 * Starting Equipment & Spell Provisioning Service
 * 
 * Automatically grants class-appropriate starting equipment, spells, and currency
 * when creating new characters. Uses D&D 5e SRD as baseline.
 * 
 * DESIGN PHILOSOPHY:
 * - Auto-provision by default (reduces manual follow-up prompts)
 * - Allow improv/override (LLM can specify custom equipment)
 * - Fail gracefully (if item creation fails, character still works)
 */

import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { ItemRepository } from '../storage/repos/item.repo.js';
import { InventoryRepository } from '../storage/repos/inventory.repo.js';
import { Item } from '../schema/inventory.js';
import {
    CLASS_DATA,
    getDefaultStartingEquipment,
    getSpellSlots,
    isSpellcaster,
    EquipmentPacks,
    D5EClass
} from '../data/class-starting-data.js';
import { findOpen5eItem } from '../content/open5e-catalog.js';
import { materializeOpen5eItem } from './open5e-item.service.js';

export interface ProvisioningResult {
    itemsGranted: string[];
    spellsGranted: string[];
    cantripsGranted: string[];
    spellSlots: number[] | null;
    pactMagicSlots: { current: number; max: number; slotLevel: number } | null;
    startingGold: number;
    errors: string[];
}

export interface ProvisioningOptions {
    /** Skip equipment provisioning entirely */
    skipEquipment?: boolean;
    /** Skip spell provisioning entirely */
    skipSpells?: boolean;
    /** Override starting gold (otherwise uses class default) */
    startingGold?: number;
    /** Custom equipment to grant instead of defaults */
    customEquipment?: string[];
    /** Custom spells to grant instead of defaults */
    customSpells?: string[];
    /** Custom cantrips to grant instead of defaults */
    customCantrips?: string[];
    /** Exact source item keys granted by a selected background or other origin */
    additionalEquipmentSourceKeys?: string[];
}

/**
 * Provision starting equipment and spells for a newly created character
 */
export function provisionStartingEquipment(
    db: Database.Database,
    characterId: string,
    className: string,
    level: number = 1,
    options: ProvisioningOptions = {}
): ProvisioningResult {
    const itemRepo = new ItemRepository(db);
    const invRepo = new InventoryRepository(db);

    const result: ProvisioningResult = {
        itemsGranted: [],
        spellsGranted: [],
        cantripsGranted: [],
        spellSlots: null,
        pactMagicSlots: null,
        startingGold: 0,
        errors: []
    };

    // Normalize class name for lookup
    const normalizedClass = normalizeClassName(className);
    const classData = CLASS_DATA[normalizedClass];

    // =========================================================
    // EQUIPMENT PROVISIONING
    // =========================================================
    if (!options.skipEquipment) {
        const equipmentList = options.customEquipment?.length
            ? options.customEquipment
            : classData
                ? getDefaultStartingEquipment(normalizedClass)
                : getGenericStartingEquipment();

        for (const equipmentEntry of equipmentList) {
            try {
                const { itemName, quantity } = parseEquipmentEntry(equipmentEntry);
                const itemId = ensureItemExists(itemRepo, itemName);
                invRepo.addItem(characterId, itemId, quantity);
                result.itemsGranted.push(quantity > 1 ? `${itemName} x${quantity}` : itemName);
            } catch (err) {
                result.errors.push(`Failed to grant "${equipmentEntry}": ${(err as Error).message}`);
            }
        }

        for (const sourceKey of options.additionalEquipmentSourceKeys ?? []) {
            try {
                const materialized = materializeOpen5eItem(itemRepo, sourceKey);
                invRepo.addItem(characterId, materialized.item.id, 1);
                result.itemsGranted.push(materialized.item.name);
            } catch (err) {
                result.errors.push(`Failed to grant source item "${sourceKey}": ${(err as Error).message}`);
            }
        }

        // Grant starting gold
        const goldAmount = options.startingGold ?? (classData?.startingGold ?? 10);
        try {
            invRepo.addCurrency(characterId, { gold: goldAmount });
            result.startingGold = goldAmount;
        } catch (err) {
            result.errors.push(`Failed to grant starting gold: ${(err as Error).message}`);
        }
    }

    // =========================================================
    // SPELL PROVISIONING
    // =========================================================
    if (!options.skipSpells && classData && isSpellcaster(normalizedClass)) {
        // Get spell slots for level
        const slots = getSpellSlots(normalizedClass, level);
        if (slots) {
            if (normalizedClass === 'warlock') {
                // Warlock slots are in array format [0,0,2,0,...] - convert to pact magic format
                // Find the non-zero slot count and its spell level (1-indexed)
                const slotCount = slots.find(s => s > 0) || 1;
                const slotLevel = slots.findIndex(s => s > 0) + 1;
                result.pactMagicSlots = {
                    current: slotCount,
                    max: slotCount,
                    slotLevel: slotLevel || 1
                };
            } else {
                result.spellSlots = slots as number[];
            }
        }

        // Grant cantrips
        const cantrips = options.customCantrips?.length
            ? options.customCantrips
            : classData.startingCantrips || [];
        result.cantripsGranted = cantrips;

        // Grant spells
        const spells = options.customSpells?.length
            ? options.customSpells
            : classData.startingSpells || [];
        result.spellsGranted = spells;
    }

    return result;
}

/**
 * Normalize class name to match CLASS_DATA keys
 */
function normalizeClassName(className: string): D5EClass {
    const normalized = className.toLowerCase().trim();
    
    // Direct match
    if (normalized in CLASS_DATA) {
        return normalized as D5EClass;
    }

    // Common aliases
    const aliases: Record<string, D5EClass> = {
        'mage': 'wizard',
        'arcane caster': 'wizard',
        'priest': 'cleric',
        'healer': 'cleric',
        'thief': 'rogue',
        'assassin': 'rogue',
        'berserker': 'barbarian',
        'knight': 'fighter',
        'warrior': 'fighter',
        'soldier': 'fighter',
        'nature priest': 'druid',
        'shapeshifter': 'druid',
        'holy warrior': 'paladin',
        'crusader': 'paladin',
        'hunter': 'ranger',
        'scout': 'ranger',
        'wild mage': 'sorcerer',
        'bloodmage': 'sorcerer',
        'hexblade': 'warlock',
        'pact mage': 'warlock',
        'performer': 'bard',
        'skald': 'bard',
        'martial artist': 'monk',
        'mystic': 'monk'
    };

    if (normalized in aliases) {
        return aliases[normalized];
    }

    // Partial match - check if class name contains a known class
    for (const knownClass of Object.keys(CLASS_DATA)) {
        if (normalized.includes(knownClass)) {
            return knownClass as D5EClass;
        }
    }

    // Unknown class - return as-is (will fall back to generic equipment)
    return normalized as D5EClass;
}

/**
 * Generic starting equipment for unknown/custom classes
 */
function getGenericStartingEquipment(): string[] {
    return [
        'Simple Weapon',
        'Leather Armor',
        'Backpack',
        'Bedroll',
        'Torch',
        'Rations (1 day)',
        'Waterskin'
    ];
}

const SOURCE_ITEM_ALIASES: Record<string, string> = {
    'arrow': 'srd_arrow-bow',
    'arrows': 'srd_arrow-bow',
    'crossbow bolt': 'srd_crossbow-bolt',
    'crossbow bolts': 'srd_crossbow-bolt',
};

function parseEquipmentEntry(value: string): { itemName: string; quantity: number } {
    const match = value.trim().match(/^(.*?)\s+x(\d+)$/iu);
    if (!match) return { itemName: value.trim(), quantity: 1 };
    return { itemName: match[1].trim(), quantity: Number.parseInt(match[2], 10) };
}

/**
 * Ensure an item exists in the database, creating it if necessary
 */
function ensureItemExists(itemRepo: ItemRepository, itemName: string): string {
    const catalogValue = SOURCE_ITEM_ALIASES[itemName.toLowerCase()] ?? itemName;
    if (findOpen5eItem(catalogValue)) {
        return materializeOpen5eItem(itemRepo, catalogValue).item.id;
    }

    // Check if item already exists
    const existing = itemRepo.findByName(itemName);
    if (existing.length > 0) {
        return existing[0].id;
    }

    // Create new item with sensible defaults
    const now = new Date().toISOString();
    const itemData = getItemDefaults(itemName);
    
    const item: Item = {
        id: randomUUID(),
        name: itemName,
        description: itemData.description,
        type: itemData.type,
        weight: itemData.weight,
        value: itemData.value,
        properties: itemData.properties,
        createdAt: now,
        updatedAt: now
    };

    itemRepo.create(item);
    return item.id;
}

/**
 * Get sensible defaults for common D&D items
 */
function getItemDefaults(itemName: string): {
    type: 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc';
    weight: number;
    value: number;
    description: string;
    properties?: Record<string, unknown>;
} {
    const name = itemName.toLowerCase();

    if (/^(simple|martial)( melee)? weapon$/u.test(name)) {
        return {
            type: 'weapon',
            weight: 0,
            value: 0,
            description: `${itemName} is an unresolved character-creation choice, not a concrete weapon.`,
            properties: {
                weaponClass: name.startsWith('martial') ? 'martial' : 'simple',
                meleeOnly: name.includes('melee'),
                requiresSelection: true,
                equipSlots: ['mainhand', 'offhand']
            }
        };
    }

    // Weapons
    if (name.includes('sword') || name.includes('blade')) {
        const isTwoHanded = name.includes('great') || name.includes('two-handed');
        return {
            type: 'weapon',
            weight: isTwoHanded ? 6 : 3,
            value: isTwoHanded ? 50 : 15,
            description: `A ${itemName.toLowerCase()}.`,
            properties: {
                damage: isTwoHanded ? '2d6' : '1d8',
                damageType: 'slashing',
                versatile: !isTwoHanded
            }
        };
    }

    if (name.includes('axe')) {
        const isGreat = name.includes('great');
        return {
            type: 'weapon',
            weight: isGreat ? 7 : 4,
            value: isGreat ? 30 : 10,
            description: `A ${itemName.toLowerCase()}.`,
            properties: {
                damage: isGreat ? '1d12' : '1d8',
                damageType: 'slashing'
            }
        };
    }

    if (name.includes('bow')) {
        const isLong = name.includes('long');
        return {
            type: 'weapon',
            weight: isLong ? 2 : 1,
            value: isLong ? 50 : 25,
            description: `A ${itemName.toLowerCase()}.`,
            properties: {
                damage: isLong ? '1d8' : '1d6',
                damageType: 'piercing',
                range: isLong ? '150/600' : '80/320',
                ammunition: true
            }
        };
    }

    if (name.includes('crossbow')) {
        const isHand = name.includes('hand');
        const isHeavy = name.includes('heavy');
        return {
            type: 'weapon',
            weight: isHand ? 3 : (isHeavy ? 18 : 5),
            value: isHand ? 75 : (isHeavy ? 50 : 25),
            description: `A ${itemName.toLowerCase()}.`,
            properties: {
                damage: isHand ? '1d6' : (isHeavy ? '1d10' : '1d8'),
                damageType: 'piercing',
                ammunition: true,
                loading: true
            }
        };
    }

    if (name.includes('dagger')) {
        return {
            type: 'weapon',
            weight: 1,
            value: 2,
            description: 'A simple dagger.',
            properties: {
                damage: '1d4',
                damageType: 'piercing',
                finesse: true,
                light: true,
                thrown: '20/60'
            }
        };
    }

    if (name.includes('quarterstaff') || name.includes('staff')) {
        return {
            type: 'weapon',
            weight: 4,
            value: 2,
            description: 'A wooden staff.',
            properties: {
                damage: '1d6',
                damageType: 'bludgeoning',
                versatile: '1d8'
            }
        };
    }

    if (name.includes('mace')) {
        return {
            type: 'weapon',
            weight: 4,
            value: 5,
            description: 'A metal mace.',
            properties: {
                damage: '1d6',
                damageType: 'bludgeoning'
            }
        };
    }

    if (name.includes('javelin')) {
        return {
            type: 'weapon',
            weight: 2,
            value: 0.5,
            description: 'A throwing javelin.',
            properties: {
                damage: '1d6',
                damageType: 'piercing',
                thrown: '30/120'
            }
        };
    }

    if (name.includes('handaxe')) {
        return {
            type: 'weapon',
            weight: 2,
            value: 5,
            description: 'A small throwing axe.',
            properties: {
                damage: '1d6',
                damageType: 'slashing',
                light: true,
                thrown: '20/60'
            }
        };
    }

    if (name.includes('rapier')) {
        return {
            type: 'weapon',
            weight: 2,
            value: 25,
            description: 'A slender thrusting sword.',
            properties: {
                damage: '1d8',
                damageType: 'piercing',
                finesse: true
            }
        };
    }

    if (name.includes('scimitar')) {
        return {
            type: 'weapon',
            weight: 3,
            value: 25,
            description: 'A curved slashing blade.',
            properties: {
                damage: '1d6',
                damageType: 'slashing',
                finesse: true,
                light: true
            }
        };
    }

    if (name.includes('shortbow')) {
        return {
            type: 'weapon',
            weight: 2,
            value: 25,
            description: 'A compact bow.',
            properties: {
                damage: '1d6',
                damageType: 'piercing',
                range: '80/320',
                ammunition: true
            }
        };
    }

    // Armor
    if (name.includes('chain mail') || name.includes('chainmail')) {
        return {
            type: 'armor',
            weight: 55,
            value: 75,
            description: 'Heavy armor made of interlocking metal rings.',
            properties: { ac: 16, stealthDisadvantage: true, strengthRequired: 13 }
        };
    }

    if (name.includes('scale mail')) {
        return {
            type: 'armor',
            weight: 45,
            value: 50,
            description: 'Medium armor of overlapping metal scales.',
            properties: { ac: 14, maxDexBonus: 2, stealthDisadvantage: true }
        };
    }

    if (name.includes('leather armor') || name === 'leather') {
        return {
            type: 'armor',
            weight: 10,
            value: 10,
            description: 'Light armor made of cured leather.',
            properties: { ac: 11 }
        };
    }

    if (name.includes('studded leather')) {
        return {
            type: 'armor',
            weight: 13,
            value: 45,
            description: 'Leather armor reinforced with metal studs.',
            properties: { ac: 12 }
        };
    }

    if (name.includes('hide armor') || name === 'hide') {
        return {
            type: 'armor',
            weight: 12,
            value: 10,
            description: 'Medium armor made of thick animal hides.',
            properties: { ac: 12, maxDexBonus: 2 }
        };
    }

    if (name.includes('shield')) {
        return {
            type: 'armor',
            weight: 6,
            value: 10,
            description: 'A wooden or metal shield.',
            properties: { acBonus: 2 }
        };
    }

    // Equipment Packs
    if (name.includes('pack')) {
        const packItems = getPackContents(name);
        return {
            type: 'misc',
            weight: 30,
            value: 10,
            description: `An adventuring pack containing: ${packItems.join(', ')}.`,
            properties: { contains: packItems }
        };
    }

    // Focus items
    if (name.includes('arcane focus') || name.includes('component pouch')) {
        return {
            type: 'misc',
            weight: 1,
            value: 10,
            description: 'A spellcasting focus or component pouch.',
            properties: { spellcastingFocus: true }
        };
    }

    if (name.includes('holy symbol')) {
        return {
            type: 'misc',
            weight: 1,
            value: 5,
            description: 'A divine spellcasting focus.',
            properties: { spellcastingFocus: true, divine: true }
        };
    }

    if (name.includes('druidic focus')) {
        return {
            type: 'misc',
            weight: 1,
            value: 5,
            description: 'A natural spellcasting focus.',
            properties: { spellcastingFocus: true, druidic: true }
        };
    }

    if (name.includes('spellbook')) {
        return {
            type: 'misc',
            weight: 3,
            value: 50,
            description: 'A wizard\'s spellbook for recording spells.',
            properties: { spellbook: true }
        };
    }

    // Musical instruments
    if (name.includes('lute') || name.includes('drum') || name.includes('flute') || 
        name.includes('horn') || name.includes('instrument')) {
        return {
            type: 'misc',
            weight: 2,
            value: 30,
            description: 'A musical instrument.',
            properties: { instrument: true, bardFocus: true }
        };
    }

    // Thieves' tools
    if (name.includes("thieves' tools") || name.includes('thieves tools')) {
        return {
            type: 'misc',
            weight: 1,
            value: 25,
            description: 'A set of lockpicks and tools for disabling traps.',
            properties: { proficiencyRequired: true }
        };
    }

    // Ammunition
    if (name.includes('arrow')) {
        const match = name.match(/(\d+)/);
        const count = match ? parseInt(match[1]) : 20;
        return {
            type: 'misc',
            weight: 1,
            value: 1,
            description: `A quiver of ${count} arrows.`,
            properties: { ammunition: true, count }
        };
    }

    if (name.includes('bolt')) {
        const match = name.match(/(\d+)/);
        const count = match ? parseInt(match[1]) : 20;
        return {
            type: 'misc',
            weight: 1.5,
            value: 1,
            description: `A case of ${count} crossbow bolts.`,
            properties: { ammunition: true, count }
        };
    }

    // Consumables
    if (name.includes('potion')) {
        return {
            type: 'consumable',
            weight: 0.5,
            value: 50,
            description: 'A magical potion.',
            properties: {}
        };
    }

    if (name.includes('rations')) {
        return {
            type: 'consumable',
            weight: 2,
            value: 0.5,
            description: 'A day\'s worth of travel rations.',
            properties: {}
        };
    }

    // Default for unknown items
    return {
        type: 'misc',
        weight: 1,
        value: 1,
        description: `A ${itemName.toLowerCase()}.`,
        properties: {}
    };
}

/**
 * Get contents of equipment packs
 */
function getPackContents(packName: string): string[] {
    const name = packName.toLowerCase();
    
    if (name.includes('explorer')) {
        return EquipmentPacks.explorersPack;
    }
    if (name.includes('dungeoneer')) {
        return EquipmentPacks.dungeoneersPack;
    }
    if (name.includes('priest')) {
        return EquipmentPacks.priestsPack;
    }
    if (name.includes('scholar')) {
        return EquipmentPacks.scholarsPack;
    }
    if (name.includes('burglar')) {
        return EquipmentPacks.burglarsPack;
    }
    if (name.includes('diplomat')) {
        return EquipmentPacks.diplomatsPack;
    }
    if (name.includes('entertainer')) {
        return EquipmentPacks.entertainersPack;
    }

    // Default pack contents
    return ['Backpack', 'Bedroll', 'Rations (5 days)', 'Waterskin', 'Torch'];
}

/**
 * Get the spellcasting ability modifier for spell save DC and attack bonus calculation
 */
export function getSpellcastingAbility(className: string): 'int' | 'wis' | 'cha' | null {
    const normalized = normalizeClassName(className);
    const classData = CLASS_DATA[normalized];
    
    if (!classData?.spellcastingAbility) return null;
    
    return classData.spellcastingAbility as 'int' | 'wis' | 'cha';
}

/**
 * Calculate spell save DC
 */
export function calculateSpellSaveDC(
    proficiencyBonus: number,
    abilityModifier: number
): number {
    return 8 + proficiencyBonus + abilityModifier;
}

/**
 * Calculate spell attack bonus
 */
export function calculateSpellAttackBonus(
    proficiencyBonus: number,
    abilityModifier: number
): number {
    return proficiencyBonus + abilityModifier;
}
