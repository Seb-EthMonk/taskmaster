<template>
  <div class="activity-feed">
    <div class="feed-header">
      <h3>Activity Feed</h3>
      <div class="feed-actions">
        <span v-if="filteredLogs.length > 0" class="log-count">{{ filteredLogs.length }} entries</span>
        <span v-else-if="logs.length > 0" class="log-count">0 / {{ logs.length }} entries</span>
        <button
          v-if="logs.length > 0"
          class="clear-btn"
          @click="clearFeed"
          title="Clear feed display"
        >
          Clear
        </button>
        <span class="live-indicator" :class="{ connected: isConnected }">
          <span class="live-dot"></span>
          {{ isConnected ? 'Live' : 'Offline' }}
        </span>
      </div>
    </div>

    <!-- Filters Section -->
    <div v-if="logs.length > 0" class="filters-section">
      <div class="filters-header" @click="toggleFilters">
        <span class="filters-title">
          <span class="filter-icon">🔍</span>
          Filters
        </span>
        <span class="filters-toggle">{{ showFilters ? '▲' : '▼' }}</span>
      </div>

      <div v-show="showFilters" class="filters-content">
        <!-- Search Input -->
        <div class="filter-row">
          <div class="filter-group filter-search">
            <label>Search</label>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search in description, context, or tags..."
              class="filter-input"
            />
          </div>
        </div>

        <!-- Tag Filter -->
        <div class="filter-row">
          <div class="filter-group">
            <label>Filter by Tag</label>
            <div class="tag-filters">
              <button
                v-for="tag in availableTags"
                :key="tag"
                class="tag-filter-btn"
                :class="{ active: selectedTags.includes(tag) }"
                @click="toggleTag(tag)"
              >
                {{ getTagIcon(tag) }} {{ tag }}
              </button>
              <button
                v-if="selectedTags.length > 0"
                class="tag-filter-btn clear-tags"
                @click="clearTagFilter"
              >
                Clear tags
              </button>
            </div>
          </div>
        </div>

        <!-- Date Range Filter -->
        <div class="filter-row">
          <div class="filter-group">
            <label>Date Range</label>
            <div class="date-filters">
              <select v-model="dateRangePreset" class="filter-select" @change="onDatePresetChange">
                <option value="all">All time</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7days">Last 7 days</option>
                <option value="last30days">Last 30 days</option>
                <option value="custom">Custom range</option>
              </select>

              <template v-if="dateRangePreset === 'custom'">
                <input
                  v-model="customStartDate"
                  type="date"
                  class="filter-input date-input"
                  placeholder="Start date"
                />
                <span class="date-separator">to</span>
                <input
                  v-model="customEndDate"
                  type="date"
                  class="filter-input date-input"
                  placeholder="End date"
                />
              </template>
            </div>
          </div>
        </div>

        <!-- Clear All Filters -->
        <div v-if="hasActiveFilters" class="filter-row">
          <button class="clear-filters-btn" @click="clearAllFilters">
            Clear all filters
          </button>
        </div>
      </div>
    </div>

    <div class="feed-container" ref="feedContainer">
      <!-- Loading State -->
      <div v-if="loading" class="feed-loading">
        <div class="spinner-small"></div>
        <span>Loading activity...</span>
      </div>

      <!-- Empty State - No Logs At All -->
      <div v-else-if="logs.length === 0" class="feed-empty">
        <span class="empty-icon">📝</span>
        <p>No activity yet</p>
        <p class="empty-hint">Agent activity will appear here in real-time</p>
      </div>

      <!-- Empty State - Filters Applied But No Results -->
      <div v-else-if="filteredLogs.length === 0" class="feed-empty">
        <span class="empty-icon">🔍</span>
        <p>No logs match your filters</p>
        <p class="empty-hint">Try adjusting your search or filter criteria</p>
        <button class="clear-filters-btn" @click="clearAllFilters">
          Clear all filters
        </button>
      </div>

      <!-- Log Entries -->
      <div v-else class="feed-list">
        <div
          v-for="(log, index) in filteredLogs"
          :key="index"
          class="log-entry"
          :class="[`tag-${log.tag.toLowerCase()}`, { 'is-new': isNewEntry(index) }]"
        >
          <div class="log-icon">
            <span class="tag-badge">{{ getTagIcon(log.tag) }}</span>
          </div>
          <div class="log-content">
            <div class="log-header">
              <span class="log-tag" :class="`tag-${log.tag.toLowerCase()}`">
                {{ log.tag }}
              </span>
              <span class="log-context" v-if="log.context">{{ log.context }}</span>
              <span class="log-timestamp">{{ formatTimestamp(log.timestamp) }}</span>
            </div>
            <p class="log-description" v-if="log.description">
              {{ log.description }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';

export interface LogEntry {
  agent: string;
  tag: string;
  timestamp: string;
  context: string;
  description: string;
  raw: string;
}

interface Props {
  projectId: string;
  logs?: LogEntry[];
  loading?: boolean;
  isConnected?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  logs: () => [],
  loading: false,
  isConnected: false
});

const emit = defineEmits<{
  (e: 'clear'): void;
}>();

const feedContainer = ref<HTMLElement | null>(null);
const newEntryIndices = ref<Set<number>>(new Set());

// Filter state
const showFilters = ref(false);
const searchQuery = ref('');
const selectedTags = ref<string[]>([]);
const dateRangePreset = ref('all');
const customStartDate = ref('');
const customEndDate = ref('');

// Available tags for filtering
const availableTags = [
  'STARTED',
  'COMPLETED',
  'BLOCKED',
  'DISCOVERED',
  'DECISION',
  'PROGRESS',
  'ERROR',
  'INFO',
  'QUERY',
  'COMMENT',
  'TIER_COMPLETE'
];

// Toggle filters visibility
function toggleFilters() {
  showFilters.value = !showFilters.value;
}

// Toggle tag selection
function toggleTag(tag: string) {
  const index = selectedTags.value.indexOf(tag);
  if (index > -1) {
    selectedTags.value.splice(index, 1);
  } else {
    selectedTags.value.push(tag);
  }
}

// Clear tag filter
function clearTagFilter() {
  selectedTags.value = [];
}

// Handle date preset change
function onDatePresetChange() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (dateRangePreset.value) {
    case 'today':
      customStartDate.value = formatDateForInput(today);
      customEndDate.value = formatDateForInput(today);
      break;
    case 'yesterday':
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      customStartDate.value = formatDateForInput(yesterday);
      customEndDate.value = formatDateForInput(yesterday);
      break;
    case 'last7days':
      const last7 = new Date(today);
      last7.setDate(last7.getDate() - 7);
      customStartDate.value = formatDateForInput(last7);
      customEndDate.value = formatDateForInput(today);
      break;
    case 'last30days':
      const last30 = new Date(today);
      last30.setDate(last30.getDate() - 30);
      customStartDate.value = formatDateForInput(last30);
      customEndDate.value = formatDateForInput(today);
      break;
    case 'all':
      customStartDate.value = '';
      customEndDate.value = '';
      break;
  }
}

// Format date for input element
function formatDateForInput(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Check if any filters are active
const hasActiveFilters = computed(() => {
  return searchQuery.value !== '' ||
    selectedTags.value.length > 0 ||
    (dateRangePreset.value !== 'all' && dateRangePreset.value !== 'custom') ||
    (dateRangePreset.value === 'custom' && (customStartDate.value || customEndDate.value));
});

// Clear all filters
function clearAllFilters() {
  searchQuery.value = '';
  selectedTags.value = [];
  dateRangePreset.value = 'all';
  customStartDate.value = '';
  customEndDate.value = '';
}

// Sort logs by timestamp (newest first)
const sortedLogs = computed(() => {
  return [...props.logs].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeB - timeA;
  });
});

// Filtered logs based on all criteria
const filteredLogs = computed(() => {
  let result = sortedLogs.value;

  // Filter by search query
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(log =>
      log.description.toLowerCase().includes(query) ||
      log.context.toLowerCase().includes(query) ||
      log.tag.toLowerCase().includes(query) ||
      log.raw.toLowerCase().includes(query)
    );
  }

  // Filter by selected tags
  if (selectedTags.value.length > 0) {
    result = result.filter(log =>
      selectedTags.value.includes(log.tag.toUpperCase())
    );
  }

  // Filter by date range
  if (dateRangePreset.value !== 'all') {
    const startDate = customStartDate.value ? new Date(customStartDate.value) : null;
    const endDate = customEndDate.value ? new Date(customEndDate.value) : null;

    if (startDate || endDate) {
      result = result.filter(log => {
        const logDate = new Date(log.timestamp);

        if (startDate && endDate) {
          // Set end date to end of day
          const endOfDay = new Date(endDate);
          endOfDay.setHours(23, 59, 59, 999);
          return logDate >= startDate && logDate <= endOfDay;
        } else if (startDate) {
          return logDate >= startDate;
        } else if (endDate) {
          const endOfDay = new Date(endDate);
          endOfDay.setHours(23, 59, 59, 999);
          return logDate <= endOfDay;
        }
        return true;
      });
    }
  }

  return result;
});

// Check if entry is newly added (for animation)
function isNewEntry(index: number): boolean {
  return newEntryIndices.value.has(index);
}

// Watch for new logs and mark them for animation
watch(() => props.logs.length, (newLength, oldLength) => {
  if (newLength > oldLength) {
    // Mark new entries (use original index in sorted logs)
    const newIndices: number[] = [];
    for (let i = 0; i < newLength - oldLength; i++) {
      newIndices.push(i);
    }
    newEntryIndices.value = new Set(newIndices);

    // Scroll to top to show new entries
    nextTick(() => {
      if (feedContainer.value) {
        feedContainer.value.scrollTop = 0;
      }
    });

    // Clear new entry animation after a delay
    setTimeout(() => {
      newEntryIndices.value.clear();
    }, 2000);
  }
});

function clearFeed() {
  emit('clear');
}

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
    'TIER_COMPLETE': '🏆'
  };
  return icons[tag.toUpperCase()] || '📝';
}

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
</script>

<style scoped>
.activity-feed {
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  border: 1px solid var(--bg-highlight);
  overflow: hidden;
}

.feed-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  background-color: rgba(99, 102, 241, 0.05);
  border-bottom: 1px solid var(--bg-highlight);
}

.feed-header h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.feed-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.log-count {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background-color: var(--bg-highlight);
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
}

.clear-btn {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background: none;
  border: 1px solid var(--bg-highlight);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-btn:hover {
  background-color: var(--bg-highlight);
  color: var(--text-primary);
}

.live-indicator {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  background-color: var(--bg-highlight);
}

.live-indicator.connected {
  background-color: rgba(16, 185, 129, 0.15);
  color: var(--color-success);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--text-secondary);
}

.live-indicator.connected .live-dot {
  background-color: var(--color-success);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.feed-container {
  max-height: 400px;
  overflow-y: auto;
  padding: 0;
}

.feed-loading {
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

.feed-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1.5rem;
  text-align: center;
}

.empty-icon {
  font-size: 2rem;
  margin-bottom: 0.75rem;
  opacity: 0.6;
}

.feed-empty p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.9375rem;
}

.empty-hint {
  font-size: 0.75rem !important;
  opacity: 0.7;
  margin-top: 0.25rem !important;
}

.feed-list {
  display: flex;
  flex-direction: column;
}

.log-entry {
  display: flex;
  gap: 0.875rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--bg-highlight);
  transition: all 0.2s ease;
  animation: slideIn 0.3s ease;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-entry:hover {
  background-color: rgba(255, 255, 255, 0.02);
}

.log-entry.is-new {
  animation: highlightNew 2s ease;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes highlightNew {
  0% {
    background-color: rgba(99, 102, 241, 0.15);
  }
  100% {
    background-color: transparent;
  }
}

.log-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-highlight);
  border-radius: 0.5rem;
}

.tag-badge {
  font-size: 1rem;
}

.log-content {
  flex: 1;
  min-width: 0;
}

.log-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.25rem;
}

.log-tag {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
}

/* Tag-specific colors */
.log-tag.tag-started,
.log-tag.tag-progress {
  background-color: rgba(99, 102, 241, 0.2);
  color: var(--color-primary);
}

.log-tag.tag-completed,
.log-tag.tag-tier_complete {
  background-color: rgba(16, 185, 129, 0.2);
  color: var(--color-success);
}

.log-tag.tag-blocked,
.log-tag.tag-error {
  background-color: rgba(239, 68, 68, 0.2);
  color: var(--color-error);
}

.log-tag.tag-discovered,
.log-tag.tag-decision {
  background-color: rgba(245, 158, 11, 0.2);
  color: var(--color-warning);
}

.log-tag.tag-info,
.log-tag.tag-comment {
  background-color: rgba(148, 163, 184, 0.2);
  color: var(--text-secondary);
}

.log-tag.tag-query {
  background-color: rgba(167, 139, 250, 0.2);
  color: #a78bfa;
}

.log-context {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.log-timestamp {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  margin-left: auto;
}

.log-description {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

/* Filters Section */
.filters-section {
  background-color: var(--bg-highlight);
  border-bottom: 1px solid var(--bg-highlight);
}

.filters-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.25rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.filters-header:hover {
  background-color: rgba(255, 255, 255, 0.02);
}

.filters-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.filter-icon {
  font-size: 1rem;
}

.filters-toggle {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.filters-content {
  padding: 1rem 1.25rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.filter-row {
  margin-bottom: 1rem;
}

.filter-row:last-child {
  margin-bottom: 0;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.filter-group label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.filter-input {
  padding: 0.5rem 0.75rem;
  background-color: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.375rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  transition: border-color 0.2s ease;
}

.filter-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.filter-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.filter-search .filter-input {
  width: 100%;
}

.filter-select {
  padding: 0.5rem 0.75rem;
  background-color: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.375rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.filter-select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.tag-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tag-filter-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background-color: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.375rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-filter-btn:hover {
  border-color: var(--color-primary);
  color: var(--text-primary);
}

.tag-filter-btn.active {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.tag-filter-btn.clear-tags {
  background-color: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--color-error);
}

.tag-filter-btn.clear-tags:hover {
  background-color: rgba(239, 68, 68, 0.2);
}

.date-filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.date-input {
  width: 140px;
}

.date-separator {
  font-size: 0.75rem;
  color: var(--text-secondary);
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
}

.clear-filters-btn:hover {
  background-color: rgba(239, 68, 68, 0.2);
}

/* Responsive */
@media (max-width: 640px) {
  .feed-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .log-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .log-timestamp {
    margin-left: 0;
  }

  .date-filters {
    flex-direction: column;
    align-items: stretch;
  }

  .date-input {
    width: 100%;
  }

  .date-separator {
    text-align: center;
  }
}
</style>
