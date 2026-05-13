/**
 * In-Memory Cache for TaskMaster
 * Stores project state loaded from filesystem
 */

import type { Project, CacheState } from '../types/index.js';

// Internal cache state
const state: CacheState = {
  projects: new Map<string, Project>(),
  lastScan: null,
  isHydrated: false
};

/**
 * Get all projects from cache
 */
export function getAllProjects(): Project[] {
  return Array.from(state.projects.values());
}

/**
 * Get a single project by ID
 */
export function getProject(id: string): Project | undefined {
  return state.projects.get(id);
}

/**
 * Set a project in the cache
 */
export function setProject(id: string, project: Project): void {
  state.projects.set(id, project);
  state.lastScan = new Date().toISOString();
}

/**
 * Remove a project from the cache
 */
export function removeProject(id: string): boolean {
  const result = state.projects.delete(id);
  if (result) {
    state.lastScan = new Date().toISOString();
  }
  return result;
}

/**
 * Clear all projects from cache
 */
export function clearCache(): void {
  state.projects.clear();
  state.lastScan = null;
  state.isHydrated = false;
}

/**
 * Check if cache has been hydrated from disk
 */
export function isCacheHydrated(): boolean {
  return state.isHydrated;
}

/**
 * Mark cache as hydrated
 */
export function markHydrated(): void {
  state.isHydrated = true;
  state.lastScan = new Date().toISOString();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  projectCount: number;
  isHydrated: boolean;
  lastScan: string | null;
} {
  return {
    projectCount: state.projects.size,
    isHydrated: state.isHydrated,
    lastScan: state.lastScan
  };
}

/**
 * Update the lastAccessed timestamp for a project
 * Updates both the cache and persists to tasks.json
 */
export function updateLastAccessed(id: string): Project | undefined {
  const project = state.projects.get(id);
  if (!project) return undefined;

  const now = new Date().toISOString();
  project.lastAccessed = now;
  project.metadata.lastUpdated = now;
  state.projects.set(id, project);

  return project;
}

/**
 * Get raw cache state (for debugging)
 */
export function getCacheState(): CacheState {
  return state;
}
