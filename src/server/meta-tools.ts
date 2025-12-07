/**
 * Meta-Tools for Dynamic Loader Pattern
 * 
 * search_tools - Discover tools by keyword, category, or capability
 * load_tool_schema - Load full schema for a specific tool on-demand
 */

import { z } from 'zod';
import { buildToolRegistry, getAllToolMetadata, getToolCategories } from './tool-registry.js';
import { ToolMetadata } from './tool-metadata.js';

// === SEARCH_TOOLS ===

export const SearchToolsSchema = z.object({
  query: z.string().optional().describe('Natural language or keyword query to search for tools'),
  category: z.enum([
    'world', 'combat', 'character', 'inventory', 'quest', 'party',
    'math', 'strategy', 'secret', 'concentration', 'rest', 'scroll',
    'aura', 'npc', 'spatial', 'theft', 'corpse', 'improvisation',
    'turn-management', 'meta'
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
  content: Array<{ type: 'tool_reference'; tool_name: string } | { type: 'text'; text: string }>;
}> {
  const allMetadata = getAllToolMetadata();
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
  
  // Build content array with tool_reference blocks for automatic expansion
  // This allows Anthropic API to automatically load deferred tool definitions
  const content: Array<{ type: 'tool_reference'; tool_name: string } | { type: 'text'; text: string }> = [];
  
  // Add tool_reference for each discovered tool (Anthropic will auto-expand)
  for (const tool of truncated) {
    content.push({ type: 'tool_reference', tool_name: tool.name });
  }
  
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
    categories_available: getToolCategories(),
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

export async function handleLoadToolSchema(args: LoadToolSchemaArgs): Promise<{
  toolName: string;
  description: string;
  inputSchema: any;
  metadata: ToolMetadata;
  note: string;
} | {
  error: string;
  suggestion: string;
  similarTools: string[];
}> {
  const registry = buildToolRegistry();
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
    inputSchema: fullSchema.shape || {},
    metadata: tool.metadata,
    note: `Schema loaded successfully. You can now call ${args.toolName} with these parameters.`
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
