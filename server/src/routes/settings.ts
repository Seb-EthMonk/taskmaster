import { Router } from 'express';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { callLLM } from '../llm/dispatch.js';
import type { LLMProviderConfig } from '../llm/dispatch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// Data directory for user settings
const DATA_DIR = join(__dirname, '../../data');
const SETTINGS_FILE = join(DATA_DIR, 'user-settings.json');

const DEFAULT_LLM_PROVIDERS: LLMProviderConfig[] = [
  { id: 'kimi',              name: 'KIMI (Moonshot)',  baseUrl: 'https://api.moonshot.cn/v1',                              apiKey: '', model: 'moonshot-v1-32k',   maxTokens: 32000, timeoutMs: 300000 },
  { id: 'gemini-flash',      name: 'Gemini Flash',     baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '', model: 'gemini-2.0-flash',  maxTokens: 32000, timeoutMs: 120000 },
  { id: 'deepseek',          name: 'DeepSeek V3',      baseUrl: 'https://api.deepseek.com/v1',                             apiKey: '', model: 'deepseek-chat',      maxTokens: 16000, timeoutMs: 300000 },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1',      baseUrl: 'https://api.deepseek.com/v1',                             apiKey: '', model: 'deepseek-reasoner',  maxTokens: 16000, timeoutMs: 300000 },
];

// Default settings
const DEFAULT_SETTINGS = {
  customLinks: [] as CustomLink[],
  background: {
    imagePath: '',
    opacity: 0.15,
    enabled: false,
  },
  thresholds: {
    green: 5,   // 5 minutes
    orange: 20, // 20 minutes
  },
  loopModeEnabled: false,
  providers: DEFAULT_LLM_PROVIDERS as LLMProviderConfig[],
  modelDefaults: {
    research: 'kimi',
    coding: 'deepseek',
    ingestion: 'gemini-flash',
  },
  version: '1.0',
};

// Types
export interface CustomLink {
  id: string;
  emoji: string;
  name: string;
  type: 'folder' | 'website' | 'agent';
  target: string;
}

export interface UserSettings {
  customLinks: CustomLink[];
  background: {
    imagePath: string;
    opacity: number;
    enabled: boolean;
  };
  thresholds: {
    green: number;
    orange: number;
  };
  loopModeEnabled: boolean;
  providers: LLMProviderConfig[];
  modelDefaults: {
    research: string;
    coding: string;
    ingestion: string;
  };
  version: string;
}

export type { LLMProviderConfig };

/**
 * Ensure data directory exists
 */
async function ensureDataDir(): Promise<void> {
  try {
    await access(DATA_DIR);
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

/**
 * Load settings from file, creating defaults if needed
 */
export async function loadSettings(): Promise<UserSettings> {
  await ensureDataDir();

  try {
    const content = await readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(content);

    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      background: { ...DEFAULT_SETTINGS.background, ...parsed.background },
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...parsed.thresholds },
      modelDefaults: { ...DEFAULT_SETTINGS.modelDefaults, ...parsed.modelDefaults },
      providers: Array.isArray(parsed.providers) && parsed.providers.length > 0
        ? parsed.providers
        : DEFAULT_SETTINGS.providers,
    };
  } catch (err: unknown) {
    const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (isNotFound) {
      // First run — file doesn't exist yet, write defaults
      await saveSettings(DEFAULT_SETTINGS);
    }
    // Any other error (bad JSON, race condition, partial write) — return defaults
    // without overwriting, so no saved data is destroyed
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to file
 */
async function saveSettings(settings: UserSettings): Promise<void> {
  await ensureDataDir();
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Validate custom link
 */
function validateLink(link: Partial<CustomLink>): { valid: boolean; error?: string } {
  if (!link.name?.trim()) {
    return { valid: false, error: 'Name is required' };
  }
  if (!link.emoji?.trim()) {
    return { valid: false, error: 'Emoji is required' };
  }
  if (!link.type || !['folder', 'website', 'agent'].includes(link.type)) {
    return { valid: false, error: 'Type must be folder, website, or agent' };
  }
  if (!link.target?.trim()) {
    return { valid: false, error: 'Target is required' };
  }

  // Type-specific validation
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

/**
 * Validate settings object
 */
function validateSettings(settings: Partial<UserSettings>): { valid: boolean; error?: string } {
  // Validate custom links if provided
  if (settings.customLinks !== undefined) {
    if (!Array.isArray(settings.customLinks)) {
      return { valid: false, error: 'customLinks must be an array' };
    }

    for (const link of settings.customLinks) {
      const validation = validateLink(link);
      if (!validation.valid) {
        return { valid: false, error: `Invalid link "${link.name || 'unnamed'}": ${validation.error}` };
      }
    }
  }

  // Validate background settings if provided
  if (settings.background !== undefined) {
    if (typeof settings.background !== 'object') {
      return { valid: false, error: 'background must be an object' };
    }

    if (settings.background.opacity !== undefined) {
      const opacity = settings.background.opacity;
      if (typeof opacity !== 'number' || opacity < 0 || opacity > 1) {
        return { valid: false, error: 'background.opacity must be a number between 0 and 1' };
      }
    }

    if (settings.background.enabled !== undefined) {
      if (typeof settings.background.enabled !== 'boolean') {
        return { valid: false, error: 'background.enabled must be a boolean' };
      }
    }
  }

  // Validate thresholds if provided
  if (settings.thresholds !== undefined) {
    if (typeof settings.thresholds !== 'object') {
      return { valid: false, error: 'thresholds must be an object' };
    }

    const { green, orange } = settings.thresholds;

    if (green !== undefined) {
      if (typeof green !== 'number' || green < 1 || !Number.isInteger(green)) {
        return { valid: false, error: 'thresholds.green must be a positive integer' };
      }
    }

    if (orange !== undefined) {
      if (typeof orange !== 'number' || orange < 1 || !Number.isInteger(orange)) {
        return { valid: false, error: 'thresholds.orange must be a positive integer' };
      }
    }

    // Ensure green < orange if both are provided
    if (green !== undefined && orange !== undefined && green >= orange) {
      return { valid: false, error: 'thresholds.green must be less than thresholds.orange' };
    }
  }

  // Validate loopModeEnabled if provided
  if (settings.loopModeEnabled !== undefined) {
    if (typeof settings.loopModeEnabled !== 'boolean') {
      return { valid: false, error: 'loopModeEnabled must be a boolean' };
    }
  }

  return { valid: true };
}

// GET /api/settings - Get all user settings
router.get('/', async (req, res) => {
  try {
    const settings = await loadSettings();

    res.json({
      success: true,
      settings,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Settings] Error loading settings:', err);
    res.status(500).json({
      error: 'Failed to load settings',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /api/settings - Save all user settings
router.post('/', async (req, res) => {
  try {
    const newSettings = req.body;

    // Validate the incoming settings
    const validation = validateSettings(newSettings);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid settings',
        message: validation.error,
      });
    }

    // Load existing settings and merge
    const currentSettings = await loadSettings();
    const mergedSettings: UserSettings = {
      ...currentSettings,
      ...newSettings,
      background: { ...currentSettings.background, ...newSettings.background },
      thresholds: { ...currentSettings.thresholds, ...newSettings.thresholds },
    };

    // Save the merged settings
    await saveSettings(mergedSettings);

    console.log('[Settings] Settings saved successfully');

    res.json({
      success: true,
      settings: mergedSettings,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Settings] Error saving settings:', err);
    res.status(500).json({
      error: 'Failed to save settings',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /api/settings/links - Get custom links only
router.get('/links', async (req, res) => {
  try {
    const settings = await loadSettings();

    res.json({
      success: true,
      links: settings.customLinks,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Settings] Error loading links:', err);
    res.status(500).json({
      error: 'Failed to load links',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /api/settings/links - Save custom links only
router.post('/links', async (req, res) => {
  try {
    const { links } = req.body;

    if (!Array.isArray(links)) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'links must be an array',
      });
    }

    // Validate each link
    for (const link of links) {
      const validation = validateLink(link);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Invalid link',
          message: validation.error,
        });
      }
    }

    // Load existing settings and update links
    const currentSettings = await loadSettings();
    currentSettings.customLinks = links;

    await saveSettings(currentSettings);

    console.log(`[Settings] Saved ${links.length} custom links`);

    res.json({
      success: true,
      links: currentSettings.customLinks,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Settings] Error saving links:', err);
    res.status(500).json({
      error: 'Failed to save links',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /api/settings/background - Get background settings only
router.get('/background', async (req, res) => {
  try {
    const settings = await loadSettings();

    res.json({
      success: true,
      background: settings.background,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Settings] Error loading background settings:', err);
    res.status(500).json({
      error: 'Failed to load background settings',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /api/settings/background - Save background settings only
router.post('/background', async (req, res) => {
  try {
    const { background } = req.body;

    if (typeof background !== 'object') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'background must be an object',
      });
    }

    // Validate background settings
    if (background.opacity !== undefined) {
      if (typeof background.opacity !== 'number' || background.opacity < 0 || background.opacity > 1) {
        return res.status(400).json({
          error: 'Invalid opacity',
          message: 'background.opacity must be a number between 0 and 1',
        });
      }
    }

    // Load existing settings and update background
    const currentSettings = await loadSettings();
    currentSettings.background = { ...currentSettings.background, ...background };

    await saveSettings(currentSettings);

    console.log('[Settings] Background settings saved');

    res.json({
      success: true,
      background: currentSettings.background,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Settings] Error saving background settings:', err);
    res.status(500).json({
      error: 'Failed to save background settings',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /api/settings/test-model - Test an LLM provider API key
router.post('/test-model', async (req, res) => {
  try {
    const { providerId } = req.body;
    if (!providerId || typeof providerId !== 'string') {
      return res.status(400).json({ ok: false, error: 'providerId is required' });
    }

    const settings = await loadSettings();
    const provider = settings.providers.find(p => p.id === providerId);

    if (!provider) {
      return res.status(404).json({ ok: false, error: `Provider "${providerId}" not found` });
    }
    if (!provider.apiKey) {
      return res.status(400).json({ ok: false, error: `No API key configured for "${providerId}"` });
    }

    const response = await callLLM(
      provider,
      'You are a helpful assistant.',
      'Say hello in one short sentence.'
    );

    res.json({ ok: true, response });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
