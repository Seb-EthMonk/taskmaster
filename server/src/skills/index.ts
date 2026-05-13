/**
 * Skills Registry for TaskMaster
 * Manages Claude skills loaded from /.claude/skills/
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '../../../.claude/skills');

export interface Skill {
  id: string;
  name: string;
  description: string;
}

const skillRegistry = new Map<string, Skill>();

export async function initSkillRegistry(): Promise<void> {
  skillRegistry.clear();
  try {
    const entries = await readdir(SKILLS_DIR);
    for (const entry of entries) {
      const entryPath = join(SKILLS_DIR, entry);
      try {
        const stats = await stat(entryPath);
        if (stats.isDirectory()) {
          const skillFile = join(entryPath, 'SKILL.md');
          const content = await readFile(skillFile, 'utf-8').catch(() => '');
          const { name, description } = parseSkillFrontmatter(content, entry);
          const id = entry.toLowerCase();
          skillRegistry.set(id, { id, name, description });
        } else if (entry.endsWith('.md')) {
          const id = entry.replace('.md', '').toLowerCase();
          const content = await readFile(entryPath, 'utf-8');
          const { name, description } = parseSkillFrontmatter(content, id);
          skillRegistry.set(id, { id, name, description });
        }
      } catch {
        // Skip unreadable entries
      }
    }
    console.log(`[Skills] Registry initialized with ${skillRegistry.size} skills`);
  } catch (err) {
    console.warn('[Skills] Skills directory not found or inaccessible:', (err as Error).message);
  }
}

function parseSkillFrontmatter(content: string, defaultId: string): { name: string; description: string } {
  const lines = content.split('\n');
  const metadata: Record<string, string> = {};

  if (lines[0] === '---') {
    let i = 1;
    while (i < lines.length && lines[i] !== '---') {
      const colonIndex = lines[i].indexOf(':');
      if (colonIndex > 0) {
        const key = lines[i].substring(0, colonIndex).trim();
        const value = lines[i].substring(colonIndex + 1).trim();
        metadata[key] = value;
      }
      i++;
    }
  }

  const name = metadata.name || defaultId;
  const description = (metadata.description || '').replace(/^>$/, '').trim();
  return { name, description };
}

export function getAllSkills(): Skill[] {
  return Array.from(skillRegistry.values());
}

export function getSkill(id: string): Skill | undefined {
  return skillRegistry.get(id.toLowerCase());
}
