/**
 * File System Watcher for TaskMaster
 * Uses chokidar to monitor project directories for changes
 */

import chokidar from 'chokidar';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { setProject, removeProject } from '../cache/index.js';
import { scanProject, parseProjectLogs, type LogEntry } from '../scanner/index.js';
import {
  broadcastFileChanged,
  broadcastProjectUpdated,
  broadcastBatchUpdate,
  broadcastFileChangedToProject,
  broadcastProjectUpdatedToSubscribers,
  broadcastExpansionLoaded,
  broadcastLogUpdated
} from '../websocket/broadcaster.js';
import { initExpansionRegistry, reloadExpansion, removeExpansion, getExpansion } from '../expansions/index.js';
import { logFileChange } from '../audit/index.js';

const WATCHER_LOG_PREFIX = '[FileWatcher]';

// Track watcher state
let watcher: chokidar.FSWatcher | null = null;
let isActive = false;
let watchedPaths: string[] = [];

// Root directories to watch
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = join(__dirname, '../../..');
const PROJECTS_DIR = join(BASE_DIR, 'projects');
const AGENTS_DIR = join(BASE_DIR, 'agents');

// Batch debouncing configuration
const BATCH_DEBOUNCE_MS = 500; // Wait 500ms after last change before broadcasting

// Batch update queue
interface QueuedChange {
  action: 'created' | 'modified' | 'deleted';
  filePath: string;
  projectId?: string;
  timestamp: number;
}

interface QueuedProjectUpdate {
  projectId: string;
  action: 'created' | 'updated' | 'deleted';
  timestamp: number;
}

let changeQueue: QueuedChange[] = [];
let projectUpdateQueue: QueuedProjectUpdate[] = [];
let batchTimeout: NodeJS.Timeout | null = null;
let isBatching = false;

/**
 * Queue a file change for batch broadcasting
 */
function queueFileChange(
  action: 'created' | 'modified' | 'deleted',
  filePath: string,
  projectId?: string
): void {
  // Add to queue
  changeQueue.push({
    action,
    filePath,
    projectId,
    timestamp: Date.now()
  });

  // Reset batch timer
  resetBatchTimer();
}

/**
 * Queue a project update for batch broadcasting
 */
function queueProjectUpdate(
  projectId: string,
  action: 'created' | 'updated' | 'deleted'
): void {
  // Check if we already have an update for this project
  const existingIndex = projectUpdateQueue.findIndex(
    u => u.projectId === projectId
  );

  if (existingIndex >= 0) {
    // Update the existing entry with the latest action
    projectUpdateQueue[existingIndex].action = action;
    projectUpdateQueue[existingIndex].timestamp = Date.now();
  } else {
    projectUpdateQueue.push({
      projectId,
      action,
      timestamp: Date.now()
    });
  }

  // Reset batch timer
  resetBatchTimer();
}

/**
 * Reset the batch timer
 */
function resetBatchTimer(): void {
  isBatching = true;

  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  batchTimeout = setTimeout(() => {
    flushBatchQueue();
  }, BATCH_DEBOUNCE_MS);
}

/**
 * Flush the batch queue and broadcast all queued changes
 */
function flushBatchQueue(): void {
  if (changeQueue.length === 0 && projectUpdateQueue.length === 0) {
    isBatching = false;
    return;
  }

  const fileCount = changeQueue.length;
  const projectCount = projectUpdateQueue.length;

  // Log the batch
  console.log(`${WATCHER_LOG_PREFIX} Flushing batch: ${fileCount} file change(s), ${projectCount} project update(s)`);

  // Broadcast file changes to project subscribers only
  for (const change of changeQueue) {
    if (change.projectId) {
      broadcastFileChangedToProject(change.action, change.filePath, change.projectId);
    } else {
      // For non-project files (like agent files), broadcast to all
      broadcastFileChanged(change.action, change.filePath);
    }
  }

  // Broadcast project updates to subscribers only
  for (const update of projectUpdateQueue) {
    broadcastProjectUpdatedToSubscribers(update.projectId, update.action);
  }

  // Also broadcast a batch summary to all clients for global awareness
  broadcastBatchUpdate(changeQueue, projectUpdateQueue);

  // Clear queues
  changeQueue = [];
  projectUpdateQueue = [];
  batchTimeout = null;
  isBatching = false;
}

/**
 * Get current batch status (for debugging/monitoring)
 */
export function getBatchStatus(): {
  isBatching: boolean;
  queuedFileChanges: number;
  queuedProjectUpdates: number;
  debounceMs: number;
} {
  return {
    isBatching,
    queuedFileChanges: changeQueue.length,
    queuedProjectUpdates: projectUpdateQueue.length,
    debounceMs: BATCH_DEBOUNCE_MS
  };
}

/**
 * Initialize the file system watcher
 * Monitors /Projects and /Agents directories for changes
 */
export async function initWatcher(): Promise<{ success: boolean; error?: string }> {
  if (watcher) {
    console.log(`${WATCHER_LOG_PREFIX} Already initialized`);
    return { success: true };
  }

  try {
    console.log(`${WATCHER_LOG_PREFIX} Initializing file system watcher...`);

    // Define glob patterns to watch
    const watchPatterns = [
      join(PROJECTS_DIR, '*/**/*.json'),  // tasks.json in project folders
      join(PROJECTS_DIR, '*/**/*.md'),    // project.md in project folders
      join(AGENTS_DIR, '**/*.md'),        // Agent .md files
    ];

    watchedPaths = [PROJECTS_DIR, AGENTS_DIR];

    // Create chokidar watcher
    watcher = chokidar.watch(watchPatterns, {
      ignored: (path: string) => path.includes('/.') || path.startsWith('.'), // ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't fire events for existing files on start
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      },
      depth: 2 // Limit depth to avoid excessive watching
    });

    // Set up event handlers
    watcher
      .on('add', handleFileAdd)
      .on('change', handleFileChange)
      .on('unlink', handleFileUnlink)
      .on('addDir', handleDirAdd)
      .on('unlinkDir', handleDirUnlink)
      .on('error', handleError)
      .on('ready', handleReady);

    console.log(`${WATCHER_LOG_PREFIX} Watching directories:`);
    console.log(`  - ${PROJECTS_DIR}`);
    console.log(`  - ${AGENTS_DIR}`);

    return { success: true };
  } catch (err) {
    const errorMsg = `Failed to initialize watcher: ${(err as Error).message}`;
    console.error(`${WATCHER_LOG_PREFIX} ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle file addition
 */
async function handleFileAdd(filePath: string) {
  console.log(`${WATCHER_LOG_PREFIX} File added: ${filePath}`);

  // If it's a project file, refresh that project
  if (filePath.includes(PROJECTS_DIR)) {
    const projectId = await refreshProjectFromPath(filePath);
    if (projectId) {
      queueFileChange('created', filePath, projectId);
      queueProjectUpdate(projectId, 'updated');
      // Log to audit system
      logFileChange('created', filePath, projectId);
    }
  }

  // If it's an agent file, log it and queue
  if (filePath.includes(AGENTS_DIR)) {
    console.log(`${WATCHER_LOG_PREFIX} Agent file added: ${basename(filePath)}`);
    queueFileChange('created', filePath);
    // Log to audit system
    logFileChange('created', filePath);

    // Check if it's an expansion file
    if (filePath.includes('expansions')) {
      handleExpansionChange(filePath, 'created');
    }
  }
}

/**
 * Handle file modification
 */
async function handleFileChange(filePath: string) {
  console.log(`${WATCHER_LOG_PREFIX} File changed: ${filePath}`);

  // If it's a project file, refresh that project
  if (filePath.includes(PROJECTS_DIR)) {
    const projectId = await refreshProjectFromPath(filePath);
    if (projectId) {
      queueFileChange('modified', filePath, projectId);
      queueProjectUpdate(projectId, 'updated');
      // Log to audit system
      logFileChange('modified', filePath, projectId);

      // If it's project.md, broadcast log update with the latest entry
      if (filePath.endsWith('project.md')) {
        await broadcastLatestLogEntry(filePath, projectId);
      }
    }
  }

  // If it's an agent file, log it and queue
  if (filePath.includes(AGENTS_DIR)) {
    console.log(`${WATCHER_LOG_PREFIX} Agent file updated: ${basename(filePath)}`);
    queueFileChange('modified', filePath);
    // Log to audit system
    logFileChange('modified', filePath);

    // Check if it's an expansion file
    if (filePath.includes('expansions')) {
      handleExpansionChange(filePath, 'modified');
    }
  }
}

/**
 * Read and broadcast the latest log entry from project.md
 */
async function broadcastLatestLogEntry(filePath: string, projectId: string): Promise<void> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const logs = parseProjectLogs(content);

    if (logs.length > 0) {
      // Get the most recent log entry (first after reverse)
      const latestLog = logs[0];
      broadcastLogUpdated(projectId, latestLog);
      console.log(`${WATCHER_LOG_PREFIX} Broadcasted log update for project: ${projectId} [${latestLog.tag}]`);
    }
  } catch (err) {
    console.warn(`${WATCHER_LOG_PREFIX} Failed to broadcast log update for ${projectId}:`, (err as Error).message);
  }
}

/**
 * Handle file deletion
 */
async function handleFileUnlink(filePath: string) {
  console.log(`${WATCHER_LOG_PREFIX} File removed: ${filePath}`);

  // If it's a project file, we may need to remove or refresh the project
  if (filePath.includes(PROJECTS_DIR)) {
    const projectId = extractProjectIdFromPath(filePath);
    if (projectId) {
      queueFileChange('deleted', filePath, projectId);
      // Log to audit system
      logFileChange('deleted', filePath, projectId);
      // If tasks.json was deleted, we might want to remove the project
      if (filePath.endsWith('tasks.json')) {
        console.log(`${WATCHER_LOG_PREFIX} Removing project from cache: ${projectId}`);
        removeProject(projectId);
        queueProjectUpdate(projectId, 'deleted');
      } else {
        queueProjectUpdate(projectId, 'updated');
      }
    }
  }

  // If it's an agent file, queue
  if (filePath.includes(AGENTS_DIR)) {
    queueFileChange('deleted', filePath);
    // Log to audit system
    logFileChange('deleted', filePath);

    // Check if it's an expansion file
    if (filePath.includes('expansions')) {
      handleExpansionChange(filePath, 'deleted');
    }
  }
}

/**
 * Handle directory addition
 */
async function handleDirAdd(dirPath: string) {
  console.log(`${WATCHER_LOG_PREFIX} Directory added: ${dirPath}`);

  // If a new project directory was created
  if (dirPath.includes(PROJECTS_DIR) && dirPath !== PROJECTS_DIR) {
    const projectId = basename(dirPath);
    console.log(`${WATCHER_LOG_PREFIX} New project directory detected: ${projectId}`);

    // Wait a moment for files to be written, then scan the project
    setTimeout(async () => {
      const project = await scanProject(dirPath);
      if (project) {
        setProject(project.id, project);
        queueProjectUpdate(projectId, 'created');
        console.log(`${WATCHER_LOG_PREFIX} New project added to cache: ${project.name}`);
      }
    }, 500);
  }
}

/**
 * Handle directory removal
 */
function handleDirUnlink(dirPath: string) {
  console.log(`${WATCHER_LOG_PREFIX} Directory removed: ${dirPath}`);

  // If a project directory was removed
  if (dirPath.includes(PROJECTS_DIR) && dirPath !== PROJECTS_DIR) {
    const projectId = basename(dirPath);
    console.log(`${WATCHER_LOG_PREFIX} Project directory removed: ${projectId}`);
    removeProject(projectId);
    queueProjectUpdate(projectId, 'deleted');
  }

  // If an expansion directory was removed
  if (dirPath.includes(join(AGENTS_DIR, 'expansions'))) {
    handleExpansionChange(dirPath, 'deleted');
  }
}

/**
 * Handle expansion file/folder changes
 * Supports hot-reload of expansions
 */
async function handleExpansionChange(filePath: string, action: 'created' | 'modified' | 'deleted') {
  const expansionsDir = join(AGENTS_DIR, 'expansions');

  // Extract expansion ID from path
  // Path format: /Agents/expansions/expansion_name.md (file)
  // Or: /Agents/expansions/Expansion_Name/... (folder)
  let expansionId: string | null = null;
  let expansionType: 'file' | 'folder' = 'file';

  if (filePath.startsWith(expansionsDir)) {
    const relativePath = filePath.substring(expansionsDir.length + 1);
    const parts = relativePath.split('/');

    if (parts.length === 1) {
      // Direct file in expansions folder: expansion_name.md
      if (parts[0].endsWith('.md')) {
        expansionId = parts[0].replace('.md', '').toLowerCase();
        expansionType = 'file';
      }
    } else if (parts.length >= 2) {
      // File inside expansion folder: Expansion_Name/expansion_name.md
      expansionId = parts[0].toLowerCase().replace(/\s+/g, '_');
      expansionType = 'folder';
    }
  }

  if (!expansionId) return;

  console.log(`${WATCHER_LOG_PREFIX} Expansion ${action}: ${expansionId} (${expansionType})`);

  try {
    if (action === 'deleted') {
      // Remove expansion from registry
      const expansion = getExpansion(expansionId);
      if (expansion) {
        removeExpansion(expansionId);
        broadcastExpansionLoaded(expansionId, expansion.name, expansion.type, 'removed');
      }
    } else {
      // Reload or create expansion
      // For simplicity, re-initialize the entire registry on changes
      // This ensures consistency for folder-based expansions
      const result = await initExpansionRegistry();

      if (result.success) {
        const expansion = getExpansion(expansionId);
        if (expansion) {
          broadcastExpansionLoaded(expansionId, expansion.name, expansion.type, action === 'created' ? 'loaded' : 'reloaded');
          console.log(`${WATCHER_LOG_PREFIX} Expansion registry reloaded: ${result.count} expansions`);
        }
      }
    }
  } catch (err) {
    console.error(`${WATCHER_LOG_PREFIX} Error handling expansion change:`, (err as Error).message);
  }
}

/**
 * Handle watcher errors
 */
function handleError(error: Error) {
  console.error(`${WATCHER_LOG_PREFIX} Error: ${error.message}`);
  isActive = false;
}

/**
 * Handle watcher ready event
 */
function handleReady() {
  console.log(`${WATCHER_LOG_PREFIX} Watcher ready - actively monitoring file changes`);
  isActive = true;
}

/**
 * Extract project ID from a file path
 */
function extractProjectIdFromPath(filePath: string): string | null {
  const relativePath = filePath.replace(PROJECTS_DIR + '/', '');
  const parts = relativePath.split('/');
  if (parts.length > 0 && parts[0]) {
    return parts[0];
  }
  return null;
}

/**
 * Refresh a project in the cache based on its file path
 * Returns the project ID if successful, null otherwise
 */
async function refreshProjectFromPath(filePath: string): Promise<string | null> {
  const projectId = extractProjectIdFromPath(filePath);
  if (!projectId) return null;

  const projectPath = join(PROJECTS_DIR, projectId);
  console.log(`${WATCHER_LOG_PREFIX} Refreshing project: ${projectId}`);

  try {
    const project = await scanProject(projectPath);
    if (project) {
      setProject(project.id, project);
      console.log(`${WATCHER_LOG_PREFIX} Project updated in cache: ${project.name}`);
      return projectId;
    }
  } catch (err) {
    console.error(`${WATCHER_LOG_PREFIX} Failed to refresh project ${projectId}:`, (err as Error).message);
  }
  return null;
}

/**
 * Get watcher status
 */
export function getWatcherStatus(): {
  active: boolean;
  watchedPaths: string[];
} {
  return {
    active: isActive && watcher !== null,
    watchedPaths
  };
}

/**
 * Stop the watcher
 */
export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
    isActive = false;
    console.log(`${WATCHER_LOG_PREFIX} Watcher stopped`);
  }
}

/**
 * Check if watcher is active
 */
export function isWatcherActive(): boolean {
  return isActive && watcher !== null;
}
