import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface BackgroundSettings {
  imagePath: string;
  opacity: number;
  enabled: boolean;
}

export interface TimeThresholdSettings {
  green: number;  // minutes
  orange: number; // minutes
}

const STORAGE_KEY = 'taskmaster_settings';
const SERVER_SYNC_KEY = 'taskmaster_settings_synced';
const DEFAULT_OPACITY = 0.15;
const DEFAULT_BRIGHTNESS = 1.0;
const DEFAULT_GREEN_THRESHOLD = 5;   // 5 minutes
const DEFAULT_ORANGE_THRESHOLD = 20; // 20 minutes

export const useSettingsStore = defineStore('settings', () => {
  // State
  const backgroundImage = ref<string>('');
  const backgroundOpacity = ref<number>(DEFAULT_OPACITY);
  const backgroundBrightness = ref<number>(DEFAULT_BRIGHTNESS);
  const backgroundEnabled = ref<boolean>(false);

  // Time threshold settings (in minutes)
  const greenThreshold = ref<number>(DEFAULT_GREEN_THRESHOLD);
  const orangeThreshold = ref<number>(DEFAULT_ORANGE_THRESHOLD);

  // Server sync state
  const isLoading = ref(false);
  const lastSyncTime = ref<number | null>(null);
  const serverAvailable = ref(true);

  // Getters
  const hasBackgroundImage = computed(() => {
    return backgroundEnabled.value && backgroundImage.value.trim().length > 0;
  });

  const timeThresholds = computed<TimeThresholdSettings>(() => ({
    green: greenThreshold.value,
    orange: orangeThreshold.value,
  }));

  const overlayStyle = computed(() => {
    if (!hasBackgroundImage.value) {
      return {};
    }
    return {
      backgroundImage: `url(${backgroundImage.value})`,
      opacity: backgroundOpacity.value,
    };
  });

  // Actions
  function loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        backgroundImage.value = parsed.backgroundImage || '';
        backgroundOpacity.value = parsed.backgroundOpacity ?? DEFAULT_OPACITY;
        backgroundBrightness.value = parsed.backgroundBrightness ?? DEFAULT_BRIGHTNESS;
        backgroundEnabled.value = parsed.backgroundEnabled ?? false;
        greenThreshold.value = parsed.greenThreshold ?? DEFAULT_GREEN_THRESHOLD;
        orangeThreshold.value = parsed.orangeThreshold ?? DEFAULT_ORANGE_THRESHOLD;
      }
    } catch (err) {
      console.error('Error loading settings:', err);
      resetToDefaults();
    }
  }

  function saveSettings() {
    try {
      const settings = {
        backgroundImage: backgroundImage.value,
        backgroundOpacity: backgroundOpacity.value,
        backgroundBrightness: backgroundBrightness.value,
        backgroundEnabled: backgroundEnabled.value,
        greenThreshold: greenThreshold.value,
        orangeThreshold: orangeThreshold.value,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Error saving settings:', err);
    }
  }

  /**
   * Convert store state to settings object for server
   */
  function getSettingsObject() {
    return {
      background: {
        imagePath: backgroundImage.value,
        opacity: backgroundOpacity.value,
        brightness: backgroundBrightness.value,
        enabled: backgroundEnabled.value,
      },
      thresholds: {
        green: greenThreshold.value,
        orange: orangeThreshold.value,
      },
    };
  }

  /**
   * Apply settings from server/localStorage to store state
   */
  function applySettings(settings: {
    background?: {
      imagePath?: string;
      opacity?: number;
      brightness?: number;
      enabled?: boolean;
    };
    thresholds?: {
      green?: number;
      orange?: number;
    };
  }) {
    if (settings.background) {
      backgroundImage.value = settings.background.imagePath ?? backgroundImage.value;
      backgroundOpacity.value = settings.background.opacity ?? backgroundOpacity.value;
      backgroundBrightness.value = settings.background.brightness ?? backgroundBrightness.value;
      backgroundEnabled.value = settings.background.enabled ?? backgroundEnabled.value;
    }

    if (settings.thresholds) {
      greenThreshold.value = settings.thresholds.green ?? greenThreshold.value;
      orangeThreshold.value = settings.thresholds.orange ?? orangeThreshold.value;
    }
  }

  /**
   * Sync settings with server - GET from server
   * On first sync, migrates localStorage data to server
   */
  async function syncWithServer(): Promise<boolean> {
    try {
      isLoading.value = true;

      const response = await fetch('/api/settings');

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.settings) {
        const serverSettings = data.settings;
        const hasLocalData = localStorage.getItem(STORAGE_KEY) !== null;
        const hasServerData = serverSettings.background?.imagePath ||
                              serverSettings.thresholds?.green !== undefined;
        const hasSyncedBefore = localStorage.getItem(SERVER_SYNC_KEY) === 'true';

        if (!hasSyncedBefore && hasLocalData && !hasServerData) {
          // First sync with local data but no server data - migrate to server
          console.log('[Settings] Migrating local data to server...');
          await saveSettingsToServer();
          localStorage.setItem(SERVER_SYNC_KEY, 'true');
        } else {
          // Use server data (server is source of truth)
          applySettings(serverSettings);
          saveSettings(); // Update localStorage cache
          localStorage.setItem(SERVER_SYNC_KEY, 'true');
        }

        lastSyncTime.value = Date.now();
        serverAvailable.value = true;
        return true;
      }

      return false;
    } catch (err) {
      console.warn('[Settings] Server sync failed, using localStorage:', err);
      serverAvailable.value = false;
      // Fall back to localStorage (already loaded in loadSettings)
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Save settings to server - POST to server
   */
  async function saveSettingsToServer(): Promise<boolean> {
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getSettingsObject()),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        lastSyncTime.value = Date.now();
        serverAvailable.value = true;
        return true;
      }

      return false;
    } catch (err) {
      console.warn('[Settings] Server save failed:', err);
      serverAvailable.value = false;
      return false;
    }
  }

  /**
   * Save settings to both localStorage and server
   */
  async function saveSettingsWithSync() {
    saveSettings();

    // Sync to server (don't wait, fire and forget)
    if (serverAvailable.value) {
      saveSettingsToServer().catch(err => {
        console.warn('[Settings] Background server sync failed:', err);
      });
    }
  }

  function setGreenThreshold(minutes: number) {
    // Ensure green threshold is at least 1 minute and less than orange threshold
    const validMinutes = Math.max(1, Math.min(orangeThreshold.value - 1, minutes));
    greenThreshold.value = validMinutes;
    saveSettingsWithSync();
  }

  function setOrangeThreshold(minutes: number) {
    // Ensure orange threshold is greater than green threshold
    const validMinutes = Math.max(greenThreshold.value + 1, minutes);
    orangeThreshold.value = validMinutes;
    saveSettingsWithSync();
  }

  function resetTimeThresholds() {
    greenThreshold.value = DEFAULT_GREEN_THRESHOLD;
    orangeThreshold.value = DEFAULT_ORANGE_THRESHOLD;
    saveSettingsWithSync();
  }

  function setBackgroundImage(path: string) {
    backgroundImage.value = path;
    if (path) {
      backgroundEnabled.value = true;
    }
    saveSettingsWithSync();
  }

  function setBackgroundOpacity(opacity: number) {
    // Clamp opacity between 0.05 and 1.0
    backgroundOpacity.value = Math.max(0.05, Math.min(1.0, opacity));
    saveSettingsWithSync();
  }

  function setBackgroundBrightness(brightness: number) {
    // Clamp brightness between 0.2 and 1.5
    backgroundBrightness.value = Math.max(0.2, Math.min(1.5, brightness));
    saveSettingsWithSync();
  }

  function toggleBackground(enabled: boolean) {
    backgroundEnabled.value = enabled;
    saveSettingsWithSync();
  }

  function clearBackground() {
    backgroundImage.value = '';
    backgroundEnabled.value = false;
    backgroundOpacity.value = DEFAULT_OPACITY;
    backgroundBrightness.value = DEFAULT_BRIGHTNESS;
    saveSettingsWithSync();
  }

  function resetToDefaults() {
    backgroundImage.value = '';
    backgroundOpacity.value = DEFAULT_OPACITY;
    backgroundBrightness.value = DEFAULT_BRIGHTNESS;
    backgroundEnabled.value = false;
    saveSettingsWithSync();
  }

  // Initialize on store creation
  loadSettings();
  // Attempt server sync (async, don't block)
  syncWithServer();

  return {
    backgroundImage,
    backgroundOpacity,
    backgroundBrightness,
    backgroundEnabled,
    hasBackgroundImage,
    overlayStyle,
    greenThreshold,
    orangeThreshold,
    timeThresholds,
    isLoading,
    lastSyncTime,
    serverAvailable,
    loadSettings,
    saveSettings,
    syncWithServer,
    setBackgroundImage,
    setBackgroundOpacity,
    setBackgroundBrightness,
    toggleBackground,
    clearBackground,
    resetToDefaults,
    setGreenThreshold,
    setOrangeThreshold,
    resetTimeThresholds,
  };
});
