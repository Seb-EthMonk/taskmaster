import { Router, Request, Response } from 'express';
import { isCacheHydrated, getProject, setProject } from '../cache/index.js';
import { broadcastProjectUpdated, broadcastError, broadcastTaskCompleted, broadcastLogUpdated, broadcastAgentHeartbeat, broadcastAgentSpawned, broadcastAgentOutput, broadcastAgentExited } from '../websocket/broadcaster.js';
import { removeLockFile, createLockFile } from '../services/lock-recovery.js';
import { checkAndConsumeEnergy, ENERGY_COSTS } from '../services/energy.js';
import { loadSettings } from './settings.js';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { readFile, writeFile } from 'fs/promises';

const router = Router({ mergeParams: true });

const PROJECTS_DIR = join(__dirname, '../../../projects');

// Extend Express Request type to include our params
type TaskExecutionRequest = Request<{ projectId: string; taskId: string }>;

import type { Task } from '../types/index.js';

/**
 * Check if a task's dependencies are all completed.
 * Returns an error message string if blocked, or null if clear.
 */
function checkDependencies(task: Task, allTasks: Task[]): string | null {
  if (!task.depends_on?.length) return null;
  const blocked = task.depends_on.filter(depId => {
    const dep = allTasks.find(t => t.id === depId);
    return !dep || dep.status !== 'done';
  });
  return blocked.length
    ? `Blocked by incomplete dependencies: ${blocked.join(', ')}`
    : null;
}

/**
 * POST /api/projects/:projectId/tasks
 * Create a new task for a project.
 *
 * Request body:
 * - title: string (required)
 * - description?: string
 * - tier?: number
 * - priority?: string (default 'medium')
 * - agent?: string
 * - depends_on?: string[]
 * - requires_human?: boolean
 * - gate?: string
 * - heartbeat_interval?: number
 *
 * Response:
 * - 201 Created: Task created successfully
 * - 400 Bad Request: Missing required fields
 * - 404 Not Found: Project not found
 * - 503 Service Unavailable: Cache not hydrated
 */
router.post('/', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { title, description, tier, priority, agent, depends_on, requires_human, gate, heartbeat_interval } = req.body;

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'title is required'
      });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    // Generate task ID based on current count
    const tasksJsonPath = join(PROJECTS_DIR, projectId, 'tasks.json');
    let tasksData: any = { tasks: [], metadata: {} };
    try {
      const content = await readFile(tasksJsonPath, 'utf-8');
      tasksData = JSON.parse(content);
    } catch {
      // tasks.json may not exist yet
    }

    const existingTasks = tasksData.tasks || [];
    const maxNum = existingTasks.reduce((max: number, t: any) => {
      const match = String(t.id).match(/task-(\d+)/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    const now = new Date().toISOString();
    const newTask: any = {
      id: `task-${String(maxNum + 1).padStart(3, '0')}`,
      title: title.trim(),
      description: description?.trim() || '',
      status: 'pending',
      priority: priority || 'medium',
      tier: tier ?? 0,
      created: now,
      ...(agent ? { agent } : {}),
      ...(depends_on ? { depends_on } : {}),
      ...(requires_human !== undefined ? { requires_human } : {}),
      ...(gate !== undefined ? { gate } : {}),
      ...(heartbeat_interval !== undefined ? { heartbeat_interval } : {})
    };

    tasksData.tasks = tasksData.tasks || [];
    tasksData.tasks.push(newTask);
    tasksData.metadata = tasksData.metadata || {};
    tasksData.metadata.updated = now;
    tasksData.metadata.totalTasks = tasksData.tasks.length;
    tasksData.metadata.pendingTasks = tasksData.tasks.filter((t: any) => t.status === 'pending').length;
    tasksData.metadata.completedTasks = tasksData.tasks.filter((t: any) => t.status === 'done').length;
    tasksData.metadata.inProgressTasks = tasksData.tasks.filter((t: any) => t.status === 'in_progress').length;

    await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));

    // Update cache
    project.tasks.push(newTask);
    project.metadata.totalTasks = tasksData.tasks.length;
    project.metadata.pendingTasks = tasksData.metadata.pendingTasks;
    project.metadata.lastUpdated = now;
    setProject(projectId, project);

    broadcastProjectUpdated(projectId, 'updated');

    console.log(`[TasksAPI] Created task ${newTask.id} in project ${projectId}`);
    return res.status(201).json(newTask);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error creating task:`, err);
    return res.status(500).json({
      error: 'Failed to create task',
      message: errorMessage
    });
  }
});

/**
 * GET /api/projects/:projectId/locks
 * Get active lock files for a project.
 * NOTE: This must be defined BEFORE parameterized routes like /:taskId
 *
 * Response:
 * - 200 OK: Returns list of active locks
 * - 404 Not Found: Project not found
 * - 503 Service Unavailable: Cache not hydrated
 */
router.get('/locks', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    // Check if cache is hydrated
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    // Validate project exists
    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    // Import scanProjectLocks dynamically to avoid circular dependencies
    const { scanProjectLocks } = await import('../services/lock-recovery.js');
    const result = await scanProjectLocks(projectId);

    res.json({
      projectId,
      activeLocks: result.recovered.map(lock => ({
        taskId: lock.taskId,
        agent: lock.lockInfo?.agent,
        timestamp: lock.lockInfo?.timestamp,
        age: lock.lockInfo?.age,
        elapsedTime: formatElapsedTime(lock.lockInfo?.age || 0)
      })),
      totalLocks: result.totalLocks,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error getting locks:`, err);
    res.status(500).json({
      error: 'Failed to get locks',
      message: errorMessage
    });
  }
});

/**
 * POST /api/projects/:projectId/tasks/:taskId/execute
 * Execute a specific task by ID.
 *
 * Request body (optional):
 * - agentRole: string - Override the agent role for this execution
 *
 * Response:
 * - 202 Accepted: Task execution started
 * - 400 Bad Request: Invalid request
 * - 404 Not Found: Project or task not found
 * - 409 Conflict: Task is already running or locked
 * - 503 Service Unavailable: Cache not hydrated
 * - 500 Internal Server Error: Runtime error
 */
router.post('/:taskId/execute', async (req: TaskExecutionRequest, res: Response) => {
  const { projectId, taskId } = req.params;
  const { agentRole } = req.body;

  try {
    // Check if cache is hydrated
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    // Validate project exists
    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    // Find the task
    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
        message: `No task found with ID: ${taskId} in project: ${projectId}`
      });
    }

    // Check if task is available for execution
    // Task must be in 'pending' or 'in_progress' status
    if (task.status === 'done') {
      return res.status(400).json({
        error: 'Task already completed',
        message: `Task ${taskId} is already completed`
      });
    }

    if (task.status === 'blocked') {
      return res.status(400).json({
        error: 'Task is blocked',
        message: `Task ${taskId} is blocked and cannot be executed`
      });
    }

    // Check if task is already running (locked)
    // Note: The Runtime will handle actual locking, but we can do a preliminary check
    if (task.status === 'in_progress') {
      // Allow re-execution if it's already in progress (retry scenario)
      // The Runtime's lock mechanism will handle concurrent access
      console.log(`[TasksAPI] Task ${taskId} is already in progress, allowing retry`);
    }

    // Generate execution ID for tracking
    const executionId = `${projectId}-${taskId}-${Date.now()}`;

    console.log(`[TasksAPI] Starting task execution: ${executionId}`, agentRole ? `(with agentRole: ${agentRole})` : '');

    // Start execution asynchronously - don't await, return 202 immediately
    // The Runtime will handle the execution and emit events via WebSocket
    executeTaskWithLogging(projectId, taskId, executionId, agentRole);

    // Return 202 Accepted immediately
    res.status(202).json({
      success: true,
      executionId,
      projectId,
      taskId,
      status: 'started',
      message: 'Task execution started',
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error starting task execution:`, err);

    broadcastError(
      'Failed to start task execution',
      'TASK_EXECUTION_ERROR',
      { projectId, taskId, message: errorMessage }
    );

    res.status(500).json({
      error: 'Failed to start task execution',
      message: errorMessage
    });
  }
});

/**
 * Execute task with logging and error handling.
 * This runs asynchronously after returning 202 to the client.
 * 
 * NOTE: With MCP integration, actual task execution is handled by Claude Code
 * via MCP tools. This function just ensures the task is properly locked and
 * logs the execution request.
 */
async function executeTaskWithLogging(
  projectId: string,
  taskId: string,
  executionId: string,
  agentRole?: string
): Promise<void> {
  try {
    console.log(`[TasksAPI] Task ${taskId} ready for MCP execution (execution: ${executionId})`);
    console.log(`[TasksAPI] Use MCP tools to work on this task: get_task, update_task, etc.`);

    // With MCP, we don't spawn a runtime process.
    // The task is already locked by the /execute endpoint.
    // Claude Code (via MCP) will perform the work and update task status.

    // Broadcast project update to notify all subscribers
    broadcastProjectUpdated(projectId, 'updated');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[TasksAPI] Task execution setup failed: ${executionId}`, errorMessage);

    // Broadcast error to project subscribers
    broadcastError(
      `Task execution failed: ${errorMessage}`,
      'TASK_EXECUTION_ERROR',
      { projectId, taskId, executionId, error: errorMessage }
    );

    // Still broadcast project update as task status may have changed
    broadcastProjectUpdated(projectId, 'updated');
  }
}

/**
 * PATCH /api/projects/:projectId/tasks/:taskId/lock
 * Claim a task (lightweight — no process spawn).
 *
 * Request body:
 * - agent: string (required)
 * - reclaim_after_minutes?: number (default 15)
 *
 * Response:
 * - 200 OK: Task claimed successfully
 * - 400 Bad Request: Missing agent or task not claimable
 * - 404 Not Found: Project or task not found
 * - 409 Conflict: Dependencies not met or requires human approval
 * - 503 Service Unavailable: Cache not hydrated
 */
router.patch('/:taskId/lock', async (req: TaskExecutionRequest, res: Response) => {
  const { projectId, taskId } = req.params;
  const { agent, reclaim_after_minutes = 15 } = req.body;

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    if (!agent || typeof agent !== 'string') {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'agent is required'
      });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
        message: `No task found with ID: ${taskId} in project: ${projectId}`
      });
    }

    // Block on terminal/locked statuses
    if (['done', 'failed', 'blocked'].includes(task.status)) {
      return res.status(400).json({
        error: 'Task not claimable',
        message: `Task ${taskId} has status '${task.status}' and cannot be locked`
      });
    }

    // Dependency gate
    const depError = checkDependencies(task, project.tasks);
    if (depError) {
      return res.status(409).json({
        error: 'Dependencies not satisfied',
        message: depError
      });
    }

    // Human gate
    if (task.requires_human === true) {
      return res.status(409).json({
        error: 'Requires human approval',
        message: `Task ${taskId} requires human approval before it can be claimed`
      });
    }

    // Energy gate — check after deps and human gate, before claiming
    const energyCost = ENERGY_COSTS[task.priority ?? 'medium'] ?? ENERGY_COSTS.medium;
    const energyResult = await checkAndConsumeEnergy(
      energyCost,
      `Task dispatch: ${taskId} (${task.priority ?? 'medium'})`
    );
    if (!energyResult.success) {
      return res.status(409).json({
        error: 'Insufficient energy',
        message: 'Energy system is enabled and current energy is 0. Feed your TaskMaster to continue.',
        currentEnergy: energyResult.currentEnergy,
        maxEnergy: energyResult.maxEnergy,
      });
    }

    const now = new Date().toISOString();
    const reclaimAt = new Date(Date.now() + reclaim_after_minutes * 60 * 1000).toISOString();

    task.locked_by = agent;
    task.locked_at = now;
    task.reclaim_after = reclaimAt;
    task.status = 'in_progress';
    if (!task.started) task.started = now;
    task.last_updated_by = agent;
    task.last_updated_at = now;

    // Update metadata
    project.metadata.inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
    project.metadata.pendingTasks = project.tasks.filter(t => t.status === 'pending').length;
    project.metadata.lastUpdated = now;
    setProject(projectId, project);

    // Create lock file
    await createLockFile(projectId, taskId, agent, process.pid);

    // Persist to tasks.json
    const tasksJsonPath = join(PROJECTS_DIR, projectId, 'tasks.json');
    try {
      const content = await readFile(tasksJsonPath, 'utf-8');
      const tasksData = JSON.parse(content);
      const idx = tasksData.tasks.findIndex((t: any) => t.id === taskId);
      if (idx !== -1) {
        tasksData.tasks[idx] = task;
        tasksData.metadata = tasksData.metadata || {};
        tasksData.metadata.updated = now;
        await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
      }
    } catch (fileErr) {
      console.error(`[TasksAPI] Error persisting lock update:`, fileErr);
    }

    broadcastProjectUpdated(projectId, 'updated');
    broadcastLogUpdated(projectId, {
      agent: agent.toLowerCase(),
      tag: 'STARTED',
      timestamp: now,
      context: taskId,
      description: `Task claimed by ${agent}`,
      raw: `[AGENT: STARTED] ${now} | ${taskId} | Task claimed by ${agent} (reclaim_after: ${reclaimAt})`
    });

    return res.json({
      success: true,
      taskId,
      projectId,
      task,
      message: `Task ${taskId} claimed by ${agent}`,
      timestamp: now
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error locking task:`, err);
    return res.status(500).json({
      error: 'Failed to lock task',
      message: errorMessage
    });
  }
});

/**
 * PATCH /api/projects/:projectId/tasks/:taskId/heartbeat
 * Extend a task lock and signal agent is still alive.
 *
 * Request body:
 * - agent: string (required)
 *
 * Response:
 * - 200 OK: { success: true, reclaim_after: string }
 * - 400 Bad Request: Task not in_progress
 * - 404 Not Found: Project or task not found
 * - 503 Service Unavailable: Cache not hydrated
 */
router.patch('/:taskId/heartbeat', async (req: TaskExecutionRequest, res: Response) => {
  const { projectId, taskId } = req.params;
  const { agent } = req.body;

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
        message: `No task found with ID: ${taskId} in project: ${projectId}`
      });
    }

    if (task.status !== 'in_progress') {
      return res.status(400).json({
        error: 'Task not in progress',
        message: `Task ${taskId} is not in_progress — heartbeat rejected`
      });
    }

    const now = new Date().toISOString();
    const reclaimAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    task.reclaim_after = reclaimAt;
    task.last_updated_at = now;

    project.metadata.lastUpdated = now;
    setProject(projectId, project);

    // Persist to tasks.json
    const tasksJsonPath = join(PROJECTS_DIR, projectId, 'tasks.json');
    try {
      const content = await readFile(tasksJsonPath, 'utf-8');
      const tasksData = JSON.parse(content);
      const idx = tasksData.tasks.findIndex((t: any) => t.id === taskId);
      if (idx !== -1) {
        tasksData.tasks[idx] = task;
        tasksData.metadata = tasksData.metadata || {};
        tasksData.metadata.updated = now;
        await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
      }
    } catch (fileErr) {
      console.error(`[TasksAPI] Error persisting heartbeat:`, fileErr);
    }

    broadcastAgentHeartbeat(0, agent || task.locked_by || 'unknown', now);

    return res.json({
      success: true,
      reclaim_after: reclaimAt,
      timestamp: now
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error processing heartbeat:`, err);
    return res.status(500).json({
      error: 'Failed to process heartbeat',
      message: errorMessage
    });
  }
});

/**
 * GET /api/projects/:projectId/tasks/:taskId
 * Get a specific task by ID.
 */
router.get('/:taskId', (req: TaskExecutionRequest, res: Response) => {
  const { projectId, taskId } = req.params;

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
        message: `No task found with ID: ${taskId} in project: ${projectId}`
      });
    }

    res.json(task);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error getting task:`, err);
    res.status(500).json({
      error: 'Failed to get task',
      message: errorMessage
    });
  }
});

/**
 * POST /api/projects/:projectId/tasks/:taskId/unlock
 * Force unlock a stuck task by removing its lock file.
 *
 * Response:
 * - 200 OK: Lock removed successfully
 * - 400 Bad Request: Task is not locked
 * - 404 Not Found: Project or task not found
 * - 503 Service Unavailable: Cache not hydrated
 * - 500 Internal Server Error: Failed to remove lock
 */
router.post('/:taskId/unlock', async (req: TaskExecutionRequest, res: Response) => {
  const { projectId, taskId } = req.params;

  try {
    // Check if cache is hydrated
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    // Validate project exists
    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    // Find the task
    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
        message: `No task found with ID: ${taskId} in project: ${projectId}`
      });
    }

    // Check task has a lock to release — allow unlock on any locked_by or in_progress task.
    // Force Unlock is intentionally permissive: the user is declaring the task is dead.
    const isLocked = task.locked_by || task.status === 'in_progress';
    if (!isLocked) {
      return res.status(400).json({
        error: 'Task not locked',
        message: `Task ${taskId} has no lock to release (status: ${task.status})`
      });
    }

    console.log(`[TasksAPI] Force unlocking task ${taskId} in project ${projectId} (was: status=${task.status}, locked_by=${task.locked_by})`);

    // Remove the lock file
    const lockRemoved = await removeLockFile(projectId, taskId);

    // Reset task to pending and clear all lock fields
    const now = new Date().toISOString();
    task.status = 'pending';
    task.started = undefined;
    task.locked_by = null;
    task.locked_at = null;
    task.reclaim_after = null;
    task.last_updated_by = 'system';
    task.last_updated_at = now;

    // Update project metadata
    const completedTasks = project.tasks.filter(t => t.status === 'done').length;
    const inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
    const pendingTasks = project.tasks.filter(t => t.status === 'pending').length;

    project.metadata.completedTasks = completedTasks;
    project.metadata.inProgressTasks = inProgressTasks;
    project.metadata.pendingTasks = pendingTasks;
    project.metadata.lastUpdated = now;

    // Save back to cache
    setProject(projectId, project);

    // Persist to tasks.json so the unlock survives a server restart
    const tasksJsonPath = join(PROJECTS_DIR, projectId, 'tasks.json');
    try {
      const content = await readFile(tasksJsonPath, 'utf-8');
      const tasksData = JSON.parse(content);
      const idx = tasksData.tasks.findIndex((t: any) => t.id === taskId);
      if (idx !== -1) {
        tasksData.tasks[idx] = task;
        tasksData.metadata = tasksData.metadata || {};
        tasksData.metadata.updated = now;
        await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
      }
    } catch (fileErr) {
      console.error(`[TasksAPI] Error persisting unlock to tasks.json:`, fileErr);
    }

    // Broadcast updates
    broadcastTaskCompleted(projectId, taskId, { unlocked: true, force: true });
    broadcastProjectUpdated(projectId, 'updated');
    broadcastLogUpdated(projectId, {
      agent: 'taskmaster-system',
      tag: 'INFO',
      timestamp: now,
      context: taskId,
      description: `Task force unlocked by user`,
      raw: `[AGENT: INFO] ${now} | ${taskId} | Task force unlocked by user`
    });

    res.json({
      success: true,
      taskId,
      projectId,
      lockRemoved,
      status: 'pending',
      message: lockRemoved
        ? 'Task unlocked successfully and lock file removed'
        : 'Task status reset to pending (no lock file found)',
      timestamp: now
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error unlocking task:`, err);

    broadcastError(
      `Failed to unlock task: ${errorMessage}`,
      'TASK_UNLOCK_ERROR',
      { projectId, taskId }
    );

    res.status(500).json({
      error: 'Failed to unlock task',
      message: errorMessage
    });
  }
});

/**
 * PATCH /api/projects/:projectId/tasks/bulk
 * Apply the same set of updates to multiple tasks in a single file write.
 *
 * Request body:
 * - taskIds: string[]   - Array of task IDs to update (required)
 * - updates: object     - Fields to apply to every matched task (same set as single PATCH)
 * - updated_by?: string - Audit trail: who triggered the update
 *
 * Supported update fields: status, tier, agent, priority, title, description,
 *                          depends_on, gate, requires_human, heartbeat_interval
 *
 * Response:
 * - 200 OK: { success, updated: string[], skipped: string[], updates: object[] }
 * - 400 Bad Request: Missing / invalid taskIds or updates
 * - 404 Not Found: Project not found
 * - 503 Service Unavailable: Cache not hydrated
 * - 500 Internal Server Error
 *
 * NOTE: This route MUST be registered before /:taskId to prevent Express
 * from treating the literal string "bulk" as a task ID.
 */
router.patch('/bulk', async (req: Request<{ projectId: string }>, res: Response) => {
  const { projectId } = req.params;
  const { taskIds, updates, updated_by } = req.body;

  try {
    // Cache guard
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    // Validate inputs
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'taskIds must be a non-empty array of task ID strings'
      });
    }

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'updates must be a non-empty object of fields to apply'
      });
    }

    // Validate project
    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    const updatedIds: string[] = [];
    const skippedIds: string[] = [];
    const updateLog: Array<{ taskId: string; changes: string[] }> = [];

    const patchedAt = new Date().toISOString();

    const {
      agent,
      status,
      tier,
      priority,
      title,
      description,
      depends_on,
      gate,
      requires_human,
      heartbeat_interval
    } = updates;

    for (const taskId of taskIds) {
      const task = project.tasks.find(t => t.id === taskId);

      if (!task) {
        console.warn(`[TasksAPI] bulk PATCH: task ${taskId} not found in project ${projectId} — skipping`);
        skippedIds.push(taskId);
        continue;
      }

      const changes: string[] = [];

      // agent
      if (agent !== undefined) {
        const oldAgent = task.agent || 'auto';
        if (agent === '' || agent === null) {
          delete task.agent;
          changes.push(`agent: ${oldAgent} -> auto`);
        } else {
          task.agent = agent;
          changes.push(`agent: ${oldAgent} -> ${agent}`);
        }
      }

      // status
      if (status !== undefined && ['pending', 'in_progress', 'done', 'blocked', 'failed'].includes(status)) {
        const oldStatus = task.status;
        task.status = status;
        changes.push(`status: ${oldStatus} -> ${status}`);

        if (status === 'in_progress' && oldStatus !== 'in_progress') {
          task.started = patchedAt;
        } else if (status === 'done' && oldStatus !== 'done') {
          task.completed = patchedAt;
          task.locked_by = null;
          task.locked_at = null;
          task.reclaim_after = null;
        } else if (status === 'failed') {
          task.locked_by = null;
          task.locked_at = null;
          task.reclaim_after = null;
        }
      }

      // tier
      if (tier !== undefined && typeof tier === 'number' && Number.isInteger(tier) && tier >= 0) {
        const oldTier = task.tier;
        task.tier = tier;
        changes.push(`tier: ${oldTier} -> ${tier}`);
      }

      // priority
      if (priority !== undefined && ['low', 'medium', 'high', 'critical'].includes(priority)) {
        const oldPriority = task.priority;
        task.priority = priority;
        changes.push(`priority: ${oldPriority} -> ${priority}`);
      }

      // title
      if (title !== undefined && title.trim() !== '') {
        task.title = title.trim();
        changes.push('title updated');
      }

      // description
      if (description !== undefined) {
        task.description = description.trim() || undefined;
        changes.push('description updated');
      }

      // depends_on
      if (depends_on !== undefined) {
        task.depends_on = Array.isArray(depends_on) ? depends_on : undefined;
        changes.push('depends_on updated');
      }

      // gate
      if (gate !== undefined) {
        task.gate = gate || null;
        changes.push(`gate: ${gate}`);
      }

      // requires_human
      if (requires_human !== undefined) {
        task.requires_human = Boolean(requires_human);
        changes.push(`requires_human: ${requires_human}`);
      }

      // heartbeat_interval
      if (heartbeat_interval !== undefined) {
        task.heartbeat_interval = Number(heartbeat_interval);
        changes.push(`heartbeat_interval: ${heartbeat_interval}`);
      }

      // Audit trail
      task.last_updated_at = patchedAt;
      if (updated_by) task.last_updated_by = updated_by;

      updatedIds.push(taskId);
      updateLog.push({ taskId, changes });
    }

    // Update project metadata once
    project.metadata.completedTasks = project.tasks.filter(t => t.status === 'done').length;
    project.metadata.inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
    project.metadata.pendingTasks = project.tasks.filter(t => t.status === 'pending').length;
    project.metadata.lastUpdated = patchedAt;

    // Persist to cache
    setProject(projectId, project);

    // Single file write for all updates
    const tasksJsonPath = join(PROJECTS_DIR, projectId, 'tasks.json');
    try {
      const tasksContent = await readFile(tasksJsonPath, 'utf-8');
      const tasksData = JSON.parse(tasksContent);

      for (const taskId of updatedIds) {
        const updatedTask = project.tasks.find(t => t.id === taskId);
        const fileIndex = tasksData.tasks.findIndex((t: any) => t.id === taskId);
        if (fileIndex !== -1 && updatedTask) {
          tasksData.tasks[fileIndex] = updatedTask;
        }
      }

      tasksData.metadata = tasksData.metadata || {};
      tasksData.metadata.updated = patchedAt;

      await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
    } catch (fileErr) {
      console.error(`[TasksAPI] bulk PATCH: error persisting to file:`, fileErr);
      // Cache is updated — file persistence is best-effort
    }

    // Broadcast
    broadcastProjectUpdated(projectId, 'updated');
    broadcastLogUpdated(projectId, {
      agent: 'taskmaster-system',
      tag: 'INFO',
      timestamp: patchedAt,
      context: 'bulk',
      description: `Bulk PATCH applied to ${updatedIds.length} tasks (${skippedIds.length} skipped)`,
      raw: `[AGENT: INFO] ${patchedAt} | bulk | Bulk PATCH applied to ${updatedIds.length} tasks (${skippedIds.length} skipped)`
    });

    res.json({
      success: true,
      updated: updatedIds,
      skipped: skippedIds,
      updates: updateLog,
      timestamp: patchedAt
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error in bulk PATCH:`, err);

    broadcastError(
      `Failed bulk task update: ${errorMessage}`,
      'TASK_BULK_UPDATE_ERROR',
      { projectId }
    );

    res.status(500).json({
      error: 'Failed to bulk update tasks',
      message: errorMessage
    });
  }
});

/**
 * DELETE /api/projects/:projectId/tasks/:taskId
 * Permanently delete a task from the project.
 * Logs the deletion to the project's agentlogs.md.
 *
 * Response:
 * - 200 OK: Task deleted
 * - 400 Bad Request: Task is currently locked / in progress
 * - 404 Not Found: Project or task not found
 * - 503 Service Unavailable: Cache not hydrated
 */
router.delete('/:taskId', async (req: TaskExecutionRequest, res: Response) => {
  const { projectId, taskId } = req.params;
  const deletedBy: string = (req.body?.deleted_by as string) || 'user';

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({ error: 'Cache not hydrated', message: 'Server is still loading. Try again shortly.' });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found', message: `No project found with ID: ${projectId}` });
    }

    const taskIndex = project.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found', message: `No task found with ID: ${taskId}` });
    }

    const task = project.tasks[taskIndex];

    // Block deletion of actively locked tasks
    if (task.locked_by && task.status === 'in_progress') {
      return res.status(400).json({
        error: 'Task is locked',
        message: `Task ${taskId} is currently locked by ${task.locked_by}. Unlock it before deleting.`
      });
    }

    const deletedAt = new Date().toISOString();
    const taskTitle = task.title;

    // Remove from project tasks array
    project.tasks.splice(taskIndex, 1);

    // Recompute metadata
    project.metadata.totalTasks = project.tasks.length;
    project.metadata.completedTasks = project.tasks.filter(t => t.status === 'done').length;
    project.metadata.inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
    project.metadata.pendingTasks = project.tasks.filter(t => t.status === 'pending').length;
    project.metadata.lastUpdated = deletedAt;
    setProject(projectId, project);

    // Persist tasks.json
    const tasksJsonPath = join(PROJECTS_DIR, projectId, 'tasks.json');
    try {
      const content = await readFile(tasksJsonPath, 'utf-8');
      const tasksData = JSON.parse(content);
      tasksData.tasks = tasksData.tasks.filter((t: any) => t.id !== taskId);
      tasksData.metadata = tasksData.metadata || {};
      tasksData.metadata.updated = deletedAt;
      await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
    } catch (fileErr) {
      console.error('[Tasks] Error persisting delete to tasks.json:', fileErr);
    }

    // Log deletion to agentlogs.md
    const logLine = `[${deletedBy.toUpperCase()}: DELETED] ${deletedAt} | ${taskId} | Task deleted: "${taskTitle}"\n`;
    const agentLogsPath = join(PROJECTS_DIR, projectId, 'agentlogs.md');
    try {
      await writeFile(agentLogsPath, logLine, { flag: 'a' });
    } catch (logErr) {
      console.warn('[Tasks] Could not write deletion to agentlogs.md:', logErr);
    }

    broadcastProjectUpdated(projectId, 'updated');
    broadcastLogUpdated(projectId, {
      agent: deletedBy.toLowerCase(),
      tag: 'DELETED',
      timestamp: deletedAt,
      context: taskId,
      description: `Task deleted: "${taskTitle}"`,
      raw: logLine.trim()
    });

    console.log(`[Tasks] Deleted task ${taskId} ("${taskTitle}") from project ${projectId}`);

    return res.json({
      success: true,
      taskId,
      projectId,
      deletedTask: { id: taskId, title: taskTitle },
      timestamp: deletedAt,
      message: `Task ${taskId} deleted successfully`
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Tasks] Error deleting task:', err);
    return res.status(500).json({ error: 'Failed to delete task', message: errorMessage });
  }
});

/**
 * PATCH /api/projects/:projectId/tasks/:taskId
 * Update a task's properties (agent, status, etc.).
 *
 * Request body:
 * - agent?: string - Assign an agent to the task (empty string to unassign)
 * - status?: string - Update task status
 * - tier?: number - Update task tier (must be >= 0)
 * - priority?: string - Update task priority
 *
 * Response:
 * - 200 OK: Task updated successfully
 * - 400 Bad Request: Invalid request
 * - 404 Not Found: Project or task not found
 * - 503 Service Unavailable: Cache not hydrated
 * - 500 Internal Server Error: Failed to update task
 */
router.patch('/:taskId', async (req: TaskExecutionRequest, res: Response) => {
  const { projectId, taskId } = req.params;
  const { agent, status, tier, priority, title, description, depends_on, gate, requires_human, heartbeat_interval, updated_by } = req.body;

  try {
    // Check if cache is hydrated
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    // Validate project exists
    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    // Find the task
    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
        message: `No task found with ID: ${taskId} in project: ${projectId}`
      });
    }

    // Track what was updated
    const updates: string[] = [];

    // Update agent assignment
    if (agent !== undefined) {
      const oldAgent = task.agent || 'auto';
      if (agent === '' || agent === null) {
        delete task.agent;
        updates.push(`agent: ${oldAgent} -> auto`);
      } else {
        task.agent = agent;
        updates.push(`agent: ${oldAgent} -> ${agent}`);
      }
    }

    const patchedAt = new Date().toISOString();

    // Update status
    if (status !== undefined && ['pending', 'in_progress', 'done', 'blocked', 'failed'].includes(status)) {
      const oldStatus = task.status;
      task.status = status;
      updates.push(`status: ${oldStatus} -> ${status}`);

      // Update timestamps based on status changes
      if (status === 'in_progress' && oldStatus !== 'in_progress') {
        task.started = patchedAt;
      } else if (status === 'done' && oldStatus !== 'done') {
        task.completed = patchedAt;
        // Clear lock fields on terminal status
        task.locked_by = null;
        task.locked_at = null;
        task.reclaim_after = null;
      } else if (status === 'failed') {
        // Clear lock fields on terminal status
        task.locked_by = null;
        task.locked_at = null;
        task.reclaim_after = null;
      }
    }

    // Update priority
    if (priority !== undefined && ['low', 'medium', 'high', 'critical'].includes(priority)) {
      const oldPriority = task.priority;
      task.priority = priority;
      updates.push(`priority: ${oldPriority} -> ${priority}`);
    }

    // Update title
    if (title !== undefined && title.trim() !== '') {
      task.title = title.trim();
      updates.push(`title updated`);
    }

    // Update description
    if (description !== undefined) {
      task.description = description.trim() || undefined;
      updates.push(`description updated`);
    }

    // Update workflow control fields
    if (depends_on !== undefined) {
      task.depends_on = Array.isArray(depends_on) ? depends_on : undefined;
      updates.push(`depends_on updated`);
    }
    if (gate !== undefined) {
      task.gate = gate || null;
      updates.push(`gate: ${gate}`);
    }
    if (requires_human !== undefined) {
      task.requires_human = Boolean(requires_human);
      updates.push(`requires_human: ${requires_human}`);
    }
    if (heartbeat_interval !== undefined) {
      task.heartbeat_interval = Number(heartbeat_interval);
      updates.push(`heartbeat_interval: ${heartbeat_interval}`);
    }

    // Update tier (must be non-negative integer)
    if (tier !== undefined && typeof tier === 'number' && Number.isInteger(tier) && tier >= 0) {
      const oldTier = task.tier;
      task.tier = tier;
      updates.push(`tier: ${oldTier} -> ${tier}`);
    }

    // Always set audit trail
    task.last_updated_at = patchedAt;
    if (updated_by) task.last_updated_by = updated_by;

    // Update project metadata
    const completedTasks = project.tasks.filter(t => t.status === 'done').length;
    const inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
    const pendingTasks = project.tasks.filter(t => t.status === 'pending').length;

    project.metadata.completedTasks = completedTasks;
    project.metadata.inProgressTasks = inProgressTasks;
    project.metadata.pendingTasks = pendingTasks;
    project.metadata.lastUpdated = new Date().toISOString();

    // Save back to cache
    setProject(projectId, project);

    // Persist to tasks.json file
    const PROJECTS_DIR = join(__dirname, '../../../projects');
    const tasksJsonPath = join(PROJECTS_DIR, projectId, 'tasks.json');

    try {
      const tasksContent = await readFile(tasksJsonPath, 'utf-8');
      const tasksData = JSON.parse(tasksContent);

      // Update the task in the file
      const taskIndex = tasksData.tasks.findIndex((t: any) => t.id === taskId);
      if (taskIndex !== -1) {
        tasksData.tasks[taskIndex] = task;
        tasksData.metadata = tasksData.metadata || {};
        tasksData.metadata.updated = new Date().toISOString();

        await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
      }
    } catch (fileErr) {
      console.error(`[TasksAPI] Error persisting task update to file:`, fileErr);
      // Continue - cache is updated, file persistence is best effort
    }

    // Broadcast project update
    broadcastProjectUpdated(projectId, 'updated');

    // Log the update
    broadcastLogUpdated(projectId, {
      agent: 'taskmaster-system',
      tag: 'INFO',
      timestamp: new Date().toISOString(),
      context: taskId,
      description: `Task updated: ${updates.join(', ')}`,
      raw: `[AGENT: INFO] ${new Date().toISOString()} | ${taskId} | Task updated: ${updates.join(', ')}`
    });

    res.json({
      success: true,
      taskId,
      projectId,
      task,
      updates,
      message: 'Task updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error updating task:`, err);

    broadcastError(
      `Failed to update task: ${errorMessage}`,
      'TASK_UPDATE_ERROR',
      { projectId, taskId }
    );

    res.status(500).json({
      error: 'Failed to update task',
      message: errorMessage
    });
  }
});

/**
 * POST /api/projects/:projectId/tasks/:taskId/assign
 * Assign an agent to a task and immediately spawn the agent process.
 *
 * Request body:
 * - agent: string - The agent to assign (required). Use 'General' for a standard agent
 *                   with no special instructions, or a specific agent name.
 *
 * Response:
 * - 202 Accepted: Agent spawned and task assigned successfully
 * - 400 Bad Request: Missing agent parameter or invalid request
 * - 404 Not Found: Project or task not found
 * - 409 Conflict: Task is already done or blocked
 * - 503 Service Unavailable: Cache not hydrated
 * - 500 Internal Server Error: Failed to spawn agent or update task
 */
// Active agent processes map - EXPORTED to share with agents.ts
export const activeAgents = new Map<string, {
  pid: number;
  name: string;
  spawnedAt: string;
  projectId?: string;
  taskId?: string;
}>();

router.post('/:taskId/assign', async (req: TaskExecutionRequest, res: Response) => {
  const { projectId, taskId } = req.params;
  const { agent } = req.body;

  try {
    // Check if cache is hydrated
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    // Validate agent parameter
    if (!agent || typeof agent !== 'string') {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'Agent parameter is required'
      });
    }

    // Validate project exists
    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    // Find the task
    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
        message: `No task found with ID: ${taskId} in project: ${projectId}`
      });
    }

    // Check if task can be assigned
    if (task.status === 'done') {
      return res.status(409).json({
        error: 'Task already completed',
        message: `Task ${taskId} is already completed`
      });
    }

    if (task.status === 'blocked') {
      return res.status(409).json({
        error: 'Task is blocked',
        message: `Task ${taskId} is blocked and cannot be assigned`
      });
    }

    // Dependency gate
    const assignDepError = checkDependencies(task, project.tasks);
    if (assignDepError) {
      return res.status(409).json({
        error: 'Dependencies not satisfied',
        message: assignDepError
      });
    }

    // Human gate
    if (task.requires_human === true) {
      return res.status(409).json({
        error: 'Requires human approval',
        message: `Task ${taskId} requires human approval before it can be assigned`
      });
    }

    // Determine agent file path
    const AGENTS_DIR = join(__dirname, '../../../agents');
    const PROJECTS_DIR = join(__dirname, '../../../projects');
    const projectPath = join(PROJECTS_DIR, projectId);

    let agentFilePath: string | null = null;
    let agentName: string;

    if (agent.toLowerCase() === 'general') {
      // General agent - spawn with no special instructions
      agentName = 'General';
    } else {
      // Specific agent - find the agent file
      const agentFileName = agent.toLowerCase().endsWith('.md') ? agent.toLowerCase() : `${agent.toLowerCase()}.md`;
      agentFilePath = join(AGENTS_DIR, agentFileName);
      agentName = agent.replace(/\.md$/i, '');
    }

    // Build working agent script that actually executes tasks
    // This is the same script used by /agents/:id/spawn endpoint
    let agentScript = `
      const http = require('http');
      const fs = require('fs');
      const path = require('path');
      const { spawn } = require('child_process');
      
      const pid = process.pid;
      const agentName = '${agentName}';
      const taskId = '${taskId}';
      const projectId = '${projectId}';
      const projectPath = '${projectPath}';
      
      // Helper to make API requests
      function apiRequest(method, path, data) {
        return new Promise((resolve, reject) => {
          const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
          };
          
          const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
              try { resolve(JSON.parse(body)); } 
              catch { resolve(body); }
            });
          });
          
          req.on('error', reject);
          req.on('timeout', () => reject(new Error('Request timeout')));
          if (data) req.write(JSON.stringify(data));
          req.end();
        });
      }
      
      // Helper to append to agentlogs.md
      function logActivity(tag, description) {
        const timestamp = new Date().toISOString();
        const cleanName = agentName.toUpperCase().replace(/^AGENT[_\s]+/, '');
        const logLine = "[AGENT " + cleanName + ": " + tag + "] " + timestamp + " | " + (taskId || 'general') + " | " + description + "\\n";
        console.log(logLine.trim());
        if (projectPath) {
          try {
            const logPath = path.join(projectPath, 'agentlogs.md');
            fs.appendFileSync(logPath, logLine);
          } catch (err) {
            console.error('[LOG ERROR]', err.message);
          }
        }
      }
      
      // Execute kimi command to do actual work
      function executeKimi(prompt, cwd) {
        return new Promise((resolve, reject) => {
          const kimi = spawn('kimi', ['-c', prompt], {
            cwd: cwd || projectPath,
            env: process.env,
            timeout: 300000
          });
          
          let stdout = '';
          let stderr = '';
          
          kimi.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log('[KIMI]', data.toString().trim());
          });
          
          kimi.stderr.on('data', (data) => {
            stderr += data.toString();
            console.error('[KIMI ERR]', data.toString().trim());
          });
          
          kimi.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error('kimi exited with code ' + code + ': ' + stderr));
          });
          
          kimi.on('error', (err) => {
            reject(new Error('Failed to spawn kimi: ' + err.message));
          });
        });
      }
      
      // Main task execution
      async function executeTask() {
        let taskCompleted = false;
        
        try {
          logActivity('STARTED', agentName + ' agent spawned for ' + taskId);
          
          // Read task details
          const taskRes = await apiRequest('GET', '/api/projects/' + projectId + '/tasks/' + taskId, null);
          if (!taskRes || taskRes.error) {
            throw new Error('Failed to get task: ' + (taskRes?.error || 'unknown'));
          }
          const task = taskRes.task || taskRes;
          
          logActivity('PROGRESS', 'Working on: ' + (task.title || 'Untitled'));
          
          // Check for kimi-cli
          let kimiAvailable = false;
          try {
            await executeKimi('echo "kimi check"', '/tmp');
            kimiAvailable = true;
            logActivity('PROGRESS', 'kimi-cli is available');
          } catch (err) {
            logActivity('ERROR', 'kimi-cli not available: ' + err.message);
          }
          
          // Do actual work if description exists and kimi is available
          if (kimiAvailable && task.description && task.description.length > 10) {
            logActivity('PROGRESS', 'Executing task with kimi...');
            try {
              const workPrompt = \`You are working on task "\${task.title}" in project \${projectId} at \${projectPath}.
Task description: \${task.description}

Complete this task by:
1. Reading the relevant files in the project
2. Making necessary changes
3. Writing a summary of what you did

Be concise and focused. When done, report completion.\`;
              
              await executeKimi(workPrompt, projectPath);
              logActivity('PROGRESS', 'AI work completed');
            } catch (err) {
              logActivity('ERROR', 'AI work failed: ' + err.message);
            }
          } else if (!kimiAvailable) {
            logActivity('PROGRESS', 'kimi not available - task ready for manual completion');
          } else {
            logActivity('PROGRESS', 'No specific work description - task ready for manual work');
          }
          
          // Mark task completed (status 'done' - not 'completed')
          await apiRequest('PATCH', '/api/projects/' + projectId + '/tasks/' + taskId, {
            status: 'done',
            completed: new Date().toISOString(),
            updated_by: agentName
          });
          taskCompleted = true;
          logActivity('COMPLETED', 'Task marked done');
          
        } catch (err) {
          logActivity('ERROR', 'Task execution failed: ' + err.message);
          console.error('[AGENT ERROR]', err);
        }
        
        // Send final heartbeat then exit
        clearInterval(heartbeatInterval);
        setTimeout(() => process.exit(taskCompleted ? 0 : 1), 500);
      }
      
      // Start heartbeat
      const heartbeatInterval = setInterval(() => {
        console.log(JSON.stringify({
          type: 'agent:heartbeat',
          pid: pid,
          agent: agentName,
          timestamp: new Date().toISOString()
        }));
      }, 5000);
      
      // Handle graceful shutdown
      process.on('SIGTERM', () => {
        clearInterval(heartbeatInterval);
        process.exit(0);
      });
      
      // Start execution
      console.log(JSON.stringify({
        type: 'agent:started',
        pid: pid,
        agent: agentName,
        timestamp: new Date().toISOString()
      }));
      
      executeTask();
    `;

    // Spawn the agent process
    const agentProcess = spawn(process.execPath, ['-e', agentScript], {
      env: {
        ...process.env,
        AGENT_NAME: agentName,
        PROJECT_PATH: projectPath,
        TASK_ID: taskId,
        AGENT_FILE: agentFilePath || ''
      },
      detached: false
    });

    const spawnedAt = new Date().toISOString();
    const agentId = `agent-${agentName.toLowerCase()}-${Date.now()}`;

    // Store agent process info
    activeAgents.set(agentId, {
      pid: agentProcess.pid!,
      name: agentName,
      spawnedAt,
      projectId,
      taskId
    });

    // Handle agent stdout
    agentProcess.stdout.on('data', (data) => {
      const output = data.toString();
      const lines = output.trim().split('\n');

      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.type === 'agent:heartbeat') {
            broadcastAgentHeartbeat(message.pid, message.agent, message.timestamp);
          } else if (message.type === 'agent:started') {
            broadcastAgentSpawned(message.pid, message.agent, message.timestamp, projectId);
          }
        } catch {
          // Not JSON, broadcast as raw output
          broadcastAgentOutput(agentProcess.pid!, agentName, output, 'stdout', new Date().toISOString(), projectId);
        }
      }
    });

    // Handle agent stderr
    agentProcess.stderr.on('data', (data) => {
      const output = data.toString();
      broadcastAgentOutput(agentProcess.pid!, agentName, output, 'stderr', new Date().toISOString(), projectId);
    });

    // Handle agent exit
    agentProcess.on('exit', async (code) => {
      const agent = activeAgents.get(agentId);
      if (agent) {
        broadcastAgentExited(agent.pid, agent.name, code || 0, new Date().toISOString(), agent.projectId);
        console.log(`[Agent] Process ${agent.name} (PID ${agent.pid}) exited with code ${code}`);
        activeAgents.delete(agentId);
        
        // If agent exited without completing task, reset task to pending
        if (code !== 0 && agent.projectId && agent.taskId) {
          try {
            const project = getProject(agent.projectId);
            if (project) {
              const task = project.tasks.find(t => t.id === agent.taskId);
              if (task && task.status === 'in_progress') {
                task.status = 'pending';
                task.locked_by = null;
                task.locked_at = null;
                task.reclaim_after = null;
                task.last_updated_at = new Date().toISOString();
                setProject(agent.projectId, project);
                
                // Persist to tasks.json
                const tasksJsonPath = join(PROJECTS_DIR, agent.projectId, 'tasks.json');
                const tasksData = JSON.parse(await readFile(tasksJsonPath, 'utf-8'));
                const taskIndex = tasksData.tasks.findIndex((t: any) => t.id === agent.taskId);
                if (taskIndex !== -1) {
                  tasksData.tasks[taskIndex] = task;
                  tasksData.metadata.updated = new Date().toISOString();
                  await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
                }
                
                console.log(`[Agent] Task ${agent.taskId} reset to pending (agent exited with code ${code})`);
                broadcastProjectUpdated(agent.projectId, 'updated');
              }
            }
          } catch (err) {
            console.error(`[Agent] Error cleaning up after exit:`, err);
          }
        }
      }
    });

    // Handle agent error
    agentProcess.on('error', (error) => {
      console.error(`[Agent] Error in agent ${agentName}:`, error);
      activeAgents.delete(agentId);
    });

    // Update task status to in_progress and assign the agent
    const oldStatus = task.status;
    const oldAgent = task.agent || 'auto';
    const assignedAt = new Date().toISOString();
    const assignReclaimAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    task.status = 'in_progress';
    task.agent = agentName;
    task.started = assignedAt;
    task.locked_by = agentName;
    task.locked_at = assignedAt;
    task.reclaim_after = assignReclaimAt;
    task.last_updated_by = agentName;
    task.last_updated_at = assignedAt;

    // Update project metadata
    const completedTasks = project.tasks.filter(t => t.status === 'done').length;
    const inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
    const pendingTasks = project.tasks.filter(t => t.status === 'pending').length;

    project.metadata.completedTasks = completedTasks;
    project.metadata.inProgressTasks = inProgressTasks;
    project.metadata.pendingTasks = pendingTasks;
    project.metadata.lastUpdated = new Date().toISOString();

    // Save back to cache
    setProject(projectId, project);

    // Persist to tasks.json file
    const tasksJsonPath = join(PROJECTS_DIR, projectId, 'tasks.json');
    try {
      const tasksContent = await readFile(tasksJsonPath, 'utf-8');
      const tasksData = JSON.parse(tasksContent);

      // Update the task in the file
      const taskIndex = tasksData.tasks.findIndex((t: any) => t.id === taskId);
      if (taskIndex !== -1) {
        tasksData.tasks[taskIndex] = task;
        tasksData.metadata = tasksData.metadata || {};
        tasksData.metadata.updated = new Date().toISOString();

        await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
      }
    } catch (fileErr) {
      console.error(`[TasksAPI] Error persisting task update to file:`, fileErr);
      // Continue - cache is updated, file persistence is best effort
    }

    // Broadcast updates
    broadcastProjectUpdated(projectId, 'updated');
    broadcastLogUpdated(projectId, {
      agent: agentName.toLowerCase(),
      tag: 'STARTED',
      timestamp: new Date().toISOString(),
      context: taskId,
      description: `Agent ${agentName} assigned to task and started working`,
      raw: `[AGENT: STARTED] ${new Date().toISOString()} | ${taskId} | Agent ${agentName} assigned and started (PID: ${agentProcess.pid})`
    });

    console.log(`[TasksAPI] Agent ${agentName} assigned to task ${taskId} in project ${projectId} (PID: ${agentProcess.pid})`);

    // Return success response
    res.status(202).json({
      success: true,
      pid: agentProcess.pid,
      agent: agentName,
      projectId,
      taskId,
      status: 'in_progress',
      updates: [
        `agent: ${oldAgent} -> ${agentName}`,
        `status: ${oldStatus} -> in_progress`
      ],
      spawnedAt,
      message: `Agent ${agentName} assigned to task and started successfully`
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TasksAPI] Error assigning agent to task:`, err);

    broadcastError(
      `Failed to assign agent to task: ${errorMessage}`,
      'AGENT_ASSIGN_ERROR',
      { projectId, taskId, agent }
    );

    res.status(500).json({
      error: 'Failed to assign agent to task',
      message: errorMessage
    });
  }
});

/**
 * POST /api/projects/:projectId/tasks/:taskId/batch
 * Collapse multiple task operations into a single API call.
 * Reduces round trips for agent sessions from 5 to 1.
 *
 * Operations are applied in order: lock → heartbeat → status.
 * If lock fails, subsequent operations are not applied.
 *
 * Request body (at least one operation required):
 * {
 *   lock?:      { agent: string, reclaim_after_minutes?: number }
 *   heartbeat?: { agent: string }
 *   status?:    { status: string, updated_by?: string }
 * }
 *
 * Response:
 * - 200 OK: all operations applied
 * - 207 Multi-Status: partial success (lock ok, later op failed)
 * - 400 Bad Request: no operations provided or invalid input
 * - 404 Not Found: project or task not found
 * - 409 Conflict: lock blocked (deps, human gate, energy, already locked)
 * - 503 Service Unavailable: cache not hydrated
 */
router.post('/:taskId/batch', async (req: TaskExecutionRequest, res: Response) => {
  const { projectId, taskId } = req.params;
  const { lock, heartbeat, status: statusOp } = req.body ?? {};

  if (!lock && !heartbeat && !statusOp) {
    return res.status(400).json({
      error: 'No operations provided',
      message: 'Provide at least one of: lock, heartbeat, status'
    });
  }

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({ error: 'Cache not hydrated', message: 'Server is still loading. Try again shortly.' });
    }

    const project = getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found', message: `No project found with ID: ${projectId}` });
    }

    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found', message: `No task found with ID: ${taskId}` });
    }

    const applied: string[] = [];
    const errors: Record<string, string> = {};
    const now = new Date().toISOString();

    // --- Operation 1: lock ---
    if (lock) {
      const { agent, reclaim_after_minutes = 15 } = lock;
      if (!agent) {
        return res.status(400).json({ error: 'lock.agent is required' });
      }

      if (['done', 'failed', 'blocked'].includes(task.status)) {
        return res.status(409).json({
          error: 'Task not lockable',
          message: `Task has status '${task.status}'`
        });
      }

      const depError = checkDependencies(task, project.tasks);
      if (depError) {
        return res.status(409).json({ error: 'Dependencies not satisfied', message: depError });
      }

      if (task.requires_human) {
        return res.status(409).json({ error: 'Requires human approval', message: `Task ${taskId} requires human approval` });
      }

      const energyCost = ENERGY_COSTS[task.priority ?? 'medium'] ?? ENERGY_COSTS.medium;
      const energyResult = await checkAndConsumeEnergy(energyCost, `Batch lock: ${taskId}`);
      if (!energyResult.success) {
        return res.status(409).json({
          error: 'Insufficient energy',
          message: 'Energy is 0. Feed your TaskMaster to continue.',
          currentEnergy: energyResult.currentEnergy,
          maxEnergy: energyResult.maxEnergy
        });
      }

      const reclaimAt = new Date(Date.now() + reclaim_after_minutes * 60 * 1000).toISOString();
      task.locked_by = agent;
      task.locked_at = now;
      task.reclaim_after = reclaimAt;
      task.status = 'in_progress';
      if (!task.started) task.started = now;
      task.last_updated_by = agent;
      task.last_updated_at = now;
      applied.push('lock');

      await createLockFile(projectId, taskId, agent, process.pid).catch(() => {});
    }

    // --- Operation 2: heartbeat ---
    if (heartbeat) {
      const { agent } = heartbeat;
      if (!agent) {
        errors.heartbeat = 'heartbeat.agent is required';
      } else if (task.status !== 'in_progress') {
        errors.heartbeat = `Task is not in_progress (status: ${task.status})`;
      } else {
        const reclaimMins = 15;
        task.reclaim_after = new Date(Date.now() + reclaimMins * 60 * 1000).toISOString();
        task.last_updated_at = now;
        applied.push('heartbeat');
      }
    }

    // --- Operation 3: status update ---
    if (statusOp) {
      const { status, updated_by } = statusOp;
      const validStatuses = ['pending', 'in_progress', 'done', 'blocked', 'failed'];
      if (!status || !validStatuses.includes(status)) {
        errors.status = `Invalid status. Must be one of: ${validStatuses.join(', ')}`;
      } else {
        const oldStatus = task.status;
        task.status = status;
        task.last_updated_by = updated_by ?? task.last_updated_by;
        task.last_updated_at = now;

        if (status === 'done') {
          task.locked_by = null;
          task.locked_at = null;
          task.reclaim_after = null;
          if (!task.completed) task.completed = now;
        } else if (status === 'failed') {
          task.locked_by = null;
          task.locked_at = null;
          task.reclaim_after = null;
        }

        applied.push('status');
        console.log(`[Batch] Task ${taskId} status: ${oldStatus} → ${status}`);
      }
    }

    // Persist changes
    project.metadata.inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
    project.metadata.pendingTasks = project.tasks.filter(t => t.status === 'pending').length;
    project.metadata.completedTasks = project.tasks.filter(t => t.status === 'done').length;
    project.metadata.lastUpdated = now;
    setProject(projectId, project);

    const tasksJsonPath = join(PROJECTS_DIR, projectId, 'tasks.json');
    try {
      const content = await readFile(tasksJsonPath, 'utf-8');
      const tasksData = JSON.parse(content);
      const idx = tasksData.tasks.findIndex((t: any) => t.id === taskId);
      if (idx !== -1) {
        tasksData.tasks[idx] = task;
        tasksData.metadata = tasksData.metadata || {};
        tasksData.metadata.updated = now;
        await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
      }
    } catch (fileErr) {
      console.error('[Batch] Error persisting task:', fileErr);
    }

    broadcastProjectUpdated(projectId, 'updated');

    const hasErrors = Object.keys(errors).length > 0;
    return res.status(hasErrors ? 207 : 200).json({
      success: !hasErrors || applied.length > 0,
      applied,
      errors: hasErrors ? errors : undefined,
      task,
      timestamp: now
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Batch] Error:', err);
    return res.status(500).json({ error: 'Batch operation failed', message: errorMessage });
  }
});

/*
 * DISPATCH ENDPOINT — DISABLED
 * The dispatch endpoint has been retired in favour of a client-side
 * "Copy Prompt" flow.  The UI now generates the prompt text locally,
 * copies it to the clipboard, and the user pastes it into their own
 * AI terminal.  This avoids hard-coding a specific CLI tool (claude,
 * kimi, etc.) and gives the user full control over the AI session.
 *
 * To re-enable auto-spawn dispatch, uncomment the block below.
 */

// router.post('/:taskId/dispatch', async (req: TaskExecutionRequest, res: Response) => {
//   const { projectId, taskId } = req.params;
//   const agentOverride = req.body?.agent;
//   ... (full dispatch implementation) ...
// });

export default router;
