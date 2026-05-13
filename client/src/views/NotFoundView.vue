<template>
  <div class="not-found-view">
    <div class="not-found-content">
      <div class="error-icon">🔍</div>
      <h1 class="error-title">404 - Page Not Found</h1>
      <p class="error-message">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div class="error-details">
        <code class="error-path">{{ $route.path }}</code>
      </div>
      <div class="action-buttons">
        <router-link to="/projects" class="btn-primary">
          <span class="btn-icon">📁</span>
          Go to Projects
        </router-link>
        <button class="btn-secondary" @click="goBack">
          <span class="btn-icon">←</span>
          Go Back
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goBack() {
  router.back();
}
</script>

<style scoped>
.not-found-view {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem;
  background-color: var(--bg-primary);
}

.not-found-content {
  text-align: center;
  max-width: 500px;
}

.error-icon {
  font-size: 4rem;
  margin-bottom: 1.5rem;
  opacity: 0.8;
}

.error-title {
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.error-message {
  font-size: 1.125rem;
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
  line-height: 1.6;
}

.error-details {
  margin-bottom: 2rem;
}

.error-path {
  display: inline-block;
  padding: 0.5rem 1rem;
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  color: var(--color-error);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9375rem;
  word-break: break-all;
}

.action-buttons {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background-color: var(--color-primary);
  color: white;
  border: none;
  border-radius: 0.5rem;
  font-size: 1rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.btn-primary:hover {
  background-color: var(--color-primary-hover);
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background-color: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background-color: var(--bg-highlight);
  border-color: var(--text-secondary);
}

.btn-icon {
  font-size: 1.125rem;
}

/* Responsive */
@media (max-width: 480px) {
  .error-title {
    font-size: 1.5rem;
  }

  .error-message {
    font-size: 1rem;
  }

  .action-buttons {
    flex-direction: column;
  }

  .btn-primary,
  .btn-secondary {
    width: 100%;
    justify-content: center;
  }
}
</style>
