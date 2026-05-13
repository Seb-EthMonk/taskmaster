import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { getAllProjects, getCacheStats, getProject, isCacheHydrated, setProject, removeProject, updateLastAccessed } from './cache/index.js';
import { hydrateCache, getProjectsDir, parseProjectLogs } from './scanner/index.js';
import { initWatcher, getWatcherStatus } from './watcher/index.js';
import { initExpansionRegistry, getExpansionStats } from './expansions/index.js';
import { initSkillRegistry } from './skills/index.js';
import { setWebSocketServer, broadcastTierComplete, broadcastTierApproved, broadcastTierAwaitingApproval, broadcastProjectUpdated, broadcastError, broadcastWorkflowPaused, broadcastWorkflowResumed } from './websocket/broadcaster.js';
import { registerClient, unregisterClient, updateClientActivity, getConnectionStats } from './websocket/connectionManager.js';
import { subscribeToProject, unsubscribeFromProject, unsubscribeClientFromAllProjects } from './websocket/subscriptionManager.js';
import agentsRouter from './routes/agents.js';
import tasksRouter from './routes/tasks.js';
import projectsRouter from './routes/projects.js';
import logsRouter from './routes/logs.js';
import chatRouter from './routes/chat.js';
import settingsRouter from './routes/settings.js';
import portsRouter from './routes/ports.js';
import energyRouter from './routes/energy.js';
import { performLockRecovery, getLastRecoverySummary, RecoverySummary } from './services/lock-recovery.js';
import { logTierTransition, logError, hydrateFromSystemLog, hydrateAgentActivityFromProjectLogs } from './audit/index.js';
import { mkdir, writeFile, stat, readFile, writeFile as fsWriteFile, rename, readdir } from 'fs/promises';
import { join } from 'path';
import type { Task, Project } from './types/index.js';
import { getTierDefinitions, TIER_NAMES, MAX_TIER, MIN_TIER } from './types/index.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve chatapp static files (chat.js, chat.css) for embedding
app.use('/chatapp', express.static(join(process.cwd(), '..', 'projects', 'chatapp')));

// Health check
app.get('/api/health', (req, res) => {
  const stats = getCacheStats();
  const watcherStatus = getWatcherStatus();
  const connectionStats = getConnectionStats();
  res.json({
    status: 'ok',
    cacheHydrated: stats.isHydrated,
    fileWatcher: watcherStatus.active ? 'active' : 'inactive',
    projectCount: stats.projectCount,
    websocketConnections: connectionStats.count,
    lastScan: stats.lastScan,
    timestamp: new Date().toISOString()
  });
});

// WebSocket connection stats endpoint
app.get('/api/health/connections', (req, res) => {
  const connectionStats = getConnectionStats();
  res.json({
    count: connectionStats.count,
    clients: connectionStats.clients,
    timestamp: new Date().toISOString()
  });
});

// Lock recovery status endpoint - returns results from startup lock file scan
app.get('/api/health/lock-recovery', (req, res) => {
  const summary = getLastRecoverySummary();
  res.json({
    recovered: summary !== null,
    summary: summary || undefined,
    timestamp: new Date().toISOString()
  });
});

// Tier definitions endpoint - returns tier definitions with unlimited tier support
app.get('/api/tiers', (req, res) => {
  res.json({
    count: 6,
    minTier: MIN_TIER,
    maxTier: null,  // No maximum tier - unlimited tier support
    unlimited: true,  // Flag indicating unlimited tier support
    baseTiers: getTierDefinitions(),  // Named tiers 0-5
    message: 'Tiers 0-5 have names. Tiers 6+ use "Tier N" format.'
  });
});

// Get project tasks (GET /api/projects and GET /api/projects/:id are handled by projectsRouter)
app.get('/api/projects/:id/tasks', (req, res) => {
  const { id } = req.params;

  if (!isCacheHydrated()) {
    return res.status(503).json({
      error: 'Cache not hydrated',
      message: 'Server is still loading project data. Please try again shortly.'
    });
  }

  const project = getProject(id);

  if (!project) {
    return res.status(404).json({
      error: 'Project not found',
      message: `No project found with ID: ${id}`
    });
  }

  res.json(project.tasks);
});

// Agents routes
app.use('/api/agents', agentsRouter);

// Logs routes
app.use('/api/logs', logsRouter);

// Chat routes - LLM model routing
app.use('/api/chat', chatRouter);

// Settings routes - user preferences and custom links
app.use('/api/settings', settingsRouter);

// Ports routes - port allocation management
app.use('/api/ports', portsRouter);

// Energy routes - server-side energy enforcement
app.use('/api/energy', energyRouter);

// System status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    server: 'Express API',
    status: 'running',
    timestamp: new Date().toISOString(),
    mcp: {
      available: true,
      mode: 'stdio',
      description: 'MCP server running via tsx'
    },
    features: {
      projects: true,
      tasks: true,
      agents: true,
      logs: true,
      websocket: true
    }
  });
});

// Task execution routes - mounted under /api/projects/:projectId/tasks
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:projectId/tasks', tasksRouter);

// POST /api/projects/:id/tier/approve - Approve tier transition
app.post('/api/projects/:id/tier/approve', async (req, res) => {
  const { id } = req.params;

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    const project = getProject(id);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${id}`
      });
    }

    // Check if project is awaiting approval
    if (project.status !== 'awaiting_approval') {
      return res.status(400).json({
        error: 'Not awaiting approval',
        message: `Project ${id} is not awaiting approval (current status: ${project.status})`
      });
    }

    // Get the approvedBy from request body (optional)
    const { approvedBy } = req.body;

    // Store previous tier for response and broadcast
    const previousTier = project.currentTier;
    const newTier = previousTier + 1;  // Allow unlimited tiers

    // Update project tier and status
    project.currentTier = newTier;
    project.status = 'active';
    project.metadata.lastUpdated = new Date().toISOString();

    // Update cache
    setProject(id, project);

    // Save updated tasks.json to disk with approvedTier
    const tasksJsonPath = join(project.path, 'tasks.json');
    const tasksData = {
      version: '1.0',
      project: id,
      updated: new Date().toISOString(),
      tasks: project.tasks,
      approvedTier: newTier  // Persist the approved tier for scanner
    };
    await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));

    // Append approval log to project.md
    const projectMdPath = join(project.path, 'project.md');
    const logEntry = `\n[AGENT: TIER_APPROVAL] ${new Date().toISOString()} | Tier ${previousTier} -> ${newTier} | Approved by ${approvedBy || 'user'}\n`;
    await writeFile(projectMdPath, logEntry, { flag: 'a' });

    console.log(`[API] Tier approval processed for project: ${id} (tier ${previousTier} -> ${newTier})`);

    // Broadcast tier:approved event to all project subscribers
    broadcastTierApproved(id, previousTier, newTier, approvedBy || 'user');

    // Log the tier transition (API trigger)
    logTierTransition(id, previousTier, newTier, 'api', approvedBy || 'user', {
      previousStatus: 'awaiting_approval',
      newStatus: 'active'
    });

    // Broadcast project:updated event
    broadcastProjectUpdated(id, 'updated');

    res.json({
      success: true,
      projectId: id,
      previousTier,
      newTier,
      status: project.status,
      approvedBy: approvedBy || 'user',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[API] Error processing tier approval:', err);
    logError('Failed to process tier approval', 'error', 'api', 'TIER_APPROVAL_ERROR', id, {
      message: errorMessage,
      stack: err instanceof Error ? err.stack : undefined
    });
    broadcastError('Failed to process tier approval', 'TIER_APPROVAL_ERROR', { projectId: id, message: errorMessage });
    res.status(500).json({ error: 'Failed to process tier approval' });
  }
});

// POST /api/projects/:id/workflow/pause - Pause workflow processing
app.post('/api/projects/:id/workflow/pause', async (req, res) => {
  const { id } = req.params;

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    const project = getProject(id);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${id}`
      });
    }

    // Check if project is already paused
    if (project.status === 'paused') {
      return res.status(400).json({
        error: 'Already paused',
        message: `Project ${id} is already paused`
      });
    }

    // Get the pausedBy from request body (optional)
    const { pausedBy } = req.body;

    // Update project status to paused
    const previousStatus = project.status;
    project.status = 'paused';
    project.metadata.lastUpdated = new Date().toISOString();

    // Update cache
    setProject(id, project);

    // Save updated tasks.json to disk
    const tasksJsonPath = join(project.path, 'tasks.json');
    const tasksData = {
      version: '1.0',
      project: id,
      updated: new Date().toISOString(),
      tasks: project.tasks,
      approvedTier: project.currentTier,
      paused: true  // Persist paused state
    };
    await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));

    // Append pause log to project.md
    const projectMdPath = join(project.path, 'project.md');
    const logEntry = `\n[AGENT: WORKFLOW_PAUSED] ${new Date().toISOString()} | Workflow paused | Paused by ${pausedBy || 'user'} (previous status: ${previousStatus})\n`;
    await writeFile(projectMdPath, logEntry, { flag: 'a' });

    console.log(`[API] Workflow paused for project: ${id} (previous status: ${previousStatus})`);

    // Broadcast workflow:paused event to all project subscribers
    broadcastWorkflowPaused(id, pausedBy || 'user');

    // Broadcast project:updated event
    broadcastProjectUpdated(id, 'updated');

    res.json({
      success: true,
      projectId: id,
      previousStatus,
      status: project.status,
      pausedBy: pausedBy || 'user',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[API] Error pausing workflow:', err);
    logError('Failed to pause workflow', 'error', 'api', 'WORKFLOW_PAUSE_ERROR', id, {
      message: errorMessage,
      stack: err instanceof Error ? err.stack : undefined
    });
    broadcastError('Failed to pause workflow', 'WORKFLOW_PAUSE_ERROR', { projectId: id, message: errorMessage });
    res.status(500).json({ error: 'Failed to pause workflow' });
  }
});

// POST /api/projects/:id/workflow/resume - Resume workflow processing
app.post('/api/projects/:id/workflow/resume', async (req, res) => {
  const { id } = req.params;

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    const project = getProject(id);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${id}`
      });
    }

    // Check if project is paused
    if (project.status !== 'paused') {
      return res.status(400).json({
        error: 'Not paused',
        message: `Project ${id} is not paused (current status: ${project.status})`
      });
    }

    // Get the resumedBy from request body (optional)
    const { resumedBy } = req.body;

    // Restore previous status - default to 'active' if not specified
    // Note: If the project was awaiting_approval before pause, we restore that
    const newStatus = 'active';
    project.status = newStatus;
    project.metadata.lastUpdated = new Date().toISOString();

    // Update cache
    setProject(id, project);

    // Save updated tasks.json to disk
    const tasksJsonPath = join(project.path, 'tasks.json');
    const tasksData = {
      version: '1.0',
      project: id,
      updated: new Date().toISOString(),
      tasks: project.tasks,
      approvedTier: project.currentTier,
      paused: false  // Persist resumed state
    };
    await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));

    // Append resume log to project.md
    const projectMdPath = join(project.path, 'project.md');
    const logEntry = `\n[AGENT: WORKFLOW_RESUMED] ${new Date().toISOString()} | Workflow resumed | Resumed by ${resumedBy || 'user'}\n`;
    await writeFile(projectMdPath, logEntry, { flag: 'a' });

    console.log(`[API] Workflow resumed for project: ${id}`);

    // Broadcast workflow:resumed event to all project subscribers
    broadcastWorkflowResumed(id, resumedBy || 'user');

    // Broadcast project:updated event
    broadcastProjectUpdated(id, 'updated');

    res.json({
      success: true,
      projectId: id,
      status: project.status,
      resumedBy: resumedBy || 'user',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[API] Error resuming workflow:', err);
    logError('Failed to resume workflow', 'error', 'api', 'WORKFLOW_RESUME_ERROR', id, {
      message: errorMessage,
      stack: err instanceof Error ? err.stack : undefined
    });
    broadcastError('Failed to resume workflow', 'WORKFLOW_RESUME_ERROR', { projectId: id, message: errorMessage });
    res.status(500).json({ error: 'Failed to resume workflow' });
  }
});

// POST /api/projects/:id/archive - Archive a project (move to /Archive folder)
app.post('/api/projects/:id/archive', async (req, res) => {
  const { id } = req.params;

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    const project = getProject(id);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${id}`
      });
    }

    // Define source and destination paths
    const projectsDir = getProjectsDir();
    const archiveDir = join(projectsDir, '..', 'Archive');
    const sourcePath = project.path;
    const destPath = join(archiveDir, id);

    // Check if already archived
    try {
      await stat(destPath);
      return res.status(409).json({
        error: 'Already archived',
        message: `Project ${id} is already archived`
      });
    } catch {
      // Directory doesn't exist in archive, which is what we want
    }

    // Ensure Archive directory exists
    await mkdir(archiveDir, { recursive: true });

    // Move project folder from /Projects to /Archive
    await rename(sourcePath, destPath);

    // Remove project from cache
    removeProject(id);

    // Broadcast project removal to connected clients
    broadcastProjectUpdated(id, 'deleted');

    console.log(`[API] Archived project: ${id} (moved to ${destPath})`);

    res.json({
      success: true,
      projectId: id,
      archivedPath: destPath,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[API] Error archiving project:', err);
    logError('Failed to archive project', 'error', 'api', 'PROJECT_ARCHIVE_ERROR', id, {
      message: errorMessage,
      stack: err instanceof Error ? err.stack : undefined
    });
    broadcastError('Failed to archive project', 'PROJECT_ARCHIVE_ERROR', { projectId: id, message: errorMessage });
    res.status(500).json({ error: 'Failed to archive project' });
  }
});

// POST /api/projects/:id/tasks - Create a new task in a project
app.post('/api/projects/:id/tasks', async (req, res) => {
  const { id } = req.params;

  try {
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    const project = getProject(id);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${id}`
      });
    }

    const { title, description, status, tier, priority } = req.body;

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Task title is required and must be a non-empty string'
      });
    }

    // Validate status if provided
    const validStatuses = ['pending', 'in_progress', 'done', 'blocked'];
    const taskStatus = status || 'pending';
    if (!validStatuses.includes(taskStatus)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Validate priority if provided
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    const taskPriority = priority || 'medium';
    if (!validPriorities.includes(taskPriority)) {
      return res.status(400).json({
        error: 'Invalid priority',
        message: `Priority must be one of: ${validPriorities.join(', ')}`
      });
    }

    // Validate tier if provided
    const taskTier = typeof tier === 'number' ? tier : 0;
    if (taskTier < 0 || !Number.isInteger(taskTier)) {
      return res.status(400).json({
        error: 'Invalid tier',
        message: 'Tier must be a non-negative integer'
      });
    }

    // Generate unique task ID
    const taskId = `${id}-task-${Date.now()}`;

    // Create new task
    const now = new Date().toISOString();
    const newTask: Task = {
      id: taskId,
      title: title.trim(),
      description: description ? description.trim() : '',
      status: taskStatus,
      priority: taskPriority,
      tier: taskTier,
      created: now
    };

    // Add timestamps based on status
    if (taskStatus === 'in_progress') {
      newTask.started = now;
    }
    if (taskStatus === 'done') {
      newTask.started = now;
      newTask.completed = now;
    }

    // Add task to project
    project.tasks.push(newTask);

    // Update project metadata
    project.metadata.totalTasks = project.tasks.length;
    project.metadata.pendingTasks = project.tasks.filter(t => t.status === 'pending').length;
    project.metadata.inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
    project.metadata.completedTasks = project.tasks.filter(t => t.status === 'done').length;
    project.metadata.lastUpdated = now;

    // Save tasks.json to disk
    const tasksJsonPath = join(project.path, 'tasks.json');
    const tasksData = {
      version: '1.0',
      project: id,
      updated: now,
      tasks: project.tasks,
      approvedTier: project.currentTier
    };
    await fsWriteFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));

    // Update project in cache
    setProject(id, project);

    // Broadcast project update to notify all subscribers
    broadcastProjectUpdated(id, 'updated');

    console.log(`[API] Created task ${taskId} in project: ${id}`);

    res.status(201).json({
      success: true,
      task: newTask,
      projectId: id,
      timestamp: now
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[API] Error creating task:', err);
    logError('Failed to create task', 'error', 'api', 'TASK_CREATE_ERROR', id, {
      message: errorMessage,
      stack: err instanceof Error ? err.stack : undefined
    });
    broadcastError('Failed to create task', 'TASK_CREATE_ERROR', { projectId: id, message: errorMessage });
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PATCH /api/projects/:id/tasks/:taskId - Update task status and/or agent
app.patch('/api/projects/:id/tasks/:taskId', async (req, res) => {
  // Extract params outside try block so they're available in catch block
  const { id, taskId } = req.params;

  try {
    const { status, agent } = req.body;

    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data. Please try again shortly.'
      });
    }

    // Validate that at least one field is being updated
    if (status === undefined && agent === undefined) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Request must include at least one field to update: status or agent'
      });
    }

    // Validate status if provided
    const validStatuses = ['pending', 'in_progress', 'done', 'blocked'];
    if (status !== undefined && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    const project = getProject(id);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${id}`
      });
    }

    // Find the task
    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
        message: `No task found with ID: ${taskId} in project: ${id}`
      });
    }

    // Get the task's tier before updating
    const taskTier = task.tier ?? 0;
    const oldStatus = task.status;
    let agentUpdated = false;

    // Update task status if provided
    if (status !== undefined) {
      task.status = status;
      if (status === 'done' && oldStatus !== 'done') {
        task.completed = new Date().toISOString();
      }
      if (status === 'in_progress' && oldStatus === 'pending') {
        task.started = new Date().toISOString();
      }
    }

    // Update task agent if provided
    if (agent !== undefined) {
      task.agent = agent || undefined;
      agentUpdated = true;
    }

    // Update project metadata (only if status was updated)
    if (status !== undefined) {
      const completedTasks = project.tasks.filter(t => t.status === 'done').length;
      const inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
      const pendingTasks = project.tasks.filter(t => t.status === 'pending').length;

      project.metadata.completedTasks = completedTasks;
      project.metadata.inProgressTasks = inProgressTasks;
      project.metadata.pendingTasks = pendingTasks;
    }
    project.metadata.lastUpdated = new Date().toISOString();

    // Save tasks.json to disk (preserve approvedTier from existing project)
    const tasksJsonPath = join(project.path, 'tasks.json');
    const tasksData = {
      version: '1.0',
      project: id,
      updated: new Date().toISOString(),
      tasks: project.tasks,
      approvedTier: project.currentTier  // Preserve the current approved tier
    };
    await fsWriteFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));

    // Update project in cache
    setProject(id, project);

    // Log the update
    if (status !== undefined && agentUpdated) {
      console.log(`[API] Updated task ${taskId} status to '${status}' and agent to '${agent || 'auto'}' in project: ${id}`);
    } else if (status !== undefined) {
      console.log(`[API] Updated task ${taskId} status to '${status}' in project: ${id}`);
    } else if (agentUpdated) {
      console.log(`[API] Updated task ${taskId} agent to '${agent || 'auto'}' in project: ${id}`);
    }

    // Check if all tasks in this tier are now done (only for status updates)
    let allTierTasksDone = false;
    if (status !== undefined) {
      const tierTasks = project.tasks.filter(t => (t.tier ?? 0) === taskTier);
      allTierTasksDone = tierTasks.length > 0 && tierTasks.every(t => t.status === 'done');

      // Broadcast tier:complete if all tasks in tier are done and this was the last task to complete
      if (allTierTasksDone && status === 'done') {
        console.log(`[API] Tier ${taskTier} complete for project: ${id} (${tierTasks.length} tasks)`);
        broadcastTierComplete(id, taskTier, tierTasks.length);

        // Set project status to awaiting_approval if not already
        // Note: No max tier limit - supports unlimited tiers
        if (project.status === 'active') {
          project.status = 'awaiting_approval';
          console.log(`[API] Project ${id} status changed to awaiting_approval`);

          // Broadcast tier:awaiting_approval event to notify clients that approval is needed
          broadcastTierAwaitingApproval(id, project.currentTier, tierTasks.length);
        }
      }
    }

    res.json({
      taskId,
      status: task.status,
      agent: task.agent,
      tier: taskTier,
      tierComplete: allTierTasksDone,
      projectId: id
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[API] Error updating task:', err);
    logError('Failed to update task', 'error', 'api', 'TASK_UPDATE_ERROR', id, {
      message: errorMessage,
      stack: err instanceof Error ? err.stack : undefined,
      taskId
    });
    broadcastError('Failed to update task', 'TASK_UPDATE_ERROR', { projectId: id, taskId, message: errorMessage });
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Register WebSocket server with broadcaster
setWebSocketServer(wss);

// WebSocket connection handling
wss.on('connection', (ws) => {
  // Register the client connection
  const clientId = registerClient(ws);

  // Send cache status
  const stats = getCacheStats();
  ws.send(JSON.stringify({
    type: 'cache:status',
    data: stats
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('[WebSocket] Received:', data);

      // Update last activity timestamp
      updateClientActivity(clientId);

      // Handle subscription to project updates
      if (data.type === 'subscribe:project') {
        const success = subscribeToProject(clientId, data.projectId);
        ws.send(JSON.stringify({
          type: 'subscribed',
          projectId: data.projectId,
          success
        }));
      }

      // Handle unsubscription from project updates
      if (data.type === 'unsubscribe:project') {
        const success = unsubscribeFromProject(clientId, data.projectId);
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          projectId: data.projectId,
          success
        }));
      }

      // Handle tier approval from client
      if (data.type === 'tier:approve') {
        const { projectId, approvedBy } = data;

        if (!projectId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Missing projectId in tier:approve message'
          }));
          return;
        }

        // Get project from cache
        const project = getProject(projectId);
        if (!project) {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Project not found: ${projectId}`
          }));
          return;
        }

        // Check if tier transition is valid (project must be in awaiting_approval status)
        if (project.status !== 'awaiting_approval') {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Project ${projectId} is not awaiting approval (current status: ${project.status})`
          }));
          return;
        }

        // Store previous tier for broadcast
        const previousTier = project.currentTier;
        const newTier = previousTier + 1;  // Allow unlimited tiers

        // Update project tier and status
        project.currentTier = newTier;
        project.status = 'active';
        project.metadata.lastUpdated = new Date().toISOString();

        // Update cache
        setProject(projectId, project);

        // Save updated tasks.json to disk with approvedTier
        try {
          const tasksJsonPath = join(project.path, 'tasks.json');
          const tasksData = {
            version: '1.0',
            project: projectId,
            updated: new Date().toISOString(),
            tasks: project.tasks,
            approvedTier: newTier  // Persist the approved tier for scanner
          };
          await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));

          // Append approval log to project.md
          const projectMdPath = join(project.path, 'project.md');
          const logEntry = `\n[AGENT: TIER_APPROVAL] ${new Date().toISOString()} | Tier ${previousTier} -> ${newTier} | Approved by ${approvedBy || 'user'}\n`;
          await writeFile(projectMdPath, logEntry, { flag: 'a' });

          console.log(`[WebSocket] Tier approval processed for project: ${projectId} (tier ${previousTier} -> ${newTier})`);

          // Log the tier transition (WebSocket trigger)
          logTierTransition(projectId, previousTier, newTier, 'websocket', approvedBy || 'user', {
            previousStatus: 'awaiting_approval',
            newStatus: 'active'
          });

          // Send confirmation to the approving client
          ws.send(JSON.stringify({
            type: 'tier:approve:confirmed',
            data: {
              projectId,
              previousTier,
              newTier,
              approvedBy: approvedBy || 'user'
            }
          }));

          // Broadcast tier:approved event to all project subscribers
          broadcastTierApproved(projectId, previousTier, newTier, approvedBy || 'user');
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.error('[WebSocket] Error processing tier approval:', err);
          logError('Failed to process tier approval via WebSocket', 'error', 'websocket', 'TIER_APPROVAL_ERROR', projectId, {
            message: errorMessage,
            stack: err instanceof Error ? err.stack : undefined
          });
          broadcastError('Failed to process tier approval', 'TIER_APPROVAL_ERROR', { projectId, message: errorMessage });
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process tier approval'
          }));
        }
      }

      // Handle workflow pause from client
      if (data.type === 'workflow:pause') {
        const { projectId, pausedBy } = data;

        if (!projectId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Missing projectId in workflow:pause message'
          }));
          return;
        }

        // Get project from cache
        const project = getProject(projectId);
        if (!project) {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Project not found: ${projectId}`
          }));
          return;
        }

        // Check if project is already paused
        if (project.status === 'paused') {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Project ${projectId} is already paused`
          }));
          return;
        }

        // Update project status
        const previousStatus = project.status;
        project.status = 'paused';
        project.metadata.lastUpdated = new Date().toISOString();

        // Update cache
        setProject(projectId, project);

        // Save updated tasks.json to disk
        try {
          const tasksJsonPath = join(project.path, 'tasks.json');
          const tasksData = {
            version: '1.0',
            project: projectId,
            updated: new Date().toISOString(),
            tasks: project.tasks,
            approvedTier: project.currentTier,
            paused: true
          };
          await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));

          // Append pause log to project.md
          const projectMdPath = join(project.path, 'project.md');
          const logEntry = `\n[AGENT: WORKFLOW_PAUSED] ${new Date().toISOString()} | Workflow paused | Paused by ${pausedBy || 'user'} (previous status: ${previousStatus})\n`;
          await writeFile(projectMdPath, logEntry, { flag: 'a' });

          console.log(`[WebSocket] Workflow paused for project: ${projectId}`);

          // Send confirmation to the pausing client
          ws.send(JSON.stringify({
            type: 'workflow:pause:confirmed',
            data: {
              projectId,
              previousStatus,
              pausedBy: pausedBy || 'user'
            }
          }));

          // Broadcast workflow:paused event to all project subscribers
          broadcastWorkflowPaused(projectId, pausedBy || 'user');
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.error('[WebSocket] Error pausing workflow:', err);
          logError('Failed to pause workflow via WebSocket', 'error', 'websocket', 'WORKFLOW_PAUSE_ERROR', projectId, {
            message: errorMessage,
            stack: err instanceof Error ? err.stack : undefined
          });
          broadcastError('Failed to pause workflow', 'WORKFLOW_PAUSE_ERROR', { projectId, message: errorMessage });
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to pause workflow'
          }));
        }
      }

      // Handle workflow resume from client
      if (data.type === 'workflow:resume') {
        const { projectId, resumedBy } = data;

        if (!projectId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Missing projectId in workflow:resume message'
          }));
          return;
        }

        // Get project from cache
        const project = getProject(projectId);
        if (!project) {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Project not found: ${projectId}`
          }));
          return;
        }

        // Check if project is paused
        if (project.status !== 'paused') {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Project ${projectId} is not paused (current status: ${project.status})`
          }));
          return;
        }

        // Update project status
        project.status = 'active';
        project.metadata.lastUpdated = new Date().toISOString();

        // Update cache
        setProject(projectId, project);

        // Save updated tasks.json to disk
        try {
          const tasksJsonPath = join(project.path, 'tasks.json');
          const tasksData = {
            version: '1.0',
            project: projectId,
            updated: new Date().toISOString(),
            tasks: project.tasks,
            approvedTier: project.currentTier,
            paused: false
          };
          await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));

          // Append resume log to project.md
          const projectMdPath = join(project.path, 'project.md');
          const logEntry = `\n[AGENT: WORKFLOW_RESUMED] ${new Date().toISOString()} | Workflow resumed | Resumed by ${resumedBy || 'user'}\n`;
          await writeFile(projectMdPath, logEntry, { flag: 'a' });

          console.log(`[WebSocket] Workflow resumed for project: ${projectId}`);

          // Send confirmation to the resuming client
          ws.send(JSON.stringify({
            type: 'workflow:resume:confirmed',
            data: {
              projectId,
              resumedBy: resumedBy || 'user'
            }
          }));

          // Broadcast workflow:resumed event to all project subscribers
          broadcastWorkflowResumed(projectId, resumedBy || 'user');
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.error('[WebSocket] Error resuming workflow:', err);
          logError('Failed to resume workflow via WebSocket', 'error', 'websocket', 'WORKFLOW_RESUME_ERROR', projectId, {
            message: errorMessage,
            stack: err instanceof Error ? err.stack : undefined
          });
          broadcastError('Failed to resume workflow', 'WORKFLOW_RESUME_ERROR', { projectId, message: errorMessage });
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to resume workflow'
          }));
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WebSocket] Invalid message format:', err);
      logError('Invalid WebSocket message format', 'warning', 'websocket', 'WS_MESSAGE_ERROR', undefined, {
        message: errorMessage,
        stack: err instanceof Error ? err.stack : undefined
      });
      broadcastError('Invalid WebSocket message format', 'WS_MESSAGE_ERROR', { message: errorMessage });
    }
  });

  ws.on('close', () => {
    // Clean up all project subscriptions for this client
    unsubscribeClientFromAllProjects(clientId);
    // Unregister the client connection
    unregisterClient(clientId);
  });
});

// Start server
server.listen(PORT, async () => {
  console.log(`[Server] TaskMaster v2 running on port ${PORT}`);

  // Initialize expansion registry first
  console.log('[Server] Initializing expansion registry...');
  const expansionResult = await initExpansionRegistry();


  if (expansionResult.success) {
    const stats = getExpansionStats();
    console.log(`[Server] Expansion registry initialized with ${stats.count} expansions (${stats.fileExpansions} file, ${stats.folderExpansions} folder)`);
  } else {
    console.error('[Server] Expansion registry initialization failed:', expansionResult.errors);
  }

  // Initialize skills registry
  console.log('[Server] Initializing skills registry...');
  await initSkillRegistry();

  // Hydrate cache from filesystem on startup
  console.log('[Server] Hydrating cache from filesystem...');
  const result = await hydrateCache();

  if (result.success) {
    console.log(`[Server] Cache hydrated successfully with ${result.count} projects`);
  } else {
    console.error('[Server] Cache hydration failed:', result.errors);
  }

  // Hydrate in-memory logs from disk (system-log.ndjson + agentlogs.md files)
  await hydrateFromSystemLog();
  await hydrateAgentActivityFromProjectLogs(getProjectsDir());

  // Initialize file system watcher
  console.log('[Server] Initializing file system watcher...');
  const watcherResult = await initWatcher();

  if (watcherResult.success) {
    console.log('[Server] File system watcher initialized successfully');
  } else {
    console.error('[Server] File system watcher initialization failed:', watcherResult.error);
  }

  // Perform lock file recovery scan
  console.log('[Server] Performing lock file recovery scan...');
  const recoveryResult = await performLockRecovery();

  if (recoveryResult.totalLocksFound > 0) {
    console.log(`[Server] Lock recovery complete: ${recoveryResult.locksRecovered} recovered, ${recoveryResult.locksCleaned} cleaned up`);
  } else {
    console.log('[Server] No lock files found - clean startup');
  }
});
// Trigger restart Sun Feb 22 12:52:33 AM PST 2026
