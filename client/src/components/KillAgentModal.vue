<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="onCancel">
      <div class="modal-container">
        <div class="modal-header">
          <h3 class="modal-title">⚠️ Kill Agent</h3>
          <button class="modal-close" @click="onCancel">×</button>
        </div>

        <div class="modal-body">
          <div class="warning-icon">🛑</div>
          <p class="confirm-message">
            Are you sure you want to kill <strong>{{ agentName }}</strong>?
          </p>
          <div class="agent-details">
            <div class="detail-row">
              <span class="detail-label">PID:</span>
              <span class="detail-value pid">{{ agentPid }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Spawned:</span>
              <span class="detail-value">{{ formatSpawnedAt() }}</span>
            </div>
            <div v-if="expansions && expansions.length > 0" class="detail-row">
              <span class="detail-label">Expansions:</span>
              <span class="detail-value">{{ expansions.length }} active</span>
            </div>
          </div>
          <p class="warning-text">
            This will immediately terminate the agent process. Any ongoing work will be interrupted and cannot be recovered.
          </p>

          <!-- Error Message -->
          <div v-if="error" class="error-message">
            <span class="error-icon">⚠️</span>
            {{ error }}
          </div>
        </div>

        <div class="modal-footer">
          <button
            class="modal-btn secondary"
            @click="onCancel"
            :disabled="isKilling"
          >
            Cancel
          </button>
          <button
            class="modal-btn danger"
            :disabled="isKilling"
            @click="onConfirm"
          >
            <span v-if="isKilling" class="btn-spinner"></span>
            <span v-else class="btn-icon">🛑</span>
            {{ isKilling ? 'Killing...' : 'Kill Agent' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  agentPid: number;
  agentName: string;
  spawnedAt?: string;
  expansions?: string[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'confirmed'): void;
}>();

const isKilling = ref(false);
const error = ref<string | null>(null);

function formatSpawnedAt(): string {
  if (!props.spawnedAt) return 'Unknown';
  const date = new Date(props.spawnedAt);
  return date.toLocaleString();
}

function onCancel() {
  if (isKilling.value) return;
  emit('close');
}

async function onConfirm() {
  if (isKilling.value) return;

  isKilling.value = true;
  error.value = null;

  try {
    const response = await fetch(`/api/agents/${props.agentPid}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || 'Failed to kill agent');
    }

    emit('confirmed');
    emit('close');
  } catch (err) {
    console.error('Error killing agent:', err);
    error.value = err instanceof Error ? err.message : 'Failed to kill agent';
  } finally {
    isKilling.value = false;
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
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
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
  position: sticky;
  top: 0;
  background-color: var(--bg-surface);
  z-index: 10;
}

.modal-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-error);
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
  align-items: center;
  text-align: center;
  gap: 1rem;
}

.warning-icon {
  font-size: 3rem;
  line-height: 1;
}

.confirm-message {
  font-size: 1rem;
  color: var(--text-primary);
  margin: 0;
}

.confirm-message strong {
  color: var(--color-error);
}

.agent-details {
  background-color: var(--bg-highlight);
  border-radius: 0.5rem;
  padding: 1rem;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.875rem;
}

.detail-label {
  color: var(--text-secondary);
}

.detail-value {
  color: var(--text-primary);
  font-weight: 500;
}

.detail-value.pid {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8125rem;
}

.warning-text {
  font-size: 0.875rem;
  color: var(--color-warning);
  margin: 0;
  padding: 0.75rem;
  background-color: rgba(245, 158, 11, 0.1);
  border-radius: 0.5rem;
  border-left: 3px solid var(--color-warning);
}

/* Error Message */
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
  width: 100%;
}

.error-icon {
  font-size: 1rem;
}

/* Modal Footer */
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1.25rem 1.5rem;
  border-top: 1px solid var(--bg-highlight);
  position: sticky;
  bottom: 0;
  background-color: var(--bg-surface);
  z-index: 10;
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

.modal-btn.secondary:hover:not(:disabled) {
  background-color: var(--color-primary);
  color: white;
}

.modal-btn.danger {
  background-color: var(--color-error);
  color: white;
}

.modal-btn.danger:hover:not(:disabled) {
  background-color: #dc2626;
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
    max-height: calc(100vh - 1rem);
  }

  .modal-footer {
    flex-direction: column-reverse;
  }

  .modal-btn {
    width: 100%;
    justify-content: center;
  }

  .detail-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
}
</style>
