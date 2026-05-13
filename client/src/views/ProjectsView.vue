<template>
  <div class="projects-view">
    <div class="header">
      <div class="header-title-section">
        <h1>Projects</h1>
      </div>
      <div class="header-actions">
        <button class="new-project-btn" @click="showCreateModal = true">
          <span class="btn-icon">+</span>
          New Project
        </button>
        <button
          class="refresh-btn"
          :class="{ loading: projectsStore.loading }"
          @click="projectsStore.fetchProjects"
          :disabled="projectsStore.loading"
        >
          <span class="refresh-icon">↻</span>
          {{ projectsStore.loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="projectsStore.loading && projectsStore.projects.length === 0" class="loading-state">
      <div class="spinner"></div>
      <p>Loading projects...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="projectsStore.error" class="error-state">
      <p class="error-message">{{ projectsStore.error }}</p>
      <button class="retry-btn" @click="projectsStore.fetchProjects">Retry</button>
    </div>

    <!-- Empty State -->
    <div v-else-if="projectsStore.projects.length === 0" class="empty-state">
      <p>No projects found</p>
      <p class="hint">Create a project in the /Projects folder to get started</p>
    </div>

    <!-- Filter Section -->
    <div v-else class="filter-section">
      <div class="filter-row">
        <div class="filter-group">
          <label for="name-filter">Search by name</label>
          <input
            id="name-filter"
            v-model="nameFilter"
            type="text"
            placeholder="Type to filter projects..."
            class="filter-input"
          />
        </div>
        <div class="filter-group">
          <label for="status-filter">Status</label>
          <select id="status-filter" v-model="statusFilter" class="filter-select">
            <option value="all">All Projects</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div class="filter-group archive-toggle-group">
          <label class="toggle-label">Show Archived</label>
          <button
            class="toggle-switch"
            :class="{ active: showArchived }"
            @click="showArchived = !showArchived"
            :aria-pressed="showArchived"
            aria-label="Toggle archived projects visibility"
          >
            <span class="toggle-track">
              <span class="toggle-thumb"></span>
            </span>
            <span class="toggle-text">{{ showArchived ? 'On' : 'Off' }}</span>
          </button>
        </div>
        <div class="filter-group archive-toggle-group">
          <label class="toggle-label">Show Executions</label>
          <button
            class="toggle-switch"
            :class="{ active: showExecutions }"
            @click="showExecutions = !showExecutions"
            :aria-pressed="showExecutions"
            aria-label="Toggle active executions visibility"
          >
            <span class="toggle-track">
              <span class="toggle-thumb"></span>
            </span>
            <span class="toggle-text">{{ showExecutions ? 'On' : 'Off' }}</span>
          </button>
        </div>
        <button
          v-if="nameFilter || statusFilter !== 'all' || showArchived || !showExecutions"
          class="clear-filters-btn"
          @click="clearFilters"
        >
          Clear Filters
        </button>
      </div>
      <p class="filter-results">
        Showing {{ filteredProjects.length }} of {{ visibleProjectsCount }} projects
        <span v-if="archivedCount > 0 && !showArchived" class="archived-hint">
          ({{ archivedCount }} archived hidden)
        </span>
      </p>
    </div>

    <!-- Active Executions Section -->
    <ActiveTasks
      v-if="showExecutions"
      class="projects-active-tasks"
      @unlock="onTaskUnlock"
    />

    <!-- Divider -->
    <div class="section-divider">
      <span class="divider-line"></span>
      <span class="divider-text">Projects</span>
      <span class="divider-line"></span>
    </div>

    <!-- No Filter Results -->
    <div v-if="filteredProjects.length === 0 && projectsStore.projects.length > 0" class="empty-state">
      <p>No projects match your filters</p>
      <p class="hint">Try adjusting your search or clear filters to see all projects</p>
      <button class="retry-btn" @click="clearFilters">Clear Filters</button>
    </div>

    <!-- Project Grid -->
    <div v-if="filteredProjects.length > 0" class="projects-grid">
      <div
        v-for="project in filteredProjects"
        :key="project.id"
        class="project-card"
        :class="{ archived: project.isArchived }"
        @click="navigateToProject(project.id)"
        @contextmenu.prevent="handleContextMenu($event, project)"
      >
        <!-- Access Time Indicator -->
        <div
          class="access-indicator"
          :style="{ backgroundColor: getIndicatorColor(project.lastAccessed) }"
          :title="getIndicatorLabel(project.lastAccessed)"
        ></div>

        <!-- Archive Ribbon -->
        <div v-if="project.isArchived" class="archive-ribbon" title="This project is archived">
          <span class="archive-ribbon-text">ARCHIVED</span>
        </div>

        <div class="project-content">
          <h3 class="project-name">{{ project.name }}</h3>
          <p v-if="project.description" class="project-description">
            {{ truncateDescription(project.description) }}
          </p>

          <div class="project-meta">
            <!-- Last Accessed -->
            <div class="last-accessed">
              <span class="access-label">Last accessed:</span>
              <span class="access-time">{{ projectsStore.formatLastAccessed(project.lastAccessed) }}</span>
            </div>

            <!-- Tier Badge -->
            <div class="tier-badge" :class="`tier-${project.currentTier}`">
              Tier {{ project.currentTier }}
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="progress-section">
            <div class="progress-bar">
              <div
                class="progress-fill"
                :style="{ width: `${calculateProgress(project)}%` }"
              ></div>
            </div>
            <span class="progress-text">{{ calculateCompletedTasks(project) }}/{{ project.tasks.length }} tasks</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Project Modal -->
    <CreateProjectModal
      v-if="showCreateModal"
      @close="showCreateModal = false"
      @created="onProjectCreated"
    />

    <!-- Project Context Menu -->
    <ProjectContextMenu
      @open="handleMenuOpen"
      @continue="handleMenuContinue"
      @edit="handleMenuEdit"
      @archive="handleMenuArchive"
    />

    <!-- Edit Project Modal -->
    <EditProjectModal
      v-if="showEditModal && projectToEdit"
      :project="projectToEdit"
      @close="showEditModal = false; projectToEdit = null"
      @updated="onProjectUpdated"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectsStore, type Project } from '../stores/projects';
import { useContextMenuStore } from '../stores/contextMenu';
import { useErrorStore } from '../stores/errors';
import CreateProjectModal from '../components/CreateProjectModal.vue';
import EditProjectModal from '../components/EditProjectModal.vue';
import ProjectContextMenu from '../components/ProjectContextMenu.vue';
import ActiveTasks from '../components/ActiveTasks.vue';

const projectsStore = useProjectsStore();
const contextMenu = useContextMenuStore();
const errorStore = useErrorStore();
const router = useRouter();

// Modal state
const showCreateModal = ref(false);
const showEditModal = ref(false);
const projectToEdit = ref<Project | null>(null);

// Filter state
const nameFilter = ref('');
const statusFilter = ref<'all' | 'active' | 'completed'>('all');
const showArchived = ref(false);
const showExecutions = ref(true);

// Count archived projects
const archivedCount = computed(() => {
  return projectsStore.projects.filter(p => p.isArchived).length;
});

// Count of visible projects (non-archived when toggle is off)
const visibleProjectsCount = computed(() => {
  if (showArchived.value) {
    return projectsStore.projects.length;
  }
  return projectsStore.projects.filter(p => !p.isArchived).length;
});

// Filtered projects computed property
const filteredProjects = computed(() => {
  let filtered = projectsStore.sortedProjects;

  // Filter out archived projects unless toggle is on
  if (!showArchived.value) {
    filtered = filtered.filter(p => !p.isArchived);
  }

  // Filter by name
  if (nameFilter.value.trim()) {
    const searchTerm = nameFilter.value.toLowerCase().trim();
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(searchTerm) ||
      (p.description && p.description.toLowerCase().includes(searchTerm))
    );
  }

  // Filter by status
  if (statusFilter.value !== 'all') {
    if (statusFilter.value === 'completed') {
      filtered = filtered.filter(p => {
        const completed = p.tasks.filter(t => t.status === 'done').length;
        return p.tasks.length > 0 && completed === p.tasks.length;
      });
    } else if (statusFilter.value === 'active') {
      filtered = filtered.filter(p => {
        const completed = p.tasks.filter(t => t.status === 'done').length;
        return p.tasks.length === 0 || completed < p.tasks.length;
      });
    }
  }

  return filtered;
});

function clearFilters() {
  nameFilter.value = '';
  statusFilter.value = 'all';
  showArchived.value = false;
  showExecutions.value = true;
}

onMounted(() => {
  projectsStore.fetchProjects();

  // Load showExecutions preference from localStorage (default to true)
  const savedShowExecutions = localStorage.getItem('tm-show-executions');
  if (savedShowExecutions !== null) {
    showExecutions.value = savedShowExecutions === 'true';
  }
});

// Watch for changes to showExecutions and save to localStorage
watch(showExecutions, (newValue) => {
  localStorage.setItem('tm-show-executions', String(newValue));
});

function navigateToProject(projectId: string) {
  router.push(`/projects/${projectId}`);
}

function onProjectCreated() {
  // Refresh the projects list after creating a new project
  projectsStore.fetchProjects();
}

function getIndicatorColor(lastAccessed: string): string {
  return projectsStore.getAccessTimeIndicator(lastAccessed).color;
}

function getIndicatorLabel(lastAccessed: string): string {
  return projectsStore.getAccessTimeIndicator(lastAccessed).label;
}

function truncateDescription(description: string, maxLength: number = 100): string {
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength).trim() + '...';
}

function calculateCompletedTasks(project: Project): number {
  return project.tasks.filter(t => t.status === 'done').length;
}

function calculateProgress(project: Project): number {
  if (project.tasks.length === 0) return 0;
  return Math.round((calculateCompletedTasks(project) / project.tasks.length) * 100);
}

// Context menu handlers
function handleContextMenu(event: MouseEvent, project: Project) {
  contextMenu.show(project, event.clientX, event.clientY);
}

function handleMenuOpen(projectId: string) {
  navigateToProject(projectId);
}

async function handleMenuContinue(projectId: string) {
  const project = projectsStore.projects.find(p => p.id === projectId);
  if (!project) return;

  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  // Find all pending tasks that aren't gated on human review
  const candidateTasks = project.tasks.filter(t =>
    t.status === 'pending' && !t.requires_human
  );

  if (candidateTasks.length === 0) {
    router.push(`/projects/${projectId}`);
    return;
  }

  // Prefer tasks in the current tier, then fall back to any tier
  const tierTasks = candidateTasks.filter(t => t.tier === project.currentTier);
  const pool = tierTasks.length > 0 ? tierTasks : candidateTasks;

  // Sort by priority
  pool.sort((a, b) =>
    (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
  );

  const nextTask = pool[0];

  // Build prompt text and copy to clipboard (same format as ProjectDetailView)
  const agentName = nextTask.agent || 'coder';
  const tierNames: Record<number, string> = {
    0: 'Discovery', 1: 'Strategy', 2: 'Architecture',
    3: 'Execution', 4: 'Delivery', 5: 'Final'
  };
  const tierName = tierNames[nextTask.tier ?? 0] || `Tier ${nextTask.tier ?? 0}`;

  const prompt = `You are an AI agent working on a task in the TaskMaster system.

## Task Details
- **Task ID:** ${nextTask.id}
- **Project:** ${project.name} (${project.id})
- **Title:** ${nextTask.title}
- **Priority:** ${nextTask.priority ?? 'medium'}
- **Tier:** ${nextTask.tier ?? 0} (${tierName})
- **Agent Role:** ${agentName}

## Description
${nextTask.description || '(No description provided)'}

${nextTask.depends_on?.length ? `## Dependencies (already complete)
${nextTask.depends_on.join(', ')}
` : ''}## Instructions
1. Complete the task described above.
2. When done, mark the task as complete by calling the TaskMaster API:
   PATCH http://localhost:3000/api/projects/${project.id}/tasks/${nextTask.id}
   Content-Type: application/json
   { "status": "done", "updated_by": "${agentName}" }
3. Do not start any other tasks. Stop after marking this one done.

## Context
- Project path: ${project.path || 'N/A'}
- Current tier: ${project.currentTier} (${tierNames[project.currentTier] || `Tier ${project.currentTier}`})
- Project status: ${project.status}
`;

  try {
    await navigator.clipboard.writeText(prompt);
    errorStore.showSuccess(
      'Prompt Copied',
      `"${nextTask.title}" prompt copied to clipboard`
    );
  } catch (err) {
    console.error('[Continue] Failed to copy prompt:', err);
    errorStore.showError(
      'Copy Failed',
      'Could not copy prompt to clipboard'
    );
  }

  router.push(`/projects/${projectId}`);
}

function handleMenuEdit(projectId: string) {
  const project = projectsStore.projects.find(p => p.id === projectId);
  if (project) {
    projectToEdit.value = project;
    showEditModal.value = true;
  }
}

function onProjectUpdated() {
  // Refresh the projects list after updating a project
  projectsStore.fetchProjects();
}

function handleMenuArchive(projectId: string) {
  // For now, just show an alert. Feature #18 will implement the actual archiving
  console.log('Archive requested for project:', projectId);
}

function onTaskUnlock(taskId: string, projectId: string) {
  console.log(`[Projects] Task ${taskId} unlocked in project ${projectId}`);
  // Refresh projects to get updated task status
  projectsStore.fetchProjects();
}
</script>

<style scoped>
.projects-view {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.header-title-section {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header h1 {
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 1rem;
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.refresh-btn:hover:not(:disabled) {
  background-color: var(--bg-highlight);
  border-color: var(--color-primary);
}

.refresh-btn.loading {
  opacity: 0.7;
  cursor: not-allowed;
}

.refresh-icon {
  font-size: 1rem;
  transition: transform 0.3s ease;
}

.refresh-btn.loading .refresh-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* New Project Button */
.new-project-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: var(--color-success);
  border: 1px solid var(--color-success);
  border-radius: 0.5rem;
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.new-project-btn:hover {
  background-color: #059669;
  border-color: #059669;
}

.btn-icon {
  font-size: 1rem;
  font-weight: 600;
}

/* Loading State */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--bg-highlight);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

/* Error State */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem;
  gap: 1rem;
}

.error-message {
  color: var(--color-error);
  font-size: 1rem;
}

.retry-btn {
  padding: 0.5rem 1.5rem;
  background-color: var(--color-primary);
  border: none;
  border-radius: 0.5rem;
  color: white;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.retry-btn:hover {
  background-color: var(--color-primary-hover);
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem;
  gap: 0.5rem;
}

.empty-state p {
  color: var(--text-secondary);
  font-size: 1.125rem;
}

.empty-state .hint {
  font-size: 0.875rem;
  opacity: 0.7;
}

/* Projects Grid */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 1.5rem;
}

.project-card {
  position: relative;
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.project-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-primary);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.15);
}

/* Access Time Indicator */
.access-indicator {
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  transition: background-color 0.3s ease;
}

.project-content {
  padding: 1.5rem;
  padding-left: 1.75rem;
}

.project-name {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
  line-height: 1.3;
}

.project-description {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0 0 1rem 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.last-accessed {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
}

.access-label {
  color: var(--text-secondary);
}

.access-time {
  color: var(--text-primary);
  font-weight: 500;
}

.tier-badge {
  padding: 0.25rem 0.625rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  background-color: var(--bg-highlight);
  color: var(--text-secondary);
}

.tier-badge.tier-0 { color: #94a3b8; }
.tier-badge.tier-1 { color: #60a5fa; }
.tier-badge.tier-2 { color: #a78bfa; }
.tier-badge.tier-3 { color: #f472b6; }
.tier-badge.tier-4 { color: #fbbf24; }
.tier-badge.tier-5 { color: #34d399; }
/* Tier 6+ cycling colors (repeats every 6 tiers) */
.tier-badge.tier-6 { color: #94a3b8; }
.tier-badge.tier-7 { color: #60a5fa; }
.tier-badge.tier-8 { color: #a78bfa; }
.tier-badge.tier-9 { color: #f472b6; }
.tier-badge.tier-10 { color: #fbbf24; }
.tier-badge.tier-11 { color: #34d399; }

/* Progress Section */
.progress-section {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background-color: var(--bg-highlight);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: var(--color-primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.75rem;
  color: var(--text-secondary);
  min-width: 60px;
  text-align: right;
}

/* Filter Section */
.filter-section {
  margin-bottom: 1.5rem;
  padding: 1rem 1.25rem;
  background-color: var(--bg-surface);
  border-radius: 0.75rem;
  border: 1px solid var(--bg-highlight);
}

.filter-row {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.filter-group label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.filter-input {
  padding: 0.5rem 0.75rem;
  background-color: var(--bg-highlight);
  border: 1px solid transparent;
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  min-width: 250px;
  transition: all 0.2s ease;
}

.filter-input:focus {
  outline: none;
  border-color: var(--color-primary);
  background-color: var(--bg-surface);
}

.filter-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.6;
}

.filter-select {
  padding: 0.5rem 0.75rem;
  background-color: var(--bg-highlight);
  border: 1px solid transparent;
  border-radius: 0.5rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  min-width: 150px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-select:focus {
  outline: none;
  border-color: var(--color-primary);
  background-color: var(--bg-surface);
}

.filter-select option {
  background-color: var(--bg-surface);
  color: var(--text-primary);
}

.clear-filters-btn {
  padding: 0.5rem 1rem;
  background-color: transparent;
  border: 1px solid var(--color-primary);
  border-radius: 0.5rem;
  color: var(--color-primary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-filters-btn:hover {
  background-color: var(--color-primary);
  color: white;
}

.filter-results {
  margin: 0.75rem 0 0 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* Toggle Switch */
.archive-toggle-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.toggle-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.toggle-switch {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.toggle-track {
  display: block;
  width: 44px;
  height: 24px;
  background-color: var(--bg-highlight);
  border-radius: 12px;
  position: relative;
  transition: background-color 0.2s ease;
}

.toggle-switch.active .toggle-track {
  background-color: var(--color-primary);
}

.toggle-thumb {
  display: block;
  width: 20px;
  height: 20px;
  background-color: white;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.toggle-switch.active .toggle-thumb {
  transform: translateX(20px);
}

.toggle-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  min-width: 24px;
}

.archived-hint {
  color: var(--text-secondary);
  opacity: 0.7;
  font-style: italic;
  margin-left: 0.5rem;
}

/* Archive Ribbon - Diagonal yellow banner */
.archive-ribbon {
  position: absolute;
  top: 0;
  right: 0;
  width: 120px;
  height: 120px;
  overflow: hidden;
  pointer-events: none;
  z-index: 10;
}

.archive-ribbon::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 150%;
  height: 28px;
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  transform: rotate(45deg) translateY(-50%);
  transform-origin: top right;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.archive-ribbon-text {
  position: absolute;
  top: 18px;
  right: 6px;
  transform: rotate(45deg);
  font-size: 0.65rem;
  font-weight: 700;
  color: #1f2937;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
  z-index: 11;
  white-space: nowrap;
}

/* Archived Project Card Styling */
.project-card.archived {
  opacity: 0.75;
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
}

.project-card.archived:hover {
  border-color: var(--color-primary);
  opacity: 0.9;
}

.project-card.archived .project-name {
  color: var(--text-secondary);
}

/* Active Tasks on Projects Page */
.projects-active-tasks {
  margin-bottom: 1.5rem;
}

/* Section Divider */
.section-divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 2.5rem 0 1.5rem 0;
  padding: 0 1rem;
}

.divider-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    to right,
    transparent,
    var(--bg-highlight) 20%,
    var(--bg-highlight) 80%,
    transparent
  );
}

.divider-text {
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* Responsive */
@media (max-width: 640px) {
  .projects-view {
    padding: 1rem;
  }

  .projects-grid {
    grid-template-columns: 1fr;
  }

  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .archive-ribbon {
    width: 90px;
    height: 90px;
  }

  .archive-ribbon::before {
    height: 22px;
  }

  .archive-ribbon-text {
    top: 14px;
    right: 2px;
    font-size: 0.55rem;
    letter-spacing: 0.05em;
  }
}
</style>
