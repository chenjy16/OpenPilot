/**
 * Tests for the configuration system
 */

import { loadConfig, loadAppConfig } from './index';

describe('Config System', () => {
  beforeEach(() => {
    // Ensure test API key
    process.env.OPENAI_API_KEY = 'sk-test-key';
    // Reset overridable env vars to empty (falsy) to get defaults
    process.env.PORT = '';
    process.env.HOST = '';
    process.env.DATABASE_PATH = '';
    process.env.LOG_LEVEL = '';
    process.env.NODE_ENV = '';
    process.env.DEBUG = '';
    process.env.TELEGRAM_BOT_TOKEN = '';
    process.env.TELEGRAM_ALLOWED_CHATS = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.GOOGLE_AI_API_KEY = '';
  });

  describe('loadConfig (legacy)', () => {
    it('should return legacy config shape', () => {
      const config = loadConfig();
      expect(config).toHaveProperty('openaiApiKey');
      expect(config).toHaveProperty('port');
      expect(config).toHaveProperty('host');
      expect(config).toHaveProperty('databasePath');
      expect(config).toHaveProperty('nodeEnv');
      expect(config).toHaveProperty('logLevel');
    });

    it('should use env vars for API keys', () => {
      process.env.OPENAI_API_KEY = 'sk-test-123';
      const config = loadConfig();
      expect(config.openaiApiKey).toBe('sk-test-123');
    });

    it('should use default port when PORT is empty', () => {
      process.env.PORT = '';
      const config = loadConfig();
      expect(config.port).toBe(3000);
    });

    it('should override port from env', () => {
      process.env.PORT = '8080';
      const config = loadConfig();
      expect(config.port).toBe(8080);
    });

    it('should warn (not throw) if no API keys set', () => {
      process.env.OPENAI_API_KEY = '';
      process.env.ANTHROPIC_API_KEY = '';
      process.env.GOOGLE_AI_API_KEY = '';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => loadConfig()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no API keys configured'));
      warnSpy.mockRestore();
    });
  });

  describe('loadAppConfig', () => {
    it('should return full app config with defaults', () => {
      process.env.PORT = '';
      const config = loadAppConfig();
      expect(config.gateway.port).toBe(3000);
      expect(config.agents.defaults.model.primary).toBe('claude-3-sonnet');
      expect(config.tools.requireApproval).toContain('shellExecute');
      expect(config.apiKeys.openai).toBe('sk-test-key');
    });

    it('should override port from env', () => {
      process.env.PORT = '9999';
      const config = loadAppConfig();
      expect(config.gateway.port).toBe(9999);
    });

    it('should have default compaction settings', () => {
      const config = loadAppConfig();
      expect(config.agents.defaults.compaction.mode).toBe('default');
      expect(config.agents.defaults.compaction.reserveTokens).toBe(20000);
      expect(config.agents.defaults.compaction.maxHistoryShare).toBe(0.7);
    });

    it('should have default tool settings', () => {
      const config = loadAppConfig();
      expect(config.tools.exec.timeoutSec).toBe(120);
      expect(config.tools.fs.workspaceOnly).toBe(true);
      expect(config.tools.browser.headless).toBe(true);
    });

    it('should pick up Telegram config from env', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tg-token-123';
      process.env.TELEGRAM_ALLOWED_CHATS = '111,222';
      const config = loadAppConfig();
      expect(config.channels.telegram?.enabled).toBe(true);
      expect(config.channels.telegram?.token).toBe('tg-token-123');
      expect(config.channels.telegram?.allowedChats).toEqual(['111', '222']);
    });

    it('should use LOG_LEVEL from env', () => {
      process.env.LOG_LEVEL = 'debug';
      const config = loadAppConfig();
      expect(config.logLevel).toBe('debug');
    });

    it('should use DATABASE_PATH from env', () => {
      process.env.DATABASE_PATH = '/tmp/test.db';
      const config = loadAppConfig();
      expect(config.databasePath).toBe('/tmp/test.db');
    });
  });
});
