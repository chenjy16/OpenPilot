/**
 * Tests for DiscordChannel
 *
 * Uses mocked discord.js Client to test the full message pipeline
 * without a real Discord connection.
 */

import { DiscordChannel, createDiscordChannel } from './DiscordChannel';
import { ChannelMessage, OutboundMessage } from './types';
import { EventEmitter } from 'events';
import { ChannelType, Partials, GatewayIntentBits } from 'discord.js';

// ---------------------------------------------------------------------------
// Mock discord.js Client
// ---------------------------------------------------------------------------

class MockClient extends EventEmitter {
  user = { tag: 'TestBot#1234', id: '999' };
  channels = {
    fetch: jest.fn(),
  };
  login = jest.fn().mockImplementation(async (token: string) => {
    if (token === 'invalid-token') throw new Error('Invalid token');
    // Simulate ready event after login
    setTimeout(() => this.emit('ready'), 10);
    return token;
  });
  destroy = jest.fn().mockImplementation(() => {
    this.removeAllListeners();
  });
}

// Mock the discord.js module
jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js');
  return {
    ...actual,
    Client: jest.fn().mockImplementation(() => new MockClient()),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDiscordMessage(overrides: Record<string, any> = {}): any {
  return {
    id: 'msg-123',
    author: {
      id: 'user-456',
      username: 'testuser',
      displayName: 'Test User',
      bot: false,
    },
    guild: { id: 'guild-789' },
    channel: {
      id: 'channel-001',
      type: ChannelType.GuildText,
      isTextBased: () => true,
      isDMBased: () => false,
      isThread: () => false,
      send: jest.fn(),
    },
    content: 'Hello bot!',
    createdAt: new Date('2026-01-15T10:00:00Z'),
    attachments: new Map(),
    reference: null,
    ...overrides,
  };
}

function createDMMessage(overrides: Record<string, any> = {}): any {
  return createMockDiscordMessage({
    guild: null,
    channel: {
      id: 'dm-channel-001',
      type: ChannelType.DM,
      isTextBased: () => true,
      isDMBased: () => true,
      isThread: () => false,
      send: jest.fn(),
    },
    ...overrides,
  });
}

function createThreadMessage(overrides: Record<string, any> = {}): any {
  return createMockDiscordMessage({
    channel: {
      id: 'thread-001',
      type: ChannelType.PublicThread,
      isTextBased: () => true,
      isDMBased: () => false,
      isThread: () => true,
      send: jest.fn(),
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscordChannel', () => {
  let channel: DiscordChannel;

  beforeEach(() => {
    channel = new DiscordChannel({ token: 'test-token-123' });
  });

  // =====================================================================
  // Constructor & metadata
  // =====================================================================

  describe('constructor & metadata', () => {
    it('should have correct type and displayName', () => {
      expect(channel.type).toBe('discord');
      expect(channel.displayName).toBe('Discord');
    });

    it('should have correct meta', () => {
      expect(channel.meta.id).toBe('discord');
      expect(channel.meta.label).toBe('Discord');
      expect(channel.meta.icon).toBe('🎮');
      expect(channel.meta.order).toBe(2);
    });

    it('should have correct capabilities', () => {
      expect(channel.capabilities.chatTypes).toContain('direct');
      expect(channel.capabilities.chatTypes).toContain('group');
      expect(channel.capabilities.chatTypes).toContain('thread');
      expect(channel.capabilities.threads).toBe(true);
      expect(channel.capabilities.maxTextLength).toBe(2000);
    });

    it('should have outbound adapter with 2000 char limit', () => {
      expect(channel.outbound.deliveryMode).toBe('direct');
      expect(channel.outbound.textChunkLimit).toBe(2000);
    });
  });

  // =====================================================================
  // getStatus
  // =====================================================================

  describe('getStatus', () => {
    it('should return disconnected status initially', () => {
      const status = channel.getStatus();
      expect(status.type).toBe('discord');
      expect(status.status).toBe('disconnected');
      expect(status.messageCount).toBe(0);
      expect(status.connectedAt).toBeUndefined();
    });
  });

  // =====================================================================
  // connect
  // =====================================================================

  describe('connect', () => {
    it('should throw if token is empty', async () => {
      const ch = new DiscordChannel({ token: '' });
      await expect(ch.connect(jest.fn())).rejects.toThrow('Discord bot token is required');
      expect(ch.getStatus().status).toBe('error');
      expect(ch.getStatus().statusMessage).toBe('DISCORD_BOT_TOKEN not set');
    });

    it('should connect and set status to connected', async () => {
      const onMessage = jest.fn();
      await channel.connect(onMessage);

      const status = channel.getStatus();
      expect(status.status).toBe('connected');
      expect(status.connectedAt).toBeInstanceOf(Date);
    });

    it('should register messageCreate listener', async () => {
      const onMessage = jest.fn();
      await channel.connect(onMessage);

      // The mock Client should have a messageCreate listener
      const { Client } = require('discord.js');
      const mockInstance = Client.mock.results[Client.mock.results.length - 1].value;
      expect(mockInstance.listenerCount('messageCreate')).toBeGreaterThan(0);
    });
  });

  // =====================================================================
  // Message handling
  // =====================================================================

  describe('message handling', () => {
    let onMessage: jest.Mock;
    let mockClient: MockClient;

    beforeEach(async () => {
      onMessage = jest.fn();
      await channel.connect(onMessage);
      const { Client } = require('discord.js');
      mockClient = Client.mock.results[Client.mock.results.length - 1].value;
    });

    it('should convert guild text message to ChannelMessage', async () => {
      const discordMsg = createMockDiscordMessage();
      await mockClient.emit('messageCreate', discordMsg);

      expect(onMessage).toHaveBeenCalledTimes(1);
      const msg: ChannelMessage = onMessage.mock.calls[0][0];
      expect(msg.id).toBe('msg-123');
      expect(msg.senderId).toBe('user-456');
      expect(msg.senderName).toBe('Test User');
      expect(msg.channelType).toBe('discord');
      expect(msg.chatId).toBe('channel-001');
      expect(msg.content).toBe('Hello bot!');
      expect(msg.chatType).toBe('group');
      expect(msg.guildId).toBe('guild-789');
      expect(msg.threadId).toBeUndefined();
    });

    it('should convert DM to ChannelMessage with chatType=direct', async () => {
      const discordMsg = createDMMessage();
      await mockClient.emit('messageCreate', discordMsg);

      expect(onMessage).toHaveBeenCalledTimes(1);
      const msg: ChannelMessage = onMessage.mock.calls[0][0];
      expect(msg.chatType).toBe('direct');
      expect(msg.guildId).toBeUndefined();
      expect(msg.chatId).toBe('dm-channel-001');
    });

    it('should convert thread message with threadId', async () => {
      const discordMsg = createThreadMessage();
      await mockClient.emit('messageCreate', discordMsg);

      expect(onMessage).toHaveBeenCalledTimes(1);
      const msg: ChannelMessage = onMessage.mock.calls[0][0];
      expect(msg.chatType).toBe('thread');
      expect(msg.threadId).toBe('thread-001');
    });

    it('should ignore bot messages', async () => {
      const discordMsg = createMockDiscordMessage({
        author: { id: 'bot-1', username: 'OtherBot', displayName: 'Other Bot', bot: true },
      });
      await mockClient.emit('messageCreate', discordMsg);

      expect(onMessage).not.toHaveBeenCalled();
    });

    it('should filter by allowedGuildIds', async () => {
      // Create a new channel with guild filter
      const filtered = new DiscordChannel({
        token: 'test-token-123',
        allowedGuildIds: ['guild-allowed'],
      });
      const filteredOnMessage = jest.fn();
      await filtered.connect(filteredOnMessage);
      const { Client } = require('discord.js');
      const filteredClient = Client.mock.results[Client.mock.results.length - 1].value;

      // Message from allowed guild
      const allowedMsg = createMockDiscordMessage({ guild: { id: 'guild-allowed' } });
      await filteredClient.emit('messageCreate', allowedMsg);
      expect(filteredOnMessage).toHaveBeenCalledTimes(1);

      // Message from disallowed guild
      const blockedMsg = createMockDiscordMessage({ guild: { id: 'guild-blocked' } });
      await filteredClient.emit('messageCreate', blockedMsg);
      expect(filteredOnMessage).toHaveBeenCalledTimes(1); // Still 1

      // DM (no guild) should pass through
      const dmMsg = createDMMessage();
      await filteredClient.emit('messageCreate', dmMsg);
      expect(filteredOnMessage).toHaveBeenCalledTimes(2);

      await filtered.disconnect();
    });

    it('should handle message with attachments', async () => {
      const attachments = new Map();
      attachments.set('att-1', {
        url: 'https://cdn.discord.com/image.png',
        contentType: 'image/png',
        name: 'image.png',
        size: 12345,
      });
      attachments.set('att-2', {
        url: 'https://cdn.discord.com/doc.pdf',
        contentType: 'application/pdf',
        name: 'doc.pdf',
        size: 67890,
      });

      const discordMsg = createMockDiscordMessage({
        content: 'Check this out',
        attachments,
      });
      await mockClient.emit('messageCreate', discordMsg);

      const msg: ChannelMessage = onMessage.mock.calls[0][0];
      expect(msg.content).toBe('Check this out');
      expect(msg.attachments).toHaveLength(2);
      expect(msg.attachments![0].type).toBe('image');
      expect(msg.attachments![0].url).toBe('https://cdn.discord.com/image.png');
      expect(msg.attachments![0].mimeType).toBe('image/png');
      expect(msg.attachments![1].type).toBe('file');
      expect(msg.attachments![1].filename).toBe('doc.pdf');
    });

    it('should set content to [Attachment] when no text but has attachments', async () => {
      const attachments = new Map();
      attachments.set('att-1', {
        url: 'https://cdn.discord.com/image.png',
        contentType: 'image/png',
        name: 'image.png',
        size: 100,
      });

      const discordMsg = createMockDiscordMessage({
        content: '',
        attachments,
      });
      await mockClient.emit('messageCreate', discordMsg);

      const msg: ChannelMessage = onMessage.mock.calls[0][0];
      expect(msg.content).toBe('[Attachment]');
    });

    it('should handle reply references', async () => {
      const discordMsg = createMockDiscordMessage({
        reference: { messageId: 'original-msg-999' },
      });
      await mockClient.emit('messageCreate', discordMsg);

      const msg: ChannelMessage = onMessage.mock.calls[0][0];
      expect(msg.replyTo).toBe('original-msg-999');
    });

    it('should increment messageCount', async () => {
      expect(channel.getStatus().messageCount).toBe(0);

      await mockClient.emit('messageCreate', createMockDiscordMessage());
      expect(channel.getStatus().messageCount).toBe(1);

      await mockClient.emit('messageCreate', createDMMessage());
      expect(channel.getStatus().messageCount).toBe(2);
    });
  });

  // =====================================================================
  // sendMessage
  // =====================================================================

  describe('sendMessage', () => {
    let mockClient: MockClient;

    beforeEach(async () => {
      await channel.connect(jest.fn());
      const { Client } = require('discord.js');
      mockClient = Client.mock.results[Client.mock.results.length - 1].value;
    });

    it('should throw if not connected', async () => {
      const ch = new DiscordChannel({ token: 'test-token' });
      await expect(
        ch.sendMessage({ chatId: '123', text: 'hello' }),
      ).rejects.toThrow('Discord bot is not connected');
    });

    it('should send a short message', async () => {
      const mockSend = jest.fn();
      mockClient.channels.fetch.mockResolvedValue({
        isTextBased: () => true,
        send: mockSend,
      });

      await channel.sendMessage({ chatId: 'ch-1', text: 'Hello!' });

      expect(mockClient.channels.fetch).toHaveBeenCalledWith('ch-1');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({
        content: 'Hello!',
        reply: undefined,
      });
    });

    it('should send with reply reference', async () => {
      const mockSend = jest.fn();
      mockClient.channels.fetch.mockResolvedValue({
        isTextBased: () => true,
        send: mockSend,
      });

      await channel.sendMessage({
        chatId: 'ch-1',
        text: 'Reply!',
        replyTo: 'msg-original',
      });

      expect(mockSend).toHaveBeenCalledWith({
        content: 'Reply!',
        reply: { messageReference: 'msg-original' },
      });
    });

    it('should chunk long messages', async () => {
      const mockSend = jest.fn();
      mockClient.channels.fetch.mockResolvedValue({
        isTextBased: () => true,
        send: mockSend,
      });

      // Create a message longer than 2000 chars
      const longText = 'A'.repeat(2500);
      await channel.sendMessage({ chatId: 'ch-1', text: longText });

      // Should be split into 2 chunks
      expect(mockSend).toHaveBeenCalledTimes(2);
      // First chunk should be 2000 chars
      expect(mockSend.mock.calls[0][0].content.length).toBeLessThanOrEqual(2000);
      // Total content should equal original
      const totalContent = mockSend.mock.calls.map((c: any) => c[0].content).join('');
      expect(totalContent).toBe(longText);
    });

    it('should throw if channel is not text-based', async () => {
      mockClient.channels.fetch.mockResolvedValue({
        isTextBased: () => false,
      });

      await expect(
        channel.sendMessage({ chatId: 'voice-ch', text: 'hello' }),
      ).rejects.toThrow('not a text channel');
    });

    it('should throw if channel not found', async () => {
      mockClient.channels.fetch.mockResolvedValue(null);

      await expect(
        channel.sendMessage({ chatId: 'nonexistent', text: 'hello' }),
      ).rejects.toThrow('not a text channel');
    });
  });

  // =====================================================================
  // disconnect
  // =====================================================================

  describe('disconnect', () => {
    it('should handle disconnect when not connected', async () => {
      await channel.disconnect();
      expect(channel.getStatus().status).toBe('disconnected');
    });

    it('should destroy client on disconnect', async () => {
      await channel.connect(jest.fn());
      const { Client } = require('discord.js');
      const mockClient = Client.mock.results[Client.mock.results.length - 1].value;

      await channel.disconnect();

      expect(mockClient.destroy).toHaveBeenCalled();
      expect(channel.getStatus().status).toBe('disconnected');
    });
  });

  afterEach(async () => {
    // Ensure channel is disconnected to prevent event leaks between tests
    try { await channel.disconnect(); } catch { /* ignore */ }
  });

  // =====================================================================
  // channelConfig adapter
  // =====================================================================

  describe('channelConfig adapter', () => {
    it('should list default account when flat config', () => {
      const ids = channel.channelConfig.listAccountIds({ channels: { discord: { token: 'abc' } } });
      expect(ids).toEqual(['default']);
    });

    it('should list multiple accounts', () => {
      const ids = channel.channelConfig.listAccountIds({
        channels: {
          discord: {
            bot1: { token: 'abc' },
            bot2: { token: 'def' },
          },
        },
      });
      expect(ids).toEqual(['bot1', 'bot2']);
    });

    it('should resolve flat account', () => {
      const account = channel.channelConfig.resolveAccount(
        { channels: { discord: { token: 'abc', guilds: '123' } } },
      );
      expect(account).toEqual({ token: 'abc', guilds: '123' });
    });

    it('should resolve named account', () => {
      const account = channel.channelConfig.resolveAccount(
        { channels: { discord: { bot1: { token: 'abc' }, bot2: { token: 'def' } } } },
        'bot2',
      );
      expect(account).toEqual({ token: 'def' });
    });

    it('should check isEnabled', () => {
      expect(channel.channelConfig.isEnabled(null)).toBe(false);
      expect(channel.channelConfig.isEnabled({ token: 'abc' })).toBe(true);
      expect(channel.channelConfig.isEnabled({ token: 'abc', enabled: false })).toBe(false);
    });

    it('should check isConfigured', () => {
      expect(channel.channelConfig.isConfigured(null)).toBe(false);
      expect(channel.channelConfig.isConfigured({})).toBe(false);
      expect(channel.channelConfig.isConfigured({ token: 'abc' })).toBe(true);
    });
  });

  // =====================================================================
  // Chat type detection
  // =====================================================================

  describe('chat type detection', () => {
    let onMessage: jest.Mock;
    let mockClient: MockClient;

    beforeEach(async () => {
      onMessage = jest.fn();
      await channel.connect(onMessage);
      const { Client } = require('discord.js');
      mockClient = Client.mock.results[Client.mock.results.length - 1].value;
    });

    it('should detect GroupDM as direct', async () => {
      const msg = createMockDiscordMessage({
        guild: null,
        channel: {
          id: 'gdm-001',
          type: ChannelType.GroupDM,
          isTextBased: () => true,
          isDMBased: () => true,
          isThread: () => false,
          send: jest.fn(),
        },
      });
      await mockClient.emit('messageCreate', msg);

      expect(onMessage.mock.calls[0][0].chatType).toBe('direct');
    });

    it('should detect PrivateThread as thread', async () => {
      const msg = createMockDiscordMessage({
        channel: {
          id: 'private-thread-001',
          type: ChannelType.PrivateThread,
          isTextBased: () => true,
          isDMBased: () => false,
          isThread: () => true,
          send: jest.fn(),
        },
      });
      await mockClient.emit('messageCreate', msg);

      const result = onMessage.mock.calls[0][0];
      expect(result.chatType).toBe('thread');
      expect(result.threadId).toBe('private-thread-001');
    });

    it('should detect AnnouncementThread as thread', async () => {
      const msg = createMockDiscordMessage({
        channel: {
          id: 'announce-thread-001',
          type: ChannelType.AnnouncementThread,
          isTextBased: () => true,
          isDMBased: () => false,
          isThread: () => true,
          send: jest.fn(),
        },
      });
      await mockClient.emit('messageCreate', msg);

      const result = onMessage.mock.calls[0][0];
      expect(result.chatType).toBe('thread');
      expect(result.threadId).toBe('announce-thread-001');
    });

    it('should detect GuildVoice as group', async () => {
      const msg = createMockDiscordMessage({
        channel: {
          id: 'voice-text-001',
          type: ChannelType.GuildVoice,
          isTextBased: () => true,
          isDMBased: () => false,
          isThread: () => false,
          send: jest.fn(),
        },
      });
      await mockClient.emit('messageCreate', msg);

      expect(onMessage.mock.calls[0][0].chatType).toBe('group');
    });
  });

  // =====================================================================
  // Attachment type detection
  // =====================================================================

  describe('attachment type detection', () => {
    let onMessage: jest.Mock;
    let mockClient: MockClient;

    beforeEach(async () => {
      onMessage = jest.fn();
      await channel.connect(onMessage);
      const { Client } = require('discord.js');
      mockClient = Client.mock.results[Client.mock.results.length - 1].value;
    });

    it('should detect video attachments', async () => {
      const attachments = new Map();
      attachments.set('v1', {
        url: 'https://cdn.discord.com/video.mp4',
        contentType: 'video/mp4',
        name: 'video.mp4',
        size: 5000000,
      });

      await mockClient.emit('messageCreate', createMockDiscordMessage({
        content: 'Watch this',
        attachments,
      }));

      expect(onMessage.mock.calls[0][0].attachments[0].type).toBe('video');
    });

    it('should detect audio attachments', async () => {
      const attachments = new Map();
      attachments.set('a1', {
        url: 'https://cdn.discord.com/audio.ogg',
        contentType: 'audio/ogg',
        name: 'audio.ogg',
        size: 100000,
      });

      await mockClient.emit('messageCreate', createMockDiscordMessage({
        content: 'Listen',
        attachments,
      }));

      expect(onMessage.mock.calls[0][0].attachments[0].type).toBe('audio');
    });

    it('should default unknown types to file', async () => {
      const attachments = new Map();
      attachments.set('f1', {
        url: 'https://cdn.discord.com/data.zip',
        contentType: 'application/zip',
        name: 'data.zip',
        size: 999999,
      });

      await mockClient.emit('messageCreate', createMockDiscordMessage({
        content: '',
        attachments,
      }));

      const msg = onMessage.mock.calls[0][0];
      expect(msg.attachments[0].type).toBe('file');
      expect(msg.content).toBe('[Attachment]');
    });
  });
});

// ---------------------------------------------------------------------------
// createDiscordChannel factory
// ---------------------------------------------------------------------------

describe('createDiscordChannel', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return null if DISCORD_BOT_TOKEN is not set', () => {
    delete process.env.DISCORD_BOT_TOKEN;
    expect(createDiscordChannel()).toBeNull();
  });

  it('should create channel if DISCORD_BOT_TOKEN is set', () => {
    process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
    const ch = createDiscordChannel();
    expect(ch).not.toBeNull();
    expect(ch!.type).toBe('discord');
  });

  it('should parse DISCORD_ALLOWED_GUILDS', () => {
    process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
    process.env.DISCORD_ALLOWED_GUILDS = 'guild1, guild2, guild3';
    const ch = createDiscordChannel();
    expect(ch).not.toBeNull();
    // The allowedGuildIds are stored in the private config
    // We can verify by checking that guild filtering works
  });
});

// ---------------------------------------------------------------------------
// Integration: DiscordChannel + ChannelManager routing
// ---------------------------------------------------------------------------

describe('DiscordChannel + ChannelManager integration', () => {
  // Import ChannelManager for integration test
  const { ChannelManager } = require('./ChannelManager');
  const { resetLanes } = require('./CommandLane');

  beforeEach(() => {
    resetLanes();
  });

  it('should route Discord guild messages through ChannelManager', async () => {
    const routeLog: any[] = [];

    const manager = new ChannelManager({
      onMessage: async (message: ChannelMessage) => {
        const chatType = message.chatType ?? 'direct';
        const peerId = chatType === 'direct' ? message.senderId : message.chatId;
        const route = manager.resolveAgentRoute({
          channel: message.channelType,
          accountId: message.accountId,
          peer: peerId ? { kind: chatType as any, id: peerId } : undefined,
          guildId: message.guildId,
          threadId: message.threadId,
        });
        routeLog.push({
          agentId: route.agentId,
          sessionKey: route.sessionKey,
          matchedBy: route.matchedBy,
        });
        return `[${route.agentId}] response`;
      },
      bindings: [
        { agentId: 'coder', match: { channel: 'discord', guildId: 'dev-guild' } },
        { agentId: 'support', match: { channel: 'discord', peer: { kind: 'direct', id: 'vip-user' } } },
      ],
      defaultAgentId: 'main',
    });

    // Create a mock Discord plugin that acts like a ChannelPlugin
    const sentMessages: OutboundMessage[] = [];
    let onMessageCb: any = null;
    const mockPlugin = {
      type: 'discord',
      displayName: 'Discord',
      async connect(onMessage: any) { onMessageCb = onMessage; },
      async disconnect() {},
      async sendMessage(msg: OutboundMessage) { sentMessages.push(msg); },
      getStatus() { return { type: 'discord', status: 'connected' as const, messageCount: 0 }; },
    };

    manager.register(mockPlugin);
    await manager.connectAll();

    // Guild message → coder agent
    await onMessageCb({
      id: 'msg-1',
      senderId: 'user-1',
      senderName: 'Alice',
      channelType: 'discord',
      chatId: 'text-channel-1',
      content: 'A'.repeat(201),
      timestamp: new Date(),
      chatType: 'group',
      guildId: 'dev-guild',
    });
    await new Promise(r => setTimeout(r, 100));

    expect(routeLog[0].agentId).toBe('coder');
    expect(routeLog[0].matchedBy).toBe('binding.guild');

    // DM from VIP → support agent
    await onMessageCb({
      id: 'msg-2',
      senderId: 'vip-user',
      senderName: 'VIP',
      channelType: 'discord',
      chatId: 'dm-vip',
      content: 'B'.repeat(201),
      timestamp: new Date(),
      chatType: 'direct',
    });
    await new Promise(r => setTimeout(r, 100));

    expect(routeLog[1].agentId).toBe('support');
    expect(routeLog[1].matchedBy).toBe('binding.peer');

    // DM from random user → default main
    await onMessageCb({
      id: 'msg-3',
      senderId: 'random-user',
      senderName: 'Random',
      channelType: 'discord',
      chatId: 'dm-random',
      content: 'C'.repeat(201),
      timestamp: new Date(),
      chatType: 'direct',
    });
    await new Promise(r => setTimeout(r, 100));

    expect(routeLog[2].agentId).toBe('main');
    expect(routeLog[2].matchedBy).toBe('default');

    // All 3 responses sent back
    expect(sentMessages).toHaveLength(3);
  });

  it('should route Discord thread messages with thread isolation', async () => {
    const routeLog: any[] = [];

    const manager = new ChannelManager({
      onMessage: async (message: ChannelMessage) => {
        const chatType = message.chatType ?? 'direct';
        const peerId = chatType === 'direct' ? message.senderId : message.chatId;
        const route = manager.resolveAgentRoute({
          channel: message.channelType,
          peer: peerId ? { kind: chatType as any, id: peerId } : undefined,
          guildId: message.guildId,
          threadId: message.threadId,
        });
        routeLog.push({ sessionKey: route.sessionKey });
        return 'ok';
      },
      defaultAgentId: 'main',
    });

    const mockPlugin = {
      type: 'discord',
      displayName: 'Discord',
      async connect(onMessage: any) { this._onMessage = onMessage; },
      async disconnect() {},
      async sendMessage() {},
      getStatus() { return { type: 'discord', status: 'connected' as const, messageCount: 0 }; },
      _onMessage: null as any,
    };

    manager.register(mockPlugin);
    await manager.connectAll();

    // Thread message
    await mockPlugin._onMessage({
      id: 'msg-t1',
      senderId: 'user-1',
      senderName: 'Alice',
      channelType: 'discord',
      chatId: 'thread-abc',
      content: 'X'.repeat(201),
      timestamp: new Date(),
      chatType: 'thread',
      guildId: 'guild-1',
      threadId: 'thread-abc',
    });
    await new Promise(r => setTimeout(r, 100));

    // Non-thread message in same guild
    await mockPlugin._onMessage({
      id: 'msg-t2',
      senderId: 'user-1',
      senderName: 'Alice',
      channelType: 'discord',
      chatId: 'general-channel',
      content: 'Y'.repeat(201),
      timestamp: new Date(),
      chatType: 'group',
      guildId: 'guild-1',
    });
    await new Promise(r => setTimeout(r, 100));

    // Thread and non-thread should have different session keys
    expect(routeLog[0].sessionKey).toContain(':thread:thread-abc');
    expect(routeLog[1].sessionKey).not.toContain(':thread:');
    expect(routeLog[0].sessionKey).not.toBe(routeLog[1].sessionKey);
  });
});
