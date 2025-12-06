/**
 * Combat Visualization Schema
 *
 * Defines data structures for rendering combat state visually.
 * Supports both ASCII grid rendering and frontend JSON consumption.
 *
 * Key Features:
 * - Grid-based position display
 * - Token visualization with size footprints
 * - Terrain and obstacle rendering
 * - AoE shape visualization (circle, cone, line)
 * - Movement path display
 * - Combat log entries
 *
 * @module schema/combat-visualization
 */

import { z } from 'zod';
import { PositionSchema, SizeCategorySchema, GridBoundsSchema } from './encounter.js';

// ============================================================
// TOKEN VISUALIZATION
// ============================================================

/**
 * Token display state for visualization
 */
export const TokenDisplaySchema = z.object({
    id: z.string(),
    name: z.string(),
    label: z.string().max(2).describe('Short label for grid display (e.g., "G1" for Goblin 1)'),

    // Position and size
    position: PositionSchema.optional(),
    size: SizeCategorySchema,
    footprint: z.number().int().min(1).max(4).describe('Grid squares per side (1=medium, 2=large, 3=huge, 4=gargantuan)'),

    // Visual indicators
    isEnemy: z.boolean(),
    isCurrentTurn: z.boolean(),
    isDefeated: z.boolean(),

    // Health display
    hp: z.number(),
    maxHp: z.number(),
    hpPercentage: z.number().min(0).max(100),
    hpStatus: z.enum(['healthy', 'wounded', 'bloodied', 'critical', 'defeated']),

    // Combat stats
    initiative: z.number(),
    conditions: z.array(z.string()),
    ac: z.number().optional(),

    // Movement (for current turn display)
    movementSpeed: z.number().optional(),
    movementRemaining: z.number().optional(),
    hasDashed: z.boolean().optional()
});

export type TokenDisplay = z.infer<typeof TokenDisplaySchema>;

// ============================================================
// TERRAIN VISUALIZATION
// ============================================================

/**
 * Terrain tile for visualization
 */
export const TerrainTileSchema = z.object({
    x: z.number(),
    y: z.number(),
    type: z.enum(['obstacle', 'difficult', 'water', 'pit', 'lava', 'cover_half', 'cover_three_quarter']),
    symbol: z.string().max(1).describe('ASCII symbol for grid (e.g., "#" for wall, "~" for water)')
});

export type TerrainTile = z.infer<typeof TerrainTileSchema>;

/**
 * Terrain layer for visualization
 */
export const TerrainLayerSchema = z.object({
    obstacles: z.array(TerrainTileSchema),
    difficultTerrain: z.array(TerrainTileSchema).default([])
});

export type TerrainLayer = z.infer<typeof TerrainLayerSchema>;

// ============================================================
// AOE VISUALIZATION
// ============================================================

/**
 * AoE shape types
 */
export const AoEShapeSchema = z.enum(['circle', 'cone', 'line', 'cube', 'sphere', 'cylinder']);

export type AoEShape = z.infer<typeof AoEShapeSchema>;

/**
 * AoE visualization data
 */
export const AoEDisplaySchema = z.object({
    id: z.string(),
    shape: AoEShapeSchema,
    origin: PositionSchema,

    // Shape parameters
    radiusFeet: z.number().optional().describe('For circle/sphere'),
    lengthFeet: z.number().optional().describe('For line/cone'),
    widthFeet: z.number().optional().describe('For line'),
    angleDegrees: z.number().optional().describe('For cone (typically 53 degrees in D&D)'),
    direction: z.object({ x: z.number(), y: z.number() }).optional().describe('Direction vector for cone/line'),

    // Computed tiles
    affectedTiles: z.array(PositionSchema),
    blockedTiles: z.array(PositionSchema).optional().describe('Tiles blocked by LOS'),

    // Affected participants
    affectedParticipantIds: z.array(z.string()),

    // Visual properties
    color: z.string().optional().describe('Hex color for frontend'),
    symbol: z.string().max(1).default('*').describe('ASCII symbol for affected tiles'),
    name: z.string().optional().describe('Spell/effect name')
});

export type AoEDisplay = z.infer<typeof AoEDisplaySchema>;

// ============================================================
// MOVEMENT PATH VISUALIZATION
// ============================================================

/**
 * Movement path segment
 */
export const PathSegmentSchema = z.object({
    from: PositionSchema,
    to: PositionSchema,
    cost: z.number().describe('Movement cost in feet'),
    isDiagonal: z.boolean(),
    isDifficultTerrain: z.boolean()
});

export type PathSegment = z.infer<typeof PathSegmentSchema>;

/**
 * Full movement path visualization
 */
export const MovementPathSchema = z.object({
    participantId: z.string(),
    path: z.array(PositionSchema),
    segments: z.array(PathSegmentSchema),
    totalCost: z.number().describe('Total movement in feet'),
    remainingMovement: z.number().describe('Movement remaining after path'),
    triggersOpportunityAttacks: z.array(z.string()).default([]).describe('IDs of threatening participants'),
    isValid: z.boolean()
});

export type MovementPath = z.infer<typeof MovementPathSchema>;

// ============================================================
// COMBAT LOG
// ============================================================

/**
 * Combat log entry types
 */
export const CombatLogTypeSchema = z.enum([
    'round_start',
    'turn_start',
    'turn_end',
    'attack',
    'damage',
    'healing',
    'spell_cast',
    'movement',
    'condition_applied',
    'condition_removed',
    'death',
    'opportunity_attack',
    'saving_throw',
    'lair_action'
]);

export type CombatLogType = z.infer<typeof CombatLogTypeSchema>;

/**
 * Combat log entry
 */
export const CombatLogEntrySchema = z.object({
    id: z.string(),
    timestamp: z.string().datetime(),
    round: z.number(),
    type: CombatLogTypeSchema,

    // Actor and target
    actorId: z.string().optional(),
    actorName: z.string().optional(),
    targetId: z.string().optional(),
    targetName: z.string().optional(),

    // Action details
    action: z.string().describe('Human-readable action description'),
    details: z.record(z.any()).optional().describe('Structured action details'),

    // Results
    diceRoll: z.string().optional().describe('Dice expression and result'),
    damage: z.number().optional(),
    healing: z.number().optional(),
    success: z.boolean().optional()
});

export type CombatLogEntry = z.infer<typeof CombatLogEntrySchema>;

// ============================================================
// TURN ORDER DISPLAY
// ============================================================

/**
 * Turn order entry
 */
export const TurnOrderEntrySchema = z.object({
    id: z.string(),
    name: z.string(),
    initiative: z.number(),
    isEnemy: z.boolean(),
    isDefeated: z.boolean(),
    isCurrent: z.boolean(),
    isLairAction: z.boolean().default(false),
    hpPercentage: z.number().min(0).max(100)
});

export type TurnOrderEntry = z.infer<typeof TurnOrderEntrySchema>;

/**
 * Full turn order display
 */
export const TurnOrderDisplaySchema = z.object({
    round: z.number(),
    currentIndex: z.number(),
    entries: z.array(TurnOrderEntrySchema),
    isLairActionPending: z.boolean().default(false)
});

export type TurnOrderDisplay = z.infer<typeof TurnOrderDisplaySchema>;

// ============================================================
// GRID VISUALIZATION
// ============================================================

/**
 * Grid cell for visualization
 */
export const GridCellSchema = z.object({
    x: z.number(),
    y: z.number(),
    symbol: z.string().max(1).describe('Primary display character'),
    tokenId: z.string().optional().describe('Token occupying this cell'),
    tokenLabel: z.string().optional().describe('Short label if token present'),
    isObstacle: z.boolean().default(false),
    isDifficultTerrain: z.boolean().default(false),
    isInAoE: z.boolean().default(false),
    isInPath: z.boolean().default(false),
    isHighlighted: z.boolean().default(false),
    highlightColor: z.string().optional()
});

export type GridCell = z.infer<typeof GridCellSchema>;

/**
 * Complete grid state for ASCII rendering
 */
export const GridDisplaySchema = z.object({
    bounds: GridBoundsSchema,
    width: z.number(),
    height: z.number(),
    cells: z.array(z.array(GridCellSchema)).describe('2D array [y][x] of cells'),

    // Viewport for large grids (renders subset)
    viewport: z.object({
        minX: z.number(),
        maxX: z.number(),
        minY: z.number(),
        maxY: z.number()
    }).optional()
});

export type GridDisplay = z.infer<typeof GridDisplaySchema>;

// ============================================================
// COMPLETE COMBAT VISUALIZATION
// ============================================================

/**
 * Complete combat visualization state
 * This is the primary export for frontend consumption
 */
export const CombatVisualizationSchema = z.object({
    // Encounter metadata
    encounterId: z.string(),
    round: z.number(),
    status: z.enum(['active', 'completed', 'paused']),

    // Turn tracking
    turnOrder: TurnOrderDisplaySchema,

    // Spatial data
    gridBounds: GridBoundsSchema,
    grid: GridDisplaySchema.optional().describe('Computed grid for ASCII rendering'),

    // Participants
    tokens: z.array(TokenDisplaySchema),

    // Terrain
    terrain: TerrainLayerSchema.optional(),

    // Active effects
    activeAoEs: z.array(AoEDisplaySchema).default([]),
    activeMovementPath: MovementPathSchema.optional(),

    // Combat log (recent entries)
    recentLog: z.array(CombatLogEntrySchema).default([]),

    // Action guidance
    currentActorId: z.string().optional(),
    validTargets: z.array(z.object({
        id: z.string(),
        name: z.string(),
        isEnemy: z.boolean(),
        distance: z.number().optional()
    })).default([])
});

export type CombatVisualization = z.infer<typeof CombatVisualizationSchema>;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Determine HP status from percentage
 */
export function getHpStatus(hp: number, maxHp: number): TokenDisplay['hpStatus'] {
    if (hp <= 0) return 'defeated';
    const pct = (hp / maxHp) * 100;
    if (pct >= 75) return 'healthy';
    if (pct >= 50) return 'wounded';
    if (pct >= 25) return 'bloodied';
    return 'critical';
}

/**
 * Generate short label for token
 * Examples: "G1" for Goblin 1, "He" for Hero, "Dr" for Dragon
 */
export function generateTokenLabel(name: string, _index: number): string {
    // Check for existing number suffix
    const match = name.match(/^(.+?)\s*(\d+)$/);
    if (match) {
        // "Goblin 1" -> "G1"
        return match[1][0].toUpperCase() + match[2];
    }
    // No number -> first two letters: "Hero" -> "He"
    return name.substring(0, 2).toUpperCase();
}

/**
 * Get ASCII symbol for terrain type
 */
export function getTerrainSymbol(type: TerrainTile['type']): string {
    switch (type) {
        case 'obstacle': return '#';
        case 'difficult': return '~';
        case 'water': return '≈';
        case 'pit': return 'O';
        case 'lava': return '▓';
        case 'cover_half': return '░';
        case 'cover_three_quarter': return '▒';
        default: return '?';
    }
}

/**
 * Get ASCII symbol for token based on type
 */
export function getTokenSymbol(isEnemy: boolean, isDefeated: boolean): string {
    if (isDefeated) return 'X';
    return isEnemy ? 'E' : 'P';
}
