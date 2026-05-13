/**
 * WebSocket Broadcaster for TaskMaster
 * Broadcasts file system events to connected WebSocket clients
 */

import type { WebSocketServer, WebSocket } from 'ws';
import { logAgentSpawned, logAgentExited, logAgentOutput, logAgentHeartbeat } from '../audit/index.js';

let wss: WebSocketServer | null = null;

/**
 * Set the WebSocket server instance for broadcasting
 */
export function setWebSocketServer(server: WebSocketServer): void {
  wss = server;
}

/**
 * Get the WebSocket server instance
 */
export function getWebSocketServer(): WebSocketServer | null {
  return wss;
}

/**
 * Broadcast a message to all connected WebSocket clients
 */
export function broadcast(event: string, data: unknown): void {
  if (!wss) {
    // Silently skip if no WebSocket server (e.g., MCP stdio mode)
    // The file watcher will sync caches; Express server handles WS broadcasts
    return;
  }

  const message = JSON.stringify({
    type: event,
    data,
    timestamp: new Date().toISOString()
  });

  let clientCount = 0;
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) { // WebSocket.OPEN = 1
      client.send(message);
      clientCount++;
    }
  });

  if (clientCount > 0) {
    console.log(`[WebSocket] Broadcasted '${event}' to ${clientCount} client(s)`);
  }
}

import { getProjectSubscribers, getClientWebSocket } from './subscriptionManager.js';

/**
 * Broadcast a file change event
 */
export function broadcastFileChanged(
  action: 'created' | 'modified' | 'deleted',
  filePath: string,
  projectId?: string
): void {
  broadcast('file:changed', {
    action,
    path: filePath,
    projectId: projectId || null
  });
}

/**
 * Broadcast a file change event only to subscribers of a specific project
 */
export function broadcastFileChangedToProject(
  action: 'created' | 'modified' | 'deleted',
  filePath: string,
  projectId: string
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'file:changed',
    data: {
      action,
      path: filePath,
      projectId
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  if (clientCount > 0) {
    console.log(`[WebSocket] Broadcasted 'file:changed' to ${clientCount} subscriber(s) for project: ${projectId}`);
  }
}

/**
 * Broadcast a project update event only to subscribers of that project
 */
export function broadcastProjectUpdatedToSubscribers(
  projectId: string,
  action: 'created' | 'updated' | 'deleted'
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'project:updated',
    data: {
      projectId,
      action,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  if (clientCount > 0) {
    console.log(`[WebSocket] Broadcasted 'project:updated' to ${clientCount} subscriber(s) for project: ${projectId}`);
  }
}

/**
 * Broadcast a project update event
 */
export function broadcastProjectUpdated(projectId: string, action: 'created' | 'updated' | 'deleted'): void {
  broadcast('project:updated', {
    projectId,
    action,
    timestamp: new Date().toISOString()
  });
}

/**
 * Batch update item types
 */
interface BatchFileChange {
  action: 'created' | 'modified' | 'deleted';
  filePath: string;
  projectId?: string;
  timestamp: number;
}

interface BatchProjectUpdate {
  projectId: string;
  action: 'created' | 'updated' | 'deleted';
  timestamp: number;
}

/**
 * Broadcast a batch update containing multiple file changes and project updates
 * This is used for debouncing rapid file system changes
 */
export function broadcastBatchUpdate(
  fileChanges: BatchFileChange[],
  projectUpdates: BatchProjectUpdate[]
): void {
  broadcast('batch:update', {
    fileChanges: fileChanges.map(c => ({
      action: c.action,
      path: c.filePath,
      projectId: c.projectId || null
    })),
    projectUpdates: projectUpdates.map(p => ({
      projectId: p.projectId,
      action: p.action,
      timestamp: new Date(p.timestamp).toISOString()
    })),
    batchSize: fileChanges.length + projectUpdates.length,
    timestamp: new Date().toISOString()
  });
}

/**
 * Broadcast a tier:complete event to subscribers of a specific project
 * This is triggered when all tasks in a tier are marked as done
 */
export function broadcastTierComplete(
  projectId: string,
  tier: number,
  completedTaskCount: number
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'tier:complete',
    data: {
      projectId,
      tier,
      completedTaskCount,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  if (clientCount > 0) {
    console.log(`[WebSocket] Broadcasted 'tier:complete' (tier ${tier}) to ${clientCount} subscriber(s) for project: ${projectId}`);
  }
}

/**
 * Broadcast a tier:awaiting_approval event to subscribers of a specific project
 * This is triggered when all tasks in a tier are complete and the system is waiting for user approval
 */
export function broadcastTierAwaitingApproval(
  projectId: string,
  currentTier: number,
  completedTaskCount: number
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'tier:awaiting_approval',
    data: {
      projectId,
      currentTier,
      completedTaskCount,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  console.log(`[WebSocket] Broadcasted 'tier:awaiting_approval' (tier ${currentTier}) to ${clientCount} subscriber(s) for project: ${projectId}`);
}

/**
 * Broadcast an agent:heartbeat event to all connected WebSocket clients
 */
export function broadcastAgentHeartbeat(
  pid: number,
  agentName: string,
  timestamp: string
): void {
  broadcast('agent:heartbeat', {
    pid,
    agent: agentName,
    timestamp
  });

  // Log the heartbeat event
  logAgentHeartbeat(pid, agentName);
}

/**
 * Broadcast an agent:spawned event to all connected WebSocket clients
 */
export function broadcastAgentSpawned(
  pid: number,
  agentName: string,
  timestamp: string,
  projectId?: string,
  expansions?: string[]
): void {
  broadcast('agent:spawned', {
    pid,
    agent: agentName,
    timestamp,
    projectId: projectId || null,
    expansions: expansions || []
  });

  // Log the spawn event
  logAgentSpawned(pid, agentName, projectId, expansions);
}

/**
 * Broadcast an agent:exited event to all connected WebSocket clients
 */
export function broadcastAgentExited(
  pid: number,
  agentName: string,
  exitCode: number,
  timestamp: string,
  projectId?: string
): void {
  broadcast('agent:exited', {
    pid,
    agent: agentName,
    exitCode,
    timestamp,
    projectId: projectId || null
  });

  // Log the exit event
  logAgentExited(pid, agentName, exitCode, projectId);
}

/**
 * Broadcast an agent:output event to all connected WebSocket clients
 * This captures stdout/stderr from spawned agent processes
 */
export function broadcastAgentOutput(
  pid: number,
  agentName: string,
  output: string,
  stream: 'stdout' | 'stderr',
  timestamp: string,
  projectId?: string
): void {
  broadcast('agent:output', {
    pid,
    agent: agentName,
    output,
    stream,
    timestamp,
    projectId: projectId || null
  });

  // Log the output event
  logAgentOutput(pid, agentName, output, stream, projectId);
}

/**
 * Broadcast a tier:approved event to subscribers of a specific project
 * This is triggered when a user approves a tier transition
 */
export function broadcastTierApproved(
  projectId: string,
  previousTier: number,
  newTier: number,
  approvedBy: string
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'tier:approved',
    data: {
      projectId,
      previousTier,
      newTier,
      approvedBy,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  console.log(`[WebSocket] Broadcasted 'tier:approved' (tier ${previousTier} -> ${newTier}) to ${clientCount} subscriber(s) for project: ${projectId}`);
}

/**
 * Broadcast an error event to all connected WebSocket clients
 * This is triggered when server errors occur that clients should be aware of
 */
export function broadcastError(
  message: string,
  code?: string,
  details?: unknown
): void {
  broadcast('error', {
    message,
    code: code || 'SERVER_ERROR',
    details,
    timestamp: new Date().toISOString()
  });
}

/**
 * Broadcast an error event to subscribers of a specific project
 */
export function broadcastErrorToProject(
  projectId: string,
  message: string,
  code?: string,
  details?: unknown
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const errorMessage = JSON.stringify({
    type: 'error',
    data: {
      message,
      code: code || 'PROJECT_ERROR',
      projectId,
      details,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(errorMessage);
      clientCount++;
    }
  }

  if (clientCount > 0) {
    console.log(`[WebSocket] Broadcasted 'error' to ${clientCount} subscriber(s) for project: ${projectId}`);
  }
}

/**
 * Broadcast a workflow:paused event to subscribers of a specific project
 * This is triggered when a user pauses the workflow
 */
export function broadcastWorkflowPaused(
  projectId: string,
  pausedBy: string
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'workflow:paused',
    data: {
      projectId,
      pausedBy,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  console.log(`[WebSocket] Broadcasted 'workflow:paused' to ${clientCount} subscriber(s) for project: ${projectId}`);
}

/**
 * Broadcast a workflow:resumed event to subscribers of a specific project
 * This is triggered when a user resumes the workflow
 */
export function broadcastWorkflowResumed(
  projectId: string,
  resumedBy: string
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'workflow:resumed',
    data: {
      projectId,
      resumedBy,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  console.log(`[WebSocket] Broadcasted 'workflow:resumed' to ${clientCount} subscriber(s) for project: ${projectId}`);
}

/**
 * Check if WebSocket server is initialized
 */
export function isWebSocketReady(): boolean {
  return wss !== null;
}

/**
 * Broadcast an expansion:loaded event to all connected WebSocket clients
 * This is triggered when expansions are loaded or reloaded
 */
export function broadcastExpansionLoaded(
  expansionId: string,
  expansionName: string,
  type: 'file' | 'folder',
  action: 'loaded' | 'reloaded' | 'removed'
): void {
  broadcast('expansion:loaded', {
    expansionId,
    expansionName,
    type,
    action,
    timestamp: new Date().toISOString()
  });
}

/**
 * Broadcast an agent:expansions event when an agent is spawned with expansions
 */
export function broadcastAgentExpansions(
  pid: number,
  agentName: string,
  expansions: string[],
  timestamp: string
): void {
  broadcast('agent:expansions', {
    pid,
    agent: agentName,
    expansions,
    count: expansions.length,
    timestamp
  });
}

/**
 * Broadcast a log:updated event to subscribers of a specific project
 * This is triggered when project.md is modified with new agent log entries
 */
export function broadcastLogUpdated(
  projectId: string,
  logEntry: {
    agent: string;
    tag: string;
    timestamp: string;
    context: string;
    description: string;
    raw: string;
  }
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'log:updated',
    data: {
      projectId,
      logEntry,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  if (clientCount > 0) {
    console.log(`[WebSocket] Broadcasted 'log:updated' to ${clientCount} subscriber(s) for project: ${projectId}`);
  }
}

/**
 * Broadcast a task:started event to subscribers of a specific project
 * This is triggered when a task execution begins
 */
export function broadcastTaskStarted(
  projectId: string,
  taskId: string,
  agent: string
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'task:started',
    data: {
      projectId,
      taskId,
      agent,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  console.log(`[WebSocket] Broadcasted 'task:started' (${taskId}) to ${clientCount} subscriber(s) for project: ${projectId}`);
}

/**
 * Broadcast a task:progress event to subscribers of a specific project
 * This sends progress updates during task execution
 */
export function broadcastTaskProgress(
  projectId: string,
  taskId: string,
  message: string,
  percent?: number
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const wsMessage = JSON.stringify({
    type: 'task:progress',
    data: {
      projectId,
      taskId,
      message,
      percent,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(wsMessage);
      clientCount++;
    }
  }

  if (clientCount > 0) {
    console.log(`[WebSocket] Broadcasted 'task:progress' (${taskId}: ${percent}%) to ${clientCount} subscriber(s) for project: ${projectId}`);
  }
}

/**
 * Broadcast a task:completed event to subscribers of a specific project
 * This is triggered when a task finishes successfully
 */
export function broadcastTaskCompleted(
  projectId: string,
  taskId: string,
  result?: unknown
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'task:completed',
    data: {
      projectId,
      taskId,
      result,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  console.log(`[WebSocket] Broadcasted 'task:completed' (${taskId}) to ${clientCount} subscriber(s) for project: ${projectId}`);
}

/**
 * Broadcast a task:error event to subscribers of a specific project
 * This is triggered when a task execution fails
 */
export function broadcastTaskError(
  projectId: string,
  taskId: string,
  error: string
): void {
  if (!wss) {
    console.warn('[WebSocket] Cannot broadcast: server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: 'task:error',
    data: {
      projectId,
      taskId,
      error,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  const subscribers = getProjectSubscribers(projectId);
  let clientCount = 0;

  for (const clientId of subscribers) {
    const ws = getClientWebSocket(clientId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
      ws.send(message);
      clientCount++;
    }
  }

  console.log(`[WebSocket] Broadcasted 'task:error' (${taskId}) to ${clientCount} subscriber(s) for project: ${projectId}`);
}
