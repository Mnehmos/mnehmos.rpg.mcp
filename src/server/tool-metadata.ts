/**
 * Tool Metadata Types for Dynamic Loader Pattern
 * Enables search_tools discovery and load_tool_schema on-demand loading
 */

export type ToolCategory =
  | 'world' | 'combat' | 'character' | 'inventory' | 'quest' | 'party'
  | 'math' | 'strategy' | 'secret' | 'concentration' | 'rest' | 'scroll'
  | 'aura' | 'npc' | 'spatial' | 'theft' | 'corpse' | 'improvisation'
  | 'turn-management' | 'meta' | 'batch' | 'context' | 'narrative' | 'composite'
  | 'agent';

export type TokenCost = 'low' | 'medium' | 'high' | 'variable';

export interface ToolMetadata {
  name: string;
  description: string;
  category: ToolCategory;
  keywords: string[];
  capabilities: string[];
  contextAware: boolean;
  estimatedTokenCost: TokenCost;
  usageExample: string;
  /** If true, tool is only loaded when discovered via search_tools (MCP spec) */
  deferLoading: boolean;
}

export interface ToolRegistryEntry {
  metadata: ToolMetadata;
  schema: any; // Zod schema
  actionSchemas?: any; // Action-specific schema documentation for consolidated tools
  handler: Function;
}

export interface ToolRegistry {
  [toolName: string]: ToolRegistryEntry;
}

// Minimal schema for MCP registration - empty shape, validation happens in handler
// The MCP SDK expects Zod schema shapes, so we export an empty object
export const MINIMAL_SCHEMA = {};
