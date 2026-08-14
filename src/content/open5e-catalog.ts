import { readFileSync } from 'node:fs';
import { z } from 'zod';

const AbilityBonusesSchema = z.object({
    str: z.number().int(),
    dex: z.number().int(),
    con: z.number().int(),
    int: z.number().int(),
    wis: z.number().int(),
    cha: z.number().int(),
});

const ChoiceSchema = z.object({
    count: z.number().int().min(0),
    description: z.string().optional(),
    options: z.array(z.object({
        key: z.string(),
        name: z.string(),
    })).optional(),
}).nullable();

const ClassSchema = z.object({
    sourceKey: z.string(),
    contentKey: z.string(),
    name: z.string(),
    hitDie: z.number().int().positive(),
    savingThrows: z.array(z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha'])),
    armorProficiencies: z.array(z.string()),
    weaponProficiencies: z.array(z.string()),
    toolProficiencies: z.array(z.string()),
    toolChoice: ChoiceSchema,
    skillChoice: ChoiceSchema,
    levelOneFeatures: z.array(z.string()),
    startingEquipmentDescription: z.string(),
});

const SpeciesSchema = z.object({
    sourceKey: z.string(),
    contentKey: z.string(),
    name: z.string(),
    parent: z.unknown().nullable(),
    abilityBonuses: AbilityBonusesSchema,
    abilityChoice: z.unknown().nullable(),
    size: z.string(),
    speedFeet: z.number().int().positive(),
    languages: z.array(z.string()),
    languageChoiceCount: z.number().int().min(0),
    featureNames: z.array(z.string()),
});

const BackgroundSchema = z.object({
    sourceKey: z.string(),
    contentKey: z.string(),
    name: z.string(),
    skillProficiencies: z.array(z.string()),
    skillChoice: ChoiceSchema,
    fixedLanguages: z.array(z.string()),
    languageChoiceCount: z.number().int().min(0),
    toolProficiencies: z.array(z.string()),
    toolChoice: ChoiceSchema,
    startingCurrencyCopper: z.number().int().min(0),
    startingItemSourceKeys: z.array(z.string()),
    startingEquipmentDescription: z.string(),
});

const ItemTypeSchema = z.enum(['weapon', 'armor', 'consumable', 'quest', 'misc', 'scroll']);

const ItemSchema = z.object({
    sourceKey: z.string(),
    contentKey: z.string(),
    name: z.string(),
    description: z.string(),
    categoryKey: z.string(),
    categoryName: z.string(),
    type: ItemTypeSchema,
    weight: z.number().min(0),
    valueCopper: z.number().min(0),
    properties: z.record(z.unknown()),
});

const RuntimeCatalogSchema = z.object({
    schemaVersion: z.literal(1),
    provenance: z.object({
        provider: z.literal('Open5e'),
        sourceApiVersion: z.string(),
        sourceFetchedAt: z.string().datetime(),
        packVersion: z.string(),
        packHash: z.string().regex(/^[a-f0-9]{64}$/u),
        rulesVersion: z.string(),
        gamesystem: z.literal('5e-2014'),
        documents: z.array(z.string()),
        license: z.object({
            key: z.literal('cc-by-40'),
            name: z.string(),
            url: z.string().url(),
            source: z.string().url(),
            attribution: z.string(),
        }),
    }),
    classes: z.array(ClassSchema),
    species: z.array(SpeciesSchema),
    backgrounds: z.array(BackgroundSchema),
    skills: z.array(z.object({
        key: z.string(),
        name: z.string(),
        ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
    })),
    languages: z.array(z.object({
        key: z.string(),
        name: z.string(),
        isExotic: z.boolean(),
    })),
    alignments: z.array(z.object({
        key: z.string(),
        name: z.string(),
        shortName: z.string(),
    })),
    items: z.array(ItemSchema),
});

export type Open5eCatalog = z.infer<typeof RuntimeCatalogSchema>;
export type Open5eClass = z.infer<typeof ClassSchema>;
export type Open5eSpecies = z.infer<typeof SpeciesSchema>;
export type Open5eBackground = z.infer<typeof BackgroundSchema>;
export type Open5eItem = z.infer<typeof ItemSchema>;
export type Open5eItemType = z.infer<typeof ItemTypeSchema>;
export type CharacterOptionCategory = 'all' | 'classes' | 'species' | 'backgrounds' | 'skills' | 'languages' | 'alignments';

let catalogCache: Open5eCatalog | undefined;

function normalizedLookup(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^open5e:/u, '')
        .replace(/^srd[-_:]?2014[-_:]?/u, '')
        .replace(/^srd[-_:]?/u, '')
        .replace(/[^a-z0-9]+/gu, '');
}
function matchesRecord(record: { sourceKey: string; contentKey: string; name: string }, value: string): boolean {
    const normalized = normalizedLookup(value);
    return normalizedLookup(record.sourceKey) === normalized
        || normalizedLookup(record.contentKey) === normalized
        || normalizedLookup(record.name) === normalized;
}

export function getOpen5eCatalog(): Open5eCatalog {
    if (catalogCache) return catalogCache;

    const catalogUrl = new URL('../../config/open5e-srd-2014-runtime.json', import.meta.url);
    const parsed = JSON.parse(readFileSync(catalogUrl, 'utf8'));
    catalogCache = RuntimeCatalogSchema.parse(parsed);
    return catalogCache;
}

export function getOpen5eCatalogProvenance(): Open5eCatalog['provenance'] {
    return getOpen5eCatalog().provenance;
}

export function findOpen5eClass(value: string): Open5eClass | undefined {
    return getOpen5eCatalog().classes.find((record) => matchesRecord(record, value));
}

export function findOpen5eSpecies(value: string): Open5eSpecies | undefined {
    return getOpen5eCatalog().species.find((record) => matchesRecord(record, value));
}

export function findOpen5eBackground(value: string): Open5eBackground | undefined {
    return getOpen5eCatalog().backgrounds.find((record) => matchesRecord(record, value));
}

export function findOpen5eItem(value: string): Open5eItem | undefined {
    return getOpen5eCatalog().items.find((record) => matchesRecord(record, value));
}

export function searchOpen5eItems(options: {
    query?: string;
    type?: Open5eItemType;
    limit?: number;
} = {}): Open5eItem[] {
    const query = options.query?.trim().toLowerCase();
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

    return getOpen5eCatalog().items
        .filter((item) => !options.type || item.type === options.type)
        .filter((item) => !query
            || item.name.toLowerCase().includes(query)
            || item.sourceKey.toLowerCase().includes(query)
            || item.categoryName.toLowerCase().includes(query))
        .sort((left, right) => {
            if (!query) return left.name.localeCompare(right.name);
            const leftExact = left.name.toLowerCase() === query || left.sourceKey.toLowerCase() === query;
            const rightExact = right.name.toLowerCase() === query || right.sourceKey.toLowerCase() === query;
            if (leftExact !== rightExact) return leftExact ? -1 : 1;
            return left.name.localeCompare(right.name);
        })
        .slice(0, limit);
}

export function getOpen5eCharacterOptions(category: CharacterOptionCategory = 'all', query?: string): object {
    const catalog = getOpen5eCatalog();
    const normalizedQuery = query?.trim().toLowerCase();
    const filter = <T extends { name: string }>(records: T[]): T[] => normalizedQuery
        ? records.filter((record) => record.name.toLowerCase().includes(normalizedQuery))
        : records;
    const include = (name: Exclude<CharacterOptionCategory, 'all'>): boolean => category === 'all' || category === name;

    return {
        success: true,
        actionType: 'options',
        category,
        query: query ?? null,
        provenance: catalog.provenance,
        customOptionsSupported: true,
        ...(include('classes') ? { classes: filter(catalog.classes) } : {}),
        ...(include('species') ? { species: filter(catalog.species) } : {}),
        ...(include('backgrounds') ? { backgrounds: filter(catalog.backgrounds) } : {}),
        ...(include('skills') ? { skills: filter(catalog.skills) } : {}),
        ...(include('languages') ? { languages: filter(catalog.languages) } : {}),
        ...(include('alignments') ? { alignments: filter(catalog.alignments) } : {}),
    };
}
