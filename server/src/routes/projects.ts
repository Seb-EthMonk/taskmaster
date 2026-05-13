import { Router } from 'express';
import { readdir, readFile, stat, mkdir, writeFile, rename, copyFile, access } from 'fs/promises'; // copyFile used by restore-copy
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { parseProjectLogs, LogEntry } from '../scanner/index.js';
import { isCacheHydrated, getProject, setProject } from '../cache/index.js';
import { broadcastProjectUpdated, broadcastLogUpdated } from '../websocket/broadcaster.js';
import { getProjectAgentActivity, AgentActivityLogEntry } from '../audit/index.js';

const router = Router();
const PROJECTS_DIR = join(__dirname, '../../../projects');
const ARCHIVE_DIR = join(__dirname, '../../../archive');


interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'done';
  tier: number;
  priority?: string;
  agent?: string; // Assigned agent role for this task
  created?: string;
  completed?: string;
}

interface Project {
  id: string;
  name: string;
  status: string;
  currentTier: number;
  lastAccessed: Date;
  tasks: Task[];
  path: string;
  completedTiers: number[];
  created?: string;
}

// Parse project.md frontmatter
async function parseProjectMd(filePath: string): Promise<Partial<Project>> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const project: Partial<Project> = {};

    // Parse YAML frontmatter
    if (lines[0] === '---') {
      let i = 1;
      while (i < lines.length && lines[i] !== '---') {
        const line = lines[i];
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          if (key === 'name') project.name = value;
          if (key === 'status') project.status = value;
          if (key === 'created') project.created = value;
        }
        i++;
      }
    }

    return project;
  } catch (err) {
    return {};
  }
}

// Calculate which tiers have been completed
function calculateCompletedTiers(tasks: Task[]): number[] {
  if (!tasks.length) return [];

  const completedTiers: number[] = [];
  const uniqueTiers = [...new Set(tasks.map(t => t.tier ?? 0))].sort((a, b) => a - b);

  for (const tier of uniqueTiers) {
    const tierTasks = tasks.filter(t => (t.tier ?? 0) === tier);
    if (tierTasks.length === 0) continue;

    const allDone = tierTasks.every(t => t.status === 'done');
    if (allDone) {
      completedTiers.push(tier);
    }
  }

  return completedTiers;
}

// Parse tasks.json
async function parseTasksJson(filePath: string): Promise<{ tasks: Task[], currentTier: number, completedTiers: number[] }> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    const tasks: Task[] = data.tasks || [];

    // Calculate current tier based on task status
    // Support unlimited tiers - find highest tier with tasks
    const uniqueTiers = [...new Set(tasks.map((t: Task) => t.tier))].sort((a, b) => a - b);
    let currentTier = 0;

    for (const tier of uniqueTiers) {
      const tierTasks = tasks.filter((t: Task) => t.tier === tier);
      if (tierTasks.length === 0) continue;

      const allDone = tierTasks.every((t: Task) => t.status === 'done');
      if (allDone) {
        currentTier = tier + 1;
      } else {
        currentTier = tier;
        break;
      }
    }

    const completedTiers = calculateCompletedTiers(tasks);

    return { tasks, currentTier, completedTiers };
  } catch (err) {
    return { tasks: [], currentTier: 0, completedTiers: [] };
  }
}

// Get directory last access time
async function getLastAccessed(dirPath: string): Promise<Date> {
  try {
    const stats = await stat(dirPath);
    return stats.mtime;
  } catch (err) {
    return new Date(0);
  }
}

// GET /api/projects - List all projects (including archived)
router.get('/', async (req, res) => {
  try {
    // Read active projects
    let projectDirs: string[] = [];
    try {
      projectDirs = await readdir(PROJECTS_DIR);
    } catch {
      // Projects directory might not exist
    }

    // Read archived projects
    let archivedDirs: string[] = [];
    try {
      archivedDirs = await readdir(ARCHIVE_DIR);
    } catch {
      // Archive directory might not exist
    }

    const projects: (Project & { isArchived: boolean })[] = [];

    // Process active projects
    for (const dir of projectDirs) {
      const projectPath = join(PROJECTS_DIR, dir);
      const projectMdPath = join(projectPath, 'project.md');
      const tasksJsonPath = join(projectPath, 'tasks.json');

      // Check if it's a directory
      const stats = await stat(projectPath);
      if (!stats.isDirectory()) continue;

      // Parse project files
      const projectMd = await parseProjectMd(projectMdPath);
      const { tasks, currentTier, completedTiers } = await parseTasksJson(tasksJsonPath);
      const lastAccessed = await getLastAccessed(projectPath);

      projects.push({
        id: dir,
        name: projectMd.name || dir,
        status: projectMd.status || 'active',
        currentTier,
        lastAccessed,
        tasks,
        path: projectPath,
        completedTiers,
        created: projectMd.created || undefined,
        isArchived: false
      });
    }

    // Process archived projects
    for (const dir of archivedDirs) {
      const projectPath = join(ARCHIVE_DIR, dir);
      const projectMdPath = join(projectPath, 'project.md');
      const tasksJsonPath = join(projectPath, 'tasks.json');

      // Check if it's a directory
      try {
        const stats = await stat(projectPath);
        if (!stats.isDirectory()) continue;
      } catch {
        continue;
      }

      // Parse project files
      const projectMd = await parseProjectMd(projectMdPath);
      const { tasks, currentTier, completedTiers } = await parseTasksJson(tasksJsonPath);
      const lastAccessed = await getLastAccessed(projectPath);

      projects.push({
        id: dir,
        name: projectMd.name || dir,
        status: 'archived',
        currentTier,
        lastAccessed,
        tasks,
        path: projectPath,
        completedTiers,
        created: projectMd.created || undefined,
        isArchived: true
      });
    }

    // Sort by last accessed (most recent first)
    projects.sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());

    res.json(projects);
  } catch (err) {
    console.error('[Projects] Error listing projects:', err);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// GET /api/projects/:id - Get project details (checks both active and archived)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let projectPath = join(PROJECTS_DIR, id);
    let projectMdPath = join(projectPath, 'project.md');
    let tasksJsonPath = join(projectPath, 'tasks.json');
    let isArchived = false;

    // Check if project exists in active projects
    try {
      await stat(projectPath);
    } catch {
      // Not found in active projects, check archive
      const archivedPath = join(ARCHIVE_DIR, id);
      try {
        await stat(archivedPath);
        // Found in archive
        projectPath = archivedPath;
        projectMdPath = join(projectPath, 'project.md');
        tasksJsonPath = join(projectPath, 'tasks.json');
        isArchived = true;
      } catch {
        return res.status(404).json({ error: 'Project not found' });
      }
    }

    // Parse project files
    const projectMd = await parseProjectMd(projectMdPath);
    const { tasks, currentTier, completedTiers } = await parseTasksJson(tasksJsonPath);
    const lastAccessed = await getLastAccessed(projectPath);

    const project: Project & { isArchived: boolean } = {
      id,
      name: projectMd.name || id,
      status: isArchived ? 'archived' : (projectMd.status || 'active'),
      currentTier,
      lastAccessed,
      tasks,
      path: projectPath,
      completedTiers,
      created: projectMd.created || undefined,
      isArchived
    };

    res.json(project);
  } catch (err) {
    console.error('[Projects] Error getting project:', err);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

// GET /api/projects/:id/readme - Return raw project.md content
router.get('/:id/readme', async (req, res) => {
  try {
    const { id } = req.params;
    let projectPath = join(PROJECTS_DIR, id);

    // Check active then archive
    try {
      await stat(projectPath);
    } catch {
      const archivedPath = join(ARCHIVE_DIR, id);
      try {
        await stat(archivedPath);
        projectPath = archivedPath;
      } catch {
        return res.status(404).json({ error: 'Project not found' });
      }
    }

    const projectMdPath = join(projectPath, 'project.md');
    try {
      const content = await readFile(projectMdPath, 'utf-8');
      res.json({ content });
    } catch {
      res.json({ content: '' });
    }
  } catch (err) {
    console.error('[Projects] Error reading project.md:', err);
    res.status(500).json({ error: 'Failed to read project info' });
  }
});

// POST /api/projects - Create new project
router.post('/', async (req, res) => {
  try {
    const { name, id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const projectId = id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const projectPath = join(PROJECTS_DIR, projectId);

    // Check if project already exists
    try {
      await stat(projectPath);
      return res.status(409).json({ error: 'Project already exists' });
    } catch {
      // Directory doesn't exist, which is what we want
    }

    // Create project directory
    await mkdir(projectPath, { recursive: true });

    // Create project.md
    const projectMdContent = `---
name: ${name}
status: active
created: ${new Date().toISOString().split('T')[0]}
---

# ${name}

Project created via TaskMaster.
`;
    await writeFile(join(projectPath, 'project.md'), projectMdContent);

    // Create tasks.json
    const tasksJsonContent = JSON.stringify({
      tasks: [],
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString()
      }
    }, null, 2);
    await writeFile(join(projectPath, 'tasks.json'), tasksJsonContent);

    const project: Project = {
      id: projectId,
      name,
      status: 'active',
      currentTier: 0,
      lastAccessed: new Date(),
      tasks: [],
      path: projectPath,
      completedTiers: []
    };

    console.log(`[Projects] Created project: ${projectId}`);
    res.status(201).json(project);
  } catch (err) {
    console.error('[Projects] Error creating project:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * Transform agent activity log entry to UI format
 */
function transformAgentLog(entry: AgentActivityLogEntry): LogEntry {
  const tagMap: Record<string, string> = {
    'agent:spawned': 'STARTED',
    'agent:exited': 'COMPLETED',
    'agent:output': 'INFO',
    'agent:heartbeat': 'PROGRESS'
  };
  
  const context = entry.projectId || 'system';
  let description = '';
  
  switch (entry.eventType) {
    case 'agent:spawned':
      description = `Agent ${entry.agentName} spawned (PID ${entry.pid})${entry.details?.expansions?.length ? ` with expansions: ${entry.details.expansions.join(', ')}` : ''}`;
      break;
    case 'agent:exited':
      description = `Agent ${entry.agentName} exited with code ${entry.details?.exitCode ?? 'unknown'}`;
      break;
    case 'agent:output':
      description = entry.details?.output?.substring(0, 200) || 'Agent output';
      break;
    case 'agent:heartbeat':
      description = `Heartbeat from ${entry.agentName}`;
      break;
    default:
      description = `Agent activity: ${entry.eventType}`;
  }
  
  return {
    agent: entry.agentName,
    tag: tagMap[entry.eventType] || 'INFO',
    timestamp: entry.timestamp,
    context,
    description,
    raw: JSON.stringify(entry)
  };
}

// GET /api/projects/:id/logs - Get project activity logs from agentlogs.md only
router.get('/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const projectPath = join(PROJECTS_DIR, id);
    const agentLogsPath = join(projectPath, 'agentlogs.md');

    // Check if project exists
    try {
      await stat(projectPath);
    } catch {
      return res.status(404).json({ error: 'Project not found' });
    }

    const allLogs: LogEntry[] = [];

    // Read and parse agentlogs.md for agent activity logs
    try {
      const content = await readFile(agentLogsPath, 'utf-8');
      const logs = parseProjectLogs(content);
      allLogs.push(...logs);
    } catch {
      // If agentlogs.md doesn't exist or can't be read, ignore
    }

    // Sort by timestamp (newest first)
    allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({
      projectId: id,
      count: allLogs.length,
      logs: allLogs.slice(0, 100) // Limit to 100 entries
    });
  } catch (err) {
    console.error('[Projects] Error getting project logs:', err);
    res.status(500).json({ error: 'Failed to get project logs' });
  }
});

// GET /api/projects/:id/archive/status - Check if project is archived
router.get('/:id/archive/status', async (req, res) => {
  try {
    const { id } = req.params;
    const projectPath = join(PROJECTS_DIR, id);
    const archivedPath = join(ARCHIVE_DIR, id);

    let isArchived = false;
    let isActive = false;

    // Check if project exists in Projects directory
    try {
      await stat(projectPath);
      isActive = true;
    } catch {
      isActive = false;
    }

    // Check if project exists in Archive directory
    try {
      await stat(archivedPath);
      isArchived = true;
    } catch {
      isArchived = false;
    }

    res.json({
      projectId: id,
      isArchived,
      isActive,
      canArchive: isActive && !isArchived,
      canRestore: isArchived
    });
  } catch (err) {
    console.error('[Projects] Error checking archive status:', err);
    res.status(500).json({ error: 'Failed to check archive status' });
  }
});

// PATCH /api/projects/:id - General project update endpoint
// Supports: status, name, description, currentTier
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, name, description, currentTier, updated_by } = req.body;
    
    // Check if cache is hydrated
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data.'
      });
    }
    
    // Get project
    const project = getProject(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const updates: string[] = [];
    const patchedAt = new Date().toISOString();
    
    // Update status (if provided and valid)
    if (status !== undefined) {
      const validStatuses = ['active', 'awaiting_approval', 'paused', 'completed'];
      if (validStatuses.includes(status)) {
        const oldStatus = project.status;
        project.status = status;
        updates.push(`status: ${oldStatus} -> ${status}`);
      }
    }
    
    // Update name (if provided and non-empty)
    if (name !== undefined && name.trim() !== '') {
      const oldName = project.name;
      project.name = name.trim();
      updates.push(`name: ${oldName} -> ${name.trim()}`);
    }
    
    // Update currentTier (if provided and is non-negative integer)
    if (currentTier !== undefined && typeof currentTier === 'number' && Number.isInteger(currentTier) && currentTier >= 0) {
      const oldTier = project.currentTier;
      project.currentTier = currentTier;
      updates.push(`currentTier: ${oldTier} -> ${currentTier}`);
    }
    
    // Update metadata
    project.metadata.lastUpdated = patchedAt;
    setProject(id, project);
    
    // Persist to tasks.json
    const tasksJsonPath = join(project.path, 'tasks.json');
    try {
      const tasksData = JSON.parse(await readFile(tasksJsonPath, 'utf-8'));
      // Update metadata in tasks.json
      tasksData.metadata = { 
        ...tasksData.metadata, 
        lastUpdated: patchedAt 
      };
      await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
    } catch (err) {
      console.error(`[Projects] Error updating tasks.json for ${id}:`, err);
    }
    
    // Update project.md frontmatter
    const projectMdPath = join(project.path, 'project.md');
    try {
      let mdContent = await readFile(projectMdPath, 'utf-8');
      
      // Update status in frontmatter
      if (status !== undefined) {
        mdContent = mdContent.replace(
          /^status:\s*.+$/m,
          `status: ${status}`
        );
      }
      
      // Update name in frontmatter
      if (name !== undefined && name.trim() !== '') {
        mdContent = mdContent.replace(
          /^name:\s*.+$/m,
          `name: ${name.trim()}`
        );
        // Also update the heading in the body (first # heading)
        mdContent = mdContent.replace(
          /^#\s+.+$/m,
          `# ${name.trim()}`
        );
      }
      
      // Update description in body (content after frontmatter)
      if (description !== undefined) {
        const frontmatterEnd = mdContent.indexOf('---', 3);
        if (frontmatterEnd !== -1) {
          const beforeBody = mdContent.substring(0, frontmatterEnd + 3);
          const headingMatch = mdContent.substring(frontmatterEnd + 3).match(/^\n*#\s+.+\n*/);
          if (headingMatch) {
            // Keep the heading, replace everything after it
            const heading = headingMatch[0];
            const newBody = description.trim() ? `\n\n${description.trim()}` : '';
            mdContent = beforeBody + heading + newBody;
            updates.push('description updated');
          }
        }
      }
      
      await writeFile(projectMdPath, mdContent);
    } catch (err) {
      console.error(`[Projects] Error updating project.md for ${id}:`, err);
    }
    
    // Broadcast update
    broadcastProjectUpdated(id, 'updated');
    
    console.log(`[Projects] General PATCH applied to ${id}: ${updates.join(', ')}`);
    res.json({ 
      success: true, 
      projectId: id, 
      updates 
    });
    
  } catch (err) {
    console.error('[Projects] Error in general project PATCH:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// PATCH /api/projects/:id/status - Update project status (legacy endpoint, kept for compatibility)
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Validate status
    const validStatuses = ['active', 'awaiting_approval', 'paused', 'completed'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    // Check if cache is hydrated
    if (!isCacheHydrated()) {
      return res.status(503).json({
        error: 'Cache not hydrated',
        message: 'Server is still loading project data.'
      });
    }
    
    // Get project
    const project = getProject(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Update status in cache
    project.status = status;
    project.metadata.lastUpdated = new Date().toISOString();
    setProject(id, project);
    
    // Persist to tasks.json
    const tasksJsonPath = join(project.path, 'tasks.json');
    try {
      const tasksData = JSON.parse(await readFile(tasksJsonPath, 'utf-8'));
      tasksData.metadata = { ...tasksData.metadata, lastUpdated: project.metadata.lastUpdated };
      await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
    } catch (err) {
      console.error(`[Projects] Error updating tasks.json for ${id}:`, err);
    }
    
    // Update project.md frontmatter
    const projectMdPath = join(project.path, 'project.md');
    try {
      const mdContent = await readFile(projectMdPath, 'utf-8');
      // Replace status in frontmatter
      const updatedMd = mdContent.replace(
        /^status:\s*.+$/m,
        `status: ${status}`
      );
      await writeFile(projectMdPath, updatedMd);
    } catch (err) {
      console.error(`[Projects] Error updating project.md for ${id}:`, err);
    }
    
    // Broadcast update
    broadcastProjectUpdated(id, 'updated');
    
    console.log(`[Projects] Status updated for ${id}: ${status}`);
    res.json({ success: true, projectId: id, status });
    
  } catch (err) {
    console.error('[Projects] Error updating project status:', err);
    res.status(500).json({ error: 'Failed to update project status' });
  }
});

// POST /api/projects/:id/archive - Archive project
router.post('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    const projectPath = join(PROJECTS_DIR, id);
    const archivedPath = join(ARCHIVE_DIR, id);

    // Check if project exists
    try {
      await stat(projectPath);
    } catch {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Create Archive directory if it doesn't exist
    await mkdir(ARCHIVE_DIR, { recursive: true });

    // Check if already archived
    try {
      await stat(archivedPath);
      return res.status(409).json({ error: 'Project is already archived' });
    } catch {
      // Good, not archived yet
    }

    // Move project to Archive
    await rename(projectPath, archivedPath);

    console.log(`[Projects] Archived project: ${id}`);
    res.json({
      success: true,
      message: 'Project archived successfully',
      projectId: id,
      archivedPath
    });
  } catch (err) {
    console.error('[Projects] Error archiving project:', err);
    res.status(500).json({ error: 'Failed to archive project', message: (err as Error).message });
  }
});

// POST /api/projects/:id/restore - Restore project from archive
router.post('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    const projectPath = join(PROJECTS_DIR, id);
    const archivedPath = join(ARCHIVE_DIR, id);

    // Check if project exists in archive
    try {
      await stat(archivedPath);
    } catch {
      return res.status(404).json({ error: 'Project not found in archive' });
    }

    // Check if project already exists in Projects (conflict)
    try {
      await stat(projectPath);
      return res.status(409).json({ error: 'Project with this ID already exists in Projects' });
    } catch {
      // Good, no conflict
    }

    // Create Projects directory if it doesn't exist
    await mkdir(PROJECTS_DIR, { recursive: true });

    // Move project back to Projects
    await rename(archivedPath, projectPath);

    console.log(`[Projects] Restored project: ${id}`);
    res.json({
      success: true,
      message: 'Project restored successfully',
      projectId: id,
      projectPath
    });
  } catch (err) {
    console.error('[Projects] Error restoring project:', err);
    res.status(500).json({ error: 'Failed to restore project', message: (err as Error).message });
  }
});

// POST /api/projects/:id/restore-copy - Restore project as copy
router.post('/:id/restore-copy', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'New project name is required' });
    }

    const archivedPath = join(ARCHIVE_DIR, id);

    // Check if project exists in archive
    try {
      await stat(archivedPath);
    } catch {
      return res.status(404).json({ error: 'Project not found in archive' });
    }

    // Generate new project ID from name
    const newId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const newProjectPath = join(PROJECTS_DIR, newId);

    // Check if project with new ID already exists
    try {
      await stat(newProjectPath);
      return res.status(409).json({ error: 'Project with this name already exists' });
    } catch {
      // Good, no conflict
    }

    // Copy project from archive to Projects with new name
    await copyDirectory(archivedPath, newProjectPath);

    // Update project.md with new name
    const projectMdPath = join(newProjectPath, 'project.md');
    try {
      const content = await readFile(projectMdPath, 'utf-8');
      const updatedContent = content.replace(/^name:.*$/m, `name: ${name}`);
      await writeFile(projectMdPath, updatedContent);
    } catch (err) {
      console.warn('[Projects] Could not update project.md name:', err);
    }

    console.log(`[Projects] Restored project as copy: ${id} -> ${newId}`);
    res.json({
      success: true,
      message: 'Project restored as copy successfully',
      originalId: id,
      newId,
      newName: name,
      projectPath: newProjectPath
    });
  } catch (err) {
    console.error('[Projects] Error restoring project as copy:', err);
    res.status(500).json({ error: 'Failed to restore project as copy', message: (err as Error).message });
  }
});

// Helper function to copy directory recursively
async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Valid log tags for agent log entries
 */
const VALID_LOG_TAGS = [
  'STARTED', 'COMPLETED', 'BLOCKED', 'DISCOVERED', 'DECISION',
  'PROGRESS', 'TIER_COMPLETE', 'ERROR', 'INFO', 'QUERY', 'COMMENT'
];

/**
 * POST /api/projects/:projectId/logs
 * Add a validated log entry to a project's agentlogs.md
 * Request body:
 *   - agent: Agent name (must match [A-Z_]+)
 *   - tag: Log tag (must be one of VALID_LOG_TAGS)
 *   - context: Context string (non-empty)
 *   - description: Description string (non-empty)
 */
router.post('/:projectId/logs', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { agent, tag, context, description } = req.body;

    // Validate all fields
    const errors: string[] = [];

    // Validate agent
    if (typeof agent !== 'string') {
      errors.push('Agent must be a string');
    } else if (!agent.trim()) {
      errors.push('Agent is required');
    } else if (!/^[A-Z_]+$/.test(agent)) {
      errors.push('Agent must match pattern [A-Z_]+ (uppercase letters and underscores only)');
    }

    // Validate tag
    if (typeof tag !== 'string') {
      errors.push('Tag must be a string');
    } else if (!VALID_LOG_TAGS.includes(tag)) {
      errors.push(`Tag must be one of: ${VALID_LOG_TAGS.join(', ')}`);
    }

    // Validate context
    if (typeof context !== 'string') {
      errors.push('Context must be a string');
    } else if (!context.trim()) {
      errors.push('Context is required');
    }

    // Validate description
    if (typeof description !== 'string') {
      errors.push('Description must be a string');
    } else if (!description.trim()) {
      errors.push('Description is required');
    }

    // Return 400 if validation failed
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: errors.join('; '),
        details: errors
      });
    }

    // Check if project exists
    const projectPath = join(PROJECTS_DIR, projectId);
    try {
      await access(projectPath);
    } catch {
      return res.status(404).json({
        error: 'Project not found',
        message: `No project found with ID: ${projectId}`
      });
    }

    // Format the log entry
    const timestamp = new Date().toISOString();
    const logEntry = `[AGENT ${agent}: ${tag}] ${timestamp} | ${context} | ${description}\n`;

    // Append to agentlogs.md
    const agentlogsPath = join(projectPath, 'agentlogs.md');
    await writeFile(agentlogsPath, logEntry, { flag: 'a' });

    // Broadcast via WebSocket
    broadcastLogUpdated(projectId, {
      agent: agent as string,
      tag: tag as string,
      timestamp,
      context: context as string,
      description: description as string,
      raw: logEntry.trim()
    });

    // Return success
    res.status(200).json({
      success: true,
      message: 'Log written successfully',
      log: {
        agent,
        tag,
        timestamp,
        context,
        description
      }
    });

    console.log(`[Logs] Log entry written for project ${projectId}: ${agent}:${tag}`);
  } catch (err) {
    console.error('[Logs] Error writing log:', err);
    res.status(500).json({
      error: 'Failed to write log',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});



export default router;
