<template>
  <div class="archive-tab">
    <!-- Status Cards -->
    <div class="status-cards">
      <div class="status-card" :class="{ archived: isArchived }">
        <div class="status-icon">{{ isArchived ? '📦' : '📁' }}</div>
        <div class="status-info">
          <span class="status-label">Project Status</span>
          <span class="status-value">{{ isArchived ? 'Archived' : 'Active' }}</span>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="actions-section">
      <h3 class="section-title">Actions</h3>

      <div class="action-buttons">
        <!-- Archive Button -->
        <button
          v-if="!isArchived"
          class="action-btn archive-btn"
          :disabled="isLoading"
          @click="showArchiveConfirm = true"
        >
          <span class="btn-icon">📦</span>
          <div class="btn-content">
            <span class="btn-title">Archive Project</span>
            <span class="btn-desc">Move project to Archive folder</span>
          </div>
        </button>

        <!-- Restore Button -->
        <button
          v-if="isArchived"
          class="action-btn restore-btn"
          :disabled="isLoading"
          @click="showRestoreConfirm = true"
        >
          <span class="btn-icon">📂</span>
          <div class="btn-content">
            <span class="btn-title">Restore Project</span>
            <span class="btn-desc">Move project back to Projects folder</span>
          </div>
        </button>

        <!-- Restore as Copy Button -->
        <button
          v-if="isArchived"
          class="action-btn restore-copy-btn"
          :disabled="isLoading"
          @click="showRestoreCopyModal = true"
        >
          <span class="btn-icon">📋</span>
          <div class="btn-content">
            <span class="btn-title">Restore as Copy</span>
            <span class="btn-desc">Create a copy in Projects with new name</span>
          </div>
        </button>

      </div>
    </div>

    <!-- Archive Confirmation Modal -->
    <Teleport to="body">
      <div v-if="showArchiveConfirm" class="modal-overlay" @click.self="showArchiveConfirm = false">
        <div class="modal-container">
          <div class="modal-header">
            <h3 class="modal-title">
              <span class="modal-icon">⚠️</span>
              Archive Project
            </h3>
            <button class="modal-close" @click="showArchiveConfirm = false">×</button>
          </div>
          <div class="modal-body">
            <p class="modal-message">
              You are about to archive project <strong>{{ projectName }}</strong>.
            </p>
            <div class="modal-warning">
              <span class="warning-icon">📦</span>
              <p>This will move the entire project folder to the Archive directory. The project will no longer appear in the active projects list.</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-btn secondary" @click="showArchiveConfirm = false">Cancel</button>
            <button
              class="modal-btn archive-confirm-btn"
              :disabled="isLoading"
              @click="archiveProject"
            >
              <span v-if="isLoading" class="btn-spinner-small"></span>
              {{ isLoading ? 'Archiving...' : 'Archive Project' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Restore Confirmation Modal -->
    <Teleport to="body">
      <div v-if="showRestoreConfirm" class="modal-overlay" @click.self="showRestoreConfirm = false">
        <div class="modal-container">
          <div class="modal-header">
            <h3 class="modal-title">
              <span class="modal-icon">⚠️</span>
              Restore Project
            </h3>
            <button class="modal-close" @click="showRestoreConfirm = false">×</button>
          </div>
          <div class="modal-body">
            <p class="modal-message">
              You are about to restore project <strong>{{ projectName }}</strong>.
            </p>
            <div class="modal-warning">
              <span class="warning-icon">📂</span>
              <p>This will move the project from the Archive directory back to the Projects directory.</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-btn secondary" @click="showRestoreConfirm = false">Cancel</button>
            <button
              class="modal-btn restore-confirm-btn"
              :disabled="isLoading"
              @click="restoreProject"
            >
              <span v-if="isLoading" class="btn-spinner-small"></span>
              {{ isLoading ? 'Restoring...' : 'Restore Project' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Restore as Copy Modal -->
    <Teleport to="body">
      <div v-if="showRestoreCopyModal" class="modal-overlay" @click.self="showRestoreCopyModal = false">
        <div class="modal-container">
          <div class="modal-header">
            <h3 class="modal-title">
              <span class="modal-icon">📋</span>
              Restore as Copy
            </h3>
            <button class="modal-close" @click="showRestoreCopyModal = false">×</button>
          </div>
          <div class="modal-body">
            <p class="modal-message">
              Create a copy of <strong>{{ projectName }}</strong> in the Projects directory.
            </p>
            <div class="form-group">
              <label for="copy-name">New Project Name</label>
              <input
                id="copy-name"
                v-model="copyName"
                type="text"
                class="form-input"
                placeholder="Enter new project name"
                @keyup.enter="restoreAsCopy"
              />
              <p v-if="copyNameError" class="form-error">{{ copyNameError }}</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-btn secondary" @click="showRestoreCopyModal = false">Cancel</button>
            <button
              class="modal-btn restore-confirm-btn"
              :disabled="isLoading || !copyName.trim()"
              @click="restoreAsCopy"
            >
              <span v-if="isLoading" class="btn-spinner-small"></span>
              {{ isLoading ? 'Creating Copy...' : 'Create Copy' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Error Toast -->
    <div v-if="error" class="error-toast">
      <span class="error-icon">⚠️</span>
      <span class="error-message">{{ error }}</span>
      <button class="error-close" @click="error = null">×</button>
    </div>

    <!-- Success Toast -->
    <div v-if="successMessage" class="success-toast">
      <span class="success-icon">✓</span>
      <span class="success-message">{{ successMessage }}</span>
      <button class="success-close" @click="successMessage = null">×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps<{
  projectId: string;
  projectName: string;
  projectPath: string;
}>();

const router = useRouter();

// State
const isArchived = ref(false);
const isLoading = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);

// Modal state
const showArchiveConfirm = ref(false);
const showRestoreConfirm = ref(false);
const showRestoreCopyModal = ref(false);
const copyName = ref('');
const copyNameError = ref('');

// Fetch archive status on mount
onMounted(async () => {
  await fetchArchiveStatus();
});

// Fetch archive status
async function fetchArchiveStatus() {
  try {
    const response = await fetch(`/api/projects/${props.projectId}/archive/status`);
    if (response.ok) {
      const data = await response.json();
      isArchived.value = data.isArchived;
    }
  } catch (err) {
    console.error('Error fetching archive status:', err);
  }
}

// Archive project
async function archiveProject() {
  isLoading.value = true;
  error.value = null;

  try {
    const response = await fetch(`/api/projects/${props.projectId}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to archive project');
    }

    successMessage.value = 'Project archived successfully';
    isArchived.value = true;
    showArchiveConfirm.value = false;

    // Redirect to projects list after a short delay
    setTimeout(() => {
      router.push('/projects');
    }, 1500);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to archive project';
  } finally {
    isLoading.value = false;
  }
}

// Restore project
async function restoreProject() {
  isLoading.value = true;
  error.value = null;

  try {
    const response = await fetch(`/api/projects/${props.projectId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to restore project');
    }

    successMessage.value = 'Project restored successfully';
    isArchived.value = false;
    showRestoreConfirm.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to restore project';
  } finally {
    isLoading.value = false;
  }
}

// Restore as copy
async function restoreAsCopy() {
  if (!copyName.value.trim()) {
    copyNameError.value = 'Please enter a name for the copy';
    return;
  }

  isLoading.value = true;
  error.value = null;
  copyNameError.value = '';

  try {
    const response = await fetch(`/api/projects/${props.projectId}/restore-copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: copyName.value.trim() })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to create copy');
    }

    successMessage.value = `Project restored as "${copyName.value}"`;
    showRestoreCopyModal.value = false;
    copyName.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create copy';
  } finally {
    isLoading.value = false;
  }
}

// Format date
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}


</script>

<style scoped>
.archive-tab {
  padding: 1.5rem;
}

/* Status Cards */
.status-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.status-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.75rem;
  transition: all 0.2s ease;
}

.status-card.archived {
  background-color: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.3);
}

.status-icon {
  font-size: 1.5rem;
}

.status-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.status-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.status-card.archived .status-value {
  color: var(--color-warning);
}

/* Actions Section */
.actions-section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 1rem 0;
}

.action-buttons {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  background-color: var(--bg-surface);
  border: 2px solid var(--bg-highlight);
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.btn-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.btn-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}

.btn-desc {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.archive-btn {
  border-color: rgba(245, 158, 11, 0.3);
}

.archive-btn:hover:not(:disabled) {
  border-color: var(--color-warning);
  background-color: rgba(245, 158, 11, 0.05);
}

.restore-btn {
  border-color: rgba(16, 185, 129, 0.3);
}

.restore-btn:hover:not(:disabled) {
  border-color: var(--color-success);
  background-color: rgba(16, 185, 129, 0.05);
}

.restore-copy-btn {
  border-color: rgba(99, 102, 241, 0.3);
}

.restore-copy-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  background-color: rgba(99, 102, 241, 0.05);
}

/* Modal Styles */
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
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.modal-icon {
  font-size: 1.25rem;
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
}

.modal-message {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  margin: 0 0 1.25rem 0;
  line-height: 1.5;
}

.modal-message strong {
  color: var(--text-primary);
}

.modal-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  background-color: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 0.5rem;
}

.warning-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.modal-warning p {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
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

.modal-btn.archive-confirm-btn {
  background-color: var(--color-warning);
  color: white;
}

.modal-btn.archive-confirm-btn:hover:not(:disabled) {
  background-color: #d97706;
}

.modal-btn.restore-confirm-btn {
  background-color: var(--color-success);
  color: white;
}

.modal-btn.restore-confirm-btn:hover:not(:disabled) {
  background-color: #059669;
}

.modal-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-spinner-small {
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

/* Form Styles */
.form-group {
  margin-top: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.form-input {
  width: 100%;
  padding: 0.75rem 1rem;
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.9375rem;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.form-error {
  font-size: 0.75rem;
  color: var(--color-error);
  margin: 0.5rem 0 0 0;
}

/* Toast Notifications */
.error-toast,
.success-toast {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-radius: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  animation: toastIn 0.3s ease;
  z-index: 1001;
}

.error-toast {
  background-color: rgba(239, 68, 68, 0.95);
  color: white;
}

.success-toast {
  background-color: rgba(16, 185, 129, 0.95);
  color: white;
}

@keyframes toastIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.error-icon,
.success-icon {
  font-size: 1.125rem;
  flex-shrink: 0;
}

.error-message,
.success-message {
  font-size: 0.875rem;
  flex: 1;
}

.error-close,
.success-close {
  background: none;
  border: none;
  color: white;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
  opacity: 0.8;
  transition: opacity 0.2s ease;
}

.error-close:hover,
.success-close:hover {
  opacity: 1;
}

/* Responsive */
@media (max-width: 640px) {
  .archive-tab {
    padding: 1rem;
  }

  .action-buttons {
    grid-template-columns: 1fr;
  }

  .backup-info {
    flex-wrap: wrap;
  }

  .backup-name {
    width: 100%;
  }

  .modal-footer {
    flex-direction: column-reverse;
  }

  .modal-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
