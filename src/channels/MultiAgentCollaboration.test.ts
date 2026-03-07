/**
 * Integration test: 一个频道多个智能体协同工作
 *
 * Scenario: A single Telegram channel with 3 agents (main, coder, assistant)
 * bound via different rules. Tests the full pipeline:
 *   Bindings → Route Resolver → Session Key Builder → CommandLane → SubagentRegistry
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
  getLaneStats,
  enqueueCommandInLane,
} from './CommandLane';
import {
  registerSubagentRun,
  completeSubagentRun,
  countActiveRunsForSession,
  listDescendantRunsForRequester,
  getSubagentRun,
  getSubagentStats,
  resetSubagentRegistry,
  setSubagentLimits,
} from '../agents/SubagentRegistry';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Tracks which agentId handled each message */
interface RouteLog {
  agentId: string;
  sessionKey: string;
  matchedBy: string;
  content: string;
}

function createMockTelegramChannel(): ChannelPlugin & {
  sentMessages: OutboundMessage[];
  onMessage: OnMessageCallback | null;
  simulateInbound: (msg: ChannelMessage) => Promise<void>;
} {
  const plugin: any = {
    type: 'telegram',
    displayName: 'Telegram',
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
      return { type: 'telegram', status: 'connected', messageCount: 0 };
    },
    async simulateInbound(msg: ChannelMessage) {
      if (plugin.onMessage) await plugin.onMessage(msg);
    },
  };
  return plugin;
}

function msg(overrides: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    senderId: 'user-1',
    senderName: 'Alice',
    channelType: 'telegram',
    chatId: 'chat-1',
    // Long content to bypass debouncer (>200 chars)
    content: 'A'.repeat(201),
    timestamp: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Multi-Agent Collaboration on Single Channel', () => {
  let tg: ReturnType<typeof createMockTelegramChannel>;
  let routeLog: RouteLog[];
  let manager: ChannelManager;

  beforeEach(() => {
    resetLanes();
    resetSubagentRegistry();
    routeLog = [];
    tg = createMockTelegramChannel();
  });

  /**
   * Helper: create a ChannelManager with bindings and an onMessage handler
   * that logs the resolved route for each message.
   */
  function setupManager(bindings: AgentBinding[], opts?: Partial<ChannelManagerConfig>) {
    manager = new ChannelManager({
      onMessage: async (message) => {
        const chatType = message.chatType ?? 'direct';
        // For DMs, peer is the sender; for groups/channels, peer is the chat (group ID)
        const peerId = chatType === 'direct' ? message.senderId : message.chatId;
        const route = manager.resolveAgentRoute({
          channel: message.channelType,
          accountId: message.accountId,
          peer: peerId
            ? { kind: chatType as any, id: peerId }
            : undefined,
          guildId: message.guildId,
          threadId: message.threadId,
        });
        routeLog.push({
          agentId: route.agentId,
          sessionKey: route.sessionKey,
          matchedBy: route.matchedBy,
          content: message.content,
        });
        return `[${route.agentId}] response`;
      },
      bindings,
      defaultAgentId: 'main',
      ...opts,
    });
    manager.register(tg);
  }

  // =====================================================================
  // Scenario 1: Different users → different agents via peer bindings
  // =====================================================================

  describe('Scenario 1: peer-based agent routing', () => {
    beforeEach(async () => {
      setupManager([
        { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'direct', id: 'dev-alice' } } },
        { agentId: 'assistant', match: { channel: 'telegram', peer: { kind: 'direct', id: 'pm-bob' } } },
        // No binding for user "visitor-carol" → falls to default "main"
      ]);
      await manager.connectAll();
    });

    it('routes Alice to coder, Bob to assistant, Carol to main', async () => {
      await tg.simulateInbound(msg({ senderId: 'dev-alice', chatType: 'direct', content: 'A'.repeat(201) }));
      await tg.simulateInbound(msg({ senderId: 'pm-bob', chatType: 'direct', content: 'B'.repeat(201) }));
      await tg.simulateInbound(msg({ senderId: 'visitor-carol', chatType: 'direct', content: 'C'.repeat(201) }));

      // Wait for CommandLane to process
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog).toHaveLength(3);
      expect(routeLog[0].agentId).toBe('coder');
      expect(routeLog[0].matchedBy).toBe('binding.peer');
      expect(routeLog[1].agentId).toBe('assistant');
      expect(routeLog[1].matchedBy).toBe('binding.peer');
      expect(routeLog[2].agentId).toBe('main');
      expect(routeLog[2].matchedBy).toBe('default');
    });

    it('each agent gets its own session key', async () => {
      await tg.simulateInbound(msg({ senderId: 'dev-alice', chatType: 'direct' }));
      await tg.simulateInbound(msg({ senderId: 'pm-bob', chatType: 'direct' }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].sessionKey).toBe('agent:coder:telegram:direct:dev-alice');
      expect(routeLog[1].sessionKey).toBe('agent:assistant:telegram:direct:pm-bob');
      // Different agents → different session keys → isolated conversations
      expect(routeLog[0].sessionKey).not.toBe(routeLog[1].sessionKey);
    });

    it('replies go back through the same channel', async () => {
      await tg.simulateInbound(msg({ senderId: 'dev-alice', chatType: 'direct', chatId: 'chat-alice' }));
      await new Promise(r => setTimeout(r, 100));

      expect(tg.sentMessages).toHaveLength(1);
      expect(tg.sentMessages[0].text).toBe('[coder] response');
      expect(tg.sentMessages[0].chatId).toBe('chat-alice');
    });
  });

  // =====================================================================
  // Scenario 2: Group chat + DM on same channel, different agents
  // =====================================================================

  describe('Scenario 2: group vs DM routing on same channel', () => {
    beforeEach(async () => {
      setupManager([
        // Group chat in group-123 → coder agent
        { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'group', id: 'group-123' } } },
        // DM from same user → assistant agent
        { agentId: 'assistant', match: { channel: 'telegram', peer: { kind: 'direct', id: 'user-x' } } },
      ]);
      await manager.connectAll();
    });

    it('routes group messages to coder and DMs to assistant', async () => {
      // Group message in group-123 from user-x
      await tg.simulateInbound(msg({
        senderId: 'user-x',
        chatType: 'group',
        chatId: 'group-123',
        content: 'G'.repeat(201),
      }));
      // DM from same user
      await tg.simulateInbound(msg({
        senderId: 'user-x',
        chatType: 'direct',
        chatId: 'dm-user-x',
        content: 'D'.repeat(201),
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog).toHaveLength(2);
      // Group → coder (peer kind=group, id=group-123 from chatId)
      expect(routeLog[0].agentId).toBe('coder');
      // DM → assistant (peer kind=direct, id=user-x from senderId)
      expect(routeLog[1].agentId).toBe('assistant');
    });

    it('group and DM have different session keys', async () => {
      await tg.simulateInbound(msg({
        senderId: 'user-x', chatType: 'group', chatId: 'group-123',
        content: 'G'.repeat(201),
      }));
      await tg.simulateInbound(msg({
        senderId: 'user-x', chatType: 'direct', chatId: 'dm-user-x',
        content: 'D'.repeat(201),
      }));
      await new Promise(r => setTimeout(r, 100));

      // Group session: agent:coder:telegram:group:group-123
      expect(routeLog[0].sessionKey).toBe('agent:coder:telegram:group:group-123');
      // DM session: agent:assistant:telegram:direct:user-x
      expect(routeLog[1].sessionKey).toBe('agent:assistant:telegram:direct:user-x');
      expect(routeLog[0].sessionKey).not.toBe(routeLog[1].sessionKey);
    });
  });

  // =====================================================================
  // Scenario 3: Thread isolation within a group
  // =====================================================================

  describe('Scenario 3: thread isolation', () => {
    beforeEach(async () => {
      setupManager([
        { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'group', id: 'dev-group' } } },
      ]);
      await manager.connectAll();
    });

    it('different threads in same group get different session keys', async () => {
      await tg.simulateInbound(msg({
        senderId: 'user-1', chatType: 'group', chatId: 'dev-group', threadId: 'thread-A',
        content: 'T1'.repeat(101),
      }));
      await tg.simulateInbound(msg({
        senderId: 'user-1', chatType: 'group', chatId: 'dev-group', threadId: 'thread-B',
        content: 'T2'.repeat(101),
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog).toHaveLength(2);
      expect(routeLog[0].sessionKey).toContain(':thread:thread-A');
      expect(routeLog[1].sessionKey).toContain(':thread:thread-B');
      expect(routeLog[0].sessionKey).not.toBe(routeLog[1].sessionKey);
      // Both routed to same agent
      expect(routeLog[0].agentId).toBe('coder');
      expect(routeLog[1].agentId).toBe('coder');
    });

    it('message without threadId gets base session key', async () => {
      await tg.simulateInbound(msg({
        senderId: 'user-1', chatType: 'group', chatId: 'dev-group',
        content: 'X'.repeat(201),
      }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].sessionKey).not.toContain(':thread:');
      expect(routeLog[0].sessionKey).toBe('agent:coder:telegram:group:dev-group');
    });
  });

  // =====================================================================
  // Scenario 4: Binding priority — peer > channel-level
  // =====================================================================

  describe('Scenario 4: binding priority within one channel', () => {
    beforeEach(async () => {
      setupManager([
        // Channel-level catch-all → assistant
        { agentId: 'assistant', match: { channel: 'telegram' } },
        // Specific peer → coder (should win over channel-level)
        { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'direct', id: 'vip-user' } } },
      ]);
      await manager.connectAll();
    });

    it('VIP user gets coder, others get assistant', async () => {
      await tg.simulateInbound(msg({ senderId: 'vip-user', chatType: 'direct', content: 'V'.repeat(201) }));
      await tg.simulateInbound(msg({ senderId: 'normal-user', chatType: 'direct', content: 'N'.repeat(201) }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].agentId).toBe('coder');
      expect(routeLog[0].matchedBy).toBe('binding.peer');
      expect(routeLog[1].agentId).toBe('assistant');
      expect(routeLog[1].matchedBy).toBe('binding.channel');
    });
  });

  // =====================================================================
  // Scenario 5: CommandLane concurrency control
  // =====================================================================

  describe('Scenario 5: CommandLane concurrency', () => {
    it('respects main lane concurrency limit', async () => {
      setCommandLaneConcurrency('main', 2);

      let running = 0;
      let maxRunning = 0;
      const completionOrder: string[] = [];

      setupManager([], {
        onMessage: async (message) => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          // Simulate slow agent processing
          await new Promise(r => setTimeout(r, 50));
          running--;
          completionOrder.push(message.senderId);
          return `response-${message.senderId}`;
        },
      });
      await manager.connectAll();

      // Fire 5 messages concurrently
      const promises = [
        tg.simulateInbound(msg({ senderId: 'u1', content: '1'.repeat(201) })),
        tg.simulateInbound(msg({ senderId: 'u2', content: '2'.repeat(201) })),
        tg.simulateInbound(msg({ senderId: 'u3', content: '3'.repeat(201) })),
        tg.simulateInbound(msg({ senderId: 'u4', content: '4'.repeat(201) })),
        tg.simulateInbound(msg({ senderId: 'u5', content: '5'.repeat(201) })),
      ];

      // Wait for all to complete
      await Promise.all(promises);
      await new Promise(r => setTimeout(r, 300));

      // Max concurrent should not exceed 2
      expect(maxRunning).toBeLessThanOrEqual(2);
      // All 5 should have completed
      expect(completionOrder).toHaveLength(5);
      // All 5 responses sent
      expect(tg.sentMessages).toHaveLength(5);
    });

    it('subagent lane is independent from main lane', async () => {
      setCommandLaneConcurrency('main', 1);
      setCommandLaneConcurrency('subagent', 2);

      // Main lane task
      let mainResolve: () => void;
      const mainBlocking = new Promise<void>(r => { mainResolve = r; });
      const mainTask = enqueueCommandInLane('main', () => mainBlocking);

      // Subagent tasks should not be blocked by main lane
      let subCompleted = 0;
      const sub1 = enqueueCommandInLane('subagent', async () => { subCompleted++; });
      const sub2 = enqueueCommandInLane('subagent', async () => { subCompleted++; });

      await sub1;
      await sub2;
      expect(subCompleted).toBe(2);

      // Main is still blocked
      const stats = getLaneStats();
      expect(stats.main.running).toBe(1);

      mainResolve!();
      await mainTask;
    });
  });

  // =====================================================================
  // Scenario 6: SubagentRegistry — agent delegation
  // =====================================================================

  describe('Scenario 6: sub-agent delegation', () => {
    it('main agent spawns coder sub-agent with proper session keys', () => {
      setSubagentLimits({ maxSpawnDepth: 2, maxChildrenPerAgent: 3 });

      const parentSession = 'agent:main:telegram:direct:alice';
      const run = registerSubagentRun({
        runId: 'run-001',
        requesterSessionKey: parentSession,
        childSessionKey: 'agent:coder:subagent:run-001',
        agentId: 'coder',
        model: 'google/gemini-2.0-flash',
        depth: 0,
      });

      expect(run.status).toBe('running');
      expect(run.agentId).toBe('coder');
      expect(countActiveRunsForSession(parentSession)).toBe(1);

      // Complete the sub-agent
      completeSubagentRun('run-001');
      expect(getSubagentRun('run-001')!.status).toBe('completed');
      expect(countActiveRunsForSession(parentSession)).toBe(0);
    });

    it('enforces children limit per requester session', () => {
      setSubagentLimits({ maxChildrenPerAgent: 2, maxSpawnDepth: 3 });
      const parent = 'agent:main:telegram:direct:alice';

      registerSubagentRun({ runId: 'r1', requesterSessionKey: parent, childSessionKey: 's1', agentId: 'coder', depth: 0 });
      registerSubagentRun({ runId: 'r2', requesterSessionKey: parent, childSessionKey: 's2', agentId: 'assistant', depth: 0 });

      // Third should fail
      expect(() => registerSubagentRun({
        runId: 'r3', requesterSessionKey: parent, childSessionKey: 's3', agentId: 'reviewer', depth: 0,
      })).toThrow(/children limit/);

      // Complete one → can spawn again
      completeSubagentRun('r1');
      const r3 = registerSubagentRun({
        runId: 'r3', requesterSessionKey: parent, childSessionKey: 's3', agentId: 'reviewer', depth: 0,
      });
      expect(r3.status).toBe('running');
    });

    it('enforces spawn depth limit', () => {
      setSubagentLimits({ maxSpawnDepth: 1 });

      // depth=0 OK
      registerSubagentRun({
        runId: 'top', requesterSessionKey: 'agent:main:main',
        childSessionKey: 'agent:coder:subagent:top', agentId: 'coder', depth: 0,
      });

      // depth=1 should fail (maxSpawnDepth=1 means only depth 0 is allowed)
      expect(() => registerSubagentRun({
        runId: 'nested', requesterSessionKey: 'agent:coder:subagent:top',
        childSessionKey: 'agent:assistant:subagent:nested', agentId: 'assistant', depth: 1,
      })).toThrow(/spawn depth limit/);
    });

    it('tracks multiple sub-agents from same parent', () => {
      setSubagentLimits({ maxSpawnDepth: 2, maxChildrenPerAgent: 10 });
      const parent = 'agent:main:telegram:direct:alice';

      registerSubagentRun({ runId: 'a', requesterSessionKey: parent, childSessionKey: 'sa', agentId: 'coder' });
      registerSubagentRun({ runId: 'b', requesterSessionKey: parent, childSessionKey: 'sb', agentId: 'assistant' });
      registerSubagentRun({ runId: 'c', requesterSessionKey: parent, childSessionKey: 'sc', agentId: 'reviewer' });

      const descendants = listDescendantRunsForRequester(parent);
      expect(descendants).toHaveLength(3);
      expect(descendants.map(d => d.agentId).sort()).toEqual(['assistant', 'coder', 'reviewer']);

      completeSubagentRun('a');
      completeSubagentRun('b', 'timeout');

      const stats = getSubagentStats();
      expect(stats.running).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
    });
  });

  // =====================================================================
  // Scenario 7: dmScope variations on same channel
  // =====================================================================

  describe('Scenario 7: dmScope session isolation', () => {
    it('per-peer: same user on different accounts shares session', async () => {
      setupManager([], { dmScope: 'per-peer' });
      await manager.connectAll();

      await tg.simulateInbound(msg({ senderId: 'alice', accountId: 'bot1', chatType: 'direct', content: 'X'.repeat(201) }));
      await tg.simulateInbound(msg({ senderId: 'alice', accountId: 'bot2', chatType: 'direct', content: 'Y'.repeat(201) }));
      await new Promise(r => setTimeout(r, 100));

      // per-peer: session key is agent:main:direct:alice (no channel/account)
      expect(routeLog[0].sessionKey).toBe('agent:main:direct:alice');
      expect(routeLog[1].sessionKey).toBe('agent:main:direct:alice');
    });

    it('per-account-channel-peer: different accounts get different sessions', async () => {
      setupManager([], { dmScope: 'per-account-channel-peer' });
      await manager.connectAll();

      await tg.simulateInbound(msg({ senderId: 'alice', accountId: 'bot1', chatType: 'direct', content: 'X'.repeat(201) }));
      await tg.simulateInbound(msg({ senderId: 'alice', accountId: 'bot2', chatType: 'direct', content: 'Y'.repeat(201) }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].sessionKey).toBe('agent:main:telegram:bot1:direct:alice');
      expect(routeLog[1].sessionKey).toBe('agent:main:telegram:bot2:direct:alice');
      expect(routeLog[0].sessionKey).not.toBe(routeLog[1].sessionKey);
    });

    it('main: all DMs collapse to single session', async () => {
      setupManager([], { dmScope: 'main' });
      await manager.connectAll();

      await tg.simulateInbound(msg({ senderId: 'alice', chatType: 'direct', content: 'X'.repeat(201) }));
      await tg.simulateInbound(msg({ senderId: 'bob', chatType: 'direct', content: 'Y'.repeat(201) }));
      await new Promise(r => setTimeout(r, 100));

      expect(routeLog[0].sessionKey).toBe('agent:main:main');
      expect(routeLog[1].sessionKey).toBe('agent:main:main');
    });
  });

  // =====================================================================
  // Scenario 8: Dynamic binding updates
  // =====================================================================

  describe('Scenario 8: runtime binding updates', () => {
    beforeEach(async () => {
      setupManager([]);
      await manager.connectAll();
    });

    it('new bindings take effect immediately', async () => {
      // Initially no bindings → default agent
      await tg.simulateInbound(msg({ senderId: 'alice', chatType: 'direct', content: 'X'.repeat(201) }));
      await new Promise(r => setTimeout(r, 100));
      expect(routeLog[0].agentId).toBe('main');

      // Add binding at runtime
      manager.setBindings([
        { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'direct', id: 'alice' } } },
      ]);

      await tg.simulateInbound(msg({ senderId: 'alice', chatType: 'direct', content: 'Y'.repeat(201) }));
      await new Promise(r => setTimeout(r, 100));
      expect(routeLog[1].agentId).toBe('coder');
    });

    it('getBindings returns current bindings', () => {
      expect(manager.getBindings()).toEqual([]);
      const bindings: AgentBinding[] = [
        { agentId: 'a', match: { channel: 'telegram' } },
      ];
      manager.setBindings(bindings);
      expect(manager.getBindings()).toEqual(bindings);
    });
  });

  // =====================================================================
  // Scenario 9: End-to-end — full pipeline with concurrent multi-agent
  // =====================================================================

  describe('Scenario 9: concurrent multi-agent end-to-end', () => {
    it('handles concurrent messages to different agents correctly', async () => {
      const agentResponses: Record<string, string> = {};

      let mgrRef: ChannelManager;
      const mgr: ChannelManager = new ChannelManager({
        onMessage: async (message: ChannelMessage): Promise<string> => {
          const route = mgrRef.resolveAgentRoute({
            channel: message.channelType,
            peer: { kind: (message.chatType ?? 'direct') as any, id: message.senderId },
          });
          // Simulate different processing times per agent
          const delay = route.agentId === 'coder' ? 80 : 20;
          await new Promise(r => setTimeout(r, delay));
          const resp = `[${route.agentId}] handled ${message.senderId}`;
          agentResponses[message.senderId] = resp;
          return resp;
        },
        bindings: [
          { agentId: 'coder', match: { channel: 'telegram', peer: { kind: 'direct', id: 'dev' } } },
          { agentId: 'assistant', match: { channel: 'telegram', peer: { kind: 'direct', id: 'pm' } } },
        ],
        defaultAgentId: 'main',
      });
      mgrRef = mgr;

      const ch = createMockTelegramChannel();
      mgr.register(ch);
      await mgr.connectAll();

      // Fire 3 messages concurrently to 3 different agents
      await Promise.all([
        ch.simulateInbound(msg({ senderId: 'dev', chatType: 'direct', chatId: 'c1', content: 'A'.repeat(201) })),
        ch.simulateInbound(msg({ senderId: 'pm', chatType: 'direct', chatId: 'c2', content: 'B'.repeat(201) })),
        ch.simulateInbound(msg({ senderId: 'visitor', chatType: 'direct', chatId: 'c3', content: 'C'.repeat(201) })),
      ]);

      await new Promise(r => setTimeout(r, 200));

      // All 3 should have been handled
      expect(Object.keys(agentResponses)).toHaveLength(3);
      expect(agentResponses['dev']).toContain('[coder]');
      expect(agentResponses['pm']).toContain('[assistant]');
      expect(agentResponses['visitor']).toContain('[main]');

      // All 3 responses sent back
      expect(ch.sentMessages).toHaveLength(3);
    });
  });

  // =====================================================================
  // Scenario 10: Sub-agent + CommandLane integration
  // =====================================================================

  describe('Scenario 10: sub-agent via CommandLane', () => {
    it('sub-agent tasks run in subagent lane, not main lane', async () => {
      setCommandLaneConcurrency('main', 1);
      setCommandLaneConcurrency('subagent', 4);
      setSubagentLimits({ maxSpawnDepth: 2, maxChildrenPerAgent: 5 });

      const parentSession = 'agent:main:telegram:direct:alice';
      const results: string[] = [];

      // Simulate: main agent delegates to 3 sub-agents concurrently
      const subTasks = ['research', 'code-review', 'testing'].map(async (task, i) => {
        const runId = `sub-${i}`;
        registerSubagentRun({
          runId,
          requesterSessionKey: parentSession,
          childSessionKey: `agent:${task}:subagent:${runId}`,
          agentId: task,
          depth: 0,
        });

        const result = await enqueueCommandInLane('subagent', async () => {
          await new Promise(r => setTimeout(r, 30));
          return `${task}-done`;
        });

        completeSubagentRun(runId);
        results.push(result);
      });

      await Promise.all(subTasks);

      expect(results).toHaveLength(3);
      expect(results).toContain('research-done');
      expect(results).toContain('code-review-done');
      expect(results).toContain('testing-done');

      // All sub-agents completed
      expect(getSubagentStats().running).toBe(0);
      expect(getSubagentStats().completed).toBe(3);

      // Subagent lane was used, not main
      const stats = getLaneStats();
      expect(stats.subagent).toBeDefined();
    });
  });
});
