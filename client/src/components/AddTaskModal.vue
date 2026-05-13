<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="onClose">
      <div class="modal-container">
        <div class="modal-header">
          <h3 class="modal-title">➕ Add New Task</h3>
          <button class="modal-close" @click="onClose">×</button>
        </div>

        <div class="modal-body">
          <!-- Project Selection -->
          <div class="form-field">
            <label class="field-label">
              Project <span class="required">*</span>
            </label>
            <select
              v-model="form.projectId"
              class="field-input"
              :disabled="isSubmitting || props.preselectedProjectId"
              @change="onProjectChange"
            >
              <option value="">Select a project...</option>
              <option
                v-for="project in projectsStore.projects"
                :key="project.id"
                :value="project.id"
              >
                {{ project.name }}
              </option>
              <option value="__new__">+ Create New Project</option>
            </select>
            <p v-if="errors.projectId" class="field-error">{{ errors.projectId }}</p>
          </div>

          <!-- New Project Name (shown when creating new project) -->
          <div v-if="form.projectId === '__new__'" class="form-field">
            <label class="field-label">
              New Project Name <span class="required">*</span>
            </label>
            <input
              v-model="form.newProjectName"
              type="text"
              class="field-input"
              placeholder="e.g., My Awesome Project"
              :disabled="isSubmitting"
              @blur="validateNewProjectName"
            />
            <p class="field-hint">This will create a new project and add the task to it.</p>
            <p v-if="errors.newProjectName" class="field-error">{{ errors.newProjectName }}</p>
          </div>

          <!-- Task Title -->
          <div class="form-field">
            <label class="field-label">
              Task Title <span class="required">*</span>
            </label>
            <input
              v-model="form.title"
              type="text"
              class="field-input"
              placeholder="e.g., Implement user authentication"
              :disabled="isSubmitting"
              @blur="validateTitle"
              @keydown.enter.prevent="onSubmit"
            />
            <p v-if="errors.title" class="field-error">{{ errors.title }}</p>
          </div>

          <!-- Task Description -->
          <div class="form-field">
            <label class="field-label">Description</label>
            <textarea
              v-model="form.description"
              class="field-input"
              rows="3"
              placeholder="Describe the task details..."
              :disabled="isSubmitting"
            ></textarea>
          </div>

          <!-- Status and Tier Row -->
          <div class="form-row">
            <div class="form-field half">
              <label class="field-label">Status</label>
              <select v-model="form.status" class="field-input" :disabled="isSubmitting">
                <option value="pending">⏳ Pending</option>
                <option value="in_progress">🔄 In Progress</option>
                <option value="done">✅ Done</option>
                <option value="blocked">🚫 Blocked</option>
              </select>
            </div>

            <div class="form-field half">
              <label class="field-label">Tier</label>
              <select v-model="form.tier" class="field-input" :disabled="isSubmitting">
                <option v-for="tier in tierOptions" :key="tier.value" :value="tier.value">
                  {{ tier.label }}
                </option>
              </select>
            </div>
          </div>

          <!-- Priority -->
          <div class="form-field">
            <label class="field-label">Priority</label>
            <select v-model="form.priority" class="field-input" :disabled="isSubmitting">
              <option value="low">🔵 Low</option>
              <option value="medium">🟡 Medium</option>
              <option value="high">🟠 High</option>
              <option value="critical">🔴 Critical</option>
            </select>
          </div>

          <!-- LLM Provider Hint -->
          <div class="form-field">
            <label class="field-label">LLM Provider Hint</label>
            <select v-model="form.model" class="field-input" :disabled="isSubmitting">
              <option value="">Auto (let agent decide)</option>
              <option v-for="p in availableProviders" :key="p.id" :value="p.id">
                {{ p.id }} — {{ p.name }}
              </option>
            </select>
            <p class="field-hint">Suggests which model to use for delegated subtasks. Does not replace Claude.</p>
          </div>

          <!-- Created Timestamp (read-only) -->
          <div class="form-field">
            <label class="field-label">Created</label>
            <input
              :value="formattedTimestamp"
              type="text"
              class="field-input readonly"
              readonly
            />
            <p class="field-hint">Timestamp will be set automatically when the task is created.</p>
          </div>

          <!-- Error Message -->
          <div v-if="error" class="error-message">
            <span class="error-icon">⚠️</span>
            {{ error }}
          </div>

          <!-- Success Message -->
          <div v-if="success" class="success-message">
            <span class="success-icon">✓</span>
            {{ success }}
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
            {{ isSubmitting ? 'Creating...' : 'Add Task' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue';
import { useProjectsStore } from '../stores/projects';

interface FormState {
  projectId: string;
  newProjectName: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  tier: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  model: string;
}

interface ProviderOption {
  id: string;
  name: string;
}

const props = defineProps<{
  preselectedProjectId?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created', taskId: string, projectId: string): void;
}>();

const projectsStore = useProjectsStore();

const form = reactive<FormState>({
  projectId: '',
  newProjectName: '',
  title: '',
  description: '',
  status: 'pending',
  tier: 0,
  priority: 'medium',
  model: ''
});

const availableProviders = ref<ProviderOption[]>([]);

const errors = reactive({
  projectId: '',
  newProjectName: '',
  title: ''
});

const isSubmitting = ref(false);
const error = ref<string | null>(null);
const success = ref<string | null>(null);
const createdTimestamp = ref(new Date());

// Format timestamp for display
const formattedTimestamp = computed(() => {
  return createdTimestamp.value.toLocaleString();
});

// Tier options (0-10)
const tierOptions = computed(() => {
  const tiers = [];
  const tierNames: Record<number, string> = {
    0: 'Discovery',
    1: 'Strategy',
    2: 'Architecture',
    3: 'Execution',
    4: 'Delivery',
    5: 'Final'
  };

  for (let i = 0; i <= 10; i++) {
    tiers.push({
      value: i,
      label: `Tier ${i}${tierNames[i] ? ` - ${tierNames[i]}` : ''}`
    });
  }
  return tiers;
});

const isValid = computed(() => {
  if (!form.projectId) return false;
  if (form.projectId === '__new__' && !form.newProjectName.trim()) return false;
  if (!form.title.trim()) return false;
  return true;
});

function validateProjectId() {
  errors.projectId = '';
  if (!form.projectId) {
    errors.projectId = 'Please select a project';
    return false;
  }
  return true;
}

function validateNewProjectName() {
  errors.newProjectName = '';
  if (form.projectId === '__new__') {
    const name = form.newProjectName.trim();
    if (!name) {
      errors.newProjectName = 'Project name is required';
      return false;
    }
    if (name.length < 2) {
      errors.newProjectName = 'Project name must be at least 2 characters';
      return false;
    }
  }
  return true;
}

function validateTitle() {
  errors.title = '';
  const title = form.title.trim();
  if (!title) {
    errors.title = 'Task title is required';
    return false;
  }
  if (title.length < 2) {
    errors.title = 'Task title must be at least 2 characters';
    return false;
  }
  return true;
}

function onProjectChange() {
  validateProjectId();
  if (form.projectId === '__new__') {
    validateNewProjectName();
  }
}

function onClose() {
  if (isSubmitting.value) return;
  emit('close');
}

async function createProject(name: string): Promise<{ id: string; success: boolean; error?: string }> {
  try {
    const projectId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        id: projectId
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // If project already exists, we can still use it
      if (response.status === 409) {
        return { id: projectId, success: true };
      }
      throw new Error(data.message || data.error || 'Failed to create project');
    }

    return { id: data.id || projectId, success: true };
  } catch (err) {
    return {
      id: '',
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create project'
    };
  }
}

async function createTask(projectId: string): Promise<{ taskId: string; success: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title.trim(),
        description: form.description.trim(),
        status: form.status,
        tier: form.tier,
        priority: form.priority,
        ...(form.model ? { model: form.model } : {})
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to create task');
    }

    return { taskId: data.id, success: true };
  } catch (err) {
    return {
      taskId: '',
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create task'
    };
  }
}

async function onSubmit() {
  if (isSubmitting.value || !isValid.value) return;

  // Validate all fields
  if (!validateProjectId()) return;
  if (form.projectId === '__new__' && !validateNewProjectName()) return;
  if (!validateTitle()) return;

  isSubmitting.value = true;
  error.value = null;
  success.value = null;

  try {
    let targetProjectId = form.projectId;

    // Create new project if needed
    if (form.projectId === '__new__') {
      const projectResult = await createProject(form.newProjectName);
      if (!projectResult.success) {
        throw new Error(projectResult.error || 'Failed to create project');
      }
      targetProjectId = projectResult.id;
    }

    // Create the task
    const taskResult = await createTask(targetProjectId);
    if (!taskResult.success) {
      throw new Error(taskResult.error || 'Failed to create task');
    }

    // Show success message
    success.value = 'Task created successfully!';

    // Refresh projects list
    await projectsStore.fetchProjects();

    // Emit success and close after a short delay
    setTimeout(() => {
      emit('created', taskResult.taskId, targetProjectId);
      emit('close');
    }, 1000);

  } catch (err) {
    console.error('Error creating task:', err);
    error.value = err instanceof Error ? err.message : 'Failed to create task';
  } finally {
    isSubmitting.value = false;
  }
}

// Initialize with preselected project if provided
onMounted(async () => {
  if (props.preselectedProjectId) {
    form.projectId = props.preselectedProjectId;
  }
  projectsStore.fetchProjects();
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    availableProviders.value = (data.settings?.providers ?? []).filter((p: any) => p.apiKey);
  } catch {}
});

// Watch for preselected project changes
watch(() => props.preselectedProjectId, (newId) => {
  if (newId) {
    form.projectId = newId;
  }
});
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

.form-row {
  display: flex;
  gap: 1rem;
}

.form-field.half {
  flex: 1;
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
  width: 100%;
}

.field-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.field-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.field-input.readonly {
  background-color: rgba(0, 0, 0, 0.2);
  color: var(--text-secondary);
  cursor: not-allowed;
}

textarea.field-input {
  resize: vertical;
  min-height: 80px;
  font-family: inherit;
}

select.field-input {
  cursor: pointer;
}

select.field-input option {
  background-color: var(--bg-surface);
  color: var(--text-primary);
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

/* Success Message */
.success-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1rem;
  background-color: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 0.5rem;
  color: var(--color-success);
  font-size: 0.875rem;
}

.success-icon {
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

  .form-row {
    flex-direction: column;
    gap: 1.25rem;
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
