<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="onClose">
      <div class="modal-container">
        <div class="modal-header">
          <h3 class="modal-title">📁 Create New Project</h3>
          <button class="modal-close" @click="onClose">×</button>
        </div>

        <div class="modal-body">
          <!-- Project Name -->
          <div class="form-field">
            <label class="field-label">
              Project Name <span class="required">*</span>
            </label>
            <input
              v-model="form.name"
              type="text"
              class="field-input"
              placeholder="e.g., My Awesome Project"
              :disabled="isSubmitting"
              @blur="validateName"
              @keydown.enter.prevent="onSubmit"
            />
            <p class="field-hint">This will be displayed as the project name.</p>
            <p v-if="errors.name" class="field-error">{{ errors.name }}</p>
          </div>

          <!-- Project ID (optional) -->
          <div class="form-field">
            <label class="field-label">Project ID (optional)</label>
            <input
              v-model="form.id"
              type="text"
              class="field-input"
              placeholder="auto-generated-from-name"
              :disabled="isSubmitting"
              @blur="validateId"
            />
            <p class="field-hint">Used for the folder name. Auto-generated if empty.</p>
            <p v-if="errors.id" class="field-error">{{ errors.id }}</p>
          </div>

          <!-- Error Message -->
          <div v-if="error" class="error-message">
            <span class="error-icon">⚠️</span>
            {{ error }}
          </div>
        </div>

        <div class="modal-footer">
          <button class="modal-btn secondary" @click="onClose" :disabled="isSubmitting">
            Cancel
          </button>
          <button
            class="modal-btn primary"
            :disabled="!isValid || isSubmitting"
            @click="onSubmit"
          >
            <span v-if="isSubmitting" class="btn-spinner"></span>
            <span v-else class="btn-icon">✓</span>
            {{ isSubmitting ? 'Creating...' : 'Create Project' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';

interface FormState {
  name: string;
  id: string;
}

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created'): void;
}>();

const form = reactive<FormState>({
  name: '',
  id: ''
});

const errors = reactive({
  name: '',
  id: ''
});

const isSubmitting = ref(false);
const error = ref<string | null>(null);

const isValid = computed(() => {
  return form.name.trim().length > 0 && !errors.name && !errors.id;
});

function validateName() {
  errors.name = '';
  const name = form.name.trim();

  if (!name) {
    errors.name = 'Project name is required';
    return false;
  }

  return true;
}

function validateId() {
  errors.id = '';
  const id = form.id.trim();

  if (id) {
    // Check for valid characters
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    if (!validPattern.test(id)) {
      errors.id = 'ID can only contain letters, numbers, hyphens, and underscores';
      return false;
    }
  }

  return true;
}

function generateProjectId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function onClose() {
  if (isSubmitting.value) return;
  emit('close');
}

async function onSubmit() {
  if (isSubmitting.value || !isValid.value) return;

  if (!validateName()) {
    return;
  }

  isSubmitting.value = true;
  error.value = null;

  try {
    const projectId = form.id.trim() || generateProjectId(form.name.trim());

    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        id: projectId
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to create project');
    }

    // Emit success and close
    emit('created');
    emit('close');
  } catch (err) {
    console.error('Error creating project:', err);
    error.value = err instanceof Error ? err.message : 'Failed to create project';
  } finally {
    isSubmitting.value = false;
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
  max-width: 500px;
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
  color: var(--text-primary);
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
  gap: 1.25rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.field-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.required {
  color: var(--color-error);
}

.field-input {
  padding: 0.625rem 0.875rem;
  background-color: var(--bg-highlight);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.9375rem;
  transition: border-color 0.2s ease;
}

.field-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.field-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.field-hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin: 0;
}

.field-error {
  font-size: 0.75rem;
  color: var(--color-error);
  margin: 0;
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

.modal-btn.primary {
  background-color: var(--color-success);
  color: white;
}

.modal-btn.primary:hover:not(:disabled) {
  background-color: #059669;
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
}
</style>
