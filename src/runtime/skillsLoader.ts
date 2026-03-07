/**
 * Skills Loader
 *
 * OpenPilot-aligned plugin discovery and loading system.
 * Skills are directories containing a SKILL.md file (metadata + SOP)
 * and optionally companion scripts.
 *
 * Loading priority (highest wins):
 *   1. Workspace skills:  ./.openpilot/skills/
 *   2. User skills:       ~/.openpilot/skills/
 *   3. Bundled skills:    src/runtime/skills/
 *
 * Each skill's SKILL.md content is injected into the system prompt
 * as a <skill> block, making it available to the LLM as a callable
 * high-level capability or SOP guide.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Search paths
// ---------------------------------------------------------------------------

const WORKSPACE_SKILLS = path.resolve('.openpilot', 'skills');
const USER_SKILLS = path.join(os.homedir(), '.openpilot', 'skills');
const BUNDLED_SKILLS = path.resolve(__dirname, 'skills');

const SKILL_DIRS = [WORKSPACE_SKILLS, USER_SKILLS, BUNDLED_SKILLS];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillManifest {
  /** Directory name (used as skill ID) */
  id: string;
  /** Full path to the skill directory */
  dirPath: string;
  /** Raw content of SKILL.md */
  content: string;
  /** Which search tier it came from */
  source: 'workspace' | 'user' | 'bundled';
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Scan a single skills directory and return discovered skills.
 */
async function scanSkillsDir(
  baseDir: string,
  source: SkillManifest['source'],
): Promise<SkillManifest[]> {
  if (!(await dirExists(baseDir))) return [];

  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const skills: SkillManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(baseDir, entry.name);
    const skillMd = path.join(skillDir, 'SKILL.md');

    if (await fileExists(skillMd)) {
      const content = await fs.readFile(skillMd, 'utf-8');
      skills.push({
        id: entry.name,
        dirPath: skillDir,
        content,
        source,
      });
    }
  }

  return skills;
}

/**
 * Discover and load all skills, respecting priority order.
 * If the same skill ID exists at multiple tiers, the highest-priority
 * version wins (workspace > user > bundled).
 */
export async function loadSkills(): Promise<SkillManifest[]> {
  const tiers: Array<{ dir: string; source: SkillManifest['source'] }> = [
    { dir: WORKSPACE_SKILLS, source: 'workspace' },
    { dir: USER_SKILLS, source: 'user' },
    { dir: BUNDLED_SKILLS, source: 'bundled' },
  ];

  const seen = new Set<string>();
  const result: SkillManifest[] = [];

  for (const tier of tiers) {
    const skills = await scanSkillsDir(tier.dir, tier.source);
    for (const skill of skills) {
      if (!seen.has(skill.id)) {
        seen.add(skill.id);
        result.push(skill);
      }
    }
  }

  return result;
}

/**
 * Extract skill contents as string array for injection into the system prompt.
 */
export async function loadSkillContents(): Promise<string[]> {
  const skills = await loadSkills();
  return skills.map((s) => s.content);
}
