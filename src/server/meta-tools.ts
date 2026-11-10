/**
 * Meta-Tools for Dynamic Loader Pattern
 * 
 * search_tools - Discover tools by keyword, category, or capability
 * load_tool_schema - Load full schema for a specific tool on-demand
 */

import { z } from 'zod';
import { buildConsolidatedRegistry, getAllConsolidatedToolMetadata, getConsolidatedToolCategories } from './consolidated-registry.js';
import { ToolMetadata } from './tool-metadata.js';

// === SEARCH_TOOLS ===

export const SearchToolsSchema = z.object({
  query: z.string().optional().describe('Natural language or keyword query to search for tools'),
  category: z.enum([
    'world', 'combat', 'character', 'inventory', 'quest', 'party',
    'math', 'strategy', 'secret', 'concentration', 'rest', 'scroll',
    'aura', 'npc', 'spatial', 'theft', 'corpse', 'improvisation',
    'turn-management', 'meta', 'agent'
  ]).optional().describe('Filter by category'),
  maxResults: z.number().min(1).max(50).default(10).describe('Maximum results to return'),
  contextAwareOnly: z.boolean().optional().describe('Only return context-aware tools'),
});

export type SearchToolsArgs = z.infer<typeof SearchToolsSchema>;

interface ScoredTool extends ToolMetadata {
  relevanceScore: number;
}

function calculateRelevance(metadata: ToolMetadata, query: string): number {
  if (!query) return 1; // No query = equal relevance
  
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);
  
  let score = 0;
  
  // Exact name match: highest score
  if (metadata.name.toLowerCase() === queryLower) return 100;
  
  // Name contains query: high score
  if (metadata.name.toLowerCase().includes(queryLower)) score += 50;
  
  // Query words in name
  for (const word of queryWords) {
    if (metadata.name.toLowerCase().includes(word)) score += 20;
  }
  
  // Description contains query: medium score
  if (metadata.description.toLowerCase().includes(queryLower)) score += 15;
  
  // Query words in description
  for (const word of queryWords) {
    if (metadata.description.toLowerCase().includes(word)) score += 5;
  }
  
  // Keyword match: medium-high score
  for (const kw of metadata.keywords) {
    const kwLower = kw.toLowerCase();
    if (kwLower === queryLower) score += 30;
    else if (kwLower.includes(queryLower) || queryLower.includes(kwLower)) score += 15;
    
    for (const word of queryWords) {
      if (kwLower === word) score += 10;
      else if (kwLower.includes(word)) score += 5;
    }
  }
  
  // Capability match: low-medium score
  for (const cap of metadata.capabilities) {
    if (cap.toLowerCase().includes(queryLower)) score += 8;
    for (const word of queryWords) {
      if (cap.toLowerCase().includes(word)) score += 3;
    }
  }
  
  return score;
}

export async function handleSearchTools(args: SearchToolsArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
}> {
  const allMetadata = getAllConsolidatedToolMetadata();
  let results = allMetadata;
  
  // Filter by category if provided
  if (args.category) {
    results = results.filter(t => t.category === args.category);
  }
  
  // Filter by context-aware if requested
  if (args.contextAwareOnly) {
    results = results.filter(t => t.contextAware);
  }
  
  // Score by query relevance
  const scored: ScoredTool[] = results.map(tool => ({
    ...tool,
    relevanceScore: calculateRelevance(tool, args.query || '')
  }));
  
  // Filter out zero-relevance if there's a query
  let filtered = args.query 
    ? scored.filter(t => t.relevanceScore > 0)
    : scored;
  
  // Sort by relevance
  filtered.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  // Limit results
  const truncated = filtered.slice(0, args.maxResults || 10);
  
  // Generate suggestions
  const suggestions: string[] = [];
  
  if (truncated.length === 0 && args.query) {
    suggestions.push(`No tools matched "${args.query}". Try broader keywords or browse by category.`);
  }
  
  if (truncated.length > 0) {
    suggestions.push('Use load_tool_schema to get full parameter details before calling a tool.');
  }
  
  const contextAwareCount = truncated.filter(t => t.contextAware).length;
  if (contextAwareCount > 0) {
    suggestions.push(`${contextAwareCount} context-aware tools found - these return larger result sets.`);
  }
  
  // Get unique categories in results
  const categoriesInResults = [...new Set(truncated.map(t => t.category))];
  
  // Build content array - standard text only to pass validation
  const content: Array<{ type: 'text'; text: string }> = [];
  
  // Add summary text for human readability
  const summary = {
    total_found: filtered.length,
    returned: truncated.length,
    categories: categoriesInResults,
    query_used: args.query || null,
    tools: truncated.map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
      relevanceScore: t.relevanceScore,
      deferLoading: t.deferLoading
    })),
    categories_available: getConsolidatedToolCategories(),
    suggestions
  };
  
  content.push({ type: 'text', text: JSON.stringify(summary, null, 2) });
  
  return { content };
}

// === LOAD_TOOL_SCHEMA ===

export const LoadToolSchemaSchema = z.object({
  toolName: z.string().describe('Name of the tool to load schema for')
});

export type LoadToolSchemaArgs = z.infer<typeof LoadToolSchemaSchema>;

/**
 * Schema introspection for load_tool_schema.
 *
 * Reads zod 4's public `def` (`def.type`, `def.innerType`, ...). The summary it
 * produces is part of the tool contract, so its shape is kept exactly as it
 * was under zod 3, including the legacy `Zod*` names for kinds that have no
 * summary of their own.
 */
const WRAPPER_TYPES = new Set(['optional', 'default', 'prefault', 'nullable', 'readonly', 'catch', 'nonoptional']);

const LEGACY_TYPE_NAMES: Record<string, string> = {
  unknown: 'ZodUnknown',
  null: 'ZodNull',
  undefined: 'ZodUndefined',
  void: 'ZodVoid',
  never: 'ZodNever',
  nan: 'ZodNaN',
  date: 'ZodDate',
  bigint: 'ZodBigInt',
  symbol: 'ZodSymbol',
  tuple: 'ZodTuple',
  map: 'ZodMap',
  set: 'ZodSet',
  lazy: 'ZodLazy',
  promise: 'ZodPromise',
  function: 'ZodFunction',
  readonly: 'ZodReadonly',
  catch: 'ZodCatch',
  nonoptional: 'ZodNonOptional',
  custom: 'ZodCustom',
  template_literal: 'ZodTemplateLiteral',
  file: 'ZodFile',
};

function zodDef(schema: any): any {
  return schema?.def ?? schema?._zod?.def;
}

/**
 * A schema's description. zod 3 copied a description onto the wrapper when a
 * described schema was made optional, nullable or given a default; zod 4 keeps
 * it on the inner schema only, so look through wrappers for it.
 */
function describedAs(schema: any): string | undefined {
  let current = schema;
  for (let depth = 0; current && depth < 10; depth++) {
    if (current.description !== undefined) return current.description;
    const def = zodDef(current);
    if (!def) return undefined;
    if (WRAPPER_TYPES.has(def.type)) current = def.innerType;
    else if (def.type === 'pipe') current = def.in;
    else return undefined;
  }
  return undefined;
}

/** True when the schema carries a `.refine()` / `.superRefine()` check. */
function hasCustomCheck(def: any): boolean {
  return Array.isArray(def?.checks) &&
    def.checks.some((check: any) => (check?._zod?.def ?? check?.def)?.check === 'custom');
}

function describeZodType(schema: any): any {
  const def = zodDef(schema);
  const description = describedAs(schema);

  if (!def) {
    return { type: 'unknown', description };
  }

  const summary = describeZodKind(schema, def, description);
  // zod 3 wrapped a refined schema in ZodEffects; zod 4 stores the check on it.
  return hasCustomCheck(def) ? { ...summary, refinements: true, description } : summary;
}

function describeZodKind(schema: any, def: any, description: string | undefined): any {
  switch (def.type) {
    case 'string':
      return { type: 'string', description };
    case 'number':
    case 'int':
      return { type: 'number', description };
    case 'boolean':
      return { type: 'boolean', description };
    case 'enum':
      return { type: 'enum', values: Object.values(def.entries ?? {}), description };
    case 'literal':
      return { type: 'literal', value: def.values?.[0], description };
    case 'array':
      return { type: 'array', itemType: describeZodType(def.element), description };
    case 'object':
      return { type: 'object', properties: summarizeZodShape(schema.shape), description };
    case 'optional':
      return { ...describeZodType(def.innerType), optional: true, description };
    case 'default':
    case 'prefault':
      return {
        ...describeZodType(def.innerType),
        optional: true,
        default: def.defaultValue,
        description
      };
    case 'nullable':
      return { ...describeZodType(def.innerType), nullable: true, description };
    case 'union':
      if (def.discriminator !== undefined) return { type: 'ZodDiscriminatedUnion', description };
      return { type: 'union', options: def.options.map(describeZodType), description };
    case 'intersection':
      return {
        type: 'intersection',
        left: describeZodType(def.left),
        right: describeZodType(def.right),
        description
      };
    case 'pipe':
      // .transform() / z.preprocess(): summarize the side that holds the shape.
      return {
        ...describeZodType(zodDef(def.in)?.type === 'transform' ? def.out : def.in),
        refinements: true,
        description
      };
    case 'any':
      return { type: 'any', description };
    case 'record':
      return { type: 'record', valueType: describeZodType(def.valueType), description };
    default:
      return { type: LEGACY_TYPE_NAMES[def.type] ?? String(def.type || 'unknown'), description };
  }
}

function summarizeZodShape(shape: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(shape).map(([name, schema]) => [name, describeZodType(schema)])
  );
}

function isOptionalZodType(schema: any): boolean {
  const type = zodDef(schema)?.type;
  return type === 'optional' || type === 'default' || type === 'prefault';
}

function unwrapZodEffects(schema: any): any {
  let current = schema;
  while (zodDef(current)?.type === 'pipe') {
    const def = zodDef(current);
    current = zodDef(def.in)?.type === 'transform' ? def.out : def.in;
  }
  return current;
}

function getRequiredKeys(schema: any): string[] {
  const shape = unwrapZodEffects(schema)?.shape;
  if (!shape) return [];

  return Object.entries(shape)
    .filter(([, field]) => !isOptionalZodType(field))
    .map(([name]) => name);
}

function summarizeActionSchemas(actionSchemas: any): any {
  if (!actionSchemas || typeof actionSchemas !== 'object') return undefined;

  return Object.fromEntries(
    Object.entries(actionSchemas).map(([action, entry]: [string, any]) => [
      action,
      {
        description: entry.description,
        aliases: entry.aliases || [],
        required: getRequiredKeys(entry.schema),
        inputSchema: describeZodType(entry.schema)
      }
    ])
  );
}

export async function handleLoadToolSchema(args: LoadToolSchemaArgs): Promise<{
  toolName: string;
  description: string;
  inputSchema: any;
  actionSchemas?: any;
  metadata: ToolMetadata;
  note: string;
} | {
  error: string;
  suggestion: string;
  similarTools: string[];
}> {
  const registry = buildConsolidatedRegistry();
  const tool = registry[args.toolName];
  
  if (!tool) {
    // Find similar tool names
    const allNames = Object.keys(registry);
    const similar = allNames.filter(name => 
      name.toLowerCase().includes(args.toolName.toLowerCase()) ||
      args.toolName.toLowerCase().includes(name.toLowerCase().split('_')[0])
    ).slice(0, 5);
    
    return {
      error: `Unknown tool: ${args.toolName}`,
      suggestion: 'Use search_tools to find the correct tool name.',
      similarTools: similar.length > 0 ? similar : allNames.slice(0, 10)
    };
  }
  
  // Get the full schema with sessionId extension (handle all Zod types)
  let fullSchema: any;
  const sessionIdExt = { sessionId: z.string().optional().describe('Optional session ID for request tracking') };
  if (typeof tool.schema.extend === 'function') {
    fullSchema = tool.schema.extend(sessionIdExt);
  } else {
    // Fallback for .omit()/.pick() schemas
    fullSchema = tool.schema.and(z.object(sessionIdExt));
  }
  
  return {
    toolName: args.toolName,
    description: tool.metadata.description,
    inputSchema: fullSchema.shape ? summarizeZodShape(fullSchema.shape) : describeZodType(fullSchema),
    actionSchemas: summarizeActionSchemas(tool.actionSchemas),
    metadata: tool.metadata,
    note: tool.actionSchemas
      ? 'Schema loaded successfully. Use actionSchemas for action-specific required fields; the top-level inputSchema is the shared MCP registration surface.'
      : 'Schema loaded successfully.'
  };
}

// === META TOOL DEFINITIONS ===

export const MetaTools = {
  SEARCH_TOOLS: {
    name: 'search_tools',
    description: 'Search for available RPG tools by category, capability, or keyword. Use this to discover tools before using them.',
    inputSchema: SearchToolsSchema
  },
  LOAD_TOOL_SCHEMA: {
    name: 'load_tool_schema', 
    description: 'Load the full input schema for a specific tool (required before first use). Returns parameter definitions, types, and usage info.',
    inputSchema: LoadToolSchemaSchema
  }
};
