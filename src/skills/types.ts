/**
 * Skills System Types
 *
 * Aligned with OpenClaw src/agents/skills/types.ts
 */

/** Pi framework raw skill object */
export interface Skill {
  name: string;
  content: string;
  filePath: string;
  source: string;
}

/** Parsed YAML frontmatter from SKILL.md */
export interface ParsedSkillFrontmatter {
  [key: string]: unknown;
}

/** OpenClaw extended metadata extracted from frontmatter */
export interface OpenClawSkillMetadata {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: SkillInstallSpec[];
}

/** Skill installation specification */
export interface SkillInstallSpec {
  kind: 'brew' | 'node' | 'go' | 'uv' | 'download';
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  url?: string;
}

/** Skill invocation policy from frontmatter */
export interface SkillInvocationPolicy {
  /** When to invoke: always, on-demand, conditional */
  mode?: 'always' | 'on-demand' | 'conditional';
  /** Trigger patterns */
  triggers?: string[];
}

/** Complete skill entry after loading */
export interface SkillEntry {
  skill: Skill;
  frontmatter: ParsedSkillFrontmatter;
  metadata?: OpenClawSkillMetadata;
  invocation?: SkillInvocationPolicy;
}

/** Skill snapshot injected into system prompt */
export interface SkillSnapshot {
  prompt: string;
  skills: Array<{
    name: string;
    primaryEnv?: string;
    requiredEnv?: string[];
  }>;
  skillFilter?: string[];
  resolvedSkills?: Skill[];
  version?: number;
}

/** Skill status report for UI */
export interface SkillStatusReport {
  name: string;
  source: string;
  filePath: string;
  enabled: boolean;
  emoji?: string;
  homepage?: string;
  requirements?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  missing?: {
    bins: string[];
    env: string[];
    config: string[];
  };
  installSpecs?: SkillInstallSpec[];
}

/** Skill configuration entry (per-skill settings) */
export interface SkillConfig {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
}

/** Skills loading limits */
export interface SkillsLimits {
  maxCandidatesPerRoot: number;
  maxSkillsLoadedPerSource: number;
  maxSkillsInPrompt: number;
  maxPromptChars: number;
  maxSkillFileBytes: number;
}

export const DEFAULT_SKILLS_LIMITS: SkillsLimits = {
  maxCandidatesPerRoot: 300,
  maxSkillsLoadedPerSource: 200,
  maxSkillsInPrompt: 150,
  maxPromptChars: 30000,
  maxSkillFileBytes: 65536,
};

// ===== Community Skills =====

/** Data source for community skills */
export type CommunitySource = 'clawhub' | 'skillsmp';

/** Search result from community registries */
export interface CommunitySkillResult {
  slug: string;
  name: string;
  description: string;
  repo: string;           // GitHub repo (owner/repo) or owner handle
  repoUrl: string;        // Full URL to skill page
  stars?: number;
  downloads?: number;
  author?: string;
  tags?: string[];
  updatedAt?: string;
  version?: string;
  source: CommunitySource;
}

/** Full detail of a community skill */
export interface CommunitySkillDetail extends CommunitySkillResult {
  content: string;        // Raw SKILL.md content
  filePath: string;       // Path within repo
  readme?: string;
  changelog?: string;
  security?: { status: string; hasWarnings?: boolean };
}

/** Result of installing a community skill */
export interface CommunityInstallResult {
  ok: boolean;
  slug: string;
  installedPath: string;
  message: string;
}

