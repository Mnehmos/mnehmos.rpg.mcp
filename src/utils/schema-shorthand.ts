/**
 * Schema Shorthand Utilities
 *
 * TIER 2 Token Efficiency Optimization
 *
 * Provides parsing utilities for common input formats that reduce token overhead:
 * - Position: "10,5" or "10,5,0" -> { x: 10, y: 5, z: 0 }
 * - Damage: "2d6+3 fire" -> { dice: "2d6", modifier: 3, type: "fire" }
 * - Duration: "7d" / "3h" / "10r" -> { value: 7, unit: "days", rounds: 6720 }
 * - Range: "30/120" -> { normal: 30, long: 120 }
 * - Area: "20ft cone" -> { size: 20, shape: "cone" }
 */

// ═══════════════════════════════════════════════════════════════════════════
// POSITION PARSING
// ═══════════════════════════════════════════════════════════════════════════

export interface Position {
    x: number;
    y: number;
    z: number;
}

/**
 * Parse a position from various formats:
 * - String: "10,5" or "10,5,0"
 * - Object: { x: 10, y: 5 } or { x: 10, y: 5, z: 0 }
 *
 * @example
 * parsePosition("10,5")        // { x: 10, y: 5, z: 0 }
 * parsePosition("10,5,3")      // { x: 10, y: 5, z: 3 }
 * parsePosition({ x: 10, y: 5 }) // { x: 10, y: 5, z: 0 }
 */
export function parsePosition(input: string | { x: number; y: number; z?: number }): Position {
    if (typeof input === 'string') {
        const parts = input.split(',').map(s => parseInt(s.trim(), 10));
        return {
            x: parts[0] || 0,
            y: parts[1] || 0,
            z: parts[2] || 0
        };
    }
    return { x: input.x, y: input.y, z: input.z ?? 0 };
}

/**
 * Parse multiple positions from array of strings or objects
 */
export function parsePositions(inputs: (string | { x: number; y: number; z?: number })[]): Position[] {
    return inputs.map(parsePosition);
}

/**
 * Format a position back to shorthand string
 */
export function formatPosition(pos: Position, includeZ: boolean = false): string {
    if (includeZ || pos.z !== 0) {
        return `${pos.x},${pos.y},${pos.z}`;
    }
    return `${pos.x},${pos.y}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DAMAGE NOTATION PARSING
// ═══════════════════════════════════════════════════════════════════════════

export interface DamageNotation {
    dice: string;           // "2d6", "1d8", etc.
    count: number;          // Number of dice (2 in "2d6")
    sides: number;          // Sides per die (6 in "2d6")
    modifier: number;       // +/- modifier (3 in "2d6+3")
    type: string;           // Damage type ("fire", "slashing", etc.)
    average: number;        // Average damage for quick calculations
    min: number;            // Minimum damage
    max: number;            // Maximum damage
}

// Common D&D 5e damage types
const DAMAGE_TYPES = [
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
    'necrotic', 'piercing', 'poison', 'psychic', 'radiant',
    'slashing', 'thunder'
] as const;

/**
 * Parse damage notation from shorthand
 *
 * Supported formats:
 * - "2d6" -> 2d6 untyped damage
 * - "2d6+3" -> 2d6+3 untyped damage
 * - "2d6-2" -> 2d6-2 untyped damage
 * - "2d6 fire" -> 2d6 fire damage
 * - "2d6+3 fire" -> 2d6+3 fire damage
 * - "1d8+5 slashing" -> 1d8+5 slashing damage
 *
 * @example
 * parseDamage("2d6+3 fire")
 * // { dice: "2d6", count: 2, sides: 6, modifier: 3, type: "fire", average: 10, min: 5, max: 15 }
 */
export function parseDamage(input: string): DamageNotation | null {
    // Normalize input
    const normalized = input.toLowerCase().trim();

    // Match patterns:
    // Group 1: dice count (optional, default 1)
    // Group 2: dice sides
    // Group 3: modifier with sign (optional)
    // Group 4: damage type (optional)
    const regex = /^(\d*)d(\d+)([+-]\d+)?\s*(\w+)?$/;
    const match = normalized.match(regex);

    if (!match) {
        return null;
    }

    const count = match[1] ? parseInt(match[1], 10) : 1;
    const sides = parseInt(match[2], 10);
    const modifier = match[3] ? parseInt(match[3], 10) : 0;
    const typeRaw = match[4] || '';

    // Validate damage type if provided
    let type = 'untyped';
    if (typeRaw) {
        // Check for exact match or prefix match
        const matchedType = DAMAGE_TYPES.find(t =>
            t === typeRaw || t.startsWith(typeRaw)
        );
        type = matchedType || typeRaw; // Use raw if not a known type
    }

    // Calculate statistics
    const min = count + modifier;
    const max = count * sides + modifier;
    const average = Math.floor((count * (sides + 1) / 2) + modifier);

    // Build dice string
    const dice = count === 1 ? `d${sides}` : `${count}d${sides}`;

    return {
        dice,
        count,
        sides,
        modifier,
        type,
        average,
        min: Math.max(0, min), // Damage can't be negative
        max
    };
}

/**
 * Format damage notation back to shorthand
 */
export function formatDamage(damage: DamageNotation): string {
    let result = damage.dice;
    if (damage.modifier > 0) {
        result += `+${damage.modifier}`;
    } else if (damage.modifier < 0) {
        result += `${damage.modifier}`;
    }
    if (damage.type && damage.type !== 'untyped') {
        result += ` ${damage.type}`;
    }
    return result;
}

/**
 * Parse multiple damage expressions (e.g., for multi-attack)
 * Input: "2d6+3 slashing + 1d6 fire"
 */
export function parseMultiDamage(input: string): DamageNotation[] {
    const parts = input.split(/\s*\+\s*(?=\d*d)/); // Split on + before dice notation
    return parts
        .map(part => parseDamage(part.trim()))
        .filter((d): d is DamageNotation => d !== null);
}

// ═══════════════════════════════════════════════════════════════════════════
// DURATION PARSING
// ═══════════════════════════════════════════════════════════════════════════

export type DurationUnit = 'rounds' | 'minutes' | 'hours' | 'days' | 'instantaneous' | 'permanent' | 'concentration';

export interface Duration {
    value: number;          // Numeric value (7 in "7d")
    unit: DurationUnit;     // Human-readable unit
    rounds: number;         // Total duration in combat rounds (1 round = 6 seconds)
    display: string;        // Formatted display string
}

// Conversion factors to rounds (1 round = 6 seconds)
const ROUNDS_PER_MINUTE = 10;
const ROUNDS_PER_HOUR = 600;
const ROUNDS_PER_DAY = 14400;

/**
 * Parse duration shorthand
 *
 * Supported formats:
 * - "10r" or "10 rounds" -> 10 rounds
 * - "1m" or "1 minute" or "1min" -> 1 minute (10 rounds)
 * - "1h" or "1 hour" -> 1 hour (600 rounds)
 * - "7d" or "7 days" -> 7 days (100,800 rounds)
 * - "instant" or "instantaneous" -> 0 rounds
 * - "permanent" or "perm" -> Infinity rounds
 * - "conc" or "concentration" -> Concentration (returns 0 rounds, flag in unit)
 *
 * @example
 * parseDuration("1h")
 * // { value: 1, unit: "hours", rounds: 600, display: "1 hour" }
 *
 * parseDuration("10r")
 * // { value: 10, unit: "rounds", rounds: 10, display: "10 rounds" }
 */
export function parseDuration(input: string): Duration | null {
    const normalized = input.toLowerCase().trim();

    // Handle special cases
    if (normalized === 'instant' || normalized === 'instantaneous') {
        return { value: 0, unit: 'instantaneous', rounds: 0, display: 'Instantaneous' };
    }
    if (normalized === 'permanent' || normalized === 'perm') {
        return { value: Infinity, unit: 'permanent', rounds: Infinity, display: 'Permanent' };
    }
    if (normalized === 'conc' || normalized === 'concentration') {
        return { value: 0, unit: 'concentration', rounds: 0, display: 'Concentration' };
    }

    // Match numeric duration with unit
    // Group 1: number
    // Group 2: unit
    const regex = /^(\d+)\s*(r|round|rounds|m|min|minute|minutes|h|hour|hours|d|day|days)$/;
    const match = normalized.match(regex);

    if (!match) {
        return null;
    }

    const value = parseInt(match[1], 10);
    const unitRaw = match[2];

    let unit: DurationUnit;
    let rounds: number;
    let display: string;

    if (unitRaw === 'r' || unitRaw.startsWith('round')) {
        unit = 'rounds';
        rounds = value;
        display = value === 1 ? '1 round' : `${value} rounds`;
    } else if (unitRaw === 'm' || unitRaw.startsWith('min')) {
        unit = 'minutes';
        rounds = value * ROUNDS_PER_MINUTE;
        display = value === 1 ? '1 minute' : `${value} minutes`;
    } else if (unitRaw === 'h' || unitRaw.startsWith('hour')) {
        unit = 'hours';
        rounds = value * ROUNDS_PER_HOUR;
        display = value === 1 ? '1 hour' : `${value} hours`;
    } else if (unitRaw === 'd' || unitRaw.startsWith('day')) {
        unit = 'days';
        rounds = value * ROUNDS_PER_DAY;
        display = value === 1 ? '1 day' : `${value} days`;
    } else {
        return null;
    }

    return { value, unit, rounds, display };
}

/**
 * Format duration to shorthand
 */
export function formatDuration(duration: Duration, short: boolean = true): string {
    if (duration.unit === 'instantaneous') return short ? 'instant' : 'Instantaneous';
    if (duration.unit === 'permanent') return short ? 'perm' : 'Permanent';
    if (duration.unit === 'concentration') return short ? 'conc' : 'Concentration';

    if (short) {
        const unitMap: Record<DurationUnit, string> = {
            rounds: 'r',
            minutes: 'm',
            hours: 'h',
            days: 'd',
            instantaneous: 'instant',
            permanent: 'perm',
            concentration: 'conc'
        };
        return `${duration.value}${unitMap[duration.unit]}`;
    }
    return duration.display;
}

/**
 * Convert any duration to rounds
 */
export function toRounds(input: string | Duration | number): number {
    if (typeof input === 'number') return input;
    if (typeof input === 'string') {
        const parsed = parseDuration(input);
        return parsed?.rounds ?? 0;
    }
    return input.rounds;
}

// ═══════════════════════════════════════════════════════════════════════════
// RANGE PARSING
// ═══════════════════════════════════════════════════════════════════════════

export interface Range {
    normal: number;         // Normal range in feet
    long: number | null;    // Long range (disadvantage) in feet, null if no long range
    type: 'melee' | 'ranged' | 'reach';
}

/**
 * Parse range shorthand
 *
 * Supported formats:
 * - "5" or "5ft" -> 5ft melee range
 * - "30/120" -> 30ft normal, 120ft long (ranged)
 * - "reach 10" or "10 reach" -> 10ft reach
 * - "self" -> 0ft (self-target)
 * - "touch" -> 5ft melee
 *
 * @example
 * parseRange("30/120")
 * // { normal: 30, long: 120, type: "ranged" }
 */
export function parseRange(input: string): Range | null {
    const normalized = input.toLowerCase().trim().replace(/ft|feet/g, '');

    // Self or touch
    if (normalized === 'self') {
        return { normal: 0, long: null, type: 'melee' };
    }
    if (normalized === 'touch') {
        return { normal: 5, long: null, type: 'melee' };
    }

    // Reach notation
    const reachMatch = normalized.match(/^(?:reach\s*)?(\d+)(?:\s*reach)?$/);
    if (reachMatch && normalized.includes('reach')) {
        return { normal: parseInt(reachMatch[1], 10), long: null, type: 'reach' };
    }

    // Ranged notation: normal/long
    const rangedMatch = normalized.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (rangedMatch) {
        return {
            normal: parseInt(rangedMatch[1], 10),
            long: parseInt(rangedMatch[2], 10),
            type: 'ranged'
        };
    }

    // Simple number (melee or single range)
    const simpleMatch = normalized.match(/^(\d+)$/);
    if (simpleMatch) {
        const range = parseInt(simpleMatch[1], 10);
        return {
            normal: range,
            long: null,
            type: range <= 10 ? 'melee' : 'ranged'
        };
    }

    return null;
}

/**
 * Format range to shorthand
 */
export function formatRange(range: Range): string {
    if (range.type === 'reach') {
        return `${range.normal}ft reach`;
    }
    if (range.long) {
        return `${range.normal}/${range.long}`;
    }
    return `${range.normal}ft`;
}

// ═══════════════════════════════════════════════════════════════════════════
// AREA OF EFFECT PARSING
// ═══════════════════════════════════════════════════════════════════════════

export type AoeShape = 'cone' | 'cube' | 'cylinder' | 'line' | 'sphere' | 'square';

export interface AreaOfEffect {
    size: number;           // Size in feet (radius for sphere/cylinder, side for cube, etc.)
    shape: AoeShape;
    secondarySize?: number; // Height for cylinder, width for line
}

/**
 * Parse area of effect shorthand
 *
 * Supported formats:
 * - "20ft cone" or "20 cone" -> 20ft cone
 * - "15ft cube" -> 15ft cube
 * - "20ft radius" or "20ft sphere" -> 20ft radius sphere
 * - "30x5 line" or "30ft line 5ft wide" -> 30ft long, 5ft wide line
 * - "20ft cylinder 40ft high" -> 20ft radius, 40ft high cylinder
 *
 * @example
 * parseAreaOfEffect("60ft cone")
 * // { size: 60, shape: "cone" }
 */
export function parseAreaOfEffect(input: string): AreaOfEffect | null {
    const normalized = input.toLowerCase().trim().replace(/ft|feet/g, '');

    // Cone
    const coneMatch = normalized.match(/^(\d+)\s*cone$/);
    if (coneMatch) {
        return { size: parseInt(coneMatch[1], 10), shape: 'cone' };
    }

    // Cube
    const cubeMatch = normalized.match(/^(\d+)\s*cube$/);
    if (cubeMatch) {
        return { size: parseInt(cubeMatch[1], 10), shape: 'cube' };
    }

    // Sphere/radius
    const sphereMatch = normalized.match(/^(\d+)\s*(?:sphere|radius)$/);
    if (sphereMatch) {
        return { size: parseInt(sphereMatch[1], 10), shape: 'sphere' };
    }

    // Square
    const squareMatch = normalized.match(/^(\d+)\s*square$/);
    if (squareMatch) {
        return { size: parseInt(squareMatch[1], 10), shape: 'square' };
    }

    // Line with optional width: "30x5 line" or "30 line 5 wide"
    const lineMatch = normalized.match(/^(\d+)(?:x(\d+))?\s*line(?:\s*(\d+)\s*wide)?$/);
    if (lineMatch) {
        const length = parseInt(lineMatch[1], 10);
        const width = lineMatch[2] ? parseInt(lineMatch[2], 10) :
                      lineMatch[3] ? parseInt(lineMatch[3], 10) : 5;
        return { size: length, shape: 'line', secondarySize: width };
    }

    // Cylinder with optional height
    const cylinderMatch = normalized.match(/^(\d+)\s*cylinder(?:\s*(\d+)\s*(?:high|tall))?$/);
    if (cylinderMatch) {
        const radius = parseInt(cylinderMatch[1], 10);
        const height = cylinderMatch[2] ? parseInt(cylinderMatch[2], 10) : radius;
        return { size: radius, shape: 'cylinder', secondarySize: height };
    }

    return null;
}

/**
 * Format area of effect to shorthand
 */
export function formatAreaOfEffect(aoe: AreaOfEffect): string {
    if (aoe.shape === 'line' && aoe.secondarySize) {
        return `${aoe.size}x${aoe.secondarySize}ft line`;
    }
    if (aoe.shape === 'cylinder' && aoe.secondarySize) {
        return `${aoe.size}ft cylinder ${aoe.secondarySize}ft high`;
    }
    return `${aoe.size}ft ${aoe.shape}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DICE EXPRESSION EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Roll dice based on notation string
 *
 * @param notation Dice notation like "2d6+3" or "1d20"
 * @param rng Optional random function (default: Math.random)
 * @returns Total rolled value
 */
export function rollDice(notation: string, rng: () => number = Math.random): number {
    const damage = parseDamage(notation);
    if (!damage) {
        // Try simple modifier like "+5"
        const modMatch = notation.match(/^([+-]?\d+)$/);
        if (modMatch) {
            return parseInt(modMatch[1], 10);
        }
        return 0;
    }

    let total = damage.modifier;
    for (let i = 0; i < damage.count; i++) {
        total += Math.floor(rng() * damage.sides) + 1;
    }
    return Math.max(0, total);
}

/**
 * Calculate average value for dice notation
 */
export function averageDice(notation: string): number {
    const damage = parseDamage(notation);
    return damage?.average ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// ZOD INTEGRATION - Custom refinements for schema validation
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

/**
 * Zod schema for position that accepts string or object
 */
export const PositionSchema = z.union([
    z.string().regex(/^\d+,\d+(,\d+)?$/, 'Position must be "x,y" or "x,y,z" format'),
    z.object({
        x: z.number(),
        y: z.number(),
        z: z.number().optional()
    })
]).transform(parsePosition);

/**
 * Zod schema for damage notation
 */
export const DamageSchema = z.string()
    .refine(
        (val) => parseDamage(val) !== null,
        { message: 'Invalid damage notation. Use format like "2d6+3 fire"' }
    )
    .transform((val) => parseDamage(val)!);

/**
 * Zod schema for duration
 */
export const DurationSchema = z.string()
    .refine(
        (val) => parseDuration(val) !== null,
        { message: 'Invalid duration. Use format like "10r", "1m", "1h", "7d", "instant", or "concentration"' }
    )
    .transform((val) => parseDuration(val)!);

/**
 * Zod schema for range
 */
export const RangeSchema = z.string()
    .refine(
        (val) => parseRange(val) !== null,
        { message: 'Invalid range. Use format like "30/120", "5ft", "touch", or "10 reach"' }
    )
    .transform((val) => parseRange(val)!);

/**
 * Zod schema for area of effect
 */
export const AreaOfEffectSchema = z.string()
    .refine(
        (val) => parseAreaOfEffect(val) !== null,
        { message: 'Invalid area of effect. Use format like "20ft cone", "15ft cube", "20ft sphere"' }
    )
    .transform((val) => parseAreaOfEffect(val)!);
