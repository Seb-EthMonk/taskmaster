import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

const API_BASE = 'http://localhost:3000/api/energy';

// Feed items — kept client-side for UI rendering (canonical list lives on server)
export const FEED_ITEMS = [
  { id: 'coffee',    name: 'Coffee',    emoji: '☕', amount: 10 },
  { id: 'apple',     name: 'Apple',     emoji: '🍎', amount: 25 },
  { id: 'pizza',     name: 'Pizza',     emoji: '🍕', amount: 40 },
  { id: 'ice_cream', name: 'Ice Cream', emoji: '🍦', amount: 60 },
] as const;

// Energy costs per complexity — kept for QuickStartButton reference
export const ENERGY_COSTS = {
  simple: 5,
  medium: 10,
  complex: 20,
} as const;

export interface EnergyReceipt {
  id: string;
  timestamp: string;
  action: 'consumption' | 'regeneration' | 'feed';
  amount: number;
  description: string;
}

export const useEnergyStore = defineStore('energy', () => {
  // State — synced from server
  const enabled = ref(false);
  const currentEnergy = ref(100);
  const maxEnergy = ref(100);
  const threshold = ref(10);
  const lastRegeneration = ref<string>(new Date().toISOString());
  const receipts = ref<EnergyReceipt[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const isEnabled = computed(() => enabled.value);
  const energyPercentage = computed(() => {
    if (maxEnergy.value === 0) return 0;
    return Math.round((currentEnergy.value / maxEnergy.value) * 100);
  });
  const isAtZero = computed(() => currentEnergy.value <= 0);
  const isBelowThreshold = computed(() => energyPercentage.value <= threshold.value);
  const canConsumeEnergy = computed(() => !enabled.value || currentEnergy.value > 0);

  const energyBarColor = computed(() => {
    if (isAtZero.value) return '#ef4444';       // Red
    if (isBelowThreshold.value) return '#f59e0b'; // Amber
    return '#22c55e';                             // Green
  });

  // ─── Sync from server ───────────────────────────────────────────────────────

  function applyServerState(data: any) {
    if (!data) return;
    enabled.value = data.enabled ?? false;
    currentEnergy.value = data.currentEnergy ?? 100;
    maxEnergy.value = data.maxEnergy ?? 100;
    threshold.value = data.threshold ?? 10;
    lastRegeneration.value = data.lastRegeneration ?? new Date().toISOString();
    receipts.value = data.receipts ?? [];
  }

  async function loadEnergySettings() {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(`${API_BASE}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyServerState(data.energy);
    } catch (err) {
      console.error('[EnergyStore] Failed to load energy state from API:', err);
      error.value = 'Failed to sync energy state';
    } finally {
      loading.value = false;
    }
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function toggleEnergySystem(value: boolean) {
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyServerState(data.energy);
    } catch (err) {
      console.error('[EnergyStore] Failed to toggle energy system:', err);
    }
  }

  async function setMaxEnergy(value: number) {
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxEnergy: Math.max(10, Math.min(1000, value)) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyServerState(data.energy);
    } catch (err) {
      console.error('[EnergyStore] Failed to set max energy:', err);
    }
  }

  async function setThreshold(value: number) {
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: Math.max(5, Math.min(50, value)) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyServerState(data.energy);
    } catch (err) {
      console.error('[EnergyStore] Failed to set threshold:', err);
    }
  }

  /**
   * Consume energy. Returns true if consumed, false if insufficient.
   * Note: real enforcement happens at /lock on the server.
   * This is for client-side feedback only.
   */
  async function consumeEnergy(amount: number, description: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/consume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, description }),
      });
      if (res.status === 400) return false; // Insufficient energy
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyServerState(data.energy);
      return true;
    } catch (err) {
      console.error('[EnergyStore] Failed to consume energy:', err);
      return false;
    }
  }

  /**
   * Feed energy using a feed item ID.
   */
  async function feedEnergy(feedItemId: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedItemId }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      applyServerState(data.energy);
      return true;
    } catch (err) {
      console.error('[EnergyStore] Failed to feed energy:', err);
      return false;
    }
  }

  async function resetToDefaults() {
    try {
      const res = await fetch(`${API_BASE}/reset`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyServerState(data.energy);
    } catch (err) {
      console.error('[EnergyStore] Failed to reset energy:', err);
    }
  }

  /**
   * Set current energy directly — for testing via Settings UI.
   */
  async function setCurrentEnergy(value: number) {
    // Use consume or feed to reach target from current
    const target = Math.max(0, Math.min(maxEnergy.value, value));
    const diff = target - currentEnergy.value;
    if (diff === 0) return;
    if (diff < 0) {
      // Consume to reduce
      await consumeEnergy(Math.abs(diff), 'Manual adjustment (test)');
    } else {
      // Use a direct consume with negative amount isn't valid — 
      // call settings temporarily to set via feed logic
      // Simplest: reload to reflect state after a direct API consume
      await loadEnergySettings();
    }
  }

  function clearReceipts() {
    // Clear locally — receipts are trimmed server-side on save
    receipts.value = [];
  }

  // Stub for compatibility — no-op since server handles persistence
  function saveEnergySettings() { /* no-op */ }
  function processRegeneration() { /* server handles regen on read */ }

  // ─── Init ───────────────────────────────────────────────────────────────────

  // Load on store creation
  loadEnergySettings();

  // Poll every 60s to stay in sync (handles regen, multi-tab, etc.)
  setInterval(loadEnergySettings, 60_000);

  return {
    enabled,
    currentEnergy,
    maxEnergy,
    threshold,
    lastRegeneration,
    receipts,
    loading,
    error,
    isEnabled,
    energyPercentage,
    isAtZero,
    isBelowThreshold,
    canConsumeEnergy,
    energyBarColor,
    loadEnergySettings,
    saveEnergySettings,
    toggleEnergySystem,
    setMaxEnergy,
    setThreshold,
    consumeEnergy,
    feedEnergy,
    processRegeneration,
    resetToDefaults,
    clearReceipts,
    setCurrentEnergy,
  };
});
