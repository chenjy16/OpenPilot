/**
 * Tests for ChannelManager and channel plugin system
 */

import { ChannelManager } from './ChannelManager';
import {
  ChannelPlugin,
  ChannelMessage,
  OutboundMessage,
  ChannelInfo,
  OnMessageCallback,
} from './types';
import { resetLanes } from './CommandLane';

// ---------------------------------------------------------------------------
// Mock channel plugin
// ---------------------------------------------------------------------------

function createMockChannel(type = 'test', displayName = 'Test Channel'): ChannelPlugin & {
  connectCalled: boolean;
  disconnectCalled: boolean;
  sentMessages: OutboundMessage[];
  onMessage: OnMessageCallback | null;
  simulateInbound: (msg: ChannelMessage) => Promise<void>;
  _status: ChannelInfo;
} {
  const plugin: any = {
    type,
    displayName,
    connectCalled: false,
    disconnectCalled: false,
    sentMessages: [] as OutboundMessage[],
    onMessage: null as OnMessageCallback | null,
    _status: {
      type,
      status: 'disconnected',
      messageCount: 0,
    } as ChannelInfo,

    async connect(onMessage: OnMessageCallback) {
      plugin.connectCalled = true;
      plugin.onMessage = onMessage;
      plugin._status.status = 'connected';
    },

    async disconnect() {
      plugin.disconnectCalled = true;
      plugin._status.status = 'disconnected';
    },

    async sendMessage(message: OutboundMessage) {
      plugin.sentMessages.push(message);
    },

    getStatus(): ChannelInfo {
      return plugin._status;
    },

    async simulateInbound(msg: ChannelMessage) {
      if (plugin.onMessage) {
        await plugin.onMessage(msg);
      }
    },
  };
  return plugin;
}

function createTestMessage(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: 'msg-1',
    senderId: 'user-1',
    senderName: 'Test User',
    channelType: 'test',
    chatId: 'chat-1',
    content: 'Hello agent',
    timestamp: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelManager', () => {
  let manager: ChannelManager;
  let onMessageHandler: jest.Mock;

  beforeEach(() => {
    resetLanes();
    onMessageHandler = jest.fn().mockResolvedValue('Agent response');
    manager = new ChannelManager({ onMessage: onMessageHandler });
  });

  describe('register', () => {
    it('should register a channel plugin', () => {
      const ch = createMockChannel();
      manager.register(ch);
      expect(manager.getRegisteredTypes()).toEqual(['test']);
    });

    it('should throw if channel type is already registered', () => {
      const ch1 = createMockChannel('telegram');
      const ch2 = createMockChannel('telegram');
      manager.register(ch1);
      expect(() => manager.register(ch2)).toThrow("Channel 'telegram' is already registered");
    });

    it('should support multiple channel types', () => {
      manager.register(createMockChannel('telegram'));
      manager.register(createMockChannel('discord'));
      manager.register(createMockChannel('slack'));
      expect(manager.getRegisteredTypes()).toEqual(['telegram', 'discord', 'slack']);
    });
  });

  describe('connectAll', () => {
    it('should connect all registered channels', async () => {
      const ch1 = createMockChannel('a');
      const ch2 = createMockChannel('b');
      manager.register(ch1);
      manager.register(ch2);

      await manager.connectAll();

      expect(ch1.connectCalled).toBe(true);
      expect(ch2.connectCalled).toBe(true);
    });

    it('should handle connection failures gracefully', async () => {
      const good = createMockChannel('good');
      const bad = createMockChannel('bad');
      bad.connect = jest.fn().mockRejectedValue(new Error('Connection failed'));

      manager.register(good);
      manager.register(bad);

      // Should not throw
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      await manager.connectAll();
      consoleSpy.mockRestore();

      expect(good.connectCalled).toBe(true);
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all channels', async () => {
      const ch1 = createMockChannel('a');
      const ch2 = createMockChannel('b');
      manager.register(ch1);
      manager.register(ch2);
      await manager.connectAll();

      await manager.disconnectAll();

      expect(ch1.disconnectCalled).toBe(true);
      expect(ch2.disconnectCalled).toBe(true);
    });
  });

  describe('sendMessage', () => {
    it('should send a message through the specified channel', async () => {
      const ch = createMockChannel('telegram');
      manager.register(ch);

      const msg: OutboundMessage = { chatId: 'chat-1', text: 'Hello' };
      await manager.sendMessage('telegram', msg);

      expect(ch.sentMessages).toEqual([msg]);
    });

    it('should throw for unregistered channel type', async () => {
      await expect(
        manager.sendMessage('unknown', { chatId: '1', text: 'hi' }),
      ).rejects.toThrow("Channel 'unknown' is not registered");
    });
  });

  describe('getStatus', () => {
    it('should return status of all channels', () => {
      const ch1 = createMockChannel('telegram');
      const ch2 = createMockChannel('discord');
      manager.register(ch1);
      manager.register(ch2);

      const statuses = manager.getStatus();
      expect(statuses).toHaveLength(2);
      expect(statuses[0].type).toBe('telegram');
      expect(statuses[1].type).toBe('discord');
    });

    it('should return empty array when no channels registered', () => {
      expect(manager.getStatus()).toEqual([]);
    });
  });

  describe('getChannel', () => {
    it('should return a specific channel plugin', () => {
      const ch = createMockChannel('telegram');
      manager.register(ch);
      expect(manager.getChannel('telegram')).toBe(ch);
    });

    it('should return undefined for unknown channel', () => {
      expect(manager.getChannel('unknown')).toBeUndefined();
    });
  });

  describe('message routing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should route inbound messages to onMessage handler and reply', async () => {
      const ch = createMockChannel('test');
      manager.register(ch);
      await manager.connectAll();

      const inbound = createTestMessage();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await ch.simulateInbound(inbound);

      // Advance past debounce window — this triggers the debouncer flush
      jest.advanceTimersByTime(2000);

      // The debouncer flush calls processVerifiedMessage which uses
      // enqueueCommandInLane (async). We need to let the promise chain settle.
      // Use a real-timer delay to flush microtasks properly.
      jest.useRealTimers();
      await new Promise(r => setTimeout(r, 50));
      jest.useFakeTimers();
      consoleSpy.mockRestore();

      // onMessage handler should have been called
      expect(onMessageHandler).toHaveBeenCalledWith(expect.objectContaining({
        content: inbound.content,
        senderId: inbound.senderId,
        chatId: inbound.chatId,
      }));

      // Response should have been sent back
      expect(ch.sentMessages).toHaveLength(1);
      expect(ch.sentMessages[0].text).toBe('Agent response');
      expect(ch.sentMessages[0].chatId).toBe('chat-1');
      expect(ch.sentMessages[0].replyTo).toBe('msg-1');
    });

    it('should handle onMessage errors gracefully', async () => {
      onMessageHandler.mockRejectedValue(new Error('Agent error'));
      const ch = createMockChannel('test');
      manager.register(ch);
      await manager.connectAll();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      // Should not throw
      await ch.simulateInbound(createTestMessage());
      jest.advanceTimersByTime(2000);
      jest.useRealTimers();
      await new Promise(r => setTimeout(r, 50));
      jest.useFakeTimers();
      consoleSpy.mockRestore();
      logSpy.mockRestore();

      // No response sent on error
      expect(ch.sentMessages).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Agent routing & session key tests
  // -----------------------------------------------------------------------

  describe('resolveAgentRoute', () => {
    it('should return default agent when no bindings match', () => {
      const route = manager.resolveAgentRoute({ channel: 'telegram' });
      expect(route.agentId).toBe('main');
      expect(route.matchedBy).toBe('default');
      expect(route.sessionKey).toBe('agent:main:main');
    });

    it('should match peer binding with correct kind', () => {
      manager.setBindings([
        { agentId: 'assistant', match: { channel: 'telegram', peer: { kind: 'direct', id: 'alice' } } },
      ]);
      const route = manager.resolveAgentRoute({
        channel: 'telegram',
        peer: { kind: 'direct', id: 'alice' },
      });
      expect(route.agentId).toBe('assistant');
      expect(route.matchedBy).toBe('binding.peer');
    });

    it('should NOT match peer binding when kind differs (direct vs group)', () => {
      manager.setBindings([
        { agentId: 'assistant', match: { channel: 'telegram', peer: { kind: 'group', id: '123' } } },
      ]);
      const route = manager.resolveAgentRoute({
        channel: 'telegram',
        peer: { kind: 'direct', id: '123' },
      });
      // Should fall through to default since group != direct
      expect(route.matchedBy).toBe('default');
    });

    it('should treat group and supergroup as compatible', () => {
      manager.setBindings([
        { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'group', id: '999' } } },
      ]);
      const route = manager.resolveAgentRoute({
        channel: 'telegram',
        peer: { kind: 'supergroup' as any, id: '999' },
      });
      expect(route.agentId).toBe('coder');
      expect(route.matchedBy).toBe('binding.peer');
    });

    it('should respect accountId filter in peer binding', () => {
      manager.setBindings([
        { agentId: 'bot2-agent', match: { channel: 'telegram', accountId: 'bot2', peer: { kind: 'direct', id: 'alice' } } },
      ]);
      // Message from bot1 account should NOT match
      const route1 = manager.resolveAgentRoute({
        channel: 'telegram',
        accountId: 'bot1',
        peer: { kind: 'direct', id: 'alice' },
      });
      expect(route1.matchedBy).toBe('default');

      // Message from bot2 account should match
      const route2 = manager.resolveAgentRoute({
        channel: 'telegram',
        accountId: 'bot2',
        peer: { kind: 'direct', id: 'alice' },
      });
      expect(route2.agentId).toBe('bot2-agent');
    });

    it('should match guild+roles binding', () => {
      manager.setBindings([
        { agentId: 'mod-agent', match: { channel: 'discord', guildId: 'g1', roles: ['admin', 'mod'] } },
      ]);
      const route = manager.resolveAgentRoute({
        channel: 'discord',
        guildId: 'g1',
        memberRoleIds: ['mod'],
      });
      expect(route.agentId).toBe('mod-agent');
      expect(route.matchedBy).toBe('binding.guild+roles');
    });

    it('should match guild binding (no roles)', () => {
      manager.setBindings([
        { agentId: 'guild-agent', match: { channel: 'discord', guildId: 'g2' } },
      ]);
      const route = manager.resolveAgentRoute({
        channel: 'discord',
        guildId: 'g2',
      });
      expect(route.agentId).toBe('guild-agent');
      expect(route.matchedBy).toBe('binding.guild');
    });

    it('should match team binding', () => {
      manager.setBindings([
        { agentId: 'slack-agent', match: { channel: 'slack', teamId: 'T123' } },
      ]);
      const route = manager.resolveAgentRoute({
        channel: 'slack',
        teamId: 'T123',
      });
      expect(route.agentId).toBe('slack-agent');
      expect(route.matchedBy).toBe('binding.team');
    });

    it('should match account binding', () => {
      manager.setBindings([
        { agentId: 'acct-agent', match: { channel: 'telegram', accountId: 'bot3' } },
      ]);
      const route = manager.resolveAgentRoute({
        channel: 'telegram',
        accountId: 'bot3',
      });
      expect(route.agentId).toBe('acct-agent');
      expect(route.matchedBy).toBe('binding.account');
    });

    it('should match channel binding', () => {
      manager.setBindings([
        { agentId: 'tg-agent', match: { channel: 'telegram' } },
      ]);
      const route = manager.resolveAgentRoute({ channel: 'telegram' });
      expect(route.agentId).toBe('tg-agent');
      expect(route.matchedBy).toBe('binding.channel');
    });

    it('should respect priority: peer > guild+roles > guild > team > account > channel', () => {
      manager.setBindings([
        { agentId: 'channel-agent', match: { channel: 'discord' } },
        { agentId: 'guild-agent', match: { channel: 'discord', guildId: 'g1' } },
        { agentId: 'peer-agent', match: { channel: 'discord', peer: { kind: 'direct', id: 'alice' } } },
      ]);
      // Peer should win even though guild and channel also match
      const route = manager.resolveAgentRoute({
        channel: 'discord',
        guildId: 'g1',
        peer: { kind: 'direct', id: 'alice' },
      });
      expect(route.agentId).toBe('peer-agent');
    });
  });

  // -----------------------------------------------------------------------
  // Session key building tests
  // -----------------------------------------------------------------------

  describe('session key building', () => {
    it('should build per-channel-peer DM session key (default)', () => {
      const route = manager.resolveAgentRoute({
        channel: 'telegram',
        peer: { kind: 'direct', id: '12345' },
      });
      expect(route.sessionKey).toBe('agent:main:telegram:direct:12345');
    });

    it('should build group session key', () => {
      const route = manager.resolveAgentRoute({
        channel: 'telegram',
        peer: { kind: 'group', id: 'grp-1' },
      });
      expect(route.sessionKey).toBe('agent:main:telegram:group:grp-1');
    });

    it('should build main session key when no peer', () => {
      const route = manager.resolveAgentRoute({ channel: 'telegram' });
      expect(route.sessionKey).toBe('agent:main:main');
      expect(route.mainSessionKey).toBe('agent:main:main');
    });

    it('should append thread suffix when threadId provided', () => {
      const route = manager.resolveAgentRoute({
        channel: 'discord',
        peer: { kind: 'group', id: 'ch-1' },
        threadId: 'thread-456',
      });
      expect(route.sessionKey).toBe('agent:main:discord:group:ch-1:thread:thread-456');
    });

    it('should use per-peer dmScope', () => {
      const mgr = new ChannelManager({
        onMessage: onMessageHandler,
        dmScope: 'per-peer',
      });
      const route = mgr.resolveAgentRoute({
        channel: 'telegram',
        peer: { kind: 'direct', id: 'alice' },
      });
      expect(route.sessionKey).toBe('agent:main:direct:alice');
    });

    it('should use main dmScope', () => {
      const mgr = new ChannelManager({
        onMessage: onMessageHandler,
        dmScope: 'main',
      });
      const route = mgr.resolveAgentRoute({
        channel: 'telegram',
        peer: { kind: 'direct', id: 'alice' },
      });
      expect(route.sessionKey).toBe('agent:main:main');
    });

    it('should use per-account-channel-peer dmScope', () => {
      const mgr = new ChannelManager({
        onMessage: onMessageHandler,
        dmScope: 'per-account-channel-peer',
      });
      const route = mgr.resolveAgentRoute({
        channel: 'telegram',
        accountId: 'bot1',
        peer: { kind: 'direct', id: 'alice' },
      });
      expect(route.sessionKey).toBe('agent:main:telegram:bot1:direct:alice');
    });

    it('should include agentId from binding in session key', () => {
      manager.setBindings([
        { agentId: 'coder', match: { channel: 'telegram' } },
      ]);
      const route = manager.resolveAgentRoute({
        channel: 'telegram',
        peer: { kind: 'direct', id: 'bob' },
      });
      expect(route.sessionKey).toBe('agent:coder:telegram:direct:bob');
      expect(route.mainSessionKey).toBe('agent:coder:main');
    });
  });
});
