/**
 * WebSocket Connection Manager for TaskMaster
 * Tracks connected clients and provides connection statistics
 */

import type { WebSocket } from 'ws';

export interface ClientInfo {
  id: string;
  ws: WebSocket;
  connectedAt: string;
  lastActivity: string;
}

// Map of client ID to client info
const connectedClients = new Map<string, ClientInfo>();

let clientIdCounter = 0;

/**
 * Generate a unique client ID
 */
function generateClientId(): string {
  clientIdCounter++;
  return `client-${Date.now()}-${clientIdCounter}`;
}

/**
 * Register a new WebSocket client connection
 */
export function registerClient(ws: WebSocket): string {
  const clientId = generateClientId();
  const now = new Date().toISOString();

  const clientInfo: ClientInfo = {
    id: clientId,
    ws,
    connectedAt: now,
    lastActivity: now
  };

  connectedClients.set(clientId, clientInfo);

  console.log(`[WebSocket] Client connected: ${clientId} (total: ${connectedClients.size})`);

  // Send connection acknowledgment to client
  ws.send(JSON.stringify({
    type: 'connection:ack',
    data: {
      clientId,
      connectedAt: now,
      serverTime: now
    }
  }));

  return clientId;
}

/**
 * Unregister a WebSocket client connection
 */
export function unregisterClient(clientId: string): void {
  const client = connectedClients.get(clientId);
  if (client) {
    connectedClients.delete(clientId);
    console.log(`[WebSocket] Client disconnected: ${clientId} (total: ${connectedClients.size})`);
  }
}

/**
 * Update last activity timestamp for a client
 */
export function updateClientActivity(clientId: string): void {
  const client = connectedClients.get(clientId);
  if (client) {
    client.lastActivity = new Date().toISOString();
  }
}

/**
 * Get the number of connected clients
 */
export function getConnectionCount(): number {
  return connectedClients.size;
}

/**
 * Get detailed information about all connected clients
 */
export function getConnectedClients(): Array<{
  id: string;
  connectedAt: string;
  lastActivity: string;
}> {
  return Array.from(connectedClients.values()).map(client => ({
    id: client.id,
    connectedAt: client.connectedAt,
    lastActivity: client.lastActivity
  }));
}

/**
 * Get connection statistics
 */
export function getConnectionStats(): {
  count: number;
  clients: Array<{
    id: string;
    connectedAt: string;
    lastActivity: string;
  }>;
} {
  return {
    count: connectedClients.size,
    clients: getConnectedClients()
  };
}

/**
 * Check if a client is connected
 */
export function isClientConnected(clientId: string): boolean {
  return connectedClients.has(clientId);
}

/**
 * Get client info by ID
 */
export function getClient(clientId: string): ClientInfo | undefined {
  return connectedClients.get(clientId);
}

/**
 * Clear all connections (useful for testing or shutdown)
 */
export function clearAllConnections(): void {
  connectedClients.clear();
  console.log('[WebSocket] All connections cleared');
}
