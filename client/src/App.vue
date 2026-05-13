<template>
  <div id="app">
    <!-- Background Layer -->
    <BackgroundLayer />

    <div class="app-layout">
      <!-- Sidebar Navigation -->
      <aside class="sidebar" :class="{ 'has-background': settingsStore.hasBackgroundImage }">
        <div class="sidebar-header">
          <div class="logo">
            <span class="logo-icon">🪄</span>
            <img src="/taskmaster_logo.png" alt="Taskmaster" class="logo-img" />
          </div>
        </div>

        <nav class="sidebar-nav">
          <router-link
            to="/projects"
            class="nav-item"
            :class="{ active: $route.path === '/projects' || $route.path === '/' }"
          >
            <span class="nav-icon">📁</span>
            <span class="nav-text">Projects</span>
          </router-link>

          <router-link
            to="/activity"
            class="nav-item"
            :class="{ active: $route.path === '/activity' }"
          >
            <span class="nav-icon">📊</span>
            <span class="nav-text">Activity</span>
          </router-link>

          <router-link
            to="/agents"
            class="nav-item"
            :class="{ active: $route.path === '/agents' }"
          >
            <span class="nav-icon">🤖</span>
            <span class="nav-text">Agents</span>
          </router-link>

          <router-link
            to="/model-settings"
            class="nav-item"
            :class="{ active: $route.path === '/model-settings' }"
          >
            <span class="nav-icon">🧠</span>
            <span class="nav-text">Sub-Models</span>
          </router-link>

          <router-link
            to="/ports"
            class="nav-item"
            :class="{ active: $route.path === '/ports' }"
          >
            <span class="nav-icon">🔌</span>
            <span class="nav-text">Ports</span>
          </router-link>

          <router-link
            to="/settings"
            class="nav-item"
            :class="{ active: $route.path === '/settings' }"
          >
            <span class="nav-icon">⚙️</span>
            <span class="nav-text">Settings</span>
          </router-link>

          <!-- Custom Links Section -->
          <div v-if="customLinksStore.links.length > 0" class="custom-links-section">
            <div class="section-divider"></div>

            <div
              v-for="link in customLinksStore.sortedLinks"
              :key="link.id"
              class="nav-item custom-link"
              :class="{ 'custom-link': true }"
              @click="handleCustomLinkClick(link)"
            >
              <span class="nav-icon">{{ link.emoji }}</span>
              <span class="nav-text">{{ link.name }}</span>
              <button
                class="edit-link-btn"
                @click.stop="editLink(link)"
                title="Edit link"
              >
                ✎
              </button>
            </div>
          </div>

          <!-- Add Link Button -->
          <button class="add-link-btn" @click="openAddModal">
            <span class="nav-icon">+</span>
            <span class="nav-text">Add Link</span>
          </button>

          <!-- Add Task Button -->
          <button class="add-task-btn" @click="openAddTaskModal">
            <span class="nav-icon">+</span>
            <span class="nav-text">Add Task</span>
          </button>
        </nav>

        <div class="sidebar-footer">
          <EnergyBar />

          <div class="connection-status" :class="{ connected: isConnected }">
            <span class="status-dot"></span>
            <span class="status-text">{{ isConnected ? 'Connected' : 'Disconnected' }}</span>
          </div>

          <!-- MCP Server Status -->
          <div class="mcp-server-status" :class="{ connected: mcpServerStatus === 'connected' }">
            <span class="status-dot"></span>
            <span class="status-text">{{ mcpServerStatus === 'connected' ? 'MCP Ready' : 'MCP Offline' }}</span>
          </div>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content" :class="{ 'has-background': settingsStore.hasBackgroundImage }">
        <router-view />
      </main>
    </div>

    <!-- Custom Link Modal -->
    <div v-if="customLinksStore.isModalOpen" class="modal-overlay" @click="closeModal">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h2>{{ customLinksStore.isEditing ? 'Edit Link' : 'Add Custom Link' }}</h2>
          <button class="close-btn" @click="closeModal">×</button>
        </div>

        <form @submit.prevent="saveLink" class="modal-form">
          <div class="form-group">
            <label for="link-emoji">Icon (Emoji)</label>
            <input
              id="link-emoji"
              v-model="form.emoji"
              type="text"
              placeholder="🔗"
              maxlength="2"
              required
            />
          </div>

          <div class="form-group">
            <label for="link-name">Name</label>
            <input
              id="link-name"
              v-model="form.name"
              type="text"
              placeholder="My Link"
              required
            />
          </div>

          <div class="form-group">
            <label for="link-type">Type</label>
            <select id="link-type" v-model="form.type" required>
              <option value="">Select type...</option>
              <option value="folder">📁 Open Folder</option>
              <option value="website">🌐 Open Website</option>
              <option value="agent">🤖 Spawn Agent</option>
            </select>
          </div>

          <div class="form-group">
            <label for="link-target">
              {{ targetLabel }}
            </label>
            <input
              id="link-target"
              v-model="form.target"
              type="text"
              :placeholder="targetPlaceholder"
              required
            />
            <small v-if="form.type === 'folder'" class="help-text">
              Note: Browser security prevents directly opening folders. This will show the path to copy.
            </small>
          </div>

          <div v-if="formError" class="form-error">
            {{ formError }}
          </div>

          <div class="modal-actions">
            <button
              v-if="customLinksStore.isEditing"
              type="button"
              class="btn-danger"
              @click="confirmDelete"
            >
              Delete
            </button>
            <div class="spacer"></div>
            <button type="button" class="btn-secondary" @click="closeModal">
              Cancel
            </button>
            <button type="submit" class="btn-primary">
              {{ customLinksStore.isEditing ? 'Save' : 'Add' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Folder Path Modal -->
    <div v-if="showFolderModal" class="modal-overlay" @click="showFolderModal = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h2>📁 Folder Path</h2>
          <button class="close-btn" @click="showFolderModal = false">×</button>
        </div>
        <div class="modal-content">
          <p>Copy this path to open in your file explorer:</p>
          <div class="path-box">
            <code>{{ folderPath }}</code>
            <button class="copy-btn" @click="copyPath">{{ copied ? 'Copied!' : 'Copy' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Task Modal -->
    <AddTaskModal
      v-if="isAddTaskModalOpen"
      @close="closeAddTaskModal"
      @created="onTaskCreated"
    />

    <!-- Global Error Toast Notifications -->
    <ErrorToast />


  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, reactive, computed } from 'vue';
import { useCustomLinksStore, type CustomLink, type LinkType } from './stores/customLinks';
import { useErrorStore } from './stores/errors';
import { useProjectsStore, type Project } from './stores/projects';
import { useSettingsStore } from './stores/settings';
import BackgroundLayer from './components/BackgroundLayer.vue';
import AddTaskModal from './components/AddTaskModal.vue';
import ErrorToast from './components/ErrorToast.vue';
import EnergyBar from './components/EnergyBar.vue';


const customLinksStore = useCustomLinksStore();
const errorStore = useErrorStore();
const projectsStore = useProjectsStore();
const settingsStore = useSettingsStore();

// WebSocket connection state
const isConnected = ref(false);
let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds when WebSocket is disconnected
const WS_RECONNECT_DELAY_MS = 3000; // Reconnect after 3 seconds

// MCP Activity tracking
const mcpRecentlyActive = ref(false);
let mcpActiveTimeout: ReturnType<typeof setTimeout> | null = null;

function signalMcpActivity() {
  mcpRecentlyActive.value = true;
  if (mcpActiveTimeout) clearTimeout(mcpActiveTimeout);
  mcpActiveTimeout = setTimeout(() => {
    mcpRecentlyActive.value = false;
  }, 10000);
}

// MCP Server Status
const mcpServerStatus = ref<'connected' | 'offline'>('offline');
let mcpStatusInterval: ReturnType<typeof setInterval> | null = null;

async function checkMcpStatus() {
  try {
    const response = await fetch('/api/status');
    if (response.ok) {
      const data = await response.json();
      mcpServerStatus.value = data.mcp?.available ? 'connected' : 'offline';
    } else {
      mcpServerStatus.value = 'offline';
    }
  } catch {
    mcpServerStatus.value = 'offline';
  }
}

function startMcpStatusPolling() {
  checkMcpStatus(); // Check immediately
  mcpStatusInterval = setInterval(checkMcpStatus, 30000); // Then every 30 seconds
}

function stopMcpStatusPolling() {
  if (mcpStatusInterval) {
    clearInterval(mcpStatusInterval);
    mcpStatusInterval = null;
  }
}

// Cache status from server
const cacheStatus = ref<{
  totalProjects?: number;
  hydrated?: boolean;
  lastScan?: string;
} | null>(null);

// WebSocket message batching for debouncing
interface ProjectUpdate {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  data?: Record<string, unknown>;
}

let pendingUpdates: ProjectUpdate[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
const BATCH_DEBOUNCE_MS = 500;

// Add Task Modal state
const isAddTaskModalOpen = ref(false);

// Modal form state
const form = reactive({
  emoji: '🔗',
  name: '',
  type: '' as LinkType | '',
  target: '',
});

const formError = ref('');
const showFolderModal = ref(false);
const folderPath = ref('');
const copied = ref(false);

// Computed labels based on selected type
const targetLabel = computed(() => {
  switch (form.type) {
    case 'folder':
      return 'Folder Path';
    case 'website':
      return 'Website URL';
    case 'agent':
      return 'Agent Name';
    default:
      return 'Target';
  }
});

const targetPlaceholder = computed(() => {
  switch (form.type) {
    case 'folder':
      return '/home/user/Documents';
    case 'website':
      return 'https://example.com';
    case 'agent':
      return 'guardian';
    default:
      return '';
  }
});

function connectWebSocket() {
  // Clear any existing reconnect timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  const wsUrl = `ws://${window.location.hostname}:3000`;
  console.log('[WebSocket] Connecting to:', wsUrl);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WebSocket] Connection established');
    isConnected.value = true;
    // Stop polling when WebSocket is connected
    stopPolling();
  };

  ws.onclose = () => {
    console.log('[WebSocket] Connection closed');
    isConnected.value = false;
    ws = null;
    // Start polling as fallback
    startPolling();
    // Schedule reconnect attempt
    reconnectTimeout = setTimeout(connectWebSocket, WS_RECONNECT_DELAY_MS);
  };

  ws.onerror = (error) => {
    console.error('[WebSocket] Connection error:', error);
    isConnected.value = false;
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('[WebSocket] Raw message received:', message.type, message);
      handleWebSocketMessage(message);
    } catch (err) {
      console.error('[WebSocket] Failed to parse message:', err);
    }
  };
}

/**
 * Start polling for project updates when WebSocket is disconnected.
 * This provides a fallback mechanism to keep data fresh.
 */
function startPolling() {
  if (pollInterval) {
    return; // Already polling
  }
  console.log('[Polling] Starting fallback polling (every ' + POLL_INTERVAL_MS + 'ms)');
  // Immediate first poll
  projectsStore.fetchProjects();
  // Set up interval for subsequent polls
  pollInterval = setInterval(() => {
    console.log('[Polling] Fetching projects via REST API');
    projectsStore.fetchProjects();
  }, POLL_INTERVAL_MS);
}

/**
 * Stop polling when WebSocket reconnects.
 */
function stopPolling() {
  if (pollInterval) {
    console.log('[Polling] Stopping fallback polling');
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Handle incoming WebSocket messages for real-time project updates.
 * Supports 'project:updated' (single) and 'batch:update' (multiple) events.
 */
function handleWebSocketMessage(message: {
  type: string;
  id?: string;
  action?: string;
  data?: {
    projectId?: string;
    action?: 'created' | 'updated' | 'deleted';
    fileChanges?: Array<{ action: string; path: string; projectId?: string }>;
    projectUpdates?: Array<{ projectId: string; action: 'created' | 'updated' | 'deleted' }>;
    totalProjects?: number;
    hydrated?: boolean;
    lastScan?: string;
    clientId?: string;
    connectedAt?: string;
    serverTime?: string;
  };
  updates?: ProjectUpdate[];
}) {
  console.log('[WebSocket] Received:', message.type);

  switch (message.type) {
    case 'connection:ack':
      // Server acknowledges connection
      console.log('[WebSocket] Connection acknowledged by server:', {
        clientId: message.data?.clientId,
        connectedAt: message.data?.connectedAt
      });
      break;

    case 'cache:status':
      // Server sends cache status on connection
      cacheStatus.value = {
        totalProjects: message.data?.totalProjects,
        hydrated: message.data?.hydrated,
        lastScan: message.data?.lastScan
      };
      console.log('[WebSocket] Cache status received:', cacheStatus.value);
      // Refresh projects list when we get cache status (initial connection)
      projectsStore.fetchProjects();
      break;

    case 'project:updated':
      // Single project update
      // Server sends: { type: 'project:updated', data: { projectId, action, timestamp, last_updated_by } }
      const projectId = message.data?.projectId;
      const action = message.data?.action;
      const lastUpdatedBy = message.data?.last_updated_by;
      
      // Signal MCP activity if update came from an agent
      if (lastUpdatedBy && (lastUpdatedBy.startsWith('AGENT_') || lastUpdatedBy.includes('claude'))) {
        signalMcpActivity();
      }
      
      if (projectId && action) {
        if (action === 'updated') {
          // Re-fetch full project - MCP agents update tasks at any time
          // and the WS payload doesn't carry the updated state
          projectsStore.fetchProjectById(projectId);
        } else {
          // created/deleted can use the existing batch-patch path
          pendingUpdates.push({
            id: projectId,
            action: action,
            data: message.data,
          });
          scheduleBatchProcessing();
        }
      }
      break;

    case 'batch:update':
      // Multiple project updates - add all to batch queue
      // Server sends: { type: 'batch:update', data: { projectUpdates: [...] } }
      const projectUpdates = message.data?.projectUpdates;
      if (projectUpdates && Array.isArray(projectUpdates)) {
        projectUpdates.forEach(update => {
          pendingUpdates.push({
            id: update.projectId,
            action: update.action,
            data: update,
          });
        });
        scheduleBatchProcessing();
      }
      break;

    case 'file:changed':
      // File system change notification
      console.log('[WebSocket] File changed:', message.data);
      break;

    case 'error':
      // Server error message
      console.error('[WebSocket] Server error:', message.data);
      break;

    default:
      // Other message types can be handled here
      console.log('[WebSocket] Unhandled message type:', message.type);
      break;
  }
}

/**
 * Schedule batch processing with debouncing.
 * Waits 500ms for additional updates before processing to batch rapid changes.
 */
function scheduleBatchProcessing() {
  // Clear existing timeout to debounce
  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  // Schedule new batch processing
  batchTimeout = setTimeout(() => {
    processPendingUpdates();
  }, BATCH_DEBOUNCE_MS);
}

/**
 * Process all pending project updates in a single batch.
 * This minimizes re-renders when multiple updates arrive close together.
 */
function processPendingUpdates() {
  if (pendingUpdates.length === 0) return;

  console.log(`[WebSocket] Processing ${pendingUpdates.length} pending updates`);

  // Process updates in order
  pendingUpdates.forEach((update) => {
    switch (update.action) {
      case 'deleted':
        projectsStore.removeProject(update.id);
        break;

      case 'updated':
        if (update.data) {
          projectsStore.updateProject(update.id, update.data);
        }
        break;

      case 'created':
        if (update.data) {
          // Fetch the full project data since we may only have partial data
          // This ensures we have the complete project object
          const project = update.data as Project;
          projectsStore.addProject(project);
        }
        break;

      default:
        console.warn('[WebSocket] Unknown action:', update.action);
    }
  });

  // Clear the pending queue
  pendingUpdates = [];
}

// Custom link handlers
function openAddModal() {
  resetForm();
  customLinksStore.openModal();
}

function editLink(link: CustomLink) {
  form.emoji = link.emoji;
  form.name = link.name;
  form.type = link.type;
  form.target = link.target;
  formError.value = '';
  customLinksStore.openModal(link);
}

function closeModal() {
  customLinksStore.closeModal();
  resetForm();
}

function resetForm() {
  form.emoji = '🔗';
  form.name = '';
  form.type = '';
  form.target = '';
  formError.value = '';
}

function saveLink() {
  const linkData = {
    emoji: form.emoji.trim(),
    name: form.name.trim(),
    type: form.type as LinkType,
    target: form.target.trim(),
  };

  const validation = customLinksStore.validateLink(linkData);
  if (!validation.valid) {
    formError.value = validation.error || 'Invalid link data';
    return;
  }

  if (customLinksStore.isEditing && customLinksStore.editingLink) {
    customLinksStore.updateLink(customLinksStore.editingLink.id, linkData);
  } else {
    customLinksStore.addLink(linkData);
  }

  closeModal();
}

function confirmDelete() {
  if (customLinksStore.editingLink && confirm('Are you sure you want to delete this link?')) {
    customLinksStore.deleteLink(customLinksStore.editingLink.id);
    closeModal();
  }
}

async function handleCustomLinkClick(link: CustomLink) {
  try {
    const handled = await customLinksStore.handleLinkClick(link);

    if (!handled && link.type === 'folder') {
      // Show folder path modal for folder links
      folderPath.value = link.target;
      showFolderModal.value = true;
    }
  } catch (err) {
    alert(`Error: ${err instanceof Error ? err.message : 'Failed to open link'}`);
  }
}

function copyPath() {
  navigator.clipboard.writeText(folderPath.value).then(() => {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  });
}

// Add Task Modal handlers
function openAddTaskModal() {
  isAddTaskModalOpen.value = true;
}

function closeAddTaskModal() {
  isAddTaskModalOpen.value = false;
}

function onTaskCreated(taskId: string, projectId: string) {
  console.log(`Task ${taskId} created in project ${projectId}`);
  // Refresh projects to show the new task
  projectsStore.fetchProjects();
}

onMounted(() => {
  connectWebSocket();
  customLinksStore.fetchLinks();
  startMcpStatusPolling();
});

onUnmounted(() => {
  if (ws) {
    ws.close();
  }
  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  stopMcpStatusPolling();
});
</script>

<style>
/* Dark mode base styles */
:root {
  --bg-primary: #0a0a0f;
  --bg-surface: #12121a;
  --bg-highlight: #1a1a24;
  --color-primary: #6366f1;
  --color-primary-hover: #818cf8;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
}

#app {
  min-height: 100vh;
}

.app-layout {
  display: flex;
  min-height: 100vh;
}

/* Sidebar */
.sidebar {
  width: 240px;
  background-color: var(--bg-surface);
  border-right: 1px solid var(--bg-highlight);
  display: flex;
  flex-direction: column;
  position: fixed;
  height: 100vh;
  left: 0;
  top: 0;
  z-index: 100;
}

.sidebar-header {
  padding: 1.5rem;
  border-bottom: 1px solid var(--bg-highlight);
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logo-icon {
  font-size: 1.5rem;
}

.logo-img {
  height: 22px;
  width: auto;
  display: block;
}

/* Navigation */
.sidebar-nav {
  flex: 1;
  padding: 1rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
}

.nav-item:hover {
  background-color: var(--bg-highlight);
  color: var(--text-primary);
}

.nav-item.active {
  background-color: var(--color-primary);
  color: white;
}

.nav-icon {
  font-size: 1.25rem;
  width: 24px;
  text-align: center;
}

.nav-text {
  font-size: 0.9375rem;
  font-weight: 500;
}

/* Custom Links Section */
.custom-links-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.section-divider {
  height: 1px;
  background-color: var(--bg-highlight);
  margin: 0.5rem 0;
}

.nav-item.custom-link {
  position: relative;
  border-left: 2px solid var(--color-primary);
}

.nav-item.custom-link:hover {
  background-color: rgba(99, 102, 241, 0.1);
}

.edit-link-btn {
  margin-left: auto;
  opacity: 0;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  font-size: 0.875rem;
  transition: opacity 0.2s ease;
}

.nav-item.custom-link:hover .edit-link-btn {
  opacity: 1;
}

.edit-link-btn:hover {
  color: var(--text-primary);
}

/* Add Link Button */
.add-link-btn {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  margin-top: 0.5rem;
  border-radius: 0.5rem;
  background-color: transparent;
  border: 1px dashed var(--bg-highlight);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-link-btn:hover {
  background-color: var(--bg-highlight);
  color: var(--text-primary);
  border-color: var(--color-primary);
}

/* Add Task Button */
.add-task-btn {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  margin-top: 0.5rem;
  border-radius: 0.5rem;
  background-color: transparent;
  border: 1px dashed var(--bg-highlight);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-task-btn:hover {
  background-color: var(--bg-highlight);
  color: var(--text-primary);
  border-color: var(--color-success);
}

/* Sidebar Footer */
.sidebar-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--bg-highlight);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}


.connection-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-error);
}

.connection-status.connected {
  color: var(--color-success);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: currentColor;
}

.status-text {
  font-weight: 500;
}

/* MCP Activity Status */
.mcp-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--bg-highlight);
}

.mcp-status.active {
  color: var(--color-primary);
}

.mcp-status.active .status-dot {
  animation: pulse-dot 1.5s ease-in-out infinite;
  background-color: var(--color-primary);
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.2);
  }
}

/* MCP Server Status */
.mcp-server-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--bg-highlight);
}

.mcp-server-status .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--text-secondary);
  opacity: 0.5;
}

.mcp-server-status.connected {
  color: var(--color-success);
}

.mcp-server-status.connected .status-dot {
  background-color: var(--color-success);
  opacity: 1;
}

/* Main Content */
.main-content {
  flex: 1;
  margin-left: 240px;
  min-height: 100vh;
  background-color: var(--bg-primary);
}

/* Semi-transparent backgrounds when background image is active */
.sidebar.has-background {
  background-color: rgba(18, 18, 26, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.main-content.has-background {
  background-color: rgba(10, 10, 15, 0.75);
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  width: 100%;
  max-width: 450px;
  margin: 1rem;
  border: 1px solid var(--bg-highlight);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem;
  border-bottom: 1px solid var(--bg-highlight);
}

.modal-header h2 {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
}

.close-btn:hover {
  color: var(--text-primary);
}

.modal-form {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.modal-content {
  padding: 1.25rem;
}

.modal-content p {
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

.path-box {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background-color: var(--bg-highlight);
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
}

.path-box code {
  flex: 1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.875rem;
  color: var(--text-primary);
  word-break: break-all;
}

.copy-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-primary);
  color: white;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.copy-btn:hover {
  background-color: var(--color-primary-hover);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.form-group input,
.form-group select {
  padding: 0.625rem 0.875rem;
  background-color: var(--bg-highlight);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.9375rem;
  outline: none;
  transition: border-color 0.2s ease;
}

.form-group input:focus,
.form-group select:focus {
  border-color: var(--color-primary);
}

.form-group input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.help-text {
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.form-error {
  padding: 0.75rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--color-error);
  border-radius: 0.5rem;
  color: var(--color-error);
  font-size: 0.875rem;
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.modal-actions .spacer {
  flex: 1;
}

.btn-primary {
  padding: 0.625rem 1.25rem;
  background-color: var(--color-primary);
  color: white;
  border: none;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.btn-primary:hover {
  background-color: var(--color-primary-hover);
}

.btn-secondary {
  padding: 0.625rem 1.25rem;
  background-color: var(--bg-highlight);
  color: var(--text-primary);
  border: none;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.btn-secondary:hover {
  background-color: #2a2a36;
}

.btn-danger {
  padding: 0.625rem 1.25rem;
  background-color: transparent;
  color: var(--color-error);
  border: 1px solid var(--color-error);
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-danger:hover {
  background-color: var(--color-error);
  color: white;
}

/* Responsive */
@media (max-width: 768px) {
  .sidebar {
    width: 60px;
  }

  .logo-img,
  .nav-text,
  .status-text {
    display: none;
  }

  .sidebar-header {
    padding: 1rem 0.5rem;
    display: flex;
    justify-content: center;
  }

  .sidebar-nav {
    padding: 1rem 0.5rem;
    align-items: center;
  }

  .nav-item {
    padding: 0.75rem;
    justify-content: center;
  }

  .nav-icon {
    width: auto;
  }

  .sidebar-footer {
    padding: 1rem 0.5rem;
    display: flex;
    justify-content: center;
  }

  .main-content {
    margin-left: 60px;
  }

  .add-link-btn .nav-text {
    display: none;
  }

  .edit-link-btn {
    display: none;
  }
}
</style>
