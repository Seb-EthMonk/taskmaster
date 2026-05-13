import { ref, computed, onMounted, onUnmounted } from 'vue';

export type RecencyLevel = 'fresh' | 'recent' | 'old';

export function useRecency() {
  const now = ref(Date.now());
  let interval: ReturnType<typeof setInterval> | null = null;

  // Update 'now' every 10 seconds to recalculate recency
  onMounted(() => {
    interval = setInterval(() => {
      now.value = Date.now();
    }, 10000);
  });

  onUnmounted(() => {
    if (interval) {
      clearInterval(interval);
    }
  });

  function getRecencyLevel(timestamp: string): RecencyLevel {
    const time = new Date(timestamp).getTime();
    const diffMs = now.value - time;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 5) {
      return 'fresh'; // Green: < 5 minutes
    } else if (diffMins < 20) {
      return 'recent'; // Orange: 5-20 minutes
    } else {
      return 'old'; // No special color: > 20 minutes
    }
  }

  function getRecencyClass(timestamp: string): string {
    const level = getRecencyLevel(timestamp);
    return `recency-${level}`;
  }

  return {
    now: computed(() => now.value),
    getRecencyLevel,
    getRecencyClass
  };
}
