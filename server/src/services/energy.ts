/**
 * Energy Service
 * Server-side energy state management for TaskMaster.
 * State is persisted to server/data/energy.json.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const ENERGY_FILE = join(DATA_DIR, 'energy.json');

// Energy consumption per task priority level
export const ENERGY_COSTS: Record<string, number> = {
  low: 5,
  medium: 10,
  high: 15,
  critical: 20,
};

// Feed items that restore energy
export const FEED_ITEMS = [
  { id: 'coffee',    name: 'Coffee',    emoji: '☕', amount: 10 },
  { id: 'apple',     name: 'Apple',     emoji: '🍎', amount: 25 },
  { id: 'pizza',     name: 'Pizza',     emoji: '🍕', amount: 40 },
  { id: 'ice_cream', name: 'Ice Cream', emoji: '🍦', amount: 60 },
] as const;

export type FeedItemId = 'coffee' | 'apple' | 'pizza' | 'ice_cream';

export interface EnergyReceipt {
  id: string;
  timestamp: string;
  action: 'consumption' | 'regeneration' | 'feed';
  amount: number;
  description: string;
}

export interface EnergyState {
  enabled: boolean;
  currentEnergy: number;
  maxEnergy: number;
  threshold: number;
  lastRegeneration: string;
  receipts: EnergyReceipt[];
}

export interface EnergyView extends EnergyState {
  energyPercentage: number;
  isAtZero: boolean;
  isBelowThreshold: boolean;
}

const MAX_RECEIPTS = 100;

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_STATE: EnergyState = {
  enabled: false,
  currentEnergy: 100,
  maxEnergy: 100,
  threshold: 10,
  lastRegeneration: new Date().toISOString(),
  receipts: [],
};

// ─── File I/O ────────────────────────────────────────────────────────────────

async function ensureDataDir(): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch {
    // Already exists
  }
}

export async function loadEnergy(): Promise<EnergyState> {
  await ensureDataDir();
  try {
    const raw = await readFile(ENERGY_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<EnergyState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
    };
  } catch {
    // File missing or corrupt — return defaults and persist them
    await saveEnergy(DEFAULT_STATE);
    return { ...DEFAULT_STATE };
  }
}

export async function saveEnergy(state: EnergyState): Promise<void> {
  await ensureDataDir();
  // Trim receipts to max
  const trimmed: EnergyState = {
    ...state,
    receipts: state.receipts.slice(-MAX_RECEIPTS),
  };
  await writeFile(ENERGY_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
}

// ─── Computed view ───────────────────────────────────────────────────────────

export function toView(state: EnergyState): EnergyView {
  const energyPercentage = state.maxEnergy === 0
    ? 0
    : Math.round((state.currentEnergy / state.maxEnergy) * 100);
  return {
    ...state,
    energyPercentage,
    isAtZero: state.currentEnergy <= 0,
    isBelowThreshold: energyPercentage <= state.threshold,
  };
}

// ─── Passive regeneration ────────────────────────────────────────────────────

/**
 * Apply passive regeneration (5% of max per 30-minute interval).
 * Called on every read — no background job needed.
 * Mutates state in place and returns whether anything changed.
 */
export function applyRegeneration(state: EnergyState): boolean {
  if (!state.enabled) return false;
  if (state.currentEnergy >= state.maxEnergy) return false;

  const now = Date.now();
  const last = new Date(state.lastRegeneration).getTime();
  const intervals = Math.floor((now - last) / (30 * 60 * 1000));
  if (intervals <= 0) return false;

  const regenAmount = Math.floor(state.maxEnergy * 0.05 * intervals);
  if (regenAmount <= 0) return false;

  const before = state.currentEnergy;
  state.currentEnergy = Math.min(state.maxEnergy, state.currentEnergy + regenAmount);
  const actual = state.currentEnergy - before;
  state.lastRegeneration = new Date().toISOString();

  if (actual > 0) {
    state.receipts.push({
      id: `receipt_${Date.now()}_regen`,
      timestamp: state.lastRegeneration,
      action: 'regeneration',
      amount: actual,
      description: `Passive regeneration (${intervals} interval${intervals > 1 ? 's' : ''})`,
    });
  }

  return true;
}

// ─── Core operations ─────────────────────────────────────────────────────────

/**
 * Check energy and consume if sufficient.
 * Returns success=true if energy was consumed (or system is disabled).
 * Called by the /lock endpoint before claiming a task.
 */
export async function checkAndConsumeEnergy(
  amount: number,
  description: string
): Promise<{ success: boolean; currentEnergy: number; maxEnergy: number }> {
  const state = await loadEnergy();
  applyRegeneration(state);

  if (!state.enabled) {
    // System disabled — no cost, always succeeds
    await saveEnergy(state);
    return { success: true, currentEnergy: state.currentEnergy, maxEnergy: state.maxEnergy };
  }

  if (state.currentEnergy < amount) {
    await saveEnergy(state);
    return { success: false, currentEnergy: state.currentEnergy, maxEnergy: state.maxEnergy };
  }

  state.currentEnergy = Math.max(0, state.currentEnergy - amount);
  state.receipts.push({
    id: `receipt_${Date.now()}_consume`,
    timestamp: new Date().toISOString(),
    action: 'consumption',
    amount: -amount,
    description,
  });

  await saveEnergy(state);
  return { success: true, currentEnergy: state.currentEnergy, maxEnergy: state.maxEnergy };
}

/**
 * Feed energy using a named feed item.
 */
export async function feedEnergy(feedItemId: string): Promise<{
  success: boolean;
  error?: string;
  previousEnergy?: number;
  currentEnergy?: number;
  maxEnergy?: number;
  receipt?: EnergyReceipt;
  feedItem?: typeof FEED_ITEMS[number];
}> {
  const item = FEED_ITEMS.find(f => f.id === feedItemId);
  if (!item) {
    return { success: false, error: `Unknown feed item: ${feedItemId}` };
  }

  const state = await loadEnergy();
  applyRegeneration(state);

  if (!state.enabled) {
    return { success: false, error: 'Energy system is disabled' };
  }

  if (state.currentEnergy >= state.maxEnergy) {
    return { success: false, error: 'Already at maximum energy' };
  }

  const previous = state.currentEnergy;
  state.currentEnergy = Math.min(state.maxEnergy, state.currentEnergy + item.amount);
  const actual = state.currentEnergy - previous;

  const receipt: EnergyReceipt = {
    id: `receipt_${Date.now()}_feed`,
    timestamp: new Date().toISOString(),
    action: 'feed',
    amount: actual,
    description: `Fed ${item.name} ${item.emoji}`,
  };
  state.receipts.push(receipt);

  await saveEnergy(state);
  return {
    success: true,
    previousEnergy: previous,
    currentEnergy: state.currentEnergy,
    maxEnergy: state.maxEnergy,
    receipt,
    feedItem: item,
  };
}

/**
 * Update energy settings (enabled, maxEnergy, threshold).
 */
export async function updateEnergySettings(updates: {
  enabled?: boolean;
  maxEnergy?: number;
  threshold?: number;
}): Promise<EnergyView> {
  const state = await loadEnergy();
  applyRegeneration(state);

  if (updates.enabled !== undefined) state.enabled = updates.enabled;
  if (updates.maxEnergy !== undefined) {
    state.maxEnergy = Math.max(10, Math.min(1000, updates.maxEnergy));
    // Clamp current energy to new max
    state.currentEnergy = Math.min(state.currentEnergy, state.maxEnergy);
  }
  if (updates.threshold !== undefined) {
    state.threshold = Math.max(5, Math.min(50, updates.threshold));
  }

  await saveEnergy(state);
  return toView(state);
}

/**
 * Get current energy state with regen applied.
 */
export async function getEnergyState(): Promise<EnergyView> {
  const state = await loadEnergy();
  const changed = applyRegeneration(state);
  if (changed) await saveEnergy(state);
  return toView(state);
}

/**
 * Reset energy to defaults.
 */
export async function resetEnergy(): Promise<EnergyView> {
  const fresh: EnergyState = {
    ...DEFAULT_STATE,
    lastRegeneration: new Date().toISOString(),
  };
  await saveEnergy(fresh);
  return toView(fresh);
}

/**
 * Directly consume energy (explicit amount, for external callers).
 */
export async function consumeEnergyDirect(
  amount: number,
  description: string
): Promise<{ success: boolean; error?: string; currentEnergy: number; maxEnergy: number; receipt?: EnergyReceipt }> {
  const state = await loadEnergy();
  applyRegeneration(state);

  if (!state.enabled) {
    await saveEnergy(state);
    return { success: true, currentEnergy: state.currentEnergy, maxEnergy: state.maxEnergy };
  }

  if (amount <= 0) {
    return { success: false, error: 'Amount must be a positive integer', currentEnergy: state.currentEnergy, maxEnergy: state.maxEnergy };
  }

  if (state.currentEnergy < amount) {
    await saveEnergy(state);
    return { success: false, error: 'Insufficient energy', currentEnergy: state.currentEnergy, maxEnergy: state.maxEnergy };
  }

  state.currentEnergy = Math.max(0, state.currentEnergy - amount);
  const receipt: EnergyReceipt = {
    id: `receipt_${Date.now()}_manual`,
    timestamp: new Date().toISOString(),
    action: 'consumption',
    amount: -amount,
    description,
  };
  state.receipts.push(receipt);

  await saveEnergy(state);
  return { success: true, currentEnergy: state.currentEnergy, maxEnergy: state.maxEnergy, receipt };
}
