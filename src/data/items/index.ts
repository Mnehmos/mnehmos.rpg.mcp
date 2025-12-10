/**
 * Item Preset Registry
 *
 * Aggregates all item preset sources into a unified, searchable database.
 * Easy to extend - just import new sources and add to SOURCES array.
 *
 * Usage:
 *   getItemPreset('longsword')           -> WeaponPreset
 *   getItemPreset('+1 longsword')        -> MagicItemPreset
 *   searchItems({ type: 'weapon', properties: ['finesse'] })
 *   listItemsByType('armor')
 */

import type {
    ItemPreset,
    PresetSource,
    ItemSearchCriteria,
    SearchResult,
    ItemType,
    WeaponPreset,
    ArmorPreset,
    GearPreset,
    MagicItemPreset
} from './types.js';

// Import all preset sources
import { WeaponsPHB } from './weapons-phb.js';
import { ArmorPHB } from './armor-phb.js';
import { gearPhb } from './gear-phb.js';
import { magicCommonSource } from './magic-common.js';

// Re-export types for convenience
export * from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All registered preset sources.
 * To add a new source, import it and add to this array.
 */
const SOURCES: PresetSource[] = [
    WeaponsPHB,
    ArmorPHB,
    gearPhb,
    magicCommonSource,
    // Future sources:
    // WeaponsXGE,
    // MagicItemsRare,
    // GearTCE,
];

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED PRESET DATABASE
// ═══════════════════════════════════════════════════════════════════════════

/** Unified map of all presets from all sources */
const ALL_PRESETS: Map<string, ItemPreset> = new Map();

/** Index by item type for fast filtering */
const TYPE_INDEX: Map<ItemType, Set<string>> = new Map();

/** Index by tags for semantic search */
const TAG_INDEX: Map<string, Set<string>> = new Map();

/** Track which source each preset came from */
const SOURCE_MAP: Map<string, string> = new Map();

/**
 * Initialize the registry by loading all sources
 */
function initializeRegistry(): void {
    if (ALL_PRESETS.size > 0) return; // Already initialized

    for (const source of SOURCES) {
        for (const [key, preset] of Object.entries(source.presets)) {
            const normalizedKey = normalizeKey(key);

            // Store preset
            ALL_PRESETS.set(normalizedKey, preset);
            SOURCE_MAP.set(normalizedKey, source.id);

            // Index by type
            const typeSet = TYPE_INDEX.get(preset.type as ItemType) || new Set();
            typeSet.add(normalizedKey);
            TYPE_INDEX.set(preset.type as ItemType, typeSet);

            // Index by tags
            const tags = (preset as any).tags || [];
            for (const tag of tags) {
                const tagSet = TAG_INDEX.get(tag.toLowerCase()) || new Set();
                tagSet.add(normalizedKey);
                TAG_INDEX.set(tag.toLowerCase(), tagSet);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// KEY NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize an item name for lookup.
 * "Longsword" -> "longsword"
 * "+1 Longsword" -> "+1_longsword"
 * "Studded Leather" -> "studded_leather"
 */
export function normalizeKey(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/['']/g, '')           // Remove apostrophes
        .replace(/\s+/g, '_')           // Spaces to underscores
        .replace(/[^a-z0-9_+\-]/g, ''); // Keep only alphanumeric, _, +, -
}

/**
 * Generate aliases for common variations
 */
function generateAliases(key: string): string[] {
    const aliases: string[] = [key];

    // "studded_leather" -> "studded_leather_armor"
    if (!key.includes('armor') && !key.includes('weapon') && !key.includes('shield')) {
        aliases.push(`${key}_armor`);
        aliases.push(`${key}_weapon`);
    }

    // "+1_longsword" -> "plus_1_longsword", "longsword_+1"
    if (key.startsWith('+')) {
        aliases.push(key.replace('+', 'plus_'));
        const match = key.match(/^\+(\d+)_(.+)$/);
        if (match) {
            aliases.push(`${match[2]}_+${match[1]}`);
            aliases.push(`${match[2]}_plus_${match[1]}`);
        }
    }

    return aliases;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get an item preset by name (case-insensitive, flexible matching)
 */
export function getItemPreset(name: string): ItemPreset | null {
    initializeRegistry();

    const normalized = normalizeKey(name);

    // Direct lookup
    if (ALL_PRESETS.has(normalized)) {
        return ALL_PRESETS.get(normalized)!;
    }

    // Try aliases
    for (const alias of generateAliases(normalized)) {
        if (ALL_PRESETS.has(alias)) {
            return ALL_PRESETS.get(alias)!;
        }
    }

    // Fuzzy match - find closest
    const fuzzyMatch = findFuzzyMatch(normalized);
    if (fuzzyMatch) {
        return ALL_PRESETS.get(fuzzyMatch)!;
    }

    return null;
}

/**
 * Get a weapon preset by name
 */
export function getWeaponPreset(name: string): WeaponPreset | null {
    const preset = getItemPreset(name);
    return preset?.type === 'weapon' ? preset as WeaponPreset : null;
}

/**
 * Get an armor preset by name
 */
export function getArmorPreset(name: string): ArmorPreset | null {
    const preset = getItemPreset(name);
    return preset?.type === 'armor' ? preset as ArmorPreset : null;
}

/**
 * Get a gear preset by name
 */
export function getGearPreset(name: string): GearPreset | null {
    const preset = getItemPreset(name);
    return (preset?.type === 'gear' || preset?.type === 'tool' || preset?.type === 'consumable')
        ? preset as GearPreset : null;
}

/**
 * Get a magic item preset by name
 */
export function getMagicItemPreset(name: string): MagicItemPreset | null {
    const preset = getItemPreset(name);
    return preset?.type === 'magic' ? preset as MagicItemPreset : null;
}

/**
 * Check if a preset exists
 */
export function hasItemPreset(name: string): boolean {
    return getItemPreset(name) !== null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH & FILTER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search items with flexible criteria
 */
export function searchItems(criteria: ItemSearchCriteria): SearchResult[] {
    initializeRegistry();

    const results: SearchResult[] = [];
    let candidateKeys: Set<string> | null = null;

    // Use type index if filtering by type
    if (criteria.type) {
        const types = Array.isArray(criteria.type) ? criteria.type : [criteria.type];
        candidateKeys = new Set();
        for (const type of types) {
            const typeKeys = TYPE_INDEX.get(type);
            if (typeKeys) {
                Array.from(typeKeys).forEach(key => candidateKeys!.add(key));
            }
        }
    }

    // Use tag index if filtering by tags
    if (criteria.tags && criteria.tags.length > 0) {
        const tagCandidates = new Set<string>();
        for (const tag of criteria.tags) {
            const tagKeys = TAG_INDEX.get(tag.toLowerCase());
            if (tagKeys) {
                Array.from(tagKeys).forEach(key => tagCandidates.add(key));
            }
        }
        if (candidateKeys) {
            // Intersect with type candidates
            candidateKeys = new Set(Array.from(candidateKeys).filter(k => tagCandidates.has(k)));
        } else {
            candidateKeys = tagCandidates;
        }
    }

    // Default to all items if no index filters
    const keysToSearch = candidateKeys ? Array.from(candidateKeys) : Array.from(ALL_PRESETS.keys());

    for (const key of keysToSearch) {
        const preset = ALL_PRESETS.get(key)!;
        const matchResult = matchesCriteria(key, preset, criteria);

        if (matchResult.matches) {
            results.push({
                key,
                preset,
                score: matchResult.score,
                matchedFields: matchResult.matchedFields
            });
        }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results;
}

/**
 * List all items of a specific type
 */
export function listItemsByType(type: ItemType): ItemPreset[] {
    initializeRegistry();

    const keys = TYPE_INDEX.get(type);
    if (!keys) return [];

    return Array.from(keys).map(key => ALL_PRESETS.get(key)!);
}

/**
 * List all items with a specific tag
 */
export function listItemsByTag(tag: string): ItemPreset[] {
    initializeRegistry();

    const keys = TAG_INDEX.get(tag.toLowerCase());
    if (!keys) return [];

    return Array.from(keys).map(key => ALL_PRESETS.get(key)!);
}

/**
 * List all available item keys
 */
export function listAllItemKeys(): string[] {
    initializeRegistry();
    return Array.from(ALL_PRESETS.keys());
}

/**
 * List all available tags
 */
export function listAllTags(): string[] {
    initializeRegistry();
    return Array.from(TAG_INDEX.keys()).sort();
}

/**
 * Get statistics about the registry
 */
export function getRegistryStats(): {
    totalItems: number;
    byType: Record<string, number>;
    sources: string[];
} {
    initializeRegistry();

    const byType: Record<string, number> = {};
    Array.from(TYPE_INDEX.entries()).forEach(([type, keys]) => {
        byType[type] = keys.size;
    });

    return {
        totalItems: ALL_PRESETS.size,
        byType,
        sources: SOURCES.map(s => s.id)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find the closest fuzzy match for a key
 */
function findFuzzyMatch(searchKey: string): string | null {
    let bestMatch: string | null = null;
    let bestScore = 0;

    Array.from(ALL_PRESETS.keys()).forEach(key => {
        const score = fuzzyScore(searchKey, key);
        if (score > bestScore && score > 0.6) { // Threshold
            bestScore = score;
            bestMatch = key;
        }
    });

    return bestMatch;
}

/**
 * Calculate fuzzy match score between two strings (0-1)
 */
function fuzzyScore(search: string, target: string): number {
    if (search === target) return 1;
    if (target.includes(search)) return 0.9;
    if (search.includes(target)) return 0.8;

    // Levenshtein-like scoring
    const searchParts = search.split('_');
    const targetParts = target.split('_');

    let matchedParts = 0;
    for (const sp of searchParts) {
        if (targetParts.some(tp => tp.includes(sp) || sp.includes(tp))) {
            matchedParts++;
        }
    }

    return matchedParts / Math.max(searchParts.length, targetParts.length);
}

/**
 * Check if a preset matches search criteria
 */
function matchesCriteria(
    key: string,
    preset: ItemPreset,
    criteria: ItemSearchCriteria
): { matches: boolean; score: number; matchedFields: string[] } {
    const matchedFields: string[] = [];
    let score = 1;

    // Text query search
    if (criteria.query) {
        const query = criteria.query.toLowerCase();
        const name = preset.name.toLowerCase();
        const description = ((preset as any).description || '').toLowerCase();

        if (name.includes(query)) {
            matchedFields.push('name');
            score += 0.5;
        } else if (description.includes(query)) {
            matchedFields.push('description');
            score += 0.3;
        } else if (key.includes(normalizeKey(query))) {
            matchedFields.push('key');
            score += 0.2;
        } else {
            return { matches: false, score: 0, matchedFields: [] };
        }
    }

    // Category filter (for weapons/armor)
    if (criteria.category) {
        const category = (preset as any).category;
        if (category !== criteria.category) {
            return { matches: false, score: 0, matchedFields: [] };
        }
        matchedFields.push('category');
    }

    // Rarity filter (for magic items)
    if (criteria.rarity) {
        const rarity = (preset as any).rarity;
        const rarities = Array.isArray(criteria.rarity) ? criteria.rarity : [criteria.rarity];
        if (!rarities.includes(rarity)) {
            return { matches: false, score: 0, matchedFields: [] };
        }
        matchedFields.push('rarity');
    }

    // Value filters
    if (criteria.minValue !== undefined) {
        const value = (preset as any).value || 0;
        if (value < criteria.minValue) {
            return { matches: false, score: 0, matchedFields: [] };
        }
    }
    if (criteria.maxValue !== undefined) {
        const value = (preset as any).value || 0;
        if (value > criteria.maxValue) {
            return { matches: false, score: 0, matchedFields: [] };
        }
    }

    // Weight filters
    if (criteria.minWeight !== undefined) {
        const weight = (preset as any).weight || 0;
        if (weight < criteria.minWeight) {
            return { matches: false, score: 0, matchedFields: [] };
        }
    }
    if (criteria.maxWeight !== undefined) {
        const weight = (preset as any).weight || 0;
        if (weight > criteria.maxWeight) {
            return { matches: false, score: 0, matchedFields: [] };
        }
    }

    // Properties filter (must have ALL)
    if (criteria.properties && criteria.properties.length > 0) {
        const itemProps = (preset as any).properties || [];
        const hasAll = criteria.properties.every(p =>
            itemProps.includes(p) || itemProps.includes(p.toLowerCase())
        );
        if (!hasAll) {
            return { matches: false, score: 0, matchedFields: [] };
        }
        matchedFields.push('properties');
    }

    // Source filter
    if (criteria.source) {
        const source = (preset as any).source;
        if (source !== criteria.source) {
            return { matches: false, score: 0, matchedFields: [] };
        }
        matchedFields.push('source');
    }

    // Attunement filter
    if (criteria.requiresAttunement !== undefined) {
        const attunement = (preset as any).requiresAttunement;
        const requiresIt = attunement === true || typeof attunement === 'string';
        if (requiresIt !== criteria.requiresAttunement) {
            return { matches: false, score: 0, matchedFields: [] };
        }
        matchedFields.push('attunement');
    }

    return { matches: true, score, matchedFields };
}

// Initialize on first import
initializeRegistry();
