/**
 * Fuzzy Enum Matching Utilities
 *
 * TIER 1 Token Efficiency Optimization
 *
 * Provides 3-tier fuzzy matching for action enums:
 * 1. Exact match (case-insensitive)
 * 2. Alias match (synonym mapping)
 * 3. Levenshtein distance (auto-correct typos)
 *
 * Returns guiding errors with suggestions when no match found.
 *
 * Philosophy: "Trust but verify through schema" + "Guiding errors teach the solution"
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface MatchResult<T extends string> {
    matched: T;
    exact: boolean;
    similarity: number;
}

export interface GuidingError {
    error: 'invalid_action' | 'invalid_identifier' | 'validation_error';
    input: string;
    suggestions: Array<{ value: string; similarity: number }>;
    message: string;
}

export type MatchOutcome<T extends string> = MatchResult<T> | GuidingError;

export function isGuidingError(result: unknown): result is GuidingError {
    return (
        typeof result === 'object' &&
        result !== null &&
        'error' in result &&
        typeof (result as GuidingError).error === 'string' &&
        'suggestions' in result &&
        Array.isArray((result as GuidingError).suggestions)
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVENSHTEIN DISTANCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching tier 3
 */
export function levenshtein(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    // Initialize first column
    for (let i = 0; i <= a.length; i++) {
        matrix[i] = [i];
    }

    // Initialize first row
    for (let j = 0; j <= b.length; j++) {
        matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return matrix[a.length][b.length];
}

/**
 * Calculate similarity score (0-1) between two strings
 */
export function similarity(a: string, b: string): number {
    const distance = levenshtein(a.toLowerCase(), b.toLowerCase());
    const maxLength = Math.max(a.length, b.length);
    if (maxLength === 0) return 1;
    return 1 - distance / maxLength;
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZE INPUT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize input for matching:
 * - Lowercase
 * - Trim whitespace
 * - Replace hyphens/spaces with underscores
 */
export function normalizeInput(input: string): string {
    return input
        .toLowerCase()
        .trim()
        .replace(/[-\s]+/g, '_');
}

// ═══════════════════════════════════════════════════════════════════════════
// THREE-TIER ACTION MATCHING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Match an input against valid actions with 3-tier fuzzy matching
 *
 * @param input - User input to match
 * @param validActions - Array of valid action strings
 * @param aliases - Optional map of alias -> canonical action
 * @param threshold - Minimum similarity for fuzzy match (default: 0.6)
 * @returns MatchResult on success, GuidingError on failure
 *
 * @example
 * const actions = ['create', 'get', 'update', 'delete', 'list'] as const;
 * const aliases = { 'new': 'create', 'fetch': 'get', 'modify': 'update' };
 *
 * matchAction('new', actions, aliases);    // { matched: 'create', exact: false, similarity: 0.95 }
 * matchAction('creat', actions, aliases);  // { matched: 'create', exact: false, similarity: 0.83 }
 * matchAction('xyz', actions, aliases);    // GuidingError with suggestions
 */
export function matchAction<T extends string>(
    input: string,
    validActions: readonly T[],
    aliases?: Record<string, T>,
    threshold: number = 0.6
): MatchOutcome<T> {
    const normalized = normalizeInput(input);

    // ─────────────────────────────────────────────────────────────────────────
    // TIER 1: Exact match (case-insensitive)
    // ─────────────────────────────────────────────────────────────────────────
    const exactMatch = validActions.find(
        action => action.toLowerCase() === normalized
    );
    if (exactMatch) {
        return { matched: exactMatch, exact: true, similarity: 1.0 };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIER 2: Alias match
    // ─────────────────────────────────────────────────────────────────────────
    if (aliases) {
        const aliasMatch = aliases[normalized];
        if (aliasMatch && validActions.includes(aliasMatch)) {
            return { matched: aliasMatch, exact: false, similarity: 0.95 };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIER 3: Fuzzy match (Levenshtein distance)
    // ─────────────────────────────────────────────────────────────────────────
    const scored = validActions.map(action => ({
        action,
        similarity: similarity(normalized, action)
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    const best = scored[0];

    // Accept if similarity meets threshold
    if (best.similarity >= threshold) {
        return {
            matched: best.action,
            exact: false,
            similarity: best.similarity
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NO MATCH: Return guiding error with suggestions
    // ─────────────────────────────────────────────────────────────────────────
    const topSuggestions = scored.slice(0, 3).map(s => ({
        value: s.action,
        similarity: Math.round(s.similarity * 100)
    }));

    return {
        error: 'invalid_action',
        input,
        suggestions: topSuggestions,
        message: `Unknown action "${input}". Did you mean: ${
            topSuggestions.map(s => `"${s.value}" (${s.similarity}%)`).join(', ')
        }?`
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// FLEXIBLE IDENTIFIER RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve an identifier that could be UUID or name
 *
 * @param identifier - UUID or name to resolve
 * @param findById - Function to find by ID
 * @param findByName - Function to find by name
 * @param listAll - Optional function to list all for suggestions
 * @returns Entity on success, GuidingError on failure
 *
 * @example
 * const result = await resolveIdentifier(
 *     'Valeros',
 *     id => charRepo.findById(id),
 *     name => charRepo.findByName(name),
 *     () => charRepo.listAll()
 * );
 */
export function resolveIdentifier<T extends { id: string; name: string }>(
    identifier: string,
    findById: (id: string) => T | null,
    findByName: (name: string) => T | null,
    listAll?: () => T[]
): T | GuidingError {
    // Try UUID first (fast path)
    const byId = findById(identifier);
    if (byId) return byId;

    // Try exact name match (case-sensitive)
    const byName = findByName(identifier);
    if (byName) return byName;

    // Try case-insensitive name match
    if (listAll) {
        const all = listAll();
        const normalized = identifier.toLowerCase();

        // Case-insensitive exact match
        const caseInsensitive = all.find(
            item => item.name.toLowerCase() === normalized
        );
        if (caseInsensitive) return caseInsensitive;

        // Fuzzy name match
        const scored = all.map(item => ({
            item,
            similarity: similarity(normalized, item.name)
        }));
        scored.sort((a, b) => b.similarity - a.similarity);

        // If we have a very close match (>80%), return it
        if (scored.length > 0 && scored[0].similarity >= 0.8) {
            return scored[0].item;
        }

        // Otherwise return guiding error with suggestions
        const suggestions = scored.slice(0, 3).map(s => ({
            value: s.item.name,
            similarity: Math.round(s.similarity * 100)
        }));

        return {
            error: 'invalid_identifier',
            input: identifier,
            suggestions,
            message: `No entity found for "${identifier}". ${
                suggestions.length > 0
                    ? `Did you mean: ${suggestions.map(s => `"${s.value}" (${s.similarity}%)`).join(', ')}?`
                    : 'No similar entities found.'
            }`
        };
    }

    // No listAll provided, simple not found error
    return {
        error: 'invalid_identifier',
        input: identifier,
        suggestions: [],
        message: `No entity found for "${identifier}"`
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMON ACTION ALIASES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standard CRUD action aliases
 * These cover common synonyms for CRUD operations
 */
export const CRUD_ALIASES: Record<string, 'create' | 'get' | 'list' | 'update' | 'delete'> = {
    // Create aliases
    'new': 'create',
    'add': 'create',
    'spawn': 'create',
    'make': 'create',
    'insert': 'create',

    // Get aliases
    'fetch': 'get',
    'read': 'get',
    'find': 'get',
    'show': 'get',
    'retrieve': 'get',
    'load': 'get',

    // List aliases
    'all': 'list',
    'query': 'list',
    'search': 'list',
    'browse': 'list',

    // Update aliases
    'modify': 'update',
    'edit': 'update',
    'patch': 'update',
    'change': 'update',
    'set': 'update',

    // Delete aliases
    'remove': 'delete',
    'destroy': 'delete',
    'erase': 'delete',
    'drop': 'delete',
    'kill': 'delete'
};

/**
 * Extend base aliases with domain-specific ones
 */
export function extendAliases<T extends string>(
    base: Record<string, T>,
    extensions: Record<string, T>
): Record<string, T> {
    return { ...base, ...extensions };
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT GUIDING ERROR FOR MCP RESPONSE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format a guiding error as an MCP tool response
 */
export function formatGuidingError(error: GuidingError): {
    content: Array<{ type: 'text'; text: string }>;
} {
    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                error: error.error,
                message: error.message,
                input: error.input,
                suggestions: error.suggestions,
                hint: 'Try one of the suggested values above'
            }, null, 2)
        }]
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ZOD INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

/**
 * Create a Zod schema that accepts fuzzy-matched actions
 *
 * @example
 * const ActionSchema = createFuzzyActionSchema(
 *     ['create', 'get', 'update', 'delete', 'list'],
 *     CRUD_ALIASES
 * );
 *
 * ActionSchema.parse('new');    // Returns 'create'
 * ActionSchema.parse('creat');  // Returns 'create' (fuzzy)
 * ActionSchema.parse('xyz');    // Throws with suggestions
 */
export function createFuzzyActionSchema<T extends string>(
    validActions: readonly T[],
    aliases?: Record<string, T>,
    threshold: number = 0.6
): z.ZodType<T, string> {
    return z.string().transform((input, ctx) => {
        const result = matchAction(input, validActions, aliases, threshold);

        if (isGuidingError(result)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: result.message
            });
            return z.NEVER;
        }

        return result.matched;
    });
}

/**
 * Create a Zod schema that accepts flexible identifiers (UUID or name)
 * Note: This creates a passthrough schema - actual resolution happens at runtime
 */
export const FlexibleIdentifierSchema = z.string()
    .min(1, 'Identifier cannot be empty')
    .describe('UUID or entity name');
