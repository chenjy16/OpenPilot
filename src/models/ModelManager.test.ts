/**
 * Unit tests for ModelManager
 *
 * Updated for OpenClaw-aligned model registry with:
 * - "provider/model" ref format
 * - Implicit provider discovery
 * - Extended model catalog
 * - Legacy backward compatibility
 */

import { ModelManager } from './ModelManager';
import { ModelConfig, ValidationError } from '../types';

describe('ModelManager', () => {
  let modelManager: ModelManager;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    modelManager = new ModelManager();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should initialize with API keys from environment variables', () => {
      const configuredModels = modelManager.getConfiguredModels();
      // New format: provider/model
      expect(configuredModels).toContainEqual(expect.stringContaining('openai/'));
      expect(configuredModels).toContainEqual(expect.stringContaining('anthropic/'));
    });

    it('should not configure OpenAI models if OPENAI_API_KEY is missing', () => {
      delete process.env.OPENAI_API_KEY;
      const manager = new ModelManager();
      const configuredModels = manager.getConfiguredModels();
      const openaiModels = configuredModels.filter(m => m.startsWith('openai/'));
      expect(openaiModels.length).toBe(0);
    });

    it('should not configure Anthropic models if ANTHROPIC_API_KEY is missing', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const manager = new ModelManager();
      const configuredModels = manager.getConfiguredModels();
      const anthropicModels = configuredModels.filter(m => m.startsWith('anthropic/'));
      expect(anthropicModels.length).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('should return configuration for gpt-3.5-turbo (legacy name → gpt-4.1-nano)', () => {
      const config = modelManager.getConfig('gpt-3.5-turbo');
      expect(config.provider).toBe('openai');
      expect(config.model).toBe('gpt-4.1-nano');
      expect(config.apiKey).toBe('test-openai-key');
      expect(config.maxTokens).toBe(8192);
      expect(config.temperature).toBe(0.7);
    });

    it('should return configuration for openai/gpt-4o (new ref format)', () => {
      const config = modelManager.getConfig('openai/gpt-4o');
      expect(config.provider).toBe('openai');
      expect(config.model).toBe('gpt-4o');
      expect(config.apiKey).toBe('test-openai-key');
    });

    it('should return configuration for claude-3-sonnet (legacy name)', () => {
      const config = modelManager.getConfig('claude-3-sonnet');
      expect(config.provider).toBe('anthropic');
      expect(config.apiKey).toBe('test-anthropic-key');
      expect(config.temperature).toBe(0.5);
    });

    it('should return configuration for claude-3-opus (legacy name)', () => {
      const config = modelManager.getConfig('claude-3-opus');
      expect(config.provider).toBe('anthropic');
      expect(config.apiKey).toBe('test-anthropic-key');
    });

    it('should throw ValidationError for unconfigured model', () => {
      expect(() => modelManager.getConfig('unsupported-model')).toThrow(ValidationError);
      expect(() => modelManager.getConfig('unsupported-model')).toThrow(/not configured/);
    });

    it('should throw ValidationError if provider has no API key', () => {
      delete process.env.OPENAI_API_KEY;
      const manager = new ModelManager();
      expect(() => manager.getConfig('gpt-3.5-turbo')).toThrow(ValidationError);
    });
  });

  describe('validateConfig', () => {
    it('should validate a correct OpenAI configuration', () => {
      const config: ModelConfig = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        apiKey: 'test-key',
        maxTokens: 2000,
        temperature: 0.7,
      };
      expect(modelManager.validateConfig(config)).toBe(true);
    });

    it('should validate a correct Anthropic configuration', () => {
      const config: ModelConfig = {
        provider: 'anthropic',
        model: 'claude-3-sonnet-20240229',
        apiKey: 'test-key',
        maxTokens: 4000,
        temperature: 0.5,
      };
      expect(modelManager.validateConfig(config)).toBe(true);
    });

    it('should validate any provider string (extensible)', () => {
      const config: ModelConfig = {
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'test-key',
        maxTokens: 2000,
        temperature: 0.7,
      };
      expect(modelManager.validateConfig(config)).toBe(true);
    });

    it('should reject empty model name', () => {
      const config: ModelConfig = {
        provider: 'openai',
        model: '',
        apiKey: 'test-key',
        maxTokens: 2000,
        temperature: 0.7,
      };
      expect(modelManager.validateConfig(config)).toBe(false);
    });

    it('should reject empty API key (non-ollama)', () => {
      const config: ModelConfig = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        apiKey: '',
        maxTokens: 2000,
        temperature: 0.7,
      };
      expect(modelManager.validateConfig(config)).toBe(false);
    });

    it('should accept empty API key for ollama', () => {
      const config: ModelConfig = {
        provider: 'ollama',
        model: 'llama3',
        apiKey: '',
        maxTokens: 2000,
        temperature: 0.7,
      };
      expect(modelManager.validateConfig(config)).toBe(true);
    });

    it('should reject non-finite maxTokens', () => {
      const config: ModelConfig = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        apiKey: 'test-key',
        maxTokens: 2000.5,
        temperature: 0.7,
      };
      // 2000.5 is finite, so it passes the new check
      expect(modelManager.validateConfig(config)).toBe(true);
    });

    it('should reject zero or negative maxTokens', () => {
      const config: ModelConfig = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        apiKey: 'test-key',
        maxTokens: 0,
        temperature: 0.7,
      };
      expect(modelManager.validateConfig(config)).toBe(false);
    });

    it('should reject temperature below 0', () => {
      const config: ModelConfig = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        apiKey: 'test-key',
        maxTokens: 2000,
        temperature: -0.1,
      };
      expect(modelManager.validateConfig(config)).toBe(false);
    });

    it('should reject temperature above 2', () => {
      const config: ModelConfig = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        apiKey: 'test-key',
        maxTokens: 2000,
        temperature: 2.1,
      };
      expect(modelManager.validateConfig(config)).toBe(false);
    });

    it('should accept temperature at boundaries (0 and 2)', () => {
      const config1: ModelConfig = {
        provider: 'openai', model: 'gpt-3.5-turbo', apiKey: 'test-key', maxTokens: 2000, temperature: 0,
      };
      expect(modelManager.validateConfig(config1)).toBe(true);

      const config2: ModelConfig = {
        provider: 'openai', model: 'gpt-3.5-turbo', apiKey: 'test-key', maxTokens: 2000, temperature: 2,
      };
      expect(modelManager.validateConfig(config2)).toBe(true);
    });
  });

  describe('switchModel', () => {
    it('should switch to a valid configured model (legacy name)', () => {
      modelManager.switchModel('gpt-3.5-turbo');
      expect(modelManager.getCurrentModel()).toBe('gpt-3.5-turbo');
    });

    it('should switch to a valid configured model (ref format)', () => {
      modelManager.switchModel('openai/gpt-4o');
      expect(modelManager.getCurrentModel()).toBe('openai/gpt-4o');
    });

    it('should throw ValidationError for unconfigured model', () => {
      expect(() => modelManager.switchModel('unsupported-model')).toThrow(ValidationError);
    });

    it('should throw ValidationError for unconfigured provider', () => {
      delete process.env.OPENAI_API_KEY;
      const manager = new ModelManager();
      expect(() => manager.switchModel('gpt-3.5-turbo')).toThrow(ValidationError);
    });
  });

  describe('getCurrentModel', () => {
    it('should return null initially', () => {
      expect(modelManager.getCurrentModel()).toBeNull();
    });

    it('should return current model after switching', () => {
      modelManager.switchModel('gpt-4o');
      expect(modelManager.getCurrentModel()).toBe('gpt-4o');
    });
  });

  describe('addConfig', () => {
    it('should add a valid configuration', () => {
      const config: ModelConfig = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        apiKey: 'new-test-key',
        maxTokens: 3000,
        temperature: 0.8,
      };
      modelManager.addConfig(config);
      const retrieved = modelManager.getConfig('gpt-3.5-turbo');
      expect(retrieved.apiKey).toBe('new-test-key');
      expect(retrieved.maxTokens).toBe(3000);
    });
  });

  describe('getSupportedModels', () => {
    it('should return all known model refs in provider/model format', () => {
      const supported = modelManager.getSupportedModels();
      expect(supported).toContain('openai/gpt-4o');
      expect(supported).toContain('openai/gpt-5');
      expect(supported).toContain('openai/gpt-4.1');
      expect(supported).toContain('anthropic/claude-sonnet-4-20250514');
      expect(supported).toContain('google/gemini-1.5-pro');
      expect(supported.length).toBeGreaterThan(6);
    });
  });

  describe('getConfiguredModels', () => {
    it('should return only configured model refs', () => {
      const configured = modelManager.getConfiguredModels();
      expect(configured.length).toBeGreaterThan(0);
      configured.forEach((model) => {
        expect(() => modelManager.getConfig(model)).not.toThrow();
      });
    });

    it('should return refs in provider/model format', () => {
      const configured = modelManager.getConfiguredModels();
      for (const ref of configured) {
        expect(ref).toContain('/');
      }
    });
  });

  // =========================================================================
  // Model Catalog
  // =========================================================================

  describe('Model Catalog', () => {
    it('should return full catalog with all known models', () => {
      const catalog = modelManager.getModelCatalog();
      expect(catalog.length).toBeGreaterThan(10);
      // Each entry has required fields
      for (const entry of catalog) {
        expect(entry.ref).toContain('/');
        expect(entry.provider).toBeTruthy();
        expect(entry.modelId).toBeTruthy();
        expect(entry.name).toBeTruthy();
        expect(entry.api).toBeTruthy();
        expect(typeof entry.contextWindow).toBe('number');
        expect(typeof entry.configured).toBe('boolean');
      }
    });

    it('should mark configured models correctly', () => {
      const catalog = modelManager.getModelCatalog();
      const openaiModels = catalog.filter(e => e.provider === 'openai');
      expect(openaiModels.every(e => e.configured)).toBe(true);

      // Google models should not be configured (no GOOGLE_AI_API_KEY)
      const googleModels = catalog.filter(e => e.provider === 'google');
      expect(googleModels.every(e => !e.configured)).toBe(true);
    });

    it('should return only configured models from getConfiguredCatalog', () => {
      const configured = modelManager.getConfiguredCatalog();
      expect(configured.every(e => e.configured)).toBe(true);
    });
  });

  describe('Provider Status', () => {
    it('should report detected providers', () => {
      const status = modelManager.getProviderStatus();
      const openai = status.find(p => p.id === 'openai');
      expect(openai?.detected).toBe(true);
      expect(openai?.profileCount).toBe(1);

      const google = status.find(p => p.id === 'google');
      expect(google?.detected).toBe(false);
    });
  });

  describe('Model Ref Resolution', () => {
    it('should resolve legacy model names', () => {
      const ref = modelManager.resolveModelRef('claude-3-sonnet');
      expect(ref.provider).toBe('anthropic');
      expect(ref.modelId).toBe('claude-sonnet-4-20250514');
    });

    it('should resolve provider/model format', () => {
      const ref = modelManager.resolveModelRef('openai/gpt-4o');
      expect(ref.provider).toBe('openai');
      expect(ref.modelId).toBe('gpt-4o');
    });

    it('should infer provider from model name prefix', () => {
      const ref = modelManager.resolveModelRef('gpt-4o-mini');
      expect(ref.provider).toBe('openai');
    });
  });

  // =========================================================================
  // Auth Profiles, Fallback Chain, Context Window
  // =========================================================================

  describe('Auth Profile rotation', () => {
    it('should support multiple API keys via comma-separated env var', () => {
      process.env.OPENAI_API_KEY = 'key-a,key-b,key-c';
      process.env.ANTHROPIC_API_KEY = 'ant-key';
      const mm = new ModelManager();
      expect(mm.getAuthProfileCount('openai')).toBe(3);
      expect(mm.getAuthProfileCount('anthropic')).toBe(1);
    });

    it('should return the first key as active by default', () => {
      process.env.OPENAI_API_KEY = 'key-a,key-b';
      process.env.ANTHROPIC_API_KEY = 'ant-key';
      const mm = new ModelManager();
      expect(mm.getActiveApiKey('openai')).toBe('key-a');
    });

    it('should advance to next profile on rotation', () => {
      process.env.OPENAI_API_KEY = 'key-a,key-b,key-c';
      process.env.ANTHROPIC_API_KEY = 'ant-key';
      const mm = new ModelManager();
      const newKey = mm.advanceAuthProfile('openai');
      expect(newKey).toBe('key-b');
      expect(mm.getActiveApiKey('openai')).toBe('key-b');
    });

    it('should skip profiles in cooldown', () => {
      process.env.OPENAI_API_KEY = 'key-a,key-b,key-c';
      process.env.ANTHROPIC_API_KEY = 'ant-key';
      const mm = new ModelManager();

      mm.markAuthProfileFailure('openai', 'auth');
      const newKey = mm.advanceAuthProfile('openai');
      expect(newKey).toBe('key-b');

      mm.markAuthProfileFailure('openai', 'rate_limit');
      const nextKey = mm.advanceAuthProfile('openai');
      expect(nextKey).toBe('key-c');
    });

    it('should return undefined when all profiles are in cooldown', () => {
      process.env.OPENAI_API_KEY = 'key-a,key-b';
      process.env.ANTHROPIC_API_KEY = 'ant-key';
      const mm = new ModelManager();

      mm.markAuthProfileFailure('openai', 'auth');
      mm.advanceAuthProfile('openai');
      mm.markAuthProfileFailure('openai', 'auth');

      const result = mm.advanceAuthProfile('openai');
      expect(result).toBeUndefined();
    });

    it('should return undefined for single-key provider', () => {
      process.env.OPENAI_API_KEY = 'single-key';
      process.env.ANTHROPIC_API_KEY = 'ant-key';
      const mm = new ModelManager();
      expect(mm.advanceAuthProfile('openai')).toBeUndefined();
    });
  });

  describe('Fallback chain', () => {
    it('should build a default fallback chain from configured models', () => {
      const candidates = modelManager.getFallbackCandidates('openai/gpt-4o');
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates).not.toContain('openai/gpt-4o');
    });

    it('should filter out unconfigured models from fallback chain', () => {
      modelManager.setFallbackChain(['anthropic/claude-3-haiku-20240307', 'nonexistent/model', 'openai/gpt-4o']);
      const candidates = modelManager.getFallbackCandidates('openai/gpt-5');
      expect(candidates).not.toContain('nonexistent/model');
    });
  });

  describe('Context window', () => {
    it('should return correct context window for legacy model name', () => {
      // gpt-3.5-turbo now maps to gpt-4.1-nano (1M context)
      expect(modelManager.getContextWindowTokens('gpt-3.5-turbo')).toBe(1_000_000);
    });

    it('should return correct context window for ref format', () => {
      expect(modelManager.getContextWindowTokens('openai/gpt-4o')).toBe(128_000);
      expect(modelManager.getContextWindowTokens('google/gemini-1.5-pro')).toBe(1_000_000);
    });

    it('should return default for unknown model', () => {
      expect(modelManager.getContextWindowTokens('unknown')).toBe(128_000);
    });
  });

  describe('registerProvider', () => {
    it('should register a new provider and auto-configure its models', () => {
      const mm = new ModelManager();
      mm.registerProvider('deepseek', 'ds-test-key');
      const configured = mm.getConfiguredModels();
      expect(configured).toContain('deepseek/deepseek-chat');
      expect(configured).toContain('deepseek/deepseek-reasoner');
    });
  });
});
