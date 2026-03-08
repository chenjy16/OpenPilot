/**
 * Configuration System
 *
 * OpenPilot-aligned configuration:
 *   1. JSON5 config file (~/.openpilot/config.json5 or ./openpilot.json5)
 *   2. Environment variables (override file values)
 *   3. Programmatic defaults
 *
 * Supports: agents, models, tools, channels, gateway settings.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Config types (OpenPilot-aligned)
// ---------------------------------------------------------------------------

export interface AgentModelConfig {
  primary: string;
  fallbacks: string[];
}

export interface CompactionConfig {
  mode: 'default' | 'safeguard';
  reserveTokens: number;
  keepRecentTokens: number;
  maxHistoryShare: number;
}

export interface AgentDefaults {
  model: AgentModelConfig;
  compaction: CompactionConfig;
  maxToolCallsPerLoop: number;
  subAgentMaxDepth: number;
  /** Heartbeat configuration */
  heartbeat?: {
    every?: string;
    activeHours?: { start?: string; end?: string };
    model?: string;
    session?: string;
    target?: string;
    to?: string;
    prompt?: string;
    lightContext?: boolean;
  };
  /** Block streaming output */
  blockStreaming?: {
    blockStreamingDefault?: 'off' | 'on';
    blockStreamingBreak?: 'text_end' | 'message_end';
    blockStreamingChunk?: { minChars?: number; maxChars?: number };
    blockStreamingCoalesce?: { minChars?: number; maxChars?: number; idleMs?: number };
    humanDelay?: { mode?: 'off' | 'natural' | 'custom'; minMs?: number; maxMs?: number };
  };
  /** Context pruning */
  contextPruning?: {
    mode?: 'off' | 'cache-ttl';
    ttl?: string;
    keepLastAssistants?: number;
    tools?: { allow?: string[]; deny?: string[] };
    softTrim?: { maxChars?: number; headChars?: number; tailChars?: number };
    hardClear?: { enabled?: boolean };
  };
  /** Sub-agent defaults */
  subagents?: {
    maxConcurrent?: number;
    maxSpawnDepth?: number;
    maxChildrenPerAgent?: number;
    archiveAfterMinutes?: number;
    announceTimeoutMs?: number;
    model?: AgentModelConfig | string;
    thinking?: string;
    runTimeoutSeconds?: number;
  };
  /** Workspace directory */
  workspace?: string;
  /** User timezone */
  userTimezone?: string;
  /** Thinking level default */
  thinkingDefault?: string;
  /** Max concurrent agent runs */
  maxConcurrent?: number;
  /** Typing indicator mode */
  typingMode?: string;
  /** Context window token limit */
  contextTokens?: number;
  /** Agent run timeout */
  timeoutSeconds?: number;
}

export interface ToolsConfig {
  /** Base tool profile */
  profile?: 'minimal' | 'coding' | 'messaging' | 'full';
  /** Explicit tool whitelist (overrides profile) */
  allow?: string[];
  /** Append to profile whitelist */
  alsoAllow?: string[];
  /** Tool blacklist */
  deny?: string[];
  /** Per-provider tool strategy overrides */
  byProvider?: Record<string, { allow?: string[]; deny?: string[] }>;
  exec: {
    host?: 'sandbox' | 'gateway' | 'node';
    security?: 'deny' | 'allowlist' | 'full';
    ask?: 'off' | 'on-miss' | 'always';
    node?: string;
    pathPrepend?: string[];
    safeBins?: string[];
    timeoutSec: number;
    backgroundMs: number;
    notifyOnExit?: boolean;
    applyPatch?: { enabled?: boolean };
  };
  fs: {
    workspaceOnly: boolean;
  };
  web?: {
    search?: {
      enabled?: boolean;
      provider?: 'brave' | 'perplexity' | 'grok' | 'gemini' | 'kimi';
      apiKey?: string;
      maxResults?: number;
      timeoutSeconds?: number;
      cacheTtlMinutes?: number;
    };
    fetch?: {
      enabled?: boolean;
      maxChars?: number;
      maxCharsCap?: number;
      timeoutSeconds?: number;
      maxRedirects?: number;
      readability?: boolean;
    };
  };
  media?: {
    concurrency?: number;
    image?: { enabled?: boolean; maxBytes?: number; prompt?: string };
    audio?: {
      enabled?: boolean;
      maxBytes?: number;
      language?: string;
      echoTranscript?: boolean;
    };
    video?: { enabled?: boolean; maxBytes?: number };
  };
  message?: {
    crossContext?: {
      allowWithinProvider?: boolean;
      allowAcrossProviders?: boolean;
    };
    broadcast?: { enabled?: boolean };
  };
  elevated?: {
    enabled?: boolean;
    allowFrom?: Record<string, string[]>;
  };
  loopDetection?: {
    enabled?: boolean;
    historySize?: number;
    warningThreshold?: number;
    criticalThreshold?: number;
    globalCircuitBreakerThreshold?: number;
  };
  subagents?: {
    model?: AgentModelConfig | string;
    tools?: { allow?: string[]; alsoAllow?: string[]; deny?: string[] };
  };
  sessions?: {
    visibility?: 'self' | 'tree' | 'agent' | 'all';
  };
  agentToAgent?: {
    enabled?: boolean;
    allow?: string[];
  };
  browser: {
    headless: boolean;
  };
  requireApproval: string[];
  denylist: string[];
}

export interface ChannelConfig {
  defaults?: {
    groupPolicy?: 'open' | 'disabled' | 'allowlist';
    heartbeat?: { showOk?: boolean; showAlerts?: boolean };
  };
  modelByChannel?: Record<string, Record<string, string>>;
  telegram?: { enabled: boolean; token?: string; allowedChats?: string[]; groups?: Record<string, any> };
  discord?: { enabled: boolean; token?: string; guilds?: Record<string, any>; allowFrom?: string[] };
  slack?: { enabled: boolean; token?: string; appToken?: string; signingSecret?: string };
  signal?: { enabled: boolean };
  imessage?: { enabled: boolean };
  googlechat?: { enabled: boolean };
  msteams?: { enabled: boolean };
  irc?: { enabled: boolean };
}

export interface GatewayConfig {
  port: number;
  host: string;
  mode?: 'local' | 'remote';
  bind?: 'auto' | 'lan' | 'loopback' | 'tailnet' | 'custom';
  customBindHost?: string;
  auth?: {
    mode?: 'none' | 'token' | 'password' | 'trusted-proxy';
    token?: string;
    password?: string;
    rateLimit?: { maxAttempts?: number; windowMs?: number; lockoutMs?: number };
  };
  controlUi?: { enabled?: boolean; basePath?: string; allowedOrigins?: string[] };
  tls?: { enabled?: boolean; autoGenerate?: boolean; certPath?: string; keyPath?: string };
  reload?: { mode?: 'off' | 'restart' | 'hot' | 'hybrid'; debounceMs?: number };
  http?: {
    endpoints?: {
      chatCompletions?: { enabled?: boolean };
      responses?: { enabled?: boolean; maxBodyBytes?: number };
    };
  };
}

export interface SkillsConfig {
  /** Bundled skill whitelist (empty = allow all) */
  allowBundled?: string[];
  /** Per-skill configuration */
  entries?: Record<string, { enabled?: boolean; apiKey?: string; env?: Record<string, string> }>;
  /** Extra skill loading directories */
  load?: { extraDirs?: string[] };
  /** Loading limits */
  limits?: {
    maxCandidatesPerRoot?: number;
    maxSkillsLoadedPerSource?: number;
    maxSkillsInPrompt?: number;
    maxPromptChars?: number;
    maxSkillFileBytes?: number;
  };
  /** Community (SkillsMP) integration */
  community?: {
    /** SkillsMP API key (sk_live_xxx) */
    apiKey?: string;
    /** SkillsMP API base URL override */
    baseUrl?: string;
    /** ClawHub base URL override */
    clawhubBaseUrl?: string;
  };
  /** Runtime skill overrides (enable/disable, API keys) — persisted from UI */
  overrides?: Record<string, { enabled?: boolean; apiKey?: string; env?: Record<string, string> }>;
}

export interface SandboxConfigSection {
  mode: 'off' | 'non-main' | 'all';
  scope: 'session' | 'agent' | 'shared';
  workspaceAccess: 'none' | 'ro' | 'rw';
  workspaceRoot: string;
  docker?: {
    image?: string;
    network?: string;
    memory?: string;
    cpus?: number;
    pidsLimit?: number;
    readOnlyRoot?: boolean;
  };
  browser?: {
    enabled?: boolean;
    headless?: boolean;
    enableNoVnc?: boolean;
  };
  prune?: {
    idleHours?: number;
    maxAgeDays?: number;
  };
}

export interface AgentListEntry {
  id: string;
  default?: boolean;
  name?: string;
  workspace?: string;
  model?: AgentModelConfig | string;
  toolProfile?: string;
  tools?: { allow?: string[]; deny?: string[]; alsoAllow?: string[] };
  skillFilter?: string[];
  sandbox?: Partial<SandboxConfigSection>;
  identity?: { name?: string; theme?: string; emoji?: string; avatar?: string };
  heartbeat?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export interface SessionConfig {
  scope?: 'per-sender' | 'global';
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
  /** Cross-channel identity mapping (e.g. { "alice": ["telegram:123", "discord:456"] }) */
  identityLinks?: Record<string, string[]>;
  /** Agent-to-agent ping-pong limits */
  agentToAgent?: {
    maxPingPongTurns?: number;
  };
  /** Thread binding configuration */
  threadBindings?: {
    enabled?: boolean;
    idleHours?: number;
    maxAgeHours?: number;
  };
  resetTriggers?: string[];
  idleMinutes?: number;
  reset?: { mode?: 'daily' | 'idle'; atHour?: number; idleMinutes?: number };
  store?: string;
  typingMode?: string;
  maintenance?: {
    mode?: 'enforce' | 'warn';
    pruneAfter?: string | number;
    maxEntries?: number;
    rotateBytes?: number | string;
    maxDiskBytes?: number | string;
  };
}

export interface LoggingConfig {
  level?: string;
  file?: string;
  maxFileBytes?: number;
  consoleLevel?: string;
  consoleStyle?: 'pretty' | 'compact' | 'json';
  redactSensitive?: 'off' | 'tools';
  redactPatterns?: string[];
}

export interface CronConfig {
  enabled?: boolean;
  store?: string;
  maxConcurrentRuns?: number;
  retry?: { maxAttempts?: number; backoffMs?: number[]; retryOn?: string[] };
  sessionRetention?: string | false;
  failureAlert?: { enabled?: boolean; after?: number; cooldownMs?: number };
  /** Persisted cron job definitions */
  jobs?: Array<{
    id: string;
    schedule: string;
    agentId: string;
    message: string;
    enabled: boolean;
    createdAt: string;
  }>;
}

export interface MessagesConfig {
  responsePrefix?: string;
  groupChat?: { mentionPatterns?: string[]; historyLimit?: number };
  queue?: { mode?: string; debounceMs?: number; cap?: number; drop?: string };
  ackReaction?: string;
  suppressToolErrors?: boolean;
  tts?: {
    auto?: 'off' | 'always' | 'inbound' | 'tagged';
    provider?: 'elevenlabs' | 'openai' | 'edge';
    maxTextLength?: number;
  };
}

export interface MemoryConfig {
  backend?: 'builtin' | 'qmd';
  citations?: 'auto' | 'on' | 'off';
}

export interface DiagnosticsConfig {
  enabled?: boolean;
  flags?: string[];
  stuckSessionWarnMs?: number;
  otel?: {
    enabled?: boolean;
    endpoint?: string;
    protocol?: string;
    traces?: boolean;
    metrics?: boolean;
    logs?: boolean;
    sampleRate?: number;
  };
}

export interface UpdateConfig {
  channel?: 'stable' | 'beta' | 'dev';
  checkOnStart?: boolean;
  auto?: { enabled?: boolean; stableDelayHours?: number };
}

export interface HooksConfig {
  enabled?: boolean;
  path?: string;
  token?: string;
  defaultSessionKey?: string;
  maxBodyBytes?: number;
}

export interface BrowserConfig {
  enabled?: boolean;
  evaluateEnabled?: boolean;
  headless?: boolean;
  noSandbox?: boolean;
  executablePath?: string;
  defaultProfile?: string;
  extraArgs?: string[];
}

export interface SecretsConfig {
  providers?: Record<string, { source: 'env' | 'file' | 'exec'; path?: string; command?: string }>;
}

export interface ApprovalsConfig {
  exec?: { enabled?: boolean; mode?: string; targets?: string[] };
}

/** Custom model providers */
export interface ModelsConfig {
  mode?: 'merge' | 'replace';
  providers?: Record<string, {
    baseUrl?: string;
    apiKey?: string;
    api?: string;
    headers?: Record<string, string>;
    models?: Array<{
      id: string;
      name?: string;
      reasoning?: boolean;
      contextWindow?: number;
      maxTokens?: number;
    }>;
  }>;
  bedrockDiscovery?: {
    enabled?: boolean;
    region?: string;
    providerFilter?: string[];
  };
}

/** Auth profiles for model providers */
export interface AuthConfig {
  profiles?: Record<string, { provider?: string; mode?: string; apiKey?: string }>;
  order?: Record<string, string[]>;
  cooldowns?: {
    billingBackoffHours?: number;
    billingBackoffHoursByProvider?: Record<string, number>;
    billingMaxHours?: number;
    failureWindowHours?: number;
  };
}

/** Command system */
export interface CommandsConfig {
  native?: boolean | 'auto';
  nativeSkills?: boolean | 'auto';
  text?: boolean;
  bash?: boolean;
  bashForegroundMs?: number;
  config?: boolean;
  debug?: boolean;
  restart?: boolean;
  useAccessGroups?: boolean;
  ownerAllowFrom?: (string | number)[];
  allowFrom?: Record<string, string[]>;
}

/** Plugin system */
export interface PluginsConfig {
  enabled?: boolean;
  allow?: string[];
  deny?: string[];
  load?: { paths?: string[] };
  slots?: { memory?: string };
  entries?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
}

/** Agent routing bindings */
export interface BindingEntry {
  agentId: string;
  match?: {
    channel?: string;
    peer?: string;
    guild?: string;
    roles?: string[];
  };
}

/** Broadcast configuration */
export interface BroadcastConfig {
  strategy?: string;
  peers?: Record<string, string[]>;
}

/** Discovery configuration */
export interface DiscoveryConfig {
  wideArea?: Record<string, unknown>;
  mdns?: { mode?: 'off' | 'minimal' | 'full' };
}

/** Talk (real-time voice) */
export interface TalkConfig {
  provider?: string;
  providers?: Record<string, {
    voiceId?: string;
    modelId?: string;
    apiKey?: string;
  }>;
}

/** UI appearance */
export interface UIConfig {
  seamColor?: string;
  assistant?: { name?: string; avatar?: string };
}

/** CLI configuration */
export interface CLIConfig {
  banner?: { taglineMode?: 'random' | 'default' | 'off' };
}

/** Environment variable injection */
export interface EnvConfig {
  shellEnv?: { enabled?: boolean; timeoutMs?: number };
  vars?: Record<string, string>;
}

/** Meta (config file metadata) */
export interface MetaConfig {
  lastTouchedVersion?: string;
  lastTouchedAt?: string;
}

/** Polymarket / PolyOracle configuration */
export interface PolymarketConfig {
  enabled?: boolean;
  gammaApiUrl?: string;
  scanLimit?: number;
  minVolume?: number;
  /** Minimum edge (AI prob - market prob) to flag as signal */
  signalThreshold?: number;
  /** Override model for AI analysis */
  model?: string;
  /** Telegram notification settings */
  notify?: {
    enabled?: boolean;
    telegram?: { chatId: string };
    discord?: { channelId: string };
    minEdge?: number;
    dedupHours?: number;
  };
}

export interface AppConfig {
  /** Runtime environment */
  nodeEnv: 'development' | 'production' | 'test';
  /** Debug mode */
  debug: boolean;
  /** Log level */
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  /** SQLite database path */
  databasePath: string;
  /** Config file metadata */
  meta?: MetaConfig;
  /** Environment variable injection */
  env?: EnvConfig;
  /** Auth profiles for model providers */
  auth?: AuthConfig;
  /** Gateway (HTTP/WS server) settings */
  gateway: GatewayConfig;
  /** Agent defaults */
  agents: {
    defaults: AgentDefaults & {
      toolProfile?: string;
      sandbox?: SandboxConfigSection;
    };
    list?: AgentListEntry[];
  };
  /** Custom model providers */
  models?: ModelsConfig;
  /** Tool configuration */
  tools: ToolsConfig;
  /** Skills configuration */
  skills: SkillsConfig;
  /** Plugin system */
  plugins?: PluginsConfig;
  /** Channel configuration */
  channels: ChannelConfig;
  /** Agent routing bindings */
  bindings?: BindingEntry[];
  /** Session management */
  session?: SessionConfig;
  /** Logging configuration */
  logging?: LoggingConfig;
  /** Cron / scheduled tasks */
  cron?: CronConfig;
  /** Messages processing */
  messages?: MessagesConfig;
  /** Command system */
  commands?: CommandsConfig;
  /** Broadcast */
  broadcast?: BroadcastConfig;
  /** Memory system */
  memory?: MemoryConfig;
  /** Diagnostics & telemetry */
  diagnostics?: DiagnosticsConfig;
  /** Auto-update */
  update?: UpdateConfig;
  /** Webhook/Hook configuration */
  hooks?: HooksConfig;
  /** Browser tool configuration */
  browser?: BrowserConfig;
  /** Secrets management */
  secrets?: SecretsConfig;
  /** Approval flow */
  approvals?: ApprovalsConfig;
  /** Discovery */
  discovery?: DiscoveryConfig;
  /** Talk (real-time voice) */
  talk?: TalkConfig;
  /** Polymarket / PolyOracle */
  polymarket?: PolymarketConfig;
  /** UI appearance */
  ui?: UIConfig;
  /** CLI configuration */
  cli?: CLIConfig;
  /** API keys (from env vars, never persisted to file) */
  apiKeys: {
    openai?: string;
    anthropic?: string;
    google?: string;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AppConfig = {
  nodeEnv: 'development',
  debug: false,
  logLevel: 'info',
  databasePath: './data/sessions.db',
  gateway: {
    port: 3000,
    host: 'localhost',
    bind: 'loopback',
    reload: { mode: 'hybrid' },
  },
  agents: {
    defaults: {
      model: {
        primary: 'google/gemini-2.0-flash',
        fallbacks: ['google/gemini-2.5-flash', 'google/gemini-1.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-3-haiku-20240307'],
      },
      compaction: {
        mode: 'default',
        reserveTokens: 20000,
        keepRecentTokens: 8000,
        maxHistoryShare: 0.7,
      },
      maxToolCallsPerLoop: 10,
      subAgentMaxDepth: 3,
      toolProfile: 'coding',
      sandbox: {
        mode: 'off',
        scope: 'agent',
        workspaceAccess: 'ro',
        workspaceRoot: '~/.openpilot/sandboxes',
      },
      heartbeat: { every: '30m', target: 'last' },
      thinkingDefault: 'medium',
      maxConcurrent: 1,
    },
    list: [],
  },
  tools: {
    profile: 'coding',
    exec: { timeoutSec: 120, backgroundMs: 30000, host: 'gateway', security: 'deny', ask: 'on-miss' },
    fs: { workspaceOnly: true },
    web: {
      search: { enabled: true, maxResults: 5 },
      fetch: { enabled: true, maxChars: 30000, readability: true },
    },
    media: { concurrency: 2 },
    loopDetection: { enabled: true, historySize: 30, warningThreshold: 10, criticalThreshold: 20 },
    browser: { headless: true },
    requireApproval: ['shellExecute', 'writeFile'],
    denylist: [],
  },
  skills: {},
  channels: {
    defaults: { groupPolicy: 'disabled' },
  },
  session: {
    scope: 'per-sender',
    reset: { mode: 'daily', atHour: 4 },
    maintenance: { pruneAfter: '30d', maxEntries: 500 },
  },
  logging: {
    level: 'info',
    consoleStyle: 'pretty',
    redactSensitive: 'tools',
  },
  cron: {
    enabled: false,
    maxConcurrentRuns: 2,
  },
  messages: {
    suppressToolErrors: false,
  },
  commands: {
    native: 'auto',
    text: true,
    bash: false,
    restart: true,
  },
  memory: {
    backend: 'builtin',
    citations: 'auto',
  },
  diagnostics: {
    enabled: false,
  },
  update: {
    channel: 'stable',
    checkOnStart: true,
  },
  hooks: {
    enabled: false,
  },
  browser: {
    enabled: true,
    headless: true,
  },
  approvals: {
    exec: { enabled: true, mode: 'on-miss' },
  },
  discovery: {
    mdns: { mode: 'off' },
  },
  apiKeys: {},
};

// ---------------------------------------------------------------------------
// JSON5 parser (minimal — supports comments and trailing commas)
// ---------------------------------------------------------------------------

/**
 * Minimal JSON5-ish parser: strips // and /* comments, trailing commas,
 * then delegates to JSON.parse. Good enough for config files.
 */
function parseJSON5(text: string): any {
  // Strip comments while respecting string literals
  let result = '';
  let i = 0;
  while (i < text.length) {
    // String literal — copy verbatim until closing quote
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        j++;
      }
      result += text.slice(i, j);
      i = j;
    }
    // Single-line comment
    else if (text[i] === '/' && text[i + 1] === '/') {
      // Skip until end of line
      while (i < text.length && text[i] !== '\n') i++;
    }
    // Multi-line comment
    else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip */
    }
    // Normal character
    else {
      result += text[i];
      i++;
    }
  }
  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(result);
}

// ---------------------------------------------------------------------------
// Config file discovery
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAMES = ['openpilot.json5', 'openpilot.json', 'config.json5', 'config.json'];

function findConfigFile(): string | null {
  // 1. Current directory
  for (const name of CONFIG_FILE_NAMES) {
    const p = path.resolve(name);
    if (fs.existsSync(p)) return p;
  }

  // 2. .openpilot/ in current directory
  for (const name of CONFIG_FILE_NAMES) {
    const p = path.resolve('.openpilot', name);
    if (fs.existsSync(p)) return p;
  }

  // 3. ~/.openpilot/
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    for (const name of CONFIG_FILE_NAMES) {
      const p = path.join(home, '.openpilot', name);
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Deep merge utility
// ---------------------------------------------------------------------------

function deepMerge(target: any, source: any): any {
  const result: any = {};
  // Deep clone all target properties first
  for (const key of Object.keys(target)) {
    if (
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], {});
    } else if (Array.isArray(target[key])) {
      result[key] = [...target[key]];
    } else {
      result[key] = target[key];
    }
  }
  // Merge source properties
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Exported deep merge for use by API server (config PUT endpoint).
 * Preserves keys in target that are not in source (e.g. apiKeys).
 */
export function deepMergeConfig(target: any, source: any): any {
  return deepMerge(target, source);
}

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------

/**
 * Load application configuration from file + env vars.
 * Throws on critical validation errors (e.g. no API keys).
 */
export function loadAppConfig(): AppConfig {
  let fileConfig: Partial<AppConfig> = {};

  // Try loading config file
  const configPath = findConfigFile();
  if (configPath) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      fileConfig = parseJSON5(raw);
      console.log(`[Config] Loaded from ${configPath}`);
    } catch (err: any) {
      console.warn(`[Config] Failed to parse ${configPath}: ${err.message}`);
    }
  }

  // Merge: defaults ← file ← env overrides
  let config: AppConfig = deepMerge(DEFAULT_CONFIG, fileConfig);

  // Environment variable overrides
  config = applyEnvOverrides(config);

  // Validate
  validateConfig(config);

  return config;
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  // API keys (never from file)
  config.apiKeys = {
    openai: process.env.OPENAI_API_KEY || undefined,
    anthropic: process.env.ANTHROPIC_API_KEY || undefined,
    google: process.env.GOOGLE_AI_API_KEY || undefined,
  };

  // Gateway
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (!isNaN(port) && port >= 1 && port <= 65535) config.gateway.port = port;
  }
  if (process.env.HOST) config.gateway.host = process.env.HOST;

  // Database
  if (process.env.DATABASE_PATH) config.databasePath = process.env.DATABASE_PATH;

  // Node env
  const env = process.env.NODE_ENV;
  if (env === 'development' || env === 'production' || env === 'test') config.nodeEnv = env;

  // Debug
  if (process.env.DEBUG === 'true') config.debug = true;

  // Log level
  const ll = process.env.LOG_LEVEL;
  if (ll === 'error' || ll === 'warn' || ll === 'info' || ll === 'debug') config.logLevel = ll;

  // Channel tokens from env
  if (process.env.TELEGRAM_BOT_TOKEN) {
    config.channels.telegram = {
      ...config.channels.telegram,
      enabled: true,
      token: process.env.TELEGRAM_BOT_TOKEN,
    };
    if (process.env.TELEGRAM_ALLOWED_CHATS) {
      config.channels.telegram.allowedChats = process.env.TELEGRAM_ALLOWED_CHATS.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  return config;
}

function validateConfig(config: AppConfig): void {
  const { apiKeys } = config;
  if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google) {
    console.warn(
      '[Config] Warning: no API keys configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY.',
    );
  }

  const { port } = config.gateway;
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Configuration error: port must be 1–65535 (got ${port}).`);
  }
}

// ---------------------------------------------------------------------------
// Backward compatibility: re-export loadConfig with old shape
// ---------------------------------------------------------------------------

export interface LegacyConfig {
  openaiApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  googleApiKey: string | undefined;
  databasePath: string;
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  debug: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Legacy loadConfig() — returns the flat config shape used by existing code.
 * Internally delegates to loadAppConfig().
 */
export function loadConfig(): LegacyConfig {
  const app = loadAppConfig();
  return {
    openaiApiKey: app.apiKeys.openai,
    anthropicApiKey: app.apiKeys.anthropic,
    googleApiKey: app.apiKeys.google,
    databasePath: app.databasePath,
    port: app.gateway.port,
    host: app.gateway.host,
    nodeEnv: app.nodeEnv,
    debug: app.debug,
    logLevel: app.logLevel,
  };
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

/**
 * Save config to the config file (creates if not found).
 * Strips apiKeys (never persisted) and writes JSON with comments header.
 */
export function saveAppConfig(config: AppConfig): string {
  // Find existing config file or create default path
  let configPath = findConfigFile();
  if (!configPath) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const dir = home ? path.join(home, '.openpilot') : '.openpilot';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    configPath = path.join(dir, 'config.json5');
  }

  // Strip sensitive/runtime-only fields
  const toSave: any = JSON.parse(JSON.stringify(config));
  delete toSave.apiKeys;

  // Strip sensitive keys from nested structures (channel tokens, model provider apiKeys)
  if (toSave.channels) {
    for (const ch of Object.values(toSave.channels) as any[]) {
      if (ch && typeof ch === 'object') {
        for (const key of ['token', 'signingSecret', 'appToken']) {
          if (ch[key] && typeof ch[key] === 'string') {
            // Keep the value — it's needed for restart. Only strip if it's a masked placeholder.
            if (ch[key].startsWith('••••')) delete ch[key];
          }
        }
      }
    }
  }
  // Strip masked placeholders from model provider apiKeys (keep real keys for restart)
  if (toSave.models?.providers) {
    for (const prov of Object.values(toSave.models.providers) as any[]) {
      if (prov?.apiKey && typeof prov.apiKey === 'string' && prov.apiKey.startsWith('••••')) {
        delete prov.apiKey;
      }
    }
  }

  const content = JSON.stringify(toSave, null, 2);
  fs.writeFileSync(configPath, content, 'utf-8');
  console.log(`[Config] Saved to ${configPath}`);
  return configPath;
}

/**
 * Get the resolved config file path (or null if none exists).
 */
export function getConfigFilePath(): string | null {
  return findConfigFile();
}
