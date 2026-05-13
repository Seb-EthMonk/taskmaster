<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="onClose">
      <div class="modal-container">
        <div class="modal-header">
          <h3 class="modal-title">🤖 Create New Agent</h3>
          <button class="modal-close" @click="onClose">×</button>
        </div>

        <div class="modal-body">
          <!-- Agent Name -->
          <div class="form-field">
            <label class="field-label">
              Agent Name <span class="required">*</span>
            </label>
            <input
              v-model="form.name"
              type="text"
              class="field-input"
              placeholder="e.g., code-reviewer"
              :disabled="isSubmitting"
              @blur="validateName"
            />
            <p class="field-hint">Used as filename. Alphanumeric, hyphens, and underscores only.</p>
            <p v-if="errors.name" class="field-error">{{ errors.name }}</p>
          </div>

          <!-- Description -->
          <div class="form-field">
            <label class="field-label">Description</label>
            <textarea
              v-model="form.description"
              class="field-textarea"
              rows="2"
              placeholder="Brief description of what this agent does..."
              :disabled="isSubmitting"
            ></textarea>
          </div>

          <!-- System Prompt -->
          <div class="form-field">
            <label class="field-label">System Prompt</label>
            <textarea
              v-model="form.systemPrompt"
              class="field-textarea"
              rows="4"
              placeholder="Detailed instructions for the agent's behavior and responsibilities..."
              :disabled="isSubmitting"
            ></textarea>
          </div>

          <!-- Model -->
          <div class="form-field">
            <label class="field-label">Model</label>
            <input
              v-model="form.model"
              type="text"
              class="field-input"
              placeholder="e.g., claude-sonnet-4.6"
              :disabled="isSubmitting"
            />
            <p class="field-hint">Optional: Specify the AI model for this agent</p>
          </div>

          <!-- Tools -->
          <div class="form-field">
            <label class="field-label">Tools</label>
            <div class="tags-input">
              <div class="tags-list">
                <span v-for="(tool, index) in form.tools" :key="index" class="tag">
                  {{ tool }}
                  <button class="tag-remove" @click="removeTool(index)" :disabled="isSubmitting">×</button>
                </span>
              </div>
              <input
                v-model="newTool"
                type="text"
                class="tag-input"
                placeholder="Add tool (e.g., Read, Write, Bash)..."
                :disabled="isSubmitting"
                @keydown.enter.prevent="addTool"
              />
            </div>
            <p class="field-hint">Press Enter to add a tool</p>
          </div>

          <!-- Expansions -->
          <div class="form-field">
            <label class="field-label">Expansions</label>
            <div class="tags-input">
              <div class="tags-list">
                <span v-for="(expansion, index) in form.expansions" :key="index" class="tag expansion">
                  {{ expansion }}
                  <button class="tag-remove" @click="removeExpansion(index)" :disabled="isSubmitting">×</button>
                </span>
              </div>
              <input
                v-model="newExpansion"
                type="text"
                class="tag-input"
                placeholder="Add expansion..."
                :disabled="isSubmitting"
                @keydown.enter.prevent="addExpansion"
              />
            </div>
            <p class="field-hint">Press Enter to add an expansion</p>
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
            {{ isSubmitting ? 'Creating...' : 'Create Agent' }}
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
  description: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  expansions: string[];
}

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created'): void;
}>();

const form = reactive<FormState>({
  name: '',
  description: '',
  systemPrompt: '',
  model: '',
  tools: [],
  expansions: []
});

const errors = reactive({
  name: ''
});

const newTool = ref('');
const newExpansion = ref('');
const isSubmitting = ref(false);
const error = ref<string | null>(null);

const isValid = computed(() => {
  return form.name.trim().length > 0 && !errors.name;
});

function validateName() {
  errors.name = '';
  const name = form.name.trim();

  if (!name) {
    errors.name = 'Name is required';
    return false;
  }

  // Check for valid characters
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(name)) {
    errors.name = 'Name can only contain letters, numbers, hyphens, and underscores';
    return false;
  }

  return true;
}

function addTool() {
  const tool = newTool.value.trim();
  if (tool && !form.tools.includes(tool)) {
    form.tools.push(tool);
  }
  newTool.value = '';
}

function removeTool(index: number) {
  form.tools.splice(index, 1);
}

function addExpansion() {
  const expansion = newExpansion.value.trim();
  if (expansion && !form.expansions.includes(expansion)) {
    form.expansions.push(expansion);
  }
  newExpansion.value = '';
}

function removeExpansion(index: number) {
  form.expansions.splice(index, 1);
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
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt.trim(),
        model: form.model.trim(),
        tools: form.tools,
        expansions: form.expansions
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to create agent');
    }

    // Emit success and close
    emit('created');
    emit('close');
  } catch (err) {
    console.error('Error creating agent:', err);
    error.value = err instanceof Error ? err.message : 'Failed to create agent';
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
  max-width: 600px;
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

.field-input,
.field-textarea {
  padding: 0.625rem 0.875rem;
  background-color: var(--bg-highlight);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.9375rem;
  transition: border-color 0.2s ease;
}

.field-input:focus,
.field-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.field-input::placeholder,
.field-textarea::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.field-textarea {
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
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

/* Tags Input */
.tags-input {
  background-color: var(--bg-highlight);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tags-input:focus-within {
  border-color: var(--color-primary);
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background-color: var(--color-primary);
  color: white;
  font-size: 0.8125rem;
  border-radius: 0.25rem;
}

.tag.expansion {
  background-color: var(--color-warning);
  color: var(--bg-surface);
}

.tag-remove {
  background: none;
  border: none;
  color: inherit;
  font-size: 1rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  opacity: 0.8;
  transition: opacity 0.2s ease;
}

.tag-remove:hover {
  opacity: 1;
}

.tag-input {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 0.9375rem;
  padding: 0.25rem;
  outline: none;
}

.tag-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
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
  background-color: var(--color-primary);
  color: white;
}

.modal-btn.primary:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
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
