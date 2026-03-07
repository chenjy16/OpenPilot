/**
 * Agent System Types — OpenClaw-aligned
 */

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  default?: boolean;
  workspace?: string;
  model?: { primary: string; fallbacks?: string[] };
  toolProfile?: string;
  tools?: { allow?: string[]; deny?: string[]; alsoAllow?: string[] };
  skillFilter?: string[];
  channels?: AgentChannelBinding[];
  cron?: AgentCronTask[];
  sandbox?: AgentSandboxConfig;
  /** Identity configuration */
  identity?: {
    name?: string;
    emoji?: string;
    prefix?: string;
  };
  /** Group chat behavior */
  groupChat?: {
    requireMention?: boolean;
    respondToReplies?: boolean;
  };
  /** Sub-agent configuration */
  subagents?: {
    allowAgents?: string[];   // "*" = all
    model?: { primary: string; fallbacks?: string[] };
    maxSpawnDepth?: number;
    maxChildrenPerAgent?: number;
  };
  /** Bindings — maps channels/peers to this agent */
  bindings?: AgentBinding[];
  /** Session scope configuration */
  session?: {
    dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
    identityLinks?: Record<string, string[]>;
  };
  createdAt: string;
  updatedAt: string;
}

/** Agent binding — maps a channel/peer to this agent */
export interface AgentBinding {
  comment?: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: { kind: 'direct' | 'group' | 'channel'; id: string };
    guildId?: string;
    teamId?: string;
    roles?: string[];
  };
}

export interface AgentIdentity {
  agentId: string;
  name: string;
  description?: string;
  emoji?: string;
  personality?: string;
}

export interface AgentChannelBinding {
  channelType: string;
  channelId: string;
  groupId?: string;
}

export interface AgentCronTask {
  id: string;
  expression: string;
  prompt: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface AgentSandboxConfig {
  mode: 'off' | 'non-main' | 'all';
  scope: 'session' | 'agent' | 'shared';
  workspaceAccess: 'none' | 'ro' | 'rw';
}

/** Agent workspace files (AGENTS.md, SOUL.md, etc.) */
export const AGENT_WORKSPACE_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
] as const;

export type AgentWorkspaceFile = typeof AGENT_WORKSPACE_FILES[number];
