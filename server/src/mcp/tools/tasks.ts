/**
 * MCP Task Tools
 * 
 * Priority 1 tools for task management:
 * - create_task: Add a task to a project
 * - get_task: Read a single task
 * - update_task: Update task fields (status, priority, etc.)
 * - lock_task: Claim a task before working
 * - task_heartbeat: Extend lock while working
 * - unlock_task: Release a stuck lock
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getProject, setProject, isCacheHydrated } from '../../cache/index.js';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Task, TaskStatus, Priority } from '../../types/index.js';

// Helper to persist tasks to disk
async function persistTasks(projectId: string, project: ReturnType<typeof getProject>): Promise<void> {
  if (!project) return;
  
  const tasksJsonPath = join(project.path, 'tasks.json');
  const raw = JSON.parse(await readFile(tasksJsonPath, 'utf-8'));
  
  raw.tasks = project.tasks;
  raw.metadata = {
    ...raw.metadata,
    totalTasks: project.tasks.length,
    completedTasks: project.tasks.filter((t: Task) => t.status === 'done').length,
    inProgressTasks: project.tasks.filter((t: Task) => t.status === 'in_progress').length,
    pendingTasks: project.tasks.filter((t: Task) => t.status === 'pending').length,
    lastUpdated: new Date().toISOString()
  };
  
  await writeFile(tasksJsonPath, JSON.stringify(raw, null, 2));
}

// Generate next task ID
function generateTaskId(tasks: Task[]): string {
  const nums = tasks
    .map(t => parseInt(t.id.replace('task-', ''), 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `task-${next.toString().padStart(3, '0')}`;
}

export function registerTaskTools(server: McpServer) {
  // create_task: POST /api/projects/:id/tasks
  server.registerTool(
    'create_task',
    {
      title: 'Create Task',
      description: 'Add a new task to a project',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID'),
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
        tier: z.number().int().min(0).describe('Tier number (0-5)'),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Task priority'),
        agent: z.string().optional().describe('Assigned agent role'),
        depends_on: z.array(z.string()).optional().describe('Array of task IDs this depends on'),
        gate: z.string().nullable().optional().describe('Gate name (qa, security, review) or null'),
        requires_human: z.boolean().optional().describe('Whether this task requires human approval')
      })
    },
    async ({ projectId, title, description, tier, priority, agent, depends_on, gate, requires_human }) => {
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

      const now = new Date().toISOString();
      const taskId = generateTaskId(project.tasks);

      const task: Task = {
        id: taskId,
        title,
        description: description || '',
        status: 'pending',
        priority: priority || 'medium',
        tier,
        agent,
        created: now,
        depends_on: depends_on || [],
        gate: gate || null,
        requires_human: requires_human || false,
        locked_by: null,
        locked_at: null,
        reclaim_after: null,
        last_updated_at: now,
        last_updated_by: null
      };

      project.tasks.push(task);
      await persistTasks(projectId, project);
      setProject(projectId, project);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, taskId, task })
        }]
      };
    }
  );

  // get_task: GET /api/projects/:id/tasks/:taskId
  server.registerTool(
    'get_task',
    {
      title: 'Get Task',
      description: 'Get a single task by ID',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID'),
        taskId: z.string().describe('Task ID (e.g., task-001)')
      })
    },
    async ({ projectId, taskId }) => {
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

      const task = project.tasks.find(t => t.id === taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Task "${taskId}" not found` }) }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, taskId, projectId, task })
        }]
      };
    }
  );

  // update_task: PATCH /api/projects/:id/tasks/:taskId
  server.registerTool(
    'update_task',
    {
      title: 'Update Task',
      description: 'Update a task — status, priority, title, description, or any writable field. Setting status to done or failed automatically clears the lock.',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID'),
        taskId: z.string().describe('Task ID'),
        status: z.enum(['pending', 'in_progress', 'done', 'blocked', 'failed']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        agent: z.string().optional(),
        tier: z.number().int().min(0).optional(),
        depends_on: z.array(z.string()).optional(),
        gate: z.string().nullable().optional(),
        requires_human: z.boolean().optional(),
        updated_by: z.string().optional().describe('Agent/user making the update')
      })
    },
    async ({ projectId, taskId, updated_by, ...updates }) => {
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

      const task = project.tasks.find(t => t.id === taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Task "${taskId}" not found` }) }]
        };
      }

      const now = new Date().toISOString();
      const changes: string[] = [];

      // Status changes with lock clearing
      if (updates.status && updates.status !== task.status) {
        changes.push(`status: ${task.status} → ${updates.status}`);
        task.status = updates.status as TaskStatus;

        // Clear lock on done/failed
        if (updates.status === 'done' || updates.status === 'failed') {
          task.locked_by = null;
          task.locked_at = null;
          task.reclaim_after = null;
          if (updates.status === 'done') {
            task.completed = now;
          }
        }

        // Set started timestamp on first in_progress
        if (updates.status === 'in_progress' && !task.started) {
          task.started = now;
        }
      }

      // Other field updates
      if (updates.priority && updates.priority !== task.priority) {
        changes.push(`priority: ${task.priority} → ${updates.priority}`);
        task.priority = updates.priority as Priority;
      }

      if (updates.title && updates.title !== task.title) {
        task.title = updates.title;
        changes.push('title updated');
      }

      if (updates.description !== undefined && updates.description !== task.description) {
        task.description = updates.description;
        changes.push('description updated');
      }

      if (updates.agent !== undefined && updates.agent !== task.agent) {
        task.agent = updates.agent;
        changes.push('agent updated');
      }

      if (updates.tier !== undefined && updates.tier !== task.tier) {
        task.tier = updates.tier;
        changes.push(`tier: ${task.tier} → ${updates.tier}`);
      }

      if (updates.depends_on) {
        task.depends_on = updates.depends_on;
        changes.push('dependencies updated');
      }

      if (updates.gate !== undefined) {
        task.gate = updates.gate;
        changes.push('gate updated');
      }

      if (updates.requires_human !== undefined) {
        task.requires_human = updates.requires_human;
        changes.push(`requires_human: ${updates.requires_human}`);
      }

      // Update audit fields
      task.last_updated_at = now;
      task.last_updated_by = updated_by || null;

      // Persist changes
      await persistTasks(projectId, project);
      setProject(projectId, project);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, taskId, projectId, task, changes })
        }]
      };
    }
  );

  // lock_task: PATCH /api/projects/:id/tasks/:taskId/lock
  server.registerTool(
    'lock_task',
    {
      title: 'Lock Task',
      description: 'Claim a task before working on it. Checks dependencies and human gates.',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID'),
        taskId: z.string().describe('Task ID'),
        agent: z.string().describe('Agent name claiming the task'),
        reclaim_after_minutes: z.number().int().min(1).optional().describe('Lock duration in minutes (default: 15)')
      })
    },
    async ({ projectId, taskId, agent, reclaim_after_minutes }) => {
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

      const task = project.tasks.find(t => t.id === taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Task "${taskId}" not found` }) }]
        };
      }

      // Check if task is already done/failed/blocked
      if (['done', 'failed', 'blocked'].includes(task.status)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Task "${taskId}" cannot be locked (status: ${task.status})` })
          }]
        };
      }

      // Check human gate
      if (task.requires_human) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Task "${taskId}" requires human approval before it can be claimed` })
          }]
        };
      }

      // Check dependencies
      if (task.depends_on && task.depends_on.length > 0) {
        const incompleteDeps = task.depends_on.filter(depId => {
          const dep = project.tasks.find(t => t.id === depId);
          return !dep || dep.status !== 'done';
        });

        if (incompleteDeps.length > 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Dependencies not satisfied',
                message: `Blocked by incomplete dependencies: ${incompleteDeps.join(', ')}`
              })
            }]
          };
        }
      }

      const now = new Date().toISOString();
      const reclaimMinutes = reclaim_after_minutes || 15;
      const reclaimAfter = new Date(Date.now() + reclaimMinutes * 60000).toISOString();

      // Set lock fields
      task.locked_by = agent;
      task.locked_at = now;
      task.reclaim_after = reclaimAfter;
      task.status = 'in_progress';
      if (!task.started) {
        task.started = now;
      }
      task.last_updated_at = now;
      task.last_updated_by = agent;

      // Persist changes
      await persistTasks(projectId, project);
      setProject(projectId, project);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            taskId,
            projectId,
            task,
            message: `Task locked by ${agent}, reclaim after ${reclaimAfter}`
          })
        }]
      };
    }
  );

  // task_heartbeat: PATCH /api/projects/:id/tasks/:taskId/heartbeat
  server.registerTool(
    'task_heartbeat',
    {
      title: 'Task Heartbeat',
      description: 'Extend lock while working on a task',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID'),
        taskId: z.string().describe('Task ID'),
        agent: z.string().describe('Agent name (must match lock holder)')
      })
    },
    async ({ projectId, taskId, agent }) => {
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

      const task = project.tasks.find(t => t.id === taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Task "${taskId}" not found` }) }]
        };
      }

      // Verify lock holder
      if (task.locked_by !== agent) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'Lock mismatch',
              message: `Task is locked by "${task.locked_by}", not "${agent}"`
            })
          }]
        };
      }

      const reclaimAfter = new Date(Date.now() + 15 * 60000).toISOString();
      task.reclaim_after = reclaimAfter;
      task.last_updated_at = new Date().toISOString();
      task.last_updated_by = agent;

      // Persist changes
      await persistTasks(projectId, project);
      setProject(projectId, project);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            taskId,
            projectId,
            reclaim_after: reclaimAfter
          })
        }]
      };
    }
  );

  // unlock_task: POST /api/projects/:id/tasks/:taskId/unlock
  server.registerTool(
    'unlock_task',
    {
      title: 'Unlock Task',
      description: 'Force unlock a stuck task (recovery only). Resets status to pending.',
      inputSchema: z.object({
        projectId: z.string().describe('Project ID'),
        taskId: z.string().describe('Task ID')
      })
    },
    async ({ projectId, taskId }) => {
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

      const task = project.tasks.find(t => t.id === taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Task "${taskId}" not found` }) }]
        };
      }

      // Clear lock fields
      const wasLockedBy = task.locked_by;
      task.locked_by = null;
      task.locked_at = null;
      task.reclaim_after = null;
      task.status = 'pending';
      task.last_updated_at = new Date().toISOString();

      // Persist changes
      await persistTasks(projectId, project);
      setProject(projectId, project);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            taskId,
            projectId,
            message: wasLockedBy ? `Task unlocked (was locked by ${wasLockedBy})` : 'Task was not locked'
          })
        }]
      };
    }
  );
}
