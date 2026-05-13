<template>
  <div class="tier-collapse-container">
    <button
      class="collapse-btn"
      :class="{ 'is-open': showDropdown }"
      :disabled="isCollapsing || !hasCompletedTasks"
      @click="toggleDropdown"
      title="Collapse completed tasks to a lower tier"
    >
      <span v-if="isCollapsing" class="btn-spinner-small"></span>
      <span v-else class="btn-icon">⬇</span>
      <span class="btn-text">Collapse</span>
    </button>

    <!-- Dropdown Menu -->
    <div v-if="showDropdown" class="collapse-dropdown" ref="dropdownRef">
      <div class="dropdown-header">
        <span class="dropdown-title">Collapse to Tier:</span>
        <button class="close-btn" @click="closeDropdown">×</button>
      </div>
      <div class="dropdown-options">
        <button
          v-for="tier in availableTargetTiers"
          :key="tier"
          class="tier-option"
          :class="{ 'has-tasks': getCompletedTaskCount(tier) > 0 }"
          :disabled="getCompletedTaskCount(tier) === 0"
          @click="collapseToTier(tier)"
        >
          <span class="tier-label">Tier {{ tier }}</span>
          <span class="tier-name">{{ getTierName(tier) }}</span>
          <span class="task-count">{{ getCompletedTaskCount(tier) }} completed</span>
        </button>
      </div>
      <div class="dropdown-hint">
        Moves completed tasks from selected tier and above
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface Task {
  id: string;
  tier: number;
  status: string;
}

interface Props {
  tasks: Task[];
  projectId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'collapse-complete'): void;
}>();

// State
const showDropdown = ref(false);
const isCollapsing = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

// Tier names mapping — canonical TaskMaster v3 tiers
const tierNames: Record<number, string> = {
  0: 'Discovery',
  1: 'Strategy',
  2: 'Architecture',
  3: 'Execution',
  4: 'Delivery',
  5: 'Final'
};

function getTierName(tier: number): string {
  return tierNames[tier] || `Tier ${tier}`;
}

// Get unique tiers from tasks, sorted
const availableTiers = computed(() => {
  if (!props.tasks || props.tasks.length === 0) return [];
  const tiers = new Set(props.tasks.map(t => t.tier));
  return Array.from(tiers).sort((a, b) => a - b);
});

// All possible target tiers (0-5)
const availableTargetTiers = computed(() => {
  return [0, 1, 2, 3, 4, 5];
});

// Check if there are any completed tasks
const hasCompletedTasks = computed(() => {
  return props.tasks.some(t => t.status === 'done');
});

// Get count of completed tasks that would be moved to a target tier
// (tasks from target tier and above that are completed)
function getCompletedTaskCount(targetTier: number): number {
  return props.tasks.filter(t =>
    t.status === 'done' && t.tier >= targetTier
  ).length;
}

function toggleDropdown() {
  showDropdown.value = !showDropdown.value;
}

function closeDropdown() {
  showDropdown.value = false;
}

// Close dropdown when clicking outside
function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    const target = event.target as HTMLElement;
    if (!target.closest('.collapse-btn')) {
      closeDropdown();
    }
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

// Perform the collapse operation
async function collapseToTier(targetTier: number) {
  if (isCollapsing.value) return;

  // Get completed tasks from target tier and above
  const tasksToMove = props.tasks.filter(t =>
    t.status === 'done' && t.tier >= targetTier
  );

  if (tasksToMove.length === 0) {
    closeDropdown();
    return;
  }

  isCollapsing.value = true;

  try {
    const taskIds = tasksToMove.map(t => t.id);

    const response = await fetch(
      `/api/projects/${props.projectId}/tasks/bulk`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskIds,
          updates: { tier: targetTier },
          updated_by: 'user'
        })
      }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Failed to collapse tasks: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`[TierCollapse] Collapsed ${result.updated?.length || 0} tasks to Tier ${targetTier}`);

    // Close dropdown and emit completion
    closeDropdown();
    emit('collapse-complete');
  } catch (err) {
    console.error('[TierCollapse] Error collapsing tasks:', err);
    alert(err instanceof Error ? err.message : 'Failed to collapse tasks');
  } finally {
    isCollapsing.value = false;
  }
}
</script>

<style scoped>
.tier-collapse-container {
  position: relative;
  display: inline-block;
}

.collapse-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: linear-gradient(135deg, #4a5568 0%, #2d3748 100%);
  color: #e2e8f0;
  border: 1px solid #4a5568;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.collapse-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #55616e 0%, #374151 100%);
  border-color: #718096;
  transform: translateY(-1px);
}

.collapse-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.collapse-btn.is-open {
  background: linear-gradient(135deg, #3182ce 0%, #2c5282 100%);
  border-color: #4299e1;
}

.btn-icon {
  font-size: 12px;
}

.btn-text {
  font-size: 13px;
}

.btn-spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Dropdown Styles */
.collapse-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  min-width: 240px;
  background: #1a202c;
  border: 1px solid #4a5568;
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  z-index: 100;
  overflow: hidden;
}

.dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #2d3748;
  border-bottom: 1px solid #4a5568;
}

.dropdown-title {
  font-size: 13px;
  font-weight: 600;
  color: #e2e8f0;
}

.close-btn {
  background: none;
  border: none;
  color: #a0aec0;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #4a5568;
  color: #e2e8f0;
}

.dropdown-options {
  padding: 8px;
}

.tier-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: #2d3748;
  border: 1px solid transparent;
  border-radius: 6px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.tier-option:last-child {
  margin-bottom: 0;
}

.tier-option:hover:not(:disabled) {
  background: #374151;
  border-color: #4a5568;
}

.tier-option:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tier-option.has-tasks {
  background: linear-gradient(135deg, #2d3748 0%, #1a365d 100%);
  border-color: #2b6cb0;
}

.tier-option.has-tasks:hover {
  background: linear-gradient(135deg, #374151 0%, #2c5282 100%);
  border-color: #3182ce;
}

.tier-label {
  font-size: 13px;
  font-weight: 600;
  color: #63b3ed;
  min-width: 50px;
}

.tier-name {
  font-size: 12px;
  color: #a0aec0;
  flex: 1;
}

.task-count {
  font-size: 11px;
  color: #68d391;
  background: rgba(104, 211, 145, 0.1);
  padding: 2px 8px;
  border-radius: 12px;
}

.dropdown-hint {
  padding: 10px 16px;
  font-size: 11px;
  color: #718096;
  background: #171923;
  border-top: 1px solid #2d3748;
  text-align: center;
}
</style>
