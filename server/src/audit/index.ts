/**
 * Audit Logging Module for TaskMaster
 * Captures and stores file system change events with timestamps
 */

import { writeFile, mkdir, appendFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: 'created' | 'modified' | 'deleted';
  filePath: string;
  projectId?: string;
  fileType: 'task' | 'project_doc' | 'agent' | 'expansion' | 'other';
  details?: Record<string, unknown>;
}

/**
 * Agent Activity Log Entry
 * Captures agent lifecycle events (spawn, exit, output)
 */
export interface AgentActivityLogEntry {
  id: string;
  timestamp: string;
  eventType: 'agent:spawned' | 'agent:exited' | 'agent:output' | 'agent:heartbeat';
  pid: number;
  agentName: string;
  projectId?: string;
  details: {
    exitCode?: number;
    output?: string;
    stream?: 'stdout' | 'stderr';
    expansions?: string[];
    [key: string]: unknown;
  };
}

/**
 * Tier Transition Log Entry
 * Captures tier changes with before/after states
 */
export interface TierTransitionLogEntry {
  id: string;
  timestamp: string;
  projectId: string;
  fromTier: number;
  toTier: number;
  approvedBy?: string;
  trigger: 'api' | 'websocket' | 'auto' | 'manual';
  details?: {
    previousStatus?: string;
    newStatus?: string;
    completedTaskCount?: number;
    [key: string]: unknown;
  };
}

/**
 * Error Log Entry
 * Captures system errors with details and timestamps
 */
export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  level: 'error' | 'warning' | 'critical';
  message: string;
  code?: string;
  projectId?: string;
  source: 'api' | 'websocket' | 'watcher' | 'scanner' | 'system' | 'agent';
  details?: {
    stack?: string;
    url?: string;
    method?: string;
    [key: string]: unknown;
  };
}

// In-memory audit log storage (circular buffer to prevent unbounded growth)
const MAX_LOG_ENTRIES = 1000;
const auditLog: AuditLogEntry[] = [];

// In-memory agent activity log storage
const MAX_AGENT_LOG_ENTRIES = 500;
const agentActivityLog: AgentActivityLogEntry[] = [];

// In-memory tier transition log storage
const MAX_TIER_LOG_ENTRIES = 500;
const tierTransitionLog: TierTransitionLogEntry[] = [];

// In-memory error log storage
const MAX_ERROR_LOG_ENTRIES = 500;
const errorLog: ErrorLogEntry[] = [];

// NDJSON persistence — one JSON object per line, survives restarts
const _auditDir = dirname(fileURLToPath(import.meta.url));
const SYSTEM_LOG_PATH = join(_auditDir, '../../../projects/system-log.ndjson');

function appendToSystemLog(type: string, entry: Record<string, unknown>): void {
  const line = JSON.stringify({ type, ...entry }) + '\n';
  appendFile(SYSTEM_LOG_PATH, line).catch(() => {/* non-blocking, ignore errors */});
}

export async function hydrateFromSystemLog(): Promise<void> {
  if (!existsSync(SYSTEM_LOG_PATH)) return;
  try {
    const content = await readFile(SYSTEM_LOG_PATH, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    // Parse oldest-first (file order), then unshift so buffer ends up newest-first
    const parsed: Array<{ type: string; [k: string]: unknown }> = [];
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)); } catch { /* skip malformed lines */ }
    }
    // Load in reverse so newest ends up at front after unshift
    for (let i = parsed.length - 1; i >= 0; i--) {
      const entry = parsed[i];
      switch (entry.type) {
        case 'audit':
          if (auditLog.length < MAX_LOG_ENTRIES)
            auditLog.push(entry as unknown as AuditLogEntry);
          break;
        case 'agent':
          if (agentActivityLog.length < MAX_AGENT_LOG_ENTRIES)
            agentActivityLog.push(entry as unknown as AgentActivityLogEntry);
          break;
        case 'tier':
          if (tierTransitionLog.length < MAX_TIER_LOG_ENTRIES)
            tierTransitionLog.push(entry as unknown as TierTransitionLogEntry);
          break;
        case 'error':
          if (errorLog.length < MAX_ERROR_LOG_ENTRIES)
            errorLog.push(entry as unknown as ErrorLogEntry);
          break;
      }
    }
    // Buffers are newest-first; loaded from oldest-first file so reverse each
    auditLog.reverse();
    agentActivityLog.reverse();
    tierTransitionLog.reverse();
    errorLog.reverse();
    console.log(`[Audit] Hydrated from system-log.ndjson: ${parsed.length} entries`);
  } catch (err) {
    console.warn('[Audit] Could not read system-log.ndjson:', (err as Error).message);
  }
}

/**
 * Generate a unique log entry ID
 */
function generateLogId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Determine file type based on path and name
 */
function determineFileType(filePath: string): AuditLogEntry['fileType'] {
  if (filePath.endsWith('tasks.json')) {
    return 'task';
  }
  if (filePath.endsWith('project.md')) {
    return 'project_doc';
  }
  if (filePath.includes('/Agents/')) {
    if (filePath.includes('/Expansions/')) {
      return 'expansion';
    }
    return 'agent';
  }
  return 'other';
}

/**
 * Extract project ID from file path
 */
function extractProjectId(filePath: string): string | undefined {
  const projectsMatch = filePath.match(/\/Projects\/([^/]+)/);
  if (projectsMatch) {
    return projectsMatch[1];
  }
  return undefined;
}

/**
 * Log a file system change event
 */
export function logFileChange(
  action: AuditLogEntry['action'],
  filePath: string,
  projectId?: string
): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: generateLogId(),
    timestamp: new Date().toISOString(),
    action,
    filePath,
    projectId: projectId || extractProjectId(filePath),
    fileType: determineFileType(filePath)
  };

  // Add to beginning of array (newest first)
  auditLog.unshift(entry);

  // Trim to max size if needed
  if (auditLog.length > MAX_LOG_ENTRIES) {
    auditLog.length = MAX_LOG_ENTRIES;
  }

  appendToSystemLog('audit', entry as unknown as Record<string, unknown>);
  console.log(`[Audit] ${action.toUpperCase()}: ${filePath}`);

  return entry;
}

/**
 * Get all audit log entries
 */
export function getAuditLogs(
  limit: number = 100,
  action?: AuditLogEntry['action'],
  projectId?: string
): AuditLogEntry[] {
  let logs = [...auditLog];

  // Filter by action if specified
  if (action) {
    logs = logs.filter(log => log.action === action);
  }

  // Filter by project if specified
  if (projectId) {
    logs = logs.filter(log => log.projectId === projectId);
  }

  // Apply limit
  return logs.slice(0, limit);
}

/**
 * Get audit log statistics
 */
export function getAuditStats(): {
  totalEntries: number;
  created: number;
  modified: number;
  deleted: number;
} {
  return {
    totalEntries: auditLog.length,
    created: auditLog.filter(log => log.action === 'created').length,
    modified: auditLog.filter(log => log.action === 'modified').length,
    deleted: auditLog.filter(log => log.action === 'deleted').length
  };
}

/**
 * Clear all audit logs
 */
export function clearAuditLogs(): void {
  auditLog.length = 0;
  console.log('[Audit] All audit logs cleared');
}

/**
 * Get recent file changes for a specific project
 */
export function getProjectChanges(
  projectId: string,
  limit: number = 50
): AuditLogEntry[] {
  return auditLog
    .filter(log => log.projectId === projectId)
    .slice(0, limit);
}

// ============================================================================
// Agent Activity Logging
// ============================================================================

/**
 * Generate a unique agent log entry ID
 */
function generateAgentLogId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Log an agent spawned event
 */
export function logAgentSpawned(
  pid: number,
  agentName: string,
  projectId?: string,
  expansions?: string[]
): AgentActivityLogEntry {
  const entry: AgentActivityLogEntry = {
    id: generateAgentLogId(),
    timestamp: new Date().toISOString(),
    eventType: 'agent:spawned',
    pid,
    agentName,
    projectId,
    details: {
      expansions: expansions || []
    }
  };

  // Add to beginning of array (newest first)
  agentActivityLog.unshift(entry);

  // Trim to max size if needed
  if (agentActivityLog.length > MAX_AGENT_LOG_ENTRIES) {
    agentActivityLog.length = MAX_AGENT_LOG_ENTRIES;
  }

  appendToSystemLog('agent', entry as unknown as Record<string, unknown>);
  console.log(`[Audit] Agent spawned: ${agentName} (PID ${pid})${projectId ? ` for project: ${projectId}` : ''}`);

  return entry;
}

/**
 * Log an agent exited event
 */
export function logAgentExited(
  pid: number,
  agentName: string,
  exitCode: number,
  projectId?: string
): AgentActivityLogEntry {
  const entry: AgentActivityLogEntry = {
    id: generateAgentLogId(),
    timestamp: new Date().toISOString(),
    eventType: 'agent:exited',
    pid,
    agentName,
    projectId,
    details: {
      exitCode
    }
  };

  // Add to beginning of array (newest first)
  agentActivityLog.unshift(entry);

  // Trim to max size if needed
  if (agentActivityLog.length > MAX_AGENT_LOG_ENTRIES) {
    agentActivityLog.length = MAX_AGENT_LOG_ENTRIES;
  }

  appendToSystemLog('agent', entry as unknown as Record<string, unknown>);
  console.log(`[Audit] Agent exited: ${agentName} (PID ${pid}) with code ${exitCode}`);

  return entry;
}

/**
 * Log an agent output event
 */
export function logAgentOutput(
  pid: number,
  agentName: string,
  output: string,
  stream: 'stdout' | 'stderr',
  projectId?: string
): AgentActivityLogEntry {
  const entry: AgentActivityLogEntry = {
    id: generateAgentLogId(),
    timestamp: new Date().toISOString(),
    eventType: 'agent:output',
    pid,
    agentName,
    projectId,
    details: {
      output: output.substring(0, 1000), // Limit output length
      stream
    }
  };

  // Add to beginning of array (newest first)
  agentActivityLog.unshift(entry);

  // Trim to max size if needed
  if (agentActivityLog.length > MAX_AGENT_LOG_ENTRIES) {
    agentActivityLog.length = MAX_AGENT_LOG_ENTRIES;
  }

  // Don't log to console for output events (too verbose)

  return entry;
}

/**
 * Log an agent heartbeat event
 */
export function logAgentHeartbeat(
  pid: number,
  agentName: string,
  projectId?: string
): AgentActivityLogEntry {
  const entry: AgentActivityLogEntry = {
    id: generateAgentLogId(),
    timestamp: new Date().toISOString(),
    eventType: 'agent:heartbeat',
    pid,
    agentName,
    projectId,
    details: {}
  };

  // Add to beginning of array (newest first)
  agentActivityLog.unshift(entry);

  // Trim to max size if needed
  if (agentActivityLog.length > MAX_AGENT_LOG_ENTRIES) {
    agentActivityLog.length = MAX_AGENT_LOG_ENTRIES;
  }

  // Don't log heartbeats to console (too verbose)

  return entry;
}

/**
 * Get agent activity logs
 */
export function getAgentActivityLogs(
  limit: number = 100,
  eventType?: AgentActivityLogEntry['eventType'],
  agentName?: string,
  projectId?: string
): AgentActivityLogEntry[] {
  let logs = [...agentActivityLog];

  // Filter by event type if specified
  if (eventType) {
    logs = logs.filter(log => log.eventType === eventType);
  }

  // Filter by agent name if specified
  if (agentName) {
    logs = logs.filter(log => log.agentName === agentName);
  }

  // Filter by project if specified
  if (projectId) {
    logs = logs.filter(log => log.projectId === projectId);
  }

  // Apply limit
  return logs.slice(0, limit);
}

/**
 * Get agent activity statistics
 */
export function getAgentActivityStats(): {
  totalEntries: number;
  spawned: number;
  exited: number;
  output: number;
  heartbeat: number;
} {
  return {
    totalEntries: agentActivityLog.length,
    spawned: agentActivityLog.filter(log => log.eventType === 'agent:spawned').length,
    exited: agentActivityLog.filter(log => log.eventType === 'agent:exited').length,
    output: agentActivityLog.filter(log => log.eventType === 'agent:output').length,
    heartbeat: agentActivityLog.filter(log => log.eventType === 'agent:heartbeat').length
  };
}

/**
 * Get agent activity logs for a specific project
 */
export function getProjectAgentActivity(
  projectId: string,
  limit: number = 50
): AgentActivityLogEntry[] {
  return agentActivityLog
    .filter(log => log.projectId === projectId)
    .slice(0, limit);
}

/**
 * Clear all agent activity logs
 */
export function clearAgentActivityLogs(): void {
  agentActivityLog.length = 0;
  console.log('[Audit] All agent activity logs cleared');
}

// ============================================================================
// Tier Transition Logging
// ============================================================================

/**
 * Generate a unique tier transition log entry ID
 */
function generateTierLogId(): string {
  return `tier_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Log a tier transition event
 */
export function logTierTransition(
  projectId: string,
  fromTier: number,
  toTier: number,
  trigger: TierTransitionLogEntry['trigger'],
  approvedBy?: string,
  details?: TierTransitionLogEntry['details']
): TierTransitionLogEntry {
  const entry: TierTransitionLogEntry = {
    id: generateTierLogId(),
    timestamp: new Date().toISOString(),
    projectId,
    fromTier,
    toTier,
    approvedBy,
    trigger,
    details
  };

  // Add to beginning of array (newest first)
  tierTransitionLog.unshift(entry);

  // Trim to max size if needed
  if (tierTransitionLog.length > MAX_TIER_LOG_ENTRIES) {
    tierTransitionLog.length = MAX_TIER_LOG_ENTRIES;
  }

  appendToSystemLog('tier', entry as unknown as Record<string, unknown>);
  console.log(`[Audit] Tier transition: ${projectId} tier ${fromTier} -> ${toTier} (trigger: ${trigger})`);

  return entry;
}

/**
 * Get tier transition logs
 */
export function getTierTransitionLogs(
  limit: number = 100,
  projectId?: string,
  trigger?: TierTransitionLogEntry['trigger']
): TierTransitionLogEntry[] {
  let logs = [...tierTransitionLog];

  // Filter by project if specified
  if (projectId) {
    logs = logs.filter(log => log.projectId === projectId);
  }

  // Filter by trigger if specified
  if (trigger) {
    logs = logs.filter(log => log.trigger === trigger);
  }

  // Apply limit
  return logs.slice(0, limit);
}

/**
 * Get tier transition statistics
 */
export function getTierTransitionStats(): {
  totalEntries: number;
  byTrigger: {
    api: number;
    websocket: number;
    auto: number;
    manual: number;
  };
  byProject: Record<string, number>;
} {
  const byProject: Record<string, number> = {};
  tierTransitionLog.forEach(log => {
    byProject[log.projectId] = (byProject[log.projectId] || 0) + 1;
  });

  return {
    totalEntries: tierTransitionLog.length,
    byTrigger: {
      api: tierTransitionLog.filter(log => log.trigger === 'api').length,
      websocket: tierTransitionLog.filter(log => log.trigger === 'websocket').length,
      auto: tierTransitionLog.filter(log => log.trigger === 'auto').length,
      manual: tierTransitionLog.filter(log => log.trigger === 'manual').length
    },
    byProject
  };
}

/**
 * Get tier transition logs for a specific project
 */
export function getProjectTierTransitions(
  projectId: string,
  limit: number = 50
): TierTransitionLogEntry[] {
  return tierTransitionLog
    .filter(log => log.projectId === projectId)
    .slice(0, limit);
}

/**
 * Clear all tier transition logs
 */
export function clearTierTransitionLogs(): void {
  tierTransitionLog.length = 0;
  console.log('[Audit] All tier transition logs cleared');
}

// ============================================================================
// Error Logging
// ============================================================================

/**
 * Generate a unique error log entry ID
 */
function generateErrorLogId(): string {
  return `error_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Log an error event
 */
export function logError(
  message: string,
  level: ErrorLogEntry['level'] = 'error',
  source: ErrorLogEntry['source'] = 'system',
  code?: string,
  projectId?: string,
  details?: ErrorLogEntry['details']
): ErrorLogEntry {
  const entry: ErrorLogEntry = {
    id: generateErrorLogId(),
    timestamp: new Date().toISOString(),
    level,
    message,
    code,
    projectId,
    source,
    details
  };

  // Add to beginning of array (newest first)
  errorLog.unshift(entry);

  // Trim to max size if needed
  if (errorLog.length > MAX_ERROR_LOG_ENTRIES) {
    errorLog.length = MAX_ERROR_LOG_ENTRIES;
  }

  // Log to console with appropriate level
  const consolePrefix = `[Error] ${code ? `[${code}] ` : ''}${message}`;
  appendToSystemLog('error', entry as unknown as Record<string, unknown>);
  if (level === 'critical') {
    console.error(`[CRITICAL] ${consolePrefix}`);
  } else if (level === 'warning') {
    console.warn(`[Warning] ${consolePrefix}`);
  } else {
    console.error(consolePrefix);
  }

  return entry;
}

/**
 * Get error logs
 */
export function getErrorLogs(
  limit: number = 100,
  level?: ErrorLogEntry['level'],
  source?: ErrorLogEntry['source'],
  projectId?: string
): ErrorLogEntry[] {
  let logs = [...errorLog];

  // Filter by level if specified
  if (level) {
    logs = logs.filter(log => log.level === level);
  }

  // Filter by source if specified
  if (source) {
    logs = logs.filter(log => log.source === source);
  }

  // Filter by project if specified
  if (projectId) {
    logs = logs.filter(log => log.projectId === projectId);
  }

  // Apply limit
  return logs.slice(0, limit);
}

/**
 * Get error log statistics
 */
export function getErrorStats(): {
  totalEntries: number;
  byLevel: {
    error: number;
    warning: number;
    critical: number;
  };
  bySource: Record<string, number>;
} {
  const bySource: Record<string, number> = {};
  errorLog.forEach(log => {
    bySource[log.source] = (bySource[log.source] || 0) + 1;
  });

  return {
    totalEntries: errorLog.length,
    byLevel: {
      error: errorLog.filter(log => log.level === 'error').length,
      warning: errorLog.filter(log => log.level === 'warning').length,
      critical: errorLog.filter(log => log.level === 'critical').length
    },
    bySource
  };
}

/**
 * Get error logs for a specific project
 */
export function getProjectErrors(
  projectId: string,
  limit: number = 50
): ErrorLogEntry[] {
  return errorLog
    .filter(log => log.projectId === projectId)
    .slice(0, limit);
}

/**
 * Clear all error logs
 */
export function clearErrorLogs(): void {
  errorLog.length = 0;
  console.log('[Audit] All error logs cleared');
}

// ============================================================================
// Startup Hydration from agentlogs.md
// ============================================================================

export async function hydrateAgentActivityFromProjectLogs(projectsDir: string): Promise<void> {
  const { readdir } = await import('fs/promises');
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    const allEntries: AgentActivityLogEntry[] = [];

    for (const dir of dirs) {
      const logPath = join(projectsDir, dir, 'agentlogs.md');
      if (!existsSync(logPath)) continue;
      try {
        const content = await readFile(logPath, 'utf-8');
        const lines = content.split('\n');
        const logPattern = /^\[AGENT\s+(\w+):\s*(\w+)\]\s*(.+)$/i;
        for (const line of lines) {
          const match = line.trim().match(logPattern);
          if (!match) continue;
          const tag = match[2].toUpperCase();
          const rest = match[3];
          const parts = rest.split('|').map((p: string) => p.trim());
          const timestamp = parts[0] || new Date().toISOString();
          const context = parts[1] || dir;
          const description = parts[2] || '';
          const agentRole = match[1].toUpperCase();
          // Map tag to an eventType proxy
          const eventType: AgentActivityLogEntry['eventType'] =
            tag === 'STARTED' ? 'agent:spawned' :
            tag === 'COMPLETED' || tag === 'TIER_COMPLETE' ? 'agent:exited' :
            'agent:output';
          allEntries.push({
            id: generateAgentLogId(),
            timestamp,
            eventType,
            pid: 0,
            agentName: `AGENT ${agentRole}`,
            projectId: dir,
            details: { context, description, tag, fromAgentlogs: true }
          });
        }
      } catch { /* skip unreadable files */ }
    }

    // Sort oldest-first then unshift newest-first into buffer
    allEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    for (let i = allEntries.length - 1; i >= 0; i--) {
      if (agentActivityLog.length >= MAX_AGENT_LOG_ENTRIES) break;
      agentActivityLog.unshift(allEntries[i]);
    }
    console.log(`[Audit] Hydrated ${Math.min(allEntries.length, MAX_AGENT_LOG_ENTRIES)} agent log entries from agentlogs.md files`);
  } catch (err) {
    console.warn('[Audit] Could not hydrate from agentlogs.md:', (err as Error).message);
  }
}

// ============================================================================
// Log Export Functionality
// ============================================================================

export type ExportFormat = 'json' | 'csv' | 'text';

export interface ExportResult {
  success: boolean;
  filePath: string;
  fileName: string;
  format: ExportFormat;
  count: number;
  timestamp: string;
}

/**
 * Export logs to a file
 */
export async function exportLogs(
  format: ExportFormat = 'json',
  logType: 'audit' | 'agent' | 'tier' | 'error' | 'all' = 'all',
  projectId?: string
): Promise<ExportResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const typeLabel = logType === 'all' ? 'logs' : `${logType}-logs`;
  const projectLabel = projectId ? `-${projectId}` : '';
  const fileName = `taskmaster-${typeLabel}${projectLabel}-${timestamp}.${format}`;
  const filePath = join(process.cwd(), '..', '..', 'Activity_Log', fileName);

  // Collect logs based on type
  let logs: unknown[] = [];
  let count = 0;

  switch (logType) {
    case 'audit':
      logs = getAuditLogs(1000, undefined, projectId);
      break;
    case 'agent':
      logs = getAgentActivityLogs(1000, undefined, undefined, projectId);
      break;
    case 'tier':
      logs = getTierTransitionLogs(1000, projectId);
      break;
    case 'error':
      logs = getErrorLogs(1000, undefined, undefined, projectId);
      break;
    case 'all':
    default:
      logs = [
        ...getAuditLogs(500, undefined, projectId).map(l => ({ type: 'audit', ...l })),
        ...getAgentActivityLogs(250, undefined, undefined, projectId).map(l => ({ type: 'agent', ...l })),
        ...getTierTransitionLogs(250, projectId).map(l => ({ type: 'tier', ...l })),
        ...getErrorLogs(250, undefined, undefined, projectId).map(l => ({ type: 'error', ...l }))
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      break;
  }

  count = logs.length;

  // Format the content based on export format
  let content: string;

  switch (format) {
    case 'csv':
      content = formatLogsAsCSV(logs);
      break;
    case 'text':
      content = formatLogsAsText(logs);
      break;
    case 'json':
    default:
      content = JSON.stringify({
        exportInfo: {
          timestamp: new Date().toISOString(),
          format,
          logType,
          projectId: projectId || null,
          count
        },
        logs
      }, null, 2);
      break;
  }

  // Ensure Activity_Log directory exists
  const activityLogDir = join(process.cwd(), '..', '..', 'Activity_Log');
  try {
    await mkdir(activityLogDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  // Write the file
  await writeFile(filePath, content, 'utf-8');

  console.log(`[Audit] Exported ${count} logs to ${filePath} (${format} format)`);

  return {
    success: true,
    filePath,
    fileName,
    format,
    count,
    timestamp: new Date().toISOString()
  };
}

/**
 * Format logs as CSV
 */
function formatLogsAsCSV(logs: unknown[]): string {
  if (logs.length === 0) {
    return 'timestamp,type,message\n';
  }

  const headers = ['timestamp', 'type', 'id', 'message', 'details'];
  const rows = logs.map((log: any) => {
    const timestamp = log.timestamp || '';
    const type = log.type || log.action || log.eventType || log.level || 'unknown';
    const id = log.id || '';

    // Extract message based on log type
    let message = '';
    if (log.action && log.filePath) {
      message = `${log.action}: ${log.filePath}`;
    } else if (log.eventType && log.agentName) {
      message = `${log.eventType}: ${log.agentName}`;
    } else if (log.message) {
      message = log.message;
    } else if (log.fromTier !== undefined && log.toTier !== undefined) {
      message = `Tier ${log.fromTier} -> ${log.toTier}`;
    }

    // Escape quotes and wrap in quotes if contains comma
    const escape = (str: string) => {
      const escaped = String(str).replace(/"/g, '""');
      return escaped.includes(',') ? `"${escaped}"` : escaped;
    };

    const details = JSON.stringify(log.details || {}).replace(/"/g, '""');

    return [timestamp, type, id, escape(message), `"${details}"`].join(',');
  });

  return [headers.join(','), ...rows].join('\n') + '\n';
}

/**
 * Format logs as plain text
 */
function formatLogsAsText(logs: unknown[]): string {
  const lines: string[] = [];
  lines.push('========================================');
  lines.push('TaskMaster Log Export');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total Entries: ${logs.length}`);
  lines.push('========================================');
  lines.push('');

  logs.forEach((log: any) => {
    const timestamp = log.timestamp || 'N/A';
    const type = log.type || log.action || log.eventType || log.level || 'unknown';
    const id = log.id || 'N/A';

    lines.push(`[${timestamp}] ${type.toUpperCase()} (${id})`);

    if (log.action && log.filePath) {
      lines.push(`  Action: ${log.action}`);
      lines.push(`  File: ${log.filePath}`);
      if (log.projectId) lines.push(`  Project: ${log.projectId}`);
    } else if (log.eventType && log.agentName) {
      lines.push(`  Event: ${log.eventType}`);
      lines.push(`  Agent: ${log.agentName}`);
      lines.push(`  PID: ${log.pid}`);
      if (log.projectId) lines.push(`  Project: ${log.projectId}`);
    } else if (log.fromTier !== undefined && log.toTier !== undefined) {
      lines.push(`  Tier Transition: ${log.fromTier} -> ${log.toTier}`);
      lines.push(`  Project: ${log.projectId}`);
      if (log.approvedBy) lines.push(`  Approved By: ${log.approvedBy}`);
      if (log.trigger) lines.push(`  Trigger: ${log.trigger}`);
    } else if (log.message) {
      lines.push(`  Level: ${log.level || 'unknown'}`);
      lines.push(`  Message: ${log.message}`);
      if (log.code) lines.push(`  Code: ${log.code}`);
      if (log.source) lines.push(`  Source: ${log.source}`);
      if (log.projectId) lines.push(`  Project: ${log.projectId}`);
    }

    if (log.details && Object.keys(log.details).length > 0) {
      lines.push(`  Details: ${JSON.stringify(log.details)}`);
    }

    lines.push('');
  });

  lines.push('========================================');
  lines.push('End of Log Export');
  lines.push('========================================');

  return lines.join('\n');
}
