/**
 * RPG-MCP Server - Dynamic Loader Pattern Implementation
 * 
 * Token reduction: ~50K → ~6-8K (85%+ reduction)
 * 
 * Meta-tools (search_tools, load_tool_schema) enable:
 * - Tool discovery by keyword/category
 * - On-demand schema loading
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Meta-tools and registry
import { MetaTools, handleSearchTools, handleLoadToolSchema } from './meta-tools.js';
import { buildToolRegistry } from './tool-registry.js';
// MINIMAL_SCHEMA removed - must pass actual schema for MCP SDK to pass arguments

// PubSub and utilities
import { PubSub } from '../engine/pubsub.js';
import { registerEventTools } from './events.js';
import { AuditLogger } from './audit.js';
import { withSession } from './types.js';
import { closeDb, getDbPath } from '../storage/index.js';

// PubSub setters (needed for world/combat tools)
import { setWorldPubSub } from './tools.js';
import { setCombatPubSub } from './combat-tools.js';

/**
 * Setup graceful shutdown handlers to ensure database is properly closed.
 */
function setupShutdownHandlers(): void {
  let isShuttingDown = false;

  const shutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.error(`[Server] Received ${signal}, shutting down gracefully...`);

    try {
      closeDb();
      console.error('[Server] Shutdown complete');
      process.exit(0);
    } catch (e) {
      console.error('[Server] Error during shutdown:', (e as Error).message);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  if (process.platform === 'win32') {
    process.on('SIGBREAK', () => shutdown('SIGBREAK'));
  }

  process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught exception:', error);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled rejection:', reason);
    shutdown('unhandledRejection');
  });

  process.on('exit', (code) => {
    if (!isShuttingDown) {
      console.error(`[Server] Process exiting with code ${code}`);
      closeDb();
    }
  });
}

async function main() {
  setupShutdownHandlers();
  console.error(`[Server] Database path: ${getDbPath()}`);

  const server = new McpServer({
    name: 'rpg-mcp',
    version: '1.1.0'
  });

  // Initialize PubSub
  const pubsub = new PubSub();
  setCombatPubSub(pubsub);
  setWorldPubSub(pubsub);

  // Register Event Tools
  registerEventTools(server, pubsub);

  // Initialize AuditLogger
  const auditLogger = new AuditLogger();

  // =========================================================================
  // META-TOOLS: Register with FULL schemas (they're the discovery mechanism)
  // =========================================================================
  
  server.tool(
    MetaTools.SEARCH_TOOLS.name,
    MetaTools.SEARCH_TOOLS.description,
    MetaTools.SEARCH_TOOLS.inputSchema.extend({ sessionId: z.string().optional() }).shape,
    auditLogger.wrapHandler(MetaTools.SEARCH_TOOLS.name, withSession(MetaTools.SEARCH_TOOLS.inputSchema, handleSearchTools))
  );

  server.tool(
    MetaTools.LOAD_TOOL_SCHEMA.name,
    MetaTools.LOAD_TOOL_SCHEMA.description,
    MetaTools.LOAD_TOOL_SCHEMA.inputSchema.extend({ sessionId: z.string().optional() }).shape,
    auditLogger.wrapHandler(MetaTools.LOAD_TOOL_SCHEMA.name, withSession(MetaTools.LOAD_TOOL_SCHEMA.inputSchema, handleLoadToolSchema))
  );

  // =========================================================================
  // ALL OTHER TOOLS: Register with MINIMAL schemas (85%+ token reduction)
  // =========================================================================
  
  const registry = buildToolRegistry();
  const toolCount = Object.keys(registry).length;
  const sessionIdSchema = z.object({ sessionId: z.string().optional() });
  
  for (const [toolName, entry] of Object.entries(registry)) {
    // Handle all Zod schema types (object, omit, pick, etc.)
    // .extend() only works on z.object(), so we use .and() which works universally
    let extendedSchema: any;
    if (typeof entry.schema.extend === 'function') {
      // Standard z.object() - use .extend() for best performance
      extendedSchema = entry.schema.extend({ sessionId: z.string().optional() });
    } else if (typeof entry.schema.and === 'function') {
      // .omit(), .pick(), or other transformed schemas - use .and()
      extendedSchema = entry.schema.and(sessionIdSchema);
    } else {
      // Fallback: wrap in intersection
      extendedSchema = z.intersection(entry.schema, sessionIdSchema);
    }
    
    server.tool(
      toolName,
      entry.metadata.description,
      extendedSchema.shape || extendedSchema._def?.schema?.shape || {},
      auditLogger.wrapHandler(
        toolName,
        withSession(entry.schema, entry.handler as any)
      )
    );
  }

  console.error(`[Server] Registered ${toolCount} tools with minimal schemas`);
  console.error(`[Server] Meta-tools: search_tools, load_tool_schema`);

  // =========================================================================
  // TRANSPORT SETUP
  // =========================================================================
  
  const args = process.argv.slice(2);
  const transportType = args.includes('--tcp') ? 'tcp'
    : (args.includes('--unix') || args.includes('--socket')) ? 'unix'
    : (args.includes('--ws') || args.includes('--websocket')) ? 'websocket'
    : 'stdio';

  if (transportType === 'tcp') {
    const { TCPServerTransport } = await import('./transport/tcp.js');
    const portIndex = args.indexOf('--port');
    const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3000;

    const transport = new TCPServerTransport(port);
    await server.connect(transport);
    console.error(`RPG MCP Server running on TCP port ${port}`);
  } else if (transportType === 'unix') {
    const { UnixServerTransport } = await import('./transport/unix.js');
    let socketPath = '';
    const unixIndex = args.indexOf('--unix');
    const socketIndex = args.indexOf('--socket');

    if (unixIndex !== -1 && args[unixIndex + 1]) {
      socketPath = args[unixIndex + 1];
    } else if (socketIndex !== -1 && args[socketIndex + 1]) {
      socketPath = args[socketIndex + 1];
    }

    if (!socketPath) {
      socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\rpg-mcp' : '/tmp/rpg-mcp.sock';
    }

    const transport = new UnixServerTransport(socketPath);
    await server.connect(transport);
    console.error(`RPG MCP Server running on Unix socket ${socketPath}`);
  } else if (transportType === 'websocket') {
    const { WebSocketServerTransport } = await import('./transport/websocket.js');
    const portIndex = args.indexOf('--port');
    const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3001;

    const transport = new WebSocketServerTransport(port);
    await server.connect(transport);
    console.error(`RPG MCP Server running on WebSocket port ${port}`);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('RPG MCP Server running on stdio');
  }
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
