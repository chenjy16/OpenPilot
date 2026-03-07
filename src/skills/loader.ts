/**
 * Skills Loader — OpenClaw-aligned multi-source skill loading pipeline
 *
 * Loading priority (highest wins):
 *   1. Workspace skills:  <workspace>/skills/
 *   2. Project agents:    <workspace>/.agents/skills/
 *   3. Personal agents:   ~/.agents/skills/
 *   4. Managed skills:    ~/.openpilot/skills/
 *   5. Bundled skills:    dist/skills/ (compiled)
 *   6. Extra dirs:        config.skills.load.extraDirs
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  Skill,
  SkillEntry,
  SkillSnapshot,
  SkillStatusReport,
  SkillsLimits,
  OpenClawSkillMetadata,
  SkillInvocationPolicy,
  ParsedSkillFrontmatter,
  SkillConfig,
  DEFAULT_SKILLS_LIMITS,
} from './types';

// ---------------------------------------------------------------------------
// Source definitions
// ---------------------------------------------------------------------------

interface SkillSource {
  dir: string;
  source: string;
  priority: number;
}

function getSkillSources(workspaceDir?: string): SkillSource[] {
  const home = os.homedir();
  const ws = workspaceDir || process.cwd();

  return [
    { dir: path.resolve(__dirname, '..', 'runtime', 'skills'), source: 'bundled', priority: 1 },
    { dir: path.join(home, '.openpilot', 'skills'), source: 'managed', priority: 2 },
    { dir: path.join(home, '.agents', 'skills'), source: 'agents-personal', priority: 3 },
    { dir: path.join(ws, '.agents', 'skills'), source: 'agents-project', priority: 4 },
    { dir: path.join(ws, '.openpilot', 'skills'), source: 'workspace-openpilot', priority: 5 },
    { dir: path.join(ws, 'skills'), source: 'workspace', priority: 6 },
  ];
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

export function parseFrontmatter(raw: string): { frontmatter: ParsedSkillFrontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const fm: ParsedSkillFrontmatter = {};
  const lines = match[1].split('\n');

  let parentKey: string | null = null;
  let parentObj: Record<string, unknown> | null = null;

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === '') continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    const rawVal = trimmed.slice(idx + 1).trim();

    // Indented line → belongs to parent block
    if (indent > 0 && parentKey && parentObj) {
      parentObj[key] = coerceValue(rawVal);
      fm[parentKey] = parentObj;
      continue;
    }

    // Top-level line with empty value → start a nested block
    if (rawVal === '' || rawVal === undefined) {
      parentKey = key;
      parentObj = (fm[key] && typeof fm[key] === 'object' && !Array.isArray(fm[key]))
        ? fm[key] as Record<string, unknown>
        : {};
      fm[key] = parentObj;
      continue;
    }

    // Top-level line with value → simple key-value
    parentKey = null;
    parentObj = null;
    fm[key] = coerceValue(rawVal);
  }

  return { frontmatter: fm, body: match[2] };
}

function coerceValue(val: string): unknown {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  // Array detection: [item1, item2]
  if (val.startsWith('[') && val.endsWith(']')) {
    return val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
  }
  return val;
}

/** Extract OpenClaw metadata from frontmatter */
export function resolveMetadata(fm: ParsedSkillFrontmatter): OpenClawSkillMetadata | undefined {
  const meta: OpenClawSkillMetadata = {};
  let hasAny = false;

  if (typeof fm.always === 'boolean') { meta.always = fm.always; hasAny = true; }
  if (typeof fm.skillKey === 'string') { meta.skillKey = fm.skillKey; hasAny = true; }
  if (typeof fm.primaryEnv === 'string') { meta.primaryEnv = fm.primaryEnv; hasAny = true; }
  if (typeof fm.emoji === 'string') { meta.emoji = fm.emoji; hasAny = true; }
  if (typeof fm.homepage === 'string') { meta.homepage = fm.homepage; hasAny = true; }
  if (Array.isArray(fm.os)) { meta.os = fm.os as string[]; hasAny = true; }

  // requires block
  if (fm.requires && typeof fm.requires === 'object') {
    meta.requires = fm.requires as OpenClawSkillMetadata['requires'];
    hasAny = true;
  }

  return hasAny ? meta : undefined;
}

/** Extract invocation policy from frontmatter */
export function resolveInvocationPolicy(fm: ParsedSkillFrontmatter): SkillInvocationPolicy | undefined {
  if (fm.invocation && typeof fm.invocation === 'string') {
    return { mode: fm.invocation as SkillInvocationPolicy['mode'] };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

async function dirExists(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
}

async function fileExists(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isFile(); } catch { return false; }
}

async function scanSkillsDir(
  baseDir: string,
  source: string,
  limits: SkillsLimits,
): Promise<Skill[]> {
  if (!(await dirExists(baseDir))) return [];

  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const skills: Skill[] = [];

  for (const entry of entries.slice(0, limits.maxCandidatesPerRoot)) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(baseDir, entry.name);
    const skillMd = path.join(skillDir, 'SKILL.md');

    if (!(await fileExists(skillMd))) continue;

    // Check file size
    const stat = await fs.stat(skillMd);
    if (stat.size > limits.maxSkillFileBytes) continue;

    const content = await fs.readFile(skillMd, 'utf-8');
    skills.push({ name: entry.name, content, filePath: skillMd, source });

    if (skills.length >= limits.maxSkillsLoadedPerSource) break;
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Eligibility evaluation
// ---------------------------------------------------------------------------

import { execSync } from 'child_process';

function binExists(bin: string): boolean {
  try {
    execSync(`which ${bin}`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function evaluateEligibility(
  entry: SkillEntry,
  skillConfigs?: Record<string, SkillConfig>,
): { eligible: boolean; missing: { bins: string[]; env: string[]; config: string[] } } {
  const missing = { bins: [] as string[], env: [] as string[], config: [] as string[] };
  const meta = entry.metadata;

  // Check per-skill config disabled
  const key = meta?.skillKey || entry.skill.name;
  if (skillConfigs?.[key]?.enabled === false) {
    return { eligible: false, missing };
  }

  if (!meta) return { eligible: true, missing };

  // Always-on skills skip checks
  if (meta.always) return { eligible: true, missing };

  // OS check
  if (meta.os && meta.os.length > 0) {
    const currentOs = process.platform === 'darwin' ? 'macos' : process.platform;
    if (!meta.os.includes(currentOs) && !meta.os.includes(process.platform)) {
      return { eligible: false, missing };
    }
  }

  const req = meta.requires;
  if (!req) return { eligible: true, missing };

  // Required bins (all must exist)
  if (req.bins) {
    for (const bin of req.bins) {
      if (!binExists(bin)) missing.bins.push(bin);
    }
  }

  // Any bins (at least one must exist)
  if (req.anyBins && req.anyBins.length > 0) {
    if (!req.anyBins.some(binExists)) {
      missing.bins.push(...req.anyBins);
    }
  }

  // Required env vars
  if (req.env) {
    for (const envVar of req.env) {
      const cfgEnv = skillConfigs?.[key]?.env?.[envVar];
      const cfgApiKey = skillConfigs?.[key]?.apiKey;
      if (!process.env[envVar] && !cfgEnv && !cfgApiKey) {
        missing.env.push(envVar);
      }
    }
  }

  const eligible = missing.bins.length === 0 && missing.env.length === 0 && missing.config.length === 0;
  return { eligible, missing };
}

// ---------------------------------------------------------------------------
// Main loading pipeline
// ---------------------------------------------------------------------------

export async function loadSkillEntries(
  workspaceDir?: string,
  limits?: Partial<SkillsLimits>,
): Promise<SkillEntry[]> {
  const lim = { ...DEFAULT_SKILLS_LIMITS, ...limits };
  const sources = getSkillSources(workspaceDir);

  // Load from all sources, merge by name (higher priority wins)
  const merged = new Map<string, Skill>();

  for (const src of sources) {
    const skills = await scanSkillsDir(src.dir, src.source, lim);
    for (const skill of skills) {
      merged.set(skill.name, skill); // Later sources overwrite earlier
    }
  }

  // Parse frontmatter and build entries
  const entries: SkillEntry[] = [];
  for (const skill of merged.values()) {
    const { frontmatter } = parseFrontmatter(skill.content);
    entries.push({
      skill,
      frontmatter,
      metadata: resolveMetadata(frontmatter),
      invocation: resolveInvocationPolicy(frontmatter),
    });
  }

  return entries;
}

/** Build skill snapshot for system prompt injection */
export async function resolveSkillsSnapshot(
  workspaceDir?: string,
  opts?: {
    limits?: Partial<SkillsLimits>;
    skillFilter?: string[];
    skillConfigs?: Record<string, SkillConfig>;
  },
): Promise<SkillSnapshot> {
  const entries = await loadSkillEntries(workspaceDir, opts?.limits);
  const lim = { ...DEFAULT_SKILLS_LIMITS, ...opts?.limits };

  // Filter by eligibility
  let eligible = entries.filter(e => {
    const { eligible: ok } = evaluateEligibility(e, opts?.skillConfigs);
    return ok;
  });

  // Agent-level skill filter
  if (opts?.skillFilter && opts.skillFilter.length > 0) {
    const filterSet = new Set(opts.skillFilter);
    eligible = eligible.filter(e =>
      filterSet.has(e.skill.name) || filterSet.has(e.metadata?.skillKey || ''),
    );
  }

  // Sort by name, apply limits
  eligible.sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  eligible = eligible.slice(0, lim.maxSkillsInPrompt);

  // Build prompt
  let prompt = '';
  const skills: SkillSnapshot['skills'] = [];

  for (const entry of eligible) {
    const chunk = `<skill name="${entry.skill.name}">\n${entry.skill.content}\n</skill>\n\n`;
    if (prompt.length + chunk.length > lim.maxPromptChars) break;
    prompt += chunk;
    skills.push({
      name: entry.skill.name,
      primaryEnv: entry.metadata?.primaryEnv,
      requiredEnv: entry.metadata?.requires?.env,
    });
  }

  return {
    prompt,
    skills,
    skillFilter: opts?.skillFilter,
    resolvedSkills: eligible.map(e => e.skill),
    version: 1,
  };
}

/** Generate status reports for all skills */
export async function getSkillStatusReports(
  workspaceDir?: string,
  skillConfigs?: Record<string, SkillConfig>,
): Promise<SkillStatusReport[]> {
  const entries = await loadSkillEntries(workspaceDir);

  return entries.map(entry => {
    const key = entry.metadata?.skillKey || entry.skill.name;
    const { eligible, missing } = evaluateEligibility(entry, skillConfigs);
    const cfg = skillConfigs?.[key];

    return {
      name: entry.skill.name,
      source: entry.skill.source,
      filePath: entry.skill.filePath,
      enabled: cfg?.enabled !== false && eligible,
      emoji: entry.metadata?.emoji,
      homepage: entry.metadata?.homepage,
      requirements: entry.metadata?.requires,
      missing,
      installSpecs: entry.metadata?.install,
    };
  });
}
