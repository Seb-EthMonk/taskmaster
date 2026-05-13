<template>
  <div class="activity-log-view">
    <header class="activity-header">
      <h1>📊 Activity Log</h1>
      <p class="subtitle">Track all activity across projects and agents</p>
    </header>

    <!-- Active Agents Section -->
    <section class="active-agents-section">
      <h2>🟢 Active Agents</h2>
      <div v-if="loadingActiveAgents" class="loading-state">
        <div class="spinner"></div>
        <p>Loading active agents...</p>
      </div>
      <div v-else-if="activeAgents.length === 0" class="empty-state">
        <p>No active agents currently running</p>
      </div>
      <div v-else class="active-agents-grid">
        <div
          v-for="agent in activeAgents"
          :key="agent.fromLock ? `lock-${agent.name}-${agent.projectId}` : agent.pid"
          class="active-agent-card"
          :class="{ terminating: agent.terminating, 'from-lock': agent.fromLock }"
        >
          <div class="agent-status-indicator"></div>
          <div class="agent-info">
            <h3 class="agent-name">{{ agent.name }}</h3>
            <span v-if="!agent.fromLock" class="agent-pid">PID: {{ agent.pid }}</span>
            <span v-else class="agent-pid agent-lock-badge">lock</span>
          </div>
          <div v-if="agent.projectId" class="agent-task">
            <span class="task-label">Working on:</span>
            <router-link :to="`/projects/${agent.projectId}`" class="task-project">
              {{ getProjectName(agent.projectId) }}
            </router-link>
          </div>
          <div v-if="agent.expansions && agent.expansions.length > 0" class="agent-expansions">
            <span class="expansions-indicator">✨ {{ agent.expansions.length }} expansion(s)</span>
          </div>
          <div v-if="agent.fromLock && agent.reclaimAfter" class="agent-uptime">
            <span class="uptime-label">Lock expires:</span>
            <span class="uptime-value">{{ formatUptime(agent.reclaimAfter) }}</span>
          </div>
          <div v-else class="agent-uptime">
            <span class="uptime-label">Running for:</span>
            <span class="uptime-value">{{ formatUptime(agent.spawnedAt) }}</span>
          </div>
          <!-- Agent Management Actions (spawned processes) -->
          <div v-if="!agent.fromLock" class="agent-actions">
            <button
              class="action-btn ping-btn"
              @click="pingAgent(agent.pid)"
              :disabled="pingingAgents.has(agent.pid)"
              title="Check agent status"
            >
              <span v-if="pingingAgents.has(agent.pid)">⏳</span>
              <span v-else>🏓</span>
              {{ pingingAgents.has(agent.pid) ? 'Pinging...' : 'Ping' }}
            </button>
            <button
              class="action-btn terminate-btn"
              @click="confirmTerminate(agent)"
              :disabled="terminatingAgents.has(agent.pid) || agent.terminating"
              title="Send SIGTERM to agent process"
            >
              <span v-if="terminatingAgents.has(agent.pid) || agent.terminating">⏳</span>
              <span v-else>🛑</span>
              {{ terminatingAgents.has(agent.pid) || agent.terminating ? 'Stopping...' : 'Stop' }}
            </button>
            <button
              class="action-btn force-kill-btn"
              @click="confirmForceKill(agent)"
              :disabled="terminatingAgents.has(agent.pid) || agent.terminating"
              title="Force kill with SIGKILL — no cleanup"
            >
              ☠ Force Kill
            </button>
          </div>

          <!-- Lock Agent Actions (task-lock based agents) -->
          <div v-else class="agent-actions">
            <button
              class="action-btn force-kill-btn"
              @click="confirmForceUnlock(agent)"
              :disabled="unlockingAgents.has(`${agent.projectId}-${agent.taskId}`)"
              title="Remove task lock and release this agent slot"
            >
              <span v-if="unlockingAgents.has(`${agent.projectId}-${agent.taskId}`)">⏳</span>
              <span v-else>🔓</span>
              {{ unlockingAgents.has(`${agent.projectId}-${agent.taskId}`) ? 'Unlocking...' : 'Force Unlock' }}
            </button>
          </div>
          <!-- Ping Response Display -->
          <div v-if="pingResponses[agent.pid]" class="ping-response" :class="pingResponses[agent.pid].status">
            <div class="ping-header">
              <span class="ping-status-icon">{{ pingResponses[agent.pid].status === 'alive' ? '✅' : '❌' }}</span>
              <span class="ping-status-text">{{ pingResponses[agent.pid].status === 'alive' ? 'Responding' : 'Not Responding' }}</span>
              <button class="ping-close" @click="clearPingResponse(agent.pid)">×</button>
            </div>
            <div class="ping-details">
              <div class="ping-detail">
                <span class="ping-label">Uptime:</span>
                <span class="ping-value">{{ pingResponses[agent.pid].uptime?.formatted || 'N/A' }}</span>
              </div>
              <div v-if="pingResponses[agent.pid].expansions?.length > 0" class="ping-detail">
                <span class="ping-label">Expansions:</span>
                <span class="ping-value">{{ pingResponses[agent.pid].expansions.join(', ') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Filters -->
    <section class="filters-section">
      <div class="filters-grid">
        <div class="filter-group">
          <label>Project</label>
          <select v-model="filters.project" @change="fetchActivities">
            <option value="">All Projects</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
        </div>

        <div class="filter-group">
          <label>System Events — Type</label>
          <select v-model="filters.type" @change="fetchActivities">
            <option value="">All Types</option>
            <option value="audit">File Changes</option>
            <option value="agent">Agent Process</option>
            <option value="tier">Tier Transitions</option>
            <option value="error">Errors</option>
          </select>
        </div>

        <div class="filter-group">
          <label>System Events — Timeframe</label>
          <select v-model="filters.timeframe" @change="fetchActivities">
            <option value="all">All Time</option>
            <option value="4h">Last 4 Hours</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
          </select>
        </div>
      </div>

      <div class="filters-actions">
        <button class="refresh-btn" @click="fetchActivities" :disabled="loading">
          <span v-if="loading || loadingAgentLogs">Loading...</span>
          <span v-else>🔄 Refresh</span>
        </button>
        <button class="clear-btn" @click="clearFilters">Clear Filters</button>
      </div>
    </section>

    <!-- Project Agent Logs -->
    <section class="activity-feed-section">
      <div class="feed-header">
        <h2>📋 Project Agent Logs</h2>
        <span class="activity-count">{{ filteredAgentLogs.length }} entries</span>
      </div>
      <AgentLogsTable
        :logs="filteredAgentLogs"
        :loading="loadingAgentLogs"
        :projects="projects"
        @refresh="fetchActivities"
      />
    </section>

    <!-- System Events -->
    <section class="activity-feed-section" style="margin-top: 2rem;">
      <div class="feed-header">
        <h2>⚙️ System Events</h2>
        <span class="activity-count">{{ filteredActivities.length }} events</span>
      </div>

      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p>Loading system events...</p>
      </div>

      <div v-else-if="filteredActivities.length === 0" class="empty-state">
        <p>No system events matching your filters</p>
      </div>

      <div v-else class="activity-list">
        <div
          v-for="activity in paginatedActivities"
          :key="activity.id"
          class="activity-row"
          :class="[activity.type, activity.level || '', getRecencyClass(activity.timestamp)]"
          :title="activity.message"
        >
          <span class="row-icon">{{ getActivityIcon(activity) }}</span>
          <span class="row-badge" :class="activity.type">{{ formatActivityType(activity.type) }}</span>
          <span class="row-message">{{ formatMessage(activity) }}</span>
          <router-link
            v-if="activity.projectId"
            :to="`/projects/${activity.projectId}`"
            class="row-project-badge"
            :class="`proj-color-${getProjectColorIndex(activity.projectId)}`"
          >{{ getProjectName(activity.projectId) }}</router-link>
          <span class="row-time">{{ formatTimestamp(activity.timestamp) }}</span>
        </div>

        <div v-if="systemEventsTotalPages > 1" class="sys-pagination">
          <button class="sys-page-btn" :disabled="systemEventsPage === 1" @click="systemEventsPage--">← Prev</button>
          <span class="sys-page-info">{{ systemEventsPage }} / {{ systemEventsTotalPages }}</span>
          <button class="sys-page-btn" :disabled="systemEventsPage === systemEventsTotalPages" @click="systemEventsPage++">Next →</button>
        </div>
      </div>
    </section>

    <!-- Confirmation Dialog -->
    <div v-if="showConfirmDialog" class="confirm-dialog-overlay" @click="cancelConfirmDialog">
      <div class="confirm-dialog" @click.stop>
        <div class="confirm-dialog-header">
          <h3>{{ confirmDialogTitle }}</h3>
        </div>
        <div class="confirm-dialog-body">
          <p>{{ confirmDialogMessage }}</p>
        </div>
        <div class="confirm-dialog-footer">
          <button class="btn-cancel" @click="cancelConfirmDialog">Cancel</button>
          <button class="btn-confirm" @click="confirmDialogAction">Terminate</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useProjectsStore } from '../stores/projects';
import { useErrorStore } from '../stores/errors';
import { useRecency } from '../composables/useRecency';
import AgentLogsTable from '../components/AgentLogsTable.vue';
import type { AgentLogEntry } from '../components/AgentLogsTable.vue';

interface ActiveAgent {
  pid: number;
  name: string;
  spawnedAt: string;
  expansions?: string[];
  projectId?: string;
  terminating?: boolean;
  taskId?: string;
  reclaimAfter?: string;
  fromLock?: boolean;
}

interface PingResponse {
  status: 'alive' | 'dead';
  uptime?: {
    formatted: string;
  };
  expansions?: string[];
  timestamp: string;
}

interface Activity {
  id: string;
  type: 'audit' | 'agent' | 'tier' | 'error';
  timestamp: string;
  message: string;
  level?: 'error' | 'warning' | 'critical';
  projectId?: string;
  agentName?: string;
  details?: Record<string, unknown>;
}

const API_BASE = '/api';

const projectsStore = useProjectsStore();
const errorStore = useErrorStore();
const { getRecencyClass } = useRecency();

// State
const activeAgents = ref<ActiveAgent[]>([]);
const activities = ref<Activity[]>([]);
const agentLogs = ref<AgentLogEntry[]>([]);
const loading = ref(false);
const loadingAgentLogs = ref(false);
const loadingActiveAgents = ref(false);
const pingingAgents = ref<Set<number>>(new Set());
const terminatingAgents = ref<Set<number>>(new Set());
const unlockingAgents = ref<Set<string>>(new Set());
const pingResponses = ref<Record<number, PingResponse>>({});

// Confirmation dialog state
const showConfirmDialog = ref(false);
const confirmDialogTitle = ref('');
const confirmDialogMessage = ref('');
const confirmDialogAction = ref<(() => void) | null>(null);

const filters = ref({
  type: '',
  project: '',
  timeframe: 'all'
});

const systemEventsPage = ref(1);
const SYSTEM_EVENTS_PAGE_SIZE = 20;

// Computed
const projects = computed(() => projectsStore.projects);

const filteredActivities = computed(() => {
  let result = [...activities.value];

  if (filters.value.timeframe && filters.value.timeframe !== 'all') {
    const now = new Date().getTime();
    const timeframeMap: Record<string, number> = {
      '4h': 4 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    };
    const cutoff = now - (timeframeMap[filters.value.timeframe] || 0);
    result = result.filter(a => new Date(a.timestamp).getTime() >= cutoff);
  }

  if (filters.value.type) {
    result = result.filter(a => a.type === filters.value.type);
  }

  if (filters.value.project) {
    result = result.filter(a => a.projectId === filters.value.project);
  }

  return result;
});

const systemEventsTotalPages = computed(() =>
  Math.max(1, Math.ceil(filteredActivities.value.length / SYSTEM_EVENTS_PAGE_SIZE))
);

const paginatedActivities = computed(() => {
  const start = (systemEventsPage.value - 1) * SYSTEM_EVENTS_PAGE_SIZE;
  return filteredActivities.value.slice(start, start + SYSTEM_EVENTS_PAGE_SIZE);
});

watch(filteredActivities, () => { systemEventsPage.value = 1; });

const PROJECT_COLORS = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal', 'orange'];

function getProjectColorIndex(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % PROJECT_COLORS.length;
}

const filteredAgentLogs = computed(() => {
  if (!filters.value.project) return agentLogs.value;
  return agentLogs.value.filter(l => l.projectId === filters.value.project);
});

// Methods
function getProjectName(projectId: string): string {
  const project = projectsStore.projects.find(p => p.id === projectId);
  return project?.name || projectId;
}

function formatUptime(spawnedAt: string): string {
  const start = new Date(spawnedAt).getTime();
  const now = new Date().getTime();
  const diffMs = now - start;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ${diffHours % 24}h`;
  } else if (diffHours > 0) {
    return `${diffHours}h ${diffMins % 60}m`;
  } else {
    return `${diffMins}m`;
  }
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} min ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function formatActivityType(type: string): string {
  const typeMap: Record<string, string> = {
    audit: 'File Change',
    agent: 'Agent',
    tier: 'Tier Transition',
    error: 'Error'
  };
  return typeMap[type] || type;
}

function getActivityIcon(activity: Activity): string {
  switch (activity.type) {
    case 'audit':
      if (activity.message.includes('created')) return '🆕';
      if (activity.message.includes('modified')) return '✏️';
      if (activity.message.includes('deleted')) return '🗑️';
      return '📄';
    case 'agent':
      if (activity.message.includes('spawned')) return '🚀';
      if (activity.message.includes('exited')) return '🛑';
      if (activity.message.includes('output')) return '📤';
      return '🤖';
    case 'tier':
      return '⬆️';
    case 'error':
      if (activity.level === 'critical') return '🔥';
      if (activity.level === 'warning') return '⚠️';
      return '❌';
    default:
      return '📌';
  }
}

function formatMessage(activity: Activity): string {
  if (activity.type === 'audit') {
    const colonIdx = activity.message.indexOf(':');
    if (colonIdx !== -1) {
      const action = activity.message.slice(0, colonIdx);
      const filePath = activity.message.slice(colonIdx + 2);
      const filename = filePath.split('/').pop() || filePath;
      return `${action}: ${filename}`;
    }
  }
  return activity.message;
}

function clearFilters() {
  filters.value = { type: '', project: '', timeframe: 'all' };
  fetchActivities();
}

async function fetchActiveAgents() {
  loadingActiveAgents.value = true;
  try {
    // Get spawned agent processes
    const response = await fetch('/api/agents/status/running');
    const spawnedAgents: ActiveAgent[] = response.ok
      ? (await response.json()).agents || []
      : [];

    // Also scan project tasks for active locks (agents using heartbeat without a spawned process)
    const now = Date.now();
    const lockAgents: ActiveAgent[] = [];

    for (const project of projectsStore.projects) {
      for (const task of project.tasks) {
        if (
          task.status === 'in_progress' &&
          task.locked_by &&
          task.reclaim_after &&
          new Date(task.reclaim_after).getTime() > now
        ) {
          const alreadySpawned = spawnedAgents.some(a => a.name === task.locked_by);
          if (!alreadySpawned) {
            lockAgents.push({
              pid: 0,
              name: task.locked_by,
              spawnedAt: task.locked_at || task.started || task.created,
              projectId: project.id,
              taskId: task.id,
              reclaimAfter: task.reclaim_after,
              fromLock: true,
            });
          }
        }
      }
    }

    activeAgents.value = [...spawnedAgents, ...lockAgents];
  } catch (err) {
    console.error('Error fetching active agents:', err);
  } finally {
    loadingActiveAgents.value = false;
  }
}

// Ping agent to check status
async function pingAgent(pid: number) {
  pingingAgents.value.add(pid);
  try {
    const response = await fetch(`/api/agents/${pid}/ping`);
    const data = await response.json();

    if (response.ok && data.success) {
      pingResponses.value[pid] = {
        status: data.status,
        uptime: data.uptime,
        expansions: data.expansions,
        timestamp: data.timestamp
      };

      // Auto-clear ping response after 10 seconds
      setTimeout(() => {
        clearPingResponse(pid);
      }, 10000);
    } else {
      pingResponses.value[pid] = {
        status: 'dead',
        timestamp: new Date().toISOString()
      };
      errorStore.showError(
        'Ping Failed',
        data.message || `Agent with PID ${pid} did not respond`
      );
    }
  } catch (err) {
    console.error('Error pinging agent:', err);
    pingResponses.value[pid] = {
      status: 'dead',
      timestamp: new Date().toISOString()
    };
    errorStore.showError(
      'Ping Failed',
      'Unable to check agent status. Please try again.'
    );
  } finally {
    pingingAgents.value.delete(pid);
  }
}

// Clear ping response
function clearPingResponse(pid: number) {
  delete pingResponses.value[pid];
}

// Show confirmation dialog for terminate
function confirmTerminate(agent: ActiveAgent) {
  confirmDialogTitle.value = 'Terminate Agent';
  confirmDialogMessage.value = `Are you sure you want to terminate agent "${agent.name}" (PID: ${agent.pid})? This action cannot be undone.`;
  confirmDialogAction.value = () => terminateAgent(agent.pid);
  showConfirmDialog.value = true;
}

// Terminate agent
async function terminateAgent(pid: number) {
  showConfirmDialog.value = false;
  terminatingAgents.value.add(pid);

  try {
    const response = await fetch(`/api/agents/${pid}/terminate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // Update the agent's terminating status in the list
      const agent = activeAgents.value.find(a => a.pid === pid);
      if (agent) {
        agent.terminating = true;
      }

      // Show success feedback
      console.log(`Agent terminated: ${data.agent} (PID ${data.pid})`);

      // Refresh agent list after a short delay to show the exited state
      setTimeout(() => {
        fetchActiveAgents();
      }, 2000);
    } else {
      const errorMsg = data.message || 'Failed to terminate agent';
      console.error('Terminate failed:', errorMsg);
      errorStore.showError(
        'Terminate Failed',
        errorMsg
      );
      terminatingAgents.value.delete(pid);
    }
  } catch (err) {
    console.error('Error terminating agent:', err);
    errorStore.showError(
      'Terminate Failed',
      'An error occurred while trying to terminate the agent. Please try again.'
    );
    terminatingAgents.value.delete(pid);
  }
}

// Close confirmation dialog without action
function cancelConfirmDialog() {
  showConfirmDialog.value = false;
  confirmDialogAction.value = null;
}

// Force kill (SIGKILL) confirmation
function confirmForceKill(agent: ActiveAgent) {
  confirmDialogTitle.value = 'Force Kill Agent';
  confirmDialogMessage.value = `Force kill "${agent.name}" (PID: ${agent.pid}) with SIGKILL? The process will be immediately destroyed with no cleanup.`;
  confirmDialogAction.value = () => forceKillAgent(agent.pid);
  showConfirmDialog.value = true;
}

async function forceKillAgent(pid: number) {
  showConfirmDialog.value = false;
  terminatingAgents.value.add(pid);

  try {
    const response = await fetch(`/api/agents/${pid}/force-kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();

    if (response.ok && data.success) {
      const agent = activeAgents.value.find(a => a.pid === pid);
      if (agent) agent.terminating = true;
      setTimeout(() => fetchActiveAgents(), 1000);
    } else {
      errorStore.showError('Force Kill Failed', data.message || `Failed to force kill PID ${pid}`);
      terminatingAgents.value.delete(pid);
    }
  } catch (err) {
    errorStore.showError('Force Kill Failed', 'An error occurred. Please try again.');
    terminatingAgents.value.delete(pid);
  }
}

// Force unlock (lock-based agents)
function confirmForceUnlock(agent: ActiveAgent) {
  confirmDialogTitle.value = 'Force Unlock Task';
  confirmDialogMessage.value = `Remove the lock held by "${agent.name}"? The task will be reset to pending and the agent slot will be freed.`;
  confirmDialogAction.value = () => forceUnlockAgent(agent);
  showConfirmDialog.value = true;
}

async function forceUnlockAgent(agent: ActiveAgent) {
  showConfirmDialog.value = false;
  if (!agent.projectId || !agent.taskId) return;

  const key = `${agent.projectId}-${agent.taskId}`;
  unlockingAgents.value.add(key);

  try {
    const response = await fetch(
      `/api/projects/${agent.projectId}/tasks/${agent.taskId}/unlock`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );

    const data = await response.json();

    if (response.ok) {
      await fetchActiveAgents();
    } else {
      errorStore.showError('Unlock Failed', data.message || 'Failed to unlock task.');
    }
  } catch (err) {
    errorStore.showError('Unlock Failed', 'An error occurred. Please try again.');
  } finally {
    unlockingAgents.value.delete(key);
  }
}

async function fetchActivities() {
  loading.value = true;
  loadingAgentLogs.value = true;
  try {
    const [auditRes, agentRes, tierRes, errorRes, agentlogsRes] = await Promise.all([
      fetch(`${API_BASE}/logs?limit=200`),
      fetch(`${API_BASE}/logs/agent?limit=200`),
      fetch(`${API_BASE}/logs/tier?limit=200`),
      fetch(`${API_BASE}/logs/errors?limit=200`),
      fetch(`${API_BASE}/logs/agentlogs?limit=500`)
    ]);

    // --- Project Agent Logs (from agentlogs.md files) ---
    if (agentlogsRes.ok) {
      const data = await agentlogsRes.json();
      agentLogs.value = (data.logs || []).map((log: any) => ({
        agent: log.agent,
        tag: log.tag,
        timestamp: log.timestamp,
        context: log.context,
        description: log.description,
        raw: log.raw,
        projectId: log.projectId
      }));
    }

    // --- System Events (file changes, process events, tier, errors) ---
    const systemEvents: Activity[] = [];

    if (auditRes.ok) {
      const data = await auditRes.json();
      data.logs?.forEach((log: any) => {
        systemEvents.push({
          id: log.id,
          type: 'audit',
          timestamp: log.timestamp,
          message: `${log.action}: ${log.filePath}`,
          projectId: log.projectId,
          details: log.details
        });
      });
    }

    if (agentRes.ok) {
      const data = await agentRes.json();
      data.logs?.forEach((log: any) => {
        if (log.eventType === 'agent:heartbeat') return;
        systemEvents.push({
          id: log.id,
          type: 'agent',
          timestamp: log.timestamp,
          message: `${log.eventType}: ${log.agentName}`,
          agentName: log.agentName,
          projectId: log.projectId,
          details: log.details
        });
      });
    }

    if (tierRes.ok) {
      const data = await tierRes.json();
      data.logs?.forEach((log: any) => {
        systemEvents.push({
          id: log.id,
          type: 'tier',
          timestamp: log.timestamp,
          message: `Tier ${log.fromTier} → ${log.toTier}`,
          projectId: log.projectId,
          details: { fromTier: log.fromTier, toTier: log.toTier, trigger: log.trigger, approvedBy: log.approvedBy, ...log.details }
        });
      });
    }

    if (errorRes.ok) {
      const data = await errorRes.json();
      data.logs?.forEach((log: any) => {
        systemEvents.push({
          id: log.id,
          type: 'error',
          timestamp: log.timestamp,
          message: log.message,
          level: log.level,
          projectId: log.projectId,
          details: log.details
        });
      });
    }

    systemEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    activities.value = systemEvents;
  } catch (err) {
    console.error('Error fetching activities:', err);
    errorStore.showError('Failed to Load Activity Log', 'Unable to fetch activity data. Please try again.');
  } finally {
    loading.value = false;
    loadingAgentLogs.value = false;
  }
}

// WebSocket for real-time updates
let ws: WebSocket | null = null;

function connectWebSocket() {
  const wsUrl = `ws://${window.location.hostname}:3000`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[ActivityLog] WebSocket connected');
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (err) {
      console.error('[ActivityLog] Error parsing WebSocket message:', err);
    }
  };

  ws.onclose = () => {
    console.log('[ActivityLog] WebSocket disconnected, reconnecting...');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error('[ActivityLog] WebSocket error:', err);
  };
}

function handleWebSocketMessage(message: any) {
  switch (message.type) {
    case 'file:changed':
    case 'agent:spawned':
    case 'agent:exited':
    case 'tier:complete':
      setTimeout(() => {
        fetchActivities();
        fetchActiveAgents();
      }, 500);
      break;
    case 'agent:heartbeat':
      // Only refresh agent list on heartbeat — don't flood the activity log
      fetchActiveAgents();
      break;
  }
}

onMounted(() => {
  projectsStore.fetchProjects();
  fetchActiveAgents();
  fetchActivities();
  connectWebSocket();
});

onUnmounted(() => {
  if (ws) {
    ws.close();
  }
});
</script>

<style scoped>
.activity-log-view {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.activity-header {
  margin-bottom: 2rem;
}

.activity-header h1 {
  font-size: 1.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
}

.subtitle {
  color: var(--text-secondary);
  margin: 0;
}

/* Active Agents Section */
.active-agents-section {
  background: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.75rem;
  padding: 1.5rem;
  margin-bottom: 2rem;
}

.active-agents-section h2 {
  font-size: 1.25rem;
  color: var(--text-primary);
  margin: 0 0 1rem 0;
}

.active-agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.active-agent-card {
  background: var(--bg-highlight);
  border-radius: 0.5rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: relative;
  border-left: 4px solid var(--color-success);
}

.agent-status-indicator {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 8px;
  height: 8px;
  background: var(--color-success);
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.agent-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.agent-pid {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
}

.agent-lock-badge {
  font-family: inherit;
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-warning);
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.active-agent-card.from-lock {
  border-left-color: var(--color-warning);
}

.active-agent-card.from-lock .agent-status-indicator {
  background: var(--color-warning);
}

.agent-task {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.task-label {
  color: var(--text-secondary);
}

.task-project {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
}

.task-project:hover {
  text-decoration: underline;
}

.agent-expansions {
  font-size: 0.75rem;
  color: var(--color-primary);
}

.agent-uptime {
  font-size: 0.75rem;
  color: var(--text-secondary);
  display: flex;
  gap: 0.25rem;
}

.uptime-value {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
}

/* Filters Section */
.filters-section {
  background: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.75rem;
  padding: 1.5rem;
  margin-bottom: 2rem;
}

.filters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.filter-group label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 500;
}

.filter-group select {
  background: var(--bg-primary);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  outline: none;
}

.filter-group select:hover,
.filter-group select:focus {
  border-color: var(--color-primary);
}

.filters-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

.refresh-btn {
  padding: 0.5rem 1rem;
  background: var(--color-primary);
  border: none;
  border-radius: 0.375rem;
  color: white;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.clear-btn {
  padding: 0.5rem 1rem;
  background: transparent;
  border: 1px solid var(--bg-highlight);
  border-radius: 0.375rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-btn:hover {
  border-color: var(--text-secondary);
  color: var(--text-primary);
}

/* Activity Feed Section */
.activity-feed-section {
  background: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.75rem;
  padding: 1.5rem;
}

.feed-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.feed-header h2 {
  font-size: 1.25rem;
  color: var(--text-primary);
  margin: 0;
}

.activity-count {
  font-size: 0.875rem;
  color: var(--text-secondary);
  background: var(--bg-highlight);
  padding: 0.25rem 0.75rem;
  border-radius: 1rem;
}

/* System Events — compact list */
.activity-list {
  display: flex;
  flex-direction: column;
}

.activity-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid var(--bg-highlight);
  font-size: 0.8125rem;
  min-height: 0;
  cursor: default;
}

.activity-row:last-child {
  border-bottom: none;
}

.activity-row:hover {
  background: rgba(255, 255, 255, 0.02);
}

.activity-row.recency-fresh {
  background: rgba(16, 185, 129, 0.05);
}

.activity-row.recency-recent {
  background: rgba(245, 158, 11, 0.03);
}

.row-icon {
  flex-shrink: 0;
  font-size: 0.875rem;
  width: 18px;
  text-align: center;
}

.row-badge {
  flex-shrink: 0;
  font-size: 0.67rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.12rem 0.4rem;
  border-radius: 0.2rem;
  background: var(--bg-highlight);
  color: var(--text-secondary);
  white-space: nowrap;
}

.row-badge.audit  { color: #60a5fa; background: rgba(59, 130, 246, 0.12); }
.row-badge.agent  { color: #a78bfa; background: rgba(139, 92, 246, 0.12); }
.row-badge.tier   { color: #34d399; background: rgba(16, 185, 129, 0.12); }
.row-badge.error  { color: #f87171; background: rgba(239, 68, 68, 0.12); }

.row-message {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.84rem;
}

.row-project-badge {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0.12rem 0.45rem;
  border-radius: 0.25rem;
}

/* Project badge colour palette — index assigned by hash of projectId */
.proj-color-0 { background: rgba(99,  102, 241, 0.15); color: #818cf8; }
.proj-color-1 { background: rgba(16,  185, 129, 0.15); color: #34d399; }
.proj-color-2 { background: rgba(245, 158,  11, 0.15); color: #fbbf24; }
.proj-color-3 { background: rgba(239,  68,  68, 0.15); color: #f87171; }
.proj-color-4 { background: rgba(14,  165, 233, 0.15); color: #38bdf8; }
.proj-color-5 { background: rgba(167, 139, 250, 0.15); color: #c4b5fd; }
.proj-color-6 { background: rgba(20,  184, 166, 0.15); color: #2dd4bf; }
.proj-color-7 { background: rgba(249, 115,  22, 0.15); color: #fb923c; }

.row-project-badge:hover {
  filter: brightness(1.2);
}

.row-time {
  flex-shrink: 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
}

/* System events pagination */
.sys-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border-top: 1px solid var(--bg-highlight);
}

.sys-page-btn {
  padding: 0.3rem 0.75rem;
  background: var(--bg-highlight);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.3rem;
  color: var(--text-primary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}

.sys-page-btn:hover:not(:disabled) {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.sys-page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.sys-page-info {
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  min-width: 60px;
  text-align: center;
}

/* Loading & Empty States */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  gap: 1rem;
  color: var(--text-secondary);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--bg-highlight);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--text-secondary);
}

/* Agent Actions */
.agent-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--bg-surface);
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ping-btn {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--bg-highlight);
}

.ping-btn:hover:not(:disabled) {
  background: var(--bg-highlight);
  border-color: var(--color-primary);
}

.terminate-btn {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.terminate-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  border-color: #ef4444;
}

.force-kill-btn {
  background: rgba(220, 38, 38, 0.15);
  color: #dc2626;
  border: 1px solid rgba(220, 38, 38, 0.35);
  font-weight: 600;
}

.force-kill-btn:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.3);
  border-color: #dc2626;
}

/* Ping Response */
.ping-response {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border-radius: 0.375rem;
  background: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ping-response.alive {
  border-color: var(--color-success);
  background: rgba(16, 185, 129, 0.1);
}

.ping-response.dead {
  border-color: var(--color-error);
  background: rgba(239, 68, 68, 0.1);
}

.ping-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.ping-status-text {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
  flex: 1;
}

.ping-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
}

.ping-close:hover {
  background: var(--bg-highlight);
  color: var(--text-primary);
}

.ping-details {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.ping-detail {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.ping-label {
  color: var(--text-secondary);
}

.ping-value {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
}

/* Terminating state */
.active-agent-card.terminating {
  opacity: 0.6;
  border-left-color: var(--color-error);
}

.active-agent-card.terminating .agent-status-indicator {
  background: var(--color-error);
  animation: none;
}

/* Confirmation Dialog */
.confirm-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.confirm-dialog {
  background: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.75rem;
  padding: 1.5rem;
  max-width: 400px;
  width: 90%;
  animation: scaleIn 0.2s ease-out;
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.confirm-dialog-header h3 {
  margin: 0 0 0.75rem 0;
  color: var(--text-primary);
  font-size: 1.125rem;
}

.confirm-dialog-body p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.5;
}

.confirm-dialog-footer {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
  justify-content: flex-end;
}

.btn-cancel,
.btn-confirm {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: var(--bg-highlight);
  color: var(--text-secondary);
}

.btn-cancel:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.btn-confirm {
  background: #ef4444;
  color: white;
}

.btn-confirm:hover {
  background: #dc2626;
}

/* Responsive */
@media (max-width: 768px) {
  .activity-log-view {
    padding: 1rem;
  }

  .filters-grid {
    grid-template-columns: 1fr;
  }

  .filters-actions {
    flex-direction: column;
  }

  .refresh-btn,
  .clear-btn {
    width: 100%;
  }

  .active-agents-grid {
    grid-template-columns: 1fr;
  }

  .agent-actions {
    flex-direction: column;
  }

  .action-btn {
    width: 100%;
  }

  .confirm-dialog-footer {
    flex-direction: column;
  }

  .btn-cancel,
  .btn-confirm {
    width: 100%;
  }

  .row-message {
    max-width: 160px;
  }

  .row-project-badge {
    display: none;
  }
}
</style>
