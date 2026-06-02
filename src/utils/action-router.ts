/**
 * Action Router - Generic routing for consolidated MCP tools
 *
 * TIER 1 Token Efficiency Optimization
 *
 * Provides a generic framework for routing action-based tools:
 * - Parses action parameter with fuzzy matching
 * - Routes to appropriate handler based on action
 * - Handles common patterns (CRUD, domain-specific)
 * - Provides consistent response formatting
 *
 * Usage:
 *   const router = createActionRouter(ACTIONS, commonSchema, handlers);
 *   const result = await router(args);
 */

import { z } from 'zod';
import {
    matchAction,
    isGuidingError,
    formatGuidingError,
    MatchResult
} from './fuzzy-enum.js';
import type { SessionContext } from '../server/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handler function for a specific action
 */
export type ActionHandler<TArgs = unknown, TResult = unknown> = (
    args: TArgs
) => Promise<TResult> | TResult;

/**
 * Definition for a single action within a consolidated tool
 *
 * Note: Handler uses 'any' for flexibility since Zod schema validates at runtime.
 * This allows typed handlers to be assigned without explicit casts.
 */
export interface ActionDefinition {
    /** Zod schema for action-specific parameters */
    schema: z.ZodType<any>;
    /** Handler function for this action (validated args from schema) */
    handler: (args: any, ctx?: SessionContext) => Promise<unknown> | unknown;
    /** Optional aliases for this action (e.g., 'new' -> 'create') */
    aliases?: string[];
    /** Description for documentation */
    description?: string;
}

export interface ActionSchemaDocumentation {
    [action: string]: {
        schema: z.ZodType<any>;
        aliases: string[];
        description?: string;
    };
}

export interface ActionRouter {
    (args: Record<string, unknown>, ctx?: SessionContext): Promise<McpResponse>;
    actionSchemas: ActionSchemaDocumentation;
}

/**
 * Configuration for the action router
 */
export interface ActionRouterConfig<TActions extends string> {
    /** Valid action names */
    actions: readonly TActions[];
    /** Action definitions with handlers */
    definitions: Record<TActions, ActionDefinition>;
    /** Global alias map (optional, built from definitions if not provided) */
    aliases?: Record<string, TActions>;
    /** Minimum similarity for fuzzy matching (default: 0.6) */
    threshold?: number;
}

/**
 * MCP-formatted response
 */
export interface McpResponse {
    content: Array<{ type: 'text'; text: string }>;
}

/**
 * Enhanced result with fuzzy match metadata
 */
export interface EnhancedResult<T> {
    result: T;
    _meta?: {
        fuzzyMatch?: {
            requested: string;
            resolved: string;
            similarity: number;
        };
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an action router for a consolidated tool
 *
 * @example
 * const router = createActionRouter({
 *     actions: ['create', 'get', 'update', 'delete', 'list'] as const,
 *     definitions: {
 *         create: {
 *             schema: z.object({ name: z.string() }),
 *             handler: async (args) => createEntity(args),
 *             aliases: ['new', 'add']
 *         },
 *         get: {
 *             schema: z.object({ id: z.string() }),
 *             handler: async (args) => getEntity(args.id)
 *         },
 *         // ...
 *     }
 * });
 *
 * // Later in tool handler:
 * const result = await router({ action: 'new', name: 'Test' });
 */
export function createActionRouter<TActions extends string>(
    config: ActionRouterConfig<TActions>
): ActionRouter {
    const { actions, definitions, threshold = 0.6 } = config;

    // Build alias map from definitions if not provided
    const aliasMap: Record<string, TActions> = config.aliases ?? {};
    if (!config.aliases) {
        for (const [action, def] of Object.entries(definitions) as Array<[TActions, ActionDefinition]>) {
            if (def.aliases) {
                for (const alias of def.aliases) {
                    aliasMap[alias.toLowerCase()] = action;
                }
            }
        }
    }

    const route = async function route(args: Record<string, unknown>, ctx?: SessionContext): Promise<McpResponse> {
        // ─────────────────────────────────────────────────────────────────────
        // STEP 1: Extract and validate action
        // ─────────────────────────────────────────────────────────────────────
        const rawAction = args.action;
        if (typeof rawAction !== 'string') {
            return formatMcpError('Missing or invalid "action" parameter', {
                received: typeof rawAction,
                expected: 'string',
                validActions: [...actions]
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // STEP 2: Match action with fuzzy logic
        // ─────────────────────────────────────────────────────────────────────
        const matchResult = matchAction(rawAction, actions, aliasMap, threshold);

        if (isGuidingError(matchResult)) {
            return formatGuidingError(matchResult);
        }

        const action = matchResult.matched;
        const definition = definitions[action];

        if (!definition) {
            return formatMcpError(`No handler defined for action: ${action}`, {
                action
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // STEP 3: Parse action-specific args (with resolved action)
        // ─────────────────────────────────────────────────────────────────────
        // Replace the raw action with the resolved action for schema validation
        const argsWithResolvedAction = { ...args, action };
        const parseResult = definition.schema.safeParse(argsWithResolvedAction);

        if (!parseResult.success) {
            return formatValidationError(action, parseResult.error);
        }

        // ─────────────────────────────────────────────────────────────────────
        // STEP 4: Execute handler
        // ─────────────────────────────────────────────────────────────────────
        try {
            const result = await definition.handler(parseResult.data, ctx);

            // ─────────────────────────────────────────────────────────────────
            // STEP 5: Format response with optional fuzzy match metadata
            // ─────────────────────────────────────────────────────────────────
            return formatMcpSuccess(result, matchResult);
        } catch (error) {
            return formatMcpError(
                error instanceof Error ? error.message : String(error),
                { action, args }
            );
        }
    };

    route.actionSchemas = createActionSchemaDocumentation(definitions);
    return route;
}

export function createActionSchemaDocumentation<TActions extends string>(
    definitions: Record<TActions, ActionDefinition>
): ActionSchemaDocumentation {
    return Object.fromEntries(
        Object.entries(definitions).map(([action, definition]) => [
            action,
            {
                schema: (definition as ActionDefinition).schema,
                aliases: (definition as ActionDefinition).aliases || [],
                description: (definition as ActionDefinition).description
            }
        ])
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCRIMINATED UNION ROUTER (ALTERNATIVE PATTERN)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a router using Zod discriminated unions
 *
 * This approach uses Zod's discriminatedUnion for compile-time type safety.
 * Better for complex tools where each action has very different schemas.
 *
 * @example
 * const schema = z.discriminatedUnion('action', [
 *     z.object({ action: z.literal('create'), name: z.string() }),
 *     z.object({ action: z.literal('get'), id: z.string() }),
 * ]);
 *
 * const router = createDiscriminatedRouter(schema, {
 *     create: async (args) => { ... },
 *     get: async (args) => { ... },
 * });
 */
export function createDiscriminatedRouter<TSchema extends z.ZodSchema>(
    schema: TSchema,
    handlers: Record<string, ActionHandler>
): (args: unknown) => Promise<McpResponse> {
    return async function route(args: unknown): Promise<McpResponse> {
        // Parse and validate
        const parseResult = schema.safeParse(args);

        if (!parseResult.success) {
            return formatValidationError('unknown', parseResult.error);
        }

        const parsed = parseResult.data as { action: string };
        const handler = handlers[parsed.action];

        if (!handler) {
            return formatMcpError(`No handler for action: ${parsed.action}`, {});
        }

        try {
            const result = await handler(parsed);
            return formatMcpSuccess(result, { matched: parsed.action, exact: true, similarity: 1 });
        } catch (error) {
            return formatMcpError(
                error instanceof Error ? error.message : String(error),
                { action: parsed.action }
            );
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format a successful result as MCP response
 */
export function formatMcpSuccess(
    result: unknown,
    matchInfo?: MatchResult<string>
): McpResponse {
    // If result is already an MCP response, return it
    if (
        typeof result === 'object' &&
        result !== null &&
        'content' in result &&
        Array.isArray((result as McpResponse).content)
    ) {
        // Add fuzzy match metadata if not exact
        if (matchInfo && !matchInfo.exact) {
            const content = (result as McpResponse).content;
            if (content.length > 0 && content[0].type === 'text') {
                try {
                    const data = JSON.parse(content[0].text);
                    data._fuzzyMatch = {
                        requested: matchInfo.matched, // Original would need to be passed
                        resolved: matchInfo.matched,
                        similarity: Math.round(matchInfo.similarity * 100)
                    };
                    content[0].text = JSON.stringify(data, null, 2);
                } catch {
                    // Not JSON, leave as-is
                }
            }
        }
        return result as McpResponse;
    }

    // Format as JSON
    const output: Record<string, unknown> = typeof result === 'object' && result !== null
        ? { ...result as Record<string, unknown> }
        : { result };

    // Add fuzzy match info if not exact match
    if (matchInfo && !matchInfo.exact) {
        output._fuzzyMatch = {
            resolved: matchInfo.matched,
            similarity: Math.round(matchInfo.similarity * 100)
        };
    }

    return {
        content: [{
            type: 'text',
            text: JSON.stringify(output, null, 2)
        }]
    };
}

/**
 * Format an error as MCP response
 */
export function formatMcpError(
    message: string,
    details: Record<string, unknown>
): McpResponse {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: true,
                message,
                ...details
            }, null, 2)
        }]
    };
}

/**
 * Format a Zod validation error as MCP response with helpful details
 */
export function formatValidationError(
    action: string,
    error: z.ZodError
): McpResponse {
    const issues = error.issues.map(issue => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
        code: issue.code
    }));

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: 'validation_error',
                action,
                message: `Validation failed for action "${action}"`,
                issues,
                hint: 'Check the parameter types and required fields'
            }, null, 2)
        }]
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Build action description for tool schema
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate description text for the 'action' parameter
 * Includes all valid actions and their aliases
 */
export function buildActionDescription<TActions extends string>(
    actions: readonly TActions[],
    definitions: Record<TActions, ActionDefinition>
): string {
    const parts = [`Action to perform: ${actions.join(', ')}`];

    // Collect aliases
    const aliasLines: string[] = [];
    for (const [action, def] of Object.entries(definitions) as Array<[TActions, ActionDefinition]>) {
        if (def.aliases && def.aliases.length > 0) {
            aliasLines.push(`${def.aliases.join('/')} -> ${action}`);
        }
    }

    if (aliasLines.length > 0) {
        parts.push(`Aliases: ${aliasLines.join(', ')}`);
    }

    return parts.join('. ');
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPE HELPERS FOR CONSOLIDATED TOOL SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create the base schema for a consolidated tool
 * Includes the action parameter with description
 */
export function createConsolidatedSchema<TActions extends string>(
    actions: readonly TActions[],
    definitions: Record<TActions, ActionDefinition>
): z.ZodObject<{ action: z.ZodString }> {
    return z.object({
        action: z.string().describe(buildActionDescription(actions, definitions))
    });
}

/**
 * Merge common schema with action-specific schema
 * Useful for building the full input schema for documentation
 */
export function mergeSchemas(
    common: z.AnyZodObject,
    specific: z.AnyZodObject
): z.AnyZodObject {
    return common.merge(specific);
}
