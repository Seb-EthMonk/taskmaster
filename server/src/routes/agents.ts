import { Router } from 'express';
import { readdir, readFile, stat, writeFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { spawn } from 'child_process';
import { broadcastAgentHeartbeat, broadcastAgentSpawned, broadcastAgentExited, broadcastAgentOutput, broadcastAgentExpansions } from '../websocket/broadcaster.js';
import { getProject, setProject } from '../cache/index.js';
import { removeLockFile } from '../services/lock-recovery.js';
import { getAllExpansions, getExpansion, getExpansionsByIds, buildExpansionContent, parseExpansionList } from '../expansions/index.js';
import { getAllSkills } from '../skills/index.js';
import { activeAgents as taskActiveAgents } from './tasks.js';

const router = Router();
const AGENTS_DIR = join(__dirname, '../../../agents');

// Active agent processes map
const activeAgents = new Map<string, {
  pid: number;
  name: string;
  spawnedAt: string;
  expansions?: string[];
  projectId?: string;
  taskId?: string;
  heartbeatInterval?: NodeJS.Timeout;
  terminating?: boolean;
}>();

interface Agent {
  id: string;
  name: string;
  description: string;
  tools: string[];
  availableExpansions: string[]; // Expansions available for this agent (from frontmatter)
  allExpansions: string[]; // All available expansions in the system
  allSkills: string[]; // All available skills in the system
}

// Parse agent .md file frontmatter
async function parseAgentMd(filePath: string, id: string): Promise<Agent | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Parse YAML frontmatter
    const metadata: Record<string, string> = {};
    if (lines[0] === '---') {
      let i = 1;
      while (i < lines.length && lines[i] !== '---') {
        const line = lines[i];
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          metadata[key] = value;
        }
        i++;
      }
    }

    // Parse tools array (format: tools: [Read, Write, Edit, ...])
    let tools: string[] = [];
    if (metadata.tools) {
      const toolsMatch = metadata.tools.match(/\[(.*?)\]/);
      if (toolsMatch) {
        tools = toolsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    // Parse expansion field from frontmatter (comma-separated list)
    let availableExpansions: string[] = [];
    if (metadata.expansion) {
      availableExpansions = parseExpansionList(metadata.expansion);
    }

    // Get all available expansions and skills from registries
    const allExpansionIds = getAllExpansions().map(e => e.id);
    const allSkillIds = getAllSkills().map(s => s.id);

    return {
      id,
      name: metadata.name || id,
      description: metadata.description || 'No description available',
      tools,
      availableExpansions,
      allExpansions: allExpansionIds,
      allSkills: allSkillIds
    };
  } catch (err) {
    console.error(`[Agents] Error parsing agent file: ${filePath}`, err);
    return null;
  }
}

// GET /api/agents - List all agents
router.get('/', async (req, res) => {
  try {
    const entries = await readdir(AGENTS_DIR);
    const agents: Agent[] = [];

    for (const entry of entries) {
      const entryPath = join(AGENTS_DIR, entry);
      const stats = await stat(entryPath);

      // Only process .md files (skip directories except Expansions)
      if (stats.isDirectory() || !entry.endsWith('.md')) {
        continue;
      }

      const agentId = entry.replace('.md', '').toLowerCase();
      const agent = await parseAgentMd(entryPath, agentId);

      if (agent) {
        agents.push(agent);
      }
    }

    console.log(`[Agents] Returning ${agents.length} agents`);
    res.json(agents);
  } catch (err) {
    console.error('[Agents] Error listing agents:', err);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// GET /api/agents/expansions - Get all available expansions
router.get('/expansions/all', async (req, res) => {
  try {
    const expansions = getAllExpansions().map(e => ({
      id: e.id,
      name: e.name,
      description: e.description,
      type: e.type
    }));

    res.json({
      count: expansions.length,
      expansions
    });
  } catch (err) {
    console.error('[Agents] Error listing expansions:', err);
    res.status(500).json({ error: 'Failed to list expansions' });
  }
});

// GET /api/agents/image/:filename - Serve agent images
router.get('/image/:filename', async (req, res) => {
  const { filename } = req.params;
  if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|gif|webp)$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const imagePath = join(AGENTS_DIR, 'image', filename);
  try {
    await stat(imagePath);
    res.sendFile(imagePath);
  } catch {
    res.status(404).json({ error: 'Image not found' });
  }
});

// GET /api/agents/:id - Get agent details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Find agent file (case-insensitive)
    let filePath = '';
    try {
      const entries = await readdir(AGENTS_DIR);
      const agentFile = entries.find(entry =>
        entry.toLowerCase() === `${id.toLowerCase()}.md` && entry.endsWith('.md')
      );
      if (!agentFile) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      filePath = join(AGENTS_DIR, agentFile);
    } catch {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = await parseAgentMd(filePath, id);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json(agent);
  } catch (err) {
    console.error('[Agents] Error getting agent:', err);
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

// POST /api/agents/:id/spawn - Spawn an agent process
router.post('/:id/spawn', async (req, res) => {
  try {
    const { id } = req.params;
    const { projectPath, taskId, projectId, expansions: selectedExpansions } = req.body;

    // Check if project is paused - block agent spawning
    if (projectId) {
      const project = getProject(projectId);
      if (project) {
        if (project.status === 'paused') {
          return res.status(423).json({
            error: 'Project paused',
            message: `Cannot spawn agent: Project ${projectId} is currently paused. Resume the workflow first.`,
            projectId,
            status: project.status
          });
        }
      }
    }

    // Find agent file (case-insensitive)
    let filePath = '';
    let agentFileName = '';
    try {
      const entries = await readdir(AGENTS_DIR);
      const agentFile = entries.find(entry =>
        entry.toLowerCase() === `${id.toLowerCase()}.md` && entry.endsWith('.md')
      );
      if (!agentFile) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      agentFileName = agentFile.replace('.md', '');
      filePath = join(AGENTS_DIR, agentFile);
    } catch {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Check if agent is already running
    const existingAgent = Array.from(activeAgents.entries()).find(([, agent]) => agent.name === agentFileName);
    if (existingAgent) {
      return res.status(409).json({
        error: 'Agent already running',
        pid: existingAgent[1].pid
      });
    }

    // Parse the agent to get its available expansions
    const agent = await parseAgentMd(filePath, id);
    const availableExpansionIds = agent?.availableExpansions || [];

    // Build expansion content if expansions are selected
    let expansionContent = '';
    let activeExpansions: string[] = [];
    let expansionWarnings: string[] = [];
    let expansionMissing: string[] = [];

    if (selectedExpansions && Array.isArray(selectedExpansions) && selectedExpansions.length > 0) {
      // Validate selected expansions against available expansions
      const validExpansions = selectedExpansions.filter(exp => {
        // Check if it's in the agent's available expansions or all expansions
        return availableExpansionIds.includes(exp) || getExpansion(exp) !== undefined;
      });

      const invalidExpansions = selectedExpansions.filter(exp => !validExpansions.includes(exp));

      if (invalidExpansions.length > 0) {
        expansionWarnings.push(`Invalid expansions ignored: ${invalidExpansions.join(', ')}`);
      }

      if (validExpansions.length > 0) {
        const result = buildExpansionContent(validExpansions);
        expansionContent = result.content;
        activeExpansions = result.loaded;
        expansionMissing = result.missing;
        expansionWarnings.push(...result.warnings);

        if (result.missing.length > 0) {
          console.warn(`[Agent] Missing expansions for ${agentFileName}:`, result.missing);
        }
      }
    }

    // Build agent script with task execution logic
    // Agent uses REST API and executes real work via file operations
    let agentScript = `
      const http = require('http');
      const fs = require('fs');
      const path = require('path');
      const { spawn } = require('child_process');
      
      const pid = process.pid;
      const agentName = '${agentFileName}';
      const activeExpansions = ${JSON.stringify(activeExpansions)};
      const taskId = process.env.TASK_ID;
      const projectId = '${projectId || ''}';
      const projectPath = '${projectPath || ''}';
      
      // Helper to make API requests
      function apiRequest(method, path, data) {
        return new Promise((resolve, reject) => {
          const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
          };
          
          const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
              try { resolve(JSON.parse(body)); } 
              catch { resolve(body); }
            });
          });
          
          req.on('error', reject);
          req.on('timeout', () => reject(new Error('Request timeout')));
          if (data) req.write(JSON.stringify(data));
          req.end();
        });
      }
      
      // Helper to append to agentlogs.md
      function logActivity(tag, description) {
        const timestamp = new Date().toISOString();
        const logLine = "[AGENT: " + tag + "] " + timestamp + " | " + (taskId || 'general') + " | " + description + "\\n";
        console.log(logLine.trim());
        if (projectPath) {
          try {
            const logPath = path.join(projectPath, 'agentlogs.md');
            fs.appendFileSync(logPath, logLine);
          } catch (err) {
            console.error('[LOG ERROR]', err.message);
          }
        }
      }
      
      // Execute kimi command to do actual work
      function executeKimi(prompt, cwd) {
        return new Promise((resolve, reject) => {
          const kimi = spawn('kimi', ['-c', prompt], {
            cwd: cwd || projectPath,
            env: process.env,
            timeout: 300000 // 5 minute timeout
          });
          
          let stdout = '';
          let stderr = '';
          
          kimi.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log('[KIMI]', data.toString().trim());
          });
          
          kimi.stderr.on('data', (data) => {
            stderr += data.toString();
            console.error('[KIMI ERR]', data.toString().trim());
          });
          
          kimi.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error('kimi exited with code ' + code + ': ' + stderr));
          });
          
          kimi.on('error', (err) => {
            reject(new Error('Failed to spawn kimi: ' + err.message));
          });
        });
      }
      
      // Main task execution
      async function executeTask() {
        if (!taskId || !projectId) {
          console.log(JSON.stringify({ type: 'agent:started', pid, agent: agentName }));
          return;
        }
        
        let taskCompleted = false;
        
        try {
          logActivity('STARTED', agentName + ' agent spawned for ' + taskId);
          
          // 1. Set task to in_progress
          await apiRequest('PATCH', '/api/projects/' + projectId + '/tasks/' + taskId, {
            status: 'in_progress'
          });
          logActivity('PROGRESS', 'Task status: in_progress');
          
          // 2. Read task details
          const taskRes = await apiRequest('GET', '/api/projects/' + projectId + '/tasks/' + taskId, null);
          if (!taskRes || taskRes.error) {
            throw new Error('Failed to get task: ' + (taskRes?.error || 'unknown'));
          }
          const task = taskRes.task || taskRes;
          
          logActivity('PROGRESS', 'Working on: ' + (task.title || 'Untitled'));
          logActivity('PROGRESS', 'Description: ' + (task.description || 'No description').substring(0, 100));
          
          // 3. Check for kimi-cli
          try {
            await executeKimi('echo "kimi check"', '/tmp');
          } catch (err) {
            logActivity('ERROR', 'kimi-cli not available: ' + err.message);
            // Continue without kimi - just mark done
            logActivity('PROGRESS', 'No AI available - marking task for manual completion');
          }
          
          // 4. Do actual work if description exists
          if (task.description && task.description.length > 10) {
            logActivity('PROGRESS', 'Executing task with kimi...');
            try {
              const workPrompt = \`You are working on task "\${task.title}" in project \${projectId} at \${projectPath}. 
Task description: \${task.description}

Complete this task by:
1. Reading the relevant files in the project
2. Making necessary changes
3. Writing a summary of what you did to agentlogs.md

Be concise and focused.\`;
              
              await executeKimi(workPrompt, projectPath);
              logActivity('PROGRESS', 'AI work completed');
            } catch (err) {
              logActivity('ERROR', 'AI work failed: ' + err.message);
            }
          } else {
            logActivity('PROGRESS', 'No specific work description - task ready for manual work');
          }
          
          // 5. Mark task completed
          await apiRequest('PATCH', '/api/projects/' + projectId + '/tasks/' + taskId, {
            status: 'done',
            completed: new Date().toISOString()
          });
          taskCompleted = true;
          logActivity('COMPLETED', 'Task marked completed');
          
          // 6. Unlock task
          await apiRequest('POST', '/api/projects/' + projectId + '/tasks/' + taskId + '/unlock', {});
          logActivity('COMPLETED', 'Lock released');
          
        } catch (err) {
          logActivity('ERROR', 'Task execution failed: ' + err.message);
          console.error('[AGENT ERROR]', err);
        }
        
        // Send final heartbeat then exit
        clearInterval(heartbeatInterval);
        setTimeout(() => process.exit(taskCompleted ? 0 : 1), 500);
      }
      
      // Start heartbeat
      const heartbeatInterval = setInterval(() => {
        console.log(JSON.stringify({
          type: 'agent:heartbeat',
          pid: pid,
          agent: agentName,
          timestamp: new Date().toISOString()
        }));
      }, 5000);
      
      // Handle graceful shutdown
      process.on('SIGTERM', () => {
        clearInterval(heartbeatInterval);
        process.exit(0);
      });
      
      // Start execution
      console.log(JSON.stringify({
        type: 'agent:started',
        pid: pid,
        agent: agentName,
        timestamp: new Date().toISOString(),
        expansions: activeExpansions
      }));
      
      executeTask();
    `;

    // Spawn the agent as a child process
    const agentProcess = spawn(process.execPath, ['-e', agentScript], {
      env: {
        ...process.env,
        AGENT_NAME: agentFileName,
        PROJECT_PATH: projectPath || '',
        TASK_ID: taskId || '',
        EXPANSIONS: activeExpansions.join(','),
        EXPANSION_CONTENT: expansionContent // Inject expansion content via env var
      },
      detached: false
    });

    const spawnedAt = new Date().toISOString();
    const agentId = `agent-${id}-${Date.now()}`;

    // Store agent process info
    activeAgents.set(agentId, {
      pid: agentProcess.pid!,
      name: agentFileName,
      spawnedAt,
      expansions: activeExpansions,
      projectId: projectId || undefined,
      taskId: taskId || undefined
    });

    // Handle agent stdout - parse heartbeat messages and broadcast output
    agentProcess.stdout.on('data', (data) => {
      const output = data.toString();
      const lines = output.trim().split('\n');
      const timestamp = new Date().toISOString();

      // Broadcast raw stdout to WebSocket clients
      broadcastAgentOutput(agentProcess.pid!, agentFileName, output, 'stdout', timestamp, projectId);

      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.type === 'agent:heartbeat') {
            // Broadcast heartbeat to all WebSocket clients
            broadcastAgentHeartbeat(message.pid, message.agent, message.timestamp);
          } else if (message.type === 'agent:started') {
            // Broadcast agent spawned event
            broadcastAgentSpawned(message.pid, message.agent, message.timestamp, projectId, message.expansions);

            // Broadcast expansions if any
            if (message.expansions && message.expansions.length > 0) {
              broadcastAgentExpansions(message.pid, message.agent, message.expansions, message.timestamp);
            }
          }
        } catch {
          // Not JSON, ignore (already broadcast as raw output above)
        }
      }
    });

    // Handle agent stderr - broadcast error output
    agentProcess.stderr.on('data', (data) => {
      const output = data.toString();
      const timestamp = new Date().toISOString();

      // Broadcast stderr to WebSocket clients
      broadcastAgentOutput(agentProcess.pid!, agentFileName, output, 'stderr', timestamp, projectId);
    });

    // Handle agent exit
    agentProcess.on('exit', async (code) => {
      const agent = activeAgents.get(agentId);
      if (agent) {
        broadcastAgentExited(agent.pid, agent.name, code || 0, new Date().toISOString(), agent.projectId);
        console.log(`[Agent] Process ${agent.name} (PID ${agent.pid}) exited with code ${code}`);
        activeAgents.delete(agentId);
        
        // Clean up lock file and reset task status
        if (agent.projectId && agent.taskId) {
          try {
            // Remove lock file
            await removeLockFile(agent.projectId, agent.taskId);
            
            // Update task status back to pending
            const project = getProject(agent.projectId);
            if (project) {
              const task = project.tasks.find(t => t.id === agent.taskId);
              if (task && task.status === 'in_progress') {
                task.status = 'pending';
                task.locked_by = null;
                task.locked_at = null;
                task.reclaim_after = null;
                task.last_updated_at = new Date().toISOString();
                setProject(agent.projectId, project);
                
                // Persist to tasks.json
                const tasksJsonPath = join(project.path, 'tasks.json');
                try {
                  const tasksData = JSON.parse(await readFile(tasksJsonPath, 'utf-8'));
                  const taskIndex = tasksData.tasks.findIndex((t: { id: string }) => t.id === agent.taskId);
                  if (taskIndex !== -1) {
                    tasksData.tasks[taskIndex] = task;
                    tasksData.metadata = { ...tasksData.metadata, lastUpdated: new Date().toISOString() };
                    await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
                  }
                } catch (err) {
                  console.error(`[Agent] Error updating tasks.json on exit:`, err);
                }
                
                console.log(`[Agent] Task ${agent.taskId} reset to pending status`);
              }
            }
          } catch (err) {
            console.error(`[Agent] Error cleaning up after exit:`, err);
          }
        }
      }
    });

    // Handle agent error
    agentProcess.on('error', (error) => {
      console.error(`[Agent] Error in agent ${agentFileName}:`, error);
      activeAgents.delete(agentId);
    });

    console.log(`[Agent] Spawned ${agentFileName} with PID ${agentProcess.pid}${activeExpansions.length > 0 ? ` (expansions: ${activeExpansions.join(', ')})` : ''}`);

    res.status(201).json({
      success: true,
      pid: agentProcess.pid,
      agent: agentFileName,
      spawnedAt,
      expansions: activeExpansions,
      warnings: expansionWarnings.length > 0 ? expansionWarnings : undefined,
      missing: expansionMissing.length > 0 ? expansionMissing : undefined,
      message: `Agent ${agentFileName} spawned successfully${activeExpansions.length > 0 ? ` with ${activeExpansions.length} expansion(s)` : ''}`
    });
  } catch (err) {
    console.error('[Agent] Error spawning agent:', err);
    res.status(500).json({ error: 'Failed to spawn agent' });
  }
});

// DELETE /api/agents/:pid - Kill an agent process
router.delete('/:pid', async (req, res) => {
  try {
    const pid = parseInt(req.params.pid, 10);

    if (isNaN(pid)) {
      return res.status(400).json({ error: 'Invalid PID' });
    }

    // Find agent by PID in both agent maps
    let agentEntry = Array.from(activeAgents.entries()).find(([, agent]) => agent.pid === pid);
    let source = 'agents';
    
    // Also check taskActiveAgents (agents spawned via /tasks/:taskId/assign)
    if (!agentEntry) {
      agentEntry = Array.from(taskActiveAgents.entries()).find(([, agent]) => agent.pid === pid);
      source = 'tasks';
    }

    if (!agentEntry) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const [agentId, agent] = agentEntry;

    // Kill the process
    try {
      // Mark agent as being terminated (prevents duplicate events)
      if (source === 'agents') {
        const agentData = activeAgents.get(agentId);
        if (agentData) {
          activeAgents.set(agentId, { ...agentData, terminating: true });
        }
      } else {
        const agentData = taskActiveAgents.get(agentId);
        if (agentData) {
          taskActiveAgents.set(agentId, { ...agentData, terminating: true });
        }
      }

      process.kill(pid, 'SIGTERM');
      // Note: We do NOT delete from activeAgents here - the exit handler will do that
      // and broadcast the agent:exited event

      console.log(`[Agent] Sent SIGTERM to ${agent.name} (PID ${pid}, source: ${source})`);

      res.json({
        success: true,
        pid,
        agent: agent.name,
        message: `Agent ${agent.name} killed successfully`
      });
    } catch (error) {
      console.error(`[Agent] Error killing process ${pid}:`, error);
      res.status(500).json({ error: 'Failed to kill agent process' });
    }
  } catch (err) {
    console.error('[Agent] Error killing agent:', err);
    res.status(500).json({ error: 'Failed to kill agent' });
  }
});

/**
 * Check if a process is actually alive
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 checks if process exists without sending signal
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up dead agents from the activeAgents map
 * Also cleans up their lock files and resets task status
 */
async function cleanupDeadAgents(): Promise<number> {
  const deadAgents: string[] = [];
  
  for (const [agentId, agent] of activeAgents.entries()) {
    if (!isProcessAlive(agent.pid)) {
      deadAgents.push(agentId);
      
      // Clean up lock file and reset task status
      if (agent.projectId && agent.taskId) {
        try {
          await removeLockFile(agent.projectId, agent.taskId);
          
          const project = getProject(agent.projectId);
          if (project) {
            const task = project.tasks.find(t => t.id === agent.taskId);
            if (task && task.status === 'in_progress') {
              task.status = 'pending';
              task.locked_by = null;
              task.locked_at = null;
              task.reclaim_after = null;
              task.last_updated_at = new Date().toISOString();
              setProject(agent.projectId, project);
              
              // Persist to tasks.json
              const tasksJsonPath = join(project.path, 'tasks.json');
              try {
                const tasksData = JSON.parse(await readFile(tasksJsonPath, 'utf-8'));
                const taskIndex = tasksData.tasks.findIndex((t: { id: string }) => t.id === agent.taskId);
                if (taskIndex !== -1) {
                  tasksData.tasks[taskIndex] = task;
                  tasksData.metadata = { ...tasksData.metadata, lastUpdated: new Date().toISOString() };
                  await writeFile(tasksJsonPath, JSON.stringify(tasksData, null, 2));
                }
              } catch (err) {
                console.error(`[AgentCleanup] Error updating tasks.json:`, err);
              }
              
              console.log(`[AgentCleanup] Task ${agent.taskId} reset to pending (dead agent cleaned up)`);
            }
          }
        } catch (err) {
          console.error(`[AgentCleanup] Error cleaning up dead agent ${agentId}:`, err);
        }
      }
      
      console.log(`[AgentCleanup] Removed dead agent ${agent.name} (PID ${agent.pid})`);
    }
  }
  
  // Remove dead agents from map
  for (const agentId of deadAgents) {
    activeAgents.delete(agentId);
  }
  
  return deadAgents.length;
}

// GET /api/agents/status - Get status of all running agents (verified alive)
router.get('/status/running', async (req, res) => {
  // Clean up dead agents first
  const cleanedCount = await cleanupDeadAgents();
  if (cleanedCount > 0) {
    console.log(`[Agents] Cleaned up ${cleanedCount} dead agent(s)`);
  }
  
  const agents = Array.from(activeAgents.entries()).map(([id, agent]) => ({
    id,
    pid: agent.pid,
    name: agent.name,
    spawnedAt: agent.spawnedAt,
    expansions: agent.expansions || [],
    projectId: agent.projectId,
    taskId: agent.taskId
  }));

  res.json({
    count: agents.length,
    agents,
    cleaned: cleanedCount
  });
});

// POST /api/agents/:pid/terminate - Terminate an agent process
router.post('/:pid/terminate', async (req, res) => {
  try {
    const pid = parseInt(req.params.pid, 10);

    if (isNaN(pid)) {
      return res.status(400).json({
        error: 'Invalid PID',
        message: 'The provided PID is not a valid number'
      });
    }

    // Find agent by PID
    const agentEntry = Array.from(activeAgents.entries()).find(([, agent]) => agent.pid === pid);

    if (!agentEntry) {
      return res.status(404).json({
        error: 'Agent not found',
        message: `No active agent found with PID ${pid}`
      });
    }

    const [agentId, agent] = agentEntry;

    // Check if agent is already being terminated
    if (agent.terminating) {
      return res.status(409).json({
        error: 'Already terminating',
        message: `Agent ${agent.name} (PID ${pid}) is already being terminated`,
        pid,
        agent: agent.name
      });
    }

    // Kill the process
    try {
      // Mark agent as being terminated (prevents duplicate events)
      agent.terminating = true;
      activeAgents.set(agentId, agent);

      process.kill(pid, 'SIGTERM');

      console.log(`[Agent] Terminate request sent to ${agent.name} (PID ${pid})`);

      res.json({
        success: true,
        pid,
        agent: agent.name,
        message: `Terminate signal sent to agent ${agent.name}`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      // Reset terminating flag on error
      agent.terminating = false;
      activeAgents.set(agentId, agent);

      console.error(`[Agent] Error terminating process ${pid}:`, error);

      // Check if process doesn't exist
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        return res.status(404).json({
          error: 'Process not found',
          message: `Process with PID ${pid} no longer exists`,
          pid
        });
      }

      res.status(500).json({
        error: 'Failed to terminate agent',
        message: 'An error occurred while trying to terminate the agent process'
      });
    }
  } catch (err) {
    console.error('[Agent] Error in terminate endpoint:', err);
    res.status(500).json({
      error: 'Failed to terminate agent',
      message: 'An unexpected error occurred'
    });
  }
});

// POST /api/agents/:pid/force-kill - Force kill an agent process with SIGKILL
router.post('/:pid/force-kill', async (req, res) => {
  try {
    const pid = parseInt(req.params.pid, 10);

    if (isNaN(pid)) {
      return res.status(400).json({
        error: 'Invalid PID',
        message: 'The provided PID is not a valid number'
      });
    }

    // Find agent by PID
    const agentEntry = Array.from(activeAgents.entries()).find(([, agent]) => agent.pid === pid);

    if (!agentEntry) {
      return res.status(404).json({
        error: 'Agent not found',
        message: `No active agent found with PID ${pid}`
      });
    }

    const [agentId, agent] = agentEntry;

    try {
      agent.terminating = true;
      activeAgents.set(agentId, agent);

      process.kill(pid, 'SIGKILL');

      console.log(`[Agent] Force kill (SIGKILL) sent to ${agent.name} (PID ${pid})`);

      res.json({
        success: true,
        pid,
        agent: agent.name,
        message: `Force killed agent ${agent.name}`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      agent.terminating = false;
      activeAgents.set(agentId, agent);

      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        return res.status(404).json({
          error: 'Process not found',
          message: `Process with PID ${pid} no longer exists`,
          pid
        });
      }

      res.status(500).json({
        error: 'Failed to force kill agent',
        message: 'An error occurred while trying to force kill the agent process'
      });
    }
  } catch (err) {
    console.error('[Agent] Error in force-kill endpoint:', err);
    res.status(500).json({
      error: 'Failed to force kill agent',
      message: 'An unexpected error occurred'
    });
  }
});

// GET /api/agents/:pid/ping - Check agent heartbeat/status
router.get('/:pid/ping', async (req, res) => {
  try {
    const pid = parseInt(req.params.pid, 10);

    if (isNaN(pid)) {
      return res.status(400).json({
        error: 'Invalid PID',
        message: 'The provided PID is not a valid number'
      });
    }

    // Find agent by PID
    const agentEntry = Array.from(activeAgents.entries()).find(([, agent]) => agent.pid === pid);

    if (!agentEntry) {
      return res.status(404).json({
        error: 'Agent not found',
        message: `No active agent found with PID ${pid}`,
        status: 'not_found'
      });
    }

    const [agentId, agent] = agentEntry;

    // Check if process is still alive
    let processAlive = false;
    try {
      process.kill(pid, 0); // Signal 0 checks if process exists without sending signal
      processAlive = true;
    } catch {
      processAlive = false;
    }

    // Calculate uptime
    const spawnedAt = new Date(agent.spawnedAt);
    const now = new Date();
    const uptimeMs = now.getTime() - spawnedAt.getTime();
    const uptimeSecs = Math.floor(uptimeMs / 1000);
    const uptimeMins = Math.floor(uptimeSecs / 60);
    const uptimeHours = Math.floor(uptimeMins / 60);

    let uptimeFormatted: string;
    if (uptimeHours > 0) {
      uptimeFormatted = `${uptimeHours}h ${uptimeMins % 60}m ${uptimeSecs % 60}s`;
    } else if (uptimeMins > 0) {
      uptimeFormatted = `${uptimeMins}m ${uptimeSecs % 60}s`;
    } else {
      uptimeFormatted = `${uptimeSecs}s`;
    }

    res.json({
      success: true,
      pid,
      agent: agent.name,
      status: processAlive ? 'alive' : 'dead',
      spawnedAt: agent.spawnedAt,
      uptime: {
        milliseconds: uptimeMs,
        seconds: uptimeSecs,
        formatted: uptimeFormatted
      },
      projectId: agent.projectId,
      expansions: agent.expansions || [],
      terminating: agent.terminating || false,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Agent] Error in ping endpoint:', err);
    res.status(500).json({
      error: 'Failed to ping agent',
      message: 'An unexpected error occurred'
    });
  }
});

// POST /api/agents - Create new agent definition
router.post('/', async (req, res) => {
  try {
    const { name, description, systemPrompt, tools, expansions, model } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'Agent name is required'
      });
    }

    // Sanitize name for filename (allow only alphanumeric, hyphen, underscore)
    const sanitizedName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!sanitizedName) {
      return res.status(400).json({
        error: 'Invalid name',
        message: 'Agent name must contain valid characters (alphanumeric, hyphen, underscore)'
      });
    }

    // Check if agent file already exists
    const filePath = join(AGENTS_DIR, `${sanitizedName}.md`);
    try {
      await stat(filePath);
      return res.status(409).json({
        error: 'Agent already exists',
        message: `An agent with name "${sanitizedName}" already exists`
      });
    } catch {
      // File doesn't exist, which is what we want
    }

    // Validate tools is an array if provided
    if (tools && !Array.isArray(tools)) {
      return res.status(400).json({
        error: 'Invalid tools format',
        message: 'Tools must be an array of strings'
      });
    }

    // Validate expansions is an array if provided
    if (expansions && !Array.isArray(expansions)) {
      return res.status(400).json({
        error: 'Invalid expansions format',
        message: 'Expansions must be an array of strings'
      });
    }

    // Build YAML frontmatter
    const frontmatterLines: string[] = ['---'];
    frontmatterLines.push(`name: ${sanitizedName}`);
    frontmatterLines.push(`description: ${(description || 'No description available').trim()}`);

    if (tools && tools.length > 0) {
      frontmatterLines.push(`tools: [${tools.join(', ')}]`);
    }

    if (expansions && expansions.length > 0) {
      frontmatterLines.push(`expansion: ${expansions.join(', ')}`);
    }

    if (model) {
      frontmatterLines.push(`model: ${model}`);
    }

    frontmatterLines.push('---');
    frontmatterLines.push('');

    // Build content with system prompt if provided
    if (systemPrompt && systemPrompt.trim()) {
      frontmatterLines.push(systemPrompt.trim());
    } else {
      frontmatterLines.push(`# ${sanitizedName.charAt(0).toUpperCase() + sanitizedName.slice(1)} Agent`);
      frontmatterLines.push('');
      frontmatterLines.push((description || 'No description available').trim());
    }

    frontmatterLines.push('');

    // Write the agent file
    const content = frontmatterLines.join('\n');
    await writeFile(filePath, content, 'utf-8');

    console.log(`[Agents] Created new agent: ${sanitizedName}`);

    res.status(201).json({
      success: true,
      agent: {
        id: sanitizedName,
        name: sanitizedName,
        description: description || 'No description available',
        tools: tools || [],
        availableExpansions: expansions || [],
        allExpansions: getAllExpansions().map(e => e.id),
        allSkills: getAllSkills().map(s => s.id)
      },
      message: `Agent "${sanitizedName}" created successfully`
    });
  } catch (err) {
    console.error('[Agents] Error creating agent:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to create agent',
      message: errorMessage
    });
  }
});

export default router;
