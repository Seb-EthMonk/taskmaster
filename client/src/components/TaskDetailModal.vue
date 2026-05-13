<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="onClose">
      <div class="modal-container">
        <div class="modal-header">
          <h3 class="modal-title">Task Details</h3>
          <button class="modal-close" @click="onClose">×</button>
        </div>

        <div class="modal-body">
          <!-- Task Title -->
          <div class="task-field">
            <label class="field-label">Title</label>
            <div
              v-if="!isEditingTitle"
              class="field-value title-value editable"
              :class="{ 'editing-disabled': isSaving }"
              @click="startEditingTitle"
            >
              {{ task.title }}
              <span class="edit-hint">✎</span>
            </div>
            <div v-else class="edit-input-wrapper">
              <input
                ref="titleInputRef"
                v-model="editTitleValue"
                type="text"
                class="edit-input title-input"
                :disabled="isSaving"
                @keydown="handleTitleKeydown"
                @blur="saveTitle"
              />
              <div class="edit-hint-text">Press Enter to save, Esc to cancel</div>
            </div>
          </div>

          <!-- Task Description -->
          <div class="task-field">
            <label class="field-label">Description</label>
            <div
              v-if="!isEditingDescription"
              class="field-value description-value editable"
              :class="{ 'editing-disabled': isSaving, 'empty': !task.description }"
              @click="startEditingDescription"
            >
              {{ task.description || 'Click to add description...' }}
              <span class="edit-hint">✎</span>
            </div>
            <div v-else class="edit-input-wrapper">
              <textarea
                ref="descriptionInputRef"
                v-model="editDescriptionValue"
                class="edit-input description-input"
                rows="4"
                :disabled="isSaving"
                @keydown="handleDescriptionKeydown"
                @blur="saveDescription"
              ></textarea>
              <div class="edit-hint-text">Ctrl+Enter to save, Esc to cancel</div>
            </div>
          </div>

          <!-- Task Metadata Grid -->
          <div class="metadata-grid">
            <div class="metadata-item">
              <label class="field-label">Status</label>
              <span class="status-badge" :class="`status-${task.status}`">
                {{ formatStatus(task.status) }}
              </span>
            </div>
            <div class="metadata-item">
              <label class="field-label">Priority</label>
              <span class="priority-badge" :class="`priority-${task.priority}`">
                {{ task.priority }}
              </span>
            </div>
            <div class="metadata-item">
              <label class="field-label">Tier</label>
              <span class="tier-badge">Tier {{ task.tier }}</span>
            </div>
            <div class="metadata-item">
              <label class="field-label">Task ID</label>
              <span class="id-value">#{{ task.id.slice(-8) }}</span>
            </div>
          </div>

          <!-- Dependencies Section -->
          <div v-if="task.depends_on && task.depends_on.length > 0" class="dependencies-section">
            <label class="field-label">Dependencies</label>
            <div class="dependencies-list">
              <span v-for="depId in task.depends_on" :key="depId" class="dependency-tag">
                <span class="dependency-link-icon">🔗</span>
                <span class="dependency-id">#{{ depId.slice(-6) }}</span>
              </span>
            </div>
            <p class="dependencies-help">This task cannot start until all dependencies are completed.</p>
          </div>

          <!-- Agent Selector -->
          <AgentSelector
            v-model="selectedAgent"
            :project-id="projectId"
            :task-id="task.id"
            :disabled="task.status !== 'pending'"
            @change="onAgentChange"
          />

          <!-- Timestamps -->
          <div class="timestamps-section">
            <div v-if="task.created" class="timestamp-item">
              <span class="timestamp-label">Created:</span>
              <span class="timestamp-value">{{ formatDate(task.created) }}</span>
            </div>
            <div v-if="task.started" class="timestamp-item">
              <span class="timestamp-label">Started:</span>
              <span class="timestamp-value">{{ formatDate(task.started) }}</span>
            </div>
            <div v-if="task.completed" class="timestamp-item">
              <span class="timestamp-label">Completed:</span>
              <span class="timestamp-value">{{ formatDate(task.completed) }}</span>
            </div>
          </div>

          <!-- Lock Information (when MCP agent is working) -->
          <div v-if="task.locked_by" class="lock-info-section">
            <label class="field-label">Lock Status</label>
            <div class="lock-info-card">
              <div class="lock-row">
                <span class="lock-label">🔒 Locked by</span>
                <span class="lock-value">{{ task.locked_by }}</span>
              </div>
              <div v-if="task.locked_at" class="lock-row">
                <span class="lock-label">Since</span>
                <span class="lock-value">{{ formatDate(task.locked_at) }}</span>
              </div>
              <div v-if="task.reclaim_after" class="lock-row">
                <span class="lock-label">Expires</span>
                <span class="lock-value" :class="isLockExpiringSoon ? 'expiring-soon' : ''">
                  {{ formatDate(task.reclaim_after) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Error Message -->
          <div v-if="error" class="error-message">
            <span class="error-icon">⚠️</span>
            {{ error }}
          </div>

          <!-- Task Progress Section -->
          <div v-if="isTaskRunning" class="task-progress-section">
            <div class="progress-header">
              <span class="progress-label">Executing Task</span>
              <span v-if="taskProgress?.percent" class="progress-percentage">{{ taskProgress.percent }}%</span>
            </div>            <div class="progress-bar-large">
              <div
                class="progress-fill-large"
                :style="{ width: `${taskProgress?.percent ?? 0}%` }"
                :class="{ 'progress-indeterminate': !taskProgress?.percent }"
              ></div>
            </div>
            <p v-if="taskProgress?.message" class="progress-status">
              {{ taskProgress.message }}
            </p>
          </div>
        </div>

        <div class="modal-footer">
          <button class="modal-btn secondary" @click="onClose">Close</button>
          <button
            v-if="canCopyPrompt"
            class="modal-btn primary"
            @click="onCopyPrompt"
          >
            <span class="btn-icon">📋</span>
            Copy Prompt
          </button>
          <button
            v-else-if="task.status === 'in_progress' || isTaskRunning"
            class="modal-btn disabled running"
            disabled
          >
            <span class="btn-icon">🔄</span>
            {{ isTaskRunning ? 'Running...' : 'In Progress' }}
          </button>
          <button
            v-else-if="task.status === 'done'"
            class="modal-btn disabled"
            disabled
          >
            <span class="btn-icon">✓</span>
            Completed
          </button>
          <button
            v-else-if="task.status === 'blocked'"
            class="modal-btn disabled"
            disabled
          >
            <span class="btn-icon">🚫</span>
            Blocked
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useTaskProgressStore } from '../stores/taskProgress';
import { useErrorStore } from '../stores/errors';
import AgentSelector from './AgentSelector.vue';

export interface Task {
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
  depends_on?: string[]; // array of task IDs that must be 'done' first
  requires_human?: boolean; // Human gate - blocks task execution until cleared
  locked_by?: string;
  locked_at?: string;
  reclaim_after?: string;
}

interface Props {
  task: Task;
  projectId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'copyPrompt', task: Task): void;
  (e: 'update', taskId: string, updates: Partial<Task>): void;
}>();

const taskProgressStore = useTaskProgressStore();
const error = ref<string | null>(null);
const selectedAgent = ref(props.task.agent || '');

// Inline editing state
const isEditingTitle = ref(false);
const isEditingDescription = ref(false);
const editTitleValue = ref(props.task.title);
const editDescriptionValue = ref(props.task.description || '');
const isSaving = ref(false);
const titleInputRef = ref<HTMLInputElement | null>(null);
const descriptionInputRef = ref<HTMLTextAreaElement | null>(null);

// Get progress for this task
const taskProgress = computed(() => {
  return taskProgressStore.getTaskProgress(props.task.id);
});

const isTaskRunning = computed(() => {
  return taskProgressStore.isTaskRunning(props.task.id);
});

// Check if lock expires within 2 minutes
const isLockExpiringSoon = computed(() => {
  if (!props.task.reclaim_after) return false;
  const reclaimTime = new Date(props.task.reclaim_after).getTime();
  const now = Date.now();
  const twoMinutes = 2 * 60 * 1000;
  return reclaimTime - now < twoMinutes && reclaimTime > now;
});

const canCopyPrompt = computed(() => {
  return props.task.status === 'pending';
});

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'pending': 'Pending',
    'in_progress': 'In Progress',
    'done': 'Done',
    'blocked': 'Blocked'
  };
  return statusMap[status] || status;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function onClose() {
  emit('close');
}

function onCopyPrompt() {
  emit('copyPrompt', props.task);
}

function onAgentChange(agentId: string) {
  // Agent selector already saves to server via its own API call
  // This handler allows the modal to react to changes if needed
  console.log(`[TaskDetailModal] Agent changed to: ${agentId || 'auto'}`);
}

// Inline editing functions
function startEditingTitle() {
  if (isSaving.value) return;
  editTitleValue.value = props.task.title;
  isEditingTitle.value = true;
  nextTick(() => {
    titleInputRef.value?.focus();
    titleInputRef.value?.select();
  });
}

function startEditingDescription() {
  if (isSaving.value) return;
  editDescriptionValue.value = props.task.description || '';
  isEditingDescription.value = true;
  nextTick(() => {
    descriptionInputRef.value?.focus();
  });
}

async function saveTitle() {
  const newTitle = editTitleValue.value.trim();
  if (!newTitle || newTitle === props.task.title) {
    isEditingTitle.value = false;
    return;
  }

  isSaving.value = true;
  error.value = null;

  try {
    const response = await fetch(
      `/api/projects/${props.projectId}/tasks/${props.task.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Failed to update title: ${response.statusText}`);
    }

    // Emit update event for parent to refresh task data
    emit('update', props.task.id, { title: newTitle });
    isEditingTitle.value = false;
  } catch (err) {
    console.error('Error saving title:', err);
    error.value = err instanceof Error ? err.message : 'Failed to save title';
  } finally {
    isSaving.value = false;
  }
}

async function saveDescription() {
  const newDescription = editDescriptionValue.value.trim();
  if (newDescription === (props.task.description || '')) {
    isEditingDescription.value = false;
    return;
  }

  isSaving.value = true;
  error.value = null;

  try {
    const response = await fetch(
      `/api/projects/${props.projectId}/tasks/${props.task.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newDescription })
      }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Failed to update description: ${response.statusText}`);
    }

    // Emit update event for parent to refresh task data
    emit('update', props.task.id, { description: newDescription });
    isEditingDescription.value = false;
  } catch (err) {
    console.error('Error saving description:', err);
    error.value = err instanceof Error ? err.message : 'Failed to save description';
  } finally {
    isSaving.value = false;
  }
}

function cancelEditingTitle() {
  isEditingTitle.value = false;
  editTitleValue.value = props.task.title;
}

function cancelEditingDescription() {
  isEditingDescription.value = false;
  editDescriptionValue.value = props.task.description || '';
}

function handleTitleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    saveTitle();
  } else if (e.key === 'Escape') {
    cancelEditingTitle();
  }
}

function handleDescriptionKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    cancelEditingDescription();
  }
  // Allow Enter for newlines in textarea, Ctrl+Enter to save
  if (e.key === 'Enter' && e.ctrlKey) {
    saveDescription();
  }
}


</script>

<style scoped>
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
  max-width: 520px;
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
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.task-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.field-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.field-value {
  margin: 0;
  color: var(--text-primary);
}

.title-value {
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.4;
}

.description-value {
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

/* Editable field styles */
.editable {
  position: relative;
  cursor: pointer;
  padding: 0.5rem;
  margin: -0.5rem;
  border-radius: 0.375rem;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.editable:hover {
  background-color: var(--bg-highlight);
  border-color: var(--color-primary);
}

.editable:hover .edit-hint {
  opacity: 1;
}

.editable.empty {
  color: var(--text-secondary);
  font-style: italic;
}

.editing-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.edit-hint {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  font-size: 0.875rem;
  color: var(--color-primary);
  transition: opacity 0.2s ease;
}

.description-value .edit-hint {
  top: 0.5rem;
  transform: none;
}

.edit-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.edit-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.9375rem;
  font-family: inherit;
  background-color: var(--bg-highlight);
  border: 1px solid var(--color-primary);
  border-radius: 0.375rem;
  color: var(--text-primary);
  outline: none;
  transition: all 0.2s ease;
}

.edit-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.edit-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.title-input {
  font-size: 1.125rem;
  font-weight: 600;
}

.description-input {
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}

.edit-hint-text {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-style: italic;
}

.metadata-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.metadata-item {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.status-badge,
.priority-badge,
.tier-badge,
.id-value {
  display: inline-flex;
  align-items: center;
  font-size: 0.8125rem;
  font-weight: 500;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  background-color: var(--bg-highlight);
  color: var(--text-primary);
  width: fit-content;
}

.status-badge.status-pending {
  background-color: rgba(148, 163, 184, 0.2);
  color: #94a3b8;
}

.status-badge.status-in_progress {
  background-color: rgba(99, 102, 241, 0.2);
  color: var(--color-primary);
}

.status-badge.status-done {
  background-color: rgba(16, 185, 129, 0.2);
  color: var(--color-success);
}

.status-badge.status-blocked {
  background-color: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

.priority-badge.priority-high {
  background-color: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

.priority-badge.priority-medium {
  background-color: rgba(245, 158, 11, 0.2);
  color: var(--color-warning);
}

.priority-badge.priority-low {
  background-color: rgba(16, 185, 129, 0.2);
  color: var(--color-success);
}

.id-value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
}

.timestamps-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bg-highlight);
}

.timestamp-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.8125rem;
}

.timestamp-label {
  color: var(--text-secondary);
}

.timestamp-value {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* Lock Information Section */
.lock-info-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bg-highlight);
}

.lock-info-card {
  background-color: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 0.5rem;
  padding: 0.875rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.lock-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8125rem;
}

.lock-label {
  color: var(--text-secondary);
}

.lock-value {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 500;
}

.lock-value.expiring-soon {
  color: var(--color-error);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.error-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.5rem;
  color: var(--color-error);
  font-size: 0.875rem;
}

.error-icon {
  font-size: 1rem;
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
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
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
  background-color: var(--color-primary);
  color: white;
}

.modal-btn.primary:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.modal-btn.disabled {
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
  cursor: not-allowed;
  opacity: 0.7;
}

.modal-btn.disabled.running {
  background-color: rgba(99, 102, 241, 0.2);
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
}

.modal-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 0.875rem;
}

.btn-spinner {
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

/* Responsive */
@media (max-width: 480px) {
  .modal-container {
    margin: 0.5rem;
  }

  .metadata-grid {
    grid-template-columns: 1fr;
  }

  .modal-footer {
    flex-direction: column-reverse;
  }

  .modal-btn {
    width: 100%;
    justify-content: center;
  }
}

/* Task Progress Section */
.task-progress-section {
  margin-top: 1rem;
  padding: 1rem;
  background-color: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 0.5rem;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.progress-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.progress-percentage {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--color-primary);
}

.progress-bar-large {
  height: 10px;
  background-color: var(--bg-highlight);
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.progress-fill-large {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover));
  border-radius: 5px;
  transition: width 0.3s ease;
}

.progress-fill-large.progress-indeterminate {
  width: 30% !important;
  animation: progress-indeterminate-large 1.5s ease-in-out infinite;
}

@keyframes progress-indeterminate-large {
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(300%);
  }
  100% {
    transform: translateX(-100%);
  }
}

.progress-status {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
}

/* Dependencies Section */
.dependencies-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background-color: rgba(139, 92, 246, 0.1);
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 0.5rem;
}

.dependencies-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.dependency-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
  background-color: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 0.375rem;
  font-size: 0.75rem;
  color: #a78bfa;
  font-weight: 500;
}

.dependency-link-icon {
  font-size: 0.625rem;
}

.dependency-id {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.dependencies-help {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin: 0;
  font-style: italic;
}
</style>
