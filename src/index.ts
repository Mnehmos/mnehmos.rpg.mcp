// Main entry point for the Unified MCP Simulation Server
console.error('rpg-mcp-server v1.0.2');
export * from './schema/index.js';
export * from './storage/index.js';

// Import the server to start it
import './server/index.js';
