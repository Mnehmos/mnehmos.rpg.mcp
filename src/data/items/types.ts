/**
 * Item Preset Type Definitions
 *
 * Shared types for the modular item preset system.
 * All preset files should import from here for consistency.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CORE ITEM TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ItemType = 'weapon' | 'armor' | 'consumable' | 'gear' | 'tool' | 'magic' | 'misc' | 'scroll';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary' | 'artifact';
export type DamageType = 'slashing' | 'piercing' | 'bludgeoning' | 'fire' | 'cold' | 'lightning' |
                         'thunder' | 'acid' | 'poison' | 'necrotic' | 'radiant' | 'force' | 'psychic';

// ═══════════════════════════════════════════════════════════════════════════
// WEAPON TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type WeaponCategory = 'simple_melee' | 'simple_ranged' | 'martial_melee' | 'martial_ranged';
export type WeaponProperty =
    | 'ammunition'
    | 'finesse'
    | 'heavy'
    | 'light'
    | 'loading'
    | 'range'
    | 'reach'
    | 'special'
    | 'thrown'
    | 'two_handed'
    | 'versatile'
    | 'monk'
    | 'silvered';

export interface WeaponPreset {
    name: string;
    type: 'weapon';
    category: WeaponCategory;
    damage: string;           // e.g., "1d8", "2d6"
    damageType: DamageType;
    properties: WeaponProperty[];
    weight: number;           // in pounds
    value: number;            // in gold pieces
    range?: { normal: number; long: number };  // for ranged/thrown
    versatileDamage?: string; // e.g., "1d10" when used two-handed
    description?: string;

    // Metadata for search
    tags?: string[];
    source?: string;          // "PHB", "DMG", "XGE", etc.
}

// ═══════════════════════════════════════════════════════════════════════════
// ARMOR TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ArmorCategory = 'light' | 'medium' | 'heavy' | 'shield';

export interface ArmorPreset {
    name: string;
    type: 'armor';
    category: ArmorCategory;
    ac: number;               // Base AC or AC bonus for shields
    maxDexBonus?: number;     // Max DEX modifier (undefined = unlimited)
    minStrength?: number;     // Strength requirement
    stealthDisadvantage?: boolean;
    weight: number;
    value: number;
    donTime?: string;         // e.g., "1 minute", "10 minutes"
    doffTime?: string;
    description?: string;

    tags?: string[];
    source?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADVENTURING GEAR
// ═══════════════════════════════════════════════════════════════════════════

export interface GearPreset {
    name: string;
    type: 'gear' | 'tool' | 'consumable';
    subtype?: string;         // "container", "light", "kit", "instrument", etc.
    weight: number;
    value: number;
    description?: string;
    capacity?: number;        // For containers (in pounds or items)
    uses?: number;            // For consumables
    effect?: string;          // What happens when used

    tags?: string[];
    source?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAGIC ITEMS
// ═══════════════════════════════════════════════════════════════════════════

export interface MagicItemPreset {
    name: string;
    type: 'magic';
    baseItem?: string;        // e.g., "longsword" for a +1 Longsword
    rarity: Rarity;
    requiresAttunement?: boolean | string;  // true, false, or "by a cleric"
    charges?: { max: number; recharge?: string };

    // Bonuses
    attackBonus?: number;
    damageBonus?: number;
    acBonus?: number;
    saveDCBonus?: number;

    // Special properties
    properties?: string[];
    effects?: string[];       // Active effects/abilities
    cursed?: boolean;

    weight?: number;
    value?: number;           // If sellable
    description: string;

    tags?: string[];
    source?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED ITEM TYPE
// ═══════════════════════════════════════════════════════════════════════════

export type ItemPreset = WeaponPreset | ArmorPreset | GearPreset | MagicItemPreset;

// ═══════════════════════════════════════════════════════════════════════════
// PRESET SOURCE MODULE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Interface for preset source modules.
 * Each file (weapons-phb.ts, armor-phb.ts, etc.) exports this shape.
 */
export interface PresetSource {
    /** Unique identifier for this source */
    id: string;

    /** Human-readable name */
    name: string;

    /** Source book abbreviation */
    source: string;

    /** Version for cache invalidation */
    version: string;

    /** The presets from this source, keyed by normalized name */
    presets: Record<string, ItemPreset>;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH & FILTER TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ItemSearchCriteria {
    query?: string;           // Fuzzy text search on name/description
    type?: ItemType | ItemType[];
    category?: string;        // WeaponCategory, ArmorCategory, etc.
    rarity?: Rarity | Rarity[];
    minValue?: number;
    maxValue?: number;
    minWeight?: number;
    maxWeight?: number;
    properties?: string[];    // Must have ALL these properties
    tags?: string[];          // Must have ANY of these tags
    source?: string;          // Filter by source book
    requiresAttunement?: boolean;
}

export interface SearchResult {
    key: string;              // Normalized lookup key
    preset: ItemPreset;
    score: number;            // Relevance score (0-1)
    matchedFields: string[];  // Which fields matched
}
