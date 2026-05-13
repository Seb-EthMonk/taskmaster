/**
 * Filesystem Scanner
 * Loads project data from the filesystem into the cache
 */

import { readFile, stat, readdir } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import type { Project, Task, TasksJson, ProjectMetadata } from '../types/index.js';
import { setProject, markHydrated, getCacheStats } from '../cache/index.js';

const PROJECTS_DIR = join(__dirname, '../../../projects');

/**
 * Extract project name from project.md content
 * Looks for # Title at the start
 */
function extractProjectName(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Unnamed Project';
}

/**
 * Extract description from project.md content
 * Looks for first paragraph after title or description section
 */
function extractDescription(content: string): string {
  // Try to find description after title
  const lines = content.split('\n');
  let foundTitle = false;
  let description = '';

  for (const line of lines) {
    if (line.startsWith('# ')) {
      foundTitle = true;
      continue;
    }
    if (foundTitle && line.trim()) {
      if (line.startsWith('#')) break;
      description = line.trim();
      break;
    }
  }

  return description || 'No description available';
}

/**
 * Parse tasks.json file
 */
async function parseTasksJson(filePath: string): Promise<TasksJson | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as TasksJson;

    // Validate structure
    if (!data.tasks || !Array.isArray(data.tasks)) {
      console.warn(`[Scanner] Invalid tasks.json: ${filePath} - missing tasks array`);
      return null;
    }

    return data;
  } catch (err) {
    console.warn(`[Scanner] Failed to parse tasks.json: ${filePath}`, (err as Error).message);
    return null;
  }
}

/**
 * Parse project.md file
 */
async function parseProjectMd(filePath: string): Promise<{ name: string; description: string } | null> {
  try {
    const content = await readFile(filePath, 'utf-8');

    return {
      name: extractProjectName(content),
      description: extractDescription(content)
    };
  } catch (err) {
    console.warn(`[Scanner] Failed to parse project.md: ${filePath}`, (err as Error).message);
    return null;
  }
}

/**
 * Calculate current tier based on tasks
 */
function calculateCurrentTier(tasks: Task[], approvedTier: number = 0): number {
  if (!tasks.length) return 0;

  // Use the approved tier from cache if available, otherwise calculate from tasks
  // This supports the manual approval workflow where tier only advances on explicit approval
  return approvedTier;
}

/**
 * Calculate project status based on tasks and paused state
 */
function calculateStatus(tasks: Task[], currentTier: number = 0, isPaused: boolean = false): Project['status'] {
  // If explicitly paused, return paused status
  if (isPaused) return 'paused';

  if (!tasks.length) return 'active';

  const hasInProgress = tasks.some(t => t.status === 'in_progress');
  if (hasInProgress) return 'active';

  // Check if current tier is complete (all tasks in current tier are done)
  // This means we're awaiting approval to advance to the next tier
  const currentTierTasks = tasks.filter(t => (t.tier ?? 0) === currentTier);
  const allCurrentTierDone = currentTierTasks.every(t => t.status === 'done');
  const hasTasksInHigherTiers = tasks.some(t => (t.tier ?? 0) > currentTier);

  // If all tasks in current tier are done, we're awaiting approval to advance
  // No max tier limit - supports unlimited tiers
  if (allCurrentTierDone) {
    // Only return awaiting_approval if there are tasks in higher tiers
    // OR if there are tasks in current tier that are done
    if (hasTasksInHigherTiers || currentTierTasks.length > 0) {
      return 'awaiting_approval';
    }
  }

  // Mark as completed if all tasks are done and no higher tier tasks exist
  const allDone = tasks.every(t => t.status === 'done');
  if (allDone && !hasTasksInHigherTiers) {
    return 'completed';
  }

  return 'active';
}

/**
 * Build project metadata
 */
function buildMetadata(tasks: Task[]): ProjectMetadata {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;

  // Find last updated time from tasks
  const lastUpdated = tasks
    .map(t => t.completed || t.started || t.created)
    .filter(Boolean)
    .sort()
    .pop() || new Date().toISOString();

  return {
    totalTasks,
    completedTasks,
    inProgressTasks,
    pendingTasks,
    lastUpdated
  };
}

/**
 * Calculate which tiers have been completed
 * A tier is considered completed if all tasks in that tier have status 'done'
 */
function calculateCompletedTiers(tasks: Task[]): number[] {
  if (!tasks.length) return [];

  const completedTiers: number[] = [];

  // Get all unique tier numbers from tasks
  const uniqueTiers = [...new Set(tasks.map(t => t.tier ?? 0))].sort((a, b) => a - b);

  for (const tier of uniqueTiers) {
    const tierTasks = tasks.filter(t => (t.tier ?? 0) === tier);

    // Skip if no tasks in this tier
    if (tierTasks.length === 0) continue;

    // Check if all tasks in this tier are done
    const allDone = tierTasks.every(t => t.status === 'done');

    if (allDone) {
      completedTiers.push(tier);
    }
  }

  return completedTiers;
}

/**
 * Scan a single project directory
 */
export async function scanProject(projectPath: string): Promise<Project | null> {
  const projectId = basename(projectPath);

  try {
    // Check if directory
    const stats = await stat(projectPath);
    if (!stats.isDirectory()) {
      return null;
    }

    // Read project.md
    const projectMdPath = join(projectPath, 'project.md');
    const projectInfo = await parseProjectMd(projectMdPath);

    if (!projectInfo) {
      console.warn(`[Scanner] No project.md found for: ${projectId}`);
      return null;
    }

    // Read tasks.json
    const tasksJsonPath = join(projectPath, 'tasks.json');
    const tasksData = await parseTasksJson(tasksJsonPath);

    const tasks = tasksData?.tasks || [];

    // Use approvedTier from tasks.json if available (for manual approval workflow)
    // This preserves the approved tier across server restarts and rescans
    const approvedTier = tasksData?.approvedTier ?? 0;

    // Check if project is paused (persisted in tasks.json)
    const isPaused = tasksData?.paused === true;

    const currentTier = calculateCurrentTier(tasks, approvedTier);
    const status = calculateStatus(tasks, currentTier, isPaused);
    const metadata = buildMetadata(tasks);
    const completedTiers = calculateCompletedTiers(tasks);

    // Determine last accessed time
    const lastAccessed = tasksData?.updated || stats.mtime.toISOString();

    // Determine created time (from tasks.json metadata, or filesystem birthtime)
    const created = (tasksData as { created?: string; metadata?: { created?: string } })?.created ||
                    (tasksData as { metadata?: { created?: string } })?.metadata?.created ||
                    stats.birthtime.toISOString();

    const project: Project = {
      id: projectId,
      name: projectInfo.name,
      description: projectInfo.description,
      path: projectPath,
      currentTier,
      status,
      created,
      lastAccessed,
      tasks,
      metadata,
      completedTiers
    };

    return project;
  } catch (err) {
    console.error(`[Scanner] Error scanning project ${projectId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Hydrate cache from filesystem
 * Scans all project directories and loads them into memory
 */
export async function hydrateCache(): Promise<{ success: boolean; count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  console.log('[Scanner] Starting cache hydration from filesystem...');

  try {
    // Get all directories in Projects folder
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    console.log(`[Scanner] Found ${projectDirs.length} potential project directories`);

    // Scan each project
    for (const dirName of projectDirs) {
      const projectPath = join(PROJECTS_DIR, dirName);
      const project = await scanProject(projectPath);

      if (project) {
        setProject(project.id, project);
        count++;
        console.log(`[Scanner] Loaded project: ${project.name} (${project.id}) - Tier ${project.currentTier}, ${project.metadata.totalTasks} tasks`);
      }
    }

    markHydrated();

    const stats = getCacheStats();
    console.log(`[Scanner] Cache hydration complete. ${stats.projectCount} projects loaded.`);

    return { success: true, count, errors };
  } catch (err) {
    const errorMsg = `Failed to hydrate cache: ${(err as Error).message}`;
    console.error(`[Scanner] ${errorMsg}`);
    errors.push(errorMsg);
    return { success: false, count, errors };
  }
}

/**
 * Log entry from project.md
 */
export interface LogEntry {
  agent: string;
  tag: string;
  timestamp: string;
  context: string;
  description: string;
  raw: string;
}

/**
 * Parse agent log entries from project.md content
 * Format: [AGENT <ROLE>: <TAG>] <TIMESTAMP> | <CONTEXT> | <DESCRIPTION>
 * Example: [AGENT CODER: STARTED] 2026-02-26T14:20:00Z | task-001 | Beginning work
 */
export function parseProjectLogs(content: string): LogEntry[] {
  const logs: LogEntry[] = [];

  // Split content into lines and look for agent log entries
  const lines = content.split('\n');

  // Regex to match [AGENT <ROLE>: <TAG>] format with the full log pattern
  const logPattern = /^\[AGENT\s+(\w+):\s*(\w+)\]\s*(.+)$/i;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const match = trimmedLine.match(logPattern);

    if (match) {
      const agentRole = match[1].toUpperCase();
      const tag = match[2].toUpperCase();
      const rest = match[3];

      // Parse the rest: TIMESTAMP | CONTEXT | DESCRIPTION
      const parts = rest.split('|').map(p => p.trim());

      if (parts.length >= 3) {
        logs.push({
          agent: `AGENT ${agentRole}`,
          tag,
          timestamp: parts[0],
          context: parts[1],
          description: parts[2],
          raw: trimmedLine
        });
      } else if (parts.length === 2) {
        logs.push({
          agent: `AGENT ${agentRole}`,
          tag,
          timestamp: parts[0],
          context: parts[1],
          description: '',
          raw: trimmedLine
        });
      } else {
        logs.push({
          agent: `AGENT ${agentRole}`,
          tag,
          timestamp: parts[0] || '',
          context: '',
          description: '',
          raw: trimmedLine
        });
      }
    }
  }

  // Return in reverse chronological order (newest first)
  return logs.reverse();
}

/**
 * Get the projects directory path
 */
export function getProjectsDir(): string {
  return PROJECTS_DIR;
}
