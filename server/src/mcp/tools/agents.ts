/**
 * MCP Agent Tools
 * 
 * Priority 2 tools for agent management:
 * - list_agents: Get all available agents
 * - get_agent: Get a single agent's details
 * - list_expansions: Get all available expansions
 * - spawn_agent: Spawn an agent process
 * - get_running_agents: Get currently running agent processes
 * - terminate_agent: Terminate a running agent
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readdir, readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAllExpansions, getExpansion, parseExpansionList, buildExpansionContent } from '../../expansions/index.js';
import { getAllSkills } from '../../skills/index.js';
import { getProject } from '../../cache/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, '../../../../agents');

interface Agent {
  id: string;
  name: string;
  description: string;
  tools: string[];
  availableExpansions: string[];
  allExpansions: string[];
  allSkills: string[];
}

// Parse agent .md file frontmatter
async function parseAgentMd(filePath: string, id: string): Promise<Agent | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Parse YAML frontmatter
    const metadata: Record<string, string> = {};
    if (lines[0] === '---') {
      let i = 1;
      while (i < lines.length && lines[i] !== '---') {
        const line = lines[i];
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          metadata[key] = value;
        }
        i++;
      }
    }

    // Parse tools array (format: tools: [Read, Write, Edit, ...])
    let tools: string[] = [];
    if (metadata.tools) {
      const toolsMatch = metadata.tools.match(/\[(.*?)\]/);
      if (toolsMatch) {
        tools = toolsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    // Parse expansion field from frontmatter
    let availableExpansions: string[] = [];
    if (metadata.expansion) {
      availableExpansions = parseExpansionList(metadata.expansion);
    }

    // Get all available expansions and skills from registries
    const allExpansionIds = getAllExpansions().map(e => e.id);
    const allSkillIds = getAllSkills().map(s => s.id);

    return {
      id,
      name: metadata.name || id,
      description: metadata.description || 'No description available',
      tools,
      availableExpansions,
      allExpansions: allExpansionIds,
      allSkills: allSkillIds
    };
  } catch (err) {
    console.error(`[Agents] Error parsing agent file: ${filePath}`, err);
    return null;
  }
}

export function registerAgentTools(server: McpServer) {
  // list_agents: GET /api/agents
  server.registerTool(
    'list_agents',
    {
      title: 'List Agents',
      description: 'Get all available agent definitions from the agents/ directory',
      inputSchema: z.object({})
    },
    async () => {
      try {
        const entries = await readdir(AGENTS_DIR);
        const agents: Agent[] = [];

        for (const entry of entries) {
          const entryPath = join(AGENTS_DIR, entry);
          const stats = await stat(entryPath);

          // Only process .md files (skip directories)
          if (stats.isDirectory() || !entry.endsWith('.md')) {
            continue;
          }

          const agentId = entry.replace('.md', '').toLowerCase();
          const agent = await parseAgentMd(entryPath, agentId);

          if (agent) {
            agents.push(agent);
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, count: agents.length, agents })
          }]
        };
      } catch (err) {
        console.error('[Agents] Error listing agents:', err);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Failed to list agents', details: String(err) })
          }]
        };
      }
    }
  );

  // get_agent: GET /api/agents/:id
  server.registerTool(
    'get_agent',
    {
      title: 'Get Agent',
      description: 'Get details for a specific agent by ID',
      inputSchema: z.object({
        agentId: z.string().describe('Agent ID (e.g., coder, artist, qa)')
      })
    },
    async ({ agentId }) => {
      try {
        // Find agent file (case-insensitive)
        let filePath = '';
        const entries = await readdir(AGENTS_DIR);
        const agentFile = entries.find(entry =>
          entry.toLowerCase() === `${agentId.toLowerCase()}.md` && entry.endsWith('.md')
        );

        if (!agentFile) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Agent not found' }) }]
          };
        }

        filePath = join(AGENTS_DIR, agentFile);
        const agent = await parseAgentMd(filePath, agentId);

        if (!agent) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Agent not found' }) }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, agent })
          }]
        };
      } catch (err) {
        console.error('[Agents] Error getting agent:', err);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Failed to get agent', details: String(err) })
          }]
        };
      }
    }
  );

  // list_expansions: GET /api/agents/expansions/all
  server.registerTool(
    'list_expansions',
    {
      title: 'List Expansions',
      description: 'Get all available agent expansions',
      inputSchema: z.object({})
    },
    async () => {
      try {
        const expansions = getAllExpansions().map(e => ({
          id: e.id,
          name: e.name,
          description: e.description,
          type: e.type
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, count: expansions.length, expansions })
          }]
        };
      } catch (err) {
        console.error('[Agents] Error listing expansions:', err);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Failed to list expansions', details: String(err) })
          }]
        };
      }
    }
  );

  // spawn_agent: POST /api/agents/:id/spawn
  // Note: This is a simplified version - full spawn requires child_process which
  // is complex in stdio MCP context. Returns instructions for REST API.
  server.registerTool(
    'spawn_agent',
    {
      title: 'Spawn Agent',
      description: 'Get instructions for spawning an agent process. Note: Use REST API for actual spawning.',
      inputSchema: z.object({
        agentId: z.string().describe('Agent ID to spawn'),
        projectPath: z.string().optional().describe('Path to project directory'),
        taskId: z.string().optional().describe('Task ID to work on'),
        projectId: z.string().optional().describe('Project ID'),
        expansions: z.array(z.string()).optional().describe('Expansion IDs to activate')
      })
    },
    async ({ agentId, projectPath, taskId, projectId, expansions }) => {
      try {
        // Verify agent exists
        const entries = await readdir(AGENTS_DIR);
        const agentFile = entries.find(entry =>
          entry.toLowerCase() === `${agentId.toLowerCase()}.md` && entry.endsWith('.md')
        );

        if (!agentFile) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Agent not found' }) }]
          };
        }

        // Check if project is paused
        if (projectId) {
          const project = getProject(projectId);
          if (project && project.status === 'paused') {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: 'Project paused',
                  message: `Cannot spawn agent: Project ${projectId} is currently paused. Resume the workflow first.`
                })
              }]
            };
          }
        }

        // Parse available expansions
        const agent = await parseAgentMd(join(AGENTS_DIR, agentFile), agentId);
        const availableExpansionIds = agent?.availableExpansions || [];

        // Validate expansions
        let activeExpansions: string[] = [];
        let expansionWarnings: string[] = [];

        if (expansions && expansions.length > 0) {
          const validExpansions = expansions.filter(exp => {
            return availableExpansionIds.includes(exp) || getExpansion(exp) !== undefined;
          });

          const invalidExpansions = expansions.filter(exp => !validExpansions.includes(exp));
          if (invalidExpansions.length > 0) {
            expansionWarnings.push(`Invalid expansions ignored: ${invalidExpansions.join(', ')}`);
          }

          activeExpansions = validExpansions;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Use REST API POST /api/agents/:id/spawn for actual spawning',
              agentId,
              agentName: agentFile.replace('.md', ''),
              projectPath,
              taskId,
              projectId,
              availableExpansions: availableExpansionIds,
              requestedExpansions: expansions,
              activeExpansions,
              warnings: expansionWarnings,
              restEndpoint: `/api/agents/${agentId}/spawn`,
              restMethod: 'POST',
              restBody: {
                projectPath,
                taskId,
                projectId,
                expansions: activeExpansions
              }
            })
          }]
        };
      } catch (err) {
        console.error('[Agents] Error preparing spawn:', err);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Failed to prepare agent spawn', details: String(err) })
          }]
        };
      }
    }
  );

  // get_running_agents: GET /api/agents/status/running
  // Note: MCP server doesn't track running processes - this would need coordination
  // with the Express server. Returns instructions to use REST API.
  server.registerTool(
    'get_running_agents',
    {
      title: 'Get Running Agents',
      description: 'Get list of currently running agent processes. Note: Use REST API for actual status.',
      inputSchema: z.object({})
    },
    async () => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Running agents are tracked by the Express server. Use REST API:',
            restEndpoint: '/api/agents/status/running',
            restMethod: 'GET',
            note: 'The MCP server does not track spawned processes. Use the REST API or WebSocket events.'
          })
        }]
      };
    }
  );

  // terminate_agent: POST /api/agents/:pid/terminate
  // Note: Process termination requires the Express server's activeAgents map
  server.registerTool(
    'terminate_agent',
    {
      title: 'Terminate Agent',
      description: 'Terminate a running agent process. Note: Use REST API for actual termination.',
      inputSchema: z.object({
        pid: z.number().int().describe('Process ID of the agent to terminate')
      })
    },
    async ({ pid }) => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Process termination is handled by the Express server. Use REST API:',
            restEndpoint: `/api/agents/${pid}/terminate`,
            restMethod: 'POST',
            pid,
            note: 'The MCP server does not manage process lifecycle. Use the REST API.'
          })
        }]
      };
    }
  );
}
