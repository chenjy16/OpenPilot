/**
 * Tests for TelegramChannel
 */

import { TelegramChannel, createTelegramChannel } from './TelegramChannel';

describe('TelegramChannel', () => {
  describe('constructor', () => {
    it('should create with config', () => {
      const ch = new TelegramChannel({ token: 'test-token' });
      expect(ch.type).toBe('telegram');
      expect(ch.displayName).toBe('Telegram');
    });
  });

  describe('getStatus', () => {
    it('should return disconnected status initially', () => {
      const ch = new TelegramChannel({ token: 'test-token' });
      const status = ch.getStatus();
      expect(status.type).toBe('telegram');
      expect(status.status).toBe('disconnected');
      expect(status.messageCount).toBe(0);
    });
  });

  describe('connect', () => {
    it('should throw if token is empty', async () => {
      const ch = new TelegramChannel({ token: '' });
      await expect(ch.connect(jest.fn())).rejects.toThrow('Telegram bot token is required');
      expect(ch.getStatus().status).toBe('error');
    });

    // Skip: requires real Telegram token. grammy's async polling
    // throws unhandled rejections with fake tokens in test env.
    it.skip('should start grammy polling with valid token format', async () => {
      const ch = new TelegramChannel({ token: 'test-token' });
      const connectPromise = ch.connect(jest.fn());
      expect(ch.getStatus().status).toMatch(/connecting|connected/);
      try { await ch.disconnect(); } catch { /* ignore */ }
      try { await connectPromise; } catch { /* ignore background errors */ }
    });
  });

  describe('sendMessage', () => {
    it('should throw if bot is not connected', async () => {
      const ch = new TelegramChannel({ token: 'test-token' });
      await expect(
        ch.sendMessage({ chatId: '123', text: 'hello' }),
      ).rejects.toThrow('Telegram bot is not connected');
    });
  });

  describe('disconnect', () => {
    it('should handle disconnect when not connected', async () => {
      const ch = new TelegramChannel({ token: 'test-token' });
      // Should not throw
      await ch.disconnect();
      expect(ch.getStatus().status).toBe('disconnected');
    });
  });
});

describe('createTelegramChannel', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return null if TELEGRAM_BOT_TOKEN is not set', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(createTelegramChannel()).toBeNull();
  });

  it('should create channel if TELEGRAM_BOT_TOKEN is set', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
    const ch = createTelegramChannel();
    expect(ch).not.toBeNull();
    expect(ch!.type).toBe('telegram');
  });

  it('should parse TELEGRAM_ALLOWED_CHATS', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
    process.env.TELEGRAM_ALLOWED_CHATS = '123, 456, 789';
    const ch = createTelegramChannel();
    expect(ch).not.toBeNull();
  });
});
