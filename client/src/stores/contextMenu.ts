import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Project } from './projects';

export interface ContextMenuItem {
  label: string;
  action: string;
  icon?: string;
  disabled?: boolean;
  danger?: boolean;
}

export const useContextMenuStore = defineStore('contextMenu', () => {
  // State
  const visible = ref(false);
  const x = ref(0);
  const y = ref(0);
  const selectedProject = ref<Project | null>(null);
  const menuItems = ref<ContextMenuItem[]>([
    { label: 'Open', action: 'open', icon: '→' },
    { label: 'Copy Prompt', action: 'continue', icon: '📋' },
    { label: 'Edit', action: 'edit', icon: '✏️' },
    { label: 'Archive', action: 'archive', icon: '📦', danger: true },
  ]);

  // Getters
  const isVisible = computed(() => visible.value);
  const position = computed(() => ({ x: x.value, y: y.value }));
  const project = computed(() => selectedProject.value);

  // Actions
  function show(project: Project, mouseX: number, mouseY: number) {
    selectedProject.value = project;
    x.value = mouseX;
    y.value = mouseY;
    visible.value = true;
  }

  function hide() {
    visible.value = false;
    selectedProject.value = null;
  }

  function toggle(project: Project, mouseX: number, mouseY: number) {
    if (visible.value && selectedProject.value?.id === project.id) {
      hide();
    } else {
      show(project, mouseX, mouseY);
    }
  }

  return {
    visible,
    x,
    y,
    selectedProject,
    menuItems,
    isVisible,
    position,
    project,
    show,
    hide,
    toggle,
  };
});
