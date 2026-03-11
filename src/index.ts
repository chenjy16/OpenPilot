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
import { registerScreenTools } from './tools/screenTools';
import { registerPolymarketTools } from './tools/polymarketTools';
import { registerImageTools, setImageRouter, setImagePendingFiles } from './tools/imageTools';
import { registerDocumentTools, getPendingFilesRef, setDocumentConfig } from './tools/documentTools';
import { registerVoiceTools, setVoiceServiceRef } from './tools/voiceTools';
import { registerVideoTools, setVideoPendingFiles, setVideoConfig } from './tools/videoTools';
import { ImageRouter } from './services/ImageRouter';
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
import { CronScheduler } from './cron/CronScheduler';
import { PolymarketScanner } from './services/PolymarketScanner';
import { NotificationService } from './services/NotificationService';
import { StockScanner } from './services/StockScanner';
import { VoiceService } from './services/VoiceService';
import { registerStockTools } from './tools/stockTools';
import { execSync } from 'child_process';
import * as path from 'path';
import { initTradingTables } from './services/trading/tradingSchema';
import { OrderManager } from './services/trading/OrderManager';
import { RiskController } from './services/trading/RiskController';
import { PaperTradingEngine } from './services/trading/PaperTradingEngine';
import { TradingGateway } from './services/trading/TradingGateway';
import { PositionSyncer } from './services/trading/PositionSyncer';
import { LongportAdapter } from './services/trading/LongportAdapter';
import { PortfolioManager } from './services/PortfolioManager';
import { SignalEvaluator } from './services/trading/SignalEvaluator';
import { StopLossManager } from './services/trading/StopLossManager';
import { TradeNotifier } from './services/trading/TradeNotifier';
import { AutoTradingPipeline } from './services/trading/AutoTradingPipeline';
import { StrategyEngine } from './services/StrategyEngine';
import { QuoteService } from './services/trading/QuoteService';
import { UniverseScreener } from './services/UniverseScreener';
import { DataManager } from './services/trading/DataManager';
import { SignalTracker } from './services/SignalTracker';
import { StrategyAllocator } from './services/trading/StrategyAllocator';

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

/**
 * Ensure Python dependencies for stock analysis are installed.
 * Uses a local venv at scripts/.venv to avoid PEP 668 system-package restrictions.
 */
function ensurePythonDeps(): void {
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const reqFile = path.join(scriptsDir, 'requirements.txt');
  const venvDir = path.join(scriptsDir, '.venv');
  const venvPython = path.join(venvDir, 'bin', 'python3');

  // If venv already exists and yfinance is importable, skip
  if (require('fs').existsSync(venvPython)) {
    try {
      execSync(`"${venvPython}" -c "import yfinance"`, { stdio: 'ignore', timeout: 10_000 });
      console.log(`[${new Date().toISOString()}] Python deps: ✓ venv ready`);
      return;
    } catch {
      // venv exists but deps missing — reinstall below
    }
  }

  // Create venv if needed
  if (!require('fs').existsSync(venvPython)) {
    console.log(`[${new Date().toISOString()}] Python deps: creating venv at scripts/.venv...`);
    try {
      execSync(`python3 -m venv "${venvDir}"`, { stdio: 'inherit', timeout: 30_000 });
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}] Python deps: ✗ venv creation failed (${err.message})`);
      return;
    }
  }

  // Install deps into venv
  console.log(`[${new Date().toISOString()}] Python deps: installing from requirements.txt...`);
  try {
    // Install pandas_ta without deps first (numba may not support current Python version)
    execSync(`"${venvPython}" -m pip install --no-deps pandas_ta`, { stdio: 'inherit', timeout: 60_000 });
    // Then install yfinance and pandas (which pull their own deps)
    execSync(`"${venvPython}" -m pip install yfinance pandas`, { stdio: 'inherit', timeout: 120_000 });
    console.log(`[${new Date().toISOString()}] Python deps: ✓ installed successfully`);
  } catch (err: any) {
    console.warn(`[${new Date().toISOString()}] Python deps: ✗ install failed (${err.message}). Stock tech analysis may not work.`);
  }
}

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting AI Assistant MVP (OpenPilot)...`);

  // 0. Ensure Python dependencies for stock analysis
  ensurePythonDeps();

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
            input: (m.input as any[]) ?? ['text'],
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
  registerScreenTools(toolExecutor);
  registerPolymarketTools(toolExecutor);

  // Stock analysis tools (channelManager wired later via stockTools deps)
  registerStockTools(toolExecutor, {
    sandbox,
    db,
  });

  // Image & Document generation tools
  const imageRouter = new ImageRouter(appConfig);
  setImageRouter(imageRouter);
  setImagePendingFiles(getPendingFilesRef());
  setDocumentConfig(appConfig);
  registerImageTools(toolExecutor);
  registerDocumentTools(toolExecutor);
  registerVoiceTools(toolExecutor);

  // Video editing tools
  setVideoPendingFiles(getPendingFilesRef());
  setVideoConfig(appConfig);
  registerVideoTools(toolExecutor);

  console.log(`[${new Date().toISOString()}] Tools registered: ${toolExecutor.getRegisteredToolNames().join(', ')}`);
  console.log(`[${new Date().toISOString()}] Image generation: ${imageRouter.isConfigured() ? '✓ configured' : '✗ not configured (set imageGeneration in config.json5)'}`);
  console.log(`[${new Date().toISOString()}] Policy: requireApproval=[${policyEngine.getEffectivePolicy().requireApproval.join(', ')}]`);

  // 9. Initialize AgentManager
  const agentManager = new AgentManager();
  await agentManager.initialize();
  console.log(`[${new Date().toISOString()}] AgentManager initialized (${(await agentManager.listAgents()).length} agents)`);

  // 9a. Create Quant_Agent if it doesn't exist (Task 7.1 + 7.2)
  const existingQuantAgent = await agentManager.getAgent('quant-analyst');
  if (!existingQuantAgent) {
    await agentManager.createAgent({
      id: 'quant-analyst',
      name: 'Quant Analyst',
      description: '量化分析智能体 — 技术面分析、消息面分析、综合研判、信号投递',
      model: { primary: 'deepseek/deepseek-reasoner', fallbacks: ['openai/o1-mini'] },
      toolProfile: 'minimal',
      tools: { allow: ['stock_tech_analysis', 'stock_sentiment', 'stock_deliver_alert'] },
    });
    console.log(`[${new Date().toISOString()}] Quant_Agent created (quant-analyst)`);
  }

  // Set Quant_Agent System Prompt (IDENTITY.md)
  await agentManager.setFile('quant-analyst', 'IDENTITY.md', [
    '# 量化分析师 (Quant Analyst)',
    '',
    '## 角色',
    '你是一位专业的量化分析师，专注于股票技术面与消息面的综合研判。',
    '你的职责是基于工具返回的真实数据进行客观分析，生成可操作的交易信号。',
    '',
    '## 核心约束',
    '',
    '### 数据获取优先',
    '- 你 **必须** 先调用 `stock_tech_analysis` 工具获取技术面数据（价格、均线、RSI、MACD、布林带等）',
    '- 你 **必须** 再调用 `stock_sentiment` 工具获取消息面数据（财报、评级、新闻）',
    '- **严禁** 在未调用工具的情况下捏造任何数字、价格、指标或数据',
    '- **严禁** 凭空编造新闻标题、分析师评级或财报数据',
    '- 如果工具调用失败，必须如实报告错误，不得用虚构数据替代',
    '',
    '### 执行顺序',
    '每次分析必须严格按照以下顺序执行：',
    '',
    '1. **技术面分析**：调用 `stock_tech_analysis` 获取技术指标数据',
    '2. **消息面分析**：调用 `stock_sentiment` 获取市场情绪与新闻数据',
    '3. **综合研判**：基于技术面和消息面数据进行交叉验证与综合判断',
    '4. **信号投递**：调用 `stock_deliver_alert` 将分析结论以 Signal_Card 格式投递',
    '',
    '不得跳过任何步骤，不得调换顺序。',
    '',
    '## 分析框架',
    '',
    '### 技术面研判要点',
    '- 趋势判断：SMA20 与 SMA50 的交叉关系（金叉/死叉）',
    '- 动量指标：RSI(14) 超买(>70)/超卖(<30) 区域判断',
    '- MACD 信号：MACD 线与信号线的交叉、柱状图方向',
    '- 波动区间：布林带上下轨与当前价格的相对位置',
    '- 成交量：与均量的对比，确认趋势有效性',
    '',
    '### 消息面研判要点',
    '- 财报数据：营收、利润是否超预期',
    '- 分析师评级：共识方向与目标价变化',
    '- 突发新闻：是否存在重大利好/利空事件',
    '',
    '### 综合研判原则',
    '- 技术面与消息面信号一致时，提高置信度',
    '- 技术面与消息面信号矛盾时，降低置信度并在 reasoning 中说明分歧',
    '- 数据不足或工具返回错误时，置信度设为 low',
    '',
    '## 输出格式',
    '',
    '最终通过 `stock_deliver_alert` 投递的 Signal_Card 必须包含：',
    '- **symbol**：股票代码',
    '- **action**：操作建议（buy / sell / hold）',
    '- **entry_price**：建议入场价（必须基于工具返回的真实价格）',
    '- **stop_loss**：止损位（基于技术面支撑/阻力位计算）',
    '- **take_profit**：止盈位（基于技术面支撑/阻力位计算）',
    '- **reasoning**：逻辑支撑摘要（包含技术面和消息面关键依据）',
    '- **confidence**：置信度（high / medium / low）',
  ].join('\n'));
  log.info('Quant_Agent IDENTITY.md configured');

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

  // Initialize VoiceService for STT/TTS
  // Prefer new voice config section, fall back to legacy messages.tts
  const voiceConfig = appConfig.voice;
  const ttsConfig = appConfig.messages?.tts;
  const defaultModel = appConfig.agents?.defaults?.model?.primary ?? 'none';
  const supportsAudio = defaultModel !== 'none' && modelManager.hasAudioInput(defaultModel);
  const voiceService = new VoiceService({
    ttsAuto: voiceConfig?.tts?.auto ?? ttsConfig?.auto ?? 'inbound',
    ttsModel: voiceConfig?.tts?.model,
    ttsVoice: voiceConfig?.tts?.voice,
    sttLanguage: voiceConfig?.stt?.language ?? appConfig.tools?.media?.audio?.language ?? 'zh',
    sttModel: voiceConfig?.stt?.model,
    maxTtsLength: voiceConfig?.tts?.maxTextLength ?? ttsConfig?.maxTextLength ?? 2000,
  }, modelManager, appConfig);
  console.log(`[${new Date().toISOString()}] VoiceService initialized (TTS: ${ttsConfig?.auto ?? 'inbound'}, STT: default model '${defaultModel}' ${supportsAudio ? '✓ supports audio' : '✗ no audio input'})`);

  // Wire VoiceService into voice tools
  setVoiceServiceRef(voiceService);
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

      // Resolve model: agent-specific model > config default > first configured
      let channelModel: string;
      const agentConfig = await agentManager.getAgent(route.agentId);
      if (agentConfig?.model?.primary) {
        channelModel = agentConfig.model.primary;
      } else if (appConfig.agents?.defaults?.model?.primary) {
        channelModel = appConfig.agents.defaults.model.primary;
      } else {
        const configured = modelManager.getConfiguredModels();
        channelModel = configured[0] ?? 'google/gemini-2.0-flash';
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
    voiceService,
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

  // 13. Initialize PolyOracle services (Scanner + Notifications + Cron)
  const polyConfig = appConfig.polymarket;
  const notificationService = new NotificationService(db, channelManager, polyConfig?.notify);
  const polymarketScanner = new PolymarketScanner(db, aiRuntime, {
    gammaApiUrl: polyConfig?.gammaApiUrl,
    scanLimit: polyConfig?.scanLimit,
    minVolume: polyConfig?.minVolume,
    signalThreshold: polyConfig?.signalThreshold,
    model: polyConfig?.model,
  });

  const cronScheduler = new CronScheduler(db, {
    maxConcurrent: appConfig.cron?.maxConcurrentRuns ?? 2,
  });

  // Register the polymarket-scan handler
  cronScheduler.registerHandler('polymarket-scan', async (_job) => {
    const result = await polymarketScanner.runFullScan();

    // Send notifications for +EV opportunities
    if (result.opportunities.length > 0) {
      await notificationService.notifySignals(result.opportunities);
    }

    // Send scan summary if there are notable results
    await notificationService.sendScanSummary({
      marketsScanned: result.markets.length,
      signalsGenerated: result.signals.length,
      opportunities: result.opportunities.length,
      errors: result.errors.length,
      durationMs: result.durationMs,
    });

    // Send error alerts
    if (result.errors.length > 0) {
      await notificationService.sendSystemAlert(
        `扫描出现 ${result.errors.length} 个错误:\n${result.errors.slice(0, 3).join('\n')}`,
      );
    }
  });

  // Initialize StockScanner
  // Apply FINNHUB_API_KEY from config if not already in env
  const stockConfig = appConfig.stockAnalysis;
  if (stockConfig?.finnhubApiKey && !process.env.FINNHUB_API_KEY) {
    process.env.FINNHUB_API_KEY = stockConfig.finnhubApiKey;
  }
  const stockWatchlist = stockConfig?.watchlist
    ? (typeof stockConfig.watchlist === 'string'
        ? stockConfig.watchlist.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean)
        : stockConfig.watchlist)
    : [];
  const stockScanner = new StockScanner(db, aiRuntime, {
    watchlist: stockWatchlist,
    model: stockConfig?.model || polyConfig?.model,
    signalThreshold: stockConfig?.signalThreshold,
  }, agentManager);

  // Register the stock-scan handler (Task 6.1 + 6.2)
  cronScheduler.registerHandler('stock-scan', async (job) => {
    // Read watchlist and config from CronJob.config
    if (job.config) {
      const updates: Record<string, any> = {};
      if (Array.isArray(job.config.watchlist)) {
        updates.watchlist = job.config.watchlist;
      }
      if (job.config.model) {
        updates.model = job.config.model;
      }
      if (job.config.signalThreshold != null) {
        updates.signalThreshold = job.config.signalThreshold;
      }
      if (Object.keys(updates).length > 0) {
        stockScanner.updateConfig(updates);
      }
    }

    const result = await stockScanner.runFullScan();

    // Determine confidence threshold for Signal_Card push
    const threshold = job.config?.signalThreshold ?? 0.6;
    const confidenceMap: Record<string, number> = { high: 0.9, medium: 0.6, low: 0.3 };

    // Push Signal_Card for signals meeting the threshold
    for (const signal of result.signals) {
      const score = confidenceMap[signal.confidence] ?? 0;
      if (score >= threshold) {
        const card = [
          '📈 量化分析信号',
          '',
          `🏷️ ${signal.symbol}`,
          `📊 操作建议: ${signal.action}`,
          `💰 建议入场: $${signal.entry_price}`,
          `🛑 止损位: $${signal.stop_loss}`,
          `🎯 止盈位: $${signal.take_profit}`,
          `🔒 置信度: ${signal.confidence}`,
          '',
          `💡 逻辑支撑:\n${signal.reasoning}`,
          '',
          `⏰ ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
        ].join('\n');
        await notificationService.sendSystemAlert(card);
      }
    }

    // Send scan summary
    await notificationService.sendScanSummary({
      marketsScanned: result.scannedCount,
      signalsGenerated: result.signals.length,
      opportunities: result.signals.filter(s => (confidenceMap[s.confidence] ?? 0) >= threshold).length,
      errors: result.errors.length,
      durationMs: result.durationMs,
    });

    // Send error alerts
    if (result.errors.length > 0) {
      await notificationService.sendSystemAlert(
        `股票扫描出现 ${result.errors.length} 个错误:\n${result.errors.slice(0, 3).join('\n')}`,
      );
    }
  });

  // Seed default polymarket-scan job if none exists and polymarket is enabled
  if (polyConfig?.enabled !== false) {
    const existingJobs = cronScheduler.listJobs();
    if (!existingJobs.find(j => j.handler === 'polymarket-scan')) {
      cronScheduler.createJob({
        id: 'polymarket-scan-default',
        name: 'PolyOracle 市场扫描',
        schedule: '0 */4 * * *',
        handler: 'polymarket-scan',
        enabled: true,
      });
    }
  }

  // Start the cron scheduler
  cronScheduler.start();
  console.log(`[${new Date().toISOString()}] CronScheduler started (${cronScheduler.listJobs().length} jobs)`);

  // 14. Create and start Gateway server (single-process deployment)
  //     Serves: WebSocket RPC + HTTP API + Control UI static assets
  const server = new APIServer(aiRuntime, sessionManager, auditLogger, channelManager, pluginManager, agentManager, appConfig, policyEngine);

  // Inject PolyOracle services into API server
  server.setPolyOracleServices({
    scanner: polymarketScanner,
    notificationService,
    cronScheduler,
  });

  // Inject StockScanner + Sandbox into API server
  server.setStockServices({ scanner: stockScanner, sandbox });

  // 15. Initialize trading module
  initTradingTables(db);
  const tradingOrderManager = new OrderManager(db);
  const tradingRiskController = new RiskController(db);
  tradingRiskController.initDefaultRules();
  const paperTradingEngine = new PaperTradingEngine(db, {
    initial_capital: 1000000,
    commission_rate: 0.0003,
  });
  const tradingGateway = new TradingGateway(db, tradingOrderManager, tradingRiskController, paperTradingEngine, new LongportAdapter());

  // 15a. Initialize auto-trading modules
  const tradeNotifier = new TradeNotifier(notificationService);
  const signalEvaluator = new SignalEvaluator(db);
  const stopLossManager = new StopLossManager(db, tradingGateway, tradeNotifier);
  const strategyEngine = new StrategyEngine(db, sandbox);
  const strategyAllocator = new StrategyAllocator(db);
  tradingGateway.setStrategyAllocator(strategyAllocator);
  const autoTradingPipeline = new AutoTradingPipeline(
    db,
    tradingGateway,
    signalEvaluator,
    stopLossManager,
    tradeNotifier,
    strategyEngine,
  );

  // Restore active stop-loss monitoring from database (Requirement 4.8)
  stopLossManager.restoreFromDb();

  // Start auto-trading pipeline if enabled (Requirements 7.3, 7.4)
  const pipelineConfig = autoTradingPipeline.getConfig();
  if (pipelineConfig.auto_trade_enabled) {
    autoTradingPipeline.start();
    console.log(`[${new Date().toISOString()}] AutoTradingPipeline started (signal polling active)`);
  } else {
    console.log(`[${new Date().toISOString()}] AutoTradingPipeline idle (auto_trade_enabled=false)`);
  }

  server.setTradingServices({
    gateway: tradingGateway,
    riskController: tradingRiskController,
    orderManager: tradingOrderManager,
    pipeline: autoTradingPipeline,
    stopLossManager,
    db,
  });

  // Wire real-time WebSocket push for trading events
  tradeNotifier.setOnEvent((event) => {
    server.broadcastTradingEvent(event);
  });

  // Connect signal auto-trading (if StrategyEngine exists)
  // tradingGateway.handleSignal will be called when strategy signals are generated

  // Start position syncer
  const portfolioManager = new PortfolioManager(db);
  const positionSyncer = new PositionSyncer(portfolioManager, tradingGateway);
  positionSyncer.start();
  console.log(`[${new Date().toISOString()}] Trading module initialized (paper mode)`);

  // 16. Initialize QuoteService — provides real-time price data for StopLossManager
  const quoteService = new QuoteService();
  const brokerCreds = tradingGateway.getBrokerCredentials();
  const tradingConfig = tradingGateway.getConfig();
  const isLiveMode = tradingConfig.trading_mode === 'live';
  const quoteToken = isLiveMode ? brokerCreds.access_token : brokerCreds.paper_access_token;
  if (brokerCreds.app_key && brokerCreds.app_secret && quoteToken) {
    quoteService.configure({
      appKey: brokerCreds.app_key,
      appSecret: brokerCreds.app_secret,
      accessToken: quoteToken,
      region: (tradingConfig.broker_region as any) || 'hk',
    });

    // Collect symbols to subscribe: watchlist + active stop-loss symbols
    const slSymbols = stopLossManager.getActiveRecords().map(r => r.symbol);
    const watchlistSymbols = stockWatchlist.length > 0 ? stockWatchlist : [];
    const allSymbols = [...new Set([...watchlistSymbols, ...slSymbols])];

    if (allSymbols.length > 0) {
      quoteService.start(allSymbols, 60000).catch(err => {
        console.error(`[${new Date().toISOString()}] QuoteService start error: ${err.message}`);
      });
    }

    // Wire StopLossManager to use QuoteService for real prices
    stopLossManager.setPriceProvider(async (symbol: string) => {
      return quoteService.getPriceNumber(symbol);
    });
    // When a new stop-loss symbol is registered, auto-subscribe to QuoteService
    stopLossManager.setOnNewSymbol((symbol: string) => {
      quoteService.subscribe([symbol]).catch(err => {
        console.error(`[QuoteService] Auto-subscribe for ${symbol} failed: ${err.message}`);
      });
    });
    stopLossManager.startMonitoring(30000);
    console.log(`[${new Date().toISOString()}] QuoteService configured, StopLossManager wired to real prices`);
  } else {
    console.log(`[${new Date().toISOString()}] QuoteService skipped (no broker credentials)`);
  }

  // 17. Initialize UniverseScreener — auto stock screening
  const venvPy = path.join(__dirname, '..', 'scripts', '.venv', 'bin', 'python3');
  const screenPythonPath = require('fs').existsSync(venvPy) ? venvPy : 'python3';
  const universeScreener = new UniverseScreener(db, screenPythonPath);

  // Register universe-screen cron handler
  cronScheduler.registerHandler('universe-screen', async (job) => {
    const config = job.config || {};
    await universeScreener.runScreen({
      pool: config.pool || 'all',
      top: config.top || 100,
    });

    // After screening, update QuoteService subscriptions with new watchlist
    const newSymbols = universeScreener.getWatchlistSymbols();
    if (newSymbols.length > 0 && quoteService.isConfigured()) {
      await quoteService.subscribe(newSymbols);
    }
  });

  // Seed default universe-screen cron job if none exists
  {
    const existingScreenJobs = cronScheduler.listJobs();
    if (!existingScreenJobs.find(j => j.handler === 'universe-screen')) {
      cronScheduler.createJob({
        id: 'universe-screen-daily',
        name: '股票池自动筛选',
        schedule: '0 22 * * 1-5',
        handler: 'universe-screen',
        enabled: true,
        config: { pool: 'all', top: 100 },
      });
      console.log(`[${new Date().toISOString()}] Universe screener cron job created (weekdays 22:00 UTC)`);
    }
  }

  // Expose UniverseScreener and QuoteService to API server
  server.setScreenerServices({ universeScreener, quoteService });

  // Wire sector data from UniverseScreener → RiskController
  universeScreener.setOnSectorData((mappings) => {
    tradingRiskController.setSectorMappings(mappings);
  });

  // 18. Initialize DataManager — local OHLCV data cache
  const dataManager = new DataManager(db, screenPythonPath);

  // Register data-sync cron handler
  cronScheduler.registerHandler('data-sync', async (_job) => {
    // Sync watchlist symbols + active stop-loss symbols
    const watchSymbols = universeScreener.getWatchlistSymbols();
    const slSymbols = stopLossManager.getActiveRecords().map(r => r.symbol);
    const allSyncSymbols = [...new Set([...stockWatchlist, ...watchSymbols, ...slSymbols])];
    if (allSyncSymbols.length > 0) {
      const result = await dataManager.syncSymbols(allSyncSymbols);
      console.log(`[DataManager] Synced ${result.synced}/${allSyncSymbols.length} symbols, ${result.errors.length} errors`);
    }
  });

  // Seed default data-sync cron job if none exists
  {
    const existingDataJobs = cronScheduler.listJobs();
    if (!existingDataJobs.find(j => j.handler === 'data-sync')) {
      cronScheduler.createJob({
        id: 'data-sync-daily',
        name: '历史数据同步',
        schedule: '30 22 * * 1-5',
        handler: 'data-sync',
        enabled: true,
      });
    }
  }

  // Expose DataManager to API server
  server.setDataServices({ dataManager, db });

  // 18a. VIX real-time monitoring — fetches VIX via Python, updates dynamic risk state,
  //      and tightens stop-losses when VIX > 25
  cronScheduler.registerHandler('vix-monitor', async (_job) => {
    const venvPyPath = require('fs').existsSync(venvPy) ? venvPy : 'python3';
    const dbPath = path.resolve(config.databasePath);
    const scriptPath = path.join(__dirname, '..', 'scripts', 'vix_monitor.py');
    try {
      execSync(`"${venvPyPath}" "${scriptPath}" --db "${dbPath}"`, { timeout: 30_000, stdio: 'pipe' });
    } catch (err: any) {
      console.error(`[VIX Monitor] Script failed: ${err.message}`);
      return;
    }
    // Read updated state and apply risk adjustments
    const state = tradingRiskController.getDynamicRiskState();
    if (state.vix_level != null && state.vix_level > 25) {
      // Tighten all stop-losses to 1× ATR when VIX is elevated
      const tightened = stopLossManager.tightenAllStops(1.0);
      if (tightened > 0) {
        console.log(`[VIX Monitor] VIX=${state.vix_level}, tightened ${tightened} stop-loss records to 1×ATR`);
        await tradeNotifier.notifyUrgentAlert(
          `⚠️ VIX=${state.vix_level?.toFixed(1)} (${state.regime}), 已收紧 ${tightened} 个止损位至 1×ATR`,
        );
      }
    }
  });

  // Seed VIX monitor cron job (every 15 minutes during US market hours, weekdays)
  {
    const existingVixJobs = cronScheduler.listJobs();
    if (!existingVixJobs.find(j => j.handler === 'vix-monitor')) {
      cronScheduler.createJob({
        id: 'vix-monitor-periodic',
        name: 'VIX 恐慌指数监控',
        schedule: '*/15 13-21 * * 1-5',
        handler: 'vix-monitor',
        enabled: true,
      });
      console.log(`[${new Date().toISOString()}] VIX monitor cron job created (every 15min, market hours)`);
    }
  }

  // 19. Signal verification — auto-check pending signals against real prices
  const signalTracker = new SignalTracker(db);
  const signalPriceProvider = quoteService.isConfigured()
    ? async (symbol: string) => quoteService.getPriceNumber(symbol)
    : undefined;

  cronScheduler.registerHandler('signal-verify', async (_job) => {
    const updated = await signalTracker.checkAndUpdateOutcomes(signalPriceProvider);
    if (updated > 0) {
      console.log(`[SignalTracker] Verified ${updated} signals`);
    }
  });

  // Seed signal-verify cron job (every 30 minutes during market hours)
  {
    const existingVerifyJobs = cronScheduler.listJobs();
    if (!existingVerifyJobs.find(j => j.handler === 'signal-verify')) {
      cronScheduler.createJob({
        id: 'signal-verify-periodic',
        name: '信号回溯验证',
        schedule: '*/30 * * * 1-5',
        handler: 'signal-verify',
        enabled: true,
      });
    }
  }

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
    autoTradingPipeline.stop();
    tradingGateway.cancelAllTWAP();
    stopLossManager.stopMonitoring();
    quoteService.stop().catch(() => {});
    positionSyncer.stop();
    cronScheduler.stop();
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
