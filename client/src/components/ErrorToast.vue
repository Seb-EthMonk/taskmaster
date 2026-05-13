<template>
  <Teleport to="body">
    <div class="toast-container" :class="{ 'has-toasts': errorStore.hasErrors }">
      <TransitionGroup name="toast">
        <div
          v-for="toast in errorStore.toasts"
          :key="toast.id"
          class="toast"
          :class="`toast-${toast.type}`"
          @click="errorStore.removeToast(toast.id)"
        >
          <div class="toast-icon">{{ getIcon(toast.type) }}</div>
          <div class="toast-content">
            <h4 class="toast-title">{{ toast.title }}</h4>
            <p class="toast-message">{{ toast.message }}</p>
          </div>
          <button
            class="toast-close"
            @click.stop="errorStore.removeToast(toast.id)"
            title="Dismiss"
          >
            ×
          </button>
          <div class="toast-progress" :style="{ animationDuration: `${toast.duration}ms` }"></div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useErrorStore } from '../stores/errors';

const errorStore = useErrorStore();

function getIcon(type: string): string {
  switch (type) {
    case 'error':
      return '⚠️';
    case 'warning':
      return '⚡';
    case 'success':
      return '✓';
    case 'info':
      return 'ℹ';
    default:
      return '⚠️';
  }
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 400px;
  width: calc(100% - 2rem);
  pointer-events: none;
}

.toast-container.has-toasts {
  pointer-events: auto;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  border: 1px solid var(--bg-highlight);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.2s ease;
}

.toast:hover {
  transform: translateX(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

.toast-error {
  border-left: 4px solid var(--color-error);
}

.toast-warning {
  border-left: 4px solid var(--color-warning);
}

.toast-success {
  border-left: 4px solid var(--color-success);
}

.toast-info {
  border-left: 4px solid var(--color-primary);
}

.toast-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
  margin-top: 0.125rem;
}

.toast-content {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.25rem 0;
  line-height: 1.3;
}

.toast-message {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
  word-wrap: break-word;
}

.toast-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.toast-close:hover {
  background-color: var(--bg-highlight);
  color: var(--text-primary);
}

/* Progress bar animation */
.toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background-color: currentColor;
  opacity: 0.3;
  animation: progress linear forwards;
}

.toast-error .toast-progress {
  color: var(--color-error);
}

.toast-warning .toast-progress {
  color: var(--color-warning);
}

.toast-success .toast-progress {
  color: var(--color-success);
}

.toast-info .toast-progress {
  color: var(--color-primary);
}

@keyframes progress {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}

/* Transitions */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

/* Responsive */
@media (max-width: 480px) {
  .toast-container {
    top: 0.5rem;
    right: 0.5rem;
    left: 0.5rem;
    width: auto;
    max-width: none;
  }

  .toast {
    padding: 0.875rem;
  }

  .toast-title {
    font-size: 0.875rem;
  }

  .toast-message {
    font-size: 0.8125rem;
  }
}
</style>
