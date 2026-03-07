/**
 * Model Manager
 * Manages AI model providers, auth profiles, and fallback chains.
 *
 * OpenClaw-aligned enhancements:
 * - Extended model registry (30+ models across 10+ providers)
 * - Implicit provider discovery from environment variables
 * - "provider/model" ref format support
 * - Model catalog API for frontend consumption
 * - Auth profile rotation with cooldown
 * - Cross-provider fallback chains
 * - Context window metadata per model
 */

import {
  ModelConfig,
  ModelProviderType,
  ModelApi,
  ModelCatalogEntry,
  ModelRef,
  ValidationError,
  parseModelRef,
  formatModelRef,
} from '../types';

// ---------------------------------------------------------------------------
// Auth Profile (OpenClaw: AuthProfileStore)
// ---------------------------------------------------------------------------

export interface AuthProfile {
  id: string;
  provider: string;
  apiKey: string;
  cooldownUntil?: number;
  failureType?: 'auth' | 'rate_limit' | 'billing' | 'timeout';
}

// ---------------------------------------------------------------------------
// Model metadata registry
// ---------------------------------------------------------------------------

export interface ModelMeta {
  provider: string;
  modelId: string;
  name: string;
  api: ModelApi;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow: number;
  defaultMaxTokens: number;
  defaultTemperature: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

interface ProviderMeta {
  id: string;
  label: string;
  envVar: string;
  /** Additional env vars to check */
  altEnvVars?: string[];
  defaultApi: ModelApi;
  defaultBaseUrl?: string;
}

const PROVIDER_REGISTRY: ProviderMeta[] = [
  { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', defaultApi: 'openai-completions' },
  { id: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', defaultApi: 'anthropic-messages' },
  { id: 'google', label: 'Google', envVar: 'GOOGLE_AI_API_KEY', altEnvVars: ['GOOGLE_API_KEY'], defaultApi: 'google-generative-ai' },
  { id: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY', defaultApi: 'openai-completions', defaultBaseUrl: 'https://api.deepseek.com/v1' },
  { id: 'ollama', label: 'Ollama', envVar: 'OLLAMA_API_KEY', defaultApi: 'openai-completions', defaultBaseUrl: 'http://localhost:11434/v1' },
  { id: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY', defaultApi: 'openai-completions', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'together', label: 'Together AI', envVar: 'TOGETHER_API_KEY', defaultApi: 'openai-completions', defaultBaseUrl: 'https://api.together.xyz/v1' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', envVar: 'MOONSHOT_API_KEY', defaultApi: 'openai-completions', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'doubao', label: '豆包 (Doubao)', envVar: 'DOUBAO_API_KEY', defaultApi: 'openai-completions', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'minimax', label: 'MiniMax', envVar: 'MINIMAX_API_KEY', defaultApi: 'openai-completions', defaultBaseUrl: 'https://api.minimax.chat/v1' },
  { id: 'qianfan', label: '百度千帆', envVar: 'QIANFAN_API_KEY', defaultApi: 'openai-completions', defaultBaseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1' },
];

/**
 * Built-in model registry — known models with metadata.
 * Models from providers with detected API keys are auto-configured.
 */
const MODEL_REGISTRY: ModelMeta[] = [
  // --- OpenAI ---
  { provider: 'openai', modelId: 'gpt-4o', name: 'GPT-4o', api: 'openai-completions', reasoning: false, input: ['text', 'image'], contextWindow: 128_000, defaultMaxTokens: 4096, defaultTemperature: 0.7, cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 } },
  { provider: 'openai', modelId: 'gpt-4o-mini', name: 'GPT-4o Mini', api: 'openai-completions', reasoning: false, input: ['text', 'image'], contextWindow: 128_000, defaultMaxTokens: 4096, defaultTemperature: 0.7, cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 } },
  { provider: 'openai', modelId: 'gpt-4', name: 'GPT-4', api: 'openai-completions', reasoning: false, input: ['text'], contextWindow: 8_192, defaultMaxTokens: 2000, defaultTemperature: 0.7, cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 } },
  { provider: 'openai', modelId: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', api: 'openai-completions', reasoning: false, input: ['text'], contextWindow: 16_385, defaultMaxTokens: 2000, defaultTemperature: 0.7, cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 } },
  { provider: 'openai', modelId: 'o1', name: 'o1', api: 'openai-completions', reasoning: true, input: ['text', 'image'], contextWindow: 200_000, defaultMaxTokens: 100_000, defaultTemperature: 1, cost: { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 } },
  { provider: 'openai', modelId: 'o1-mini', name: 'o1 Mini', api: 'openai-completions', reasoning: true, input: ['text'], contextWindow: 128_000, defaultMaxTokens: 65_536, defaultTemperature: 1, cost: { input: 3, output: 12, cacheRead: 1.5, cacheWrite: 0 } },
  { provider: 'openai', modelId: 'o3-mini', name: 'o3 Mini', api: 'openai-completions', reasoning: true, input: ['text'], contextWindow: 200_000, defaultMaxTokens: 100_000, defaultTemperature: 1, cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 } },
  // --- Anthropic ---
  { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', api: 'anthropic-messages', reasoning: true, input: ['text', 'image'], contextWindow: 200_000, defaultMaxTokens: 8192, defaultTemperature: 0.5, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { provider: 'anthropic', modelId: 'claude-opus-4-20250514', name: 'Claude Opus 4', api: 'anthropic-messages', reasoning: true, input: ['text', 'image'], contextWindow: 200_000, defaultMaxTokens: 8192, defaultTemperature: 0.5, cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', api: 'anthropic-messages', reasoning: false, input: ['text', 'image'], contextWindow: 200_000, defaultMaxTokens: 8192, defaultTemperature: 0.5, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { provider: 'anthropic', modelId: 'claude-3-opus-20240229', name: 'Claude 3 Opus', api: 'anthropic-messages', reasoning: false, input: ['text', 'image'], contextWindow: 200_000, defaultMaxTokens: 4096, defaultTemperature: 0.5, cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { provider: 'anthropic', modelId: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', api: 'anthropic-messages', reasoning: false, input: ['text', 'image'], contextWindow: 200_000, defaultMaxTokens: 4096, defaultTemperature: 0.5, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { provider: 'anthropic', modelId: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', api: 'anthropic-messages', reasoning: false, input: ['text', 'image'], contextWindow: 200_000, defaultMaxTokens: 4096, defaultTemperature: 0.5, cost: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 } },
  // --- Google ---
  { provider: 'google', modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', api: 'google-generative-ai', reasoning: true, input: ['text', 'image'], contextWindow: 1_000_000, defaultMaxTokens: 8192, defaultTemperature: 0.7, cost: { input: 1.25, output: 10, cacheRead: 0.315, cacheWrite: 0 } },
  { provider: 'google', modelId: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', api: 'google-generative-ai', reasoning: true, input: ['text', 'image'], contextWindow: 1_000_000, defaultMaxTokens: 8192, defaultTemperature: 0.7, cost: { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0 } },
  { provider: 'google', modelId: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', api: 'google-generative-ai', reasoning: false, input: ['text', 'image'], contextWindow: 1_000_000, defaultMaxTokens: 8192, defaultTemperature: 0.7, cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 } },
  { provider: 'google', modelId: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', api: 'google-generative-ai', reasoning: false, input: ['text', 'image'], contextWindow: 1_000_000, defaultMaxTokens: 4000, defaultTemperature: 0.7, cost: { input: 1.25, output: 5, cacheRead: 0.315, cacheWrite: 0 } },
  { provider: 'google', modelId: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', api: 'google-generative-ai', reasoning: false, input: ['text', 'image'], contextWindow: 1_000_000, defaultMaxTokens: 4000, defaultTemperature: 0.7, cost: { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 } },
  // --- DeepSeek ---
  { provider: 'deepseek', modelId: 'deepseek-chat', name: 'DeepSeek V3', api: 'openai-completions', reasoning: false, input: ['text'], contextWindow: 64_000, defaultMaxTokens: 4096, defaultTemperature: 0.7, cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 } },
  { provider: 'deepseek', modelId: 'deepseek-reasoner', name: 'DeepSeek R1', api: 'openai-completions', reasoning: true, input: ['text'], contextWindow: 64_000, defaultMaxTokens: 8192, defaultTemperature: 0.7, cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 } },
];

// Legacy model name → new ref mapping (backward compatibility)
const LEGACY_MODEL_MAP: Record<string, string> = {
  'gpt-3.5-turbo': 'openai/gpt-3.5-turbo',
  'gpt-4': 'openai/gpt-4',
  'claude-3-sonnet': 'anthropic/claude-3-sonnet-20240229',
  'claude-3-opus': 'anthropic/claude-3-opus-20240229',
  'gemini-1.5-pro': 'google/gemini-1.5-pro',
  'gemini-1.5-flash': 'google/gemini-1.5-flash',
};

const COOLDOWN_DURATION_MS: Record<string, number> = {
  auth: 60_000 * 60,
  rate_limit: 60_000,
  billing: 60_000 * 60,
  timeout: 30_000,
};

// ---------------------------------------------------------------------------
// ModelManager
// ---------------------------------------------------------------------------

export class ModelManager {
  private configs: Map<string, ModelConfig> = new Map();
  private currentModel: string | null = null;

  /** Multiple API keys per provider for rotation */
  private authProfiles: Map<string, AuthProfile[]> = new Map();
  private activeProfileIndex: Map<string, number> = new Map();
  private fallbackChain: string[] = [];

  /** Extended model metadata index: "provider/modelId" → ModelMeta */
  private modelIndex: Map<string, ModelMeta> = new Map();
  /** Provider metadata index */
  private providerIndex: Map<string, ProviderMeta> = new Map();
  /** Detected providers (have API keys) */
  private detectedProviders: Set<string> = new Set();

  constructor() {
    this.initializeProviderIndex();
    this.discoverImplicitProviders();
    this.initializeModelIndex();
    this.initializeDefaultConfigs();
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  private initializeProviderIndex(): void {
    for (const p of PROVIDER_REGISTRY) {
      this.providerIndex.set(p.id, p);
    }
  }

  /**
   * Scan environment variables to discover available providers.
   * OpenClaw: resolveImplicitProviders
   */
  private discoverImplicitProviders(): void {
    for (const p of PROVIDER_REGISTRY) {
      const envVars = [p.envVar, ...(p.altEnvVars ?? [])];
      for (const ev of envVars) {
        const val = process.env[ev];
        if (val) {
          this.detectedProviders.add(p.id);
          this.registerAuthProfiles(p.id, val);
          break;
        }
      }
    }
    // Ollama: always detected if running locally (no key needed)
    if (!this.detectedProviders.has('ollama') && process.env.OLLAMA_HOST) {
      this.detectedProviders.add('ollama');
    }
  }

  private initializeModelIndex(): void {
    for (const m of MODEL_REGISTRY) {
      const ref = `${m.provider}/${m.modelId}`;
      this.modelIndex.set(ref, m);
    }
  }

  private initializeDefaultConfigs(): void {
    // Build configs for all models whose provider is detected
    for (const m of MODEL_REGISTRY) {
      if (!this.detectedProviders.has(m.provider)) continue;
      const key = this.getActiveApiKey(m.provider);
      if (!key && m.provider !== 'ollama') continue;

      const ref = `${m.provider}/${m.modelId}`;
      const providerMeta = this.providerIndex.get(m.provider);
      this.configs.set(ref, {
        provider: m.provider,
        model: m.modelId,
        apiKey: key ?? '',
        maxTokens: m.defaultMaxTokens,
        temperature: m.defaultTemperature,
        api: m.api,
        baseUrl: providerMeta?.defaultBaseUrl,
      });

      // Also register under legacy short name for backward compat
      const legacyEntry = Object.entries(LEGACY_MODEL_MAP).find(([, v]) => v === ref);
      if (legacyEntry) {
        this.configs.set(legacyEntry[0], {
          provider: m.provider,
          model: m.modelId,
          apiKey: key ?? '',
          maxTokens: m.defaultMaxTokens,
          temperature: m.defaultTemperature,
          api: m.api,
          baseUrl: providerMeta?.defaultBaseUrl,
        });
      }
    }

    // Build default fallback chain
    const fallbackOrder = [
      'anthropic/claude-sonnet-4-20250514',
      'openai/gpt-4o',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat',
      'openai/gpt-4o-mini',
      'anthropic/claude-3-haiku-20240307',
    ];
    this.fallbackChain = fallbackOrder.filter(m => this.configs.has(m));
  }

  private registerAuthProfiles(provider: string, keyString: string): void {
    const keys = keyString.split(',').map(k => k.trim()).filter(Boolean);
    const profiles: AuthProfile[] = keys.map((key, i) => ({
      id: `${provider}-${i}`,
      provider,
      apiKey: key,
    }));
    this.authProfiles.set(provider, profiles);
    this.activeProfileIndex.set(provider, 0);
  }

  // -----------------------------------------------------------------------
  // Model Catalog (OpenClaw: loadModelCatalog)
  // -----------------------------------------------------------------------

  /**
   * Get the full model catalog for UI consumption.
   * Returns all known models with their configuration status.
   */
  getModelCatalog(): ModelCatalogEntry[] {
    const entries: ModelCatalogEntry[] = [];
    for (const m of MODEL_REGISTRY) {
      const ref = `${m.provider}/${m.modelId}`;
      const providerMeta = this.providerIndex.get(m.provider);
      entries.push({
        ref,
        provider: m.provider,
        modelId: m.modelId,
        name: m.name,
        api: m.api,
        reasoning: m.reasoning,
        input: m.input,
        contextWindow: m.contextWindow,
        maxTokens: m.defaultMaxTokens,
        cost: m.cost,
        configured: this.configs.has(ref),
        providerLabel: providerMeta?.label,
      });
    }
    return entries.sort((a, b) => {
      // Configured first, then by provider, then by name
      if (a.configured !== b.configured) return a.configured ? -1 : 1;
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get only configured (usable) models.
   */
  getConfiguredCatalog(): ModelCatalogEntry[] {
    return this.getModelCatalog().filter(e => e.configured);
  }

  /**
   * Get detected provider info.
   */
  getProviderStatus(): Array<{ id: string; label: string; detected: boolean; profileCount: number; maskedKey?: string }> {
    return PROVIDER_REGISTRY.map(p => {
      const key = this.getActiveApiKey(p.id);
      return {
        id: p.id,
        label: p.label,
        detected: this.detectedProviders.has(p.id),
        profileCount: this.authProfiles.get(p.id)?.length ?? 0,
        maskedKey: key ? '••••' + key.slice(-4) : undefined,
      };
    });
  }

  // -----------------------------------------------------------------------
  // Model ref resolution (OpenClaw: resolveModel)
  // -----------------------------------------------------------------------

  /**
   * Resolve a model string to a ModelConfig.
   * Supports: "provider/model", legacy short names, and direct model IDs.
   */
  resolveModelRef(raw: string): ModelRef {
    // Check legacy mapping first
    const mapped = LEGACY_MODEL_MAP[raw];
    if (mapped) return parseModelRef(mapped);
    return parseModelRef(raw);
  }

  // -----------------------------------------------------------------------
  // Auth Profile rotation
  // -----------------------------------------------------------------------

  getActiveApiKey(provider: string): string | undefined {
    const profiles = this.authProfiles.get(provider);
    if (!profiles || profiles.length === 0) return undefined;
    const idx = this.activeProfileIndex.get(provider) ?? 0;
    return profiles[idx]?.apiKey;
  }

  advanceAuthProfile(provider: string): string | undefined {
    const profiles = this.authProfiles.get(provider);
    if (!profiles || profiles.length <= 1) return undefined;

    const currentIdx = this.activeProfileIndex.get(provider) ?? 0;
    const now = Date.now();

    for (let offset = 1; offset < profiles.length; offset++) {
      const nextIdx = (currentIdx + offset) % profiles.length;
      const profile = profiles[nextIdx];

      if (profile.cooldownUntil && profile.cooldownUntil > now) continue;
      if (profile.cooldownUntil && profile.cooldownUntil <= now) {
        profile.cooldownUntil = undefined;
        profile.failureType = undefined;
      }

      this.activeProfileIndex.set(provider, nextIdx);

      // Update all model configs for this provider
      for (const [, config] of this.configs) {
        if (config.provider === provider) {
          config.apiKey = profile.apiKey;
        }
      }
      return profile.apiKey;
    }
    return undefined;
  }

  markAuthProfileFailure(provider: string, failureType: 'auth' | 'rate_limit' | 'billing' | 'timeout'): void {
    const profiles = this.authProfiles.get(provider);
    if (!profiles) return;
    const idx = this.activeProfileIndex.get(provider) ?? 0;
    const profile = profiles[idx];
    if (profile) {
      profile.failureType = failureType;
      profile.cooldownUntil = Date.now() + (COOLDOWN_DURATION_MS[failureType] ?? 60_000);
    }
  }

  getAuthProfileCount(provider: string): number {
    return this.authProfiles.get(provider)?.length ?? 0;
  }

  // -----------------------------------------------------------------------
  // Model fallback chain
  // -----------------------------------------------------------------------

  setFallbackChain(models: string[]): void {
    this.fallbackChain = models.filter(m => this.configs.has(m));
  }

  getFallbackCandidates(primaryModel: string): string[] {
    return this.fallbackChain.filter(m => m !== primaryModel);
  }

  // -----------------------------------------------------------------------
  // Context window
  // -----------------------------------------------------------------------

  getContextWindowTokens(model: string): number {
    // Try full ref first
    const meta = this.modelIndex.get(model);
    if (meta) return meta.contextWindow;
    // Try resolving
    const ref = this.resolveModelRef(model);
    const refStr = formatModelRef(ref);
    const resolved = this.modelIndex.get(refStr);
    return resolved?.contextWindow ?? 128_000;
  }

  // -----------------------------------------------------------------------
  // Backward-compatible API
  // -----------------------------------------------------------------------

  getConfig(model: string): ModelConfig {
    // Direct lookup
    const direct = this.configs.get(model);
    if (direct) return direct;

    // Try resolving ref
    const ref = this.resolveModelRef(model);
    const refStr = formatModelRef(ref);
    const resolved = this.configs.get(refStr);
    if (resolved) return resolved;

    // Not found — build helpful error
    const configured = this.getConfiguredModels();
    if (configured.length === 0) {
      throw new ValidationError(
        `Model '${model}' is not configured. No API keys detected. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.`
      );
    }
    throw new ValidationError(
      `Model '${model}' is not configured. Available: ${configured.slice(0, 10).join(', ')}${configured.length > 10 ? '...' : ''}`
    );
  }

  validateConfig(config: ModelConfig): boolean {
    try {
      if (!config.model || typeof config.model !== 'string' || config.model.trim() === '') return false;
      if (!config.provider || typeof config.provider !== 'string') return false;
      if (!config.apiKey || typeof config.apiKey !== 'string' || config.apiKey.trim() === '') {
        // Ollama doesn't need an API key
        if (config.provider !== 'ollama') return false;
      }
      if (!Number.isFinite(config.maxTokens) || config.maxTokens <= 0) return false;
      if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2) return false;
      return true;
    } catch {
      return false;
    }
  }

  switchModel(model: string): void {
    this.getConfig(model); // validates existence
    this.currentModel = model;
  }

  getCurrentModel(): string | null {
    return this.currentModel;
  }

  addConfig(config: ModelConfig): void {
    const ref = `${config.provider}/${config.model}`;
    this.configs.set(ref, config);
    // Also set under short name for backward compat
    this.configs.set(config.model, config);
  }

  getSupportedModels(): string[] {
    return MODEL_REGISTRY.map(m => `${m.provider}/${m.modelId}`);
  }

  getConfiguredModels(): string[] {
    // Return unique refs (skip legacy short-name duplicates)
    const refs = new Set<string>();
    for (const [key, config] of this.configs) {
      if (key.includes('/')) {
        refs.add(key);
      } else {
        refs.add(`${config.provider}/${config.model}`);
      }
    }
    return [...refs];
  }

  /**
   * Register a custom model at runtime (e.g. from config file providers).
   */
  registerModel(meta: ModelMeta, apiKey?: string): void {
    const ref = `${meta.provider}/${meta.modelId}`;
    this.modelIndex.set(ref, meta);

    const key = apiKey ?? this.getActiveApiKey(meta.provider) ?? '';
    if (key || meta.provider === 'ollama') {
      const providerMeta = this.providerIndex.get(meta.provider);
      this.configs.set(ref, {
        provider: meta.provider,
        model: meta.modelId,
        apiKey: key,
        maxTokens: meta.defaultMaxTokens,
        temperature: meta.defaultTemperature,
        api: meta.api,
        baseUrl: providerMeta?.defaultBaseUrl,
      });
    }
  }

  /**
   * Register a provider with API key at runtime.
   */
  registerProvider(providerId: string, apiKey: string): void {
    this.detectedProviders.add(providerId);
    this.registerAuthProfiles(providerId, apiKey);

    // Auto-configure all known models for this provider
    for (const m of MODEL_REGISTRY) {
      if (m.provider !== providerId) continue;
      const ref = `${m.provider}/${m.modelId}`;
      if (this.configs.has(ref)) continue;
      const providerMeta = this.providerIndex.get(m.provider);
      this.configs.set(ref, {
        provider: m.provider,
        model: m.modelId,
        apiKey,
        maxTokens: m.defaultMaxTokens,
        temperature: m.defaultTemperature,
        api: m.api,
        baseUrl: providerMeta?.defaultBaseUrl,
      });
    }
  }
}
