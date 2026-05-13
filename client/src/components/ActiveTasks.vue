<template>
  <div class="runtime-status-section">
    <div class="section-header">
      <h3 class="section-title">
        <span class="title-icon">⚡</span>
        Active Executions
      </h3>
      <span v-if="activeExecutions.length > 0" class="execution-count">
        {{ activeExecutions.length }} running
      </span>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <div class="spinner-small"></div>
      <span>Loading...</span>
    </div>

    <!-- Active Executions List -->
    <div v-else-if="activeExecutions.length > 0" class="executions-list">
      <div
        v-for="execution in activeExecutions"
        :key="execution.taskId"
        class="execution-item"
        :class="execution.statusClass"
      >
        <div class="execution-info">
          <div class="execution-main">
            <span class="status-indicator" :class="execution.statusClass" :title="execution.statusLabel">
              {{ execution.statusIcon }}
            </span>
            <span class="task-badge">{{ execution.taskTitle || execution.taskId }}</span>
            <span v-if="execution.taskTitle && execution.taskId !== execution.taskTitle" class="task-id-sub">{{ execution.taskId }}</span>
            <span v-if="execution.agent" class="agent-badge">
              <span class="agent-icon">🤖</span>
              {{ formatAgentName(execution.agent) }}
            </span>
          </div>
          <div class="execution-meta">
            <span class="project-name" v-if="execution.projectName">
              📁 {{ execution.projectName }}
            </span>
            <span class="tier-badge" :class="`tier-${execution.tier}`">
              Tier {{ execution.tier }}
            </span>
            <span class="time-remaining" :class="execution.statusClass">
              <span class="time-icon">⏱</span>
              {{ execution.timeDisplay }}
            </span>
            <span v-if="execution.status === 'stale'" class="stale-badge">Stale</span>
            <span v-if="execution.status === 'dead'" class="dead-badge">Dead Lock</span>
            <span v-if="execution.status === 'unknown'" class="unknown-badge">Unknown</span>
          </div>
        </div>

        <div class="execution-actions">
          <!-- Resume Button (noop for now) -->
          <button
            class="action-btn resume"
            :disabled="resumingTaskId === execution.taskId"
            title="Resume task execution (coming soon)"
            @click="onResume(execution.taskId)"
          >
            <span v-if="resumingTaskId === execution.taskId" class="btn-spinner-small"></span>
            <span v-else class="btn-icon">▶</span>
            <span class="btn-label">Resume</span>
          </button>

          <!-- Force Unlock Button -->
          <button
            class="action-btn unlock"
            :disabled="unlockingTaskId === execution.taskId"
            title="Force unlock - removes lock file and resets task status"
            @click="onUnlock(execution.taskId, execution.projectId)"
          >
            <span v-if="unlockingTaskId === execution.taskId" class="btn-spinner-small"></span>
            <span v-else class="btn-icon">🔓</span>
            <span class="btn-label">Force Unlock</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <span class="empty-icon">💤</span>
      <p class="empty-text">No active executions</p>
      <p class="empty-hint">Running tasks will appear here</p>
    </div>

    <!-- Error Message -->
    <div v-if="error" class="error-message">
      <span class="error-icon">⚠️</span>
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import type { Task } from '../stores/projects';

interface ActiveExecution {
  taskId: string;
  taskTitle?: string;
  agent?: string;
  projectId: string;
  projectName: string;
  tier: number;
  lockedAt?: string;
  reclaimAfter?: string;
  elapsedMs: number;
  remainingMs: number;
  status: 'active' | 'stale' | 'dead' | 'unknown';
  statusClass: string;
  statusIcon: string;
  statusLabel: string;
  timeDisplay: string;
}

interface Props {
  projectId?: string; // If provided, only show tasks for this project
  tasks?: Task[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'unlock', taskId: string, projectId: string): void;
}>();

const activeExecutions = ref<ActiveExecution[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const resumingTaskId = ref<string | null>(null);
const unlockingTaskId = ref<string | null>(null);
const refreshInterval = ref<number | null>(null);

// Thresholds for status calculation (in milliseconds)
const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

function calculateStatus(remainingMs: number): { status: ActiveExecution['status']; statusClass: string; statusIcon: string; statusLabel: string } {
  if (remainingMs > STALE_THRESHOLD) {
    return { status: 'active', statusClass: 'active', statusIcon: '🟢', statusLabel: 'Active' };
  } else if (remainingMs > 0) {
    return { status: 'stale', statusClass: 'stale', statusIcon: '🟡', statusLabel: 'Stale' };
  } else {
    return { status: 'dead', statusClass: 'dead', statusIcon: '🔴', statusLabel: 'Dead Lock' };
  }
}

function formatTimeDisplay(remainingMs: number): string {
  const absMs = Math.abs(remainingMs);
  const minutes = Math.floor(absMs / (60 * 1000));
  const seconds = Math.floor((absMs % (60 * 1000)) / 1000);
  
  if (remainingMs > 0) {
    // Time remaining
    if (minutes > 0) {
      return `${minutes} min remaining`;
    } else {
      return `${seconds}s remaining`;
    }
  } else {
    // Time expired
    if (minutes > 0) {
      return `expired ${minutes} min ago`;
    } else {
      return `expired ${seconds}s ago`;
    }
  }
}

function formatAgentName(agentId: string): string {
  return agentId
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

async function fetchActiveExecutions() {
  try {
    const now = Date.now();
    const merged: ActiveExecution[] = [];

    // Fetch all projects to find in_progress tasks with lock state
    const projectsResponse = await fetch('/api/projects');
    if (!projectsResponse.ok) {
      throw new Error('Failed to fetch projects');
    }
    const projects = await projectsResponse.json();

    // Find all tasks with status === 'in_progress' AND locked_by
    for (const project of projects) {
      // If projectId is specified, filter to that project only
      if (props.projectId && project.id !== props.projectId) {
        continue;
      }

      for (const task of project.tasks || []) {
        if (task.status === 'in_progress' && task.locked_by) {
          // Calculate remaining time based on reclaim_after
          let remainingMs = 0;
          let statusInfo;
          
          if (task.reclaim_after) {
            const reclaimTime = new Date(task.reclaim_after).getTime();
            remainingMs = reclaimTime - now;
            statusInfo = calculateStatus(remainingMs);
          } else {
            // No reclaim_after - unknown status
            statusInfo = { 
              status: 'unknown' as const, 
              statusClass: 'unknown', 
              statusIcon: '⚪', 
              statusLabel: 'Unknown - no heartbeat data' 
            };
          }

          merged.push({
            taskId: task.id,
            taskTitle: task.title,
            agent: task.locked_by,
            projectId: project.id,
            projectName: project.name,
            tier: task.tier || 0,
            lockedAt: task.locked_at,
            reclaimAfter: task.reclaim_after,
            elapsedMs: task.locked_at ? now - new Date(task.locked_at).getTime() : 0,
            remainingMs,
            ...statusInfo,
            timeDisplay: task.reclaim_after ? formatTimeDisplay(remainingMs) : 'no heartbeat data'
          });
        }
      }
    }

    // Sort by status (dead first, then stale, then active) then by project
    merged.sort((a, b) => {
      const statusOrder = { dead: 0, stale: 1, unknown: 2, active: 3 };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.projectName.localeCompare(b.projectName);
    });

    activeExecutions.value = merged;
    error.value = null;
  } catch (err) {
    console.error('[ActiveTasks] Error fetching executions:', err);
    if (!loading.value) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch active executions';
    }
  }
}

async function onResume(taskId: string) {
  console.log(`[ActiveTasks] Resume clicked for task ${taskId} (noop)`);
  resumingTaskId.value = taskId;
  await new Promise(resolve => setTimeout(resolve, 500));
  resumingTaskId.value = null;
}

async function onUnlock(taskId: string, projectId: string) {
  if (!confirm(`Force unlock task "${taskId}"?\n\nThis will remove the lock file and reset the task status to pending. Only do this if the task is truly stuck.`)) {
    return;
  }

  unlockingTaskId.value = taskId;
  error.value = null;

  try {
    const response = await fetch(
      `/api/projects/${projectId}/tasks/${taskId}/unlock`,
      { method: 'POST' }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Failed to unlock task: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`[ActiveTasks] Task unlocked: ${taskId}`, result);

    // Remove from local list immediately for responsive UI
    activeExecutions.value = activeExecutions.value.filter(e => e.taskId !== taskId);

    // Emit event for parent to refresh project data
    emit('unlock', taskId, projectId);

    // Refresh to ensure sync
    await fetchActiveExecutions();
  } catch (err) {
    console.error('[ActiveTasks] Error unlocking task:', err);
    error.value = err instanceof Error ? err.message : 'Failed to unlock task';
  } finally {
    unlockingTaskId.value = null;
  }
}

function startAutoRefresh() {
  // Refresh every 30 seconds to match heartbeat interval
  refreshInterval.value = window.setInterval(() => {
    fetchActiveExecutions();
  }, 30000);
}

function stopAutoRefresh() {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
    refreshInterval.value = null;
  }
}

onMounted(async () => {
  loading.value = true;
  await fetchActiveExecutions();
  loading.value = false;
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
});
</script>

<style scoped>
.runtime-status-section {
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  padding: 1.5rem;
  margin-bottom: 2rem;
  border: 1px solid var(--bg-highlight);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.title-icon {
  font-size: 1.125rem;
}

.execution-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-primary);
  background-color: rgba(99, 102, 241, 0.15);
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid var(--bg-highlight);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.executions-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.execution-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  background-color: var(--bg-highlight);
  border-radius: 0.5rem;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.execution-item:hover {
  border-color: var(--color-primary);
}

.execution-item.stale {
  border-color: rgba(245, 158, 11, 0.3);
  background-color: rgba(245, 158, 11, 0.05);
}

.execution-item.dead {
  border-color: rgba(239, 68, 68, 0.3);
  background-color: rgba(239, 68, 68, 0.05);
}

.execution-item.unknown {
  border-color: rgba(156, 163, 175, 0.3);
  background-color: rgba(156, 163, 175, 0.05);
}

.execution-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}

.execution-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.status-indicator {
  font-size: 0.75rem;
  line-height: 1;
}

.task-badge {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  background-color: rgba(99, 102, 241, 0.15);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
}

.task-id-sub {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.7rem;
  color: var(--text-secondary);
  opacity: 0.7;
}

.agent-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-primary);
  background-color: rgba(99, 102, 241, 0.1);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
}

.agent-icon {
  font-size: 0.75rem;
}

.execution-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.project-name {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background-color: rgba(99, 102, 241, 0.08);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.tier-badge {
  font-size: 0.625rem;
  font-weight: 600;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  background-color: var(--bg-surface);
  color: var(--text-secondary);
}

.tier-badge.tier-0 { color: #94a3b8; }
.tier-badge.tier-1 { color: #60a5fa; }
.tier-badge.tier-2 { color: #a78bfa; }
.tier-badge.tier-3 { color: #f472b6; }
.tier-badge.tier-4 { color: #fbbf24; }
.tier-badge.tier-5 { color: #34d399; }

.time-remaining {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', monospace;
}

.time-remaining.active {
  color: #22c55e;
}

.time-remaining.stale {
  color: #f59e0b;
}

.time-remaining.dead {
  color: #ef4444;
}

.time-remaining.unknown {
  color: #9ca3af;
}

.time-icon {
  font-size: 0.75rem;
}

.stale-badge {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #f59e0b;
  background-color: rgba(245, 158, 11, 0.15);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.dead-badge {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #ef4444;
  background-color: rgba(239, 68, 68, 0.15);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.unknown-badge {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #9ca3af;
  background-color: rgba(156, 163, 175, 0.15);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.execution-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.875rem;
  font-size: 0.75rem;
  font-weight: 500;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn.resume {
  background-color: rgba(99, 102, 241, 0.15);
  color: var(--color-primary);
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.action-btn.resume:hover:not(:disabled) {
  background-color: var(--color-primary);
  color: white;
}

.action-btn.unlock {
  background-color: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.action-btn.unlock:hover:not(:disabled) {
  background-color: var(--color-error);
  color: white;
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 0.75rem;
}

.btn-label {
  white-space: nowrap;
}

.btn-spinner-small {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1rem;
  gap: 0.5rem;
  text-align: center;
}

.empty-icon {
  font-size: 2rem;
  opacity: 0.5;
}

.empty-text {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  margin: 0;
}

.empty-hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
  opacity: 0.7;
  margin: 0;
}

.error-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.5rem;
  color: var(--color-error);
  font-size: 0.875rem;
}

.error-icon {
  font-size: 1rem;
}

/* Responsive */
@media (max-width: 768px) {
  .execution-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .execution-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .action-btn .btn-label {
    display: none;
  }

  .action-btn {
    padding: 0.5rem;
  }
}
</style>
