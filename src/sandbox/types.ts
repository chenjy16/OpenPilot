/**
 * Sandbox Types — OpenClaw-aligned
 *
 * Full sandbox configuration, context, and FS bridge types.
 */

export type SandboxMode = 'off' | 'non-main' | 'all';
export type SandboxScope = 'session' | 'agent' | 'shared';
export type SandboxWorkspaceAccess = 'none' | 'ro' | 'rw';

export interface SandboxDockerConfig {
  image: string;
  containerPrefix: string;
  workdir: string;
  readOnlyRoot: boolean;
  tmpfs: string[];
  network: string;
  capDrop: string[];
  env: Record<string, string>;
  pidsLimit?: number;
  memory?: string;
  memorySwap?: string;
  cpus?: number;
  ulimits?: Record<string, { soft: number; hard: number }>;
  seccompProfile?: string;
  apparmorProfile?: string;
  binds?: string[];
  user?: string;
  setupCommand?: string;
}

export interface SandboxBrowserConfig {
  enabled: boolean;
  image: string;
  network: string;
  cdpPort: number;
  vncPort: number;
  noVncPort: number;
  headless: boolean;
  enableNoVnc: boolean;
  allowHostControl: boolean;
  autoStart: boolean;
  autoStartTimeoutMs: number;
}

export interface SandboxPruneConfig {
  idleHours: number;
  maxAgeDays: number;
}

export interface SandboxToolPolicy {
  allow?: string[];
  deny?: string[];
}

export interface SandboxConfig {
  mode: SandboxMode;
  scope: SandboxScope;
  workspaceAccess: SandboxWorkspaceAccess;
  workspaceRoot: string;
  docker: SandboxDockerConfig;
  browser: SandboxBrowserConfig;
  tools: SandboxToolPolicy;
  prune: SandboxPruneConfig;
}

export interface SandboxContext {
  enabled: boolean;
  sessionKey: string;
  workspaceDir: string;
  agentWorkspaceDir: string;
  workspaceAccess: SandboxWorkspaceAccess;
  containerName: string;
  containerWorkdir: string;
  docker: SandboxDockerConfig;
  tools: SandboxToolPolicy;
  browserAllowHostControl: boolean;
  browser?: SandboxBrowserContext;
}

export interface SandboxBrowserContext {
  bridgeUrl: string;
  noVncUrl?: string;
  containerName: string;
}

export interface SandboxResolvedPath {
  containerPath: string;
  hostPath?: string;
  mountPoint?: string;
}

/** Default sandbox configuration */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  mode: 'off',
  scope: 'agent',
  workspaceAccess: 'ro',
  workspaceRoot: '~/.openpilot/sandboxes',
  docker: {
    image: 'openpilot/sandbox:latest',
    containerPrefix: 'openpilot-sandbox',
    workdir: '/workspace',
    readOnlyRoot: true,
    tmpfs: ['/tmp', '/var/tmp', '/run'],
    network: 'none',
    capDrop: ['ALL'],
    env: { LANG: 'C.UTF-8' },
  },
  browser: {
    enabled: false,
    image: 'openpilot/sandbox-browser:latest',
    network: 'openpilot-browser-net',
    cdpPort: 9222,
    vncPort: 5900,
    noVncPort: 6080,
    headless: false,
    enableNoVnc: true,
    allowHostControl: false,
    autoStart: true,
    autoStartTimeoutMs: 30000,
  },
  tools: {},
  prune: {
    idleHours: 24,
    maxAgeDays: 7,
  },
};
