/**
 * WebSocket Subscription Manager for TaskMaster
 * Manages project room subscriptions for WebSocket clients
 */

import type { WebSocket } from 'ws';
import { getClient } from './connectionManager.js';

// Map of projectId -> Set of client IDs subscribed to that project
const projectSubscriptions = new Map<string, Set<string>>();

// Map of clientId -> Set of projectIds that client is subscribed to
const clientSubscriptions = new Map<string, Set<string>>();

/**
 * Subscribe a client to a project room
 */
export function subscribeToProject(clientId: string, projectId: string): boolean {
  // Validate client exists
  const client = getClient(clientId);
  if (!client) {
    console.warn(`[Subscription] Cannot subscribe: client ${clientId} not found`);
    return false;
  }

  // Add to project -> clients mapping
  if (!projectSubscriptions.has(projectId)) {
    projectSubscriptions.set(projectId, new Set());
  }
  projectSubscriptions.get(projectId)!.add(clientId);

  // Add to client -> projects mapping
  if (!clientSubscriptions.has(clientId)) {
    clientSubscriptions.set(clientId, new Set());
  }
  clientSubscriptions.get(clientId)!.add(projectId);

  console.log(`[Subscription] Client ${clientId} subscribed to project: ${projectId}`);
  return true;
}

/**
 * Unsubscribe a client from a project room
 */
export function unsubscribeFromProject(clientId: string, projectId: string): boolean {
  // Remove from project -> clients mapping
  const projectClients = projectSubscriptions.get(projectId);
  if (projectClients) {
    projectClients.delete(clientId);
    if (projectClients.size === 0) {
      projectSubscriptions.delete(projectId);
    }
  }

  // Remove from client -> projects mapping
  const clientProjects = clientSubscriptions.get(clientId);
  if (clientProjects) {
    clientProjects.delete(projectId);
    if (clientProjects.size === 0) {
      clientSubscriptions.delete(clientId);
    }
  }

  console.log(`[Subscription] Client ${clientId} unsubscribed from project: ${projectId}`);
  return true;
}

/**
 * Unsubscribe a client from all projects (call when client disconnects)
 */
export function unsubscribeClientFromAllProjects(clientId: string): void {
  const clientProjects = clientSubscriptions.get(clientId);
  if (clientProjects) {
    for (const projectId of clientProjects) {
      const projectClients = projectSubscriptions.get(projectId);
      if (projectClients) {
        projectClients.delete(clientId);
        if (projectClients.size === 0) {
          projectSubscriptions.delete(projectId);
        }
      }
    }
    clientSubscriptions.delete(clientId);
  }

  console.log(`[Subscription] Client ${clientId} unsubscribed from all projects`);
}

/**
 * Get all clients subscribed to a specific project
 */
export function getProjectSubscribers(projectId: string): string[] {
  const subscribers = projectSubscriptions.get(projectId);
  return subscribers ? Array.from(subscribers) : [];
}

/**
 * Get all projects a client is subscribed to
 */
export function getClientSubscriptions(clientId: string): string[] {
  const subscriptions = clientSubscriptions.get(clientId);
  return subscriptions ? Array.from(subscriptions) : [];
}

/**
 * Check if a client is subscribed to a specific project
 */
export function isSubscribedToProject(clientId: string, projectId: string): boolean {
  const projectClients = projectSubscriptions.get(projectId);
  return projectClients ? projectClients.has(clientId) : false;
}

/**
 * Get subscription statistics
 */
export function getSubscriptionStats(): {
  totalSubscriptions: number;
  projectCount: number;
  clientCount: number;
  projects: Record<string, number>;
} {
  const projects: Record<string, number> = {};
  for (const [projectId, clients] of projectSubscriptions.entries()) {
    projects[projectId] = clients.size;
  }

  return {
    totalSubscriptions: Array.from(projectSubscriptions.values()).reduce((sum, set) => sum + set.size, 0),
    projectCount: projectSubscriptions.size,
    clientCount: clientSubscriptions.size,
    projects
  };
}

/**
 * Get all subscription data for a client (for broadcast targeting)
 */
export function getClientWebSocket(clientId: string): WebSocket | undefined {
  const client = getClient(clientId);
  return client?.ws;
}
