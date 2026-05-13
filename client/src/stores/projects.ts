import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useErrorStore } from './errors';
import { useSettingsStore } from './settings';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'failed';
  tier: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  agent?: string;
  created: string;
  started?: string;
  completed?: string;
  locked_by?: string;
  locked_at?: string;
  reclaim_after?: string;
  heartbeat_interval?: number;
  gate?: string | null;
  depends_on?: string[];
  requires_human?: boolean;
  last_updated_by?: string;
  last_updated_at?: string;
}

export interface ProjectMetadata {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  lastUpdated: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  path: string;
  currentTier: number;
  status: 'active' | 'completed' | 'archived' | 'awaiting_approval' | 'paused';
  lastAccessed: string;
  created?: string;
  tasks: Task[];
  completedTiers?: number[];
  isArchived?: boolean;
  metadata?: ProjectMetadata;
}

export const useProjectsStore = defineStore('projects', () => {
  // State
  const projects = ref<Project[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const sortedProjects = computed(() => {
    return [...projects.value].sort((a, b) => {
      return new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime();
    });
  });

  // Actions
  async function fetchProjects() {
    loading.value = true;
    error.value = null;
    const errorStore = useErrorStore();
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) {
        // Use global error handling for API errors - show user-friendly message
        await errorStore.handleApiError(response, 'Failed to Load Projects');
        throw new Error(`Failed to fetch projects: ${response.statusText}`);
      }
      const data = await response.json();
      projects.value = data;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error fetching projects:', err);
      // Error is already shown via handleApiError, don't show again for network errors
      if (err instanceof Error && err.message.includes('Failed to fetch')) {
        errorStore.showError(
          'Connection Error',
          'Unable to connect to the server. Please check your connection and try again.'
        );
      }
    } finally {
      loading.value = false;
    }
  }

  function getAccessTimeIndicator(lastAccessed: string): { color: string; label: string } {
    const settingsStore = useSettingsStore();
    const now = new Date().getTime();
    const accessed = new Date(lastAccessed).getTime();
    const diffMinutes = (now - accessed) / (1000 * 60);

    const greenThreshold = settingsStore.greenThreshold;
    const orangeThreshold = settingsStore.orangeThreshold;

    if (diffMinutes <= greenThreshold) {
      return { color: '#10b981', label: 'Active' }; // Green
    } else if (diffMinutes <= orangeThreshold) {
      return { color: '#f59e0b', label: 'Recent' }; // Orange
    } else {
      return { color: '#1a1a24', label: 'Inactive' }; // Black (dark)
    }
  }

  function formatLastAccessed(lastAccessed: string): string {
    const now = new Date().getTime();
    const accessed = new Date(lastAccessed).getTime();
    const diffMinutes = Math.floor((now - accessed) / (1000 * 60));

    if (diffMinutes < 1) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} min ago`;
    } else if (diffMinutes < 1440) {
      const hours = Math.floor(diffMinutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(diffMinutes / 1440);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
  }

  /**
   * Fetch a single project by ID and update the store.
   * Called when WebSocket receives 'project:updated' to get full fresh data.
   */
  async function fetchProjectById(id: string) {
    try {
      const response = await fetch(`/api/projects/${id}`);
      if (!response.ok) {
        console.error(`[Store] Failed to fetch project ${id}:`, response.statusText);
        return;
      }
      const data: Project = await response.json();
      const index = projects.value.findIndex(p => p.id === id);
      if (index !== -1) {
        projects.value[index] = data;
        console.log(`[Store] Refreshed project ${id} from server`);
      } else {
        projects.value.push(data);
        console.log(`[Store] Added new project ${id}`);
      }
    } catch (err) {
      console.error(`[Store] Failed to fetch project ${id}:`, err);
    }
  }

  /**
   * Remove a project from the local state by ID.
   * Called when WebSocket receives a 'project:updated' event with action='deleted'.
   */
  function removeProject(id: string) {
    const index = projects.value.findIndex(p => p.id === id);
    if (index !== -1) {
      projects.value.splice(index, 1);
      console.log(`[WebSocket] Removed project ${id} from state`);
    }
  }

  /**
   * Update a project in the local state by ID.
   * Called when WebSocket receives a 'project:updated' event with action='updated' or 'created'.
   */
  function updateProject(id: string, data: Partial<Project>) {
    const index = projects.value.findIndex(p => p.id === id);
    if (index !== -1) {
      projects.value[index] = { ...projects.value[index], ...data };
      console.log(`[WebSocket] Updated project ${id} in state`);
    }
  }

  /**
   * Add a new project to the local state.
   * Called when WebSocket receives a 'project:updated' event with action='created'.
   */
  function addProject(project: Project) {
    // Check if project already exists to avoid duplicates
    const exists = projects.value.findIndex(p => p.id === project.id) !== -1;
    if (!exists) {
      projects.value.push(project);
      console.log(`[WebSocket] Added project ${project.id} to state`);
    }
  }

  /**
   * Batch update projects from WebSocket events.
   * Processes multiple project updates efficiently with a single re-render.
   */
  function batchUpdateProjects(updates: Array<{ id: string; action: string; data?: Partial<Project> }>) {
    updates.forEach(update => {
      switch (update.action) {
        case 'deleted':
          removeProject(update.id);
          break;
        case 'updated':
          if (update.data) {
            updateProject(update.id, update.data);
          }
          break;
        case 'created':
          if (update.data) {
            addProject(update.data as Project);
          }
          break;
      }
    });
  }

  return {
    projects,
    loading,
    error,
    sortedProjects,
    fetchProjects,
    fetchProjectById,
    getAccessTimeIndicator,
    formatLastAccessed,
    removeProject,
    updateProject,
    addProject,
    batchUpdateProjects,
  };
});
