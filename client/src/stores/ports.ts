import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface PortAllocation {
  projectId: string;
  projectName: string;
  port: number;
  allocatedAt: string;
  description?: string;
  autostart?: boolean;
  projectPath?: string;
  startCommand?: string;
}

export interface PortCheckResult {
  port: number;
  available: boolean;
  allocation?: PortAllocation;
}

export const usePortsStore = defineStore('ports', () => {
  // State
  const allocations = ref<PortAllocation[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const lastFetchTime = ref<number | null>(null);

  // Getters
  const sortedAllocations = computed(() => {
    return [...allocations.value].sort((a, b) => a.port - b.port);
  });

  const allocationCount = computed(() => allocations.value.length);

  const getAllocationByProjectId = computed(() => {
    return (projectId: string): PortAllocation | undefined => {
      return allocations.value.find(a => a.projectId === projectId);
    };
  });

  const getAllocationByPort = computed(() => {
    return (port: number): PortAllocation | undefined => {
      return allocations.value.find(a => a.port === port);
    };
  });

  const isPortAllocated = computed(() => {
    return (port: number): boolean => {
      return allocations.value.some(a => a.port === port);
    };
  });

  // Actions
  async function fetchAllocations(): Promise<boolean> {
    try {
      isLoading.value = true;
      error.value = null;

      const response = await fetch('/api/ports');

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || `Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.allocations) {
        allocations.value = data.allocations;
        lastFetchTime.value = Date.now();
        return true;
      }

      return false;
    } catch (err) {
      console.error('[Ports] Error fetching allocations:', err);
      error.value = err instanceof Error ? err.message : 'Unknown error';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  async function getProjectPort(projectId: string): Promise<PortAllocation | null> {
    try {
      const response = await fetch(`/api/ports/${projectId}`);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || `Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.allocation) {
        return data.allocation;
      }

      return null;
    } catch (err) {
      console.error('[Ports] Error getting project port:', err);
      return null;
    }
  }

  async function allocatePort(
    projectId: string,
    projectName: string,
    port?: number,
    description?: string
  ): Promise<{ success: boolean; allocation?: PortAllocation; error?: string; conflict?: PortAllocation }> {
    try {
      error.value = null;

      const body: Record<string, unknown> = {
        projectId,
        projectName,
      };

      if (port !== undefined) {
        body.port = port;
      }

      if (description) {
        body.description = description;
      }

      const response = await fetch('/api/ports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409 && data.conflict) {
          return {
            success: false,
            error: data.message,
            conflict: data.conflict,
          };
        }
        throw new Error(data.message || `Server returned ${response.status}`);
      }

      if (data.success && data.allocation) {
        // Update local state
        const existingIndex = allocations.value.findIndex(a => a.projectId === projectId);
        if (existingIndex >= 0) {
          allocations.value[existingIndex] = data.allocation;
        } else {
          allocations.value.push(data.allocation);
        }

        return {
          success: true,
          allocation: data.allocation,
        };
      }

      return {
        success: false,
        error: 'Unexpected response from server',
      };
    } catch (err) {
      console.error('[Ports] Error allocating port:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      error.value = errorMsg;
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  async function updateAllocation(
    projectId: string,
    updates: Partial<Omit<PortAllocation, 'projectId' | 'port' | 'allocatedAt'>>
  ): Promise<{ success: boolean; allocation?: PortAllocation; error?: string }> {
    try {
      error.value = null;

      const response = await fetch(`/api/ports/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `Server returned ${response.status}`);
      }

      if (data.success && data.allocation) {
        // Update local state
        const existingIndex = allocations.value.findIndex(a => a.projectId === projectId);
        if (existingIndex >= 0) {
          allocations.value[existingIndex] = data.allocation;
        }

        return {
          success: true,
          allocation: data.allocation,
        };
      }

      return {
        success: false,
        error: 'Unexpected response from server',
      };
    } catch (err) {
      console.error('[Ports] Error updating allocation:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      error.value = errorMsg;
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  async function freePort(projectId: string): Promise<boolean> {
    try {
      error.value = null;

      const response = await fetch(`/api/ports/${projectId}`, {
        method: 'DELETE',
      });

      if (response.status === 404) {
        // Already freed, remove from local state
        const index = allocations.value.findIndex(a => a.projectId === projectId);
        if (index >= 0) {
          allocations.value.splice(index, 1);
        }
        return true;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || `Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        // Remove from local state
        const index = allocations.value.findIndex(a => a.projectId === projectId);
        if (index >= 0) {
          allocations.value.splice(index, 1);
        }
        return true;
      }

      return false;
    } catch (err) {
      console.error('[Ports] Error freeing port:', err);
      error.value = err instanceof Error ? err.message : 'Unknown error';
      return false;
    }
  }

  async function checkPort(port: number): Promise<PortCheckResult | null> {
    try {
      const response = await fetch(`/api/ports/check/${port}`);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || `Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        return {
          port: data.port,
          available: data.available,
          allocation: data.allocation,
        };
      }

      return null;
    } catch (err) {
      console.error('[Ports] Error checking port:', err);
      return null;
    }
  }

  // Initialize
  fetchAllocations();

  return {
    allocations,
    isLoading,
    error,
    lastFetchTime,
    sortedAllocations,
    allocationCount,
    getAllocationByProjectId,
    getAllocationByPort,
    isPortAllocated,
    fetchAllocations,
    getProjectPort,
    allocatePort,
    updateAllocation,
    freePort,
    checkPort,
  };
});
