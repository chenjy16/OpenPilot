/**
 * Integration test: 多频道多智能体协同工作 (Telegram + Discord)
 *
 * Tests the full cross-channel multi-agent pipeline:
 *   - Same agent accessible from both Telegram and Discord
 *   - Different agents bound to different channels
 *   - Guild-based routing on Discord + peer-based routing on Telegram
 *   - Session isolation across channels (same user, different channels)
 *   - Cross-channel sub-agent delegation
 *   - Thread isolation on Discord + DM routing on Telegram
 *   - Dynamic binding updates affecting both channels
 *   - Concurrent messages across both channels
 *
 * Design doc: "多频道多智能体协同工作.md"
 */

import { ChannelManager, ChannelManagerConfig } from './ChannelManager';
import {
  ChannelPlugin,
  ChannelMessage,
  OutboundMessage,
  ChannelInfo,
  OnMessageCallback,
  AgentBinding,
} from './types';
import {
  resetLanes,
  setCommandLaneConcurrency,
} from './CommandLane';
import {
  registerSubagentRun,
  completeSubagentRun,
  resetSubagentRegistry,
  setSubagentLimits,
  getSubagentStats,
} from '../agents/SubagentRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RouteLog {
  agentId: string;
  sessionKey: string;
  matchedBy: string;
  channel: string;
  content: string;
}

function createMockChannel(type: string): ChannelPlugin & {
  sentMessages: OutboundMessage[];
  onMessage: OnMessageCallback | null;
  simulateInbound: (msg: ChannelMessage) => Promise<void>;
} {
  const plugin: any = {
    type,
    displayName: type.charAt(0).toUpperCase() + type.slice(1),
    sentMessages: [] as OutboundMessage[],
    onMessage: null as OnMessageCallback | null,

    async connect(onMessage: OnMessageCallback) {
      plugin.onMessage = onMessage;
    },
    async disconnect() {},
    async sendMessage(message: OutboundMessage) {
      plugin.sentMessages.push(message);
    },
    getStatus(): ChannelInfo {
      return { type, status: 'connected', messageCount: 0 };
    },
    async simulateInbound(msg: ChannelMessage) {
      if (plugin.onMessage) await plugin.onMessage(msg);
    },
  };
  return plugin;
}

/** Create a ChannelMessage with defaults, content long enough to bypass debouncer */
function msg(overrides: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    senderId: 'user-1',
    senderName: 'Alice',
    channelType: 'telegram',
    chatId: 'chat-1',
    content: 'X'.repeat(201),
    timestamp: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cross-Channel Multi-Agent Collaboration (Telegram + Discord)', () => {
  let tg: ReturnType<typeof createMockChannel>;
  let dc: ReturnType<typeof createMockChannel>;
  let routeLog: RouteLog[];
  let manager: ChannelManager;

  beforeEach(() => {
    resetLanes();
    resetSubagentRegistry();
    routeLog = [];
    tg = createMockChannel('telegram');
    dc = createMockChannel('discord');
  });

  function setupManager(bindings: AgentBinding[], opts?: Partial<ChannelManagerConfig>) {
    manager = new ChannelManager({
      onMessage: async (message) => {
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
          channel: message.channelType,
          content: message.content.slice(0, 20),
        });
        return `[${route.agentId}] response via ${message.channelType}`;
      },
      bindings,
      defaultAgentId: 'main',
      ...opts,
    });
    manager.register(tg);
    manager.register(dc);
  }

  // =====================================================================
  // Scenario 1: Channel-level agent binding — each channel gets its own agent
  // =====================================================================

  describe('Scenario 1: channel-level agent separation', () => {
    beforeEach(async () => {
      setupManager([
        { agentId: 'tg-agent', match: { channel: 'telegram' } },
        { agentId: 'dc-agent', match: { channel: 'discord' } },
      ]);
      await manager.connectAll();
    });

    it('routes Telegram messages to tg-agent and Discord to dc-agent', async () => {
      await tg.simulateInbound(msg({ channelType: 'telegram', senderId: 'alice', chatType: 'direct' }));
      await dc.simulateInbound(msg({ channelType: 'discord', senderId: 'alice', chatType: 'direct' }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog).toHaveLength(2);
      expect(routeLog[0].agentId).toBe('tg-agent');
      expect(routeLog[0].matchedBy).toBe('binding.channel');
      expect(routeLog[1].agentId).toBe('dc-agent');
      expect(routeLog[1].matchedBy).toBe('binding.channel');
    });

    it('responses go back to the correct channel', async () => {
      await tg.simulateInbound(msg({ channelType: 'telegram', senderId: 'alice', chatType: 'direct', chatId: 'tg-chat' }));
      await dc.simulateInbound(msg({ channelType: 'discord', senderId: 'alice', chatType: 'direct', chatId: 'dc-chat' }));
      await new Promise(r => setTimeout(r, 100));

      expect(tg.sentMessages).toHaveLength(1);
      expect(tg.sentMessages[0].text).toContain('[tg-agent]');
      expect(tg.sentMessages[0].chatId).toBe('tg-chat');

      expect(dc.sentMessages).toHaveLength(1);
      expect(dc.sentMessages[0].text).toContain('[dc-agent]');
      expect(dc.sentMessages[0].chatId).toBe('dc-chat');
    });
  });

  // =====================================================================
  // Scenario 2: Same user, different channels → different sessions
  // =====================================================================

  describe('Scenario 2: session isolation across channels', () => {
    beforeEach(async () => {
      setupManager([]);
      await manager.connectAll();
    });

    it('same user on Telegram and Discord gets different session keys', async () => {
      await tg.simulateInbound(msg({ channelType: 'telegram', senderId: 'alice', chatType: 'direct' }));
      await dc.simulateInbound(msg({ channelType: 'discord', senderId: 'alice', chatType: 'direct' }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog).toHaveLength(2);
      // Default dmScope is per-channel-peer → includes channel name
      expect(routeLog[0].sessionKey).toBe('agent:main:telegram:direct:alice');
      expect(routeLog[1].sessionKey).toBe('agent:main:discord:direct:alice');
      expect(routeLog[0].sessionKey).not.toBe(routeLog[1].sessionKey);
    });

    it('per-peer dmScope collapses cross-channel sessions', async () => {
      // Recreate with per-peer scope
      setupManager([], { dmScope: 'per-peer' });
      await manager.connectAll();

      await tg.simulateInbound(msg({ channelType: 'telegram', senderId: 'alice', chatType: 'direct' }));
      await dc.simulateInbound(msg({ channelType: 'discord', senderId: 'alice', chatType: 'direct' }));
      await new Promise(r => setTimeout(r, 100));

      // per-peer: session key has no channel → same session
      expect(routeLog[0].sessionKey).toBe('agent:main:direct:alice');
      expect(routeLog[1].sessionKey).toBe('agent:main:direct:alice');
    });
  });

  // =====================================================================
  // Scenario 3: Peer binding on Telegram + Guild binding on Discord
  // =====================================================================

  describe('Scenario 3: mixed binding types across channels', () => {
    beforeEach(async () => {
      setupManager([
        // Telegram: specific user → coder
        { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'direct', id: 'dev-alice' } } },
        // Discord: specific guild → reviewer
        { agentId: 'reviewer', match: { channel: 'discord', guildId: 'review-guild' } },
        // Discord: specific DM user → assistant
        { agentId: 'assistant', match: { channel: 'discord', peer: { kind: 'direct', id: 'pm-bob' } } },
      ]);
      await manager.connectAll();
    });

    it('routes by peer on Telegram and by guild on Discord', async () => {
      // Telegram DM from dev-alice → coder
      await tg.simulateInbound(msg({
        channelType: 'telegram', senderId: 'dev-alice', chatType: 'direct',
      }));
      // Discord guild message → reviewer
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'random-user', chatType: 'group',
        chatId: 'text-channel-1', guildId: 'review-guild',
      }));
      // Discord DM from pm-bob → assistant
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'pm-bob', chatType: 'direct',
      }));
      // Telegram DM from unknown → default main
      await tg.simulateInbound(msg({
        channelType: 'telegram', senderId: 'random-user', chatType: 'direct',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog).toHaveLength(4);
      expect(routeLog[0]).toMatchObject({ agentId: 'coder', matchedBy: 'binding.peer', channel: 'telegram' });
      expect(routeLog[1]).toMatchObject({ agentId: 'reviewer', matchedBy: 'binding.guild', channel: 'discord' });
      expect(routeLog[2]).toMatchObject({ agentId: 'assistant', matchedBy: 'binding.peer', channel: 'discord' });
      expect(routeLog[3]).toMatchObject({ agentId: 'main', matchedBy: 'default', channel: 'telegram' });
    });

    it('peer binding on Discord takes priority over guild binding', async () => {
      // pm-bob in review-guild → peer binding wins (assistant, not reviewer)
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'pm-bob', chatType: 'direct',
        guildId: 'review-guild',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].agentId).toBe('assistant');
      expect(routeLog[0].matchedBy).toBe('binding.peer');
    });
  });

  // =====================================================================
  // Scenario 4: Discord threads + Telegram groups — session key structure
  // =====================================================================

  describe('Scenario 4: thread/group session keys across channels', () => {
    beforeEach(async () => {
      setupManager([
        { agentId: 'coder', match: { channel: 'discord', guildId: 'dev-guild' } },
        { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'group', id: 'dev-group' } } },
      ]);
      await manager.connectAll();
    });

    it('Discord threads get thread-suffixed session keys', async () => {
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'user-1', chatType: 'group',
        chatId: 'thread-abc', guildId: 'dev-guild', threadId: 'thread-abc',
      }));
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'user-1', chatType: 'group',
        chatId: 'general', guildId: 'dev-guild',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].sessionKey).toContain(':thread:thread-abc');
      expect(routeLog[1].sessionKey).not.toContain(':thread:');
    });

    it('Telegram group and Discord guild have different session keys for same agent', async () => {
      await tg.simulateInbound(msg({
        channelType: 'telegram', senderId: 'user-1', chatType: 'group', chatId: 'dev-group',
      }));
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'user-1', chatType: 'group',
        chatId: 'general', guildId: 'dev-guild',
      }));
      await new Promise(r => setTimeout(r, 100));

      // Both route to coder, but different session keys (different channels)
      expect(routeLog[0].agentId).toBe('coder');
      expect(routeLog[1].agentId).toBe('coder');
      expect(routeLog[0].sessionKey).toContain('telegram');
      expect(routeLog[1].sessionKey).toContain('discord');
      expect(routeLog[0].sessionKey).not.toBe(routeLog[1].sessionKey);
    });
  });

  // =====================================================================
  // Scenario 5: Account-level binding — multiple bots on same channel
  // =====================================================================

  describe('Scenario 5: account-level binding', () => {
    beforeEach(async () => {
      setupManager([
        { agentId: 'support-bot', match: { channel: 'discord', accountId: 'bot-support' } },
        { agentId: 'dev-bot', match: { channel: 'discord', accountId: 'bot-dev' } },
        { agentId: 'tg-main', match: { channel: 'telegram', accountId: 'tg-prod' } },
      ]);
      await manager.connectAll();
    });

    it('routes by accountId within same channel type', async () => {
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'user-1', chatType: 'direct', accountId: 'bot-support',
      }));
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'user-1', chatType: 'direct', accountId: 'bot-dev',
      }));
      await tg.simulateInbound(msg({
        channelType: 'telegram', senderId: 'user-1', chatType: 'direct', accountId: 'tg-prod',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].agentId).toBe('support-bot');
      expect(routeLog[0].matchedBy).toBe('binding.account');
      expect(routeLog[1].agentId).toBe('dev-bot');
      expect(routeLog[1].matchedBy).toBe('binding.account');
      expect(routeLog[2].agentId).toBe('tg-main');
      expect(routeLog[2].matchedBy).toBe('binding.account');
    });
  });

  // =====================================================================
  // Scenario 6: Concurrent messages across both channels
  // =====================================================================

  describe('Scenario 6: concurrent cross-channel messages', () => {
    it('handles simultaneous messages from both channels', async () => {
      setCommandLaneConcurrency('main', 4);
      const responses: Record<string, string> = {};

      const mgr: ChannelManager = new ChannelManager({
        onMessage: async (message): Promise<string> => {
          // Simulate processing delay
          await new Promise(r => setTimeout(r, 30));
          const resp = `[${message.channelType}] handled ${message.senderId}`;
          responses[`${message.channelType}:${message.senderId}`] = resp;
          return resp;
        },
        bindings: [],
        defaultAgentId: 'main',
      });

      const tgCh = createMockChannel('telegram');
      const dcCh = createMockChannel('discord');
      mgr.register(tgCh);
      mgr.register(dcCh);
      await mgr.connectAll();

      // Fire 6 messages concurrently: 3 from each channel
      await Promise.all([
        tgCh.simulateInbound(msg({ channelType: 'telegram', senderId: 'tg-1', chatType: 'direct', content: '1'.repeat(201) })),
        dcCh.simulateInbound(msg({ channelType: 'discord', senderId: 'dc-1', chatType: 'direct', content: '2'.repeat(201) })),
        tgCh.simulateInbound(msg({ channelType: 'telegram', senderId: 'tg-2', chatType: 'direct', content: '3'.repeat(201) })),
        dcCh.simulateInbound(msg({ channelType: 'discord', senderId: 'dc-2', chatType: 'direct', content: '4'.repeat(201) })),
        tgCh.simulateInbound(msg({ channelType: 'telegram', senderId: 'tg-3', chatType: 'direct', content: '5'.repeat(201) })),
        dcCh.simulateInbound(msg({ channelType: 'discord', senderId: 'dc-3', chatType: 'direct', content: '6'.repeat(201) })),
      ]);
      await new Promise(r => setTimeout(r, 300));

      // All 6 should complete
      expect(Object.keys(responses)).toHaveLength(6);
      expect(responses['telegram:tg-1']).toContain('[telegram]');
      expect(responses['discord:dc-1']).toContain('[discord]');

      // Responses sent back to correct channels
      expect(tgCh.sentMessages).toHaveLength(3);
      expect(dcCh.sentMessages).toHaveLength(3);
    });
  });

  // =====================================================================
  // Scenario 7: Cross-channel sub-agent delegation
  // =====================================================================

  describe('Scenario 7: sub-agent delegation across channels', () => {
    it('sub-agent spawned from Telegram session can serve Discord context', () => {
      setSubagentLimits({ maxSpawnDepth: 2, maxChildrenPerAgent: 5 });

      // Parent session from Telegram
      const tgParent = 'agent:main:telegram:direct:alice';
      // Sub-agent spawned to handle a task (could be triggered by Discord context)
      const run = registerSubagentRun({
        runId: 'cross-1',
        requesterSessionKey: tgParent,
        childSessionKey: 'agent:coder:subagent:cross-1',
        agentId: 'coder',
        model: 'google/gemini-2.0-flash',
        depth: 0,
      });

      expect(run.status).toBe('running');
      expect(run.agentId).toBe('coder');

      // Meanwhile, a Discord message also triggers a sub-agent from same parent concept
      const dcParent = 'agent:main:discord:direct:alice';
      const run2 = registerSubagentRun({
        runId: 'cross-2',
        requesterSessionKey: dcParent,
        childSessionKey: 'agent:reviewer:subagent:cross-2',
        agentId: 'reviewer',
        depth: 0,
      });

      expect(run2.status).toBe('running');

      // Each parent session has its own children count
      const stats = getSubagentStats();
      expect(stats.running).toBe(2);

      completeSubagentRun('cross-1');
      completeSubagentRun('cross-2');
      expect(getSubagentStats().running).toBe(0);
      expect(getSubagentStats().completed).toBe(2);
    });
  });

  // =====================================================================
  // Scenario 8: Dynamic binding updates affect both channels
  // =====================================================================

  describe('Scenario 8: dynamic binding updates', () => {
    beforeEach(async () => {
      setupManager([]);
      await manager.connectAll();
    });

    it('new bindings take effect on both channels immediately', async () => {
      // Initially: both channels → default main
      await tg.simulateInbound(msg({ channelType: 'telegram', senderId: 'alice', chatType: 'direct' }));
      await dc.simulateInbound(msg({ channelType: 'discord', senderId: 'alice', chatType: 'direct' }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].agentId).toBe('main');
      expect(routeLog[1].agentId).toBe('main');

      // Add channel-specific bindings
      manager.setBindings([
        { agentId: 'tg-specialist', match: { channel: 'telegram' } },
        { agentId: 'dc-specialist', match: { channel: 'discord' } },
      ]);

      await tg.simulateInbound(msg({ channelType: 'telegram', senderId: 'alice', chatType: 'direct' }));
      await dc.simulateInbound(msg({ channelType: 'discord', senderId: 'alice', chatType: 'direct' }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[2].agentId).toBe('tg-specialist');
      expect(routeLog[3].agentId).toBe('dc-specialist');
    });

    it('removing bindings falls back to default on both channels', async () => {
      manager.setBindings([
        { agentId: 'special', match: { channel: 'telegram' } },
      ]);

      await tg.simulateInbound(msg({ channelType: 'telegram', senderId: 'alice', chatType: 'direct' }));
      await dc.simulateInbound(msg({ channelType: 'discord', senderId: 'alice', chatType: 'direct' }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].agentId).toBe('special');
      expect(routeLog[1].agentId).toBe('main'); // No Discord binding → default

      // Clear all bindings
      manager.setBindings([]);

      await tg.simulateInbound(msg({ channelType: 'telegram', senderId: 'alice', chatType: 'direct' }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[2].agentId).toBe('main'); // Telegram also falls back
    });
  });

  // =====================================================================
  // Scenario 9: Complex multi-tier routing — peer > guild > channel > default
  // =====================================================================

  describe('Scenario 9: multi-tier priority across channels', () => {
    beforeEach(async () => {
      setupManager([
        // Tier 1: peer binding (highest priority)
        { agentId: 'vip-agent', match: { channel: 'discord', peer: { kind: 'direct', id: 'vip-user' } } },
        // Tier 3: guild binding
        { agentId: 'guild-agent', match: { channel: 'discord', guildId: 'main-guild' } },
        // Tier 6: channel catch-all
        { agentId: 'dc-default', match: { channel: 'discord' } },
        // Telegram peer
        { agentId: 'tg-vip', match: { channel: 'telegram', peer: { kind: 'direct', id: 'vip-user' } } },
        // Telegram catch-all
        { agentId: 'tg-default', match: { channel: 'telegram' } },
      ]);
      await manager.connectAll();
    });

    it('Discord: peer > guild > channel for same user', async () => {
      // VIP user DM → peer binding wins
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'vip-user', chatType: 'direct',
      }));
      // Regular user in main-guild → guild binding
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'regular', chatType: 'group',
        chatId: 'general', guildId: 'main-guild',
      }));
      // Regular user in unknown guild → channel catch-all
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'outsider', chatType: 'group',
        chatId: 'other-ch', guildId: 'other-guild',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0]).toMatchObject({ agentId: 'vip-agent', matchedBy: 'binding.peer' });
      expect(routeLog[1]).toMatchObject({ agentId: 'guild-agent', matchedBy: 'binding.guild' });
      expect(routeLog[2]).toMatchObject({ agentId: 'dc-default', matchedBy: 'binding.channel' });
    });

    it('Telegram: peer > channel for same user', async () => {
      await tg.simulateInbound(msg({
        channelType: 'telegram', senderId: 'vip-user', chatType: 'direct',
      }));
      await tg.simulateInbound(msg({
        channelType: 'telegram', senderId: 'normal-user', chatType: 'direct',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0]).toMatchObject({ agentId: 'tg-vip', matchedBy: 'binding.peer' });
      expect(routeLog[1]).toMatchObject({ agentId: 'tg-default', matchedBy: 'binding.channel' });
    });

    it('same VIP user gets different agents on different channels', async () => {
      await tg.simulateInbound(msg({
        channelType: 'telegram', senderId: 'vip-user', chatType: 'direct',
      }));
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'vip-user', chatType: 'direct',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].agentId).toBe('tg-vip');
      expect(routeLog[1].agentId).toBe('vip-agent');
      // Different agents → different session keys
      expect(routeLog[0].sessionKey).not.toBe(routeLog[1].sessionKey);
    });
  });

  // =====================================================================
  // Scenario 10: Wildcard accountId binding
  // =====================================================================

  describe('Scenario 10: wildcard accountId', () => {
    beforeEach(async () => {
      setupManager([
        // Wildcard: any Discord account, specific peer
        { agentId: 'cross-bot', match: { channel: 'discord', accountId: '*', peer: { kind: 'direct', id: 'admin' } } },
      ]);
      await manager.connectAll();
    });

    it('wildcard accountId matches any account', async () => {
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'admin', chatType: 'direct', accountId: 'bot-1',
      }));
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'admin', chatType: 'direct', accountId: 'bot-2',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].agentId).toBe('cross-bot');
      expect(routeLog[1].agentId).toBe('cross-bot');
    });

    it('non-matching peer falls to default even with wildcard account', async () => {
      await dc.simulateInbound(msg({
        channelType: 'discord', senderId: 'random', chatType: 'direct', accountId: 'bot-1',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].agentId).toBe('main');
    });
  });

  // =====================================================================
  // Scenario 11: Group compatibility — Telegram group ↔ Discord group
  // =====================================================================

  describe('Scenario 11: group type compatibility', () => {
    beforeEach(async () => {
      setupManager([
        // Telegram supergroup binding
        { agentId: 'group-agent', match: { channel: 'telegram', peer: { kind: 'supergroup', id: 'tg-supergroup' } } },
      ]);
      await manager.connectAll();
    });

    it('Telegram group matches supergroup binding (kind compatibility)', async () => {
      // Send as 'group' type but binding is 'supergroup' — should match due to peerKindMatches
      await tg.simulateInbound(msg({
        channelType: 'telegram', senderId: 'user-1', chatType: 'group', chatId: 'tg-supergroup',
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].agentId).toBe('group-agent');
      expect(routeLog[0].matchedBy).toBe('binding.peer');
    });
  });

  // =====================================================================
  // Scenario 12: End-to-end — full pipeline with both channels
  // =====================================================================

  describe('Scenario 12: full end-to-end pipeline', () => {
    it('complete message flow: inbound → route → agent → outbound on both channels', async () => {
      const agentCallLog: string[] = [];

      const mgr: ChannelManager = new ChannelManager({
        onMessage: async (message): Promise<string> => {
          const chatType = message.chatType ?? 'direct';
          const peerId = chatType === 'direct' ? message.senderId : message.chatId;
          const route = mgr.resolveAgentRoute({
            channel: message.channelType,
            peer: peerId ? { kind: chatType as any, id: peerId } : undefined,
            guildId: message.guildId,
          });
          agentCallLog.push(`${route.agentId}@${message.channelType}`);
          return `Hello from ${route.agentId}!`;
        },
        bindings: [
          { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'direct', id: 'dev' } } },
          { agentId: 'reviewer', match: { channel: 'discord', guildId: 'review-guild' } },
        ],
        defaultAgentId: 'main',
      });

      const tgCh = createMockChannel('telegram');
      const dcCh = createMockChannel('discord');
      mgr.register(tgCh);
      mgr.register(dcCh);
      await mgr.connectAll();

      // Telegram: dev user DM → coder
      await tgCh.simulateInbound(msg({
        channelType: 'telegram', senderId: 'dev', chatType: 'direct', chatId: 'tg-dm',
        content: 'Fix the bug'.padEnd(201, '.'),
      }));
      // Discord: review guild message → reviewer
      await dcCh.simulateInbound(msg({
        channelType: 'discord', senderId: 'reviewer-1', chatType: 'group',
        chatId: 'review-ch', guildId: 'review-guild',
        content: 'Review PR #42'.padEnd(201, '.'),
      }));
      // Telegram: unknown user → main
      await tgCh.simulateInbound(msg({
        channelType: 'telegram', senderId: 'visitor', chatType: 'direct', chatId: 'tg-visitor',
        content: 'Hello?'.padEnd(201, '.'),
      }));
      // Discord: DM from random → main
      await dcCh.simulateInbound(msg({
        channelType: 'discord', senderId: 'random', chatType: 'direct', chatId: 'dc-dm',
        content: 'Hi bot'.padEnd(201, '.'),
      }));

      await new Promise(r => setTimeout(r, 200));

      // Verify agent routing
      expect(agentCallLog).toEqual([
        'coder@telegram',
        'reviewer@discord',
        'main@telegram',
        'main@discord',
      ]);

      // Verify responses sent to correct channels
      expect(tgCh.sentMessages).toHaveLength(2);
      expect(tgCh.sentMessages[0].chatId).toBe('tg-dm');
      expect(tgCh.sentMessages[0].text).toBe('Hello from coder!');
      expect(tgCh.sentMessages[1].chatId).toBe('tg-visitor');
      expect(tgCh.sentMessages[1].text).toBe('Hello from main!');

      expect(dcCh.sentMessages).toHaveLength(2);
      expect(dcCh.sentMessages[0].chatId).toBe('review-ch');
      expect(dcCh.sentMessages[0].text).toBe('Hello from reviewer!');
      expect(dcCh.sentMessages[1].chatId).toBe('dc-dm');
      expect(dcCh.sentMessages[1].text).toBe('Hello from main!');
    });
  });
});
