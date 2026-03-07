/**
 * AI Assistant MVP - Main Entry Point
 *
 * OpenPilot-aligned bootstrap:
 *   Gateway → Pi Agent Runtime → Tool Pipeline → Sandbox
 *
 * Wires: PolicyEngine, AuditLogger, Sandbox, Skills, and all tools.
 */

// Load environment variables from .env file if dotenv is available
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
} catch {
  // dotenv is optional — fall back to process.env as-is
}

import { loadAppConfig } from './config/index';
import { configureLogging, createLogger } from './logger';
import { initializeDatabase } from './session/database';
import { SessionManager } from './session/SessionManager';
import { ModelManager } from './models/ModelManager';
import { ToolExecutor } from './tools/ToolExecutor';
import { PolicyEngine } from './tools/PolicyEngine';
import { AuditLogger, createAuditHook } from './tools/auditHook';
import { registerFileTools } from './tools/fileTools';
import { registerNetworkTools } from './tools/networkTools';
import { registerShellTools } from './tools/shellTools';
import { registerBrowserTools } from './tools/browserTools';
import { registerPatchTools } from './tools/patchTools';
import { registerMemoryTools } from './tools/memoryTools';
import { registerSubAgentTools, SubAgentContext } from './tools/subAgentTools';
import { closeBrowser } from './tools/browserTools';
import { createSandbox } from './runtime/sandbox';
import { AIRuntime } from './runtime/AIRuntime';
import { APIServer } from './api/server';
import { setAllowedModels } from './api/middleware';
import { ChannelManager } from './channels/ChannelManager';
import { createTelegramChannel } from './channels/TelegramChannel';
import { createDiscordChannel } from './channels/DiscordChannel';
import { createSlackChannel } from './channels/SlackChannel';
import { PluginManager } from './plugins/PluginManager';
import { AgentManager } from './agents/AgentManager';
import type { AgentBinding as ChannelAgentBinding } from './channels/types';
import { enqueueCommandInLane } from './channels/CommandLane';
import {
  registerSubagentRun,
  completeSubagentRun,
  setSubagentLimits,
} from './agents/SubagentRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Merge agent-level bindings into the flat ChannelManager format.
 * Each agent's bindings get the agentId injected.
 */
async function buildMergedBindings(
  agentManager: AgentManager,
  globalBindings?: ChannelAgentBinding[],
): Promise<ChannelAgentBinding[]> {
  const merged: ChannelAgentBinding[] = [...(globalBindings ?? [])];
  const agents = await agentManager.listAgents();
  for (const agent of agents) {
    if (agent.bindings) {
      for (const b of agent.bindings) {
        merged.push({
          agentId: agent.id,
          match: {
            channel: b.match.channel,
            accountId: b.match.accountId,
            peer: b.match.peer ? { kind: b.match.peer.kind as any, id: b.match.peer.id } : undefined,
            guildId: b.match.guildId,
            teamId: b.match.teamId,
            roles: b.match.roles,
          },
        });
      }
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Load and validate configuration (fails fast with a clear error if invalid)
// ---------------------------------------------------------------------------

const appConfig = loadAppConfig();
// Derive legacy config shape from appConfig (avoids double-loading)
const config = {
  openaiApiKey: appConfig.apiKeys.openai,
  anthropicApiKey: appConfig.apiKeys.anthropic,
  googleApiKey: appConfig.apiKeys.google,
  databasePath: appConfig.databasePath,
  port: appConfig.gateway.port,
  host: appConfig.gateway.host,
  nodeEnv: appConfig.nodeEnv,
  debug: appConfig.debug,
  logLevel: appConfig.logLevel,
};

// Configure structured logging
configureLogging(appConfig.logLevel, appConfig.nodeEnv === 'production');
const log = createLogger('Main');

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting AI Assistant MVP (OpenPilot)...`);

  // 1. Initialize SQLite database
  const db = initializeDatabase(config.databasePath);
  console.log(`[${new Date().toISOString()}] Database initialized: ${config.databasePath}`);

  // 2. Create SessionManager
  const sessionManager = new SessionManager(db);

  // 3. Create ModelManager and sync allowed models to middleware
  const modelManager = new ModelManager();

  // 3a. Apply custom model providers from config.json5
  const modelsConfig = appConfig.models;
  if (modelsConfig?.providers) {
    for (const [providerId, provCfg] of Object.entries(modelsConfig.providers)) {
      // Register provider API key if present
      if (provCfg.apiKey) {
        modelManager.registerProvider(providerId, provCfg.apiKey, provCfg.baseUrl);
      }
      // Register individual models under this provider
      if (provCfg.models) {
        for (const m of provCfg.models) {
          modelManager.registerModel({
            provider: providerId,
            modelId: m.id,
            name: m.name ?? m.id,
            api: (provCfg.api as any) ?? 'openai-completions',
            reasoning: m.reasoning ?? false,
            input: ['text'],
            contextWindow: m.contextWindow ?? 128_000,
            defaultMaxTokens: m.maxTokens ?? 4096,
            defaultTemperature: 0.7,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          }, provCfg.apiKey);
          // If provider has a custom baseUrl, patch the config
          if (provCfg.baseUrl) {
            const ref = `${providerId}/${m.id}`;
            const cfg = modelManager.getConfig(ref);
            if (cfg) cfg.baseUrl = provCfg.baseUrl;
          }
        }
      }
    }
    console.log(`[${new Date().toISOString()}] Custom model providers loaded from config.json5`);
  }

  // Use configured models (have API keys) + legacy short names for middleware validation
  const configuredModels = modelManager.getConfiguredModels();
  const supportedModels = modelManager.getSupportedModels();
  setAllowedModels([...new Set([...supportedModels, ...configuredModels])]);
  console.log(`[${new Date().toISOString()}] Models configured: ${configuredModels.join(', ') || '(none — set API keys)'}`);

  // 4. Create Sandbox (main session = local, future: Docker for sub-sessions)
  const sandbox = createSandbox(true);
  console.log(`[${new Date().toISOString()}] Sandbox: ${sandbox.type}`);

  // 5. Create PolicyEngine with default policy
  //    - shellExecute and writeFile require human approval
  //    - No tools are denied by default (empty denylist)
  const policyEngine = new PolicyEngine({
    denylist: [],
    allowlist: [],
    requireApproval: ['shellExecute', 'writeFile'],
  });

  // 6. Create AuditLogger
  const auditLogger = new AuditLogger();

  // 7. Create ToolExecutor and wire hooks
  const toolExecutor = new ToolExecutor();

  // Wire PolicyEngine as before_tool_call hook.
  // In production, tools requiring approval are queued via the exec-approval
  // system and resolved through the API. In development, auto-approve with a warning.
  const isProduction = appConfig.nodeEnv === 'production';
  const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void }>();

  const approvalHandler = async (ctx: { toolName: string; arguments: Record<string, any>; sessionId?: string }): Promise<boolean> => {
    if (!isProduction) {
      // Dev mode: auto-approve with warning
      console.warn(
        `[${new Date().toISOString()}] [DEV] Auto-approving tool '${ctx.toolName}' for session '${ctx.sessionId ?? 'unknown'}'.`
      );
      return true;
    }

    // Production: queue for human approval via exec-approval API
    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[${new Date().toISOString()}] Tool '${ctx.toolName}' requires approval (${approvalId})`);

    return new Promise<boolean>((resolve) => {
      // Store resolver so the API endpoint can resolve it
      pendingApprovals.set(approvalId, { resolve });

      // Timeout: auto-deny after 5 minutes if no human response
      const timer = setTimeout(() => {
        if (pendingApprovals.has(approvalId)) {
          pendingApprovals.delete(approvalId);
          console.warn(`[${new Date().toISOString()}] Approval ${approvalId} timed out — denied.`);
          resolve(false);
        }
      }, 5 * 60 * 1000);

      // Store the approval request so the API can list it
      (pendingApprovals as any)._queue = (pendingApprovals as any)._queue ?? [];
      (pendingApprovals as any)._queue.push({
        id: approvalId,
        toolName: ctx.toolName,
        arguments: ctx.arguments,
        sessionId: ctx.sessionId,
        createdAt: new Date().toISOString(),
        _timer: timer,
      });
    });
  };
  toolExecutor.onBeforeToolCall(policyEngine.createHook(approvalHandler));

  // Wire AuditLogger as after_tool_call hook
  toolExecutor.onAfterToolCall(createAuditHook(auditLogger));

  // 8. Register built-in tools
  registerFileTools(toolExecutor);
  registerNetworkTools(toolExecutor);
  registerShellTools(toolExecutor, sandbox);
  registerBrowserTools(toolExecutor);
  registerPatchTools(toolExecutor);
  registerMemoryTools(toolExecutor, db);
  console.log(`[${new Date().toISOString()}] Tools registered: ${toolExecutor.getRegisteredToolNames().join(', ')}`);
  console.log(`[${new Date().toISOString()}] Policy: requireApproval=[${policyEngine.getEffectivePolicy().requireApproval.join(', ')}]`);

  // 9. Initialize AgentManager
  const agentManager = new AgentManager();
  await agentManager.initialize();
  console.log(`[${new Date().toISOString()}] AgentManager initialized (${(await agentManager.listAgents()).length} agents)`);

  // 10. Create AIRuntime
  const aiRuntime = new AIRuntime(sessionManager, modelManager, toolExecutor);
  aiRuntime.setAgentManager(agentManager);

  // 10. Register sub-agent tool (needs AIRuntime reference)
  const subAgentCtx: SubAgentContext = {
    executeSubAgent: async ({ parentSessionId, task, model, depth }) => {
      const runId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Resolve agentId from parent session key (format: agent:{agentId}:...)
      const parentAgentId = parentSessionId.startsWith('agent:')
        ? parentSessionId.split(':')[1] ?? 'main'
        : 'main';
      const childSessionId = `agent:${parentAgentId}:subagent:${runId}`;

      // Register in SubagentRegistry (enforces depth/children limits)
      registerSubagentRun({
        runId,
        requesterSessionKey: parentSessionId,
        childSessionKey: childSessionId,
        agentId: parentAgentId,
        model,
        depth,
      });

      try {
        // Execute through 'subagent' lane for concurrency control
        const text = await enqueueCommandInLane('subagent', async () => {
          const result = await aiRuntime.execute({
            sessionId: childSessionId,
            message: `[Sub-agent task from parent session ${parentSessionId}, depth=${depth}]\n\n${task}`,
            model,
          });
          return result.text;
        });

        completeSubagentRun(runId);
        return text;
      } catch (err: any) {
        completeSubagentRun(runId, err.message);
        throw err;
      }
    },
  };
  registerSubAgentTools(toolExecutor, subAgentCtx);
  console.log(`[${new Date().toISOString()}] Sub-agent tool registered (max depth: 3)`);

  // Wire sub-agent limits from config
  const agentDefaults = appConfig.agents?.defaults;
  if (agentDefaults?.subagents) {
    const sub = agentDefaults.subagents;
    const limitsOverride: Record<string, number> = {};
    if (sub.maxSpawnDepth != null) limitsOverride.maxSpawnDepth = sub.maxSpawnDepth;
    if (sub.maxChildrenPerAgent != null) limitsOverride.maxChildrenPerAgent = sub.maxChildrenPerAgent;
    if (sub.archiveAfterMinutes != null) limitsOverride.archiveAfterMinutes = sub.archiveAfterMinutes;
    if (sub.announceTimeoutMs != null) limitsOverride.announceTimeoutMs = sub.announceTimeoutMs;
    if (Object.keys(limitsOverride).length > 0) {
      setSubagentLimits(limitsOverride);
    }
  }

  // Wire lane concurrency from config
  if (agentDefaults?.maxConcurrent != null) {
    const { setCommandLaneConcurrency } = require('./channels/CommandLane');
    setCommandLaneConcurrency('main', agentDefaults.maxConcurrent);
  }
  if (agentDefaults?.subagents?.maxConcurrent != null) {
    const { setCommandLaneConcurrency } = require('./channels/CommandLane');
    setCommandLaneConcurrency('subagent', agentDefaults.subagents.maxConcurrent);
  }

  // 11. Set up multi-channel gateway
  //     Merge agent-level bindings into a flat list for the ChannelManager
  const allBindings = await buildMergedBindings(agentManager, appConfig.bindings as any);

  const channelManager = new ChannelManager({
    onMessage: async (msg) => {
      // Route channel messages to Agent via binding resolution
      const chatType = msg.chatType ?? 'direct';
      // For DMs, peer is the sender; for groups/channels, peer is the chat (group ID)
      const peerId = chatType === 'direct' ? msg.senderId : msg.chatId;
      const route = channelManager.resolveAgentRoute({
        channel: msg.channelType,
        accountId: msg.accountId,
        peer: peerId ? { kind: chatType as any, id: peerId } : undefined,
        guildId: msg.guildId,
        threadId: msg.threadId,
      });

      // Resolve model: agent-specific model > global preference > fallback
      let channelModel: string;
      const agentConfig = await agentManager.getAgent(route.agentId);
      if (agentConfig?.model?.primary) {
        channelModel = agentConfig.model.primary;
      } else {
        const configured = modelManager.getConfiguredModels();
        channelModel = configured.find(m => m === 'google/gemini-2.0-flash')
          ?? configured.find(m => m === 'google/gemini-1.5-flash')
          ?? configured.find(m => m.startsWith('google/'))
          ?? configured[0] ?? 'google/gemini-2.0-flash';
      }

      const result = await aiRuntime.execute({
        sessionId: route.sessionKey,
        message: msg.content,
        model: channelModel,
        agentId: route.agentId !== 'main' ? route.agentId : undefined,
      });
      return result.text;
    },
    bindings: allBindings,
    defaultAgentId: 'main',
    appConfig,
    dmScope: appConfig.session?.dmScope ?? 'per-channel-peer',
  });

  // Register available channels
  const telegramChannel = createTelegramChannel();
  if (telegramChannel) {
    channelManager.register(telegramChannel);
    console.log(`[${new Date().toISOString()}] Telegram channel registered`);
  }

  const discordChannel = createDiscordChannel();
  if (discordChannel) {
    channelManager.register(discordChannel);
    console.log(`[${new Date().toISOString()}] Discord channel registered`);
  }

  const slackChannel = createSlackChannel();
  if (slackChannel) {
    channelManager.register(slackChannel);
    console.log(`[${new Date().toISOString()}] Slack channel registered`);
  }

  // Connect all channels (non-blocking — failures are logged, not fatal)
  if (channelManager.getRegisteredTypes().length > 0) {
    channelManager.connectAll().catch(err => {
      console.error(`[${new Date().toISOString()}] Channel connection error: ${err.message}`);
    });
    // Start health monitoring for auto-restart
    channelManager.startHealthCheck();
    console.log(`[${new Date().toISOString()}] Channels: ${channelManager.getRegisteredTypes().join(', ')} (health monitor active)`);
  } else {
    console.log(`[${new Date().toISOString()}] No external channels configured (set TELEGRAM_BOT_TOKEN etc.)`);
  }

  // 12. Initialize plugin system
  const pluginManager = new PluginManager({
    toolExecutor,
    config: {},
    log: {
      info: (msg: string) => console.log(`[Plugin] ${msg}`),
      warn: (msg: string) => console.warn(`[Plugin] ${msg}`),
      error: (msg: string) => console.error(`[Plugin] ${msg}`),
    },
  });
  console.log(`[${new Date().toISOString()}] Plugin system initialized`);

  // 14. Create and start Gateway server (single-process deployment)
  //     Serves: WebSocket RPC + HTTP API + Control UI static assets
  const server = new APIServer(aiRuntime, sessionManager, auditLogger, channelManager, pluginManager, agentManager, appConfig, policyEngine);

  // Resolve bind host from gateway config (OpenClaw bind modes)
  const bindMode = appConfig.gateway?.bind ?? 'loopback';
  let bindHost = '127.0.0.1';
  switch (bindMode) {
    case 'loopback': bindHost = '127.0.0.1'; break;
    case 'lan': bindHost = '0.0.0.0'; break;
    case 'auto': bindHost = '0.0.0.0'; break;
    case 'custom': bindHost = appConfig.gateway?.customBindHost ?? '127.0.0.1'; break;
    default: bindHost = config.host ?? '127.0.0.1';
  }
  server.start(config.port, bindHost);

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  const shutdown = (signal: string): void => {
    console.log(`[${new Date().toISOString()}] Received ${signal}, shutting down gracefully...`);
    server.stop();
    channelManager.disconnectAll().catch(() => {});
    pluginManager.deactivateAll().catch(() => {});
    closeBrowser().catch(() => {});

    // Wait up to 10s for in-flight requests to drain, then force exit
    const forceTimer = setTimeout(() => {
      console.warn(`[${new Date().toISOString()}] Force shutdown after timeout.`);
      sandbox.destroy().catch(() => {});
      db.close();
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    // Give a brief moment for streams to finish after abort
    setTimeout(() => {
      sandbox.destroy().catch(() => {});
      db.close();
      console.log(`[${new Date().toISOString()}] Shutdown complete.`);
      process.exit(0);
    }, 1000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] Fatal error during startup:`, err);
  process.exit(1);
});
