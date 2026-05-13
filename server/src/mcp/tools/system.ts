/**
 * MCP System Tools
 * 
 * System-level and workflow management tools:
 * Priority 1:
 * - get_project_logs: Read activity log from project
 * - approve_tier: Advance tier after completion
 * - pause_workflow: Halt an active project
 * - resume_workflow: Resume a paused project
 * 
 * Priority 2/3:
 * - health_check: System health status
 * - get_tiers: Get tier definitions
 * - get_locks: List locked tasks in a project
 * - archive_project: Archive a project
 * - restore_project: Restore an archived project
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getProject, setProject, isCacheHydrated, getAllProjects } from '../../cache/index.js';
import { getTierDefinitions, MAX_TIER } from '../../types/index.js';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Task, Project } from '../../types/index.js';

export function registerSystemTools(server: McpServer) {
  // get_project_logs: GET /api/projects/:id/logs
  server.registerTool(
    'get_project_logs',
    {
      title: 'Get Project Logs',
      description: 'Read the activity log (agentlogs.md) from a project',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID'),
        lines: z.number().int().min(1).max(1000).optional().describe('Number of recent lines to return (default: 100)')
      })
    },
    async ({ projectId, lines }) => {
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

      try {
        const logsPath = join(project.path, 'agentlogs.md');
        const content = await readFile(logsPath, 'utf-8');
        const allLines = content.split('\n').filter(l => l.trim());
        const lineCount = lines || 100;
        const recentLines = allLines.slice(-lineCount);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              projectId,
              totalLines: allLines.length,
              returnedLines: recentLines.length,
              logs: recentLines
            })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              projectId,
              totalLines: 0,
              returnedLines: 0,
              logs: [],
              message: 'No logs found'
            })
          }]
        };
      }
    }
  );

  // approve_tier: POST /api/projects/:id/tier/approve
  server.registerTool(
    'approve_tier',
    {
      title: 'Approve Tier',
      description: 'Approve a completed tier and advance to the next tier',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID'),
        tier: z.number().int().min(0).max(5).optional().describe('Tier to approve (default: current tier)')
      })
    },
    async ({ projectId, tier }) => {
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

      const tierToApprove = tier !== undefined ? tier : project.currentTier;

      // Check if all tasks in this tier are done
      const tierTasks = project.tasks.filter(t => t.tier === tierToApprove);
      const incompleteTasks = tierTasks.filter(t => t.status !== 'done');

      if (incompleteTasks.length > 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'Tier not complete',
              message: `Tier ${tierToApprove} has ${incompleteTasks.length} incomplete tasks`,
              incompleteTasks: incompleteTasks.map(t => ({ id: t.id, title: t.title, status: t.status }))
            })
          }]
        };
      }

      const now = new Date().toISOString();

      // Mark tier as completed
      if (!project.completedTiers.includes(tierToApprove)) {
        project.completedTiers.push(tierToApprove);
      }

      // Advance current tier if needed
      if (project.currentTier === tierToApprove && project.currentTier < MAX_TIER) {
        project.currentTier++;
      }

      // Update project status
      if (project.currentTier >= MAX_TIER && tierToApprove === MAX_TIER) {
        project.status = 'completed';
      }

      project.metadata.lastUpdated = now;

      // Persist changes
      const tasksJsonPath = join(project.path, 'tasks.json');
      try {
        const raw = JSON.parse(await readFile(tasksJsonPath, 'utf-8'));
        raw.approvedTier = tierToApprove;
        raw.metadata = project.metadata;
        await writeFile(tasksJsonPath, JSON.stringify(raw, null, 2));
      } catch (error) {
        // Continue even if persist fails
      }

      setProject(projectId, project);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            projectId,
            approvedTier: tierToApprove,
            currentTier: project.currentTier,
            status: project.status,
            message: `Tier ${tierToApprove} approved. Current tier is now ${project.currentTier}.`
          })
        }]
      };
    }
  );

  // pause_workflow: POST /api/projects/:id/workflow/pause
  server.registerTool(
    'pause_workflow',
    {
      title: 'Pause Workflow',
      description: 'Pause an active project to halt workflow progression',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID')
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

      if (project.status !== 'active') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Project must be active to pause (current status: ${project.status})` })
          }]
        };
      }

      project.status = 'paused';
      project.metadata.lastUpdated = new Date().toISOString();

      // Persist changes
      const tasksJsonPath = join(project.path, 'tasks.json');
      try {
        const raw = JSON.parse(await readFile(tasksJsonPath, 'utf-8'));
        raw.paused = true;
        raw.metadata = project.metadata;
        await writeFile(tasksJsonPath, JSON.stringify(raw, null, 2));
      } catch (error) {
        // Continue even if persist fails
      }

      setProject(projectId, project);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, projectId, status: project.status, message: 'Project paused' })
        }]
      };
    }
  );

  // resume_workflow: POST /api/projects/:id/workflow/resume
  server.registerTool(
    'resume_workflow',
    {
      title: 'Resume Workflow',
      description: 'Resume a paused project',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID')
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

      if (project.status !== 'paused') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Project must be paused to resume (current status: ${project.status})` })
          }]
        };
      }

      project.status = 'active';
      project.metadata.lastUpdated = new Date().toISOString();

      // Persist changes
      const tasksJsonPath = join(project.path, 'tasks.json');
      try {
        const raw = JSON.parse(await readFile(tasksJsonPath, 'utf-8'));
        raw.paused = false;
        raw.metadata = project.metadata;
        await writeFile(tasksJsonPath, JSON.stringify(raw, null, 2));
      } catch (error) {
        // Continue even if persist fails
      }

      setProject(projectId, project);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, projectId, status: project.status, message: 'Project resumed' })
        }]
      };
    }
  );

  // health_check: GET /api/health
  server.registerTool(
    'health_check',
    {
      title: 'Health Check',
      description: 'Check system health status',
      inputSchema: z.object({})
    },
    async () => {
      const cacheStats = {
        isHydrated: isCacheHydrated(),
        projectCount: getAllProjects().length
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            status: 'healthy',
            cache: cacheStats,
            timestamp: new Date().toISOString()
          })
        }]
      };
    }
  );

  // get_tiers: GET /api/tiers
  server.registerTool(
    'get_tiers',
    {
      title: 'Get Tiers',
      description: 'Get all tier definitions (0-5)',
      inputSchema: z.object({})
    },
    async () => {
      const tiers = getTierDefinitions();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, tiers })
        }]
      };
    }
  );

  // get_locks: GET /api/projects/:id/tasks/locks
  server.registerTool(
    'get_locks',
    {
      title: 'Get Locks',
      description: 'Get all locked tasks in a project',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID')
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

      const lockedTasks = project.tasks.filter(t => t.locked_by && t.status === 'in_progress');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            projectId,
            lockedCount: lockedTasks.length,
            lockedTasks: lockedTasks.map(t => ({
              id: t.id,
              title: t.title,
              locked_by: t.locked_by,
              locked_at: t.locked_at,
              reclaim_after: t.reclaim_after
            }))
          })
        }]
      };
    }
  );

  // archive_project: POST /api/projects/:id/archive
  server.registerTool(
    'archive_project',
    {
      title: 'Archive Project',
      description: 'Move a project to the archive directory',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID')
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

      // Update status to archived
      project.status = 'archived';
      project.metadata.lastUpdated = new Date().toISOString();
      setProject(projectId, project);

      // Note: Actual file system move is handled by the Express server's archive endpoint
      // The MCP tool updates the cache state only

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            projectId,
            status: project.status,
            message: `Project "${projectId}" marked as archived. Note: Use REST API for full archive operation.`
          })
        }]
      };
    }
  );

  // restore_project: POST /api/projects/:id/restore
  server.registerTool(
    'restore_project',
    {
      title: 'Restore Project',
      description: 'Restore a project from the archive',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID')
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

      if (project.status !== 'archived') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Project must be archived to restore (current status: ${project.status})` })
          }]
        };
      }

      // Update status to active
      project.status = 'active';
      project.metadata.lastUpdated = new Date().toISOString();
      setProject(projectId, project);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            projectId,
            status: project.status,
            message: `Project "${projectId}" restored to active. Note: Use REST API for full restore operation.`
          })
        }]
      };
    }
  );
}
