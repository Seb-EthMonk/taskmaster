<template>
  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      class="context-menu-overlay"
      @click="contextMenu.hide"
      @contextmenu.prevent="contextMenu.hide"
    >
      <div
        class="context-menu"
        :style="menuStyle"
        @click.stop
      >
        <div v-if="contextMenu.project" class="context-menu-header">
          <span class="project-name">{{ contextMenu.project.name }}</span>
        </div>
        <div class="context-menu-items">
          <button
            v-for="item in contextMenu.menuItems"
            :key="item.action"
            class="context-menu-item"
            :class="{ disabled: item.disabled, danger: item.danger }"
            :disabled="item.disabled"
            @click="handleAction(item.action)"
          >
            <span v-if="item.icon" class="item-icon">{{ item.icon }}</span>
            <span class="item-label">{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useContextMenuStore } from '../stores/contextMenu';

const contextMenu = useContextMenuStore();

const menuStyle = computed(() => ({
  position: 'fixed' as const,
  left: `${contextMenu.x}px`,
  top: `${contextMenu.y}px`,
  zIndex: 9999,
}));

const emit = defineEmits<{
  (e: 'open', projectId: string): void;
  (e: 'continue', projectId: string): void;
  (e: 'edit', projectId: string): void;
  (e: 'archive', projectId: string): void;
}>();

function handleAction(action: string) {
  const project = contextMenu.project;
  if (!project) return;

  contextMenu.hide();

  switch (action) {
    case 'open':
      emit('open', project.id);
      break;
    case 'continue':
      emit('continue', project.id);
      break;
    case 'edit':
      emit('edit', project.id);
      break;
    case 'archive':
      emit('archive', project.id);
      break;
  }
}
</script>

<style scoped>
.context-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9998;
  background: transparent;
}

.context-menu {
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  min-width: 160px;
  overflow: hidden;
  animation: fadeIn 0.1s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.context-menu-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--bg-highlight);
  background-color: var(--bg-highlight);
}

.project-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
  display: block;
}

.context-menu-items {
  padding: 0.25rem;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  background: none;
  border: none;
  border-radius: 0.25rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.context-menu-item:hover:not(:disabled) {
  background-color: var(--bg-highlight);
}

.context-menu-item.danger {
  color: var(--color-error);
}

.context-menu-item.danger:hover:not(:disabled) {
  background-color: rgba(239, 68, 68, 0.1);
}

.context-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.item-icon {
  font-size: 0.875rem;
  width: 1rem;
  text-align: center;
}

.item-label {
  flex: 1;
}
</style>
