import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface TaskProgress {
  taskId: string;
  projectId: string;
  message: string;
  percent: number;
  timestamp: string;
  status: 'running' | 'completed' | 'error';
}

export const useTaskProgressStore = defineStore('taskProgress', () => {
  // State - map of taskId to progress
  const progressMap = ref<Map<string, TaskProgress>>(new Map());

  // Getters
  const getTaskProgress = computed(() => {
    return (taskId: string): TaskProgress | undefined => {
      return progressMap.value.get(taskId);
    };
  });

  const isTaskRunning = computed(() => {
    return (taskId: string): boolean => {
      const progress = progressMap.value.get(taskId);
      return progress?.status === 'running';
    };
  });

  const getRunningTasksForProject = computed(() => {
    return (projectId: string): TaskProgress[] => {
      return Array.from(progressMap.value.values()).filter(
        p => p.projectId === projectId && p.status === 'running'
      );
    };
  });

  // Actions
  function setTaskProgress(
    projectId: string,
    taskId: string,
    message: string,
    percent?: number
  ): void {
    progressMap.value.set(taskId, {
      taskId,
      projectId,
      message,
      percent: percent ?? 0,
      timestamp: new Date().toISOString(),
      status: 'running'
    });
  }

  function markTaskCompleted(taskId: string): void {
    const progress = progressMap.value.get(taskId);
    if (progress) {
      progress.status = 'completed';
      progress.percent = 100;
      progress.timestamp = new Date().toISOString();

      // Clear after a delay to allow UI to show completion
      setTimeout(() => {
        progressMap.value.delete(taskId);
      }, 3000);
    }
  }

  function markTaskError(taskId: string, errorMessage?: string): void {
    const progress = progressMap.value.get(taskId);
    if (progress) {
      progress.status = 'error';
      progress.message = errorMessage || 'Task failed';
      progress.timestamp = new Date().toISOString();

      // Clear after a delay to allow UI to show error
      setTimeout(() => {
        progressMap.value.delete(taskId);
      }, 5000);
    }
  }

  function clearTaskProgress(taskId: string): void {
    progressMap.value.delete(taskId);
  }

  function clearProjectProgress(projectId: string): void {
    for (const [taskId, progress] of progressMap.value.entries()) {
      if (progress.projectId === projectId) {
        progressMap.value.delete(taskId);
      }
    }
  }

  return {
    progressMap,
    getTaskProgress,
    isTaskRunning,
    getRunningTasksForProject,
    setTaskProgress,
    markTaskCompleted,
    markTaskError,
    clearTaskProgress,
    clearProjectProgress
  };
});
