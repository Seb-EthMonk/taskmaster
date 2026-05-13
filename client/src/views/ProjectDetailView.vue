<template>
  <div class="project-detail">
    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading project...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-state">
      <p class="error-message">{{ error }}</p>
      <div class="error-actions">
        <button class="retry-btn" @click="fetchProject">Retry</button>
        <button class="back-btn" @click="goBack">Back to Projects</button>
      </div>
    </div>

    <!-- Project Content -->
    <div v-else-if="project" class="project-content">
      <!-- View Toggle -->
      <div class="view-toggle">
        <span class="view-label">View:</span>
        <div class="toggle-buttons">
          <button
            class="toggle-btn"
            :class="{ active: viewMode === 'list' }"
            @click="setViewMode('list')"
          >
            <span class="toggle-icon">☰</span>
            List
          </button>
          <button
            class="toggle-btn"
            :class="{ active: viewMode === 'kanban' }"
            @click="setViewMode('kanban')"
          >
            <span class="toggle-icon">▦</span>
            Kanban
          </button>
        </div>
      </div>
      <!-- Header Section -->
      <div class="project-header">
        <div class="header-left">
          <button class="back-link" @click="goBack">
            <span class="back-icon">←</span>
            Back to Projects
          </button>
          <h1 class="project-name">
            {{ project.name }}
            <span v-if="project.isArchived" class="archived-badge">ARCHIVED</span>
          </h1>
          <p v-if="project.description" class="project-description">
            {{ project.description }}
          </p>
        </div>
        <div class="header-right">
          <!-- Current Tier Badge -->
          <div class="tier-badge-large" :class="`tier-${project.currentTier}`">
            <span class="tier-label">Tier {{ project.currentTier }}</span>
            <span class="tier-name">{{ getTierName(project.currentTier) }}</span>
          </div>
          <!-- Status Dropdown Selector -->
          <div class="status-dropdown-container" ref="statusDropdownRef">
            <button 
              class="status-badge status-dropdown-btn" 
              :class="project.status"
              @click="showStatusDropdown = !showStatusDropdown"
            >
              {{ formatStatus(project.status) }}
              <span class="dropdown-arrow">▼</span>
            </button>
            <div v-if="showStatusDropdown" class="status-dropdown-menu">
              <button
                v-for="status in availableStatuses"
                :key="status.value"
                class="status-option"
                :class="{ active: project.status === status.value }"
                @click="updateProjectStatus(status.value)"
              >
                <span class="status-dot" :class="status.value"></span>
                {{ status.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Metadata Section -->
      <div class="metadata-section">
        <div class="metadata-grid">
          <div class="metadata-item">
            <span class="metadata-label">Project ID</span>
            <span class="metadata-value">{{ project.id }}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Last Accessed</span>
            <span class="metadata-value">{{ formatLastAccessed(project.lastAccessed) }}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Tasks</span>
            <span class="metadata-value">{{ project.tasks?.length || 0 }} total</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Completed</span>
            <span class="metadata-value">{{ completedTasks }} tasks</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Progress</span>
            <span class="metadata-value">{{ progressPercentage }}%</span>
          </div>
          <div class="metadata-item" v-if="project.path">
            <span class="metadata-label">Path</span>
            <span class="metadata-value path-value" :title="project.path">{{ truncatePath(project.path) }}</span>
          </div>
        </div>
      </div>

      <!-- Active MCP Tasks Section (Locked Tasks) -->
      <ActiveTasks
        :project-id="projectId"
        :tasks="project?.tasks"
        @unlock="onTaskUnlock"
      />

      <!-- Current Tier Progress Bar Section -->
      <div class="progress-section tier-progress-section">
        <div class="tier-progress-header">
          <h3>Current Tier Progress</h3>
          <span class="tier-progress-badge">Tier {{ project.currentTier }} - {{ getTierName(project.currentTier) }}</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar tier-progress-bar">
            <div
              class="progress-fill tier-progress-fill"
              :style="{ width: `${currentTierProgressPercentage}%` }"
              :class="{ 'tier-complete': currentTierProgressPercentage === 100 }"
            ></div>
          </div>
          <span class="progress-text">{{ currentTierCompleted }} / {{ currentTierTotal }} tasks completed ({{ currentTierProgressPercentage }}%)</span>
        </div>
        <div v-if="currentTierProgressPercentage === 100" class="tier-complete-message">
          <span class="complete-icon">✓</span>
          All tasks in this tier are complete!
        </div>

        <!-- Tier Approval Button - HIDDEN: Tier advancement is now automatic -->
        <!--
        <div v-if="currentTierProgressPercentage === 100 && project?.status === 'awaiting_approval'" class="tier-approval-section">
          <button
            class="tier-approval-btn"
            :disabled="isApproving"
            @click="showApprovalConfirmation"
          >
            <span v-if="isApproving" class="btn-spinner"></span>
            <span v-else class="btn-icon">▶</span>
            {{ isApproving ? 'Approving...' : 'Approve Tier Advancement' }}
          </button>
          <p class="approval-hint">
            Approving will advance the project to Tier {{ project.currentTier + 1 }} - {{ getTierName(project.currentTier + 1) }}
          </p>
        </div>
        -->
      </div>

      <!-- Tier Navigation Tabs -->
      <div class="tier-tabs-section">
        <div class="tier-tabs-header">
          <h3>Tasks by Tier</h3>
          <TierCollapseButton
            :tasks="project?.tasks || []"
            :project-id="projectId"
            @collapse-complete="fetchProject"
          />
        </div>
        <div v-if="availableTiers.length === 0" class="empty-tiers">
          <p>No tiers available. Add tasks to create tiers.</p>
        </div>
        <div v-else class="tier-tabs">
          <button
            v-for="tier in availableTiers"
            :key="tier"
            class="tier-tab"
            :class="{
              'tier-tab-active': selectedTier === tier,
              'tier-tab-current': tier === project.currentTier && selectedTier !== tier,
              'tier-tab-completed': tier < project.currentTier && selectedTier !== tier,
              'tier-tab-pending': tier > project.currentTier && selectedTier !== tier
            }"
            @click="selectedTier = tier"
          >
            <span class="tier-tab-number">{{ tier }}</span>
            <span class="tier-tab-name">{{ getTierName(tier) }}</span>
            <span class="tier-tab-count">{{ getTierTaskCount(tier) }}</span>
          </button>
        </div>
      </div>

      <!-- Tasks Section -->
      <div class="tasks-section" v-if="filteredTasks.length > 0">
        <div class="tasks-header">
          <h3>Tier {{ selectedTier }} - {{ getTierName(selectedTier) }} Tasks</h3>
          <span class="task-count-badge">{{ filteredTasks.length }} tasks</span>
        </div>

        <!-- List View -->
        <div v-if="viewMode === 'list'" class="tasks-list">
          <div
            v-for="task in filteredTasks"
            :key="task.id"
            class="task-item"
            :class="`status-${task.status}`"
            @click="openTaskModal(task)"
          >
            <div class="task-status-indicator" :class="task.status"></div>
            <div class="task-content">
              <h4 class="task-title">{{ task.title }}</h4>
              <p v-if="task.description" class="task-description">{{ task.description }}</p>
              <div class="task-meta">
                <span class="task-tier">Tier {{ task.tier }}</span>
                <span class="task-priority" :class="`priority-${task.priority}`">{{ task.priority }}</span>
                <span class="task-status">{{ task.status }}</span>
                <span v-if="task.requires_human" class="human-gate-badge" title="Requires human approval">👤 Human Gate</span>
                <span v-if="task.locked_by && task.status === 'in_progress'" class="lock-badge" :title="`Locked by ${task.locked_by}`">🔒 {{ formatAgentName(task.locked_by) }}</span>
              </div>
            </div>
            <div class="task-actions" @click.stop>
              <button
                v-if="task.status === 'pending' && !task.requires_human"
                class="action-btn copy-btn"
                @click.stop="copyTaskPrompt(task)"
                title="Copy prompt to clipboard"
              >
                📋
              </button>
              <button
                v-if="task.requires_human"
                class="action-btn clear-gate-btn"
                :disabled="clearingGateId === task.id"
                @click.stop="clearHumanGate(task)"
                title="Clear human gate"
              >
                <span v-if="clearingGateId === task.id" class="btn-spinner-small"></span>
                <span v-else>👤</span>
              </button>
              <button
                class="action-btn edit-btn"
                @click.stop="openTaskModal(task)"
                title="Edit task"
              >
                ✏️
              </button>
              <button
                class="action-btn delete-btn"
                :disabled="deletingTaskId === task.id"
                @click.stop="deleteTask(task)"
                title="Delete task"
              >
                <span v-if="deletingTaskId === task.id" class="btn-spinner-small"></span>
                <span v-else>🗑️</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Kanban Board View -->
        <KanbanBoard
          v-else
          :tasks="filteredTasks"
          :project-id="projectId"
          @status-change="onTaskStatusChange"
          @task-click="openTaskModal"
          @copy-prompt="copyTaskPrompt"
          @task-edit="openTaskModal"
          @agent-assigned="onAgentAssigned"
          @human-gate-cleared="onHumanGateCleared"
          @task-delete="onTaskDelete"
        />
      </div>

      <!-- Empty Tasks State -->
      <div v-else-if="filteredTasks.length === 0" class="empty-tasks">
        <p>No tasks in Tier {{ selectedTier }} - {{ getTierName(selectedTier) }}.</p>
        <p class="hint">Select a different tier to view other tasks.</p>
      </div>

      <!-- Original Empty Tasks State (when project has no tasks) -->
      <div v-else-if="!project.tasks || project.tasks.length === 0" class="empty-tasks">
        <p>No tasks in this project yet.</p>
        <p class="hint">Tasks will appear here when added to the project's tasks.json file.</p>
      </div>

      <!-- Logs Section with Tabs -->
      <div class="logs-section">
        <div class="logs-tabs">
          <button
            class="logs-tab"
            :class="{ active: activeLogsTab === 'info' }"
            @click="activeLogsTab = 'info'"
          >
            <span class="tab-icon">📄</span>
            Project Info
          </button>
          <button
            class="logs-tab"
            :class="{ active: activeLogsTab === 'agent' }"
            @click="activeLogsTab = 'agent'"
          >
            <span class="tab-icon">📊</span>
            Agent Logs
          </button>
          <button
            class="logs-tab"
            :class="{ active: activeLogsTab === 'activity' }"
            @click="activeLogsTab = 'activity'"
          >
            <span class="tab-icon">📋</span>
            Activity Feed
          </button>
          <button
            class="logs-tab"
            :class="{ active: activeLogsTab === 'archive' }"
            @click="activeLogsTab = 'archive'"
          >
            <span class="tab-icon">📦</span>
            Archive
          </button>
        </div>

        <div class="logs-content">
          <div v-if="activeLogsTab === 'info'" class="project-info-panel">
            <div v-if="projectInfoLoading" class="project-info-loading">
              <div class="spinner"></div>
              <p>Loading project info...</p>
            </div>
            <template v-else-if="projectInfoContent">
              <!-- Frontmatter header card -->
              <div v-if="Object.keys(projectInfoFrontmatter).length" class="project-info-meta">
                <div class="project-info-meta-title">
                  <span v-if="projectInfoFrontmatter.emoji" class="project-info-emoji">{{ projectInfoFrontmatter.emoji }}</span>
                  <span class="project-info-name">{{ projectInfoFrontmatter.name || project?.name }}</span>
                </div>
                <div class="project-info-meta-tags">
                  <span v-if="projectInfoFrontmatter.status" class="project-info-tag project-info-tag--status">{{ projectInfoFrontmatter.status }}</span>
                  <span v-if="projectInfoFrontmatter.type" class="project-info-tag project-info-tag--type">{{ projectInfoFrontmatter.type }}</span>
                  <span v-if="projectInfoFrontmatter.created" class="project-info-tag project-info-tag--date">{{ projectInfoFrontmatter.created }}</span>
                </div>
              </div>
              <!-- Markdown body -->
              <div v-if="projectInfoBody" class="project-info-markdown" v-html="marked(projectInfoBody)"></div>
            </template>
            <div v-else class="project-info-empty">
              <p>No project.md found for this project.</p>
            </div>
          </div>
          <AgentLogsTable
            v-if="activeLogsTab === 'agent'"
            :logs="activityLogs"
            :loading="logsLoading"
            @refresh="fetchActivityLogs"
          />
          <ActivityFeed
            v-else-if="activeLogsTab === 'activity'"
            :project-id="projectId"
            :logs="activityLogs"
            :loading="logsLoading"
            :is-connected="wsConnected"
            @clear="clearActivityLogs"
          />
          <ArchiveTab
            v-else-if="activeLogsTab === 'archive'"
            :project-id="projectId"
            :project-name="project?.name || projectId"
            :project-path="project?.path || ''"
          />
        </div>
      </div>
    </div>

    <!-- Project Not Found -->
    <div v-else class="not-found">
      <p>Project not found</p>
      <button class="back-btn" @click="goBack">Back to Projects</button>
    </div>

    <!-- Approval Confirmation Modal - HIDDEN: Tier advancement is now automatic -->
    <!--
    <Teleport to="body">
      <div v-if="showApprovalModal" class="modal-overlay" @click.self="cancelApproval">
        <div class="modal-container">
          <div class="modal-header">
            <h3 class="modal-title">
              <span class="modal-icon">⚠️</span>
              Confirm Tier Advancement
            </h3>
            <button class="modal-close" @click="cancelApproval">×</button>
          </div>
          <div class="modal-body">
            <p class="modal-message">
              You are about to approve the advancement of project <strong>{{ project?.name }}</strong> from:
            </p>
            <div class="tier-transition">
              <div class="tier-from">
                <span class="tier-number-box">{{ project?.currentTier }}</span>
                <span class="tier-name-text">{{ getTierName(project?.currentTier || 0) }}</span>
              </div>
              <span class="tier-arrow">→</span>
              <div class="tier-to">
                <span class="tier-number-box tier-next">{{ Math.min((project?.currentTier || 0) + 1, 5) }}</span>
                <span class="tier-name-text">{{ getTierName((project?.currentTier || 0) + 1) }}</span>
              </div>
            </div>
            <div class="modal-warning">
              <span class="warning-icon">⚡</span>
              <p>This action cannot be undone. The project will immediately proceed to the next tier.</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-btn secondary" @click="cancelApproval">Cancel</button>
            <button
              class="modal-btn primary"
              :disabled="isApproving"
              @click="confirmApproval"
            >
              <span v-if="isApproving" class="btn-spinner-small"></span>
              {{ isApproving ? 'Approving...' : 'Confirm Approval' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    -->

    <!-- Task Detail Modal -->
    <TaskDetailModal
      v-if="showTaskModal && selectedTask && project"
      :task="selectedTask"
      :project-id="projectId"
      @close="closeTaskModal"
      @copy-prompt="copyTaskPrompt"
      @update="onTaskUpdate"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { marked } from 'marked';
import { useRoute, useRouter } from 'vue-router';
import KanbanBoard, { type Task } from '../components/KanbanBoard.vue';
import ActivityFeed, { type LogEntry } from '../components/ActivityFeed.vue';
import TaskDetailModal from '../components/TaskDetailModal.vue';
import ActiveTasks from '../components/ActiveTasks.vue';
import { useTaskProgressStore } from '../stores/taskProgress';
import { useErrorStore } from '../stores/errors';
import { useProjectsStore } from '../stores/projects';
import AgentLogsTable from '../components/AgentLogsTable.vue';
import ArchiveTab from '../components/ArchiveTab.vue';
import TierCollapseButton from '../components/TierCollapseButton.vue';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'failed';
  tier: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  agent?: string; // Assigned agent role for this task (null/undefined uses tier-based fallback)
  created: string;
  started?: string;
  completed?: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  path: string;
  currentTier: number;
  status: string;
  lastAccessed: string;
  tasks: Task[];
  isArchived?: boolean;
  metadata?: {
    totalTasks?: number;
    completedTasks?: number;
    inProgressTasks?: number;
    pendingTasks?: number;
    lastUpdated?: string;
  };
}

const route = useRoute();
const router = useRouter();
const taskProgressStore = useTaskProgressStore();
const projectsStore = useProjectsStore();

const project = ref<Project | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const viewMode = ref<'list' | 'kanban'>('list');
const selectedTier = ref<number>(0);

// Status dropdown state
const showStatusDropdown = ref(false);
const updatingStatus = ref(false);
const statusDropdownRef = ref<HTMLElement | null>(null);
const availableStatuses = [
  { value: 'active', label: 'Active' },
  { value: 'awaiting_approval', label: 'Awaiting Approval' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' }
];

// Close status dropdown when clicking outside
function handleClickOutside(event: MouseEvent) {
  if (statusDropdownRef.value && !statusDropdownRef.value.contains(event.target as Node)) {
    showStatusDropdown.value = false;
  }
}

// Activity feed state
const activityLogs = ref<LogEntry[]>([]);
const logsLoading = ref(false);
const wsConnected = ref(false);
const activeLogsTab = ref<'info' | 'agent' | 'activity' | 'archive'>('agent');
const projectInfoContent = ref<string>('');
const projectInfoLoading = ref(false);

interface ProjectFrontmatter {
  name?: string;
  emoji?: string;
  status?: string;
  created?: string;
  type?: string;
  [key: string]: string | undefined;
}

const projectInfoFrontmatter = ref<ProjectFrontmatter>({});
const projectInfoBody = ref<string>('');
let ws: WebSocket | null = null;
let wsReconnectTimeout: number | null = null;

// Tier approval state - HIDDEN: Tier advancement is now automatic
// const showApprovalModal = ref(false);
// const isApproving = ref(false);
// const approvalError = ref<string | null>(null);

// Task detail modal state
const showTaskModal = ref(false);
const selectedTask = ref<Task | null>(null);

// List view action states
const clearingGateId = ref<string | null>(null);
const deletingTaskId = ref<string | null>(null);

// Format agent name for display
function formatAgentName(agentId: string): string {
  return agentId
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Build a copy-paste prompt for the AI and copy it to the clipboard
async function copyTaskPrompt(task: Task) {
  if (!project.value) return;

  const agentName = task.agent || 'coder';
  const tierName = getTierName(task.tier ?? 0);

  const prompt = `You are an AI agent working on a task in the TaskMaster system.

## Task Details
- **Task ID:** ${task.id}
- **Project:** ${project.value.name} (${project.value.id})
- **Title:** ${task.title}
- **Priority:** ${task.priority ?? 'medium'}
- **Tier:** ${task.tier ?? 0} (${tierName})
- **Agent Role:** ${agentName}

## Description
${task.description || '(No description provided)'}

${task.depends_on?.length ? `## Dependencies (already complete)
${task.depends_on.join(', ')}
` : ''}## Instructions
1. Complete the task described above.
2. When done, mark the task as complete by calling the TaskMaster API:
   PATCH http://localhost:3000/api/projects/${project.value.id}/tasks/${task.id}
   Content-Type: application/json
   { "status": "done", "updated_by": "${agentName}" }
3. Do not start any other tasks. Stop after marking this one done.

## Context
- Project path: ${project.value.path || 'N/A'}
- Current tier: ${project.value.currentTier} (${getTierName(project.value.currentTier)})
- Project status: ${project.value.status}
`;

  try {
    await navigator.clipboard.writeText(prompt);
    console.log(`[ProjectDetail] Prompt copied for task ${task.id}`);
    // Show a brief toast or alert — keeping it minimal
    // Could emit an event or use a store for toast notifications
  } catch (err) {
    console.error('[ProjectDetail] Failed to copy prompt:', err);
    const errorStore = useErrorStore();
    errorStore.addError({
      message: err instanceof Error ? err.message : 'Failed to copy prompt to clipboard',
      source: 'project',
      projectId: projectId.value,
      taskId: task.id
    });
  }
}

// Clear human gate from list view
async function clearHumanGate(task: Task) {
  if (!project.value || clearingGateId.value) return;
  
  clearingGateId.value = task.id;
  
  try {
    const response = await fetch(
      `/api/projects/${projectId.value}/tasks/${task.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requires_human: false })
      }
    );
    
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Failed to clear human gate: ${response.statusText}`);
    }
    
    console.log(`[ProjectDetail] Human gate cleared for task: ${task.id}`);
    
    // Refresh project data
    await fetchProject();
  } catch (err) {
    console.error('[ProjectDetail] Error clearing human gate:', err);
    const errorStore = useErrorStore();
    errorStore.addError({
      message: err instanceof Error ? err.message : 'Failed to clear human gate',
      source: 'project',
      projectId: projectId.value,
      taskId: task.id
    });
  } finally {
    clearingGateId.value = null;
  }
}

// Delete a task
async function deleteTask(task: Task) {
  if (!project.value || deletingTaskId.value) return;
  if (!confirm(`Delete task "${task.title}"? This cannot be undone.`)) return;

  deletingTaskId.value = task.id;

  try {
    const response = await fetch(
      `/api/projects/${projectId.value}/tasks/${task.id}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleted_by: 'user' })
      }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Failed to delete task: ${response.statusText}`);
    }

    console.log(`[ProjectDetail] Task deleted: ${task.id}`);

    // Remove from local state immediately
    if (project.value) {
      project.value.tasks = project.value.tasks.filter(t => t.id !== task.id);
    }
  } catch (err) {
    console.error('[ProjectDetail] Error deleting task:', err);
    const errorStore = useErrorStore();
    errorStore.addError({
      message: err instanceof Error ? err.message : 'Failed to delete task',
      source: 'project',
      projectId: projectId.value,
      taskId: task.id
    });
  } finally {
    deletingTaskId.value = null;
  }
}

// Load view preference from localStorage
const VIEW_MODE_KEY = 'taskmaster_project_view_mode';

function loadViewPreference() {
  const saved = localStorage.getItem(VIEW_MODE_KEY);
  if (saved === 'kanban') {
    viewMode.value = 'kanban';
  } else {
    viewMode.value = 'list';
  }
}

function setViewMode(mode: 'list' | 'kanban') {
  viewMode.value = mode;
  localStorage.setItem(VIEW_MODE_KEY, mode);
}

async function onTaskStatusChange(taskId: string, newStatus: string) {
  if (!project.value) return;

  const errorStore = useErrorStore();
  try {
    const response = await fetch(`/api/projects/${projectId.value}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });

    if (!response.ok) {
      await errorStore.handleApiError(response, 'Failed to Update Task');
      throw new Error(`Failed to update task: ${response.statusText}`);
    }

    // Update local state
    const task = project.value.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = newStatus as Task['status'];
    }
  } catch (err) {
    console.error('Error updating task status:', err);
    error.value = err instanceof Error ? err.message : 'Failed to update task';
  }
}

function openTaskModal(task: Task) {
  selectedTask.value = task;
  showTaskModal.value = true;
}

function closeTaskModal() {
  showTaskModal.value = false;
  selectedTask.value = null;
}

function onTaskStart(taskId: string) {
  // Task started - refresh project to get updated status
  console.log(`[ProjectDetail] Task ${taskId} started`);
  // Optimistically update the task status locally
  if (project.value) {
    const task = project.value.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'in_progress';
      task.started = new Date().toISOString();
    }
  }
}

function onTaskUpdate(taskId: string, updates: Partial<Task>) {
  // Task updated via inline editing - update local state
  console.log(`[ProjectDetail] Task ${taskId} updated:`, updates);
  if (project.value) {
    const task = project.value.tasks.find(t => t.id === taskId);
    if (task) {
      Object.assign(task, updates);
    }
    // Also update selectedTask if it's the same task
    if (selectedTask.value && selectedTask.value.id === taskId) {
      Object.assign(selectedTask.value, updates);
    }
  }
}

function onTaskUnlock(taskId: string, unlockedProjectId?: string) {
  // Task unlocked - refresh project to get updated status
  console.log(`[ProjectDetail] Task ${taskId} unlocked`);
  // Optimistically update the task status locally
  if (project.value) {
    const task = project.value.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'pending';
      task.started = undefined;
      task.locked_by = undefined;
      task.locked_at = undefined;
      task.reclaim_after = undefined;
    }
  }
  // Refresh project data from server
  fetchProject();
}

function onTaskDelete(taskId: string) {
  // Remove deleted task from local state (Kanban path)
  if (project.value) {
    project.value.tasks = project.value.tasks.filter(t => t.id !== taskId);
  }
}

function onAgentAssigned(taskId: string, agentId: string) {
  // Agent assigned to task - update the local task data
  console.log(`[ProjectDetail] Agent ${agentId || 'auto'} assigned to task ${taskId}`);
  if (project.value) {
    const task = project.value.tasks.find(t => t.id === taskId);
    if (task) {
      if (agentId) {
        task.agent = agentId;
      } else {
        delete task.agent;
      }
    }
  }
}

function onHumanGateCleared(taskId: string) {
  // Human gate cleared - update the local task data
  console.log(`[ProjectDetail] Human gate cleared for task ${taskId}`);
  if (project.value) {
    const task = project.value.tasks.find(t => t.id === taskId);
    if (task) {
      task.requires_human = false;
    }
  }
}

// Named tiers for 0-5, auto-generate 'Tier N' for tiers 6+
const namedTiers: Record<number, string> = {
  0: 'Discovery',
  1: 'Strategy',
  2: 'Architecture',
  3: 'Execution',
  4: 'Delivery',
  5: 'Final'
};

function getTierName(tier: number): string {
  if (tier >= 0 && tier <= 5) {
    return namedTiers[tier];
  }
  return `Tier ${tier}`;
}

const projectId = computed(() => route.params.id as string);

const completedTasks = computed(() => {
  if (!project.value?.tasks) return 0;
  return project.value.tasks.filter(t => t.status === 'done').length;
});

const progressPercentage = computed(() => {
  if (!project.value?.tasks || project.value.tasks.length === 0) return 0;
  return Math.round((completedTasks.value / project.value.tasks.length) * 100);
});

// Current tier progress computed properties
const currentTierTasks = computed(() => {
  if (!project.value?.tasks) return [];
  return project.value.tasks.filter(t => t.tier === project.value?.currentTier);
});

const currentTierTotal = computed(() => currentTierTasks.value.length);

const currentTierCompleted = computed(() => {
  return currentTierTasks.value.filter(t => t.status === 'done').length;
});

const currentTierProgressPercentage = computed(() => {
  if (currentTierTotal.value === 0) return 0;
  return Math.round((currentTierCompleted.value / currentTierTotal.value) * 100);
});

const filteredTasks = computed(() => {
  if (!project.value?.tasks) return [];
  return project.value.tasks.filter(t => t.tier === selectedTier.value);
});

// Compute unique tier numbers from tasks, sorted numerically
const availableTiers = computed(() => {
  if (!project.value?.tasks || project.value.tasks.length === 0) {
    return [];
  }
  const tiers = new Set(project.value.tasks.map(t => t.tier));
  return Array.from(tiers).sort((a, b) => a - b);
});

const sortedTasks = computed(() => {
  if (!project.value?.tasks) return [];
  const statusOrder = { 'in_progress': 0, 'pending': 1, 'blocked': 2, 'done': 3 };
  return [...project.value.tasks].sort((a, b) => {
    // Sort by status first (in_progress first, done last)
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    // Then by tier
    return a.tier - b.tier;
  });
});

function getTierTaskCount(tier: number): number {
  if (!project.value?.tasks) return 0;
  return project.value.tasks.filter(t => t.tier === tier).length;
}

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'active': 'Active',
    'awaiting_approval': 'Awaiting Approval',
    'paused': 'Paused',
    'completed': 'Completed'
  };
  return statusMap[status] || status;
}

async function updateProjectStatus(newStatus: string) {
  if (!project.value || updatingStatus.value) return;
  if (project.value.status === newStatus) {
    showStatusDropdown.value = false;
    return;
  }

  updatingStatus.value = true;
  try {
    const response = await fetch(`/api/projects/${project.value.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Failed to update status: ${response.statusText}`);
    }

    // Update local project state
    project.value.status = newStatus as Project['status'];
    console.log(`[ProjectDetail] Status updated to: ${newStatus}`);
    
    // Close dropdown
    showStatusDropdown.value = false;
    
    // Show success feedback (optional - could add toast here)
  } catch (err) {
    console.error('[ProjectDetail] Error updating status:', err);
    error.value = err instanceof Error ? err.message : 'Failed to update project status';
  } finally {
    updatingStatus.value = false;
  }
}

function formatLastAccessed(lastAccessed: string): string {
  const now = new Date().getTime();
  const accessed = new Date(lastAccessed).getTime();
  const diffMinutes = Math.floor((now - accessed) / (1000 * 60));

  if (diffMinutes < 1) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  } else if (diffMinutes < 1440) {
    const hours = Math.floor(diffMinutes / 60);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else {
    const days = Math.floor(diffMinutes / 1440);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
}

function truncatePath(path: string, maxLength: number = 40): string {
  if (path.length <= maxLength) return path;
  return '...' + path.substring(path.length - maxLength + 3);
}

function goBack() {
  router.push('/projects');
}

async function fetchProject() {
  loading.value = true;
  error.value = null;
  const errorStore = useErrorStore();

  try {
    const response = await fetch(`/api/projects/${projectId.value}`);

    if (!response.ok) {
      if (response.status === 404) {
        errorStore.showError('Project Not Found', `No project found with ID: ${projectId.value}`);
        throw new Error('Project not found');
      }
      await errorStore.handleApiError(response, 'Failed to Load Project');
      throw new Error(`Failed to fetch project: ${response.statusText}`);
    }

    const data = await response.json();
    project.value = data;
    // Compute available tiers and default to lowest tier with tasks
    const tiers = new Set(data.tasks?.map((t: Task) => t.tier) || []);
    const sortedTiers = Array.from(tiers).sort((a, b) => a - b);
    // Default to lowest tier with tasks, or current tier, or 0
    selectedTier.value = sortedTiers.length > 0 ? sortedTiers[0] : (data.currentTier || 0);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error fetching project:', err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadViewPreference();
  fetchProject();
  fetchActivityLogs();
  fetchProjectInfo();
  connectWebSocket();
  // Fetch all projects for the agent logs project selector
  projectsStore.fetchProjects();
  // Add click-outside listener for status dropdown
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  disconnectWebSocket();
  // Clear task progress for this project
  if (projectId.value) {
    taskProgressStore.clearProjectProgress(projectId.value);
  }
  // Remove click-outside listener
  document.removeEventListener('click', handleClickOutside);
});

// Tier approval functions - HIDDEN: Tier advancement is now automatic
// These functions are preserved for potential future re-enablement
/*
function showApprovalConfirmation() {
  showApprovalModal.value = true;
  approvalError.value = null;
}

function cancelApproval() {
  if (isApproving.value) return; // Don't close while processing
  showApprovalModal.value = false;
  approvalError.value = null;
}

async function confirmApproval() {
  if (!project.value || isApproving.value) return;

  isApproving.value = true;
  approvalError.value = null;

  try {
    const response = await fetch(`/api/projects/${projectId.value}/tier/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'user' })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to approve tier: ${response.statusText}`);
    }

    const result = await response.json();

    // Update local project state
    project.value.currentTier = result.newTier;
    project.value.status = result.status;

    // Close modal
    showApprovalModal.value = false;

    // Refresh project data to get updated state
    await fetchProject();

    console.log(`[TierApproval] Approved advancement to tier ${result.newTier}`);
  } catch (err) {
    console.error('Error approving tier:', err);
    approvalError.value = err instanceof Error ? err.message : 'Failed to approve tier advancement';
  } finally {
    isApproving.value = false;
  }
}
*/

// Watch for project changes to update selectedTier
watch(() => project.value?.currentTier, (newTier) => {
  if (newTier !== undefined && project.value) {
    selectedTier.value = newTier;
  }
});

// Refetch when route changes
watch(() => route.params.id, () => {
  fetchProject();
  fetchActivityLogs();
});

// Fetch activity logs from API
async function fetchActivityLogs() {
  logsLoading.value = true;
  try {
    const response = await fetch(`/api/projects/${projectId.value}/logs`);
    if (response.ok) {
      const data = await response.json();
      activityLogs.value = data.logs || [];
    }
  } catch (err) {
    console.error('Error fetching activity logs:', err);
  } finally {
    logsLoading.value = false;
  }
}

async function fetchProjectInfo() {
  projectInfoLoading.value = true;
  try {
    const response = await fetch(`/api/projects/${projectId.value}/readme`);
    if (response.ok) {
      const data = await response.json();
      const raw: string = data.content || '';
      projectInfoContent.value = raw;

      // Parse YAML frontmatter block
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
      if (fmMatch) {
        const fm: ProjectFrontmatter = {};
        fmMatch[1].split('\n').forEach(line => {
          const colon = line.indexOf(':');
          if (colon > 0) {
            const key = line.slice(0, colon).trim();
            const val = line.slice(colon + 1).trim();
            if (key && val) fm[key] = val;
          }
        });
        projectInfoFrontmatter.value = fm;
        projectInfoBody.value = raw.slice(fmMatch[0].length).trim();
      } else {
        projectInfoFrontmatter.value = {};
        projectInfoBody.value = raw.trim();
      }
    }
  } catch (err) {
    console.error('Error fetching project info:', err);
  } finally {
    projectInfoLoading.value = false;
  }
}

// Clear activity logs (just clears the display, not the actual file)
function clearActivityLogs() {
  activityLogs.value = [];
}

// Connect to WebSocket for real-time updates
function connectWebSocket() {
  const wsUrl = `ws://${window.location.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WebSocket] Connected');
      wsConnected.value = true;

      // Subscribe to this project
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'subscribe',
          projectId: projectId.value
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (err) {
        console.error('[WebSocket] Error parsing message:', err);
      }
    };

    ws.onclose = () => {
      console.log('[WebSocket] Disconnected');
      wsConnected.value = false;
      ws = null;

      // Attempt to reconnect after 3 seconds
      if (wsReconnectTimeout) {
        clearTimeout(wsReconnectTimeout);
      }
      wsReconnectTimeout = window.setTimeout(() => {
        console.log('[WebSocket] Attempting to reconnect...');
        connectWebSocket();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error('[WebSocket] Error:', err);
      wsConnected.value = false;
    };
  } catch (err) {
    console.error('[WebSocket] Failed to connect:', err);
    wsConnected.value = false;
  }
}

// Disconnect WebSocket
function disconnectWebSocket() {
  if (wsReconnectTimeout) {
    clearTimeout(wsReconnectTimeout);
    wsReconnectTimeout = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(message: any) {
  switch (message.type) {
    case 'log:updated':
      // Only handle log updates for this project
      if (message.data?.projectId === projectId.value && message.data?.logEntry) {
        // Add new log entry to the beginning of the array
        activityLogs.value.unshift(message.data.logEntry);

        // Keep only the last 100 entries to prevent memory issues
        if (activityLogs.value.length > 100) {
          activityLogs.value = activityLogs.value.slice(0, 100);
        }
      }
      break;

    case 'project:updated':
      // Refresh project data when it changes
      if (message.data?.projectId === projectId.value) {
        fetchProject();
        fetchActivityLogs();
      }
      break;

    case 'file:changed':
      // If project.md changed, refresh logs
      if (message.data?.path?.endsWith('project.md') &&
          message.data?.projectId === projectId.value) {
        fetchActivityLogs();
      }
      break;

    case 'task:progress':
      // Handle task progress updates
      if (message.data?.projectId === projectId.value && message.data?.taskId) {
        taskProgressStore.setTaskProgress(
          projectId.value,
          message.data.taskId,
          message.data.message || 'Processing...',
          message.data.percent
        );
      }
      break;

    case 'task:completed':
      // Handle task completion
      if (message.data?.projectId === projectId.value && message.data?.taskId) {
        taskProgressStore.markTaskCompleted(message.data.taskId);
        // Refresh project to get updated task status
        fetchProject();
      }
      break;

    case 'task:error':
      // Handle task error
      if (message.data?.projectId === projectId.value && message.data?.taskId) {
        taskProgressStore.markTaskError(message.data.taskId, message.data.error);
        // Refresh project to get updated task status
        fetchProject();
      }
      break;

    case 'task:started':
      // Handle task started
      if (message.data?.projectId === projectId.value && message.data?.taskId) {
        taskProgressStore.setTaskProgress(
          projectId.value,
          message.data.taskId,
          'Starting...',
          0
        );
        // Refresh project to get updated task status
        fetchProject();
      }
      break;
  }
}
</script>

<style scoped>
.project-detail {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

/* Loading State */
.loading-state {
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

/* Error State */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem;
  gap: 1rem;
}

.error-message {
  color: var(--color-error);
  font-size: 1rem;
}

.error-actions {
  display: flex;
  gap: 1rem;
}

.retry-btn, .back-btn {
  padding: 0.5rem 1.5rem;
  border: none;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-btn {
  background-color: var(--color-primary);
  color: white;
}

.retry-btn:hover {
  background-color: var(--color-primary-hover);
}

.back-btn {
  background-color: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--bg-highlight);
}

.back-btn:hover {
  background-color: var(--bg-highlight);
}

/* Project Header */
.project-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--bg-highlight);
}

.header-left {
  flex: 1;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 1rem;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  transition: color 0.2s ease;
}

.back-link:hover {
  color: var(--color-primary);
}

.back-icon {
  font-size: 1rem;
}

.project-name {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.75rem 0;
  line-height: 1.2;
}

.project-description {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
  max-width: 600px;
  line-height: 1.5;
}

.archived-badge {
  display: inline-block;
  margin-left: 0.75rem;
  padding: 0.25rem 0.625rem;
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  color: #1f2937;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 4px;
  vertical-align: middle;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.header-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.75rem;
}

/* Tier Badge Large */
.tier-badge-large {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 1.5rem;
  border-radius: 0.75rem;
  background-color: var(--bg-surface);
  border: 2px solid var(--bg-highlight);
}

.tier-badge-large.tier-0 { border-color: #94a3b8; }
.tier-badge-large.tier-1 { border-color: #60a5fa; }
.tier-badge-large.tier-2 { border-color: #a78bfa; }
.tier-badge-large.tier-3 { border-color: #f472b6; }
.tier-badge-large.tier-4 { border-color: #fbbf24; }
.tier-badge-large.tier-5 { border-color: #34d399; }
/* Tier 6+ cycling colors (repeats every 6 tiers) */
.tier-badge-large.tier-6 { border-color: #94a3b8; }
.tier-badge-large.tier-7 { border-color: #60a5fa; }
.tier-badge-large.tier-8 { border-color: #a78bfa; }
.tier-badge-large.tier-9 { border-color: #f472b6; }
.tier-badge-large.tier-10 { border-color: #fbbf24; }
.tier-badge-large.tier-11 { border-color: #34d399; }

.tier-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.tier-name {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
}

/* Status Badge */
.status-badge {
  padding: 0.375rem 0.875rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background-color: var(--bg-surface);
  color: var(--text-secondary);
}

.status-badge.active {
  background-color: rgba(99, 102, 241, 0.2);
  color: var(--color-primary);
}

.status-badge.awaiting_approval {
  background-color: rgba(245, 158, 11, 0.2);
  color: var(--color-warning);
}

.status-badge.paused {
  background-color: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

.status-badge.completed {
  background-color: rgba(16, 185, 129, 0.2);
  color: var(--color-success);
}

/* Status Dropdown */
.status-dropdown-container {
  position: relative;
}

.status-dropdown-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
}

.status-dropdown-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.dropdown-arrow {
  font-size: 0.625rem;
  opacity: 0.7;
}

.status-dropdown-menu {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  min-width: 180px;
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  z-index: 100;
  overflow: hidden;
  animation: dropdownIn 0.15s ease;
}

@keyframes dropdownIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.status-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.status-option:hover {
  background-color: var(--bg-highlight);
}

.status-option.active {
  background-color: rgba(99, 102, 241, 0.1);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.active {
  background-color: var(--color-primary);
}

.status-dot.awaiting_approval {
  background-color: var(--color-warning);
}

.status-dot.paused {
  background-color: var(--color-error);
}

.status-dot.completed {
  background-color: var(--color-success);
}

/* Metadata Section */
.metadata-section {
  margin-bottom: 2rem;
}

.metadata-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}

.metadata-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem;
  background-color: var(--bg-surface);
  border-radius: 0.5rem;
}

.metadata-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.metadata-value {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
}

.path-value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
}

/* Progress Section */
.progress-section {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
}

.progress-section h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 1rem 0;
}

/* Tier Progress Section Styling */
.tier-progress-section {
  border-left: 4px solid var(--color-primary);
}

.tier-progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.tier-progress-header h3 {
  margin: 0;
}

.tier-progress-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-primary);
  background-color: rgba(99, 102, 241, 0.15);
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tier-progress-bar {
  background-color: var(--bg-highlight);
}

.tier-progress-fill {
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover));
}

.tier-progress-fill.tier-complete {
  background: linear-gradient(90deg, var(--color-success), #34d399);
}

.tier-complete-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0.75rem 1rem;
  background-color: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 0.5rem;
  color: var(--color-success);
  font-size: 0.875rem;
  font-weight: 500;
}

.complete-icon {
  font-size: 1rem;
  font-weight: 700;
}

.progress-bar-container {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.progress-bar {
  flex: 1;
  height: 10px;
  background-color: var(--bg-highlight);
  border-radius: 5px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover));
  border-radius: 5px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  min-width: 150px;
  text-align: right;
}

/* Tier Tabs Section */
.tier-tabs-section {
  margin-bottom: 2rem;
}

.tier-tabs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.tier-tabs-header h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.tier-tabs-section h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 1rem 0;
}

.tier-tabs {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.tier-tab {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background-color: var(--bg-surface);
  border: 2px solid var(--bg-highlight);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 100px;
}

.tier-tab:hover {
  border-color: var(--color-primary);
  transform: translateY(-1px);
}

.tier-tab-active {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.tier-tab-active .tier-tab-number {
  background-color: rgba(255, 255, 255, 0.2);
  color: white;
}

.tier-tab-active .tier-tab-name {
  color: white;
}

.tier-tab-active .tier-tab-count {
  background-color: rgba(255, 255, 255, 0.2);
  color: white;
}

.tier-tab-current {
  border-color: var(--color-primary);
  background-color: rgba(99, 102, 241, 0.1);
}

.tier-tab-completed {
  border-color: var(--color-success);
  background-color: rgba(16, 185, 129, 0.1);
}

.tier-tab-pending {
  opacity: 0.6;
}

.tier-tab-number {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 700;
  background-color: var(--bg-highlight);
  color: var(--text-primary);
}

.tier-tab-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.tier-tab-count {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.5rem;
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
  border-radius: 9999px;
  margin-left: auto;
}

/* View Toggle */
.view-toggle {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  padding: 0.75rem 1rem;
  background-color: var(--bg-surface);
  border-radius: 0.5rem;
  border: 1px solid var(--bg-highlight);
}

.view-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.toggle-buttons {
  display: flex;
  gap: 0.25rem;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.toggle-btn:hover {
  background-color: var(--bg-highlight);
  color: var(--text-primary);
}

.toggle-btn.active {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.toggle-icon {
  font-size: 1rem;
  line-height: 1;
}

/* Tasks Section */
.tasks-section {
  margin-bottom: 2rem;
}

.tasks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.tasks-header h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.task-count-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  background-color: var(--bg-surface);
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  border: 1px solid var(--bg-highlight);
}

.tasks-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.task-item {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background-color: var(--bg-surface);
  border-radius: 0.5rem;
  border-left: 4px solid var(--bg-highlight);
  transition: all 0.2s ease;
}

.task-item:hover {
  background-color: var(--bg-highlight);
}

.task-item.status-done {
  border-left-color: var(--color-success);
}

.task-item.status-in_progress {
  border-left-color: var(--color-primary);
}

.task-item.status-blocked {
  border-left-color: var(--color-error);
}

.task-item.status-pending {
  border-left-color: var(--text-secondary);
}

.task-status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 0.25rem;
}

.task-status-indicator.done {
  background-color: var(--color-success);
}

.task-status-indicator.in_progress {
  background-color: var(--color-primary);
}

.task-status-indicator.blocked {
  background-color: var(--color-error);
}

.task-status-indicator.pending {
  background-color: var(--text-secondary);
}

.task-content {
  flex: 1;
}

.task-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.25rem 0;
}

.task-description {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 0 0 0.5rem 0;
  line-height: 1.4;
}

.task-meta {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.task-meta span {
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
  text-transform: capitalize;
}

.task-priority.priority-high {
  background-color: rgba(239, 68, 68, 0.2) !important;
  color: var(--color-error) !important;
}

.task-priority.priority-medium {
  background-color: rgba(245, 158, 11, 0.2) !important;
  color: var(--color-warning) !important;
}

.task-priority.priority-low {
  background-color: rgba(16, 185, 129, 0.2) !important;
  color: var(--color-success) !important;
}

/* Human Gate Badge */
.human-gate-badge {
  background-color: rgba(245, 158, 11, 0.15) !important;
  color: var(--color-warning) !important;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

/* Lock Badge */
.lock-badge {
  background-color: rgba(99, 102, 241, 0.15) !important;
  color: var(--color-primary) !important;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

/* Task Actions */
.task-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.task-item:hover .task-actions {
  opacity: 1;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.start-btn {
  background-color: rgba(99, 102, 241, 0.15);
  color: var(--color-primary);
}

.start-btn:hover:not(:disabled) {
  background-color: var(--color-primary);
  color: white;
}

.clear-gate-btn {
  background-color: rgba(245, 158, 11, 0.15);
  color: var(--color-warning);
}

.clear-gate-btn:hover:not(:disabled) {
  background-color: var(--color-warning);
  color: white;
}

.edit-btn {
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
}

.edit-btn:hover {
  background-color: var(--text-secondary);
  color: var(--text-primary);
}

.delete-btn {
  background-color: var(--bg-highlight);
  color: var(--color-error, #e05555);
}

.delete-btn:hover:not(:disabled) {
  background-color: var(--color-error, #e05555);
  color: white;
}

.btn-spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Activity Section */
.activity-section {
  margin-top: 2rem;
}

/* Logs Section with Tabs */
.logs-section {
  margin-top: 2rem;
}

.logs-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--bg-highlight);
  padding-bottom: 0.5rem;
}

.logs-tab {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.logs-tab:hover {
  border-color: var(--color-primary);
  color: var(--text-primary);
}

.logs-tab.active {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.tab-icon {
  font-size: 1rem;
}

.logs-content {
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  border: 1px solid var(--bg-highlight);
}

.project-info-panel {
  padding: 1.75rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.project-info-loading {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: var(--text-secondary);
  padding: 2rem;
}

.project-info-empty {
  color: var(--text-secondary);
  font-style: italic;
  padding: 2rem;
}

/* Frontmatter header card */
.project-info-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background-color: var(--bg-highlight);
  border-radius: 0.625rem;
  border: 1px solid rgba(255,255,255,0.06);
}

.project-info-meta-title {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 0;
}

.project-info-emoji {
  font-size: 1.375rem;
  line-height: 1;
  flex-shrink: 0;
}

.project-info-name {
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-info-meta-tags {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.project-info-tag {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.2em 0.65em;
  border-radius: 0.375rem;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.project-info-tag--status {
  background-color: rgba(74, 222, 128, 0.12);
  color: #4ade80;
  border: 1px solid rgba(74, 222, 128, 0.25);
}

.project-info-tag--type {
  background-color: rgba(148, 163, 184, 0.1);
  color: var(--text-secondary);
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.project-info-tag--date {
  background-color: transparent;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* Markdown body */
.project-info-markdown {
  color: var(--text-secondary);
  line-height: 1.75;
  font-size: 0.9375rem;
}

.project-info-markdown > * + * {
  margin-top: 0.875rem;
}

.project-info-markdown h1 {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-top: 0;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--bg-highlight);
}

.project-info-markdown h2 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 1.75rem;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.8rem;
  opacity: 0.7;
}

.project-info-markdown h3 {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 1.25rem;
  margin-bottom: 0.375rem;
}

.project-info-markdown p {
  margin-top: 0;
  margin-bottom: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.75;
}

.project-info-markdown ul,
.project-info-markdown ol {
  padding-left: 1.5rem;
  margin-top: 0;
  margin-bottom: 0.75rem;
}

.project-info-markdown li {
  margin-bottom: 0.3rem;
  line-height: 1.6;
}

.project-info-markdown li + li {
  margin-top: 0.2rem;
}

.project-info-markdown code {
  background-color: var(--bg-highlight);
  padding: 0.15em 0.45em;
  border-radius: 0.25rem;
  font-size: 0.85em;
  font-family: ui-monospace, monospace;
  color: var(--color-primary);
}

.project-info-markdown pre {
  background-color: var(--bg-highlight);
  border-radius: 0.5rem;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  margin: 0.75rem 0 1rem;
}

.project-info-markdown pre code {
  background: none;
  padding: 0;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.project-info-markdown strong {
  color: var(--text-primary);
  font-weight: 600;
}

.project-info-markdown a {
  color: var(--color-primary);
  text-decoration: none;
}

.project-info-markdown a:hover {
  text-decoration: underline;
}

.project-info-markdown hr {
  border: none;
  border-top: 1px solid var(--bg-highlight);
  margin: 1.5rem 0;
}

/* Empty States */
.empty-tasks,
.empty-tiers {
  text-align: center;
  padding: 3rem;
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
}

.empty-tiers {
  padding: 1.5rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.empty-tasks p {
  color: var(--text-secondary);
  margin: 0 0 0.5rem 0;
}

.empty-tasks .hint {
  font-size: 0.875rem;
  opacity: 0.7;
}

.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem;
  gap: 1rem;
}

.not-found p {
  font-size: 1.25rem;
  color: var(--text-secondary);
}

/* Responsive */
@media (max-width: 768px) {
  .project-detail {
    padding: 1rem;
  }

  .project-header {
    flex-direction: column;
    gap: 1.5rem;
  }

  .header-right {
    align-items: flex-start;
    flex-direction: row;
    width: 100%;
  }

  .project-name {
    font-size: 1.75rem;
  }

  .metadata-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .metadata-grid {
    grid-template-columns: 1fr;
  }
}

/* Tier Approval Section */
.tier-approval-section {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--bg-highlight);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.tier-approval-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 2rem;
  background: linear-gradient(135deg, var(--color-success), #059669);
  color: white;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.tier-approval-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669, #047857);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
}

.tier-approval-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
}

.tier-approval-btn .btn-icon {
  font-size: 1.125rem;
}

.btn-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.approval-hint {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  text-align: center;
  margin: 0;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-container {
  background-color: var(--bg-surface);
  border-radius: 1rem;
  border: 1px solid var(--bg-highlight);
  width: 100%;
  max-width: 480px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  animation: modalIn 0.2s ease;
}

@keyframes modalIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--bg-highlight);
}

.modal-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.modal-icon {
  font-size: 1.25rem;
}

.modal-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
  transition: color 0.2s ease;
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.5rem;
}

.modal-message {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  margin: 0 0 1.25rem 0;
  line-height: 1.5;
}

.modal-message strong {
  color: var(--text-primary);
}

.tier-transition {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 1.25rem;
  background-color: var(--bg-highlight);
  border-radius: 0.75rem;
  margin-bottom: 1.25rem;
}

.tier-from,
.tier-to {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.tier-number-box {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.75rem;
  font-size: 1.25rem;
  font-weight: 700;
  background-color: var(--bg-surface);
  color: var(--text-primary);
  border: 2px solid var(--color-primary);
}

.tier-number-box.tier-next {
  background-color: var(--color-success);
  border-color: var(--color-success);
  color: white;
}

.tier-name-text {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tier-arrow {
  font-size: 1.5rem;
  color: var(--color-primary);
  font-weight: 700;
}

.modal-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  background-color: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 0.5rem;
}

.warning-icon {
  font-size: 1.125rem;
  flex-shrink: 0;
}

.modal-warning p {
  font-size: 0.8125rem;
  color: var(--color-warning);
  margin: 0;
  line-height: 1.5;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1.25rem 1.5rem;
  border-top: 1px solid var(--bg-highlight);
}

.modal-btn {
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.modal-btn.secondary {
  background-color: var(--bg-highlight);
  color: var(--text-primary);
}

.modal-btn.secondary:hover {
  background-color: var(--color-primary);
  color: white;
}

.modal-btn.primary {
  background-color: var(--color-success);
  color: white;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.modal-btn.primary:hover:not(:disabled) {
  background-color: #059669;
}

.modal-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Responsive Modal */
@media (max-width: 480px) {
  .modal-container {
    margin: 0.5rem;
  }

  .tier-transition {
    gap: 1rem;
    padding: 1rem;
  }

  .tier-number-box {
    width: 40px;
    height: 40px;
    font-size: 1rem;
  }

  .modal-footer {
    flex-direction: column-reverse;
  }

  .modal-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
