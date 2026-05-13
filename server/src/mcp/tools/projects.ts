/**
 * MCP Project Tools
 * 
 * Priority 1 tools for project management:
 * - list_projects: Get all projects
 * - get_project: Get a single project with tasks
 * - create_project: Create a new project
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAllProjects, getProject, isCacheHydrated } from '../../cache/index.js';
import { getProjectsDir, getArchiveDir } from '../../scanner/index.js';
import type { Project, TasksJson } from '../../types/index.js';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export function registerProjectTools(server: McpServer) {
  // list_projects: GET /api/projects
  server.registerTool(
    'list_projects',
    {
      title: 'List Projects',
      description: 'Get all projects (active and archived) with their tasks and tier state',
      inputSchema: z.object({})
    },
    async () => {
      if (!isCacheHydrated()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Cache not yet hydrated' }) }]
        };
      }

      const projects = getAllProjects();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, count: projects.length, projects })
        }]
      };
    }
  );

  // get_project: GET /api/projects/:id
  server.registerTool(
    'get_project',
    {
      title: 'Get Project',
      description: 'Get a single project by ID with full task list and tier state',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID (folder name)')
      })
    },
    async ({ projectId }) => {
      if (!isCacheHydrated()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Cache not yet hydrated' }) }]
        };
      }

      const project = getProject(projectId);
      if (!project) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Project "${projectId}" not found` }) }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, project })
        }]
      };
    }
  );

  // create_project: POST /api/projects
  server.registerTool(
    'create_project',
    {
      title: 'Create Project',
      description: 'Create a new project with initial tasks.json and project.md',
      inputSchema: z.object({
        id: z.string().describe('Project ID (folder name, kebab-case)'),
        name: z.string().describe('Display name for the project'),
        description: z.string().optional().describe('Optional project description'),
        emoji: z.string().optional().describe('Optional emoji for the project')
      })
    },
    async ({ id, name, description, emoji }) => {
      if (!isCacheHydrated()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Cache not yet hydrated' }) }]
        };
      }

      // Validate project ID
      if (!/^[a-z0-9-]+$/.test(id)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Project ID must be kebab-case (lowercase letters, numbers, hyphens only)' })
          }]
        };
      }

      const projectsDir = getProjectsDir();
      const projectPath = join(projectsDir, id);

      // Check if project already exists
      if (existsSync(projectPath)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Project "${id}" already exists` }) }]
        };
      }

      const now = new Date().toISOString();

      // Create project directory
      await mkdir(projectPath, { recursive: true });

      // Create tasks.json
      const tasksJson: TasksJson = {
        tasks: [],
        approvedTier: 0,
        paused: false,
        metadata: {
          totalTasks: 0,
          completedTasks: 0,
          inProgressTasks: 0,
          pendingTasks: 0,
          lastUpdated: now,
          created: now
        }
      };

      await writeFile(
        join(projectPath, 'tasks.json'),
        JSON.stringify(tasksJson, null, 2)
      );

      // Create project.md
      const projectMd = `---
name: ${name}
${emoji ? `emoji: ${emoji}` : ''}
status: active
created: ${now.split('T')[0]}
---

# ${name}

${description || 'No description available.'}
`;

      await writeFile(join(projectPath, 'project.md'), projectMd);

      // Create agentlogs.md (empty)
      await writeFile(join(projectPath, 'agentlogs.md'), '');

      // Build project object for response
      const project: Project = {
        id,
        name,
        description: description || '',
        path: projectPath,
        currentTier: 0,
        status: 'active',
        created: now,
        lastAccessed: now,
        tasks: [],
        metadata: tasksJson.metadata!,
        completedTiers: []
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, projectId: id, project })
        }]
      };
    }
  );
}
