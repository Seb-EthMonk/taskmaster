<template>
  <div class="kanban-board">
    <div
      v-for="column in columns"
      :key="column.id"
      class="kanban-column"
      :class="`column-${column.id}`"
      @dragover.prevent
      @drop="onDrop(column.id)"
    >
      <div class="column-header">
        <div class="column-title">
          <span class="column-icon">{{ column.icon }}</span>
          <span class="column-name">{{ column.name }}</span>
          <span class="task-count">{{ column.tasks.length }}</span>
        </div>
      </div>
      <div class="column-content">
        <KanbanTaskCard
          v-for="task in column.tasks"
          :key="task.id"
          :task="task"
          :project-id="projectId"
          @dragstart="onDragStart"
          @click="onTaskClick"
          @copy-prompt="onCopyPrompt"
          @edit="onTaskEdit"
          @agent-assigned="onAgentAssigned"
          @human-gate-cleared="onHumanGateCleared"
          @delete="onTaskDelete"
        />
        <div v-if="column.tasks.length === 0" class="empty-column">
          <span class="empty-icon">{{ column.icon }}</span>
          <span class="empty-text">No {{ column.name.toLowerCase() }} tasks</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import KanbanTaskCard from './KanbanTaskCard.vue';

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
  locked_by?: string | null; // Agent that has claimed/locked this task
  locked_at?: string | null; // When the task was locked
  reclaim_after?: string | null; // When the lock expires and can be reclaimed
}

interface Column {
  id: string;
  name: string;
  icon: string;
  tasks: Task[];
}

interface Props {
  tasks: Task[];
  projectId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'statusChange', taskId: string, newStatus: string): void;
  (e: 'taskClick', task: Task): void;
  (e: 'copyPrompt', task: Task): void;
  (e: 'taskEdit', task: Task): void;
  (e: 'agentAssigned', taskId: string, agentId: string): void;
  (e: 'humanGateCleared', taskId: string): void;
  (e: 'taskDelete', taskId: string): void;
}>();

const columns = computed<Column[]>(() => {
  const todoTasks = props.tasks.filter(t => t.status === 'pending');
  const doingTasks = props.tasks.filter(t => t.status === 'in_progress');
  const doneTasks = props.tasks.filter(t => t.status === 'done');
  const blockedTasks = props.tasks.filter(t => t.status === 'blocked');

  return [
    { id: 'pending', name: 'Todo', icon: '📝', tasks: todoTasks },
    { id: 'in_progress', name: 'Doing', icon: '🔄', tasks: doingTasks },
    { id: 'blocked', name: 'Blocked', icon: '🚫', tasks: blockedTasks },
    { id: 'done', name: 'Done', icon: '✅', tasks: doneTasks },
  ];
});

let draggedTask: Task | null = null;

function onDragStart(task: Task) {
  draggedTask = task;
}

function onDrop(newStatus: string) {
  if (draggedTask && draggedTask.status !== newStatus) {
    emit('statusChange', draggedTask.id, newStatus);
  }
  draggedTask = null;
}

function onTaskClick(task: Task) {
  emit('taskClick', task);
}

function onCopyPrompt(task: Task) {
  emit('copyPrompt', task);
}

function onTaskEdit(task: Task) {
  emit('taskEdit', task);
}

function onAgentAssigned(taskId: string, agentId: string) {
  emit('agentAssigned', taskId, agentId);
}

function onHumanGateCleared(taskId: string) {
  emit('humanGateCleared', taskId);
}

function onTaskDelete(taskId: string) {
  emit('taskDelete', taskId);
}
</script>

<style scoped>
.kanban-board {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  padding-bottom: 0.5rem;
  min-height: 400px;
}

.kanban-column {
  flex: 1;
  min-width: 260px;
  max-width: 320px;
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  border: 1px solid var(--bg-highlight);
  display: flex;
  flex-direction: column;
  transition: border-color 0.2s ease;
}

.kanban-column:hover {
  border-color: rgba(99, 102, 241, 0.3);
}

.column-header {
  padding: 1rem;
  border-bottom: 1px solid var(--bg-highlight);
  background-color: rgba(26, 26, 36, 0.5);
  border-radius: 0.75rem 0.75rem 0 0;
}

.column-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.column-icon {
  font-size: 1rem;
}

.column-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.task-count {
  margin-left: auto;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  background-color: var(--bg-highlight);
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  min-width: 24px;
  text-align: center;
}

.column-content {
  flex: 1;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow-y: auto;
  min-height: 200px;
}

.empty-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  gap: 0.5rem;
  color: var(--text-secondary);
  opacity: 0.5;
  border: 2px dashed var(--bg-highlight);
  border-radius: 0.5rem;
  min-height: 120px;
}

.empty-icon {
  font-size: 1.5rem;
}

.empty-text {
  font-size: 0.75rem;
  text-align: center;
}

/* Column-specific styling */
.column-pending .column-name {
  color: var(--text-secondary);
}

.column-in_progress .column-name {
  color: var(--color-primary);
}

.column-done .column-name {
  color: var(--color-success);
}

.column-blocked .column-name {
  color: var(--color-error);
}

/* Responsive */
@media (max-width: 1024px) {
  .kanban-board {
    gap: 0.75rem;
  }

  .kanban-column {
    min-width: 240px;
    max-width: 280px;
  }
}

@media (max-width: 768px) {
  .kanban-board {
    gap: 0.5rem;
    padding-bottom: 1rem;
  }

  .kanban-column {
    min-width: 220px;
    max-width: 260px;
  }

  .column-header {
    padding: 0.75rem;
  }

  .column-content {
    padding: 0.5rem;
    gap: 0.5rem;
  }
}
</style>
