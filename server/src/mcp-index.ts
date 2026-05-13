/**
 * TaskMaster MCP Server Entry Point
 * 
 * This is the stdio-based MCP server entry point that runs alongside
 * the Express REST server. It exposes TaskMaster functionality via
 * the Model Context Protocol for Claude Code integration.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { hydrateCache } from './scanner/index.js';
import { initWatcher } from './watcher/index.js';
import { registerProjectTools } from './mcp/tools/projects.js';
import { registerTaskTools } from './mcp/tools/tasks.js';
import { registerAgentTools } from './mcp/tools/agents.js';
import { registerSystemTools } from './mcp/tools/system.js';
import { registerLogTools } from './mcp/tools/logs.js';
import { registerLLMTools } from './mcp/tools/llm.js';

async function main() {
  // Hydrate cache from disk (same as Express server does)
  await hydrateCache();

  // Start file watcher so cache stays fresh during long sessions
  await initWatcher();

  const server = new McpServer({
    name: 'taskmaster',
    version: '3.0.0'
  });

  // Register all tool sets
  registerProjectTools(server);
  registerTaskTools(server);
  registerAgentTools(server);
  registerSystemTools(server);
  registerLogTools(server);
  registerLLMTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep process alive - the stdio transport handles JSON-RPC communication
  // No explicit loop needed as the transport manages the connection
}

main().catch((error) => {
  console.error('Fatal error in MCP server:', error);
  process.exit(1);
});
