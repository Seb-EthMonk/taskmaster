/**
 * TaskMaster Project Types
 */

/**
 * Tier definitions for the TaskMaster workflow
 * 6 tiers: 0-Discovery through 5-Final
 */
export const TIER_NAMES: Record<number, string> = {
  0: 'Discovery',
  1: 'Strategy',
  2: 'Architecture',
  3: 'Execution',
  4: 'Delivery',
  5: 'Final'
};

/**
 * Get the tier name for a given tier number
 * @param tier - Tier number (0+)
 * @returns Tier name - named tiers 0-5, or 'Tier N' for tiers 6+
 */
export function getTierName(tier: number): string {
  // Return named tier for 0-5, or 'Tier N' for 6+
  return TIER_NAMES[tier] ?? `Tier ${tier}`;
}

/**
 * Get all tier definitions
 * Returns the 6 base tiers (0-5). For dynamic tier support beyond tier 5,
 * use getTierName() which returns 'Tier N' for tiers 6+.
 * @returns Array of tier objects with number and name
 */
export function getTierDefinitions(): Array<{ number: number; name: string }> {
  return Object.entries(TIER_NAMES).map(([number, name]) => ({
    number: parseInt(number, 10),
    name
  }));
}

/**
 * Check if a tier number is valid (0 or higher)
 * @param tier - Tier number to validate
 * @returns true if tier is a valid non-negative number
 */
export function isValidTier(tier: number): boolean {
  return typeof tier === 'number' && tier >= 0 && Number.isInteger(tier);
}

/**
 * Maximum tier number (5 - Final)
 */
export const MAX_TIER = 5;

/**
 * Minimum tier number (0 - Discovery)
 */
export const MIN_TIER = 0;

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  tier?: number;
  agent?: string; // Assigned agent role for this task
  created: string;
  started?: string;
  completed?: string;

  // Lock/claim fields
  locked_by?: string | null;
  locked_at?: string | null;
  reclaim_after?: string | null;
  heartbeat_interval?: number; // seconds, default 30

  // Model hint — preferred call_llm provider for delegated subtasks (e.g. "gemini-flash", "kimi", "deepseek")
  model?: string | null;

  // Workflow control
  gate?: string | null; // e.g. "qa", "security", null
  depends_on?: string[]; // array of task IDs that must be 'done' first
  requires_human?: boolean; // if true, block lock/assign until cleared manually

  // Audit trail
  last_updated_by?: string | null;
  last_updated_at?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  path: string;
  currentTier: number;
  status: 'active' | 'completed' | 'archived' | 'awaiting_approval' | 'paused';
  created: string;
  lastAccessed: string;
  tasks: Task[];
  metadata: ProjectMetadata;
  completedTiers: number[]; // Array of tier numbers that have been completed
}

export interface ProjectMetadata {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  lastUpdated: string;
}

export interface TasksJsonMetadata {
  totalTasks?: number;
  completedTasks?: number;
  inProgressTasks?: number;
  pendingTasks?: number;
  lastUpdated?: string;
  created?: string;
  updated?: string;
}

export interface TasksJson {
  version?: string;
  project?: string;
  updated?: string; // keep for backwards compat
  tasks: Task[];
  approvedTier?: number; // The tier that has been explicitly approved (for manual approval workflow)
  paused?: boolean; // Whether the workflow is currently paused
  metadata?: TasksJsonMetadata;
}

export interface CacheState {
  projects: Map<string, Project>;
  lastScan: string | null;
  isHydrated: boolean;
}
