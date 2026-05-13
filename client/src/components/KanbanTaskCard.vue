<template>
  <div
    class="kanban-task-card"
    :class="`status-${task.status}`"
    draggable="true"
    @dragstart="onDragStart"
    @click="onClick"
  >
    <div class="task-header">
      <h4 class="task-title">{{ task.title }}</h4>
      <div class="task-header-actions">
        <span class="task-priority" :class="`priority-${task.priority}`">
          {{ task.priority }}
        </span>
        <!-- Three-dot menu button -->
        <div class="menu-container" ref="menuContainer">
          <button
            class="menu-btn"
            @click.stop="toggleMenu"
            :class="{ 'menu-active': showMenu }"
            title="Task actions"
          >
            <span class="menu-icon">⋮</span>
          </button>

          <!-- Dropdown Menu -->
          <div v-if="showMenu" class="dropdown-menu" @click.stop>
            <div class="menu-header">
              <span class="menu-header-title">Task Actions</span>
            </div>
            <button class="menu-item" @click.stop="onEdit">
              <span class="menu-item-icon">✏️</span>
              <span class="menu-item-text">Edit Task</span>
            </button>
            <button
              v-if="canCopyPrompt"
              class="menu-item"
              @click.stop="onCopyPromptFromMenu"
            >
              <span class="menu-item-icon">📋</span>
              <span class="menu-item-text">Copy Prompt</span>
            </button>
            <button
              v-if="task.requires_human"
              class="menu-item"
              @click.stop="clearHumanGate"
              :disabled="isClearingGate"
            >
              <span class="menu-item-icon">👤</span>
              <span class="menu-item-text">
                {{ isClearingGate ? 'Clearing...' : 'Clear Human Gate' }}
              </span>
            </button>
            <button
              class="menu-item menu-item-danger"
              @click.stop="onDelete"
              :disabled="isDeleting"
            >
              <span class="menu-item-icon">🗑️</span>
              <span class="menu-item-text">
                {{ isDeleting ? 'Deleting...' : 'Delete Task' }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <p v-if="task.description" class="task-description">
      {{ truncateDescription(task.description) }}
    </p>
    <div class="task-footer">
      <div class="task-footer-left">
        <span class="task-tier">Tier {{ task.tier }}</span>
        <!-- Recency dot indicator -->
        <span
          v-if="recencyLevel !== 'old'"
          class="recency-dot"
          :class="`recency-${recencyLevel}`"
          :title="recencyLevel === 'fresh' ? 'Created < 5 min ago' : 'Created 5-20 min ago'"
        ></span>
        <!-- Dependency indicator -->
        <span v-if="hasDependencies" class="dependency-indicator" title="Has dependencies">
          <span class="dependency-icon">🔗</span>
          <span class="dependency-count">{{ task.depends_on?.length }}</span>
        </span>
        <!-- Human Gate indicator -->
        <span v-if="task.requires_human" class="human-gate-indicator" title="Requires human approval">
          <span class="human-gate-icon">👤</span>
          <span class="human-gate-text">Human Gate</span>
        </span>
        <!-- Lock indicator (when MCP agent is working) -->
        <span v-if="task.locked_by && task.status === 'in_progress'" class="lock-indicator" :title="`Locked by ${task.locked_by}`">
          <span class="lock-icon">🔒</span>
          <span class="lock-text">{{ formatAgentName(task.locked_by) }}</span>
        </span>
      </div>
      <span class="task-id">#{{ task.id.slice(-6) }}</span>
    </div>

    <!-- Agent Badge (shown when agent is assigned) -->
    <div v-if="task.agent" class="agent-badge-container">
      <span class="agent-badge">
        <span class="badge-icon">🤖</span>
        <span class="badge-name">{{ formatAgentName(task.agent) }}</span>
      </span>
    </div>

    <!-- Progress Bar (shown when task is running) -->
    <div v-if="isTaskRunning" class="task-progress-section">
      <div class="progress-bar-container">
        <div class="progress-bar">
          <div
            class="progress-fill"
            :style="{ width: `${taskProgress?.percent ?? 0}%` }"
            :class="{ 'progress-indeterminate': !taskProgress?.percent }"
          ></div>
        </div>
        <span v-if="taskProgress?.percent" class="progress-percent">
          {{ taskProgress.percent }}%
        </span>
      </div>
      <p v-if="taskProgress?.message" class="progress-message">
        {{ taskProgress.message }}
      </p>
    </div>

    <!-- Hover Copy Prompt Button -->
    <button
      v-if="canCopyPrompt"
      class="copy-btn"
      @click.stop="onCopyPrompt"
    >
      <span class="btn-icon">📋</span>
      Copy
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { Task } from './KanbanBoard.vue';
import { useTaskProgressStore } from '../stores/taskProgress';
import { useRecency } from '../composables/useRecency';

interface Props {
  task: Task;
  projectId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'dragstart', task: Task): void;
  (e: 'click', task: Task): void;
  (e: 'copyPrompt', task: Task): void;
  (e: 'edit', task: Task): void;
  (e: 'agentAssigned', taskId: string, agentId: string): void;
  (e: 'humanGateCleared', taskId: string): void;
  (e: 'delete', taskId: string): void;
}>();

const taskProgressStore = useTaskProgressStore();
const { getRecencyLevel } = useRecency();
const isClearingGate = ref(false);
const isDeleting = ref(false);

// Menu state
const showMenu = ref(false);
const menuContainer = ref<HTMLElement | null>(null);

// Get progress for this task
const taskProgress = computed(() => {
  return taskProgressStore.getTaskProgress(props.task.id);
});

const isTaskRunning = computed(() => {
  return taskProgressStore.isTaskRunning(props.task.id);
});

const canCopyPrompt = computed(() => {
  return props.task.status === 'pending';
});

const hasDependencies = computed(() => {
  return props.task.depends_on && props.task.depends_on.length > 0;
});

const recencyLevel = computed(() => {
  return getRecencyLevel(props.task.created);
});

function onDragStart(event: DragEvent) {
  emit('dragstart', props.task);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('taskId', props.task.id);
  }
}

function onClick() {
  emit('click', props.task);
}

function onCopyPrompt() {
  emit('copyPrompt', props.task);
}

function onCopyPromptFromMenu() {
  showMenu.value = false;
  onCopyPrompt();
}

function truncateDescription(description: string, maxLength: number = 80): string {
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength) + '...';
}

function formatAgentName(agentId: string): string {
  // Capitalize first letter of each word, replace hyphens/underscores with spaces
  return agentId
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Menu functions
function toggleMenu() {
  showMenu.value = !showMenu.value;
}

function onEdit() {
  showMenu.value = false;
  emit('edit', props.task);
}

async function clearHumanGate() {
  if (!props.projectId || isClearingGate.value) return;

  isClearingGate.value = true;

  try {
    const response = await fetch(
      `/api/projects/${props.projectId}/tasks/${props.task.id}`,
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

    const result = await response.json();
    console.log(`[KanbanTaskCard] Human gate cleared for task: ${props.task.id}`, result);

    // Emit event for parent to handle
    emit('humanGateCleared', props.task.id);

    // Close menu
    showMenu.value = false;
  } catch (err) {
    console.error('Error clearing human gate:', err);
  } finally {
    isClearingGate.value = false;
  }
}

async function onDelete() {
  if (!props.projectId || isDeleting.value) return;
  if (!confirm(`Delete task "${props.task.title}"? This cannot be undone.`)) return;

  isDeleting.value = true;
  showMenu.value = false;

  try {
    const response = await fetch(
      `/api/projects/${props.projectId}/tasks/${props.task.id}`,
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

    emit('delete', props.task.id);
  } catch (err) {
    console.error('[KanbanTaskCard] Error deleting task:', err);
  } finally {
    isDeleting.value = false;
  }
}

// Click outside handler to close menu
function handleClickOutside(event: MouseEvent) {
  if (menuContainer.value && !menuContainer.value.contains(event.target as Node)) {
    showMenu.value = false;
  }
}

// Add/remove click outside listener
onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.kanban-task-card {
  background-color: var(--bg-highlight);
  border: 1px solid transparent;
  border-radius: 0.5rem;
  padding: 0.875rem;
  cursor: grab;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: relative;
}

.kanban-task-card:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.kanban-task-card:active {
  cursor: grabbing;
}

/* Status-based left border */
.kanban-task-card.status-done {
  border-left: 3px solid var(--color-success);
}

.kanban-task-card.status-in_progress {
  border-left: 3px solid var(--color-primary);
}

.kanban-task-card.status-blocked {
  border-left: 3px solid var(--color-error);
}

.kanban-task-card.status-pending {
  border-left: 3px solid var(--text-secondary);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
}

.task-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.3;
  flex: 1;
}

.task-priority {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  flex-shrink: 0;
}

.task-priority.priority-high {
  background-color: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

.task-priority.priority-medium {
  background-color: rgba(245, 158, 11, 0.2);
  color: var(--color-warning);
}

.task-priority.priority-low {
  background-color: rgba(16, 185, 129, 0.2);
  color: var(--color-success);
}

.task-description {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
}

.task-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.25rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.task-footer-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.task-tier {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

/* Recency dot indicator */
.recency-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.recency-dot.recency-fresh {
  background-color: var(--color-success);
  box-shadow: 0 0 4px var(--color-success);
}

.recency-dot.recency-recent {
  background-color: var(--color-warning);
  box-shadow: 0 0 4px var(--color-warning);
}

.dependency-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  background-color: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  color: #a78bfa;
  font-weight: 500;
  cursor: help;
}

.dependency-icon {
  font-size: 0.625rem;
}

.dependency-count {
  font-size: 0.625rem;
  min-width: 12px;
  text-align: center;
}

/* Human Gate Indicator */
.human-gate-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  background-color: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  color: var(--color-warning);
  font-weight: 500;
  cursor: help;
}

.human-gate-icon {
  font-size: 0.625rem;
}

.human-gate-text {
  font-size: 0.625rem;
}

/* Lock Indicator */
.lock-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  background-color: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  color: var(--color-primary);
  font-weight: 500;
  cursor: help;
}

.lock-icon {
  font-size: 0.625rem;
}

.lock-text {
  font-size: 0.625rem;
}

.task-id {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  opacity: 0.6;
  font-family: 'JetBrains Mono', monospace;
}

/* Hover Copy Prompt Button */
.copy-btn {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  background-color: var(--color-primary);
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
  z-index: 10;
}

.copy-btn:hover {
  background-color: var(--color-primary-hover);
  transform: translate(-50%, -50%) scale(1.05);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
}

.kanban-task-card:hover .copy-btn {
  opacity: 1;
  visibility: visible;
}

.btn-icon {
  font-size: 0.75rem;
}

.btn-spinner-small {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Task Progress Section */
.task-progress-section {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.progress-bar-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background-color: var(--bg-highlight);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover));
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-fill.progress-indeterminate {
  width: 30% !important;
  animation: progress-indeterminate 1.5s ease-in-out infinite;
}

@keyframes progress-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(200%);
  }
  100% {
    transform: translateX(-100%);
  }
}

.progress-percent {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--color-primary);
  min-width: 32px;
  text-align: right;
}

.progress-message {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Disable hover copy button when task is running */
.kanban-task-card:has(.task-progress-section) .copy-btn {
  display: none;
}

/* Agent Badge */
.agent-badge-container {
  display: flex;
  align-items: center;
  margin-top: 0.25rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.agent-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background-color: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--color-primary);
}

.badge-icon {
  font-size: 0.75rem;
}

.badge-name {
  text-transform: capitalize;
}

/* Menu Container */
.menu-container {
  position: relative;
  display: flex;
  align-items: center;
}

.menu-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  transition: all 0.2s ease;
  font-size: 1rem;
  line-height: 1;
  min-width: 24px;
  min-height: 24px;
}

.menu-btn:hover {
  background-color: var(--bg-highlight);
  color: var(--text-primary);
}

.menu-btn.menu-active {
  background-color: var(--color-primary);
  color: white;
}

.menu-icon {
  font-weight: bold;
  font-size: 1.125rem;
  line-height: 1;
}

/* Dropdown Menu */
.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 200px;
  max-width: 280px;
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  z-index: 100;
  overflow: hidden;
  animation: menuIn 0.15s ease;
}

@keyframes menuIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.menu-header {
  padding: 0.75rem 1rem;
  background-color: var(--bg-highlight);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.menu-header-title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.menu-divider {
  height: 1px;
  background-color: rgba(255, 255, 255, 0.05);
  margin: 0.25rem 0;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 1rem;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.menu-item:hover {
  background-color: var(--bg-highlight);
  color: var(--color-primary);
}

.menu-item-danger {
  color: var(--color-error, #e05555);
}

.menu-item-danger:hover {
  background-color: rgba(224, 85, 85, 0.1);
  color: var(--color-error, #e05555);
}

.menu-item-icon {
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
}

.menu-item-text {
  flex: 1;
}

.check-icon {
  font-size: 0.75rem;
  color: var(--color-success);
  margin-left: auto;
}

.spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Ensure menu is visible on hover */
.task-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  position: relative;
}

/* Adjust menu position if it would go off screen */
.dropdown-menu {
  right: 0;
}

/* Ensure dropdown stays on top */
.dropdown-menu {
  z-index: 1000;
}
</style>
