<template>
  <div class="port-manager-view">
    <div class="page-header">
      <h1>Port Manager</h1>
      <p class="subtitle">Manage port allocations for your projects</p>
    </div>

    <div class="page-content">
      <!-- Core Services (Reserved Ports) -->
      <div class="port-core-services">
        <h3 class="port-section-title">🔒 Reserved Core Services</h3>
        <p class="port-section-description">These ports are managed by PM2 and should not be allocated to projects:</p>
        <div class="port-list core-list">
          <div class="port-item core-item">
            <div class="port-info">
              <span class="port-number">3000</span>
              <div class="port-details">
                <span class="port-project">TaskMaster Server</span>
                <span class="port-id">API Server (ecosystem.config.js)</span>
              </div>
            </div>
            <span class="port-badge reserved">PM2</span>
          </div>
          <div class="port-item core-item">
            <div class="port-info">
              <span class="port-number">3001</span>
              <div class="port-details">
                <span class="port-project">TaskMaster MCP</span>
                <span class="port-id">MCP Server (ecosystem.config.js)</span>
              </div>
            </div>
            <span class="port-badge reserved">PM2</span>
          </div>
          <div class="port-item core-item">
            <div class="port-info">
              <span class="port-number">8040</span>
              <div class="port-details">
                <span class="port-project">TaskMaster Client</span>
                <span class="port-id">Web UI (ecosystem.config.js)</span>
              </div>
            </div>
            <span class="port-badge reserved">PM2</span>
          </div>
        </div>
      </div>

      <!-- Port Allocations List -->
      <div class="port-allocations">
        <div v-if="portsStore.isLoading" class="port-loading">
          Loading port allocations...
        </div>
        <div v-else-if="portsStore.error" class="port-error">
          {{ portsStore.error }}
        </div>
        <div v-else-if="portsStore.sortedAllocations.length === 0" class="port-empty">
          No port allocations yet.
        </div>
        <div v-else class="port-list">
          <div
            v-for="allocation in portsStore.sortedAllocations"
            :key="allocation.projectId"
            class="port-item"
            :class="{ 'editing': editingAllocation?.projectId === allocation.projectId }"
          >
            <!-- View Mode -->
            <template v-if="editingAllocation?.projectId !== allocation.projectId">
              <div class="port-info">
                <span class="port-number">{{ allocation.port }}</span>
                <div class="port-details">
                  <span class="port-project">{{ allocation.projectName }}</span>
                  <span class="port-id">{{ allocation.projectId }}</span>
                  <span v-if="allocation.description" class="port-description">
                    {{ allocation.description }}
                  </span>
                  <div class="port-meta">
                    <span v-if="allocation.autostart" class="port-badge autostart">
                      ⚡ Autostart
                    </span>
                    <span v-if="allocation.projectPath" class="port-badge path" :title="allocation.projectPath">
                      📁 {{ allocation.projectPath.split('/').pop() }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="port-actions-row">
                <!-- Autostart Toggle -->
                <label class="toggle-switch-small" :title="allocation.autostart ? 'Disable autostart' : 'Enable autostart'">
                  <input
                    type="checkbox"
                    :checked="allocation.autostart"
                    @change="toggleAutostart(allocation.projectId, !allocation.autostart)"
                  />
                  <span class="toggle-track">
                    <span class="toggle-thumb"></span>
                  </span>
                  <span class="toggle-label">Auto</span>
                </label>
                <button
                  class="btn-icon btn-edit"
                  @click="startEdit(allocation)"
                  title="Edit allocation"
                >
                  ✏️
                </button>
                <button
                  class="btn-icon btn-delete"
                  @click="freePort(allocation.projectId)"
                  title="Free this port"
                >
                  🗑️
                </button>
              </div>
            </template>

            <!-- Edit Mode -->
            <template v-else>
              <div class="port-edit-form">
                <div class="edit-row">
                  <input
                    v-model="editingAllocation.projectName"
                    type="text"
                    class="port-input edit-input"
                    placeholder="Project Name"
                  />
                </div>
                <div class="edit-row">
                  <input
                    v-model="editingAllocation.description"
                    type="text"
                    class="port-input edit-input"
                    placeholder="Description (optional)"
                  />
                </div>
                <div class="edit-row">
                  <input
                    v-model="editingAllocation.projectPath"
                    type="text"
                    class="port-input edit-input"
                    placeholder="Project Path (optional)"
                  />
                </div>
                <div class="edit-row">
                  <input
                    v-model="editingAllocation.startCommand"
                    type="text"
                    class="port-input edit-input"
                    placeholder="Start Command (optional)"
                  />
                </div>
                <div class="edit-actions">
                  <button class="btn-small btn-secondary" @click="cancelEdit">Cancel</button>
                  <button class="btn-small btn-primary" @click="saveEdit">Save</button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Add New Port Allocation -->
      <div class="port-add-section">
        <h3>Add Port Allocation</h3>
        <div class="port-form">
          <div class="form-row">
            <div class="form-group">
              <label for="port-project-id">Project ID</label>
              <input
                id="port-project-id"
                v-model="newPortAllocation.projectId"
                type="text"
                placeholder="my-project"
                class="port-input"
              />
            </div>
            <div class="form-group">
              <label for="port-project-name">Project Name</label>
              <input
                id="port-project-name"
                v-model="newPortAllocation.projectName"
                type="text"
                placeholder="My Project"
                class="port-input"
              />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="port-number">
                Port (optional)
                <small class="help-text-inline">Leave empty for auto-assign</small>
              </label>
              <input
                id="port-number"
                v-model.number="newPortAllocation.port"
                type="number"
                min="3000"
                max="65535"
                placeholder="Auto"
                class="port-input"
                @blur="checkPortAvailability"
              />
              <div v-if="portCheckResult" class="port-check-result" :class="{ 'available': portCheckResult.available, 'unavailable': !portCheckResult.available }">
                <span v-if="portCheckResult.available">✓ Port available</span>
                <span v-else>
                  ✗ Port in use by {{ portCheckResult.allocation?.projectName }}
                </span>
              </div>
            </div>
            <div class="form-group">
              <label for="port-description">Description (optional)</label>
              <input
                id="port-description"
                v-model="newPortAllocation.description"
                type="text"
                placeholder="Development server"
                class="port-input"
              />
            </div>
          </div>
          <div class="port-form-actions">
            <button
              class="btn-primary"
              @click="addPortAllocation"
              :disabled="!canAddPort"
            >
              Add Allocation
            </button>
          </div>
          <div v-if="addPortError" class="port-error-message">
            {{ addPortError }}
          </div>
        </div>
      </div>

      <!-- Refresh Button -->
      <div class="port-actions">
        <button class="btn-secondary" @click="refreshPorts">
          🔄 Refresh
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue';
import { usePortsStore, type PortCheckResult, type PortAllocation } from '../stores/ports';

const portsStore = usePortsStore();

const newPortAllocation = reactive({
  projectId: '',
  projectName: '',
  port: undefined as number | undefined,
  description: ''
});
const portCheckResult = ref<PortCheckResult | null>(null);
const addPortError = ref('');
const editingAllocation = ref<{
  projectId: string;
  projectName: string;
  description: string;
  projectPath: string;
  startCommand: string;
} | null>(null);

const canAddPort = computed(() => {
  return newPortAllocation.projectId.trim() &&
         newPortAllocation.projectName.trim() &&
         (!newPortAllocation.port || (newPortAllocation.port >= 3000 && newPortAllocation.port <= 65535)) &&
         (!portCheckResult.value || portCheckResult.value.available);
});

async function checkPortAvailability() {
  if (!newPortAllocation.port) {
    portCheckResult.value = null;
    return;
  }
  const result = await portsStore.checkPort(newPortAllocation.port);
  portCheckResult.value = result;
}

async function addPortAllocation() {
  addPortError.value = '';

  if (!newPortAllocation.projectId.trim() || !newPortAllocation.projectName.trim()) {
    addPortError.value = 'Project ID and Project Name are required';
    return;
  }

  const result = await portsStore.allocatePort(
    newPortAllocation.projectId.trim(),
    newPortAllocation.projectName.trim(),
    newPortAllocation.port,
    newPortAllocation.description.trim() || undefined
  );

  if (result.success) {
    newPortAllocation.projectId = '';
    newPortAllocation.projectName = '';
    newPortAllocation.port = undefined;
    newPortAllocation.description = '';
    portCheckResult.value = null;
  } else {
    addPortError.value = result.error || 'Failed to allocate port';
  }
}

async function freePort(projectId: string) {
  if (confirm(`Free port allocation for project "${projectId}"?`)) {
    await portsStore.freePort(projectId);
  }
}

async function refreshPorts() {
  await portsStore.fetchAllocations();
}

async function toggleAutostart(projectId: string, value: boolean) {
  const result = await portsStore.updateAllocation(projectId, { autostart: value });
  if (!result.success) {
    alert(result.error || 'Failed to update autostart');
  }
}

function startEdit(allocation: PortAllocation) {
  editingAllocation.value = {
    projectId: allocation.projectId,
    projectName: allocation.projectName,
    description: allocation.description || '',
    projectPath: allocation.projectPath || '',
    startCommand: allocation.startCommand || ''
  };
}

function cancelEdit() {
  editingAllocation.value = null;
}

async function saveEdit() {
  if (!editingAllocation.value) return;

  const { projectId, projectName, description, projectPath, startCommand } = editingAllocation.value;
  const result = await portsStore.updateAllocation(projectId, {
    projectName: projectName.trim(),
    description: description.trim() || undefined,
    projectPath: projectPath.trim() || undefined,
    startCommand: startCommand.trim() || undefined
  });

  if (result.success) {
    editingAllocation.value = null;
  } else {
    alert(result.error || 'Failed to update allocation');
  }
}

onMounted(() => {
  portsStore.fetchAllocations();
});
</script>

<style scoped>
.port-manager-view {
  padding: 2rem;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 2rem;
}

.page-header h1 {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 1rem;
}

.page-content {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Port Manager Styles */
.port-core-services {
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 2px solid var(--bg-highlight);
}

.port-section-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.port-section-description {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

.port-list.core-list {
  opacity: 0.8;
}

.port-item.core-item {
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
}

.port-item.core-item:hover {
  border-color: var(--bg-highlight);
}

.port-badge.reserved {
  background-color: rgba(99, 102, 241, 0.15);
  color: #6366f1;
  font-size: 0.75rem;
  padding: 0.25rem 0.625rem;
  border-radius: 0.25rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.port-allocations {
  margin-bottom: 1.5rem;
}

.port-loading,
.port-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-secondary);
  background-color: var(--bg-highlight);
  border-radius: 0.5rem;
}

.port-error {
  padding: 1rem;
  text-align: center;
  color: var(--color-error);
  background-color: rgba(239, 68, 68, 0.1);
  border-radius: 0.5rem;
}

.port-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.port-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background-color: var(--bg-highlight);
  border-radius: 0.5rem;
  border: 1px solid transparent;
  transition: border-color 0.2s ease;
}

.port-item:hover {
  border-color: var(--color-primary);
}

.port-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
}

.port-number {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-primary);
  min-width: 60px;
}

.port-details {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.port-project {
  font-weight: 500;
  color: var(--text-primary);
}

.port-id {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
}

.port-description {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-style: italic;
}

.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 0.375rem;
  transition: background-color 0.2s ease;
}

.btn-icon:hover {
  background-color: var(--bg-surface);
}

.btn-delete:hover {
  background-color: rgba(239, 68, 68, 0.1);
}

.port-add-section {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--bg-highlight);
}

.port-add-section h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.port-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.port-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  background-color: var(--bg-highlight);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.9375rem;
  outline: none;
  transition: border-color 0.2s ease;
}

.port-input:focus {
  border-color: var(--color-primary);
}

.port-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.help-text-inline {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-weight: normal;
  margin-left: 0.5rem;
}

.port-check-result {
  margin-top: 0.5rem;
  font-size: 0.8125rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.25rem;
}

.port-check-result.available {
  color: #22c55e;
  background-color: rgba(34, 197, 94, 0.1);
}

.port-check-result.unavailable {
  color: #ef4444;
  background-color: rgba(239, 68, 68, 0.1);
}

.port-form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.port-error-message {
  padding: 0.75rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--color-error);
  border-radius: 0.5rem;
  color: var(--color-error);
  font-size: 0.875rem;
}

.port-actions {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bg-highlight);
  display: flex;
  justify-content: flex-end;
}

/* Port Item with Edit Mode */
.port-item.editing {
  background-color: var(--bg-surface);
  border-color: var(--color-primary);
  padding: 1rem;
}

.port-actions-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.port-meta {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.port-badge {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-weight: 500;
}

.port-badge.autostart {
  background-color: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.port-badge.path {
  background-color: var(--bg-surface);
  color: var(--text-secondary);
}

.btn-edit:hover {
  background-color: rgba(59, 130, 246, 0.1);
}

/* Toggle Switch Small */
.toggle-switch-small {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
  font-size: 0.75rem;
}

.toggle-switch-small input {
  display: none;
}

.toggle-switch-small .toggle-track {
  width: 32px;
  height: 16px;
  background: var(--bg-surface);
  border-radius: 8px;
  position: relative;
  transition: background-color 0.2s ease;
}

.toggle-switch-small input:checked + .toggle-track {
  background: var(--color-primary);
}

.toggle-switch-small .toggle-thumb {
  position: absolute;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  top: 1px;
  left: 1px;
  transition: transform 0.2s ease;
}

.toggle-switch-small input:checked + .toggle-track .toggle-thumb {
  transform: translateX(16px);
}

.toggle-switch-small .toggle-label {
  color: var(--text-secondary);
  font-weight: 500;
}

/* Port Edit Form */
.port-edit-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.edit-row {
  width: 100%;
}

.edit-input {
  width: 100%;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.btn-small {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

@media (max-width: 640px) {
  .port-manager-view {
    padding: 1rem;
  }

  .form-row {
    grid-template-columns: 1fr;
  }

  .port-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .port-number {
    font-size: 1.5rem;
  }
}
</style>
