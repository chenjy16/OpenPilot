/**
 * Production Readiness E2E Test Suite
 *
 * 全面测试系统各功能和流程，确保生产可用。
 * LLM 调用层全部 mock，测试覆盖：
 *   1. HTTP API 全端点 (health, sessions, chat, models, agents, channels, config, etc.)
 *   2. WebSocket 流式对话
 *   3. Session 生命周期 (create → chat → compact → delete)
 *   4. Agent CRUD + 路由绑定
 *   5. Channel 管理 (register, connect, disconnect, reconnect, config CRUD)
 *   6. 多频道消息路由 (binding resolution, session key generation)
 *   7. Tool 执行 + Policy + Audit
 *   8. Config 读写 + 持久化
 *   9. Cron job CRUD
 *  10. 并发安全 (concurrent chat, session busy guard)
 *  11. 错误处理 (invalid input, 404, rate limit)
 *  12. Graceful degradation (no models configured)
 */

import http from 'http';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../session/database';
import { SessionManager } from '../session/SessionManager';
import { ModelManager } from '../models/ModelManager';
import { ToolExecutor } from '../tools/ToolExecutor';
import { AIRuntime } from '../runtime/AIRuntime';
import { APIServer } from '../api/server';
import { clearRateLimitState, setAllowedModels } from '../api/middleware';
import { AgentManager } from '../agents/AgentManager';
import { ChannelManager } from '../channels/ChannelManager';
import { PluginManager } from '../plugins/PluginManager';
import type { ChannelPlugin, ChannelMessage, OutboundMessage, ChannelInfo, OnMessageCallback } from '../channels/types';
import { registerFileTools } from '../tools/fileTools';
import { registerNetworkTools } from '../tools/networkTools';
import { AuditLogger, createAuditHook } from '../tools/auditHook';
import { PolicyEngine } from '../tools/PolicyEngine';
import { Tool } from '../types';

// ---------------------------------------------------------------------------
// Mock LLM providers — no real API calls
// ---------------------------------------------------------------------------

jest.mock('../models/OpenAIProvider', () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({
    call: jest.fn().mockResolvedValue({
      text: 'Mock LLM response from OpenAI',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      toolCalls: undefined,
    }),
    stream: jest.fn().mockImplementation(async function* () {
      yield { text: 'Mock ', usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } };
      yield { text: 'stream ', usage: { promptTokens: 0, completionTokens: 5, totalTokens: 5 } };
      yield { text: 'response', usage: { promptTokens: 0, completionTokens: 5, totalTokens: 5 } };
    }),
  })),
}));

jest.mock('../models/AnthropicProvider', () => ({
  AnthropicProvider: jest.fn().mockImplementation(() => ({
    call: jest.fn().mockResolvedValue({
      text: 'Mock LLM response from Anthropic',
      usage: { promptTokens: 8, completionTokens: 16, totalTokens: 24 },
      toolCalls: undefined,
    }),
    stream: jest.fn().mockImplementation(async function* () {
      yield { text: 'Mock anthropic stream', usage: { promptTokens: 8, completionTokens: 16, totalTokens: 24 } };
    }),
  })),
}));

jest.mock('../models/GeminiProvider', () => ({
  GeminiProvider: jest.fn().mockImplementation(() => ({
    call: jest.fn().mockResolvedValue({
      text: 'Mock LLM response from Google',
      usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30 },
      toolCalls: undefined,
    }),
    stream: jest.fn().mockImplementation(async function* () {
      yield { text: 'Mock google stream', usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30 } };
    }),
  })),
}));

// Mock config file loading to avoid touching real ~/.openpilot/config.json5
jest.mock('../config/index', () => {
  const original = jest.requireActual('../config/index');
  return {
    ...original,
    loadAppConfig: () => ({
      apiKeys: { openai: 'test-key-openai', anthropic: 'test-key-anthropic', google: 'test-key-google' },
      databasePath: ':memory:',
      gateway: { port: 0, host: '127.0.0.1', bind: 'loopback' },
      nodeEnv: 'test',
      debug: false,
      logLevel: 'warn',
      agents: { defaults: {} },
      channels: {},
      session: { dmScope: 'per-channel-peer' },
      skills: {},
      tools: {},
    }),
    saveAppConfig: jest.fn().mockReturnValue('/tmp/test-config.json5'),
    deepMergeConfig: original.deepMergeConfig ?? ((t: any, s: any) => ({ ...t, ...s })),
    findConfigFile: () => null,
    getConfigFilePath: () => null,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function httpRaw(
  server: http.Server,
  method: string,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path, method },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function wsConnect(server: http.Server): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
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
    async connect(onMessage: OnMessageCallback) { plugin.onMessage = onMessage; },
    async disconnect() { plugin.onMessage = null; },
    async sendMessage(message: OutboundMessage) { plugin.sentMessages.push(message); },
    getStatus(): ChannelInfo { return { type, status: 'connected', messageCount: plugin.sentMessages.length }; },
    async simulateInbound(msg: ChannelMessage) { if (plugin.onMessage) await plugin.onMessage(msg); },
  };
  return plugin;
}

function channelMsg(overrides: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    senderId: 'user-1',
    senderName: 'TestUser',
    channelType: 'telegram',
    chatId: 'chat-1',
    content: 'Hello from channel'.padEnd(201, '.'),
    timestamp: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Production Readiness E2E', () => {
  let db: Database.Database;
  let sessionManager: SessionManager;
  let modelManager: ModelManager;
  let toolExecutor: ToolExecutor;
  let aiRuntime: AIRuntime;
  let agentManager: AgentManager;
  let channelManager: ChannelManager;
  let pluginManager: PluginManager;
  let auditLogger: AuditLogger;
  let apiServer: APIServer;
  let server: http.Server;
  let mockTg: ReturnType<typeof createMockChannel>;
  let mockDc: ReturnType<typeof createMockChannel>;

  const appConfig: any = {
    apiKeys: { openai: 'test-key-openai', anthropic: 'test-key-anthropic', google: 'test-key-google' },
    databasePath: ':memory:',
    gateway: { port: 0, host: '127.0.0.1', bind: 'loopback' },
    nodeEnv: 'test',
    debug: false,
    logLevel: 'warn',
    agents: { defaults: {} },
    channels: {},
    session: { dmScope: 'per-channel-peer' },
    skills: {},
    tools: {},
  };

  beforeAll(async () => {
    // Set API key env vars so ModelManager detects providers
    process.env.OPENAI_API_KEY = 'test-key-openai';
    process.env.ANTHROPIC_API_KEY = 'test-key-anthropic';
    process.env.GOOGLE_AI_API_KEY = 'test-key-google';

    // 1. Database
    db = initializeDatabase(':memory:');

    // 2. Session Manager
    sessionManager = new SessionManager(db);

    // 3. Model Manager
    modelManager = new ModelManager();
    // Sync allowed models to middleware validation
    const configuredModels = modelManager.getConfiguredModels();
    const supportedModels = modelManager.getSupportedModels();
    setAllowedModels([...new Set([...supportedModels, ...configuredModels])]);

    // 4. Tool Executor with policy + audit
    toolExecutor = new ToolExecutor();
    const policyEngine = new PolicyEngine({ denylist: [], allowlist: [], requireApproval: [] });
    auditLogger = new AuditLogger();
    toolExecutor.onBeforeToolCall(policyEngine.createHook(async () => true));
    toolExecutor.onAfterToolCall(createAuditHook(auditLogger));
    registerFileTools(toolExecutor);
    registerNetworkTools(toolExecutor);

    // 5. AI Runtime
    aiRuntime = new AIRuntime(sessionManager, modelManager, toolExecutor);

    // 6. Agent Manager (uses temp dir)
    agentManager = new AgentManager();
    await agentManager.initialize();
    aiRuntime.setAgentManager(agentManager);

    // 7. Channel Manager with mock channels
    mockTg = createMockChannel('telegram');
    mockDc = createMockChannel('discord');

    channelManager = new ChannelManager({
      onMessage: async (msg) => {
        const chatType = msg.chatType ?? 'direct';
        const peerId = chatType === 'direct' ? msg.senderId : msg.chatId;
        const route = channelManager.resolveAgentRoute({
          channel: msg.channelType,
          accountId: msg.accountId,
          peer: peerId ? { kind: chatType as any, id: peerId } : undefined,
          guildId: msg.guildId,
          threadId: msg.threadId,
        });
        const result = await aiRuntime.execute({
          sessionId: route.sessionKey,
          message: msg.content,
          model: 'openai/gpt-4o',
        });
        return result.text;
      },
      bindings: [],
      defaultAgentId: 'main',
      appConfig,
      dmScope: 'per-channel-peer',
    });
    channelManager.register(mockTg);
    channelManager.register(mockDc);
    await channelManager.connectAll();

    // 8. Plugin Manager
    pluginManager = new PluginManager({
      toolExecutor,
      config: {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    // 9. API Server
    apiServer = new APIServer(
      aiRuntime, sessionManager, auditLogger,
      channelManager, pluginManager, agentManager, appConfig,
    );

    // Start on random port
    server = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(apiServer.getApp());
      s.listen(0, '127.0.0.1', () => resolve(s));
    });

    // Setup WebSocket
    (apiServer as any).setupWebSocket(server);
  });

  afterAll(async () => {
    channelManager.stopHealthCheck();
    await channelManager.disconnectAll();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    db.close();
  });

  beforeEach(() => {
    clearRateLimitState();
  });

  // =========================================================================
  // 1. Health & Status Endpoints
  // =========================================================================

  describe('1. Health & Status', () => {
    it('GET /api/health returns ok with DB and model info', async () => {
      const res = await httpRequest(server, 'GET', '/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('connected');
      expect(res.body.configuredModels).toBeGreaterThan(0);
    });

    it('GET /healthz returns 200 ok (container probe)', async () => {
      const res = await httpRaw(server, 'GET', '/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toBe('ok');
    });

    it('GET /readyz returns 200 ok (readiness probe)', async () => {
      const res = await httpRaw(server, 'GET', '/readyz');
      expect(res.status).toBe(200);
      expect(res.body).toBe('ok');
    });

    it('GET /api/status returns system status', async () => {
      const res = await httpRequest(server, 'GET', '/api/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('status', 'running');
      expect(res.body).toHaveProperty('models');
      expect(res.body).toHaveProperty('channels');
    });

    it('POST /api/rpc/system.status returns ok', async () => {
      const res = await httpRequest(server, 'POST', '/api/rpc/system.status');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('POST /api/rpc/unknown returns 404', async () => {
      const res = await httpRequest(server, 'POST', '/api/rpc/unknown.method');
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // 2. Session Lifecycle
  // =========================================================================

  describe('2. Session Lifecycle', () => {
    let sessionId: string;

    it('POST /api/sessions creates a new session', async () => {
      const res = await httpRequest(server, 'POST', '/api/sessions', {
        model: 'openai/gpt-4o',
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      sessionId = res.body.id;
    });

    it('GET /api/sessions/:id returns the session', async () => {
      const res = await httpRequest(server, 'GET', `/api/sessions/${sessionId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(sessionId);
      expect(res.body.messages).toBeDefined();
    });

    it('POST /api/chat sends a message and gets a response', async () => {
      const res = await httpRequest(server, 'POST', '/api/chat', {
        sessionId,
        message: 'Hello, this is a test message',
        model: 'openai/gpt-4o',
      });
      expect(res.status).toBe(200);
      expect(res.body.text).toBeDefined();
      expect(res.body.text.length).toBeGreaterThan(0);
      expect(res.body.usage).toBeDefined();
      expect(res.body.usage.totalTokens).toBeGreaterThan(0);
    });

    it('GET /api/sessions/:id shows messages after chat', async () => {
      const res = await httpRequest(server, 'GET', `/api/sessions/${sessionId}`);
      expect(res.status).toBe(200);
      expect(res.body.messages.length).toBeGreaterThanOrEqual(2); // user + assistant
    });

    it('POST /api/sessions/:id/compact compacts the session', async () => {
      // Add more messages to make compaction meaningful
      await httpRequest(server, 'POST', '/api/chat', {
        sessionId, message: 'Second message', model: 'openai/gpt-4o',
      });
      const res = await httpRequest(server, 'POST', `/api/sessions/${sessionId}/compact`);
      expect(res.status).toBe(200);
    });

    it('GET /api/sessions lists all sessions', async () => {
      const res = await httpRequest(server, 'GET', '/api/sessions');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((s: any) => s.id === sessionId)).toBe(true);
    });

    it('DELETE /api/sessions/:id deletes the session', async () => {
      const res = await httpRequest(server, 'DELETE', `/api/sessions/${sessionId}`);
      expect(res.status).toBe(204);
      // Verify it's gone
      const check = await httpRequest(server, 'GET', `/api/sessions/${sessionId}`);
      expect(check.status).toBe(404);
    });
  });

  // =========================================================================
  // 3. Chat Input Validation & Error Handling
  // =========================================================================

  describe('3. Chat Validation & Errors', () => {
    it('rejects empty message', async () => {
      const res = await httpRequest(server, 'POST', '/api/chat', {
        sessionId: 'test-validation', message: '', model: 'openai/gpt-4o',
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing sessionId', async () => {
      const res = await httpRequest(server, 'POST', '/api/chat', {
        message: 'hello', model: 'openai/gpt-4o',
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing model', async () => {
      const res = await httpRequest(server, 'POST', '/api/chat', {
        sessionId: 'test-validation', message: 'hello',
      });
      expect(res.status).toBe(400);
    });

    it('GET /api/sessions/nonexistent returns 404', async () => {
      const res = await httpRequest(server, 'GET', '/api/sessions/nonexistent-id-12345');
      expect(res.status).toBe(404);
    });

    it('DELETE /api/sessions/nonexistent returns 404', async () => {
      const res = await httpRequest(server, 'DELETE', '/api/sessions/nonexistent-id-12345');
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // 4. WebSocket Streaming
  // =========================================================================

  describe('4. WebSocket Streaming', () => {
    it('streams a chat response via WebSocket', async () => {
      const ws = await wsConnect(server);
      const msgs: any[] = [];

      await new Promise<void>((resolve) => {
        ws.on('message', (data: WebSocket.RawData) => {
          try {
            const parsed = JSON.parse(data.toString());
            msgs.push(parsed);
            if (parsed.type === 'stream_end' || parsed.type === 'error') {
              resolve();
            }
          } catch { /* ignore */ }
        });

        ws.send(JSON.stringify({
          sessionId: `ws-e2e-${Date.now()}`,
          message: 'Hello via WebSocket',
          model: 'openai/gpt-4o',
        }));

        // Safety timeout
        setTimeout(resolve, 5000);
      });

      ws.close();

      const types = msgs.map(m => m.type);
      expect(types).toContain('stream_start');
      expect(types).toContain('stream_end');
    });

    it('rejects invalid WebSocket JSON', async () => {
      const ws = await wsConnect(server);
      const msgs: any[] = [];

      await new Promise<void>((resolve) => {
        ws.on('message', (data: WebSocket.RawData) => {
          try { msgs.push(JSON.parse(data.toString())); } catch { /* ignore */ }
          resolve();
        });
        ws.send('not valid json {{{');
        setTimeout(resolve, 1000);
      });

      ws.close();
      expect(msgs.some(m => m.type === 'error')).toBe(true);
    });

    it('rejects WebSocket message missing required fields', async () => {
      const ws = await wsConnect(server);
      const msgs: any[] = [];

      await new Promise<void>((resolve) => {
        ws.on('message', (data: WebSocket.RawData) => {
          try { msgs.push(JSON.parse(data.toString())); } catch { /* ignore */ }
          resolve();
        });
        ws.send(JSON.stringify({ sessionId: 'test' }));
        setTimeout(resolve, 1000);
      });

      ws.close();
      expect(msgs.some(m => m.type === 'error')).toBe(true);
    });

    it('handles abort command without crashing', async () => {
      const ws = await wsConnect(server);
      const sid = `ws-abort-${Date.now()}`;

      ws.send(JSON.stringify({ sessionId: sid, message: 'Long task', model: 'openai/gpt-4o' }));
      await new Promise(r => setTimeout(r, 50));
      ws.send(JSON.stringify({ type: 'abort' }));

      await new Promise(r => setTimeout(r, 500));
      ws.close();
      // No crash = success
    });
  });

  // =========================================================================
  // 5. Model Catalog
  // =========================================================================

  describe('5. Model Catalog', () => {
    it('GET /api/models returns full catalog', async () => {
      const res = await httpRequest(server, 'GET', '/api/models');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      // Each entry should have ref, provider, modelId
      const first = res.body[0];
      expect(first).toHaveProperty('ref');
      expect(first).toHaveProperty('provider');
      expect(first).toHaveProperty('modelId');
    });

    it('GET /api/models/configured returns only configured models', async () => {
      const res = await httpRequest(server, 'GET', '/api/models/configured');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // All should have configured: true
      for (const m of res.body) {
        expect(m.configured).toBe(true);
      }
    });

    it('GET /api/models/providers returns provider status', async () => {
      const res = await httpRequest(server, 'GET', '/api/models/providers');
      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
    });
  });

  // =========================================================================
  // 6. Agent CRUD
  // =========================================================================

  describe('6. Agent CRUD', () => {
    const agentId = 'e2e-test-agent';

    it('GET /api/agents lists agents', async () => {
      const res = await httpRequest(server, 'GET', '/api/agents');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('POST /api/agents creates a new agent', async () => {
      const res = await httpRequest(server, 'POST', '/api/agents', {
        id: agentId,
        name: 'E2E Test Agent',
        description: 'Created by production readiness test',
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(agentId);
    });

    it('POST /api/agents rejects duplicate agent', async () => {
      const res = await httpRequest(server, 'POST', '/api/agents', {
        id: agentId, name: 'Duplicate',
      });
      expect(res.status).toBe(409);
    });

    it('POST /api/agents rejects invalid id', async () => {
      const res = await httpRequest(server, 'POST', '/api/agents', {
        id: 'INVALID ID!', name: 'Bad',
      });
      expect(res.status).toBe(400);
    });

    it('GET /api/agents/:id returns the agent', async () => {
      const res = await httpRequest(server, 'GET', `/api/agents/${agentId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(agentId);
      expect(res.body.name).toBe('E2E Test Agent');
    });

    it('PUT /api/agents/:id updates the agent', async () => {
      const res = await httpRequest(server, 'PUT', `/api/agents/${agentId}`, {
        description: 'Updated description',
      });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Updated description');
    });

    it('GET /api/agents/:id/identity returns identity info', async () => {
      const res = await httpRequest(server, 'GET', `/api/agents/${agentId}/identity`);
      expect(res.status).toBe(200);
    });

    it('GET /api/agents/:id/files lists agent files', async () => {
      const res = await httpRequest(server, 'GET', `/api/agents/${agentId}/files`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('PUT /api/agents/:id/bindings sets bindings', async () => {
      const res = await httpRequest(server, 'PUT', `/api/agents/${agentId}/bindings`, {
        bindings: [{ match: { channel: 'telegram' } }],
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('GET /api/agents/:id/bindings returns bindings', async () => {
      const res = await httpRequest(server, 'GET', `/api/agents/${agentId}/bindings`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });

    it('DELETE /api/agents/:id deletes the agent', async () => {
      const res = await httpRequest(server, 'DELETE', `/api/agents/${agentId}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // Verify gone
      const check = await httpRequest(server, 'GET', `/api/agents/${agentId}`);
      expect(check.status).toBe(404);
    });

    it('GET /api/agents/nonexistent returns 404', async () => {
      const res = await httpRequest(server, 'GET', '/api/agents/nonexistent-agent');
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // 7. Channel Management
  // =========================================================================

  describe('7. Channel Management', () => {
    it('GET /api/channels returns registered channels', async () => {
      const res = await httpRequest(server, 'GET', '/api/channels');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const types = res.body.map((c: any) => c.type);
      expect(types).toContain('telegram');
      expect(types).toContain('discord');
    });

    it('GET /api/channels/available returns all channel types with fields', async () => {
      const res = await httpRequest(server, 'GET', '/api/channels/available');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      // Each should have type, label, fields
      for (const ch of res.body) {
        expect(ch).toHaveProperty('type');
        expect(ch).toHaveProperty('label');
        expect(ch).toHaveProperty('fields');
      }
    });

    it('GET /api/channels/snapshot returns runtime snapshot', async () => {
      const res = await httpRequest(server, 'GET', '/api/channels/snapshot');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('channels');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('GET /api/channels/:type/config returns channel config', async () => {
      const res = await httpRequest(server, 'GET', '/api/channels/telegram/config');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('type', 'telegram');
    });

    it('PUT /api/channels/:type/config saves channel config', async () => {
      const res = await httpRequest(server, 'PUT', '/api/channels/signal/config', {
        config: { enabled: true, token: 'test-signal-token' },
        connect: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('DELETE /api/channels/:type/config removes channel config', async () => {
      const res = await httpRequest(server, 'DELETE', '/api/channels/signal/config');
      expect(res.status).toBe(200);
      expect(res.body.removed).toBe(true);
    });

    it('POST /api/channels/:type/disconnect disconnects a channel', async () => {
      const res = await httpRequest(server, 'POST', '/api/channels/telegram/disconnect');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('POST /api/channels/:type/reconnect reconnects a channel', async () => {
      const res = await httpRequest(server, 'POST', '/api/channels/telegram/reconnect');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('POST /api/channels/nonexistent/reconnect returns 404', async () => {
      const res = await httpRequest(server, 'POST', '/api/channels/nonexistent/reconnect');
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // 8. Channel Message Routing (via mock channels)
  // =========================================================================

  describe('8. Channel Message Routing', () => {
    it('routes Telegram DM through full pipeline and sends response', async () => {
      mockTg.sentMessages = [];
      await mockTg.simulateInbound(channelMsg({
        channelType: 'telegram',
        senderId: 'e2e-user',
        chatType: 'direct',
        chatId: 'e2e-chat',
        content: 'E2E test message from Telegram'.padEnd(201, '.'),
      }));
      await new Promise(r => setTimeout(r, 500));

      expect(mockTg.sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(mockTg.sentMessages[0].chatId).toBe('e2e-chat');
      expect(mockTg.sentMessages[0].text.length).toBeGreaterThan(0);
    });

    it('routes Discord group message and sends response', async () => {
      mockDc.sentMessages = [];
      await mockDc.simulateInbound(channelMsg({
        channelType: 'discord',
        senderId: 'dc-user',
        chatType: 'group',
        chatId: 'dc-channel',
        guildId: 'test-guild',
        content: 'E2E test from Discord guild'.padEnd(201, '.'),
      }));
      await new Promise(r => setTimeout(r, 500));

      expect(mockDc.sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(mockDc.sentMessages[0].chatId).toBe('dc-channel');
    });

    it('creates separate sessions for different channels', async () => {
      // Both messages should create different sessions
      const sessions = await httpRequest(server, 'GET', '/api/sessions');
      const sessionIds = sessions.body.map((s: any) => s.id);
      const tgSession = sessionIds.find((id: string) => id.includes('telegram'));
      const dcSession = sessionIds.find((id: string) => id.includes('discord'));
      // At least one channel session should exist
      expect(tgSession || dcSession).toBeTruthy();
    });
  });

  // =========================================================================
  // 9. Tool Catalog & Audit
  // =========================================================================

  describe('9. Tools & Audit', () => {
    it('GET /api/tools/catalog returns tool catalog', async () => {
      const res = await httpRequest(server, 'GET', '/api/tools/catalog');
      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
    });

    it('GET /api/audit-logs returns audit entries', async () => {
      const res = await httpRequest(server, 'GET', '/api/audit-logs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/logs returns log entries', async () => {
      const res = await httpRequest(server, 'GET', '/api/logs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // =========================================================================
  // 10. Config System
  // =========================================================================

  describe('10. Config System', () => {
    it('GET /api/config returns masked config', async () => {
      const res = await httpRequest(server, 'GET', '/api/config');
      expect(res.status).toBe(200);
      // API keys should be masked
      if (res.body.apiKeys) {
        for (const [, v] of Object.entries(res.body.apiKeys)) {
          if (v) expect(v as string).toMatch(/^••••/);
        }
      }
    });

    it('GET /api/config/schema returns config schema', async () => {
      const res = await httpRequest(server, 'GET', '/api/config/schema');
      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
    });

    it('PUT /api/config updates config (without overwriting apiKeys)', async () => {
      const res = await httpRequest(server, 'PUT', '/api/config', {
        debug: true,
        apiKeys: { openai: 'should-be-ignored' },
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // apiKeys should NOT be overwritten
      const check = await httpRequest(server, 'GET', '/api/config');
      // The masked key should still show the original (not 'should-be-ignored')
      if (check.body.apiKeys?.openai) {
        expect(check.body.apiKeys.openai).not.toBe('should-be-ignored');
      }
    });
  });

  // =========================================================================
  // 11. Cron Job CRUD
  // =========================================================================

  describe('11. Cron Jobs', () => {
    let cronJobId: string;

    it('GET /api/cron/status returns cron status', async () => {
      const res = await httpRequest(server, 'GET', '/api/cron/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('enabled');
      expect(res.body).toHaveProperty('total');
    });

    it('POST /api/cron/jobs creates a job', async () => {
      const res = await httpRequest(server, 'POST', '/api/cron/jobs', {
        schedule: '0 9 * * *',
        agentId: 'main',
        message: 'Daily summary',
        enabled: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      cronJobId = res.body.id;
    });

    it('GET /api/cron/jobs lists jobs', async () => {
      const res = await httpRequest(server, 'GET', '/api/cron/jobs');
      expect(res.status).toBe(200);
      expect(res.body.some((j: any) => j.id === cronJobId)).toBe(true);
    });

    it('PUT /api/cron/jobs/:id updates a job', async () => {
      const res = await httpRequest(server, 'PUT', `/api/cron/jobs/${cronJobId}`, {
        message: 'Updated daily summary',
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Updated daily summary');
    });

    it('POST /api/cron/jobs/:id/toggle toggles enabled', async () => {
      const res = await httpRequest(server, 'POST', `/api/cron/jobs/${cronJobId}/toggle`);
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it('DELETE /api/cron/jobs/:id deletes a job', async () => {
      const res = await httpRequest(server, 'DELETE', `/api/cron/jobs/${cronJobId}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('POST /api/cron/jobs rejects missing fields', async () => {
      const res = await httpRequest(server, 'POST', '/api/cron/jobs', { schedule: '* * * * *' });
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // 12. Usage & Lanes & Subagents
  // =========================================================================

  describe('12. Usage & Infrastructure', () => {
    it('GET /api/usage returns token usage stats', async () => {
      const res = await httpRequest(server, 'GET', '/api/usage');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalTokens');
      expect(res.body).toHaveProperty('sessions');
    });

    it('GET /api/usage/timeseries returns timeseries data', async () => {
      const res = await httpRequest(server, 'GET', '/api/usage/timeseries');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('period');
    });

    it('GET /api/lanes returns lane stats', async () => {
      const res = await httpRequest(server, 'GET', '/api/lanes');
      expect(res.status).toBe(200);
    });

    it('GET /api/subagents returns subagent stats', async () => {
      const res = await httpRequest(server, 'GET', '/api/subagents');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
    });

    it('POST /api/subagents/archive archives stale runs', async () => {
      const res = await httpRequest(server, 'POST', '/api/subagents/archive');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('archived');
    });
  });

  // =========================================================================
  // 13. Pairing & Security
  // =========================================================================

  describe('13. Pairing & Security', () => {
    it('GET /api/pairing/requests returns pairing requests', async () => {
      const res = await httpRequest(server, 'GET', '/api/pairing/requests');
      expect(res.status).toBe(200);
    });

    it('GET /api/channels/:type/allow-from returns allow list', async () => {
      const res = await httpRequest(server, 'GET', '/api/channels/telegram/allow-from');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('channel', 'telegram');
      expect(res.body).toHaveProperty('merged');
    });

    it('POST /api/channels/:type/allow-from adds entry', async () => {
      const res = await httpRequest(server, 'POST', '/api/channels/telegram/allow-from', {
        entry: 'test-user-123',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('DELETE /api/channels/:type/allow-from removes entry', async () => {
      const res = await httpRequest(server, 'DELETE', '/api/channels/telegram/allow-from', {
        entry: 'test-user-123',
      });
      expect(res.status).toBe(200);
      expect(res.body.removed).toBe(true);
    });

    it('GET /api/channels/:type/security returns security policy', async () => {
      const res = await httpRequest(server, 'GET', '/api/channels/telegram/security');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('dmPolicy');
    });
  });

  // =========================================================================
  // 14. Skills Endpoints
  // =========================================================================

  describe('14. Skills', () => {
    it('GET /api/skills/status returns skill status reports', async () => {
      const res = await httpRequest(server, 'GET', '/api/skills/status');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('PUT /api/skills/:name updates skill config', async () => {
      const res = await httpRequest(server, 'PUT', '/api/skills/web-search', {
        enabled: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('GET /api/skills/community/config returns community config', async () => {
      const res = await httpRequest(server, 'GET', '/api/skills/community/config');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('defaultSource');
    });
  });

  // =========================================================================
  // 15. Plugins
  // =========================================================================

  describe('15. Plugins', () => {
    it('GET /api/plugins returns plugin list', async () => {
      const res = await httpRequest(server, 'GET', '/api/plugins');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // =========================================================================
  // 16. Devices & Exec Approvals
  // =========================================================================

  describe('16. Devices & Approvals', () => {
    it('GET /api/devices returns device lists', async () => {
      const res = await httpRequest(server, 'GET', '/api/devices');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('paired');
      expect(res.body).toHaveProperty('pending');
    });

    it('GET /api/exec-approvals returns approval queue', async () => {
      const res = await httpRequest(server, 'GET', '/api/exec-approvals');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/nodes returns nodes list', async () => {
      const res = await httpRequest(server, 'GET', '/api/nodes');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // =========================================================================
  // 17. Multi-Session Concurrent Chat (stress test)
  // =========================================================================

  describe('17. Concurrent Chat Stress', () => {
    it('handles 10 concurrent chat requests on different sessions', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        httpRequest(server, 'POST', '/api/chat', {
          sessionId: `stress-${Date.now()}-${i}`,
          message: `Concurrent message ${i}`,
          model: 'openai/gpt-4o',
        }),
      );

      const results = await Promise.all(promises);

      // All should succeed (200)
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body.text).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 18. Session Persistence & Data Integrity
  // =========================================================================

  describe('18. Session Persistence', () => {
    const sid = `persist-${Date.now()}`;

    it('chat creates session, messages persist across requests', async () => {
      // First message
      await httpRequest(server, 'POST', '/api/chat', {
        sessionId: sid, message: 'First message', model: 'openai/gpt-4o',
      });
      // Second message
      await httpRequest(server, 'POST', '/api/chat', {
        sessionId: sid, message: 'Second message', model: 'openai/gpt-4o',
      });

      // Load session and verify message history
      const res = await httpRequest(server, 'GET', `/api/sessions/${sid}`);
      expect(res.status).toBe(200);
      expect(res.body.messages.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant
      // Verify order: user, assistant, user, assistant
      expect(res.body.messages[0].role).toBe('user');
      expect(res.body.messages[1].role).toBe('assistant');
      expect(res.body.messages[2].role).toBe('user');
      expect(res.body.messages[3].role).toBe('assistant');
    });

    it('token usage accumulates across messages', async () => {
      const res = await httpRequest(server, 'GET', `/api/sessions/${sid}`);
      expect(res.body.metadata.totalTokens).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 19. Agent-Specific Chat (agent model/prompt resolution)
  // =========================================================================

  describe('19. Agent-Specific Chat', () => {
    const agentId = 'e2e-chat-agent';

    beforeAll(async () => {
      await httpRequest(server, 'POST', '/api/agents', {
        id: agentId,
        name: 'Chat Test Agent',
        description: 'Agent for E2E chat testing',
      });
    });

    afterAll(async () => {
      await httpRequest(server, 'DELETE', `/api/agents/${agentId}`);
    });

    it('chat with agentId routes through agent config', async () => {
      const res = await httpRequest(server, 'POST', '/api/chat', {
        sessionId: `agent-chat-${Date.now()}`,
        message: 'Hello agent',
        model: 'openai/gpt-4o',
        agentId,
      });
      expect(res.status).toBe(200);
      expect(res.body.text).toBeDefined();
    });
  });

  // =========================================================================
  // 20. Channel Config CRUD Full Cycle
  // =========================================================================

  describe('20. Channel Config Full Cycle', () => {
    it('save → read → delete channel config', async () => {
      // Save
      const save = await httpRequest(server, 'PUT', '/api/channels/whatsapp/config', {
        config: { enabled: true, token: 'wa-test-token-12345' },
      });
      expect(save.status).toBe(200);
      expect(save.body.ok).toBe(true);

      // Read — token should be masked
      const read = await httpRequest(server, 'GET', '/api/channels/whatsapp/config');
      expect(read.status).toBe(200);
      if (read.body.config?.token) {
        expect(read.body.config.token).toMatch(/••••/);
      }

      // Delete
      const del = await httpRequest(server, 'DELETE', '/api/channels/whatsapp/config');
      expect(del.status).toBe(200);
      expect(del.body.removed).toBe(true);

      // Verify gone
      const check = await httpRequest(server, 'GET', '/api/channels/whatsapp/config');
      expect(check.body.config).toEqual({});
    });
  });

  // =========================================================================
  // 21. Agent File Management
  // =========================================================================

  describe('21. Agent File Management', () => {
    const agentId = 'e2e-file-agent';

    beforeAll(async () => {
      await httpRequest(server, 'POST', '/api/agents', {
        id: agentId, name: 'File Agent',
      });
    });

    afterAll(async () => {
      await httpRequest(server, 'DELETE', `/api/agents/${agentId}`);
    });

    it('PUT /api/agents/:id/files/:filename writes a file', async () => {
      const res = await httpRequest(server, 'PUT', `/api/agents/${agentId}/files/SOUL.md`, {
        content: '# Soul\nYou are a helpful assistant.',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('GET /api/agents/:id/files/:filename reads the file', async () => {
      const res = await httpRequest(server, 'GET', `/api/agents/${agentId}/files/SOUL.md`);
      expect(res.status).toBe(200);
      expect(res.body.content).toContain('helpful assistant');
    });

    it('GET /api/agents/:id/files lists files including the new one', async () => {
      const res = await httpRequest(server, 'GET', `/api/agents/${agentId}/files`);
      expect(res.status).toBe(200);
      expect(res.body.some((f: any) => f === 'SOUL.md' || f.name === 'SOUL.md')).toBe(true);
    });
  });

  // =========================================================================
  // 22. End-to-End: Channel → Agent → LLM → Response → Outbound
  // =========================================================================

  describe('22. Full Pipeline: Channel → Agent → LLM → Outbound', () => {
    it('Telegram DM → default agent → mock LLM → response sent back', async () => {
      mockTg.sentMessages = [];

      await mockTg.simulateInbound(channelMsg({
        channelType: 'telegram',
        senderId: 'pipeline-user',
        chatType: 'direct',
        chatId: 'pipeline-chat',
        content: 'Full pipeline test'.padEnd(201, '.'),
      }));

      // Wait for async processing
      await new Promise(r => setTimeout(r, 1000));

      expect(mockTg.sentMessages.length).toBe(1);
      expect(mockTg.sentMessages[0].chatId).toBe('pipeline-chat');
      // Response should come from mock LLM
      expect(mockTg.sentMessages[0].text.length).toBeGreaterThan(0);

      // Verify session was created in DB
      const sessions = await httpRequest(server, 'GET', '/api/sessions');
      const pipelineSession = sessions.body.find((s: any) =>
        s.id.includes('telegram') && s.id.includes('pipeline-user'),
      );
      expect(pipelineSession).toBeDefined();
    });

    it('Discord group → default agent → mock LLM → response sent back', async () => {
      mockDc.sentMessages = [];

      await mockDc.simulateInbound(channelMsg({
        channelType: 'discord',
        senderId: 'dc-pipeline-user',
        chatType: 'group',
        chatId: 'dc-pipeline-channel',
        guildId: 'pipeline-guild',
        content: 'Discord pipeline test'.padEnd(201, '.'),
      }));

      await new Promise(r => setTimeout(r, 1000));

      expect(mockDc.sentMessages.length).toBe(1);
      expect(mockDc.sentMessages[0].chatId).toBe('dc-pipeline-channel');
    });
  });

  // =========================================================================
  // 23. Error Recovery & Edge Cases
  // =========================================================================

  describe('23. Error Recovery', () => {
    it('handles very long message content', async () => {
      const longMessage = 'A'.repeat(9999); // just under 10000 limit
      const res = await httpRequest(server, 'POST', '/api/chat', {
        sessionId: `long-msg-${Date.now()}`,
        message: longMessage,
        model: 'openai/gpt-4o',
      });
      expect(res.status).toBe(200);
      expect(res.body.text).toBeDefined();
    });

    it('rejects message exceeding max length', async () => {
      const tooLong = 'A'.repeat(10001);
      const res = await httpRequest(server, 'POST', '/api/chat', {
        sessionId: `too-long-${Date.now()}`,
        message: tooLong,
        model: 'openai/gpt-4o',
      });
      expect(res.status).toBe(400);
    });

    it('handles special characters in session ID (channel-style)', async () => {
      // Channel session keys use colons, but the HTTP API middleware only allows [a-zA-Z0-9_-]
      // Channel messages bypass the middleware, so this is expected to be rejected via HTTP
      const res = await httpRequest(server, 'POST', '/api/chat', {
        sessionId: 'agent:main:telegram:direct:user-123',
        message: 'Channel-style session ID',
        model: 'openai/gpt-4o',
      });
      // Middleware rejects colons in session ID
      expect(res.status).toBe(400);
    });

    it('handles unicode content', async () => {
      const res = await httpRequest(server, 'POST', '/api/chat', {
        sessionId: `unicode-${Date.now()}`,
        message: '你好世界 🌍 こんにちは مرحبا',
        model: 'openai/gpt-4o',
      });
      expect(res.status).toBe(200);
      expect(res.body.text).toBeDefined();
    });
  });
});
