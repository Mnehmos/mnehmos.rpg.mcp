/**
 * Base Schema Definitions - Reusable Zod field patterns
 *
 * This module provides centralized, reusable schema definitions for common
 * patterns across the RPG-MCP schema system. Using these reduces duplication,
 * ensures consistency, and makes it easier to update validation rules globally.
 *
 * USAGE:
 * ```typescript
 * import { IdField, TimestampFields, GridCoordinates } from './base-schemas.js';
 *
 * const MySchema = z.object({
 *   id: IdField,
 *   ...TimestampFields,
 *   position: GridCoordinates,
 * });
 * ```
 *
 * @module schema/base-schemas
 */

import { z } from 'zod';

// ============================================================================
// IDENTIFIERS
// ============================================================================

/**
 * Standard string ID field (for entities that use string IDs)
 */
export const IdField = z.string().min(1, 'ID cannot be empty');

/**
 * UUID field (for entities that use UUIDs)
 */
export const UuidField = z.string().uuid('Must be a valid UUID');

/**
 * World ID reference field
 */
export const WorldIdField = z.string().describe('World this entity belongs to');

/**
 * Region ID reference field (optional for entities that may not be region-linked)
 */
export const RegionIdField = z.string().optional().describe('Region containing this entity');

/**
 * Character ID reference field
 */
export const CharacterIdField = z.string().describe('Character ID reference');

// ============================================================================
// TIMESTAMPS
// ============================================================================

/**
 * ISO 8601 datetime field
 */
export const DateTimeField = z.string().datetime();

/**
 * Spread into object schemas that need createdAt/updatedAt
 *
 * @example
 * const MySchema = z.object({
 *   id: IdField,
 *   name: z.string(),
 *   ...TimestampFields
 * });
 */
export const TimestampFields = {
    createdAt: DateTimeField,
    updatedAt: DateTimeField,
} as const;

/**
 * Optional lastVisitedAt timestamp for trackable entities
 */
export const LastVisitedField = z.string().datetime().optional();

// ============================================================================
// COORDINATES & SPATIAL
// ============================================================================

/**
 * World grid X coordinate (0 to world width)
 */
export const GridXField = z.number().int().min(0).describe('World grid X coordinate');

/**
 * World grid Y coordinate (0 to world height)
 */
export const GridYField = z.number().int().min(0).describe('World grid Y coordinate');

/**
 * Standard 2D grid coordinates
 */
export const GridCoordinates = z.object({
    x: GridXField,
    y: GridYField,
});

/**
 * Combat/tactical position (allows floating point for precise positioning)
 */
export const TacticalPosition = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number().optional(),
});

export type TacticalPositionType = z.infer<typeof TacticalPosition>;

/**
 * Bounding box for spatial queries
 */
export const BoundingBox = z.object({
    minX: z.number().int().min(0),
    maxX: z.number().int().min(0),
    minY: z.number().int().min(0),
    maxY: z.number().int().min(0),
});

export type BoundingBoxType = z.infer<typeof BoundingBox>;

// ============================================================================
// NAMES & TEXT FIELDS
// ============================================================================

/**
 * Entity name field with validation
 */
export const NameField = z.string()
    .min(1, 'Name cannot be empty')
    .max(100, 'Name cannot exceed 100 characters')
    .refine(s => s.trim().length > 0, 'Name cannot be whitespace only');

/**
 * Short description field (for tooltips, summaries)
 */
export const ShortDescriptionField = z.string()
    .max(500, 'Description too long')
    .optional();

/**
 * Long description field (for detailed content)
 */
export const LongDescriptionField = z.string()
    .min(10, 'Description must be detailed')
    .max(2000, 'Description too long')
    .refine(s => s.trim().length >= 10, 'Description must have at least 10 non-whitespace characters');

// ============================================================================
// NUMERIC FIELDS
// ============================================================================

/**
 * Non-negative integer (0+)
 */
export const NonNegativeInt = z.number().int().min(0);

/**
 * Positive integer (1+)
 */
export const PositiveInt = z.number().int().min(1);

/**
 * Population field for settlements
 */
export const PopulationField = z.number().int().min(0).describe('Population count');

/**
 * Character level (1-20 for standard D&D)
 */
export const LevelField = z.number().int().min(1).max(20);

/**
 * Difficulty Class field (5-30 standard range)
 */
export const DCField = z.number().int().min(5).max(30);

/**
 * HP field (0+)
 */
export const HpField = z.number().int().min(0);

/**
 * AC field (0+)
 */
export const AcField = z.number().int().min(0);

/**
 * Percentage field (0-1 as decimal)
 */
export const PercentageField = z.number().min(0).max(1);

/**
 * Percentage field (0-100 as integer)
 */
export const PercentageInt = z.number().int().min(0).max(100);

// ============================================================================
// D&D ABILITY SCORES
// ============================================================================

/**
 * Single ability score (typically 1-30)
 */
export const AbilityScoreField = z.number().int().min(0).max(30);

/**
 * Standard D&D ability score object
 */
export const AbilityScores = z.object({
    str: AbilityScoreField,
    dex: AbilityScoreField,
    con: AbilityScoreField,
    int: AbilityScoreField,
    wis: AbilityScoreField,
    cha: AbilityScoreField,
});

export type AbilityScoresType = z.infer<typeof AbilityScores>;

/**
 * Save proficiency enum
 */
export const SaveProficiencyEnum = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);

/**
 * Skill proficiency enum
 */
export const SkillProficiencyEnum = z.enum([
    'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception',
    'history', 'insight', 'intimidation', 'investigation', 'medicine',
    'nature', 'perception', 'performance', 'persuasion', 'religion',
    'sleight_of_hand', 'stealth', 'survival'
]);

// ============================================================================
// SIZE CATEGORIES
// ============================================================================

/**
 * D&D 5e size categories
 */
export const SizeCategory = z.enum([
    'tiny',      // 2.5ft, shares space
    'small',     // 5ft, 1 square
    'medium',    // 5ft, 1 square
    'large',     // 10ft, 2x2 squares
    'huge',      // 15ft, 3x3 squares
    'gargantuan' // 20ft+, 4x4+ squares
]);

export type SizeCategoryType = z.infer<typeof SizeCategory>;

// ============================================================================
// DAMAGE & EFFECTS
// ============================================================================

/**
 * Standard damage types in D&D 5e
 */
export const DamageTypeEnum = z.enum([
    'slashing', 'piercing', 'bludgeoning',
    'fire', 'cold', 'lightning', 'thunder',
    'acid', 'poison', 'necrotic', 'radiant',
    'psychic', 'force'
]);

export type DamageType = z.infer<typeof DamageTypeEnum>;

/**
 * Array of damage types (for resistances, immunities, vulnerabilities)
 */
export const DamageTypeArray = z.array(DamageTypeEnum).default([]);

/**
 * Condition type enum
 */
export const ConditionTypeEnum = z.enum([
    'blinded', 'charmed', 'deafened', 'frightened',
    'grappled', 'incapacitated', 'invisible', 'paralyzed',
    'petrified', 'poisoned', 'prone', 'restrained',
    'stunned', 'unconscious', 'exhaustion'
]);

export type ConditionType = z.infer<typeof ConditionTypeEnum>;

// ============================================================================
// CURRENCY
// ============================================================================

/**
 * Standard D&D currency object
 */
export const CurrencyFields = z.object({
    gold: z.number().int().min(0).default(0),
    silver: z.number().int().min(0).default(0),
    copper: z.number().int().min(0).default(0),
}).default({});

export type CurrencyType = z.infer<typeof CurrencyFields>;

// ============================================================================
// COMBAT & ENCOUNTER
// ============================================================================

/**
 * Encounter status enum
 */
export const EncounterStatusEnum = z.enum(['active', 'completed', 'paused']);

/**
 * Movement speed field (in feet, default 30)
 */
export const MovementSpeedField = z.number().int().min(0).default(30);

/**
 * Initiative bonus field
 */
export const InitiativeBonusField = z.number().int();

// ============================================================================
// DISCOVERY & VISIBILITY
// ============================================================================

/**
 * Discovery state for POIs and secrets
 */
export const DiscoveryStateEnum = z.enum([
    'unknown',      // Not yet discovered
    'rumored',      // Heard about but not visited
    'discovered',   // Visited at least once
    'explored',     // Fully explored
    'mapped'        // Detailed notes created
]);

export type DiscoveryState = z.infer<typeof DiscoveryStateEnum>;

// ============================================================================
// EXIT & CONNECTION TYPES
// ============================================================================

/**
 * Cardinal and vertical directions
 */
export const DirectionEnum = z.enum([
    'north', 'south', 'east', 'west',
    'up', 'down',
    'northeast', 'northwest', 'southeast', 'southwest'
]);

export type Direction = z.infer<typeof DirectionEnum>;

/**
 * Exit/door types
 */
export const ExitTypeEnum = z.enum(['OPEN', 'LOCKED', 'HIDDEN']);

/**
 * Cover types for combat props
 */
export const CoverTypeEnum = z.enum(['none', 'half', 'three_quarter', 'full']);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a standard entity schema with ID and timestamps
 * @param fields - Additional fields for the entity
 * @returns Combined Zod object schema
 *
 * @example
 * const MyEntitySchema = createEntitySchema({
 *   name: NameField,
 *   value: NonNegativeInt,
 * });
 */
export function createEntitySchema<T extends z.ZodRawShape>(fields: T) {
    return z.object({
        id: IdField,
        ...fields,
        ...TimestampFields,
    });
}

/**
 * Create a standard entity schema with UUID and timestamps
 * @param fields - Additional fields for the entity
 * @returns Combined Zod object schema
 */
export function createUuidEntitySchema<T extends z.ZodRawShape>(fields: T) {
    return z.object({
        id: UuidField,
        ...fields,
        ...TimestampFields,
    });
}

/**
 * Create a world-linked entity schema with worldId, optional regionId, coordinates
 * @param fields - Additional fields for the entity
 * @returns Combined Zod object schema
 *
 * @example
 * const StructureSchema = createWorldEntitySchema({
 *   name: NameField,
 *   type: z.enum(['city', 'town', 'village']),
 *   population: PopulationField,
 * });
 */
export function createWorldEntitySchema<T extends z.ZodRawShape>(fields: T) {
    return z.object({
        id: IdField,
        worldId: WorldIdField,
        regionId: RegionIdField,
        x: GridXField,
        y: GridYField,
        ...fields,
        ...TimestampFields,
    });
}
