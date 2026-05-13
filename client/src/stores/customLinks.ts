import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type LinkType = 'folder' | 'website' | 'agent';

export interface CustomLink {
  id: string;
  emoji: string;
  name: string;
  type: LinkType;
  target: string;
}

export const useCustomLinksStore = defineStore('customLinks', () => {
  // State
  const links = ref<CustomLink[]>([]);
  const isModalOpen = ref(false);
  const editingLink = ref<CustomLink | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const lastFetchTime = ref<number | null>(null);

  // Getters
  const sortedLinks = computed(() => {
    return [...links.value].sort((a, b) => a.name.localeCompare(b.name));
  });

  const isEditing = computed(() => editingLink.value !== null);

  // Actions
  async function fetchLinks(): Promise<boolean> {
    try {
      isLoading.value = true;
      error.value = null;

      const response = await fetch('/api/settings/links');

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.success && Array.isArray(data.links)) {
        links.value = data.links;
        lastFetchTime.value = Date.now();
        return true;
      }

      return false;
    } catch (err) {
      console.error('[CustomLinks] Error fetching links:', err);
      error.value = err instanceof Error ? err.message : 'Unknown error';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  async function saveLinksToServer(): Promise<boolean> {
    try {
      const response = await fetch('/api/settings/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links: links.value }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        lastFetchTime.value = Date.now();
        return true;
      }

      return false;
    } catch (err) {
      console.error('[CustomLinks] Error saving links:', err);
      error.value = err instanceof Error ? err.message : 'Unknown error';
      return false;
    }
  }

  async function addLink(link: Omit<CustomLink, 'id'>): Promise<CustomLink> {
    const newLink: CustomLink = {
      ...link,
      id: `link_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    };
    links.value.push(newLink);
    await saveLinksToServer();
    return newLink;
  }

  async function updateLink(id: string, updates: Partial<Omit<CustomLink, 'id'>>): Promise<CustomLink | null> {
    const index = links.value.findIndex(l => l.id === id);
    if (index !== -1) {
      links.value[index] = { ...links.value[index], ...updates };
      await saveLinksToServer();
      return links.value[index];
    }
    return null;
  }

  async function deleteLink(id: string): Promise<CustomLink | null> {
    const index = links.value.findIndex(l => l.id === id);
    if (index !== -1) {
      const deleted = links.value[index];
      links.value.splice(index, 1);
      await saveLinksToServer();
      return deleted;
    }
    return null;
  }

  function openModal(link?: CustomLink) {
    editingLink.value = link || null;
    isModalOpen.value = true;
  }

  function closeModal() {
    isModalOpen.value = false;
    editingLink.value = null;
  }

  async function handleLinkClick(link: CustomLink): Promise<boolean> {
    switch (link.type) {
      case 'folder':
        return false;

      case 'website':
        window.open(link.target, '_blank', 'noopener,noreferrer');
        return true;

      case 'agent':
        try {
          const response = await fetch(`/api/agents/${link.target}/spawn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          if (!response.ok) {
            throw new Error(`Failed to spawn agent: ${response.statusText}`);
          }
          return true;
        } catch (err) {
          console.error('Error spawning agent:', err);
          throw err;
        }

      default:
        return false;
    }
  }

  function validateLink(link: Partial<CustomLink>): { valid: boolean; error?: string } {
    if (!link.name?.trim()) {
      return { valid: false, error: 'Name is required' };
    }
    if (!link.emoji?.trim()) {
      return { valid: false, error: 'Emoji is required' };
    }
    if (!link.type) {
      return { valid: false, error: 'Type is required' };
    }
    if (!link.target?.trim()) {
      return { valid: false, error: 'Target is required' };
    }

    if (link.type === 'website') {
      try {
        const url = new URL(link.target);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return { valid: false, error: 'URL must use http:// or https://' };
        }
      } catch {
        return { valid: false, error: 'Invalid URL format' };
      }
    }

    return { valid: true };
  }

  // Initialize — fetch from server on store creation
  fetchLinks();

  return {
    links,
    sortedLinks,
    isModalOpen,
    isEditing,
    editingLink,
    isLoading,
    error,
    lastFetchTime,
    fetchLinks,
    addLink,
    updateLink,
    deleteLink,
    openModal,
    closeModal,
    handleLinkClick,
    validateLink,
  };
});
