/**
 * Community Skills Integration — Dual Source
 *
 * Default: ClawHub (clawhub.ai) — free, no auth, 3000+ skills
 * Optional: SkillsMP (skillsmp.com) — needs API key, 70k+ skills
 *
 * Install flow: ClawHub detail → version files → GitHub raw download → local write
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  CommunitySkillResult,
  CommunitySkillDetail,
  CommunityInstallResult,
  CommunitySource,
} from './types';

const CLAWHUB_BASE = 'https://clawhub.ai/api/v1';
const SKILLSMP_BASE = 'https://skillsmp.com/api/v1';
const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CommunityConfig {
  /** SkillsMP API key (only needed for skillsmp source) */
  skillsmpApiKey?: string;
  /** Override ClawHub base URL */
  clawhubBaseUrl?: string;
  /** Override SkillsMP base URL */
  skillsmpBaseUrl?: string;
}

let _cfg: CommunityConfig = {};

export function setCommunityConfig(c: CommunityConfig): void {
  _cfg = { ..._cfg, ...c };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function smpHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = _cfg.skillsmpApiKey || process.env.SKILLSMP_API_KEY;
  if (key) h['Authorization'] = `Bearer ${key}`;
  return h;
}

// ---------------------------------------------------------------------------
// ClawHub normalizer
// ---------------------------------------------------------------------------

function normalizeClawHub(raw: any): CommunitySkillResult {
  return {
    slug: raw.slug || '',
    name: raw.displayName || raw.slug || 'unknown',
    description: raw.summary || '',
    repo: raw.owner?.handle || '',
    repoUrl: `https://clawhub.ai/${raw.owner?.handle || '_'}/${raw.slug || ''}`,
    stars: raw.stats?.stars ?? undefined,
    downloads: raw.stats?.downloads ?? undefined,
    author: raw.owner?.displayName || raw.owner?.handle || undefined,
    version: raw.latestVersion?.version || raw.tags?.latest || undefined,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : undefined,
    source: 'clawhub',
  };
}

function normalizeSMP(raw: any): CommunitySkillResult {
  return {
    slug: raw.slug || raw.name || '',
    name: raw.name || raw.title || raw.slug || 'unknown',
    description: raw.description || '',
    repo: raw.source || raw.repo || '',
    repoUrl: raw.source ? `https://github.com/${raw.source}` : '',
    stars: raw.stars ?? undefined,
    downloads: undefined,
    author: raw.author || raw.owner || undefined,
    tags: raw.tags || undefined,
    version: undefined,
    updatedAt: raw.updated_at || undefined,
    source: 'skillsmp',
  };
}

// ---------------------------------------------------------------------------
// ClawHub API (default, free, no auth)
// ---------------------------------------------------------------------------

/** Browse/search ClawHub skills. q is optional — omit for hot/popular listing. */
export async function searchClawHub(
  q?: string,
  opts: { sort?: string; limit?: number; cursor?: string } = {},
): Promise<{ results: CommunitySkillResult[]; total: number; nextCursor?: string }> {
  const base = _cfg.clawhubBaseUrl || CLAWHUB_BASE;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.cursor) params.set('cursor', opts.cursor);
  const data = await fetchJson<any>(`${base}/skills?${params}`);
  const items: any[] = data.items || [];
  return {
    results: items.map(normalizeClawHub),
    total: items.length,
    nextCursor: data.nextCursor || undefined,
  };
}

/** Get ClawHub skill detail by slug */
export async function getClawHubDetail(slug: string): Promise<CommunitySkillDetail> {
  const base = _cfg.clawhubBaseUrl || CLAWHUB_BASE;
  const data = await fetchJson<any>(`${base}/skills/${encodeURIComponent(slug)}`);
  const skill = data.skill || data;
  const owner = data.owner;
  const ver = data.latestVersion?.version || skill.tags?.latest;

  // Try to get SKILL.md content from version files
  let content = '';
  let filePath = '';
  if (ver) {
    try {
      const verData = await fetchJson<any>(
        `${base}/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(ver)}`
      );
      const files: any[] = verData.version?.files || [];
      const skillMd = files.find((f: any) => f.path === 'SKILL.md');
      if (skillMd) {
        filePath = skillMd.path;
        // ClawHub doesn't expose a direct file content endpoint,
        // but the owner handle maps to a GitHub user. Try GitHub raw.
        // Pattern: owner publishes from their repo, skill slug = folder name
        // We'll attempt common patterns; if all fail, content stays empty
        content = await tryFetchSkillContent(owner?.handle, slug);
      }
    } catch { /* version detail unavailable */ }
  }

  return {
    slug: skill.slug || slug,
    name: skill.displayName || skill.slug || slug,
    description: skill.summary || '',
    repo: owner?.handle || '',
    repoUrl: `https://clawhub.ai/${owner?.handle || '_'}/${slug}`,
    stars: skill.stats?.stars,
    downloads: skill.stats?.downloads,
    author: owner?.displayName || owner?.handle,
    version: ver,
    updatedAt: skill.updatedAt ? new Date(skill.updatedAt).toISOString() : undefined,
    source: 'clawhub',
    content,
    filePath,
    changelog: data.latestVersion?.changelog || '',
    security: undefined,
  };
}

/** Attempt to fetch SKILL.md content from GitHub using common repo patterns */
async function tryFetchSkillContent(ownerHandle?: string, slug?: string): Promise<string> {
  if (!ownerHandle || !slug) return '';
  // Common patterns for ClawHub skills on GitHub:
  // 1. owner/skills repo with skills/<slug>/SKILL.md
  // 2. owner/<slug> repo with SKILL.md at root
  // 3. openclaw/skills repo (official skills)
  const candidates = [
    `https://raw.githubusercontent.com/${ownerHandle}/skills/main/${slug}/SKILL.md`,
    `https://raw.githubusercontent.com/${ownerHandle}/skills/main/skills/${slug}/SKILL.md`,
    `https://raw.githubusercontent.com/${ownerHandle}/${slug}/main/SKILL.md`,
    `https://raw.githubusercontent.com/openclaw/skills/main/skills/${ownerHandle}/${slug}/SKILL.md`,
  ];
  for (const url of candidates) {
    try {
      const text = await fetchText(url);
      if (text && text.length > 10 && !text.startsWith('404')) return text;
    } catch { /* try next */ }
  }
  return '';
}

// ---------------------------------------------------------------------------
// SkillsMP API (optional, needs API key)
// ---------------------------------------------------------------------------

export async function searchSkillsMP(
  q: string,
  opts: { page?: number; limit?: number; sortBy?: string } = {},
): Promise<{ results: CommunitySkillResult[]; total: number }> {
  const base = _cfg.skillsmpBaseUrl || SKILLSMP_BASE;
  const params = new URLSearchParams({ q });
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.sortBy) params.set('sort_by', opts.sortBy);
  const data = await fetchJson<any>(`${base}/skills/search?${params}`, {
    headers: smpHeaders(),
  });
  const items = data.results || data.skills || data.items || [];
  return {
    results: items.map(normalizeSMP),
    total: typeof data.total === 'number' ? data.total : items.length,
  };
}

export async function aiSearchSkillsMP(
  query: string,
  limit = 20,
): Promise<{ results: CommunitySkillResult[]; total: number }> {
  const base = _cfg.skillsmpBaseUrl || SKILLSMP_BASE;
  const data = await fetchJson<any>(`${base}/skills/ai-search`, {
    method: 'POST',
    headers: smpHeaders(),
    body: JSON.stringify({ query, limit }),
  });
  const items = data.results || data.skills || data.items || [];
  return {
    results: items.map(normalizeSMP),
    total: typeof data.total === 'number' ? data.total : items.length,
  };
}

// ---------------------------------------------------------------------------
// Unified search (dispatches to correct source)
// ---------------------------------------------------------------------------

export async function searchCommunitySkills(
  query: string,
  source: CommunitySource = 'clawhub',
  opts: { page?: number; limit?: number; sort?: string } = {},
): Promise<{ results: CommunitySkillResult[]; total: number }> {
  if (source === 'skillsmp') {
    return searchSkillsMP(query, { page: opts.page, limit: opts.limit, sortBy: opts.sort });
  }
  return searchClawHub(query, { limit: opts.limit, sort: opts.sort });
}

export async function aiSearchCommunitySkills(
  query: string,
  source: CommunitySource = 'skillsmp',
  limit = 20,
): Promise<{ results: CommunitySkillResult[]; total: number }> {
  // AI search only available on SkillsMP
  if (source === 'skillsmp') {
    return aiSearchSkillsMP(query, limit);
  }
  // Fallback: keyword search on ClawHub
  return searchClawHub(query, { limit });
}

export async function getCommunitySkillDetail(
  slug: string,
  source: CommunitySource = 'clawhub',
): Promise<CommunitySkillDetail> {
  // Currently only ClawHub has a detail endpoint
  return getClawHubDetail(slug);
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

export async function installCommunitySkill(
  slug: string,
  source: CommunitySource = 'clawhub',
  targetDir?: string,
): Promise<CommunityInstallResult> {
  // 1. Get detail (includes attempt to fetch SKILL.md content)
  const detail = await getCommunitySkillDetail(slug, source);

  if (!detail.content) {
    return {
      ok: false, slug, installedPath: '',
      message: '无法获取 SKILL.md 内容。该技能可能需要通过 GitHub 手动下载。',
    };
  }

  // 2. Write to local skills directory
  const baseDir = targetDir || path.join(process.cwd(), 'skills');
  const skillName = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const skillDir = path.join(baseDir, skillName);
  const skillFile = path.join(skillDir, 'SKILL.md');

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillFile, detail.content, 'utf-8');
  } catch (err: any) {
    return { ok: false, slug, installedPath: skillDir, message: `写入失败: ${err.message}` };
  }

  return {
    ok: true, slug, installedPath: skillDir,
    message: `技能 "${detail.name}" 已安装到 ${skillDir}`,
  };
}

// ---------------------------------------------------------------------------
// Convenience: get hot/popular skills (ClawHub only, no query needed)
// ---------------------------------------------------------------------------

export async function getHotSkills(
  sort: 'stars' | 'downloads' = 'downloads',
  limit = 12,
): Promise<CommunitySkillResult[]> {
  const { results } = await searchClawHub(undefined, { sort, limit });
  return results;
}
