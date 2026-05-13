/**
 * Lock File Recovery Service for TaskMaster
 *
 * Scans Projects/<project>/locks/*.lock on server startup to detect stale locks
 * and show running tasks. Enables recovery after server restart.
 */

import { readFile, readdir, stat, unlink, writeFile } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { setProject, getProject } from '../cache/index.js';
import type { Project, Task } from '../types/index.js';

const PROJECTS_DIR = join(__dirname, '../../../projects');

// Default stale lock timeout: 10 minutes (in milliseconds)
const DEFAULT_STALE_LOCK_TIMEOUT = 10 * 60 * 1000;

/**
 * Lock file structure (JSON)
 */
export interface LockFile {
  /** Task ID that is locked */
  taskId: string;
  /** Agent that acquired the lock */
  agent: string;
  /** Process ID that holds the lock */
  pid: number;
  /** ISO timestamp when lock was acquired */
  timestamp: string;
  /** Project ID */
  projectId: string;
}

/**
 * Recovery result for a single lock file
 */
export interface LockRecoveryResult {
  /** Lock file path */
  lockFile: string;
  /** Task ID */
  taskId: string;
  /** Whether the lock was recovered (fresh) or cleaned up (stale) */
  recovered: boolean;
  /** Lock information if recovered */
  lockInfo?: {
    agent: string;
    pid: number;
    timestamp: string;
    age: number; // age in milliseconds
  };
  /** Reason for cleanup if not recovered */
  cleanupReason?: string;
}

/**
 * Recovery results for a project
 */
export interface ProjectRecoveryResult {
  /** Project ID */
  projectId: string;
  /** Total lock files found */
  totalLocks: number;
  /** Locks that were recovered (fresh) */
  recovered: LockRecoveryResult[];
  /** Locks that were cleaned up (stale) */
  cleaned: LockRecoveryResult[];
  /** Tasks updated to in_progress status */
  tasksUpdated: string[];
}

/**
 * Overall recovery summary
 */
export interface RecoverySummary {
  /** Timestamp of recovery scan */
  timestamp: string;
  /** Total projects scanned */
  projectsScanned: number;
  /** Total lock files found */
  totalLocksFound: number;
  /** Locks recovered (fresh) */
  locksRecovered: number;
  /** Locks cleaned up (stale) */
  locksCleaned: number;
  /** Per-project results */
  projects: ProjectRecoveryResult[];
}

// In-memory storage for last recovery results
let lastRecoverySummary: RecoverySummary | null = null;

/**
 * Get the projects directory path
 */
export function getProjectsDir(): string {
  return PROJECTS_DIR;
}

/**
 * Parse a lock file and return its contents
 */
export async function parseLockFile(lockPath: string): Promise<LockFile | null> {
  try {
    const content = await readFile(lockPath, 'utf-8');
    const data = JSON.parse(content) as LockFile;

    // Validate required fields
    if (!data.taskId || !data.agent || !data.timestamp) {
      console.warn(`[LockRecovery] Invalid lock file (missing fields): ${lockPath}`);
      return null;
    }

    return data;
  } catch (err) {
    console.warn(`[LockRecovery] Failed to parse lock file: ${lockPath}`, (err as Error).message);
    return null;
  }
}

/**
 * Check if a lock is stale based on its timestamp
 */
export function isLockStale(timestamp: string, staleTimeout: number = DEFAULT_STALE_LOCK_TIMEOUT): boolean {
  const lockTime = new Date(timestamp).getTime();
  const now = Date.now();
  return (now - lockTime) > staleTimeout;
}

/**
 * Get the age of a lock in milliseconds
 */
export function getLockAge(timestamp: string): number {
  const lockTime = new Date(timestamp).getTime();
  return Date.now() - lockTime;
}

/**
 * Scan a single project's locks directory
 */
export async function scanProjectLocks(
  projectId: string,
  staleTimeout: number = DEFAULT_STALE_LOCK_TIMEOUT
): Promise<ProjectRecoveryResult> {
  const locksDir = join(PROJECTS_DIR, projectId, 'locks');
  const result: ProjectRecoveryResult = {
    projectId,
    totalLocks: 0,
    recovered: [],
    cleaned: [],
    tasksUpdated: []
  };

  try {
    // Check if locks directory exists
    const dirStats = await stat(locksDir).catch(() => null);
    if (!dirStats || !dirStats.isDirectory()) {
      return result; // No locks directory, return empty result
    }

    // Read all .lock files in the directory
    const entries = await readdir(locksDir, { withFileTypes: true });
    const lockFiles = entries
      .filter(e => e.isFile() && e.name.endsWith('.lock'))
      .map(e => join(locksDir, e.name));

    result.totalLocks = lockFiles.length;

    if (lockFiles.length === 0) {
      return result;
    }

    console.log(`[LockRecovery] Found ${lockFiles.length} lock files in project: ${projectId}`);

    // Process each lock file
    for (const lockPath of lockFiles) {
      const lockData = await parseLockFile(lockPath);

      if (!lockData) {
        // Invalid lock file, delete it
        try {
          await unlink(lockPath);
          result.cleaned.push({
            lockFile: lockPath,
            taskId: 'unknown',
            recovered: false,
            cleanupReason: 'Invalid lock file format'
          });
        } catch (err) {
          console.warn(`[LockRecovery] Failed to delete invalid lock file: ${lockPath}`);
        }
        continue;
      }

      const age = getLockAge(lockData.timestamp);
      const isStale = isLockStale(lockData.timestamp, staleTimeout);

      if (isStale) {
        // Stale lock - delete it
        try {
          await unlink(lockPath);
          result.cleaned.push({
            lockFile: lockPath,
            taskId: lockData.taskId,
            recovered: false,
            cleanupReason: `Stale lock (${Math.round(age / 1000)}s old, timeout: ${staleTimeout / 1000}s)`
          });
          console.log(`[LockRecovery] Cleaned stale lock for task ${lockData.taskId} in project ${projectId}`);
        } catch (err) {
          console.warn(`[LockRecovery] Failed to delete stale lock file: ${lockPath}`);
        }
      } else {
        // Fresh lock - recover it
        result.recovered.push({
          lockFile: lockPath,
          taskId: lockData.taskId,
          recovered: true,
          lockInfo: {
            agent: lockData.agent,
            pid: lockData.pid,
            timestamp: lockData.timestamp,
            age
          }
        });
        result.tasksUpdated.push(lockData.taskId);
        console.log(`[LockRecovery] Recovered fresh lock for task ${lockData.taskId} in project ${projectId} (agent: ${lockData.agent})`);
      }
    }

    // Update project cache to mark recovered tasks as in_progress
    if (result.recovered.length > 0) {
      await updateProjectTasksStatus(projectId, result.recovered);
    }

  } catch (err) {
    console.error(`[LockRecovery] Error scanning locks for project ${projectId}:`, (err as Error).message);
  }

  return result;
}

/**
 * Update project tasks in cache to reflect recovered locks
 */
async function updateProjectTasksStatus(
  projectId: string,
  recoveredLocks: LockRecoveryResult[]
): Promise<void> {
  const project = getProject(projectId);
  if (!project) {
    console.warn(`[LockRecovery] Project not found in cache: ${projectId}`);
    return;
  }

  let tasksUpdated = false;
  const taskIds = new Set(recoveredLocks.map(r => r.taskId));

  // Update each task that has a recovered lock
  for (const task of project.tasks) {
    if (taskIds.has(task.id) && task.status !== 'in_progress') {
      // Update task to in_progress
      task.status = 'in_progress';
      if (!task.started) {
        task.started = new Date().toISOString();
      }
      tasksUpdated = true;
      console.log(`[LockRecovery] Updated task ${task.id} to in_progress in project ${projectId}`);
    }
  }

  // Update project metadata if tasks were changed
  if (tasksUpdated) {
    // Recalculate metadata
    const completedTasks = project.tasks.filter(t => t.status === 'done').length;
    const inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
    const pendingTasks = project.tasks.filter(t => t.status === 'pending').length;

    project.metadata.completedTasks = completedTasks;
    project.metadata.inProgressTasks = inProgressTasks;
    project.metadata.pendingTasks = pendingTasks;
    project.metadata.lastUpdated = new Date().toISOString();

    // Save back to cache
    setProject(projectId, project);
    console.log(`[LockRecovery] Updated project ${projectId} in cache (${inProgressTasks} tasks in progress)`);
  }
}

/**
 * Scan all projects for lock files and perform recovery
 */
export async function performLockRecovery(
  staleTimeout: number = DEFAULT_STALE_LOCK_TIMEOUT
): Promise<RecoverySummary> {
  console.log('[LockRecovery] Starting lock file recovery scan...');

  const summary: RecoverySummary = {
    timestamp: new Date().toISOString(),
    projectsScanned: 0,
    totalLocksFound: 0,
    locksRecovered: 0,
    locksCleaned: 0,
    projects: []
  };

  try {
    // Get all project directories
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    summary.projectsScanned = projectDirs.length;
    console.log(`[LockRecovery] Scanning ${projectDirs.length} projects for lock files...`);

    // Scan each project
    for (const projectId of projectDirs) {
      const projectResult = await scanProjectLocks(projectId, staleTimeout);

      if (projectResult.totalLocks > 0 || projectResult.recovered.length > 0 || projectResult.cleaned.length > 0) {
        summary.projects.push(projectResult);
        summary.totalLocksFound += projectResult.totalLocks;
        summary.locksRecovered += projectResult.recovered.length;
        summary.locksCleaned += projectResult.cleaned.length;
      }
    }

    // Store for later retrieval
    lastRecoverySummary = summary;

    console.log(`[LockRecovery] Scan complete: ${summary.totalLocksFound} locks found, ${summary.locksRecovered} recovered, ${summary.locksCleaned} cleaned`);

  } catch (err) {
    console.error('[LockRecovery] Error during lock recovery:', (err as Error).message);
  }

  return summary;
}

/**
 * Get the last recovery summary
 */
export function getLastRecoverySummary(): RecoverySummary | null {
  return lastRecoverySummary;
}

/**
 * Create a lock file for a task (used by MCP agents)
 */
export async function createLockFile(
  projectId: string,
  taskId: string,
  agent: string,
  pid: number = process.pid
): Promise<string | null> {
  const locksDir = join(PROJECTS_DIR, projectId, 'locks');
  const lockPath = join(locksDir, `${taskId}.lock`);

  try {
    // Ensure locks directory exists
    const { mkdir } = await import('fs/promises');
    await mkdir(locksDir, { recursive: true });

    const lockData: LockFile = {
      taskId,
      agent,
      pid,
      timestamp: new Date().toISOString(),
      projectId
    };

    await writeFile(lockPath, JSON.stringify(lockData, null, 2));
    console.log(`[LockRecovery] Created lock file: ${lockPath}`);
    return lockPath;
  } catch (err) {
    console.error(`[LockRecovery] Failed to create lock file: ${lockPath}`, (err as Error).message);
    return null;
  }
}

/**
 * Remove a lock file for a task
 */
export async function removeLockFile(projectId: string, taskId: string): Promise<boolean> {
  const lockPath = join(PROJECTS_DIR, projectId, 'locks', `${taskId}.lock`);

  try {
    await unlink(lockPath);
    console.log(`[LockRecovery] Removed lock file: ${lockPath}`);
    return true;
  } catch (err) {
    // File might not exist, which is fine
    return false;
  }
}

// Export all functions
export default {
  performLockRecovery,
  scanProjectLocks,
  parseLockFile,
  isLockStale,
  getLockAge,
  getLastRecoverySummary,
  createLockFile,
  removeLockFile,
  getProjectsDir
};
