/**
 * Logs Routes for TaskMaster
 * Provides API endpoints for retrieving audit logs
 */

import { Router } from 'express';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getAuditLogs,
  getAuditStats,
  getProjectChanges,
  getAgentActivityLogs,
  getAgentActivityStats,
  getProjectAgentActivity,
  getTierTransitionLogs,
  getTierTransitionStats,
  getProjectTierTransitions,
  getErrorLogs,
  getErrorStats,
  getProjectErrors,
  exportLogs
} from '../audit/index.js';
import { parseProjectLogs, LogEntry } from '../scanner/index.js';


const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(__dirname, '../../../projects');

const router = Router();

/**
 * Interface for aggregated agent log entry with project info
 */
interface AggregatedAgentLog extends LogEntry {
  projectId: string;
}

/**
 * GET /api/logs/agentlogs
 * Get agent activity logs compiled from all project agentlogs.md files
 * Query parameters:
 *   - limit: Maximum number of entries (default: 100, max: 1000)
 *   - agent: Filter by agent name (e.g., 'CODER', 'QA')
 *   - tag: Filter by tag (e.g., 'STARTED', 'COMPLETED')
 *   - project: Filter by project ID
 */
router.get('/agentlogs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const agentFilter = req.query.agent as string | undefined;
    const tagFilter = req.query.tag as string | undefined;
    const projectFilter = req.query.project as string | undefined;

    const allLogs: AggregatedAgentLog[] = [];

    // Scan all project directories
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    for (const projectId of projectDirs) {
      // Skip if filtering by project and this isn't it
      if (projectFilter && projectId !== projectFilter) {
        continue;
      }

      try {
        const agentlogsPath = join(PROJECTS_DIR, projectId, 'agentlogs.md');
        const content = await readFile(agentlogsPath, 'utf-8');
        const logs = parseProjectLogs(content);

        // Add projectId to each log entry
        for (const log of logs) {
          // Apply filters
          if (agentFilter && !log.agent.toLowerCase().includes(agentFilter.toLowerCase())) {
            continue;
          }
          if (tagFilter && !log.tag.toLowerCase().includes(tagFilter.toLowerCase())) {
            continue;
          }

          allLogs.push({
            ...log,
            projectId
          });
        }
      } catch (err) {
        // agentlogs.md doesn't exist or can't be read - skip this project
        continue;
      }
    }

    // Sort by timestamp (newest first)
    allLogs.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });

    // Apply limit
    const limitedLogs = allLogs.slice(0, limit);

    res.json({
      count: limitedLogs.length,
      total: allLogs.length,
      filters: {
        limit,
        agent: agentFilter || null,
        tag: tagFilter || null,
        project: projectFilter || null
      },
      logs: limitedLogs
    });
  } catch (err) {
    console.error('[Logs] Error retrieving agentlogs:', err);
    res.status(500).json({
      error: 'Failed to retrieve agentlogs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs
 * Get system-wide audit logs
 * Query parameters:
 *   - limit: Maximum number of entries (default: 100, max: 1000)
 *   - action: Filter by action type (created, modified, deleted)
 *   - project: Filter by project ID
 */
router.get('/', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const action = req.query.action as 'created' | 'modified' | 'deleted' | undefined;
    const projectId = req.query.project as string | undefined;

    const logs = getAuditLogs(limit, action, projectId);
    const stats = getAuditStats();

    res.json({
      count: logs.length,
      stats: {
        total: stats.totalEntries,
        created: stats.created,
        modified: stats.modified,
        deleted: stats.deleted
      },
      filters: {
        limit,
        action: action || null,
        project: projectId || null
      },
      logs
    });
  } catch (err) {
    console.error('[Logs] Error retrieving audit logs:', err);
    res.status(500).json({
      error: 'Failed to retrieve audit logs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/stats
 * Get audit log statistics
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getAuditStats();
    res.json({
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (err) {
    console.error('[Logs] Error retrieving audit stats:', err);
    res.status(500).json({
      error: 'Failed to retrieve audit statistics',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/projects/:projectId
 * Get audit logs for a specific project
 * Query parameters:
 *   - limit: Maximum number of entries (default: 50)
 */
router.get('/projects/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const logs = getProjectChanges(projectId, limit);

    res.json({
      projectId,
      count: logs.length,
      logs
    });
  } catch (err) {
    console.error('[Logs] Error retrieving project audit logs:', err);
    res.status(500).json({
      error: 'Failed to retrieve project audit logs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/agent
 * Get agent activity logs
 * Query parameters:
 *   - limit: Maximum number of entries (default: 100, max: 1000)
 *   - eventType: Filter by event type (agent:spawned, agent:exited, agent:output, agent:heartbeat)
 *   - agent: Filter by agent name
 *   - project: Filter by project ID
 */
router.get('/agent', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const eventType = req.query.eventType as 'agent:spawned' | 'agent:exited' | 'agent:output' | 'agent:heartbeat' | undefined;
    const agentName = req.query.agent as string | undefined;
    const projectId = req.query.project as string | undefined;

    const logs = getAgentActivityLogs(limit, eventType, agentName, projectId);
    const stats = getAgentActivityStats();

    res.json({
      count: logs.length,
      stats: {
        total: stats.totalEntries,
        spawned: stats.spawned,
        exited: stats.exited,
        output: stats.output,
        heartbeat: stats.heartbeat
      },
      filters: {
        limit,
        eventType: eventType || null,
        agent: agentName || null,
        project: projectId || null
      },
      logs
    });
  } catch (err) {
    console.error('[Logs] Error retrieving agent activity logs:', err);
    res.status(500).json({
      error: 'Failed to retrieve agent activity logs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/agent/stats
 * Get agent activity statistics
 */
router.get('/agent/stats', (req, res) => {
  try {
    const stats = getAgentActivityStats();
    res.json({
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (err) {
    console.error('[Logs] Error retrieving agent activity stats:', err);
    res.status(500).json({
      error: 'Failed to retrieve agent activity statistics',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/agent/projects/:projectId
 * Get agent activity logs for a specific project
 * Query parameters:
 *   - limit: Maximum number of entries (default: 50)
 */
router.get('/agent/projects/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const logs = getProjectAgentActivity(projectId, limit);

    res.json({
      projectId,
      count: logs.length,
      logs
    });
  } catch (err) {
    console.error('[Logs] Error retrieving project agent activity logs:', err);
    res.status(500).json({
      error: 'Failed to retrieve project agent activity logs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/tier
 * Get tier transition logs
 * Query parameters:
 *   - limit: Maximum number of entries (default: 100, max: 1000)
 *   - project: Filter by project ID
 *   - trigger: Filter by trigger type (api, websocket, auto, manual)
 */
router.get('/tier', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const projectId = req.query.project as string | undefined;
    const trigger = req.query.trigger as 'api' | 'websocket' | 'auto' | 'manual' | undefined;

    const logs = getTierTransitionLogs(limit, projectId, trigger);
    const stats = getTierTransitionStats();

    res.json({
      count: logs.length,
      stats: {
        total: stats.totalEntries,
        byTrigger: stats.byTrigger
      },
      filters: {
        limit,
        project: projectId || null,
        trigger: trigger || null
      },
      logs
    });
  } catch (err) {
    console.error('[Logs] Error retrieving tier transition logs:', err);
    res.status(500).json({
      error: 'Failed to retrieve tier transition logs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/tier/stats
 * Get tier transition statistics
 */
router.get('/tier/stats', (req, res) => {
  try {
    const stats = getTierTransitionStats();
    res.json({
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (err) {
    console.error('[Logs] Error retrieving tier transition stats:', err);
    res.status(500).json({
      error: 'Failed to retrieve tier transition statistics',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/tier/projects/:projectId
 * Get tier transition logs for a specific project
 * Query parameters:
 *   - limit: Maximum number of entries (default: 50)
 */
router.get('/tier/projects/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const logs = getProjectTierTransitions(projectId, limit);

    res.json({
      projectId,
      count: logs.length,
      logs
    });
  } catch (err) {
    console.error('[Logs] Error retrieving project tier transition logs:', err);
    res.status(500).json({
      error: 'Failed to retrieve project tier transition logs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/errors
 * Get error logs
 * Query parameters:
 *   - limit: Maximum number of entries (default: 100, max: 1000)
 *   - level: Filter by error level (error, warning, critical)
 *   - source: Filter by source (api, websocket, watcher, scanner, system, agent)
 *   - project: Filter by project ID
 */
router.get('/errors', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const level = req.query.level as 'error' | 'warning' | 'critical' | undefined;
    const source = req.query.source as 'api' | 'websocket' | 'watcher' | 'scanner' | 'system' | 'agent' | undefined;
    const projectId = req.query.project as string | undefined;

    const logs = getErrorLogs(limit, level, source, projectId);
    const stats = getErrorStats();

    res.json({
      count: logs.length,
      stats: {
        total: stats.totalEntries,
        byLevel: stats.byLevel,
        bySource: stats.bySource
      },
      filters: {
        limit,
        level: level || null,
        source: source || null,
        project: projectId || null
      },
      logs
    });
  } catch (err) {
    console.error('[Logs] Error retrieving error logs:', err);
    res.status(500).json({
      error: 'Failed to retrieve error logs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/errors/stats
 * Get error log statistics
 */
router.get('/errors/stats', (req, res) => {
  try {
    const stats = getErrorStats();
    res.json({
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (err) {
    console.error('[Logs] Error retrieving error stats:', err);
    res.status(500).json({
      error: 'Failed to retrieve error statistics',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/errors/projects/:projectId
 * Get error logs for a specific project
 * Query parameters:
 *   - limit: Maximum number of entries (default: 50)
 */
router.get('/errors/projects/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const logs = getProjectErrors(projectId, limit);

    res.json({
      projectId,
      count: logs.length,
      logs
    });
  } catch (err) {
    console.error('[Logs] Error retrieving project error logs:', err);
    res.status(500).json({
      error: 'Failed to retrieve project error logs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/logs/export
 * Export logs to a file
 * Body parameters:
 *   - format: Export format - 'json', 'csv', or 'text' (default: 'json')
 *   - type: Log type to export - 'audit', 'agent', 'tier', 'error', or 'all' (default: 'all')
 *   - projectId: Optional project ID to filter logs
 */
router.post('/export', async (req, res) => {
  try {
    const { format = 'json', type = 'all', projectId } = req.body;

    // Validate format
    const validFormats = ['json', 'csv', 'text'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        error: 'Invalid format',
        message: `Format must be one of: ${validFormats.join(', ')}`
      });
    }

    // Validate type
    const validTypes = ['audit', 'agent', 'tier', 'error', 'all'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: 'Invalid type',
        message: `Type must be one of: ${validTypes.join(', ')}`
      });
    }

    // Call export function
    const result = await exportLogs(format as 'json' | 'csv' | 'text', type as 'audit' | 'agent' | 'tier' | 'error' | 'all', projectId);

    res.json({
      success: true,
      message: `Successfully exported ${result.count} logs`,
      export: result
    });
  } catch (err) {
    console.error('[Logs] Error exporting logs:', err);
    res.status(500).json({
      error: 'Failed to export logs',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

export default router;
