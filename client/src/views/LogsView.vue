<template>
  <div class="logs-view">
    <header class="logs-header">
      <h1>System Logs</h1>
      <div class="tabs">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'agent-logs' }"
          @click="activeTab = 'agent-logs'"
          data-testid="agent-logs-tab"
        >
          Agent Logs
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'server-logs' }"
          @click="activeTab = 'server-logs'"
          data-testid="server-logs-tab"
        >
          Server Logs
        </button>
      </div>
    </header>

    <!-- Agent Logs Tab Content -->
    <div v-if="activeTab === 'agent-logs'" class="logs-content">
      <AgentLogsTable
        :logs="agentLogs"
        :loading="loadingAgentLogs"
        @refresh="fetchAgentLogs"
      />
    </div>

    <!-- Server Logs Tab Content -->
    <div v-else-if="activeTab === 'server-logs'" class="logs-content">
      <!-- Stats Cards -->
      <div class="stats-cards">
        <div class="stat-card">
          <span class="stat-value">{{ serverLogStats.total }}</span>
          <span class="stat-label">Total Entries</span>
        </div>
        <div class="stat-card created">
          <span class="stat-value">{{ serverLogStats.created || 0 }}</span>
          <span class="stat-label">Created</span>
        </div>
        <div class="stat-card modified">
          <span class="stat-value">{{ serverLogStats.modified || 0 }}</span>
          <span class="stat-label">Modified</span>
        </div>
        <div class="stat-card deleted">
          <span class="stat-value">{{ serverLogStats.deleted || 0 }}</span>
          <span class="stat-label">Deleted</span>
        </div>
      </div>

      <!-- Filters -->
      <div class="filters">
        <div class="filter-group">
          <label>Action</label>
          <select v-model="filters.action" @change="fetchServerLogs">
            <option value="">All Actions</option>
            <option value="created">Created</option>
            <option value="modified">Modified</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>
        <button class="refresh-btn" @click="fetchServerLogs" :disabled="loading">
          <span v-if="loading">Loading...</span>
          <span v-else>Refresh</span>
        </button>
      </div>

      <!-- Server Logs Table -->
      <div class="logs-table-container">
        <table v-if="serverLogs.length > 0" class="logs-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>File Type</th>
              <th>File Path</th>
              <th>Project</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in serverLogs" :key="log.id" :class="['log-row', log.action]">
              <td class="timestamp">{{ formatTimestamp(log.timestamp) }}</td>
              <td class="action">
                <span :class="['action-badge', log.action]">{{ log.action }}</span>
              </td>
              <td class="file-type">{{ log.fileType }}</td>
              <td class="file-path" :title="log.filePath">{{ log.filePath.split('/').pop() }}</td>
              <td class="project">{{ log.projectId || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="no-logs">
          <p v-if="loading">Loading server logs...</p>
          <p v-else>No server logs found</p>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useErrorStore } from '../stores/errors';
import AgentLogsTable from '../components/AgentLogsTable.vue';

const errorStore = useErrorStore();

// Tab state
const activeTab = ref<'agent-logs' | 'server-logs'>('agent-logs');

interface ServerLogEntry {
  id: string;
  timestamp: string;
  action: 'created' | 'modified' | 'deleted';
  filePath: string;
  fileType: string;
  projectId?: string;
}

interface ServerLogStats {
  total: number;
  created: number;
  modified: number;
  deleted: number;
}

const API_BASE = 'http://localhost:3000/api';

const serverLogs = ref<ServerLogEntry[]>([]);
const serverLogStats = ref<ServerLogStats>({
  total: 0,
  created: 0,
  modified: 0,
  deleted: 0
});
const loading = ref(false);

// Agent logs state
interface AgentLogEntry {
  agent: string;
  tag: string;
  timestamp: string;
  context: string;
  description: string;
  raw: string;
  projectId?: string;
  projectName?: string;
}

const agentLogs = ref<AgentLogEntry[]>([]);
const loadingAgentLogs = ref(false);

const filters = reactive({
  action: ''
});

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

async function fetchServerLogs() {
  loading.value = true;
  const errorStore = useErrorStore();
  try {
    const params = new URLSearchParams();
    if (filters.action) params.append('action', filters.action);
    params.append('limit', '100');

    const response = await fetch(`${API_BASE}/logs?${params}`);
    if (response.ok) {
      const data = await response.json();
      serverLogs.value = data.logs || [];
      serverLogStats.value = data.stats || { total: 0, created: 0, modified: 0, deleted: 0 };
    } else {
      await errorStore.handleApiError(response, 'Failed to Load Server Logs');
    }
  } catch (err) {
    console.error('Failed to fetch server logs:', err);
    // Show toast for network errors
    if (err instanceof Error && err.message.includes('Failed to fetch')) {
      errorStore.showError(
        'Connection Error',
        'Unable to connect to the server. Please check your connection and try again.'
      );
    }
  } finally {
    loading.value = false;
  }
}

async function fetchAgentLogs() {
  loadingAgentLogs.value = true;
  try {
    const response = await fetch(`${API_BASE}/logs/agent?limit=100`);
    if (response.ok) {
      const data = await response.json();
      agentLogs.value = data.logs?.map((log: any) => ({
        agent: log.agentName || 'Unknown',
        tag: log.eventType?.toUpperCase() || 'INFO',
        timestamp: log.timestamp,
        context: log.context || log.projectId || 'General',
        description: log.message || log.details?.message || JSON.stringify(log.details),
        raw: JSON.stringify(log),
        projectId: log.projectId,
        projectName: log.projectName
      })) || [];
    } else {
      await errorStore.handleApiError(response, 'Failed to Load Agent Logs');
    }
  } catch (err) {
    console.error('Failed to fetch agent logs:', err);
    if (err instanceof Error && err.message.includes('Failed to fetch')) {
      errorStore.showError(
        'Connection Error',
        'Unable to connect to the server. Please check your connection and try again.'
      );
    }
  } finally {
    loadingAgentLogs.value = false;
  }
}

onMounted(() => {
  fetchServerLogs();
  fetchAgentLogs();
});
</script>

<style scoped>
.logs-view {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.logs-header {
  margin-bottom: 2rem;
}

.logs-header h1 {
  margin: 0 0 1.5rem 0;
  color: #f1f5f9;
  font-size: 1.875rem;
  font-weight: 600;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  background: #12121a;
  border: 1px solid #1a1a24;
  border-radius: 0.5rem;
  padding: 1rem;
  text-align: center;
}

.stat-card.error {
  border-color: #ef4444;
}

.stat-card.warning {
  border-color: #f59e0b;
}

.stat-card.critical {
  border-color: #dc2626;
}

.stat-card.created {
  border-color: #10b981;
}

.stat-card.modified {
  border-color: #6366f1;
}

.stat-card.deleted {
  border-color: #ef4444;
}

.stat-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 600;
  color: #f1f5f9;
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.75rem;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.logs-content {
  background: #12121a;
  border: 1px solid #1a1a24;
  border-radius: 0.5rem;
  padding: 1.5rem;
}

.filters {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  align-items: flex-end;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.filter-group label {
  font-size: 0.75rem;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.filter-group select {
  background: #0a0a0f;
  border: 1px solid #1a1a24;
  border-radius: 0.375rem;
  padding: 0.5rem 1rem;
  color: #f1f5f9;
  font-size: 0.875rem;
  cursor: pointer;
  min-width: 140px;
}

.filter-group select:hover {
  border-color: #6366f1;
}

.filter-group select:focus {
  outline: none;
  border-color: #6366f1;
}

.refresh-btn {
  background: #6366f1;
  border: none;
  border-radius: 0.375rem;
  padding: 0.5rem 1rem;
  color: white;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.2s;
  margin-left: auto;
}

.refresh-btn:hover:not(:disabled) {
  background: #818cf8;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.logs-table-container {
  overflow-x: auto;
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.logs-table th {
  text-align: left;
  padding: 0.75rem;
  color: #94a3b8;
  font-weight: 500;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #1a1a24;
}

.logs-table td {
  padding: 0.75rem;
  border-bottom: 1px solid #1a1a24;
  vertical-align: top;
}

.log-row:hover {
  background: #1a1a24;
}

.timestamp {
  color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  white-space: nowrap;
}

.level-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
}

.level-badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.level-badge.warning {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.level-badge.critical {
  background: rgba(220, 38, 38, 0.2);
  color: #dc2626;
}

.action-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
}

.action-badge.created {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.action-badge.modified {
  background: rgba(99, 102, 241, 0.2);
  color: #6366f1;
}

.action-badge.deleted {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.file-type {
  color: #94a3b8;
  text-transform: uppercase;
  font-size: 0.75rem;
}

.file-path {
  color: #6366f1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-details {
  margin-top: 0.5rem;
}

.log-details details {
  color: #94a3b8;
}

.log-details summary {
  cursor: pointer;
  font-size: 0.75rem;
}

.log-details summary:hover {
  color: #6366f1;
}

.log-details pre {
  background: #0a0a0f;
  padding: 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  overflow-x: auto;
  margin-top: 0.5rem;
  color: #94a3b8;
}

.source {
  color: #94a3b8;
  text-transform: uppercase;
  font-size: 0.75rem;
}

.code {
  color: #6366f1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
}

.message {
  color: #f1f5f9;
  max-width: 400px;
}

.message-text {
  margin-bottom: 0.5rem;
}

.stack-trace {
  margin-top: 0.5rem;
}

.stack-trace details {
  color: #94a3b8;
}

.stack-trace summary {
  cursor: pointer;
  font-size: 0.75rem;
}

.stack-trace summary:hover {
  color: #6366f1;
}

.stack-trace pre {
  background: #0a0a0f;
  padding: 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  overflow-x: auto;
  margin-top: 0.5rem;
  color: #94a3b8;
}

.project {
  color: #94a3b8;
  font-size: 0.75rem;
}

.no-logs {
  text-align: center;
  padding: 3rem;
  color: #94a3b8;
}

@media (max-width: 768px) {
  .logs-view {
    padding: 1rem;
  }

  .filters {
    flex-direction: column;
  }

  .refresh-btn {
    margin-left: 0;
    width: 100%;
  }

  .logs-table {
    font-size: 0.75rem;
  }

  .logs-table th,
  .logs-table td {
    padding: 0.5rem;
  }
}

/* Tabs */
.tabs {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.tab-btn {
  padding: 0.5rem 1.25rem;
  background: transparent;
  border: 1px solid #1a1a24;
  border-radius: 0.375rem;
  color: #94a3b8;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  border-color: #6366f1;
  color: #f1f5f9;
}

.tab-btn.active {
  background: #6366f1;
  border-color: #6366f1;
  color: white;
}

</style>
