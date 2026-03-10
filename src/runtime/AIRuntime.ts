/**
 * AI Runtime Engine
 * Core conversation execution engine — powered by Pi Agent Core.
 *
 * The ReAct loop is now driven by PiAgent (from pi-agent-core).
 * AIRuntime is responsible for:
 *   - Session lifecycle (load/create/save via SessionManager)
 *   - Dynamic system prompt assembly
 *   - Model provider instantiation + failover
 *   - Bridging our ModelProvider/ToolExecutor to PiAgent interfaces
 *   - Error handling with retry logic
 */

import { AIRequest, AIResponse, Tool, ValidationError } from '../types';
import { SessionManager } from '../session';
import { ModelManager } from '../models';
import { ModelProvider } from '../models/ModelProvider';
import { OpenAIProvider } from '../models/OpenAIProvider';
import { AnthropicProvider } from '../models/AnthropicProvider';
import { GeminiProvider } from '../models/GeminiProvider';
import { ToolExecutor } from '../tools';
import { loadPromptSections, assembleSystemPrompt } from './promptBuilder';
import { resolveSkillsSnapshot, parseFrontmatter } from '../skills/loader';
import { watchPromptFiles } from './promptWatcher';
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  ContextOverflowError,
} from '../models/ModelProvider';

// Pi Agent Core integration
import { PiAgent, PiSession } from '../pi-agent';
import { ModelProviderAdapter, toPiTools, toTranscript, fromTranscript } from '../pi-agent/adapters';
import { getContextWindowTokens } from '../pi-agent/tokenEstimator';

/**
 * Sensitive data patterns to mask in logs
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sk-[A-Za-z0-9]{20,}/g, replacement: 'sk-[MASKED]' },
  { pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/g, replacement: 'sk-ant-[MASKED]' },
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, replacement: 'Bearer [MASKED]' },
  { pattern: /(api[_-]?key["']?\s*[:=]\s*["']?)[A-Za-z0-9\-._]{10,}/gi, replacement: '$1[MASKED]' },
  { pattern: /(authorization["']?\s*[:=]\s*["']?)[A-Za-z0-9\-._~+/ ]{10,}/gi, replacement: '$1[MASKED]' },
];

function maskSensitiveData(message: string): string {
  let masked = message;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

function createMaskedLogger(): Logger {
  const formatArgs = (args: any[]): string => {
    if (args.length === 0) return '';
    return ' ' + args.map(a => {
      try {
        return typeof a === 'object' ? maskSensitiveData(JSON.stringify(a)) : maskSensitiveData(String(a));
      } catch {
        return '[unserializable]';
      }
    }).join(' ');
  };

  return {
    info(message: string, ...args: any[]) {
      console.info(`[AIRuntime] INFO: ${maskSensitiveData(message)}${formatArgs(args)}`);
    },
    warn(message: string, ...args: any[]) {
      console.warn(`[AIRuntime] WARN: ${maskSensitiveData(message)}${formatArgs(args)}`);
    },
    error(message: string, ...args: any[]) {
      console.error(`[AIRuntime] ERROR: ${maskSensitiveData(message)}${formatArgs(args)}`);
    },
    debug(message: string, ...args: any[]) {
      if (process.env.DEBUG) {
        console.debug(`[AIRuntime] DEBUG: ${maskSensitiveData(message)}${formatArgs(args)}`);
      }
    },
  };
}

const MAX_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = [1000, 2000, 4000];
const NETWORK_RETRY_INTERVAL_MS = 2000;
const MAX_CONCURRENT_REQUESTS = 10;

/** OpenPilot Constraint 2: max tool-call iterations per ReAct loop */
const MAX_REACT_ITERATIONS = 10;

/**
 * Semaphore-based concurrency limiter with a request queue.
 */
class ConcurrencyLimiter {
  private running: number = 0;
  private readonly limit: number;
  private queue: Array<() => void> = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.running--;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * AI Runtime Engine
 * Coordinates session management, model calls, and tool execution.
 * The ReAct loop is now delegated to PiAgent from pi-agent-core.
 */
export class AIRuntime {
  private sessionManager: SessionManager;
  private modelManager: ModelManager;
  private toolExecutor: ToolExecutor;
  protected logger: Logger;
  private concurrencyLimiter: ConcurrencyLimiter;
  private systemPromptCache: string | null = null;
  /** Skill overrides from API (enable/disable, API keys) */
  private skillConfigs: Record<string, import('../skills/types').SkillConfig> = {};
  /** Agent manager for loading per-agent workspace files */
  private agentManager?: import('../agents/AgentManager').AgentManager;

  constructor(
    sessionManager: SessionManager,
    modelManager: ModelManager,
    toolExecutor: ToolExecutor
  ) {
    this.sessionManager = sessionManager;
    this.modelManager = modelManager;
    this.toolExecutor = toolExecutor;
    this.logger = createMaskedLogger();
    this.concurrencyLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_REQUESTS);

    // Watch prompt/skill files for changes and auto-invalidate cache
    watchPromptFiles(() => this.invalidateSystemPrompt());

    this.logger.info('AIRuntime initialized (Pi Agent Core powered)');
  }

  /**
   * Build (or return cached) dynamic system prompt.
   * When agentId is provided and agent has workspace files (SOUL.md, AGENTS.md, etc.),
   * those override the global prompt sections.
   */
  async getSystemPrompt(agentOverrides?: { soul?: string; agents?: string; tools?: string; identity?: string }): Promise<string> {
    // If agent overrides are provided, build a custom prompt (not cached)
    if (agentOverrides && Object.values(agentOverrides).some(v => v)) {
      const sections = await loadPromptSections();
      if (agentOverrides.agents) sections.agents = agentOverrides.agents;
      if (agentOverrides.soul) sections.soul = agentOverrides.soul;
      if (agentOverrides.tools) sections.tools = agentOverrides.tools;
      // Identity is appended to soul as personality extension
      if (agentOverrides.identity && !agentOverrides.soul) {
        sections.soul = (sections.soul || '') + '\n\n' + agentOverrides.identity;
      }
      const snapshot = await resolveSkillsSnapshot(undefined, { skillConfigs: this.skillConfigs });
      sections.skills = snapshot.resolvedSkills?.map(s => parseFrontmatter(s.content).body) ?? [];
      const prompt = assembleSystemPrompt(sections);
      this.logger.info(`Agent-specific system prompt built (${prompt.length} chars, ${sections.skills.length} skills)`);
      return prompt;
    }

    // Global cached prompt
    if (this.systemPromptCache) return this.systemPromptCache;

    const sections = await loadPromptSections();
    const snapshot = await resolveSkillsSnapshot(undefined, { skillConfigs: this.skillConfigs });
    sections.skills = snapshot.resolvedSkills?.map(s => parseFrontmatter(s.content).body) ?? [];
    this.systemPromptCache = assembleSystemPrompt(sections);
    this.logger.info(`System prompt built (${this.systemPromptCache.length} chars, ${sections.skills.length} skills)`);
    return this.systemPromptCache;
  }

  /** Force re-build of the system prompt (e.g. after skill install). */
  invalidateSystemPrompt(): void {
    this.systemPromptCache = null;
  }

  /** Update skill configs (called from API when skills are toggled/configured). */
  setSkillConfigs(configs: Record<string, import('../skills/types').SkillConfig>): void {
    this.skillConfigs = configs;
    this.invalidateSystemPrompt();
  }

  /** Set agent manager for per-agent prompt resolution */
  setAgentManager(mgr: import('../agents/AgentManager').AgentManager): void {
    this.agentManager = mgr;
  }

  /**
   * Load agent workspace file overrides for system prompt.
   * Returns an object with soul/agents/tools/identity content if the agent has custom files.
   */
  private async loadAgentOverrides(agentId: string): Promise<{ soul?: string; agents?: string; tools?: string; identity?: string } | undefined> {
    if (!this.agentManager) return undefined;
    const agent = await this.agentManager.getAgent(agentId);
    if (!agent) return undefined;

    const [soul, agents, tools, identity] = await Promise.all([
      this.agentManager.getFile(agentId, 'SOUL.md'),
      this.agentManager.getFile(agentId, 'AGENTS.md'),
      this.agentManager.getFile(agentId, 'TOOLS.md'),
      this.agentManager.getFile(agentId, 'IDENTITY.md'),
    ]);

    // Only return overrides if at least one file exists
    if (!soul && !agents && !tools && !identity) return undefined;
    return {
      soul: soul || undefined,
      agents: agents || undefined,
      tools: tools || undefined,
      identity: identity || undefined,
    };
  }

  /**
   * Create a ModelProvider instance from a ModelConfig.
   * Supports native providers (openai, anthropic, google) and
   * OpenAI-compatible providers via baseUrl (deepseek, openrouter, together, etc.).
   */
    private createProvider(config: { provider: string; apiKey: string; model: string; maxTokens: number; temperature: number; api?: string; baseUrl?: string }): ModelProvider {
      // Route by API protocol first (if specified), then by provider name
      const api = config.api ?? '';

      // Native Anthropic
      if (api === 'anthropic-messages' || config.provider === 'anthropic') {
        return new AnthropicProvider(config.apiKey, config.model, config.maxTokens, config.temperature);
      }

      // Native Google
      if (api === 'google-generative-ai' || config.provider === 'google') {
        return new GeminiProvider(config.apiKey, config.model, config.maxTokens, config.temperature);
      }

      // OpenAI-compatible: openai, deepseek, openrouter, together, moonshot, doubao, minimax, qianfan, ollama, etc.
      return new OpenAIProvider(config.apiKey, config.model, config.maxTokens, config.temperature, config.baseUrl);
    }

  /**
   * Get the app-level Tool[] to pass to the model provider.
   * If the request specifies explicit tools, use those.
   * Otherwise, derive from all registered ToolExecutor tools.
   */
  private getAppTools(requestTools?: Tool[]): Tool[] {
    if (requestTools && requestTools.length > 0) return requestTools;
    // Build Tool[] from registered ToolExecutor tools
    return this.toolExecutor.getRegisteredToolNames().map(name => this.toolExecutor.getTool(name)!);
  }
  /** Expose model manager for status/introspection */
  getModelManager(): ModelManager {
    return this.modelManager;
  }

  // =========================================================================
  // streamExecute — PiAgent-driven streaming ReAct loop
  // =========================================================================

  async *streamExecute(request: AIRequest): AsyncGenerator<AIResponse> {
    if (!request.sessionId || request.sessionId.trim() === '') {
      throw new ValidationError('sessionId must be a non-empty string');
    }
    if (!request.message || request.message.trim() === '') {
      throw new ValidationError('message must be a non-empty string');
    }

    this.logger.info(`Streaming request for session: ${request.sessionId}, model: ${request.model}`);

    // Load or create session
    let session;
    try {
      session = await this.sessionManager.load(request.sessionId);
    } catch {
      this.logger.info(`Session not found, creating new session: ${request.sessionId}`);
      session = await this.sessionManager.create(
        { model: request.model, totalTokens: 0, cost: 0 },
        request.sessionId,
      );
    }

    // Build PiSession from existing transcript
    const agentOverrides = request.agentId ? await this.loadAgentOverrides(request.agentId) : undefined;
    const systemPrompt = await this.getSystemPrompt(agentOverrides);
    const piSession = new PiSession({
      sessionId: request.sessionId,
      initialTranscript: toTranscript(session.messages),
    });

    // Create model provider + adapter with retry/failover
    const config = this.modelManager.getConfig(request.model);
    const modelProvider = this.createProvider(config);
    const appTools = this.getAppTools(request.tools);
    const piModel = this.createRetryingModelAdapter(modelProvider, request, config.provider, appTools);

    // Build PiTools from registered ToolExecutor tools
    const piTools = toPiTools(this.toolExecutor, request.tools);

    // Context window size for this model
    const contextWindowTokens = this.modelManager.getContextWindowTokens(request.model);

    // Create PiAgent with context window guard
    const agent = new PiAgent({
      model: piModel,
      systemPrompt,
      tools: piTools,
      maxToolCallsPerLoop: MAX_REACT_ITERATIONS,
      contextWindowTokens,
      onContextOverflow: async (sessionId: string) => {
        this.logger.warn(`Context overflow guard triggered for session ${sessionId}. Compacting...`);
        try {
          await this.sessionManager.compact(sessionId);
          return true;
        } catch (err: any) {
          this.logger.error(`Compaction failed: ${err.message}`);
          return false;
        }
      },
    });

    // Run streaming ReAct loop
    let totalTokensUsed = 0;
    for await (const event of agent.runStreaming({
      session: piSession,
      message: request.message,
      abortSignal: request.abortSignal,
    })) {
      if (event.type === 'text_delta') {
        yield {
          text: event.text,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      } else if (event.type === 'tool_call_start') {
        yield {
          text: '',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          toolCalls: [{ id: event.id, name: event.toolName, arguments: event.args }],
        };
      } else if (event.type === 'tool_call_result') {
        yield {
          text: '',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          toolCallResult: { id: event.id, result: event.result, error: event.error },
        };
      } else if (event.type === 'done') {
        totalTokensUsed = event.result.totalTokensUsed;
        yield {
          text: '',
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: totalTokensUsed,
          },
        };
      }
    }

    // Persist updated transcript back to session
    const newTranscript = piSession.getTranscript();
    session.messages = fromTranscript(newTranscript);
    session.metadata.totalTokens += totalTokensUsed;
    session.updatedAt = new Date();
    await this.sessionManager.save(session);

    this.logger.info(`Streaming completed. Tokens used: ${totalTokensUsed}`);
  }

  // =========================================================================
  // execute — PiAgent-driven non-streaming ReAct loop
  // =========================================================================

  async execute(request: AIRequest): Promise<AIResponse> {
    if (!request.sessionId || request.sessionId.trim() === '') {
      throw new ValidationError('sessionId must be a non-empty string');
    }
    if (!request.message || request.message.trim() === '') {
      throw new ValidationError('message must be a non-empty string');
    }

    this.logger.info(`Executing request for session: ${request.sessionId}, model: ${request.model}`);

    // Load or create session
    let session;
    try {
      session = await this.sessionManager.load(request.sessionId);
    } catch (error: any) {
      this.logger.info(`Session not found, creating new session: ${request.sessionId}`);
      session = await this.sessionManager.create(
        { model: request.model, totalTokens: 0, cost: 0 },
        request.sessionId,
      );
    }

    // Build PiSession from existing transcript
    const agentOverrides = request.agentId ? await this.loadAgentOverrides(request.agentId) : undefined;
    const systemPrompt = await this.getSystemPrompt(agentOverrides);
    const piSession = new PiSession({
      sessionId: request.sessionId,
      initialTranscript: toTranscript(session.messages),
    });

    // Create model provider with retry/failover wrapper
    const config = this.modelManager.getConfig(request.model);
    const modelProvider = this.createProvider(config);
    const appTools = this.getAppTools(request.tools);
    const retryingModel = this.createRetryingModelAdapter(
      modelProvider,
      request,
      config.provider,
      appTools,
    );

    // Build PiTools
    const piTools = toPiTools(this.toolExecutor, request.tools);

    // Context window size for this model
    const contextWindowTokens = this.modelManager.getContextWindowTokens(request.model);

    // Create PiAgent with context window guard
    const agent = new PiAgent({
      model: retryingModel,
      systemPrompt,
      tools: piTools,
      maxToolCallsPerLoop: MAX_REACT_ITERATIONS,
      contextWindowTokens,
      onContextOverflow: async (sessionId: string) => {
        this.logger.warn(`Context overflow guard triggered for session ${sessionId}. Compacting...`);
        try {
          await this.sessionManager.compact(sessionId);
          return true;
        } catch (err: any) {
          this.logger.error(`Compaction failed: ${err.message}`);
          return false;
        }
      },
    });

    this.logger.info(`Calling model provider: ${config.provider}/${config.model}`);

    // Run non-streaming ReAct loop
    const result = await agent.run({
      session: piSession,
      message: request.message,
      abortSignal: request.abortSignal,
    });

    // Persist updated transcript back to session
    session.messages = fromTranscript(piSession.getTranscript());
    session.metadata.totalTokens += result.totalTokensUsed;
    session.updatedAt = new Date();
    await this.sessionManager.save(session);

    this.logger.info(`Request completed. Tokens used: ${result.totalTokensUsed}`);

    return {
      text: result.finalText,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: result.totalTokensUsed,
      },
    };
  }

  // =========================================================================
  // Retry / failover helpers
  // =========================================================================

  /**
   * Create a PiModelProvider adapter that wraps call() with retry + failover.
   */
  private createRetryingModelAdapter(
    provider: ModelProvider,
    request: AIRequest,
    providerType: string,
    appTools?: Tool[],
  ): ModelProviderAdapter {
    const adapter = new ModelProviderAdapter(provider, appTools);

    // Override call() with retry logic
    const originalCall = adapter.call.bind(adapter);
    adapter.call = async (messages) => {
      const failoverFn = this.buildFailoverFn(providerType, request.model, messages, appTools);
      return this.executeWithRetry(
        () => this.concurrencyLimiter.run(() => originalCall(messages)),
        request.sessionId,
        providerType,
        request.model,
        failoverFn,
        messages,
        appTools,
      );
    };

    return adapter;
  }

  /**
   * Build a failover function that tries the cross-provider fallback chain.
   * OpenPilot equivalent: runWithModelFallback()
   */
  private buildFailoverFn(
    provider: string,
    currentModel: string,
    messages: any[],
    tools?: Tool[],
  ): (() => Promise<any>) | undefined {
    // Get cross-provider fallback candidates
    const candidates = this.modelManager.getFallbackCandidates(currentModel);
    if (candidates.length === 0) return undefined;

    return async () => {
      for (const fallbackModel of candidates) {
        try {
          this.logger.info(`Model failover: ${currentModel} → ${fallbackModel}`);
          const fallbackConfig = this.modelManager.getConfig(fallbackModel);
          const fallbackProvider = this.createProvider(fallbackConfig);
          const fallbackAdapter = new ModelProviderAdapter(fallbackProvider, tools);
          return await this.concurrencyLimiter.run(() => fallbackAdapter.call(messages));
        } catch (err: any) {
          this.logger.warn(`Fallback model ${fallbackModel} also failed: ${err.message}`);
          continue;
        }
      }
      throw new Error(`All fallback models exhausted after trying: ${candidates.join(', ')}`);
    };
  }

  /**
   * Execute a model call with retry logic, auth profile rotation, and model failover.
   *
   * OpenPilot alignment:
   * - Auth errors → rotate to next AuthProfile
   * - Rate limits → mark profile, try next profile, then failover
   * - Context overflow → compact session and retry
   * - Network errors → simple retry with backoff
   */
  private async executeWithRetry(
    fn: () => Promise<any>,
    sessionId: string,
    providerType: string,
    modelName: string,
    failoverFn?: () => Promise<any>,
    messages?: any[],
    appTools?: Tool[],
  ): Promise<any> {
    let rateLimitAttempts = 0;
    let networkAttempts = 0;
    let contextOverflowRetried = false;
    let authRotationAttempts = 0;
    const maxAuthRotations = this.modelManager.getAuthProfileCount(providerType);

    const attempt = async (): Promise<any> => {
      try {
        return await fn();
      } catch (error: any) {
        this.logger.error(`Model call error: ${error.message}`, { errorName: error.name });

        // --- Auth error → rotate auth profile ---
        if (error instanceof AuthenticationError) {
          this.modelManager.markAuthProfileFailure(providerType, 'auth');

          if (authRotationAttempts < maxAuthRotations - 1) {
            const newKey = this.modelManager.advanceAuthProfile(providerType);
            if (newKey) {
              authRotationAttempts++;
              this.logger.warn(`Auth failed. Rotating to next auth profile (attempt ${authRotationAttempts}/${maxAuthRotations})`);
              // Rebuild provider with new key, preserving original messages
              const newConfig = this.modelManager.getConfig(modelName);
              const newProvider = this.createProvider(newConfig);
              const newAdapter = new ModelProviderAdapter(newProvider, appTools);
              fn = () => this.concurrencyLimiter.run(() => newAdapter.call(messages!));
              return attempt();
            }
          }

          // If rotation exhausted or no profiles, try cross-provider failover
          if (failoverFn) {
            this.logger.warn('Auth profile rotation exhausted. Attempting cross-provider failover...');
            try {
              return await failoverFn();
            } catch (failoverError: any) {
              this.logger.error(`Cross-provider failover also failed: ${failoverError.message}`);
            }
          }
          throw new Error('Authentication failed. All auth profiles and fallback models exhausted.');
        }

        // --- Rate limit → mark profile, backoff, rotate, then failover ---
        if (error instanceof RateLimitError) {
          this.modelManager.markAuthProfileFailure(providerType, 'rate_limit');

          if (rateLimitAttempts >= MAX_RETRIES) {
            // Try rotating auth profile first
            const newKey = this.modelManager.advanceAuthProfile(providerType);
            if (newKey) {
              this.logger.warn('Rate limit retries exhausted. Rotating auth profile...');
              rateLimitAttempts = 0; // Reset for new profile
              return attempt();
            }

            // Then try cross-provider failover
            if (failoverFn) {
              this.logger.warn('Rate limit retries exhausted. Attempting cross-provider failover...');
              try {
                return await failoverFn();
              } catch (failoverError: any) {
                this.logger.error(`Cross-provider failover also failed: ${failoverError.message}`);
              }
            }
            throw new Error('Rate limit exceeded. All retry attempts, auth profiles, and fallback models exhausted.');
          }
          const delay = error.retryAfter != null
            ? error.retryAfter * 1000
            : RATE_LIMIT_BACKOFF_MS[rateLimitAttempts] ?? RATE_LIMIT_BACKOFF_MS[RATE_LIMIT_BACKOFF_MS.length - 1];
          this.logger.warn(`Rate limit hit. Retrying in ${delay}ms (attempt ${rateLimitAttempts + 1}/${MAX_RETRIES})`);
          await sleep(delay);
          rateLimitAttempts++;
          return attempt();
        }

        // --- Network error → simple retry ---
        if (error instanceof NetworkError) {
          if (networkAttempts >= MAX_RETRIES) {
            throw new Error('Network connection failed. All retry attempts failed.');
          }
          this.logger.warn(`Network error. Retrying in ${NETWORK_RETRY_INTERVAL_MS}ms (attempt ${networkAttempts + 1}/${MAX_RETRIES})`);
          await sleep(NETWORK_RETRY_INTERVAL_MS);
          networkAttempts++;
          return attempt();
        }

        // --- Context overflow → compact and retry ---
        if (error instanceof ContextOverflowError) {
          if (contextOverflowRetried) {
            throw new Error('Context overflow. Session compaction did not resolve the issue.');
          }
          this.logger.warn(`Context overflow for session ${sessionId}. Compacting and retrying.`);
          await this.sessionManager.compact(sessionId);
          contextOverflowRetried = true;
          return attempt();
        }

        throw error;
      }
    };

    return attempt();
  }
}

export { maskSensitiveData };
