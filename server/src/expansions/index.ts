/**
 * Expansion Registry for TaskMaster
 * Manages agent expansions loaded from /Agents/Expansions/
 * Supports both file-based (expansion.md) and folder-based (Expansion/expansion.md) expansions
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXPANSIONS_DIR = join(__dirname, '../../../agents/expansions');

export interface Expansion {
  id: string;
  name: string;
  description: string;
  content: string;
  type: 'file' | 'folder';
  path: string;
  lastModified: string;
}

// In-memory expansion registry
const expansionRegistry = new Map<string, Expansion>();

/**
 * Initialize the expansion registry by scanning the expansions directory
 */
export async function initExpansionRegistry(): Promise<{ success: boolean; count: number; errors: string[] }> {
  const errors: string[] = [];

  try {
    console.log('[Expansions] Initializing expansion registry...');

    // Clear existing registry
    expansionRegistry.clear();

    // Scan expansions directory
    const entries = await readdir(EXPANSIONS_DIR);

    for (const entry of entries) {
      try {
        const entryPath = join(EXPANSIONS_DIR, entry);
        const stats = await stat(entryPath);

        if (stats.isDirectory()) {
          // Folder-based expansion: Expansion_Name/expansion_name.md
          await loadFolderExpansion(entry, entryPath);
        } else if (entry.endsWith('.md')) {
          // File-based expansion: expansion_name.md
          await loadFileExpansion(entry, entryPath);
        }
      } catch (err) {
        const errorMsg = `Failed to load expansion '${entry}': ${(err as Error).message}`;
        console.error(`[Expansions] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    console.log(`[Expansions] Registry initialized with ${expansionRegistry.size} expansions`);

    return {
      success: true,
      count: expansionRegistry.size,
      errors
    };
  } catch (err) {
    const errorMsg = `Failed to initialize expansion registry: ${(err as Error).message}`;
    console.error(`[Expansions] ${errorMsg}`);
    return { success: false, count: 0, errors: [errorMsg] };
  }
}

/**
 * Load a file-based expansion (e.g., expansion_improvement.md)
 */
async function loadFileExpansion(filename: string, filePath: string): Promise<void> {
  const content = await readFile(filePath, 'utf-8');
  const id = filename.replace('.md', '').toLowerCase();
  const stats = await stat(filePath);

  // Parse frontmatter for name and description
  const { name, description, body } = parseExpansionFrontmatter(content, id);

  const expansion: Expansion = {
    id,
    name,
    description,
    content: body,
    type: 'file',
    path: filePath,
    lastModified: stats.mtime.toISOString()
  };

  expansionRegistry.set(id, expansion);
  console.log(`[Expansions] Loaded file expansion: ${id}`);
}

/**
 * Load a folder-based expansion (e.g., Expansion_Name/expansion_name.md)
 */
async function loadFolderExpansion(folderName: string, folderPath: string): Promise<void> {
  // Look for the main .md file inside the folder
  const folderId = folderName.toLowerCase().replace(/\s+/g, '_');
  const possibleFilenames = [
    `${folderId}.md`,
    `${basename(folderName).toLowerCase().replace(/\s+/g, '_')}.md`,
    'readme.md',
    'index.md'
  ];

  let mainFile: string | null = null;
  let mainFilePath: string | null = null;

  const entries = await readdir(folderPath);

  // Find the main markdown file
  for (const filename of possibleFilenames) {
    if (entries.includes(filename)) {
      mainFile = filename;
      mainFilePath = join(folderPath, filename);
      break;
    }
  }

  // If no main file found, use the first .md file
  if (!mainFilePath) {
    const mdFile = entries.find(e => e.endsWith('.md'));
    if (mdFile) {
      mainFile = mdFile;
      mainFilePath = join(folderPath, mdFile);
    }
  }

  if (!mainFilePath) {
    console.warn(`[Expansions] No markdown file found in folder: ${folderName}`);
    return;
  }

  // Read and concatenate all markdown files in the folder
  let combinedContent = '';
  const stats = await stat(mainFilePath);

  // Read main file first
  const mainContent = await readFile(mainFilePath, 'utf-8');
  combinedContent += mainContent;

  // Then read other .md files
  for (const entry of entries) {
    if (entry.endsWith('.md') && entry !== mainFile) {
      const otherPath = join(folderPath, entry);
      const otherStats = await stat(otherPath);
      if (otherStats.isFile()) {
        const otherContent = await readFile(otherPath, 'utf-8');
        combinedContent += '\n\n---\n\n' + otherContent;
      }
    }
  }

  // Parse frontmatter
  const { name, description, body } = parseExpansionFrontmatter(combinedContent, folderId);

  const expansion: Expansion = {
    id: folderId,
    name,
    description,
    content: body,
    type: 'folder',
    path: folderPath,
    lastModified: stats.mtime.toISOString()
  };

  expansionRegistry.set(folderId, expansion);
  console.log(`[Expansions] Loaded folder expansion: ${folderId}`);
}

/**
 * Parse YAML frontmatter from expansion content
 */
function parseExpansionFrontmatter(content: string, defaultId: string): { name: string; description: string; body: string } {
  const lines = content.split('\n');
  const metadata: Record<string, string> = {};
  let bodyStartIndex = 0;

  // Parse YAML frontmatter
  if (lines[0] === '---') {
    let i = 1;
    while (i < lines.length && lines[i] !== '---') {
      const line = lines[i];
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        metadata[key] = value;
      }
      i++;
    }
    bodyStartIndex = i + 1; // Skip the closing ---
  }

  // Extract body (content after frontmatter)
  const body = lines.slice(bodyStartIndex).join('\n').trim();

  // Generate name from frontmatter or default
  const name = metadata.name || defaultId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  // Generate description from frontmatter or extract from body
  let description = metadata.description || '';
  if (!description && body) {
    // Extract first paragraph as description (up to 150 chars)
    const firstParagraph = body.split('\n\n')[0].replace(/[#*`_]/g, '').trim();
    description = firstParagraph.length > 150
      ? firstParagraph.substring(0, 147) + '...'
      : firstParagraph;
  }

  return { name, description, body };
}

/**
 * Get all available expansions
 */
export function getAllExpansions(): Expansion[] {
  return Array.from(expansionRegistry.values());
}

/**
 * Get a specific expansion by ID
 */
export function getExpansion(id: string): Expansion | undefined {
  return expansionRegistry.get(id.toLowerCase());
}

/**
 * Check if an expansion exists
 */
export function hasExpansion(id: string): boolean {
  return expansionRegistry.has(id.toLowerCase());
}

/**
 * Get multiple expansions by their IDs
 * Returns found expansions and missing IDs
 */
export function getExpansionsByIds(ids: string[]): { found: Expansion[]; missing: string[] } {
  const found: Expansion[] = [];
  const missing: string[] = [];

  for (const id of ids) {
    const expansion = getExpansion(id);
    if (expansion) {
      found.push(expansion);
    } else {
      missing.push(id);
    }
  }

  return { found, missing };
}

/**
 * Reload a specific expansion (for hot-reload)
 */
export async function reloadExpansion(id: string): Promise<boolean> {
  const expansion = expansionRegistry.get(id.toLowerCase());
  if (!expansion) {
    return false;
  }

  try {
    const stats = await stat(expansion.path);

    if (expansion.type === 'file') {
      await loadFileExpansion(basename(expansion.path), expansion.path);
    } else {
      await loadFolderExpansion(basename(expansion.path), expansion.path);
    }

    return true;
  } catch (err) {
    console.error(`[Expansions] Failed to reload expansion '${id}':`, (err as Error).message);
    return false;
  }
}

/**
 * Remove an expansion from the registry (for hot-reload on delete)
 */
export function removeExpansion(id: string): boolean {
  const deleted = expansionRegistry.delete(id.toLowerCase());
  if (deleted) {
    console.log(`[Expansions] Removed expansion: ${id}`);
  }
  return deleted;
}

/**
 * Get expansion registry stats
 */
export function getExpansionStats(): {
  count: number;
  fileExpansions: number;
  folderExpansions: number;
  expansions: Array<{ id: string; name: string; type: string }>;
} {
  const expansions = getAllExpansions();
  return {
    count: expansions.length,
    fileExpansions: expansions.filter(e => e.type === 'file').length,
    folderExpansions: expansions.filter(e => e.type === 'folder').length,
    expansions: expansions.map(e => ({ id: e.id, name: e.name, type: e.type }))
  };
}

/**
 * Parse comma-separated expansion list from agent frontmatter
 * Returns array of expansion IDs
 */
export function parseExpansionList(expansionField: string): string[] {
  if (!expansionField) return [];

  return expansionField
    .split(',')
    .map(id => id.trim().toLowerCase())
    .filter(id => id.length > 0);
}

/**
 * Build combined expansion content for agent spawn
 * Takes array of expansion IDs and returns combined content
 */
export function buildExpansionContent(expansionIds: string[]): {
  content: string;
  loaded: string[];
  missing: string[];
  warnings: string[];
} {
  const loaded: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  const contents: string[] = [];

  for (const id of expansionIds) {
    const expansion = getExpansion(id);
    if (expansion) {
      contents.push(`<!-- Expansion: ${expansion.name} -->\n${expansion.content}`);
      loaded.push(id);
    } else {
      missing.push(id);
      warnings.push(`Expansion '${id}' not found in registry`);
    }
  }

  return {
    content: contents.join('\n\n---\n\n'),
    loaded,
    missing,
    warnings
  };
}
