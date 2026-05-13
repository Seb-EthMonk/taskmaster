<template>
  <div class="energy-bar-container">
    <!-- Energy Bar Display -->
    <div
      v-if="energyStore.isEnabled"
      class="energy-bar-wrapper"
      :title="energyTooltip"
      @click="toggleFeedItems"
    >
      <div class="energy-bar">
        <div
          class="energy-fill"
          :style="{ width: `${energyStore.energyPercentage}%`, backgroundColor: energyStore.energyBarColor }"
        ></div>
      </div>
      <span class="energy-text" :class="{ 'warning': energyStore.isBelowThreshold || energyStore.isAtZero }">
        {{ energyStore.currentEnergy }}/{{ energyStore.maxEnergy }}
      </span>
      <span class="energy-chevron" :class="{ 'open': showFeedItems }">▲</span>
    </div>

    <!-- Energy Feed Items (dropdown style) -->
    <Transition name="feed-dropdown">
      <div v-if="energyStore.isEnabled && showFeedItems" class="feed-items-dropdown" @click.stop>
        <div class="feed-items-header">
          <span class="feed-header-text">Feed Your TaskMaster</span>
          <button class="feed-close-btn" @click="showFeedItems = false">×</button>
        </div>
        <div class="feed-items-list">
          <button
            v-for="item in FEED_ITEMS"
            :key="item.id"
            class="feed-item"
            @click="feedEnergy(item.id)"
            :title="`Feed ${item.name} (+${item.amount} energy)`"
          >
            <span class="feed-item-emoji">{{ item.emoji }}</span>
            <span class="feed-item-name">{{ item.name }}</span>
            <span class="feed-item-amount">+{{ item.amount }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useEnergyStore, FEED_ITEMS } from '../stores/energy';

const energyStore = useEnergyStore();
const showFeedItems = ref(false);

const energyTooltip = computed(() => {
  if (!energyStore.isEnabled) return '';
  return `Energy: ${energyStore.currentEnergy}/${energyStore.maxEnergy} (${energyStore.energyPercentage}%) — Click to feed`;
});

function toggleFeedItems() {
  showFeedItems.value = !showFeedItems.value;
}

function feedEnergy(feedItemId: string) {
  energyStore.feedEnergy(feedItemId);
  showFeedItems.value = false;
}

// Close dropdown when clicking outside
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('.energy-bar-container')) {
    showFeedItems.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.energy-bar-container {
  position: relative;
  margin-bottom: 0.5rem;
}

/* Energy Bar Wrapper */
.energy-bar-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: linear-gradient(135deg, rgba(26, 26, 36, 0.9) 0%, rgba(36, 36, 52, 0.9) 100%);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid rgba(99, 102, 241, 0.2);
  backdrop-filter: blur(8px);
}

.energy-bar-wrapper:hover {
  background: linear-gradient(135deg, rgba(36, 36, 52, 0.95) 0%, rgba(46, 46, 66, 0.95) 100%);
  border-color: rgba(99, 102, 241, 0.4);
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.15);
}

/* Energy Bar */
.energy-bar {
  flex: 1;
  height: 6px;
  background-color: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.energy-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s ease;
  position: relative;
}

.energy-fill::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 20px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2));
  border-radius: 0 3px 3px 0;
}

.energy-text {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 2.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.energy-text.warning {
  color: #f59e0b;
  animation: pulse-warning 2s ease-in-out infinite;
}

@keyframes pulse-warning {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.energy-chevron {
  font-size: 0.5rem;
  color: var(--text-secondary);
  opacity: 0.5;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.energy-chevron.open {
  transform: rotate(180deg);
  opacity: 1;
  color: var(--color-primary);
}

/* Feed Items Dropdown */
.feed-items-dropdown {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 0;
  right: 0;
  background: linear-gradient(180deg, rgba(30, 30, 44, 0.98) 0%, rgba(24, 24, 36, 0.98) 100%);
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 0.625rem;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(99, 102, 241, 0.1);
  z-index: 1000;
  overflow: hidden;
  backdrop-filter: blur(12px);
}

.feed-items-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 0.875rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(99, 102, 241, 0.08);
}

.feed-header-text {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.feed-close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  transition: all 0.15s ease;
}

.feed-close-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.feed-items-list {
  display: flex;
  flex-direction: column;
  padding: 0.375rem;
  gap: 0.125rem;
}

.feed-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  background: none;
  border: none;
  border-radius: 0.375rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.feed-item:hover {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(99, 102, 241, 0.05) 100%);
  transform: translateX(2px);
}

.feed-item:active {
  transform: translateX(2px) scale(0.98);
}

.feed-item-emoji {
  font-size: 1.125rem;
  filter: saturate(1.2);
}

.feed-item-name {
  flex: 1;
  font-weight: 500;
  font-size: 0.8125rem;
}

.feed-item-amount {
  font-weight: 700;
  color: #4ade80;
  font-size: 0.8125rem;
  background: rgba(74, 222, 128, 0.1);
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
}

/* Dropdown transition */
.feed-dropdown-enter-active,
.feed-dropdown-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.feed-dropdown-enter-from,
.feed-dropdown-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.feed-dropdown-enter-to,
.feed-dropdown-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}
</style>
