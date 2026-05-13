<template>
  <div class="agent-logs-table">
    <!-- Table Header -->
    <div class="logs-header">
      <h3 class="logs-title">Agent Activity Logs</h3>
      <div class="logs-actions">
        <span v-if="logs.length > 0" class="logs-count">{{ sortedLogs.length }} entries</span>
        <button
          v-if="logs.length > 0"
          class="refresh-btn"
          @click="$emit('refresh')"
          title="Refresh logs"
        >
          <span class="refresh-icon">🔄</span>
        </button>
        <button
          v-if="logs.length > 0"
          class="toggle-view-btn"
          @click="showTable = !showTable"
          :title="showTable ? 'Show feed view' : 'Show table view'"
        >
          <span class="toggle-icon">{{ showTable ? '📋' : '📊' }}</span>
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div v-if="logs.length > 0 && showTable" class="logs-filters">
      <div class="filter-row">
        <div class="filter-group">
          <label>Search</label>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search context, description, or tag..."
            class="filter-input"
          />
        </div>
        <div class="filter-group">
          <label>Tag Filter</label>
          <select v-model="selectedTag" class="filter-select">
            <option value="">All Tags</option>
            <option v-for="tag in availableTags" :key="tag" :value="tag">{{ tag }}</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Context Filter</label>
          <select v-model="selectedContext" class="filter-select">
            <option value="">All Contexts</option>
            <option v-for="ctx in availableContexts" :key="ctx" :value="ctx">{{ ctx }}</option>
          </select>
        </div>
        <div v-if="projects.length > 0" class="filter-group">
          <label>Project Filter</label>
          <select v-model="selectedProject" class="filter-select">
            <option value="">All Projects</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
        </div>
        <button v-if="hasActiveFilters" class="clear-filters-btn" @click="clearFilters">
          Clear Filters
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="logs-loading">
      <div class="spinner"></div>
      <span>Loading agent logs...</span>
    </div>

    <!-- Empty State -->
    <div v-else-if="logs.length === 0" class="logs-empty">
      <span class="empty-icon">📝</span>
      <p>No agent logs found</p>
      <p class="empty-hint">Agent activity will appear here when tasks are processed</p>
    </div>

    <!-- Table View -->
    <div v-else-if="showTable" class="table-container">
      <table class="logs-table">
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              class="table-header-cell"
              :class="{ sortable: column.sortable, sorted: sortColumn === column.key }"
              @click="column.sortable && handleSort(column.key)"
            >
              <div class="header-content">
                <span>{{ column.label }}</span>
                <span v-if="column.sortable" class="sort-indicator">
                  {{ sortColumn === column.key ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅' }}
                </span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(log, index) in paginatedLogs"
            :key="index"
            class="table-row"
            :class="`tag-${log.tag.toLowerCase()}`"
          >
            <td class="table-cell timestamp-cell" :title="formatFullTimestamp(log.timestamp)">
              {{ formatTimestamp(log.timestamp) }}
            </td>
            <td class="table-cell agent-cell">
              <span class="agent-badge">{{ log.agent }}</span>
            </td>
            <td class="table-cell tag-cell">
              <span class="tag-badge" :class="`tag-${log.tag.toLowerCase()}`">
                {{ getTagIcon(log.tag) }} {{ log.tag }}
              </span>
            </td>
            <td class="table-cell context-cell" :title="log.context">
              {{ log.context }}
            </td>
            <td class="table-cell description-cell" :title="log.description">
              {{ log.description }}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="pagination">
        <button
          class="page-btn"
          :disabled="currentPage === 1"
          @click="currentPage--"
        >
          ← Previous
        </button>
        <span class="page-info">
          Page {{ currentPage }} of {{ totalPages }}
        </span>
        <button
          class="page-btn"
          :disabled="currentPage === totalPages"
          @click="currentPage++"
        >
          Next →
        </button>
      </div>
    </div>

    <!-- Feed View (fallback to ActivityFeed style) -->
    <div v-else class="feed-view">
      <div class="feed-list">
        <div
          v-for="(log, index) in sortedLogs"
          :key="index"
          class="feed-entry"
          :class="`tag-${log.tag.toLowerCase()}`"
        >
          <div class="feed-icon">
            <span>{{ getTagIcon(log.tag) }}</span>
          </div>
          <div class="feed-content">
            <div class="feed-header">
              <span class="feed-tag" :class="`tag-${log.tag.toLowerCase()}`">{{ log.tag }}</span>
              <span class="feed-context">{{ log.context }}</span>
              <span class="feed-time">{{ formatTimestamp(log.timestamp) }}</span>
            </div>
            <p class="feed-description">{{ log.description }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

export interface AgentLogEntry {
  agent: string;
  tag: string;
  timestamp: string;
  context: string;
  description: string;
  raw: string;
  projectId?: string;
  projectName?: string;
}

interface Project {
  id: string;
  name: string;
}

interface Props {
  logs: AgentLogEntry[];
  loading?: boolean;
  projects?: Project[];
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  projects: () => []
});

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'filter-change', filters: { project: string }): void;
}>();

// View mode
const showTable = ref(true);

// Sorting state
const sortColumn = ref<keyof AgentLogEntry>('timestamp');
const sortDirection = ref<'asc' | 'desc'>('desc');

// Pagination state
const currentPage = ref(1);
const pageSize = 10;

// Filter state
const searchQuery = ref('');
const selectedTag = ref('');
const selectedContext = ref('');
const selectedProject = ref('');

// Table columns configuration
const columns = [
  { key: 'timestamp', label: 'Time', sortable: true },
  { key: 'agent', label: 'Agent', sortable: true },
  { key: 'tag', label: 'Tag', sortable: true },
  { key: 'context', label: 'Context', sortable: true },
  { key: 'description', label: 'Description', sortable: false }
];

// Available tags from logs
const availableTags = computed(() => {
  const tags = new Set(props.logs.map(log => log.tag.toUpperCase()));
  return Array.from(tags).sort();
});

// Available contexts from logs
const availableContexts = computed(() => {
  const contexts = new Set(props.logs.map(log => log.context));
  return Array.from(contexts).filter(Boolean).sort();
});

// Check if any filters are active
const hasActiveFilters = computed(() => {
  return searchQuery.value !== '' || selectedTag.value !== '' || selectedContext.value !== '' || selectedProject.value !== '';
});

// Clear all filters
function clearFilters() {
  searchQuery.value = '';
  selectedTag.value = '';
  selectedContext.value = '';
  selectedProject.value = '';
  currentPage.value = 1;
}

// Handle sort column click
function handleSort(column: string) {
  if (sortColumn.value === column) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn.value = column as keyof AgentLogEntry;
    sortDirection.value = 'asc';
  }
}

// Filter and sort logs
const sortedLogs = computed(() => {
  let result = [...props.logs];

  // Apply search filter
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(log =>
      log.context.toLowerCase().includes(query) ||
      log.description.toLowerCase().includes(query) ||
      log.tag.toLowerCase().includes(query)
    );
  }

  // Apply tag filter
  if (selectedTag.value) {
    result = result.filter(log => log.tag.toUpperCase() === selectedTag.value.toUpperCase());
  }

  // Apply context filter
  if (selectedContext.value) {
    result = result.filter(log => log.context === selectedContext.value);
  }

  // Apply project filter
  if (selectedProject.value) {
    result = result.filter(log => log.projectId === selectedProject.value);
  }

  // Apply sorting
  result.sort((a, b) => {
    let comparison = 0;
    const aVal = a[sortColumn.value];
    const bVal = b[sortColumn.value];

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    }

    return sortDirection.value === 'asc' ? comparison : -comparison;
  });

  return result;
});

// Pagination
const totalPages = computed(() => Math.ceil(sortedLogs.value.length / pageSize));

const paginatedLogs = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  const end = start + pageSize;
  return sortedLogs.value.slice(start, end);
});

// Reset to first page when filters change
watch([searchQuery, selectedTag, selectedContext, selectedProject], () => {
  currentPage.value = 1;
  // Emit filter change event for parent components
  emit('filter-change', { project: selectedProject.value });
});

// Format timestamp for display (relative time)
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  } catch {
    return timestamp;
  }
}

// Format full timestamp for tooltip
function formatFullTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  } catch {
    return timestamp;
  }
}

// Get tag icon
function getTagIcon(tag: string): string {
  const icons: Record<string, string> = {
    'STARTED': '🚀',
    'COMPLETED': '✅',
    'BLOCKED': '🚫',
    'DISCOVERED': '🔍',
    'DECISION': '💡',
    'PROGRESS': '📊',
    'ERROR': '❌',
    'INFO': 'ℹ️',
    'QUERY': '❓',
    'COMMENT': '💬',
    'TIER_COMPLETE': '🏆',
    'TIER_APPROVAL': '🔓',
    'PROJECT_COMPLETE': '🎉'
  };
  return icons[tag.toUpperCase()] || '📝';
}
</script>

<style scoped>
.agent-logs-table {
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  border: 1px solid var(--bg-highlight);
  overflow: hidden;
}

/* Header */
.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  background-color: rgba(99, 102, 241, 0.05);
  border-bottom: 1px solid var(--bg-highlight);
}

.logs-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.logs-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logs-count {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background-color: var(--bg-highlight);
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
}

.refresh-btn,
.toggle-view-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background-color: var(--bg-highlight);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.refresh-btn:hover,
.toggle-view-btn:hover {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.refresh-icon,
.toggle-icon {
  font-size: 1rem;
}

/* Filters */
.logs-filters {
  padding: 1rem 1.25rem;
  background-color: var(--bg-highlight);
  border-bottom: 1px solid var(--bg-highlight);
}

.filter-row {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  flex: 1;
  min-width: 150px;
}

.filter-group label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.filter-input,
.filter-select {
  padding: 0.5rem 0.75rem;
  background-color: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.375rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  transition: border-color 0.2s ease;
}

.filter-input:focus,
.filter-select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.filter-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.clear-filters-btn {
  padding: 0.5rem 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.375rem;
  color: var(--color-error);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  height: fit-content;
}

.clear-filters-btn:hover {
  background-color: rgba(239, 68, 68, 0.2);
}

/* Loading State */
.logs-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3rem;
  color: var(--text-secondary);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--bg-highlight);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Empty State */
.logs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  text-align: center;
}

.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}

.logs-empty p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 1rem;
}

.empty-hint {
  font-size: 0.875rem !important;
  opacity: 0.7;
  margin-top: 0.5rem !important;
}

/* Table */
.table-container {
  overflow-x: auto;
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.table-header-cell {
  padding: 0.75rem 1rem;
  text-align: left;
  font-weight: 600;
  color: var(--text-secondary);
  background-color: var(--bg-highlight);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  white-space: nowrap;
}

.table-header-cell.sortable {
  cursor: pointer;
  user-select: none;
}

.table-header-cell.sortable:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.table-header-cell.sorted {
  color: var(--color-primary);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sort-indicator {
  font-size: 0.75rem;
  opacity: 0.7;
}

.table-row {
  border-bottom: 1px solid var(--bg-highlight);
  transition: background-color 0.2s ease;
}

.table-row:hover {
  background-color: rgba(255, 255, 255, 0.02);
}

.table-row:last-child {
  border-bottom: none;
}

.table-cell {
  padding: 0.75rem 1rem;
  color: var(--text-primary);
  vertical-align: top;
}

.timestamp-cell {
  white-space: nowrap;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.agent-cell {
  white-space: nowrap;
}

.agent-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  background-color: var(--bg-highlight);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.tag-cell {
  white-space: nowrap;
}

.tag-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
}

/* Tag colors */
.tag-badge.tag-started,
.tag-badge.tag-progress {
  background-color: rgba(99, 102, 241, 0.2);
  color: var(--color-primary);
}

.tag-badge.tag-completed,
.tag-badge.tag-tier_complete,
.tag-badge.tag-tier_approval,
.tag-badge.tag-project_complete {
  background-color: rgba(16, 185, 129, 0.2);
  color: var(--color-success);
}

.tag-badge.tag-blocked,
.tag-badge.tag-error {
  background-color: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

.tag-badge.tag-discovered,
.tag-badge.tag-decision {
  background-color: rgba(245, 158, 11, 0.2);
  color: var(--color-warning);
}

.tag-badge.tag-info,
.tag-badge.tag-comment {
  background-color: rgba(148, 163, 184, 0.2);
  color: var(--text-secondary);
}

.tag-badge.tag-query {
  background-color: rgba(167, 139, 250, 0.2);
  color: #a78bfa;
}

.context-cell {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.8125rem;
}

.description-cell {
  max-width: 520px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  line-height: 1.5;
  color: var(--text-secondary);
}

/* Row tag coloring */
.table-row.tag-completed .context-cell,
.table-row.tag-completed .description-cell,
.table-row.tag-tier_complete .context-cell,
.table-row.tag-tier_complete .description-cell {
  color: rgba(16, 185, 129, 0.8);
}

.table-row.tag-error .context-cell,
.table-row.tag-error .description-cell,
.table-row.tag-blocked .context-cell,
.table-row.tag-blocked .description-cell {
  color: rgba(239, 68, 68, 0.8);
}

.table-row.tag-started .context-cell,
.table-row.tag-started .description-cell,
.table-row.tag-progress .context-cell,
.table-row.tag-progress .description-cell {
  color: rgba(99, 102, 241, 0.8);
}

/* Pagination */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-top: 1px solid var(--bg-highlight);
}

.page-btn {
  padding: 0.5rem 1rem;
  background-color: var(--bg-highlight);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.375rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.page-btn:hover:not(:disabled) {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* Feed View */
.feed-view {
  max-height: 400px;
  overflow-y: auto;
}

.feed-list {
  display: flex;
  flex-direction: column;
}

.feed-entry {
  display: flex;
  gap: 0.875rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--bg-highlight);
  transition: background-color 0.2s ease;
}

.feed-entry:hover {
  background-color: rgba(255, 255, 255, 0.02);
}

.feed-entry:last-child {
  border-bottom: none;
}

.feed-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-highlight);
  border-radius: 0.5rem;
  font-size: 1rem;
}

.feed-content {
  flex: 1;
  min-width: 0;
}

.feed-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.25rem;
}

.feed-tag {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
}

.feed-context {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.feed-time {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  margin-left: auto;
}

.feed-description {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

/* Responsive */
@media (max-width: 768px) {
  .logs-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .filter-row {
    flex-direction: column;
    gap: 0.75rem;
  }

  .filter-group {
    min-width: 100%;
  }

  .logs-table {
    font-size: 0.8125rem;
  }

  .table-cell {
    padding: 0.625rem 0.75rem;
  }

  .context-cell,
  .description-cell {
    max-width: 150px;
  }

  .pagination {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
}
</style>
