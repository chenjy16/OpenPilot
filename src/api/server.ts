/**
 * API Server
 *
 * OpenPilot Gateway layer: REST + WebSocket interfaces.
 * Routes: /api/chat, /api/sessions, /api/audit-logs, /api/health, /api/models
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import path from 'path';
import fs from 'fs';
import WebSocket, { WebSocketServer } from 'ws';
import { AIRuntime } from '../runtime';
import { SessionManager } from '../session';
import { DatabaseError } from '../session/SessionManager';
import { ValidationError } from '../types';
import { AuditLogger } from '../tools/auditHook';
import { PolicyEngine } from '../tools/PolicyEngine';
import {
  AuthenticationError,
  RateLimitError,
} from '../models/ModelProvider';
import {
  requestRateLimiter,
  inputValidationMiddleware,
  checkAndRecordTokenUsage,
  getDailyTokenUsage,
} from './middleware';
import type { ChannelManager } from '../channels/ChannelManager';
import type { PluginManager } from '../plugins/PluginManager';
import { getToolCatalog, getToolsForProfile, type ToolProfile } from '../tools/toolCatalog';
import { getSkillStatusReports } from '../skills/loader';
import {
  searchCommunitySkills,
  aiSearchCommunitySkills,
  getCommunitySkillDetail,
  installCommunitySkill,
  setCommunityConfig,
  getHotSkills,
} from '../skills/community';
import type { CommunitySource } from '../skills/types';
import { AgentManager } from '../agents/AgentManager';
import {
  upsertPairingRequest,
  approveChannelPairingCode,
  listPairingRequests,
  readAllowFrom,
  addAllowFromEntry,
  removeAllowFromEntry,
} from '../channels/PairingStore';

// ---------------------------------------------------------------------------
// Config section schema for frontend rendering
// ---------------------------------------------------------------------------

const CONFIG_SECTION_SCHEMA: Record<string, {
  icon: string; label: string; description: string;
  fields?: Record<string, { type: string; label: string; description?: string; options?: string[] }>;
}> = {
  gateway: {
    icon: '🌐', label: '网关配置', description: '核心网关参数：端口、绑定、认证、TLS',
    fields: {
      port: { type: 'number', label: '端口', description: '网关监听端口（默认 3000）' },
      host: { type: 'string', label: '主机', description: '绑定主机地址' },
      bind: { type: 'select', label: '绑定策略', options: ['auto', 'lan', 'loopback', 'tailnet', 'custom'] },
    },
  },
  agents: {
    icon: '🤖', label: '智能体配置', description: '智能体全局默认值、模型、压缩、沙箱、心跳',
  },
  models: {
    icon: '🧩', label: '自定义模型', description: '自定义模型提供商、Bedrock 发现',
  },
  tools: {
    icon: '🔧', label: '工具配置', description: '工具策略、执行、网页搜索/抓取、媒体、循环检测',
  },
  skills: {
    icon: '⚡', label: '技能配置', description: '技能加载、白名单、限制参数',
  },
  plugins: {
    icon: '🔌', label: '插件系统', description: '插件加载、白名单、插槽绑定',
  },
  channels: {
    icon: '🔗', label: '渠道配置', description: '消息渠道连接：Telegram、Discord、Slack 等',
  },
  session: {
    icon: '💬', label: '会话管理', description: '会话范围、重置策略、维护清理',
    fields: {
      scope: { type: 'select', label: '会话范围', options: ['per-sender', 'global'] },
    },
  },
  logging: {
    icon: '📋', label: '日志配置', description: '日志级别、文件输出、脱敏策略',
    fields: {
      level: { type: 'select', label: '文件日志级别', options: ['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'] },
      consoleLevel: { type: 'select', label: '控制台日志级别', options: ['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'] },
      consoleStyle: { type: 'select', label: '控制台样式', options: ['pretty', 'compact', 'json'] },
      redactSensitive: { type: 'select', label: '敏感数据脱敏', options: ['off', 'tools'] },
    },
  },
  cron: {
    icon: '⏰', label: '定时任务', description: '调度器开关、并发限制、重试策略',
    fields: {
      enabled: { type: 'boolean', label: '启用调度器' },
      maxConcurrentRuns: { type: 'number', label: '最大并发执行数' },
    },
  },
  messages: {
    icon: '💌', label: '消息处理', description: '回复前缀、队列、确认反应、TTS',
  },
  commands: {
    icon: '⌨️', label: '命令系统', description: '原生命令、文本命令、Bash、权限',
  },
  broadcast: {
    icon: '📡', label: '广播配置', description: '广播策略与对等节点映射',
  },
  memory: {
    icon: '🧠', label: '记忆系统', description: '记忆后端、引用模式',
    fields: {
      backend: { type: 'select', label: '记忆后端', options: ['builtin', 'qmd'] },
      citations: { type: 'select', label: '引用模式', options: ['auto', 'on', 'off'] },
    },
  },
  diagnostics: {
    icon: '🔬', label: '诊断与遥测', description: 'OpenTelemetry、诊断标志',
    fields: {
      enabled: { type: 'boolean', label: '启用诊断' },
    },
  },
  update: {
    icon: '🔄', label: '自动更新', description: '更新通道、启动检查',
    fields: {
      channel: { type: 'select', label: '更新通道', options: ['stable', 'beta', 'dev'] },
      checkOnStart: { type: 'boolean', label: '启动时检查更新' },
    },
  },
  hooks: {
    icon: '🪝', label: 'Webhook 配置', description: 'Hook 端点、认证、映射规则',
    fields: {
      enabled: { type: 'boolean', label: '启用 Hook 系统' },
    },
  },
  browser: {
    icon: '🌍', label: '浏览器工具', description: '浏览器控制、无头模式、CDP',
    fields: {
      enabled: { type: 'boolean', label: '启用浏览器工具' },
      headless: { type: 'boolean', label: '无头模式' },
    },
  },
  approvals: {
    icon: '✅', label: '审批配置', description: '执行审批流转发',
  },
  auth: {
    icon: '🔐', label: '认证 Profile', description: '模型提供商认证配置与退避策略',
  },
  discovery: {
    icon: '🔍', label: '服务发现', description: 'mDNS 广播与广域发现',
  },
  talk: {
    icon: '🎙️', label: '实时语音', description: 'Talk 实时语音模式提供商',
  },
  ui: {
    icon: '🎨', label: 'UI 外观', description: 'Web UI 主题色、助手名称',
  },
  cli: {
    icon: '💻', label: 'CLI 配置', description: 'CLI 横幅与标语模式',
  },
  secrets: {
    icon: '🔒', label: '密钥管理', description: '密钥来源提供商（env/file/exec）',
  },
  bindings: {
    icon: '🔀', label: '路由绑定', description: '智能体路由绑定规则',
  },
  env: {
    icon: '🌱', label: '环境变量', description: '环境变量注入与 Shell 导入',
  },
  meta: {
    icon: '📝', label: '配置元数据', description: '配置文件版本与时间戳',
  },
  apiKeys: {
    icon: '🔑', label: 'API 密钥', description: 'AI 服务商 API 密钥（环境变量设置，不可通过 UI 修改）',
  },
  nodeEnv: { icon: '⚙️', label: '运行环境', description: '运行时环境标识' },
  logLevel: { icon: '📊', label: '全局日志级别', description: '全局日志输出级别' },
  databasePath: { icon: '💾', label: '数据库路径', description: 'SQLite 数据库文件位置' },
  debug: { icon: '🐛', label: '调试模式', description: '启用详细调试输出' },
};

// ---------------------------------------------------------------------------
// Sensitive data masking
// ---------------------------------------------------------------------------

const SENSITIVE_LOG_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sk-[A-Za-z0-9]{20,}/g, replacement: 'sk-[MASKED]' },
  { pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/g, replacement: 'sk-ant-[MASKED]' },
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, replacement: 'Bearer [MASKED]' },
  { pattern: /(api[_-]?key["']?\s*[:=]\s*["']?)[A-Za-z0-9\-._]{10,}/gi, replacement: '$1[MASKED]' },
  { pattern: /(authorization["']?\s*[:=]\s*["']?)[A-Za-z0-9\-._~+/ ]{10,}/gi, replacement: '$1[MASKED]' },
];

function maskSensitiveData(value: string): string {
  let masked = value;
  for (const { pattern, replacement } of SENSITIVE_LOG_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

// ---------------------------------------------------------------------------
// APIServer
// ---------------------------------------------------------------------------

export class APIServer {
  private app: Application;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private aiRuntime: AIRuntime;
  private sessionManager: SessionManager;
  private auditLogger: AuditLogger;
  /** Optional channel manager for multi-channel gateway */
  private channelManager?: ChannelManager;
  /** Optional plugin manager */
  private pluginManager?: PluginManager;
  /** Agent manager for agent CRUD and file management */
  private agentManager: AgentManager;
  /** Tracks which sessions are currently being processed (WS concurrency guard) */
  private activeSessions: Set<string> = new Set();
  /** AbortControllers for active streaming sessions */
  private activeAbortControllers: Map<string, AbortController> = new Map();
  /** In-memory cron jobs store */
  private cronJobs: any[] = [];
  /** In-memory nodes list */
  private nodesList: any[] = [];
  /** In-memory paired devices */
  private devicesList: any[] = [];
  /** In-memory pending device pairing requests */
  private pendingDevices: any[] = [];
  /** In-memory exec approval queue */
  private execApprovalQueue: any[] = [];
  /** App config reference */
  private appConfig: any = null;
  /** In-memory skill overrides (enable/disable, API keys) */
  private skillOverrides: Record<string, { enabled?: boolean; apiKey?: string; env?: Record<string, string> }> = {};
  /** Resolved Control UI static assets root directory */
  private controlUiRoot: string | null = null;
  /** Policy engine for tool access control */
  private policyEngine?: PolicyEngine;

  constructor(aiRuntime: AIRuntime, sessionManager: SessionManager, auditLogger?: AuditLogger, channelManager?: ChannelManager, pluginManager?: PluginManager, agentManager?: AgentManager, appConfig?: any, policyEngine?: PolicyEngine) {
    this.aiRuntime = aiRuntime;
    this.sessionManager = sessionManager;
    this.auditLogger = auditLogger ?? new AuditLogger();
    this.channelManager = channelManager;
    this.pluginManager = pluginManager;
    this.appConfig = appConfig ?? null;
    this.policyEngine = policyEngine;
    // Use injected AgentManager if provided, otherwise create a new one
    if (agentManager) {
      this.agentManager = agentManager;
    } else {
      this.agentManager = new AgentManager();
      this.agentManager.initialize().catch(err => console.warn('[AgentManager] Init failed:', err.message));
    }
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSpaFallback();
    this.setupErrorHandler();

    // Initialize community skills config from app config
    if (appConfig?.skills?.community) {
      setCommunityConfig({
        skillsmpApiKey: appConfig.skills.community.apiKey,
        clawhubBaseUrl: appConfig.skills.community.clawhubBaseUrl,
        skillsmpBaseUrl: appConfig.skills.community.baseUrl,
      });
    }

    // Load cron jobs from config
    if (appConfig?.cron?.jobs && Array.isArray(appConfig.cron.jobs)) {
      this.cronJobs = appConfig.cron.jobs;
    }

    // Load skill overrides from config
    if (appConfig?.skills?.overrides && typeof appConfig.skills.overrides === 'object') {
      this.skillOverrides = appConfig.skills.overrides;
      this.aiRuntime.setSkillConfigs(this.skillOverrides);
    }
  }

  // -----------------------------------------------------------------------
  // Config persistence helpers
  // -----------------------------------------------------------------------

  private persistCronJobs(): void {
    if (!this.appConfig) return;
    if (!this.appConfig.cron) this.appConfig.cron = {};
    // Strip runtime-only fields before persisting
    this.appConfig.cron.jobs = this.cronJobs.map((j: any) => ({
      id: j.id,
      schedule: j.schedule,
      agentId: j.agentId,
      message: j.message,
      enabled: j.enabled,
      createdAt: j.createdAt,
    }));
    try {
      const { saveAppConfig } = require('../config/index');
      saveAppConfig(this.appConfig);
    } catch (err: any) {
      console.warn(`[Config] Cron jobs save failed: ${err.message}`);
    }
  }

  private persistSkillOverrides(): void {
    if (!this.appConfig) return;
    if (!this.appConfig.skills) this.appConfig.skills = {};
    this.appConfig.skills.overrides = this.skillOverrides;
    try {
      const { saveAppConfig } = require('../config/index');
      saveAppConfig(this.appConfig);
    } catch (err: any) {
      console.warn(`[Config] Skill overrides save failed: ${err.message}`);
    }
  }

  /**
   * Apply runtime config changes to live subsystems after PUT /api/config.
   * Only touches subsystems whose config sections were actually changed.
   */
  private applyRuntimeConfigChanges(incoming: any): void {
    // 1. PolicyEngine: tools.requireApproval, tools.denylist
    if (incoming.tools && this.policyEngine) {
      const toolsCfg = this.appConfig.tools;
      this.policyEngine.updateGlobalPolicy({
        requireApproval: toolsCfg.requireApproval ?? [],
        denylist: toolsCfg.denylist ?? [],
        allowlist: toolsCfg.allowlist ?? [],
      });
      console.log(`[Config] PolicyEngine updated: requireApproval=[${toolsCfg.requireApproval?.join(', ') ?? ''}]`);
    }

    // 2. Logging level
    if (incoming.logLevel || incoming.logging?.level) {
      const newLevel = this.appConfig.logLevel || this.appConfig.logging?.level || 'info';
      process.env.LOG_LEVEL = newLevel;
      console.log(`[Config] Log level updated to: ${newLevel}`);
    }

    // 3. Model defaults: validate agents.defaults.model.primary is available
    if (incoming.agents?.defaults?.model?.primary) {
      const modelManager = this.aiRuntime.getModelManager();
      const primary = this.appConfig.agents.defaults.model.primary;
      const configured = modelManager.getConfiguredModels();
      if (!configured.includes(primary) && !modelManager.getSupportedModels().includes(primary)) {
        console.warn(`[Config] Warning: agents.defaults.model.primary '${primary}' is not a configured model`);
      }
    }

    // 4. Channel defaults
    if (incoming.channels?.defaults && this.channelManager) {
      // ChannelManager reads from appConfig at runtime, so the merged value is already effective
      console.log('[Config] Channel defaults updated');
    }

    // 5. Skill overrides from config
    if (incoming.skills?.overrides) {
      this.skillOverrides = { ...this.skillOverrides, ...incoming.skills.overrides };
      this.aiRuntime.setSkillConfigs(this.skillOverrides);
      console.log('[Config] Skill overrides applied');
    }

    // 6. Gateway port/host changes require restart — warn user
    if (incoming.gateway?.port || incoming.gateway?.host) {
      console.log('[Config] Gateway port/host changed — restart required to take effect');
    }
  }

  // -----------------------------------------------------------------------
  // Control UI asset resolution (OpenClaw: resolveControlUiRootSync)
  // -----------------------------------------------------------------------

  /**
   * Resolve the Control UI static assets directory.
   * Candidate paths (in priority order):
   *   1. appConfig.gateway.controlUi.root (explicit override)
   *   2. dist/control-ui/ (unified build — same dir as compiled backend)
   *   3. frontend/dist/ (legacy dev layout)
   */
  private resolveControlUiRoot(): string | null {
    // Check config override
    const configRoot = this.appConfig?.gateway?.controlUi?.root;
    if (configRoot && fs.existsSync(path.join(configRoot, 'index.html'))) {
      return configRoot;
    }

    // Candidate 1: dist/control-ui/ relative to compiled output (__dirname = dist/api/)
    const unifiedRoot = path.join(__dirname, '..', 'control-ui');
    if (fs.existsSync(path.join(unifiedRoot, 'index.html'))) {
      return unifiedRoot;
    }

    // Candidate 2: frontend/dist/ relative to project root (legacy dev layout)
    const legacyRoot = path.join(__dirname, '..', '..', 'frontend', 'dist');
    if (fs.existsSync(path.join(legacyRoot, 'index.html'))) {
      return legacyRoot;
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Middleware
  // -----------------------------------------------------------------------

  private setupMiddleware(): void {
      this.app.use(helmet({
        contentSecurityPolicy: false, // Allow inline scripts for dev
      }));
      this.app.use(cors());
      this.app.use(express.json());

      // Serve Control UI static files (single-process deployment).
      // Priority: dist/control-ui/ (unified build) → frontend/dist/ (legacy dev)
      const controlUiRoot = this.resolveControlUiRoot();
      if (controlUiRoot) {
        this.controlUiRoot = controlUiRoot;
        this.app.use(express.static(controlUiRoot));
      }

      // Request logging with sensitive data masking
      this.app.use((req: Request, _res: Response, next: NextFunction) => {
        const bodyStr = req.body ? maskSensitiveData(JSON.stringify(req.body)) : '';
        const authHeader = req.headers.authorization
          ? maskSensitiveData(req.headers.authorization)
          : '';
        console.log(
          `[${new Date().toISOString()}] ${req.method} ${req.path}` +
            (bodyStr ? ` body=${bodyStr}` : '') +
            (authHeader ? ` auth=${authHeader}` : ''),
        );
        next();
      });
    }

  // -----------------------------------------------------------------------
  // Routes
  // -----------------------------------------------------------------------

  private setupRoutes(): void {
    // Health check (verifies DB + model availability)
    this.app.get('/api/health', (_req: Request, res: Response) => {
      try {
        // Quick DB check: run a trivial query
        (this.sessionManager as any).db.prepare('SELECT 1').get();
        const models = this.aiRuntime.getModelManager().getConfiguredModels();
        res.status(200).json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          db: 'connected',
          configuredModels: models.length,
        });
      } catch (err: any) {
        res.status(503).json({
          status: 'degraded',
          timestamp: new Date().toISOString(),
          error: err.message,
        });
      }
    });

    // Gateway probes (OpenClaw: /healthz, /readyz for container/systemd health checks)
    this.app.get('/healthz', (_req: Request, res: Response) => {
      res.status(200).send('ok');
    });
    this.app.get('/readyz', (_req: Request, res: Response) => {
      try {
        (this.sessionManager as any).db.prepare('SELECT 1').get();
        res.status(200).send('ok');
      } catch {
        res.status(503).send('not ready');
      }
    });

    // Chat
    this.app.post(
      '/api/chat',
      requestRateLimiter,
      inputValidationMiddleware,
      this.handleChat.bind(this),
    );

    // Sessions
    this.app.get('/api/sessions', this.handleListSessions.bind(this));
    this.app.post('/api/sessions', this.handleCreateSession.bind(this));
    this.app.get('/api/sessions/:id', this.handleGetSession.bind(this));
    this.app.post('/api/sessions/:id/compact', this.handleCompactSession.bind(this));
    this.app.delete('/api/sessions/:id', this.handleDeleteSession.bind(this));

    // Audit logs
    this.app.get('/api/audit-logs', this.handleGetAuditLogs.bind(this));

    // Channels status
    this.app.get('/api/channels', this.handleGetChannels.bind(this));

    // Fix #5/#6: Channel reconnect and disconnect endpoints
    this.app.post('/api/channels/:type/reconnect', async (req: Request, res: Response) => {
      if (!this.channelManager) {
        res.status(404).json({ error: 'No channel manager configured' });
        return;
      }
      const channelType = req.params.type as string;
      const channel = this.channelManager.getChannel(channelType);
      if (!channel) {
        res.status(404).json({ error: `Channel '${channelType}' not found` });
        return;
      }
      try {
        await this.channelManager.reconnectChannel(channelType);
        res.status(200).json({ ok: true, type: channelType, status: channel.getStatus().status });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/channels/:type/disconnect', async (req: Request, res: Response) => {
      if (!this.channelManager) {
        res.status(404).json({ error: 'No channel manager configured' });
        return;
      }
      const channelType = req.params.type as string;
      const channel = this.channelManager.getChannel(channelType);
      if (!channel) {
        res.status(404).json({ error: `Channel '${channelType}' not found` });
        return;
      }
      try {
        await channel.disconnect();
        res.status(200).json({ ok: true, type: channelType, status: 'disconnected' });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Available channel types with config requirements
    this.app.get('/api/channels/available', (_req: Request, res: Response) => {
      // Static field definitions per channel type
      const channelFields: Record<string, { key: string; label: string; type: string; required: boolean; envVar?: string; description?: string }[]> = {
        telegram: [
          { key: 'token', label: 'Bot Token', type: 'password', required: true, envVar: 'TELEGRAM_BOT_TOKEN', description: '从 @BotFather 获取' },
          { key: 'allowedChats', label: '允许的 Chat ID', type: 'array', required: false, envVar: 'TELEGRAM_ALLOWED_CHATS', description: '逗号分隔，留空允许所有' },
        ],
        discord: [
          { key: 'token', label: 'Bot Token', type: 'password', required: true, envVar: 'DISCORD_BOT_TOKEN', description: '从 Discord Developer Portal 获取' },
          { key: 'guilds', label: '允许的 Guild ID', type: 'array', required: false, envVar: 'DISCORD_ALLOWED_GUILDS', description: '逗号分隔，留空允许所有' },
        ],
        slack: [
          { key: 'token', label: 'Bot Token', type: 'password', required: true, envVar: 'SLACK_BOT_TOKEN', description: 'xoxb- 开头的 Bot Token' },
          { key: 'signingSecret', label: 'Signing Secret', type: 'password', required: true, envVar: 'SLACK_SIGNING_SECRET', description: 'App 签名密钥' },
          { key: 'appToken', label: 'App Token', type: 'password', required: false, envVar: 'SLACK_APP_TOKEN', description: 'Socket Mode 用的 xapp- Token' },
        ],
        signal: [{ key: 'enabled', label: '启用', type: 'boolean', required: false }],
        whatsapp: [{ key: 'enabled', label: '启用', type: 'boolean', required: false }],
      };

      // Build available list — prefer plugin meta when registered, fallback to static
      const staticChannels = [
        { type: 'telegram', label: 'Telegram', icon: '✈️', blurb: 'simplest way to get started', order: 1 },
        { type: 'discord', label: 'Discord', icon: '🎮', blurb: 'Discord server integration', order: 2 },
        { type: 'slack', label: 'Slack', icon: '💼', blurb: 'Slack workspace integration', order: 3 },
        { type: 'signal', label: 'Signal', icon: '🔒', blurb: 'Signal private messaging', order: 4 },
        { type: 'whatsapp', label: 'WhatsApp', icon: '📱', blurb: 'WhatsApp Business API', order: 5 },
      ];

      const registered = this.channelManager?.getRegisteredTypes() ?? [];
      const result = staticChannels.map(sc => {
        const plugin = this.channelManager?.getChannel(sc.type);
        const meta = plugin?.meta;
        return {
          type: sc.type,
          label: meta?.label ?? sc.label,
          icon: meta?.icon ?? sc.icon,
          blurb: meta?.blurb ?? sc.blurb,
          order: meta?.order ?? sc.order,
          fields: channelFields[sc.type] ?? [],
          capabilities: plugin?.capabilities ?? null,
          registered: registered.includes(sc.type),
          status: plugin?.getStatus()?.status ?? 'disconnected',
          configuredViaEnv: this.hasChannelEnvVars(sc.type),
        };
      }).sort((a, b) => a.order - b.order);

      res.status(200).json(result);
    });

    // Runtime snapshot — detailed account-level status for all channels
    this.app.get('/api/channels/snapshot', (_req: Request, res: Response) => {
      if (!this.channelManager) {
        res.status(200).json({ channels: [], timestamp: Date.now() });
        return;
      }
      res.status(200).json(this.channelManager.getRuntimeSnapshot());
    });

    // Get channel config
    this.app.get('/api/channels/:type/config', (req: Request, res: Response) => {
      const channelType = req.params.type as string;
      const channelCfg = (this.appConfig?.channels as any)?.[channelType];
      if (!channelCfg) {
        res.status(200).json({ type: channelType, config: {} });
        return;
      }
      // Mask tokens/secrets
      const safe = { ...channelCfg };
      for (const key of ['token', 'signingSecret', 'appToken']) {
        if (safe[key] && typeof safe[key] === 'string') {
          safe[key] = '••••' + (safe[key] as string).slice(-4);
        }
      }
      res.status(200).json({ type: channelType, config: safe });
    });

    // Get channel config (raw / unmasked) — for "reveal" toggle in UI
    this.app.get('/api/channels/:type/config/raw', (req: Request, res: Response) => {
      const channelType = req.params.type as string;
      const channelCfg = (this.appConfig?.channels as any)?.[channelType];
      if (!channelCfg) {
        res.status(200).json({ type: channelType, config: {} });
        return;
      }
      // Return as-is (no masking) — UI uses this for the "show password" toggle
      res.status(200).json({ type: channelType, config: { ...channelCfg } });
    });

    // Save channel config and optionally connect
    this.app.put('/api/channels/:type/config', async (req: Request, res: Response) => {
      const channelType = req.params.type as string;
      const { config: channelCfg, connect: shouldConnect } = req.body;

      if (!channelCfg || typeof channelCfg !== 'object') {
        res.status(400).json({ error: 'config object required' });
        return;
      }

      // Save to appConfig.channels
      if (!this.appConfig) {
        res.status(500).json({ error: 'No app config loaded' });
        return;
      }
      if (!this.appConfig.channels) this.appConfig.channels = {};
      // Merge with existing config so omitted fields (user didn't edit masked values) are preserved
      const existing = (this.appConfig.channels as any)[channelType] ?? {};
      (this.appConfig.channels as any)[channelType] = { ...existing, ...channelCfg, enabled: true };

      // Set env vars for channel tokens so channel constructors can pick them up
      this.applyChannelEnvVars(channelType, channelCfg);

      // Persist config to disk
      try {
        const { saveAppConfig } = require('../config/index');
        saveAppConfig(this.appConfig);
      } catch (err: any) {
        console.warn(`[Config] Channel config save failed: ${err.message}`);
      }

      // Dynamically register and connect the channel if requested
      if (shouldConnect && this.channelManager) {
        try {
          // If already registered, reconnect
          const existing = this.channelManager.getChannel(channelType);
          if (existing) {
            await this.channelManager.reconnectChannel(channelType);
          } else {
            // Create and register new channel
            const channel = this.createChannelFromConfig(channelType, channelCfg);
            if (channel) {
              this.channelManager.register(channel);
              await this.channelManager.reconnectChannel(channelType);
            }
          }
          const status = this.channelManager.getChannel(channelType)?.getStatus();
          res.status(200).json({ ok: true, type: channelType, status: status?.status ?? 'unknown' });
          return;
        } catch (err: any) {
          res.status(200).json({ ok: true, type: channelType, saved: true, connectError: err.message });
          return;
        }
      }

      res.status(200).json({ ok: true, type: channelType, saved: true });
    });

    // Delete channel config
    this.app.delete('/api/channels/:type/config', async (req: Request, res: Response) => {
      const channelType = req.params.type as string;

      // Disconnect if connected
      if (this.channelManager) {
        const channel = this.channelManager.getChannel(channelType);
        if (channel) {
          try { await channel.disconnect(); } catch { /* ignore */ }
        }
      }

      // Remove from config
      if (this.appConfig?.channels) {
        delete (this.appConfig.channels as any)[channelType];
      }

      // Cascade: remove bindings that reference this channel
      let bindingsRemoved = 0;
      if (this.appConfig?.bindings && Array.isArray(this.appConfig.bindings)) {
        const before = this.appConfig.bindings.length;
        this.appConfig.bindings = this.appConfig.bindings.filter(
          (b: any) => b.match?.channel !== channelType
        );
        bindingsRemoved = before - this.appConfig.bindings.length;
      }
      // Also clean agent-level bindings referencing this channel
      const allAgents = await this.agentManager.listAgents();
      for (const agent of allAgents) {
        if (agent.bindings && Array.isArray(agent.bindings)) {
          const origLen = agent.bindings.length;
          agent.bindings = (agent.bindings as any[]).filter(
            (b: any) => b.match?.channel !== channelType
          );
          if (agent.bindings.length < origLen) {
            await this.agentManager.updateAgent(agent.id, { bindings: agent.bindings });
            bindingsRemoved += origLen - agent.bindings.length;
          }
        }
      }

      // Rebuild ChannelManager bindings
      if (this.channelManager) {
        const merged: any[] = [...((this.appConfig as any)?.bindings ?? [])];
        for (const a of await this.agentManager.listAgents()) {
          if (a.bindings) {
            for (const b of a.bindings as any[]) {
              merged.push({ agentId: a.id, match: b.match });
            }
          }
        }
        this.channelManager.setBindings(merged);
      }

      // Persist
      try {
        const { saveAppConfig } = require('../config/index');
        saveAppConfig(this.appConfig);
      } catch { /* ignore */ }

      res.status(200).json({ ok: true, type: channelType, removed: true, bindingsRemoved });
    });

    // ----- Pairing & AllowFrom endpoints (design doc §设备管理) -----

    // List pairing requests for a channel
    this.app.get('/api/pairing/requests', (req: Request, res: Response) => {
      const channel = req.query.channel as string;
      const accountId = (req.query.accountId as string) || 'default';
      if (!channel) {
        // Return all channels' requests
        const allTypes = this.channelManager?.getRegisteredTypes() ?? [];
        const result: Record<string, any[]> = {};
        for (const ch of allTypes) {
          const requests = listPairingRequests({ channel: ch, accountId });
          if (requests.length > 0) result[ch] = requests;
        }
        res.status(200).json(result);
        return;
      }
      res.status(200).json(listPairingRequests({ channel, accountId }));
    });

    // Approve a pairing code
    this.app.post('/api/pairing/approve', (req: Request, res: Response) => {
      const { channel, code, accountId } = req.body;
      if (!channel || !code) {
        res.status(400).json({ error: 'channel and code are required' });
        return;
      }
      const result = approveChannelPairingCode({ channel, code, accountId });
      if (!result.approved) {
        res.status(404).json({ error: 'Pairing code not found or expired' });
        return;
      }
      res.status(200).json({ ok: true, approved: true, senderId: result.id });
    });

    // Get AllowFrom list for a channel
    this.app.get('/api/channels/:type/allow-from', (req: Request, res: Response) => {
      const channel = req.params.type as string;
      const accountId = (req.query.accountId as string) || 'default';
      const entries = readAllowFrom({ channel, accountId });
      // Also include config-level allowFrom
      const plugin = this.channelManager?.getChannel(channel);
      const configEntries = plugin?.security?.allowFrom ?? [];
      res.status(200).json({
        channel,
        accountId,
        store: entries,
        config: configEntries,
        merged: [...new Set([...configEntries, ...entries])],
      });
    });

    // Add to AllowFrom
    this.app.post('/api/channels/:type/allow-from', (req: Request, res: Response) => {
      const channel = req.params.type as string;
      const { entry, accountId } = req.body;
      if (!entry) {
        res.status(400).json({ error: 'entry (sender ID) is required' });
        return;
      }
      addAllowFromEntry({ channel, entry: String(entry), accountId });
      res.status(200).json({ ok: true, channel, entry });
    });

    // Remove from AllowFrom
    this.app.delete('/api/channels/:type/allow-from', (req: Request, res: Response) => {
      const channel = req.params.type as string;
      const { entry, accountId } = req.body;
      if (!entry) {
        res.status(400).json({ error: 'entry (sender ID) is required' });
        return;
      }
      const removed = removeAllowFromEntry({ channel, entry: String(entry), accountId });
      if (!removed) {
        res.status(404).json({ error: 'Entry not found in AllowFrom list' });
        return;
      }
      res.status(200).json({ ok: true, channel, entry, removed: true });
    });

    // Get DM security policy for a channel
    this.app.get('/api/channels/:type/security', (req: Request, res: Response) => {
      const channel = req.params.type as string;
      const plugin = this.channelManager?.getChannel(channel);
      if (!plugin) {
        res.status(404).json({ error: `Channel '${channel}' not found` });
        return;
      }
      const security = plugin.security;
      res.status(200).json({
        channel,
        dmPolicy: security?.dmPolicy ?? 'open',
        allowFrom: security?.allowFrom ?? [],
      });
    });

    // Plugins
    this.app.get('/api/plugins', this.handleGetPlugins.bind(this));

    // ----- Model catalog endpoints -----
    this.app.get('/api/models', (_req: Request, res: Response) => {
      const modelManager = this.aiRuntime.getModelManager();
      res.status(200).json(modelManager.getModelCatalog());
    });

    this.app.get('/api/models/configured', (_req: Request, res: Response) => {
      const modelManager = this.aiRuntime.getModelManager();
      res.status(200).json(modelManager.getConfiguredCatalog());
    });

    this.app.get('/api/models/providers', (_req: Request, res: Response) => {
      const modelManager = this.aiRuntime.getModelManager();
      res.status(200).json(modelManager.getProviderStatus());
    });

    // Add a custom model provider at runtime + persist to config.json5
    this.app.post('/api/models/providers', (req: Request, res: Response) => {
      try {
        const { providerId, apiKey, baseUrl, api, models } = req.body;
        if (!providerId || typeof providerId !== 'string') {
          res.status(400).json({ error: 'providerId is required' });
          return;
        }
        const modelManager = this.aiRuntime.getModelManager();

        // Register provider with API key
        if (apiKey) {
          modelManager.registerProvider(providerId, apiKey, baseUrl);
        }

        // Register individual models
        const registered: string[] = [];
        if (Array.isArray(models)) {
          for (const m of models) {
            if (!m.id) continue;
            modelManager.registerModel({
              provider: providerId,
              modelId: m.id,
              name: m.name ?? m.id,
              api: api ?? 'openai-completions',
              reasoning: m.reasoning ?? false,
              input: ['text'],
              contextWindow: m.contextWindow ?? 128_000,
              defaultMaxTokens: m.maxTokens ?? 4096,
              defaultTemperature: 0.7,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            }, apiKey);
            // Patch baseUrl if provided
            if (baseUrl) {
              const ref = `${providerId}/${m.id}`;
              try {
                const cfg = modelManager.getConfig(ref);
                if (cfg) cfg.baseUrl = baseUrl;
              } catch { /* model may not have been registered if no key */ }
            }
            registered.push(`${providerId}/${m.id}`);
          }
        }

        // Update middleware allowed models
        const { setAllowedModels } = require('./middleware');
        const allModels = [...new Set([...modelManager.getSupportedModels(), ...modelManager.getConfiguredModels()])];
        setAllowedModels(allModels);

        // Persist to config.json5
        let savedTo: string | undefined;
        try {
          if (!this.appConfig.models) {
            this.appConfig.models = {};
          }
          if (!this.appConfig.models.providers) {
            this.appConfig.models.providers = {};
          }
          // Build provider config entry
          const provEntry: any = {};
          if (apiKey) provEntry.apiKey = apiKey;
          if (baseUrl) provEntry.baseUrl = baseUrl;
          if (api) provEntry.api = api;
          if (Array.isArray(models) && models.length > 0) {
            provEntry.models = models.filter((m: any) => m.id).map((m: any) => ({
              id: m.id,
              name: m.name || m.id,
              ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
              ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
              ...(m.reasoning ? { reasoning: true } : {}),
            }));
          }
          this.appConfig.models.providers[providerId] = provEntry;

          const { saveAppConfig } = require('../config/index');
          savedTo = saveAppConfig(this.appConfig);
        } catch (err: any) {
          console.warn(`[Config] Model provider save failed: ${err.message}`);
        }

        res.status(200).json({
          ok: true,
          providerId,
          registeredModels: registered,
          totalConfigured: modelManager.getConfiguredModels().length,
          savedTo,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // System status
    this.app.get('/api/status', this.handleGetStatus.bind(this));

    // Logs endpoint (returns recent audit log entries as generic log entries)
    this.app.get('/api/logs', (_req: Request, res: Response) => {
      const entries = this.auditLogger?.getAll?.() ?? [];
      const logs = entries.slice(0, 200).map((e: any, i: number) => ({
        id: `log-${i}`,
        timestamp: e.timestamp,
        level: e.status === 'error' ? 'error' : e.status === 'blocked' ? 'warn' : 'info',
        subsystem: 'tool',
        message: `${e.toolName} → ${e.status}${e.error ? ': ' + e.error : ''}`,
      }));
      res.status(200).json(logs);
    });

    // Debug RPC endpoint
    this.app.post('/api/rpc/:method', (req: Request, res: Response) => {
      const method = req.params.method;
      if (method === 'system.status' || method === 'system-presence') {
        res.status(200).json({
          status: 'ok',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(404).json({ error: `Unknown RPC method: ${method}` });
      }
    });

    // ----- Skills endpoints -----
    this.app.get('/api/skills/status', async (_req: Request, res: Response) => {
      try {
        // Fix #1: Pass skillOverrides so enable/disable state is reflected in status
        const reports = await getSkillStatusReports(undefined, this.skillOverrides);
        res.status(200).json(reports);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Skills update (enable/disable, API key)
    this.app.put('/api/skills/:name', async (req: Request, res: Response) => {
      const { enabled, apiKey } = req.body;
      const name = req.params.name as string;
      // Store skill overrides in memory (persisted via config in production)
      if (!this.skillOverrides) this.skillOverrides = {};
      this.skillOverrides[name] = { ...this.skillOverrides[name], enabled, apiKey };

      // Fix #4: If apiKey provided, look up the skill's actual requires.env vars
      // and set those specific env vars (instead of generating from skill name)
      if (apiKey && typeof apiKey === 'string') {
        try {
          const reports = await getSkillStatusReports(undefined, this.skillOverrides);
          const skillReport = reports.find(r => r.name === name);
          const requiredEnvVars = skillReport?.requirements?.env;
          if (requiredEnvVars && requiredEnvVars.length > 0) {
            // Set the actual env vars the skill expects
            for (const envVar of requiredEnvVars) {
              process.env[envVar] = apiKey;
            }
          } else {
            // Fallback: store in skillOverrides.env for evaluateEligibility to pick up
            this.skillOverrides[name].env = this.skillOverrides[name].env ?? {};
          }
        } catch {
          // Fallback: use generated env key if status lookup fails
          const envKey = name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY';
          process.env[envKey] = apiKey;
        }
      }

      // Fix #3: Invalidate system prompt cache so skill changes take effect
      // Also sync full skillOverrides to runtime so resolveSkillsSnapshot uses them
      this.aiRuntime.setSkillConfigs(this.skillOverrides);

      // Persist to config.json5
      this.persistSkillOverrides();

      res.status(200).json({ ok: true, skill: name, enabled, apiKeySet: !!apiKey });
    });

    // Skills install (placeholder — logs and returns success)
    this.app.post('/api/skills/:name/install', (req: Request, res: Response) => {
      const name = req.params.name as string;
      const { installId } = req.body;
      console.log(`[${new Date().toISOString()}] Skill install requested: ${name} (${installId || 'default'})`);
      res.status(200).json({ ok: true, message: `Install initiated for ${name}` });
    });

    // ----- Community Skills endpoints (ClawHub default + SkillsMP optional) -----
    // NOTE: Specific routes must come before parameterized :slug routes

    // Community config (SkillsMP API key)
    this.app.get('/api/skills/community/config', (_req: Request, res: Response) => {
      const cfg = this.appConfig?.skills?.community || {};
      res.status(200).json({
        skillsmpKeySet: !!(cfg.apiKey || process.env.SKILLSMP_API_KEY),
        defaultSource: 'clawhub',
      });
    });

    this.app.put('/api/skills/community/config', (req: Request, res: Response) => {
      const { apiKey } = req.body;
      setCommunityConfig({ skillsmpApiKey: apiKey });
      if (this.appConfig) {
        if (!this.appConfig.skills) this.appConfig.skills = {};
        if (!this.appConfig.skills.community) this.appConfig.skills.community = {};
        this.appConfig.skills.community.apiKey = apiKey;
        try {
          const { saveAppConfig } = require('../config/index');
          saveAppConfig(this.appConfig);
        } catch { /* ignore */ }
      }
      res.status(200).json({ ok: true, apiKeySet: !!apiKey });
    });

    // Hot/popular skills (ClawHub, no query needed)
    this.app.get('/api/skills/community/hot', async (req: Request, res: Response) => {
      try {
        const sort = (req.query.sort as string) === 'stars' ? 'stars' : 'downloads';
        const limit = Math.min(parseInt(req.query.limit as string) || 12, 50);
        const results = await getHotSkills(sort as any, limit);
        res.status(200).json({ results, total: results.length });
      } catch (err: any) {
        res.status(502).json({ error: `获取热门技能失败: ${err.message}` });
      }
    });

    // Keyword search
    this.app.get('/api/skills/community/search', async (req: Request, res: Response) => {
      try {
        const q = (req.query.q as string) || '';
        const source = ((req.query.source as string) || 'clawhub') as CommunitySource;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
        if (!q.trim()) {
          res.status(400).json({ error: '搜索关键词不能为空' });
          return;
        }
        const data = await searchCommunitySkills(q, source, { limit });
        res.status(200).json(data);
      } catch (err: any) {
        res.status(502).json({ error: `社区搜索失败: ${err.message}` });
      }
    });

    // AI semantic search (SkillsMP only, needs API key)
    this.app.post('/api/skills/community/ai-search', async (req: Request, res: Response) => {
      try {
        const { query, limit } = req.body;
        if (!query || !query.trim()) {
          res.status(400).json({ error: '搜索内容不能为空' });
          return;
        }
        const data = await aiSearchCommunitySkills(query, 'skillsmp', Math.min(limit || 20, 50));
        res.status(200).json(data);
      } catch (err: any) {
        res.status(502).json({ error: `AI 搜索失败: ${err.message}` });
      }
    });

    // Skill detail
    this.app.get('/api/skills/community/:slug', async (req: Request, res: Response) => {
      try {
        const slug = req.params.slug as string;
        const source = ((req.query.source as string) || 'clawhub') as CommunitySource;
        const detail = await getCommunitySkillDetail(slug, source);
        res.status(200).json(detail);
      } catch (err: any) {
        res.status(502).json({ error: `获取技能详情失败: ${err.message}` });
      }
    });

    // Install skill
    this.app.post('/api/skills/community/:slug/install', async (req: Request, res: Response) => {
      try {
        const slug = req.params.slug as string;
        const { targetDir, source } = req.body;
        const result = await installCommunitySkill(slug, source || 'clawhub', targetDir);
        if (!result.ok) {
          res.status(500).json(result);
          return;
        }
        // Invalidate system prompt cache so new skill takes effect
        this.aiRuntime.setSkillConfigs(this.skillOverrides || {});
        res.status(200).json(result);
      } catch (err: any) {
        res.status(502).json({ error: `安装失败: ${err.message}` });
      }
    });

    // ----- Tool catalog endpoints -----
    this.app.get('/api/tools/catalog', (_req: Request, res: Response) => {
      res.status(200).json(getToolCatalog());
    });

    this.app.get('/api/tools/profile/:profile', (req: Request, res: Response) => {
      const profile = req.params.profile as ToolProfile;
      const tools = getToolsForProfile(profile);
      res.status(200).json({ profile, tools });
    });

    // ----- Agents endpoints -----
    this.app.get('/api/agents', async (_req: Request, res: Response) => {
      try {
        const agents = await this.agentManager.listAgents();
        res.status(200).json(agents);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/agents', async (req: Request, res: Response) => {
      try {
        const { id, name, description, model, toolProfile, tools, skillFilter } = req.body;
        if (!id || typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
          res.status(400).json({ error: 'id is required and must be lowercase alphanumeric with hyphens/underscores' });
          return;
        }
        const existing = await this.agentManager.getAgent(id);
        if (existing) {
          res.status(409).json({ error: `Agent '${id}' already exists` });
          return;
        }

        // Validate model availability if specified
        if (model?.primary) {
          const modelManager = this.aiRuntime.getModelManager();
          const configured = modelManager.getConfiguredModels();
          const supported = modelManager.getSupportedModels();
          const allKnown = new Set([...configured, ...supported]);
          if (!allKnown.has(model.primary)) {
            res.status(400).json({
              error: `Model '${model.primary}' is not available. Configured: ${configured.join(', ') || '(none)'}`,
            });
            return;
          }
        }

        const agent = await this.agentManager.createAgent({
          id, name: name || id, description, model, toolProfile, tools, skillFilter,
        });
        res.status(201).json(agent);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/agents/:id', async (req: Request, res: Response) => {
      try {
        const agent = await this.agentManager.getAgent(req.params.id as string);
        if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
        res.status(200).json(agent);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.put('/api/agents/:id', async (req: Request, res: Response) => {
      try {
        // Validate model availability if being changed
        if (req.body.model?.primary) {
          const modelManager = this.aiRuntime.getModelManager();
          const configured = modelManager.getConfiguredModels();
          const supported = modelManager.getSupportedModels();
          const allKnown = new Set([...configured, ...supported]);
          if (!allKnown.has(req.body.model.primary)) {
            res.status(400).json({
              error: `Model '${req.body.model.primary}' is not available. Configured: ${configured.join(', ') || '(none)'}`,
            });
            return;
          }
        }
        const updated = await this.agentManager.updateAgent(req.params.id as string, req.body);
        if (!updated) { res.status(404).json({ error: 'Agent not found' }); return; }
        res.status(200).json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.delete('/api/agents/:id', async (req: Request, res: Response) => {
      try {
        const agentId = req.params.id as string;
        const deleted = await this.agentManager.deleteAgent(agentId);
        if (!deleted) {
          res.status(400).json({ error: 'Cannot delete this agent (default agent or not found)' });
          return;
        }

        // Cascade: reassign cron jobs referencing this agent to 'default'
        let cronUpdated = 0;
        for (const job of this.cronJobs) {
          if (job.agentId === agentId) {
            job.agentId = 'default';
            cronUpdated++;
          }
        }
        if (cronUpdated > 0) this.persistCronJobs();

        // Cascade: remove bindings referencing this agent from appConfig
        if (this.appConfig?.bindings && Array.isArray(this.appConfig.bindings)) {
          const before = this.appConfig.bindings.length;
          this.appConfig.bindings = this.appConfig.bindings.filter((b: any) => b.agentId !== agentId);
          if (this.appConfig.bindings.length < before) {
            try {
              const { saveAppConfig } = require('../config/index');
              saveAppConfig(this.appConfig);
            } catch { /* ignore */ }
          }
        }

        // Rebuild ChannelManager bindings
        if (this.channelManager) {
          const allAgents = await this.agentManager.listAgents();
          const merged: any[] = [...((this.appConfig as any)?.bindings ?? [])];
          for (const a of allAgents) {
            if (a.bindings) {
              for (const b of a.bindings as any[]) {
                merged.push({ agentId: a.id, match: b.match });
              }
            }
          }
          this.channelManager.setBindings(merged);
        }

        res.status(200).json({ ok: true, cascaded: { cronJobsReassigned: cronUpdated } });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/agents/:id/files', async (req: Request, res: Response) => {
      try {
        const files = await this.agentManager.listFiles(req.params.id as string);
        res.status(200).json(files);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/agents/:id/files/:filename', async (req: Request, res: Response) => {
      try {
        const content = await this.agentManager.getFile(req.params.id as string, req.params.filename as string);
        if (content === null) { res.status(404).json({ error: 'File not found' }); return; }
        res.status(200).json({ filename: req.params.filename, content });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.put('/api/agents/:id/files/:filename', async (req: Request, res: Response) => {
      try {
        const { content } = req.body;
        if (typeof content !== 'string') { res.status(400).json({ error: 'content required' }); return; }
        await this.agentManager.setFile(req.params.id as string, req.params.filename as string, content);
        res.status(200).json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/agents/:id/identity', async (req: Request, res: Response) => {
      try {
        const identity = await this.agentManager.getIdentity(req.params.id as string);
        if (!identity) { res.status(404).json({ error: 'Agent not found' }); return; }
        res.status(200).json(identity);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Agent bindings CRUD
    this.app.get('/api/agents/:id/bindings', async (req: Request, res: Response) => {
      try {
        const agent = await this.agentManager.getAgent(req.params.id as string);
        if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
        res.status(200).json(agent.bindings ?? []);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.put('/api/agents/:id/bindings', async (req: Request, res: Response) => {
      try {
        const { bindings } = req.body;
        if (!Array.isArray(bindings)) {
          res.status(400).json({ error: 'bindings must be an array' });
          return;
        }
        const updated = await this.agentManager.updateAgent(req.params.id as string, { bindings });
        if (!updated) { res.status(404).json({ error: 'Agent not found' }); return; }

        // Rebuild merged bindings and push to ChannelManager
        if (this.channelManager) {
          const allAgents = await this.agentManager.listAgents();
          const merged: any[] = [...((this.appConfig as any)?.bindings ?? [])];
          for (const a of allAgents) {
            if (a.bindings) {
              for (const b of a.bindings) {
                merged.push({ agentId: a.id, match: b.match });
              }
            }
          }
          this.channelManager.setBindings(merged);
        }

        res.status(200).json({ ok: true, bindings: updated.bindings });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Lane stats endpoint (concurrency monitoring)
    this.app.get('/api/lanes', (_req: Request, res: Response) => {
      try {
        const { getLaneStats } = require('../channels/CommandLane');
        res.status(200).json(getLaneStats());
      } catch {
        res.status(200).json({});
      }
    });

    // Subagent registry endpoints
    this.app.get('/api/subagents', (_req: Request, res: Response) => {
      try {
        const { getSubagentStats } = require('../agents/SubagentRegistry');
        res.status(200).json(getSubagentStats());
      } catch {
        res.status(200).json({ total: 0, running: 0, completed: 0, failed: 0 });
      }
    });

    this.app.get('/api/subagents/runs', (req: Request, res: Response) => {
      try {
        const { listDescendantRunsForRequester } = require('../agents/SubagentRegistry');
        const sessionKey = req.query.sessionKey as string;
        if (!sessionKey) {
          res.status(400).json({ error: 'sessionKey query parameter required' });
          return;
        }
        res.status(200).json(listDescendantRunsForRequester(sessionKey));
      } catch {
        res.status(200).json([]);
      }
    });

    this.app.post('/api/subagents/archive', (_req: Request, res: Response) => {
      try {
        const { archiveStaleRuns } = require('../agents/SubagentRegistry');
        const archived = archiveStaleRuns();
        res.status(200).json({ archived });
      } catch {
        res.status(200).json({ archived: 0 });
      }
    });

    // ----- Usage / Token stats endpoints -----
    this.app.get('/api/usage', (_req: Request, res: Response) => {
      try {
        // Aggregate token usage from sessions table
        const row = (this.sessionManager as any).db.prepare(`
          SELECT COUNT(*) as cnt, COALESCE(SUM(json_extract(metadata, '$.totalTokens')), 0) as tokens
          FROM sessions
        `).get() as any;
        res.status(200).json({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: row?.tokens ?? 0,
          cost: 0,
          sessions: row?.cnt ?? 0,
        });
      } catch {
        res.status(200).json({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, sessions: 0 });
      }
    });

    this.app.get('/api/usage/timeseries', (_req: Request, res: Response) => {
      // Placeholder — return empty timeseries
      res.status(200).json({ data: [], period: 'day' });
    });

    // ----- Cron / Scheduled tasks endpoints -----
    this.app.get('/api/cron/status', (_req: Request, res: Response) => {
      res.status(200).json({
        enabled: false,
        running: 0,
        total: this.cronJobs.length,
        nextRunAt: null,
      });
    });

    this.app.get('/api/cron/jobs', (_req: Request, res: Response) => {
      res.status(200).json(this.cronJobs);
    });

    this.app.post('/api/cron/jobs', async (req: Request, res: Response) => {
      const { schedule, agentId, message, enabled } = req.body;
      if (!schedule || !message) {
        res.status(400).json({ error: 'schedule and message are required' });
        return;
      }
      // Validate agentId exists
      const targetAgentId = agentId || 'default';
      const agent = await this.agentManager.getAgent(targetAgentId);
      if (!agent) {
        res.status(400).json({ error: `Agent '${targetAgentId}' does not exist` });
        return;
      }
      const job = {
        id: `cron-${Date.now()}`,
        schedule,
        agentId: targetAgentId,
        message,
        enabled: enabled !== false,
        createdAt: new Date().toISOString(),
        lastRunAt: null,
        lastStatus: null,
        nextRunAt: null,
      };
      this.cronJobs.push(job);
      this.persistCronJobs();
      res.status(201).json(job);
    });

    this.app.put('/api/cron/jobs/:id', (req: Request, res: Response) => {
      const idx = this.cronJobs.findIndex((j: any) => j.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Job not found' }); return; }
      this.cronJobs[idx] = { ...this.cronJobs[idx], ...req.body, id: req.params.id };
      this.persistCronJobs();
      res.status(200).json(this.cronJobs[idx]);
    });

    this.app.delete('/api/cron/jobs/:id', (req: Request, res: Response) => {
      const idx = this.cronJobs.findIndex((j: any) => j.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Job not found' }); return; }
      this.cronJobs.splice(idx, 1);
      this.persistCronJobs();
      res.status(200).json({ ok: true });
    });

    this.app.post('/api/cron/jobs/:id/toggle', (req: Request, res: Response) => {
      const job = this.cronJobs.find((j: any) => j.id === req.params.id);
      if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
      (job as any).enabled = !(job as any).enabled;
      this.persistCronJobs();
      res.status(200).json(job);
    });

    this.app.post('/api/cron/jobs/:id/run', async (req: Request, res: Response) => {
      const job = this.cronJobs.find((j: any) => j.id === req.params.id) as any;
      if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
      try {
        const result = await this.aiRuntime.execute({
          sessionId: `cron-${job.id}-${Date.now()}`,
          message: job.message,
          model: 'gpt-3.5-turbo',
        });
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = 'success';
        res.status(200).json({ ok: true, result: result.text });
      } catch (err: any) {
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = 'error';
        res.status(500).json({ error: err.message });
      }
    });

    // ----- Config endpoints -----
    this.app.get('/api/config', (_req: Request, res: Response) => {
      if (!this.appConfig) {
        res.status(200).json({});
        return;
      }
      // Deep clone to avoid mutating the in-memory config
      const safe = JSON.parse(JSON.stringify(this.appConfig));
      // Mask API keys — show presence but not values
      if (safe.apiKeys) {
        const masked: Record<string, string> = {};
        for (const [k, v] of Object.entries(safe.apiKeys as Record<string, string | undefined>)) {
          masked[k] = v ? '••••' + v.slice(-4) : '';
        }
        safe.apiKeys = masked;
      }
      res.status(200).json(safe);
    });

    this.app.get('/api/config/schema', (_req: Request, res: Response) => {
      // Return section metadata for the frontend to render proper UI
      res.status(200).json(CONFIG_SECTION_SCHEMA);
    });

    this.app.put('/api/config', (req: Request, res: Response) => {
      if (!this.appConfig) {
        res.status(400).json({ error: 'No config loaded' });
        return;
      }
      // Deep clone incoming to avoid reference issues
      const incoming = JSON.parse(JSON.stringify(req.body));
      // Never allow overwriting apiKeys from the API
      delete incoming.apiKeys;

      // Strip masked values that the frontend may send back (they look like "••••xxxx")
      // so they don't overwrite real secrets during deepMerge
      const stripMasked = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (typeof val === 'string' && val.startsWith('••••')) {
            delete obj[key];
          } else if (val && typeof val === 'object') {
            stripMasked(val);
          }
        }
      };
      stripMasked(incoming);

      // Deep merge instead of shallow Object.assign
      const { deepMergeConfig } = require('../config/index');
      this.appConfig = deepMergeConfig(this.appConfig, incoming);

      // Apply runtime changes to live subsystems
      this.applyRuntimeConfigChanges(incoming);

      // Persist to disk
      try {
        const { saveAppConfig } = require('../config/index');
        const savedPath = saveAppConfig(this.appConfig);
        // Return safe copy (no real apiKeys)
        const safeCopy = JSON.parse(JSON.stringify(this.appConfig));
        if (safeCopy.apiKeys) {
          const masked: Record<string, string> = {};
          for (const [k, v] of Object.entries(safeCopy.apiKeys as Record<string, string | undefined>)) {
            masked[k] = v ? '••••' + v.slice(-4) : '';
          }
          safeCopy.apiKeys = masked;
        }
        res.status(200).json({ ok: true, config: safeCopy, savedTo: savedPath, needsRestart: !!(incoming.gateway?.port || incoming.gateway?.host) });
      } catch (err: any) {
        console.warn(`[Config] File save failed: ${err.message}`);
        res.status(200).json({ ok: true, config: this.appConfig, saveError: err.message });
      }
    });

    // ----- Nodes endpoints -----
    this.app.get('/api/nodes', (_req: Request, res: Response) => {
      res.status(200).json(this.nodesList);
    });

    this.app.get('/api/devices', (_req: Request, res: Response) => {
      res.status(200).json({ paired: this.devicesList, pending: this.pendingDevices });
    });

    this.app.post('/api/devices/:id/approve', (req: Request, res: Response) => {
      const idx = this.pendingDevices.findIndex((d: any) => d.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Pending device not found' }); return; }
      const device = this.pendingDevices.splice(idx, 1)[0];
      (device as any).status = 'paired';
      (device as any).pairedAt = new Date().toISOString();
      this.devicesList.push(device);
      res.status(200).json(device);
    });

    this.app.post('/api/devices/:id/reject', (req: Request, res: Response) => {
      const idx = this.pendingDevices.findIndex((d: any) => d.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Pending device not found' }); return; }
      this.pendingDevices.splice(idx, 1);
      res.status(200).json({ ok: true });
    });

    this.app.post('/api/devices/:id/revoke', (req: Request, res: Response) => {
      const idx = this.devicesList.findIndex((d: any) => d.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Device not found' }); return; }
      this.devicesList.splice(idx, 1);
      res.status(200).json({ ok: true });
    });

    // ----- Exec Approval endpoints -----
    this.app.get('/api/exec-approvals', (_req: Request, res: Response) => {
      res.status(200).json(this.execApprovalQueue);
    });

    this.app.post('/api/exec-approvals/:id/resolve', (req: Request, res: Response) => {
      const { decision } = req.body;
      if (!['allow-once', 'allow-always', 'deny'].includes(decision)) {
        res.status(400).json({ error: 'decision must be allow-once, allow-always, or deny' });
        return;
      }
      const idx = this.execApprovalQueue.findIndex((a: any) => a.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Approval request not found' }); return; }
      const approval = this.execApprovalQueue.splice(idx, 1)[0];
      // Resolve the pending approval (in a real implementation, this would resolve a Promise)
      res.status(200).json({ ok: true, decision, approval });
    });
  }

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  private async handleChat(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sessionId, message, model, tools, agentId } = req.body;

      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        res.status(400).json({ error: 'sessionId is required and must be a non-empty string' });
        return;
      }
      if (!message || typeof message !== 'string' || message.trim() === '') {
        res.status(400).json({ error: 'message is required and must be a non-empty string' });
        return;
      }
      if (!model || typeof model !== 'string' || model.trim() === '') {
        res.status(400).json({ error: 'model is required and must be a non-empty string' });
        return;
      }
      if (tools !== undefined && !Array.isArray(tools)) {
        res.status(400).json({ error: 'tools must be an array if provided' });
        return;
      }

      // Resolve agent model override: if agentId is provided and agent has a primary model, use it
      let effectiveModel = model;
      if (agentId && typeof agentId === 'string') {
        const agent = await this.agentManager.getAgent(agentId);
        if (agent?.model?.primary) {
          effectiveModel = agent.model.primary;
        }
      }

      // OpenPilot Constraint 3: Wrap untrusted user input
      const sanitizedMessage = `<user_input>${message}</user_input>`;

      // Daily token limit pre-check (avoid wasting tokens if already over limit)
      const currentUsage = getDailyTokenUsage(sessionId);
      if (currentUsage >= 100_000) {
        res.status(429).json({
          error: 'Rate limit exceeded: daily token limit of 100,000 tokens per session reached',
        });
        return;
      }

      const response = await this.aiRuntime.execute({
        sessionId,
        message: sanitizedMessage,
        model: effectiveModel,
        tools,
        agentId: agentId || undefined,
      });

      // Record token usage after execution
      if (response.usage?.totalTokens) {
        checkAndRecordTokenUsage(sessionId, response.usage.totalTokens);
      }

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/sessions?limit=&offset=
   * List sessions with pagination, ordered by updatedAt descending.
   */
  private handleListSessions(req: Request, res: Response, next: NextFunction): void {
    try {
      const limit = Math.min(Math.max(parseInt(req.query['limit'] as string) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query['offset'] as string) || 0, 0);

      const rows = (this.sessionManager as any).db.prepare(`
        SELECT id, created_at, updated_at, metadata,
               (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id) as message_count
        FROM sessions
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset) as any[];

      const sessions = rows.map((row: any) => {
        const metadata = JSON.parse(row.metadata);
        return {
          id: row.id,
          title: `Session ${row.id.slice(0, 8)}`,
          model: metadata.model || '',
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
          messageCount: row.message_count,
        };
      });

      res.status(200).json(sessions);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/sessions
   * Create a new empty session and return its summary.
   */
  private async handleCreateSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const model = (req.body?.model as string) || 'gpt-3.5-turbo';
      const session = await this.sessionManager.create(
        { model, totalTokens: 0, cost: 0 },
      );
      res.status(201).json({
        id: session.id,
        title: `Session ${session.id.slice(0, 8)}`,
        model,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        messageCount: 0,
      });
    } catch (err) {
      next(err);
    }
  }

  private async handleGetSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params['id'] as string;
      if (!id || id.trim() === '') {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }
      const session = await this.sessionManager.load(id);
      res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  }

  private async handleCompactSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params['id'] as string;
      if (!id || id.trim() === '') {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }
      await this.sessionManager.compact(id);

      // Broadcast compaction event to all connected WS clients
      if (this.wss) {
        const notification = JSON.stringify({ type: 'resource_update', sessionId: id, data: { event: 'session_compacted' } });
        this.wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(notification);
          }
        });
      }

      res.status(200).json({ success: true, message: 'Session compacted successfully' });
    } catch (err) {
      next(err);
    }
  }

  private async handleDeleteSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params['id'] as string;
      if (!id || id.trim() === '') {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }
      await this.sessionManager.delete(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/audit-logs?startTime=&endTime=&action=
   * Returns audit log entries with optional filters.
   */
  private handleGetAuditLogs(req: Request, res: Response): void {
    const startTime = req.query['startTime'] as string | undefined;
    const endTime = req.query['endTime'] as string | undefined;
    const action = req.query['action'] as string | undefined;

    const entries = this.auditLogger.query({ startTime, endTime, action });

    // Map to frontend AuditLogEntry format
    const mapped = entries.map((e, i) => ({
      id: `audit-${i}-${e.timestamp}`,
      action: e.toolName,
      operator: e.sessionId ?? 'system',
      timestamp: e.timestamp,
      details: { arguments: e.arguments, error: e.error },
      status: e.status === 'success' ? 'executed' : e.status === 'blocked' ? 'cancelled' : 'failed',
    }));

    res.status(200).json(mapped);
  }

  /**
   * GET /api/channels
   * Returns status of all registered channel plugins.
   */
  private handleGetChannels(_req: Request, res: Response): void {
    if (!this.channelManager) {
      res.status(200).json([]);
      return;
    }
    const status = this.channelManager.getStatus();
    res.status(200).json(status);
  }

  /**
   * GET /api/plugins
   * Returns status of all registered plugins.
   */
  private handleGetPlugins(_req: Request, res: Response): void {
    if (!this.pluginManager) {
      res.status(200).json([]);
      return;
    }
    res.status(200).json(this.pluginManager.getPlugins());
  }

  /**
   * GET /api/status
   * Returns overall system status.
   */
  private handleGetStatus(_req: Request, res: Response): void {
      const modelManager = this.aiRuntime.getModelManager?.();
      const models = modelManager?.getSupportedModels?.() ?? [];

      // Get session count from DB
      let activeSessions = 0;
      try {
        const row = (this.sessionManager as any).db.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as any;
        activeSessions = row?.cnt ?? 0;
      } catch { /* ignore */ }

      const status = {
        status: 'running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version ?? '0.1.0',
        nodeVersion: process.version,
        models,
        activeSessions,
        totalMessages: 0,
        channels: this.channelManager?.getStatus() ?? [],
        plugins: this.pluginManager?.getPlugins() ?? [],
      };
      res.status(200).json(status);
    }

  // -----------------------------------------------------------------------
  // SPA fallback — serve index.html for non-API routes (production)
  // -----------------------------------------------------------------------

  private setupSpaFallback(): void {
      const root = this.controlUiRoot;
      if (!root) return;
      const indexHtml = path.join(root, 'index.html');
      if (fs.existsSync(indexHtml)) {
        // Catch-all for SPA routing — must come after API routes
        this.app.get(/^\/(?!api\/)(?!ws)(?!healthz)(?!readyz).*/, (_req: Request, res: Response) => {
          res.sendFile(indexHtml);
        });
      }
    }

  // -----------------------------------------------------------------------
  // Error handler
  // -----------------------------------------------------------------------

  private setupErrorHandler(): void {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error(`[${new Date().toISOString()}] Error: ${maskSensitiveData(err.message)}`);

      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof AuthenticationError) {
        res.status(401).json({ error: err.message });
        return;
      }
      if (err instanceof RateLimitError) {
        res.status(429).json({ error: err.message });
        return;
      }
      if (err instanceof DatabaseError) {
        if (err.message.toLowerCase().includes('not found')) {
          res.status(404).json({ error: err.message });
          return;
        }
        res.status(500).json({ error: 'Database error occurred' });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  // -----------------------------------------------------------------------
  // Server lifecycle
  // -----------------------------------------------------------------------

  start(port: number, bindHost?: string): void {
    const host = bindHost ?? '127.0.0.1';
    this.server = http.createServer(this.app);
    this.setupWebSocket(this.server);
    this.server.listen(port, host, () => {
      const controlUiStatus = this.controlUiRoot ? 'enabled' : 'no UI assets found';
      console.log(`[${new Date().toISOString()}] Gateway listening on ${host}:${port} (Control UI: ${controlUiStatus})`);
      console.log(`[${new Date().toISOString()}] WebSocket server available at ws://${host}:${port}/ws`);
    });
  }

  stop(): void {
    // Abort all active streaming sessions so they can finish gracefully
    for (const [, controller] of this.activeAbortControllers) {
      controller.abort();
    }

    if (this.wss) {
      // Close all WS connections
      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1001, 'Server shutting down');
        }
      });
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close(() => {
        console.log(`[${new Date().toISOString()}] API server stopped`);
      });
      this.server = null;
    }
  }

  // -----------------------------------------------------------------------
  // WebSocket
  // -----------------------------------------------------------------------

  private setupWebSocket(server: http.Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log(`[${new Date().toISOString()}] WebSocket client connected`);

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleWebSocketMessage(ws, data).catch((err: Error) => {
          console.error(`[${new Date().toISOString()}] Unhandled WebSocket error: ${err.message}`);
          this.sendWsError(ws, 'Internal server error');
        });
      });

      ws.on('close', () => {
        console.log(`[${new Date().toISOString()}] WebSocket client disconnected`);
      });

      ws.on('error', (err: Error) => {
        console.error(`[${new Date().toISOString()}] WebSocket error: ${err.message}`);
      });
    });
  }

  private async handleWebSocketMessage(ws: WebSocket, data: WebSocket.RawData): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.sendWsError(ws, 'Invalid JSON message');
      return;
    }

    // Handle abort command
    if (typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>).type === 'abort') {
      // Abort all active sessions for this WS connection
      for (const [sid, controller] of this.activeAbortControllers) {
        controller.abort();
      }
      return;
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('sessionId' in parsed) ||
      !('message' in parsed) ||
      !('model' in parsed)
    ) {
      this.sendWsError(ws, 'Message must include sessionId, message, and model');
      return;
    }

    const { sessionId, message, model } = parsed as Record<string, unknown>;
    const agentId = (parsed as any).agentId as string | undefined;

    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      this.sendWsError(ws, 'sessionId must be a non-empty string');
      return;
    }
    if (typeof message !== 'string' || message.trim() === '') {
      this.sendWsError(ws, 'message must be a non-empty string');
      return;
    }
    if (typeof model !== 'string' || model.trim() === '') {
      this.sendWsError(ws, 'model must be a non-empty string');
      return;
    }

    // Daily token limit pre-check
    const currentUsage = getDailyTokenUsage(sessionId as string);
    if (currentUsage >= 100_000) {
      this.sendWsError(ws, 'Daily token limit exceeded. Please try again tomorrow.');
      return;
    }

    const sanitizedMessage = `<user_input>${message}</user_input>`;

    // Resolve agent model override for WS stream
    let effectiveModel = model as string;
    if (agentId && typeof agentId === 'string') {
      const agent = await this.agentManager.getAgent(agentId);
      if (agent?.model?.primary) {
        effectiveModel = agent.model.primary;
      }
    }

    // Concurrent request guard: reject if session is already being processed
    if (this.activeSessions.has(sessionId as string)) {
      this.sendWsError(ws, 'Session is busy processing a previous request. Please wait.');
      return;
    }

    this.activeSessions.add(sessionId as string);
    const abortController = new AbortController();
    this.activeAbortControllers.set(sessionId as string, abortController);

    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stream_start', sessionId }));
      }

      let streamTotalTokens = 0;
      for await (const chunk of this.aiRuntime.streamExecute({ sessionId, message: sanitizedMessage, model: effectiveModel, abortSignal: abortController.signal, agentId: agentId || undefined })) {
        // Track token usage from stream chunks
        if (chunk.usage?.totalTokens) {
          streamTotalTokens += chunk.usage.totalTokens;
        }
        if (abortController.signal.aborted) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'stream_end', sessionId, data: { aborted: true } }));
          }
          break;
        }
        if (ws.readyState === WebSocket.OPEN) {
          // Tool call results — use structured field (not fragile string prefix)
          if (chunk.toolCallResult) {
            ws.send(JSON.stringify({
              type: 'tool_call_result',
              sessionId,
              data: { id: chunk.toolCallResult.id, result: chunk.toolCallResult.result, error: chunk.toolCallResult.error },
            }));
          } else if (chunk.text) {
            ws.send(JSON.stringify({ type: 'stream_chunk', sessionId, data: { text: chunk.text } }));
          }
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            for (const tc of chunk.toolCalls) {
              ws.send(JSON.stringify({
                type: 'tool_call_start',
                sessionId,
                data: { toolName: tc.name, args: tc.arguments, id: tc.id },
              }));
            }
          }
        }
      }

      if (!abortController.signal.aborted && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stream_end', sessionId, data: { usage: streamTotalTokens > 0 ? { totalTokens: streamTotalTokens } : null } }));
      }

      // Record token usage for daily limit tracking (Bug #4 fix)
      if (streamTotalTokens > 0) {
        checkAndRecordTokenUsage(sessionId as string, streamTotalTokens);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[${new Date().toISOString()}] WebSocket stream error: ${maskSensitiveData(errorMessage)}`);
      this.sendWsError(ws, errorMessage);
    } finally {
      this.activeSessions.delete(sessionId as string);
      this.activeAbortControllers.delete(sessionId as string);
    }
  }

  private sendWsError(ws: WebSocket, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', data: { message } }));
    }
  }

  getApp(): Application {
    return this.app;
  }

  /** Check if channel has env vars configured */
  private hasChannelEnvVars(type: string): boolean {
    switch (type) {
      case 'telegram': return !!process.env.TELEGRAM_BOT_TOKEN;
      case 'discord': return !!process.env.DISCORD_BOT_TOKEN;
      case 'slack': return !!process.env.SLACK_BOT_TOKEN;
      default: return false;
    }
  }

  /** Apply channel config values as env vars so channel constructors can use them */
  private applyChannelEnvVars(type: string, cfg: Record<string, any>): void {
    switch (type) {
      case 'telegram':
        if (cfg.token) process.env.TELEGRAM_BOT_TOKEN = cfg.token;
        if (cfg.allowedChats) process.env.TELEGRAM_ALLOWED_CHATS = Array.isArray(cfg.allowedChats) ? cfg.allowedChats.join(',') : cfg.allowedChats;
        break;
      case 'discord':
        if (cfg.token) process.env.DISCORD_BOT_TOKEN = cfg.token;
        if (cfg.guilds) process.env.DISCORD_ALLOWED_GUILDS = Array.isArray(cfg.guilds) ? cfg.guilds.join(',') : cfg.guilds;
        break;
      case 'slack':
        if (cfg.token) process.env.SLACK_BOT_TOKEN = cfg.token;
        if (cfg.signingSecret) process.env.SLACK_SIGNING_SECRET = cfg.signingSecret;
        if (cfg.appToken) process.env.SLACK_APP_TOKEN = cfg.appToken;
        break;
    }
  }

  /** Create a channel plugin instance from config */
  private createChannelFromConfig(type: string, cfg: Record<string, any>): any {
    switch (type) {
      case 'telegram': {
        const { TelegramChannel } = require('../channels/TelegramChannel');
        return new TelegramChannel({
          token: cfg.token || process.env.TELEGRAM_BOT_TOKEN || '',
          allowedChatIds: cfg.allowedChats
            ? (Array.isArray(cfg.allowedChats) ? cfg.allowedChats : String(cfg.allowedChats).split(',').map((s: string) => s.trim()).filter(Boolean))
            : undefined,
        });
      }
      case 'discord': {
        const { DiscordChannel } = require('../channels/DiscordChannel');
        return new DiscordChannel({
          token: cfg.token || process.env.DISCORD_BOT_TOKEN || '',
          allowedGuildIds: cfg.guilds
            ? (Array.isArray(cfg.guilds) ? cfg.guilds : String(cfg.guilds).split(',').map((s: string) => s.trim()).filter(Boolean))
            : undefined,
        });
      }
      case 'slack': {
        const { SlackChannel } = require('../channels/SlackChannel');
        return new SlackChannel({
          token: cfg.token || process.env.SLACK_BOT_TOKEN || '',
          signingSecret: cfg.signingSecret || process.env.SLACK_SIGNING_SECRET || '',
          appToken: cfg.appToken || process.env.SLACK_APP_TOKEN,
        });
      }
      default:
        return null;
    }
  }
}
