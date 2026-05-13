<template>
  <div class="agents-view">
    <header class="agents-header">
      <h1>🤖 Agents</h1>
      <p class="subtitle">Available AI agents with configurable expansions</p>
    </header>

    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading agents...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-state">
      <p class="error-message">{{ error }}</p>
      <button class="retry-btn" @click="fetchAgents">Retry</button>
    </div>

    <!-- Agents List -->
    <div v-else class="agents-list">
      <div v-for="agent in agents" :key="agent.id" class="agent-card">
        <!-- Left: agent identity -->
        <div class="agent-left">
          <div class="agent-avatar">
            <img
              v-if="agentHasImage[agent.id]"
              :src="`/api/agents/image/${agent.id}.png`"
              :alt="agent.name"
              class="agent-image"
              @error="agentHasImage[agent.id] = false"
            />
            <div v-else class="agent-avatar-fallback">
              {{ agent.name.charAt(0).toUpperCase() }}
            </div>
          </div>
          <div class="agent-body">
            <div class="agent-title-row">
              <h3 class="agent-name">{{ agent.name }}</h3>
              <span class="badge" :class="isAgentRunning(agent.id) ? 'status-active' : 'status-idle'">
                {{ isAgentRunning(agent.id) ? 'Active' : 'Idle' }}
              </span>
            </div>
            <p class="agent-description">{{ agent.description }}</p>
            <div v-if="agent.tools.length > 0" class="tool-list">
              <span v-for="tool in agent.tools" :key="tool" class="tool-tag">{{ tool }}</span>
            </div>
          </div>
        </div>

        <!-- Right: recent activity -->
        <div class="agent-recent">
          <p class="recent-label">Recent Activity</p>
          <div v-if="getAgentLogs(agent.id).length === 0" class="recent-empty">No activity yet</div>
          <div v-else class="recent-list">
            <div
              v-for="entry in getAgentLogs(agent.id)"
              :key="entry.id"
              class="recent-entry"
              :class="'tag-' + (entry.details?.tag || 'info').toLowerCase()"
            >
              <span class="recent-tag">{{ entry.details?.tag || entry.eventType }}</span>
              <span class="recent-desc">{{ entry.details?.description }}</span>
              <span class="recent-meta">
                <span class="recent-project">{{ entry.projectId }}</span>
                <span class="recent-time">{{ formatRelativeTime(entry.timestamp) }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Running Agents Section -->
    <div v-if="runningAgents.length > 0" class="running-agents">
      <h2>🟢 Running Processes</h2>
      <div class="running-list">
        <div v-for="agent in runningAgents" :key="agent.pid" class="running-card">
          <div class="running-info">
            <span class="running-name">{{ agent.name }}</span>
            <span class="running-pid">PID: {{ agent.pid }}</span>
          </div>
          <div v-if="agent.expansions && agent.expansions.length > 0" class="running-expansions">
            <span class="expansions-indicator" title="Active expansions">✨ {{ agent.expansions.length }}</span>
          </div>
          <button class="kill-btn" @click="openKillModal(agent)">
            Stop
          </button>
        </div>
      </div>
    </div>

    <!-- Kill Agent Confirmation Modal -->
    <KillAgentModal
      v-if="showKillModal && agentToKill"
      :agent-pid="agentToKill.pid"
      :agent-name="agentToKill.name"
      :spawned-at="agentToKill.spawnedAt"
      :expansions="agentToKill.expansions"
      @close="closeKillModal"
      @confirmed="onKillConfirmed"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import KillAgentModal from '../components/KillAgentModal.vue';
import { useErrorStore } from '../stores/errors';

interface Agent {
  id: string;
  name: string;
  description: string;
  tools: string[];
  availableExpansions: string[];
  allExpansions: string[];
  allSkills: string[];
}

interface RunningAgent {
  id?: string;
  pid: number;
  name: string;
  spawnedAt: string;
  expansions?: string[];
}

interface LogEntry {
  id: string;
  timestamp: string;
  eventType: string;
  pid: number;
  agentName: string;
  projectId: string;
  details?: { tag?: string; description?: string; context?: string };
}

const agents = ref<Agent[]>([]);
const runningAgents = ref<RunningAgent[]>([]);
const allAgentLogs = ref<LogEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const showKillModal = ref(false);
const agentToKill = ref<RunningAgent | null>(null);
const agentHasImage = ref<Record<string, boolean>>({});

function normalizeAgentName(name: string): string {
  return name.replace(/^AGENT\s+/i, '').toLowerCase().trim();
}

function getAgentLogs(agentId: string): LogEntry[] {
  const matched = allAgentLogs.value
    .filter(l => normalizeAgentName(l.agentName || '') === agentId.toLowerCase())
    .filter(l => l.details?.description);
  return matched.slice(-4).reverse();
}

function isAgentRunning(agentId: string): boolean {
  const agent = agents.value.find(a => a.id === agentId);
  if (!agent) return false;
  return runningAgents.value.some(ra => ra.name.toLowerCase() === agent.name.toLowerCase());
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}


async function fetchAgents() {
  loading.value = true;
  error.value = null;
  const errorStore = useErrorStore();

  try {
    const response = await fetch('/api/agents');
    if (!response.ok) {
      await errorStore.handleApiError(response, 'Failed to Load Agents');
      throw new Error(`Failed to fetch agents: ${response.statusText}`);
    }
    const data = await response.json();
    agents.value = data;
    data.forEach((agent: Agent) => {
      if (agentHasImage.value[agent.id] === undefined) {
        agentHasImage.value[agent.id] = true;
      }
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load agents';
    console.error('Error fetching agents:', err);
    if (err instanceof Error && err.message.includes('Failed to fetch')) {
      useErrorStore().showError('Connection Error', 'Unable to connect to the server. Please check your connection and try again.');
    }
  } finally {
    loading.value = false;
  }
}

async function fetchRunningAgents() {
  try {
    const response = await fetch('/api/agents/status/running');
    if (response.ok) {
      const data = await response.json();
      runningAgents.value = data.agents;
    }
  } catch (err) {
    console.error('Error fetching running agents:', err);
  }
}

async function fetchAgentLogs() {
  try {
    const response = await fetch('/api/logs/agent?limit=500');
    if (response.ok) {
      const data = await response.json();
      allAgentLogs.value = data.logs || [];
    }
  } catch (err) {
    console.error('Error fetching agent logs:', err);
  }
}

function openKillModal(agent: RunningAgent) {
  agentToKill.value = agent;
  showKillModal.value = true;
}

function closeKillModal() {
  showKillModal.value = false;
  agentToKill.value = null;
}

async function onKillConfirmed() {
  await fetchRunningAgents();
  closeKillModal();
}

let ws: WebSocket | null = null;

function connectWebSocket() {
  const wsUrl = `ws://${window.location.hostname}:3000`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => console.log('[Agents] WebSocket connected');

  ws.onmessage = (event) => {
    try {
      handleWebSocketMessage(JSON.parse(event.data));
    } catch (err) {
      console.error('[Agents] Error parsing WebSocket message:', err);
    }
  };

  ws.onclose = () => {
    console.log('[Agents] WebSocket disconnected, reconnecting...');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => console.error('[Agents] WebSocket error:', err);
}

function handleWebSocketMessage(message: any) {
  switch (message.type) {
    case 'agent:spawned':
    case 'agent:exited':
      fetchRunningAgents();
      fetchAgentLogs();
      break;
    case 'expansion:loaded':
      fetchAgents();
      break;
    case 'log:updated':
      fetchAgentLogs();
      break;
  }
}

let runningAgentsInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  fetchAgents();
  fetchRunningAgents();
  fetchAgentLogs();
  connectWebSocket();
  runningAgentsInterval = setInterval(fetchRunningAgents, 5000);
});

onUnmounted(() => {
  ws?.close();
  if (runningAgentsInterval) clearInterval(runningAgentsInterval);
});
</script>

<style scoped>
.agents-view {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.agents-header {
  margin-bottom: 1.75rem;
}

.agents-header h1 {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 1rem;
  margin: 0;
}

/* Loading & Error */
.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  gap: 1rem;
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

.error-message { color: var(--color-error); }

.retry-btn {
  padding: 0.5rem 1.5rem;
  background-color: var(--color-primary);
  color: white;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
}

/* Agents List */
.agents-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 2rem;
}

.agent-card {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.875rem;
  overflow: hidden;
  transition: border-color 0.15s ease;
}

.agent-card:hover {
  border-color: var(--color-primary);
}

/* Left panel */
.agent-left {
  display: flex;
  align-items: flex-start;
  gap: 1.25rem;
  padding: 1.5rem;
  border-right: 1px solid var(--bg-highlight);
}

.agent-avatar {
  flex-shrink: 0;
}

.agent-image {
  width: 88px;
  height: 88px;
  border-radius: 0.75rem;
  object-fit: cover;
  border: 1px solid var(--bg-highlight);
  display: block;
}

.agent-avatar-fallback {
  width: 88px;
  height: 88px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, var(--bg-highlight), var(--bg-surface));
  border: 1px solid var(--bg-highlight);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-secondary);
}

.agent-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.agent-title-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.agent-name {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  text-transform: capitalize;
}

.badge {
  font-size: 0.6875rem;
  padding: 0.2rem 0.5rem;
  border-radius: 0.25rem;
  font-weight: 500;
  flex-shrink: 0;
}

.status-idle {
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
}

.status-active {
  background-color: rgba(34, 197, 94, 0.15);
  color: var(--color-success);
}

.agent-description {
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.55;
  margin: 0;
}

.tool-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.tool-tag {
  font-size: 0.6875rem;
  padding: 0.175rem 0.45rem;
  border-radius: 0.25rem;
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
}

/* Right panel: recent activity */
.agent-recent {
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}

.recent-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-secondary);
  margin: 0 0 0.25rem 0;
}

.recent-empty {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  opacity: 0.6;
  padding: 0.5rem 0;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.recent-entry {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  border-radius: 0.375rem;
  background-color: var(--bg-highlight);
  border-left: 2px solid transparent;
  font-size: 0.8125rem;
}

.recent-entry.tag-completed { border-left-color: var(--color-success); }
.recent-entry.tag-started   { border-left-color: var(--color-primary); }
.recent-entry.tag-error     { border-left-color: var(--color-error); }
.recent-entry.tag-decision  { border-left-color: #f59e0b; }
.recent-entry.tag-progress  { border-left-color: #8b5cf6; }

.recent-tag {
  grid-column: 1;
  grid-row: 1;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  white-space: nowrap;
  padding-top: 0.1rem;
}

.recent-desc {
  grid-column: 2;
  grid-row: 1;
  color: var(--text-primary);
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.recent-meta {
  grid-column: 1 / -1;
  grid-row: 2;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.recent-project {
  font-size: 0.6875rem;
  color: var(--color-primary);
  opacity: 0.8;
}

.recent-time {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  margin-left: auto;
}

/* Running Agents Section */
.running-agents {
  margin-top: 2.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--bg-highlight);
}

.running-agents h2 {
  font-size: 1.25rem;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.running-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.running-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background-color: var(--bg-surface);
  border-radius: 0.5rem;
  border-left: 4px solid var(--color-success);
}

.running-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.running-name {
  font-weight: 600;
  color: var(--text-primary);
}

.running-pid {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
}

.running-expansions {
  display: flex;
  align-items: center;
}

.expansions-indicator {
  font-size: 0.875rem;
  color: var(--color-primary);
}

.kill-btn {
  padding: 0.5rem 1rem;
  background-color: transparent;
  color: var(--color-error);
  border: 1px solid var(--color-error);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.kill-btn:hover {
  background-color: var(--color-error);
  color: white;
}

/* Responsive */
@media (max-width: 900px) {
  .agent-card {
    grid-template-columns: 1fr;
  }

  .agent-left {
    border-right: none;
    border-bottom: 1px solid var(--bg-highlight);
  }
}

@media (max-width: 600px) {
  .agents-view { padding: 1rem; }
  .agent-left { gap: 1rem; }
  .agent-image, .agent-avatar-fallback { width: 64px; height: 64px; }
  .running-card { flex-wrap: wrap; }
}
</style>
