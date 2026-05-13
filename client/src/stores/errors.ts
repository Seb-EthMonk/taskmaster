import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface ErrorToast {
  id: string;
  title: string;
  message: string;
  type: 'error' | 'warning' | 'info' | 'success';
  duration: number;
  timestamp: number;
}

export const useErrorStore = defineStore('errors', () => {
  // State
  const toasts = ref<ErrorToast[]>([]);
  const maxToasts = 5;

  // Getters
  const activeToasts = computed(() => {
    return toasts.value
      .filter(t => Date.now() - t.timestamp < t.duration)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, maxToasts);
  });

  const hasErrors = computed(() => activeToasts.value.length > 0);

  // Actions
  function addToast(
    title: string,
    message: string,
    type: ErrorToast['type'] = 'error',
    duration: number = 5000
  ): string {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const toast: ErrorToast = {
      id,
      title,
      message,
      type,
      duration,
      timestamp: Date.now()
    };

    toasts.value.push(toast);

    // Auto-remove after duration
    setTimeout(() => {
      removeToast(id);
    }, duration);

    return id;
  }

  function removeToast(id: string): void {
    const index = toasts.value.findIndex(t => t.id === id);
    if (index > -1) {
      toasts.value.splice(index, 1);
    }
  }

  function clearAll(): void {
    toasts.value = [];
  }

  // Convenience methods for common error types
  function showError(title: string, message: string, duration?: number): string {
    return addToast(title, message, 'error', duration);
  }

  function showWarning(title: string, message: string, duration?: number): string {
    return addToast(title, message, 'warning', duration);
  }

  function showInfo(title: string, message: string, duration?: number): string {
    return addToast(title, message, 'info', duration);
  }

  function showSuccess(title: string, message: string, duration?: number): string {
    return addToast(title, message, 'success', duration);
  }

  // Handle API errors - extracts user-friendly message from response
  async function handleApiError(
    response: Response,
    defaultTitle: string = 'Error',
    defaultMessage?: string
  ): Promise<string> {
    let title = defaultTitle;
    let message = defaultMessage || `Request failed with status ${response.status}`;

    try {
      const data = await response.json();
      // Use the message field if available (our API format)
      if (data.message) {
        message = data.message;
      } else if (data.error) {
        message = data.error;
      }
      // If there's an error field, use it as title
      if (data.error && typeof data.error === 'string' && data.error !== message) {
        title = data.error;
      }
    } catch {
      // If JSON parsing fails, use status text
      message = response.statusText || message;
    }

    return addToast(title, message, 'error');
  }

  // Handle generic errors
  function handleError(
    error: unknown,
    defaultTitle: string = 'Error',
    defaultMessage: string = 'An unexpected error occurred'
  ): string {
    let title = defaultTitle;
    let message = defaultMessage;

    if (error instanceof Error) {
      // Don't expose stack traces to users - just the message
      message = error.message || defaultMessage;
    } else if (typeof error === 'string') {
      message = error;
    }

    return addToast(title, message, 'error');
  }

  return {
    toasts: activeToasts,
    hasErrors,
    addToast,
    removeToast,
    clearAll,
    showError,
    showWarning,
    showInfo,
    showSuccess,
    handleApiError,
    handleError
  };
});
