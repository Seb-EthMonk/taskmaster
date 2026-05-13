<template>
  <div class="agent-selector">
    <label class="field-label">Agent Assignment</label>

    <div v-if="loading" class="loading-state">
      <span class="spinner-small"></span>
      <span class="loading-text">Loading agents...</span>
    </div>

    <div v-else-if="error" class="error-state">
      <span class="error-icon">⚠️</span>
      <span class="error-text">{{ error }}</span>
    </div>

    <div v-else class="selector-container">
      <select
        class="agent-dropdown"
        :value="modelValue"
        @change="onSelectChange"
        :disabled="disabled"
      >
        <option value="">Auto-assign (by tier)</option>
        <option
          v-for="agent in agents"
          :key="agent.id"
          :value="agent.id"
        >
          {{ agent.name }}
        </option>
      </select>

      <div v-if="selectedAgent" class="agent-info">
        <span class="agent-badge" :class="{ 'auto-assigned': !modelValue }">
          <span class="badge-icon">🤖</span>
          {{ selectedAgent.name }}
        </span>
        <p class="agent-description">{{ selectedAgent.description }}</p>
      </div>

      <p v-else class="auto-assign-hint">
        <span class="hint-icon">💡</span>
        Task will be assigned based on tier requirements
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

export interface Agent {
  id: string;
  name: string;
  description: string;
  tools: string[];
  availableExpansions: string[];
  allExpansions: string[];
}

interface Props {
  modelValue: string;
  disabled?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const agents = ref<Agent[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// Get the currently selected agent
const selectedAgent = computed(() => {
  if (!props.modelValue) return null;
  return agents.value.find(a => a.id === props.modelValue) || null;
});

function onSelectChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  emit('update:modelValue', target.value);
}

async function fetchAgents() {
  loading.value = true;
  error.value = null;

  try {
    const response = await fetch('/api/agents');
    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`);
    }
    const data = await response.json();
    agents.value = data;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load agents';
    console.error('Error fetching agents:', err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchAgents();
});
</script>

<style scoped>
.agent-selector {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.selector-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.agent-dropdown {
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  color: var(--text-primary);
  background-color: var(--bg-highlight);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  padding-right: 2rem;
}

.agent-dropdown:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.agent-dropdown:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.agent-dropdown:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.agent-dropdown option {
  background-color: var(--bg-surface);
  color: var(--text-primary);
}

.agent-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background-color: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 0.5rem;
}

.agent-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background-color: rgba(99, 102, 241, 0.2);
  color: var(--color-primary);
  font-size: 0.8125rem;
  font-weight: 600;
  border-radius: 0.375rem;
  width: fit-content;
}

.agent-badge.auto-assigned {
  background-color: rgba(148, 163, 184, 0.2);
  color: var(--text-secondary);
}

.badge-icon {
  font-size: 0.875rem;
}

.agent-description {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.auto-assign-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  background-color: var(--bg-highlight);
  border-radius: 0.5rem;
}

.hint-icon {
  font-size: 0.875rem;
}

/* Loading State */
.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.875rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid var(--bg-highlight);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loading-text {
  color: var(--text-secondary);
}

/* Error State */
.error-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.875rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.5rem;
  color: var(--color-error);
  font-size: 0.8125rem;
}

.error-icon {
  font-size: 0.875rem;
}
</style>
