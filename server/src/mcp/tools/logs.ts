/**
 * MCP Log Tools
 * 
 * Priority 3 tools for log access:
 * - get_logs: Get system logs
 * 
 * Note: Most logging is done via get_project_logs in system.ts.
 * This file provides additional system-wide log access if needed.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '../../../../logs');

export function registerLogTools(server: McpServer) {
  // get_logs: GET /api/logs
  server.registerTool(
    'get_logs',
    {
      title: 'Get System Logs',
      description: 'Get system-wide logs (if available). For project-specific logs, use get_project_logs.',
      inputSchema: z.object({
        type: z.enum(['system', 'error', 'access']).optional().describe('Log type to retrieve'),
        lines: z.number().int().min(1).max(1000).optional().describe('Number of recent lines (default: 50)')
      })
    },
    async ({ type, lines }) => {
      try {
        // This is a placeholder implementation
        // Actual log files would depend on your logging setup
        const lineCount = lines || 50;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'System logs are managed by the Express server and PM2',
              note: 'Use PM2 logs or the REST API for detailed system logs',
              pm2Commands: {
                viewLogs: 'pm2 logs taskmaster-server',
                viewErrors: 'pm2 logs taskmaster-server --err',
                viewLines: `pm2 logs taskmaster-server --lines ${lineCount}`
              },
              type: type || 'system',
              requestedLines: lineCount
            })
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Failed to get logs', details: String(err) })
          }]
        };
      }
    }
  );
}
