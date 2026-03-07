/**
 * Channel Manager
 *
 * Manages multiple channel plugins and routes messages between
 * channels and the Agent runtime.
 *
 * OpenClaw-aligned enhancements:
 *   - Account-level lifecycle (start/stop per account)
 *   - Runtime snapshot for health monitoring
 *   - Exponential backoff auto-restart (max 10 attempts, 5s→5min)
 *   - Manual stop tracking (prevents auto-restart)
 *   - Agent routing via bindings
 */

import {
  ChannelPlugin,
  ChannelMessage,
  OutboundMessage,
  ChannelInfo,
  OnMessageCallback,
  ChannelAccountSnapshot,
  ChannelRuntimeSnapshot,
  ChannelRuntimeEntry,
  AgentBinding,
  ResolvedAgentRoute,
  RoutePeer,
  ChatType,
} from './types';
import {
  upsertPairingRequest,
  readAllowFrom,
  mergeDmAllowFromSources,
  isSenderIdAllowed,
} from './PairingStore';
import { InboundDebouncer, DebouncerConfig } from './InboundDebouncer';
import { enqueueCommandInLane } from './CommandLane';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESTART_ATTEMPTS = 10;
const BASE_RESTART_DELAY_MS = 5_000;       // 5 seconds
const MAX_RESTART_DELAY_MS = 5 * 60_000;   // 5 minutes
const HEALTH_CHECK_INTERVAL_MS = 30_000;   // 30 seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChannelManagerConfig {
  /** Callback to handle inbound messages (routes to Agent) */
  onMessage: (message: ChannelMessage) => Promise<string>;
  /** Agent bindings for routing (optional) */
  bindings?: AgentBinding[];
  /** Default agent ID when no binding matches */
  defaultAgentId?: string;
  /** App config reference for adapter-based channels */
  appConfig?: any;
  /** Inbound debouncer configuration */
  debouncer?: DebouncerConfig;
  /** DM session scope (default: per-channel-peer) */
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
}

interface AccountRuntime {
  snapshot: ChannelAccountSnapshot;
  abortController?: AbortController;
  task?: Promise<void>;
  restartAttempts: number;
  manuallyStopped: boolean;
  restartTimer?: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// ChannelManager
// ---------------------------------------------------------------------------

export class ChannelManager {
  private channels: Map<string, ChannelPlugin> = new Map();
  private config: ChannelManagerConfig;

  /** Per-channel, per-account runtime state */
  private accountRuntimes: Map<string, AccountRuntime> = new Map();

  /** Health check interval handle */
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  /** Inbound message debouncer */
  private debouncer: InboundDebouncer;

  constructor(config: ChannelManagerConfig) {
    this.config = config;
    // Initialize debouncer — callback goes through the security gate then to agent
    this.debouncer = new InboundDebouncer(
      (merged) => this.processVerifiedMessage(merged),
      config.debouncer,
    );
  }

  // -----------------------------------------------------------------------
  // Registration (unchanged — backward compatible)
  // -----------------------------------------------------------------------

  /**
   * Register a channel plugin.
   */
  register(channel: ChannelPlugin): void {
    if (this.channels.has(channel.type)) {
      throw new Error(`Channel '${channel.type}' is already registered`);
    }
    this.channels.set(channel.type, channel);
  }

  // -----------------------------------------------------------------------
  // Legacy lifecycle (backward compatible)
  // -----------------------------------------------------------------------

  /**
   * Connect all registered channels.
   * For channels with gateway adapter, uses account-level startup.
   * For legacy channels, uses connect().
   */
  async connectAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.channels.values()).map(ch => {
        if (ch.gateway && ch.channelConfig && this.config.appConfig) {
          return this.startChannel(ch.type);
        }
        return ch.connect(this.createMessageHandler(ch.type));
      }),
    );

    for (const [i, result] of results.entries()) {
      const ch = Array.from(this.channels.values())[i];
      if (result.status === 'rejected') {
        console.error(`[ChannelManager] Failed to connect ${ch.type}: ${result.reason}`);
      } else {
        console.log(`[ChannelManager] Connected: ${ch.type}`);
      }
    }
  }

  /**
   * Disconnect all channels.
   */
  async disconnectAll(): Promise<void> {
    this.stopHealthCheck();
    this.debouncer.dispose();

    // Abort all account runtimes
    for (const [key, runtime] of this.accountRuntimes) {
      runtime.manuallyStopped = true;
      if (runtime.restartTimer) clearTimeout(runtime.restartTimer);
      runtime.abortController?.abort();
    }

    await Promise.allSettled(
      Array.from(this.channels.values()).map(ch => ch.disconnect()),
    );
  }

  /**
   * Send a message through a specific channel.
   */
  async sendMessage(channelType: string, message: OutboundMessage): Promise<void> {
    const channel = this.channels.get(channelType);
    if (!channel) {
      throw new Error(`Channel '${channelType}' is not registered`);
    }
    await channel.sendMessage(message);
  }

  /**
   * Get status of all channels.
   */
  getStatus(): ChannelInfo[] {
    return Array.from(this.channels.values()).map(ch => {
      const info = ch.getStatus();
      // Enrich with account snapshots if available
      const accounts = this.getAccountSnapshots(ch.type);
      if (accounts.length > 0) {
        info.accounts = accounts;
      }
      return info;
    });
  }

  /**
   * Get a specific channel plugin.
   */
  getChannel(type: string): ChannelPlugin | undefined {
    return this.channels.get(type);
  }

  /**
   * Get all registered channel types.
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Reconnect a specific channel (disconnect then connect with message handler).
   */
  async reconnectChannel(channelType: string): Promise<void> {
    const channel = this.channels.get(channelType);
    if (!channel) {
      throw new Error(`Channel '${channelType}' is not registered`);
    }

    // If adapter-based, use account-level restart
    if (channel.gateway && channel.channelConfig && this.config.appConfig) {
      await this.stopChannel(channelType);
      await this.startChannel(channelType);
      return;
    }

    // Legacy path
    try {
      await channel.disconnect();
    } catch { /* ignore disconnect errors */ }
    await channel.connect(this.createMessageHandler(channelType));
  }

  // -----------------------------------------------------------------------
  // Account-level lifecycle (design doc §组件3)
  // -----------------------------------------------------------------------

  /**
   * Start all accounts for a channel.
   */
  async startChannel(channelId: string, accountId?: string): Promise<void> {
    const plugin = this.channels.get(channelId);
    if (!plugin) throw new Error(`Channel '${channelId}' is not registered`);

    if (!plugin.gateway || !plugin.channelConfig) {
      // Legacy channel — just connect
      await plugin.connect(this.createMessageHandler(channelId));
      return;
    }

    const cfg = this.config.appConfig;
    const accountIds = accountId
      ? [accountId]
      : plugin.channelConfig.listAccountIds(cfg);

    for (const aid of accountIds) {
      await this.startAccountInternal(channelId, aid, plugin);
    }
  }

  /**
   * Stop a channel (all accounts or a specific one).
   */
  async stopChannel(channelId: string, accountId?: string): Promise<void> {
    const plugin = this.channels.get(channelId);
    if (!plugin) throw new Error(`Channel '${channelId}' is not registered`);

    if (!plugin.gateway) {
      await plugin.disconnect();
      return;
    }

    const keys = accountId
      ? [`${channelId}:${accountId}`]
      : [...this.accountRuntimes.keys()].filter(k => k.startsWith(`${channelId}:`));

    for (const key of keys) {
      const runtime = this.accountRuntimes.get(key);
      if (runtime) {
        runtime.manuallyStopped = true;
        if (runtime.restartTimer) clearTimeout(runtime.restartTimer);
        runtime.abortController?.abort();
        runtime.snapshot.running = false;
        runtime.snapshot.lastStopAt = Date.now();
      }
    }
  }

  /**
   * Mark a channel account as logged out.
   */
  markChannelLoggedOut(channelId: string, cleared: boolean, accountId = 'default'): void {
    const key = `${channelId}:${accountId}`;
    const runtime = this.accountRuntimes.get(key);
    if (runtime) {
      runtime.manuallyStopped = true;
      runtime.snapshot.lastDisconnect = { at: Date.now(), loggedOut: true };
      if (runtime.abortController) runtime.abortController.abort();
    }
  }

  /**
   * Check if a channel account was manually stopped.
   */
  isManuallyStopped(channelId: string, accountId: string): boolean {
    const key = `${channelId}:${accountId}`;
    return this.accountRuntimes.get(key)?.manuallyStopped ?? false;
  }

  /**
   * Reset restart attempts for a channel account.
   */
  resetRestartAttempts(channelId: string, accountId: string): void {
    const key = `${channelId}:${accountId}`;
    const runtime = this.accountRuntimes.get(key);
    if (runtime) {
      runtime.restartAttempts = 0;
      runtime.manuallyStopped = false;
    }
  }

  // -----------------------------------------------------------------------
  // Runtime snapshot (design doc §组件3)
  // -----------------------------------------------------------------------

  /**
   * Get a snapshot of all channel account runtimes.
   */
  getRuntimeSnapshot(): ChannelRuntimeSnapshot {
    const channels: ChannelRuntimeEntry[] = [];

    for (const [type, plugin] of this.channels) {
      const accounts = this.getAccountSnapshots(type);
      // If no adapter-based accounts, synthesize from legacy status
      if (accounts.length === 0) {
        const info = plugin.getStatus();
        accounts.push({
          accountId: 'default',
          enabled: true,
          configured: info.status !== 'error',
          running: info.status === 'connected' || info.status === 'connecting',
          connected: info.status === 'connected',
          lastConnectedAt: info.connectedAt ? info.connectedAt.getTime() : null,
          lastError: info.statusMessage ?? null,
        });
      }

      channels.push({
        channelId: type,
        meta: plugin.meta,
        capabilities: plugin.capabilities,
        accounts,
      });
    }

    return { channels, timestamp: Date.now() };
  }

  private getAccountSnapshots(channelId: string): ChannelAccountSnapshot[] {
    const snapshots: ChannelAccountSnapshot[] = [];
    for (const [key, runtime] of this.accountRuntimes) {
      if (key.startsWith(`${channelId}:`)) {
        snapshots.push({ ...runtime.snapshot });
      }
    }
    return snapshots;
  }

  // -----------------------------------------------------------------------
  // Health monitoring (design doc §健康监控)
  // -----------------------------------------------------------------------

  /**
   * Start periodic health checks.
   */
  startHealthCheck(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => this.runHealthCheck(), HEALTH_CHECK_INTERVAL_MS);
    // Don't prevent process exit
    if (this.healthCheckTimer.unref) this.healthCheckTimer.unref();
  }

  /**
   * Stop health checks.
   */
  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private runHealthCheck(): void {
    for (const [key, runtime] of this.accountRuntimes) {
      if (runtime.manuallyStopped) continue;
      if (runtime.snapshot.enabled && runtime.snapshot.configured && !runtime.snapshot.running) {
        const [channelId, accountId] = key.split(':');
        const plugin = this.channels.get(channelId);
        if (plugin?.gateway) {
          console.log(`[ChannelManager] Health check: restarting ${key}`);
          this.resetRestartAttempts(channelId, accountId);
          this.startAccountInternal(channelId, accountId, plugin).catch(err => {
            console.error(`[ChannelManager] Health restart failed for ${key}: ${err.message}`);
          });
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Routing (design doc §组件4)
  // -----------------------------------------------------------------------

  /**
   * Resolve agent route for an inbound message.
   * Matches bindings by priority: peer > guild+roles > guild > team > account > channel > default.
   */
  resolveAgentRoute(input: {
    channel: string;
    accountId?: string;
    peer?: RoutePeer;
    guildId?: string;
    teamId?: string;
    memberRoleIds?: string[];
    threadId?: string;
  }): ResolvedAgentRoute {
    const bindings = this.config.bindings ?? [];
    const channel = input.channel.toLowerCase();
    const accountId = input.accountId ?? 'default';
    const defaultAgentId = this.config.defaultAgentId ?? 'main';

    // Tier 1: peer match (checks channel, accountId, peer.kind, peer.id)
    if (input.peer) {
      const match = bindings.find(b =>
        b.match.peer &&
        b.match.peer.id === input.peer!.id &&
        this.peerKindMatches(b.match.peer.kind, input.peer!.kind) &&
        (!b.match.channel || b.match.channel === channel) &&
        (!b.match.accountId || b.match.accountId === '*' || b.match.accountId === accountId),
      );
      if (match) {
        return this.buildRoute(match.agentId, channel, accountId, input.peer, 'binding.peer', input.threadId);
      }
    }

    // Tier 2: guild + roles match (any role matches)
    if (input.guildId && input.memberRoleIds?.length) {
      const match = bindings.find(b =>
        b.match.guildId === input.guildId &&
        b.match.roles?.length &&
        b.match.roles.some(r => input.memberRoleIds!.includes(r)) &&
        (!b.match.channel || b.match.channel === channel) &&
        (!b.match.accountId || b.match.accountId === '*' || b.match.accountId === accountId),
      );
      if (match) {
        return this.buildRoute(match.agentId, channel, accountId, input.peer, 'binding.guild+roles', input.threadId);
      }
    }

    // Tier 3: guild match (no roles)
    if (input.guildId) {
      const match = bindings.find(b =>
        b.match.guildId === input.guildId &&
        !b.match.roles?.length &&
        (!b.match.channel || b.match.channel === channel) &&
        (!b.match.accountId || b.match.accountId === '*' || b.match.accountId === accountId),
      );
      if (match) {
        return this.buildRoute(match.agentId, channel, accountId, input.peer, 'binding.guild', input.threadId);
      }
    }

    // Tier 4: team match
    if (input.teamId) {
      const match = bindings.find(b =>
        b.match.teamId === input.teamId &&
        (!b.match.channel || b.match.channel === channel) &&
        (!b.match.accountId || b.match.accountId === '*' || b.match.accountId === accountId),
      );
      if (match) {
        return this.buildRoute(match.agentId, channel, accountId, input.peer, 'binding.team', input.threadId);
      }
    }

    // Tier 5: account match
    {
      const match = bindings.find(b =>
        b.match.channel === channel &&
        b.match.accountId === accountId &&
        !b.match.peer && !b.match.guildId && !b.match.teamId,
      );
      if (match) {
        return this.buildRoute(match.agentId, channel, accountId, input.peer, 'binding.account', input.threadId);
      }
    }

    // Tier 6: channel match
    {
      const match = bindings.find(b =>
        b.match.channel === channel &&
        !b.match.accountId && !b.match.peer && !b.match.guildId && !b.match.teamId,
      );
      if (match) {
        return this.buildRoute(match.agentId, channel, accountId, input.peer, 'binding.channel', input.threadId);
      }
    }

    // Default
    return this.buildRoute(defaultAgentId, channel, accountId, input.peer, 'default', input.threadId);
  }

  /**
   * Update bindings at runtime (e.g. when agent configs change).
   */
  setBindings(bindings: AgentBinding[]): void {
    this.config.bindings = bindings;
  }

  /**
   * Get current bindings.
   */
  getBindings(): AgentBinding[] {
    return this.config.bindings ?? [];
  }

  private buildRoute(
    agentId: string, channel: string, accountId: string,
    peer: RoutePeer | undefined, matchedBy: ResolvedAgentRoute['matchedBy'],
    threadId?: string,
  ): ResolvedAgentRoute {
    const mainSessionKey = `agent:${agentId}:main`;
    const dmScope = this.config.dmScope ?? 'per-channel-peer';
    let sessionKey: string;

    if (peer) {
      if (peer.kind === 'direct') {
        // DM session key depends on dmScope config
        switch (dmScope) {
          case 'main':
            sessionKey = mainSessionKey;
            break;
          case 'per-peer':
            sessionKey = `agent:${agentId}:direct:${peer.id}`;
            break;
          case 'per-account-channel-peer':
            sessionKey = `agent:${agentId}:${channel}:${accountId}:direct:${peer.id}`;
            break;
          case 'per-channel-peer':
          default:
            sessionKey = `agent:${agentId}:${channel}:direct:${peer.id}`;
            break;
        }
      } else {
        // Group/channel sessions always include channel + peer
        sessionKey = `agent:${agentId}:${channel}:${peer.kind}:${peer.id}`;
      }
    } else {
      sessionKey = mainSessionKey;
    }

    // Thread binding: append :thread:{threadId} suffix for threaded conversations
    if (threadId) {
      sessionKey = `${sessionKey}:thread:${threadId}`;
    }

    return { agentId, channel, accountId, sessionKey, mainSessionKey, matchedBy };
  }

  // -----------------------------------------------------------------------
  // Internal: account startup with auto-restart
  // -----------------------------------------------------------------------

  private async startAccountInternal(
    channelId: string, accountId: string, plugin: ChannelPlugin,
  ): Promise<void> {
    if (!plugin.gateway || !plugin.channelConfig) return;

    const key = `${channelId}:${accountId}`;
    const cfg = this.config.appConfig;
    const account = plugin.channelConfig.resolveAccount(cfg, accountId);

    // Initialize runtime entry
    let runtime = this.accountRuntimes.get(key);
    if (!runtime) {
      runtime = {
        snapshot: { accountId, enabled: false, configured: false, running: false },
        restartAttempts: 0,
        manuallyStopped: false,
      };
      this.accountRuntimes.set(key, runtime);
    }

    // Check enabled
    if (!account || !plugin.channelConfig.isEnabled(account, cfg)) {
      runtime.snapshot.enabled = false;
      runtime.snapshot.running = false;
      runtime.snapshot.lastError = 'disabled';
      return;
    }
    runtime.snapshot.enabled = true;

    // Check configured
    if (!plugin.channelConfig.isConfigured(account, cfg)) {
      runtime.snapshot.configured = false;
      runtime.snapshot.running = false;
      runtime.snapshot.lastError = 'not configured';
      return;
    }
    runtime.snapshot.configured = true;

    // Create AbortController
    const abortController = new AbortController();
    runtime.abortController = abortController;
    runtime.snapshot.running = true;
    runtime.snapshot.lastStartAt = Date.now();
    runtime.snapshot.lastError = null;
    runtime.manuallyStopped = false;

    const log = {
      info: (msg: string) => console.log(`[${channelId}:${accountId}] ${msg}`),
      warn: (msg: string) => console.warn(`[${channelId}:${accountId}] ${msg}`),
      error: (msg: string) => console.error(`[${channelId}:${accountId}] ${msg}`),
    };

    const ctx = {
      cfg,
      accountId,
      account,
      abortSignal: abortController.signal,
      log,
      setStatus: (update: Partial<ChannelAccountSnapshot>) => {
        Object.assign(runtime!.snapshot, update);
      },
      onMessage: this.createMessageHandler(channelId),
    };

    // Start account (async — register crash recovery)
    const task = plugin.gateway.startAccount(ctx)
      .catch((err: Error) => {
        if (abortController.signal.aborted) return; // Expected abort
        runtime!.snapshot.lastError = err.message;
        log.error(`Account crashed: ${err.message}`);
      })
      .finally(() => {
        runtime!.snapshot.running = false;
        runtime!.snapshot.lastStopAt = Date.now();

        // Auto-restart if not manually stopped
        if (!runtime!.manuallyStopped && !abortController.signal.aborted) {
          this.scheduleRestart(channelId, accountId, plugin);
        }
      });

    runtime.task = task;
  }

  /**
   * Schedule an auto-restart with exponential backoff.
   * Delay: 5s * 2^(attempt-1), capped at 5 minutes. Max 10 attempts.
   */
  private scheduleRestart(channelId: string, accountId: string, plugin: ChannelPlugin): void {
    const key = `${channelId}:${accountId}`;
    const runtime = this.accountRuntimes.get(key);
    if (!runtime || runtime.manuallyStopped) return;

    runtime.restartAttempts++;
    if (runtime.restartAttempts > MAX_RESTART_ATTEMPTS) {
      console.error(
        `[ChannelManager] ${key}: max restart attempts (${MAX_RESTART_ATTEMPTS}) reached, giving up`,
      );
      return;
    }

    const delay = Math.min(
      BASE_RESTART_DELAY_MS * Math.pow(2, runtime.restartAttempts - 1),
      MAX_RESTART_DELAY_MS,
    );
    runtime.snapshot.reconnectAttempts = runtime.restartAttempts;

    console.log(
      `[ChannelManager] ${key}: scheduling restart #${runtime.restartAttempts} in ${delay}ms`,
    );

    runtime.restartTimer = setTimeout(() => {
      if (runtime.manuallyStopped) return;
      this.startAccountInternal(channelId, accountId, plugin).catch(err => {
        console.error(`[ChannelManager] ${key}: restart failed: ${err.message}`);
      });
    }, delay);

    // Don't prevent process exit
    if (runtime.restartTimer.unref) runtime.restartTimer.unref();
  }

  // -----------------------------------------------------------------------
  // Message handler (shared by legacy and adapter paths)
  // -----------------------------------------------------------------------

  /**
   * Create a message handler for a specific channel.
   * Implements the inbound pipeline:
   *   SecurityGate → InboundDebouncer → AgentRunner
   */
  private createMessageHandler(channelType: string): OnMessageCallback {
    return async (message: ChannelMessage) => {
      try {
        console.log(
          `[ChannelManager] ${channelType} message from ${message.senderName}: ${message.content.slice(0, 100)}`,
        );

        // Update inbound timestamp on account runtime
        const accountId = message.accountId ?? 'default';
        const key = `${channelType}:${accountId}`;
        const runtime = this.accountRuntimes.get(key);
        if (runtime) {
          runtime.snapshot.lastInboundAt = Date.now();
          runtime.snapshot.lastMessageAt = Date.now();
        }

        // ── SecurityGate: DM policy enforcement ──
        const chatType = message.chatType ?? 'direct';
        if (chatType === 'direct') {
          const plugin = this.channels.get(channelType);
          const security = plugin?.security;
          const dmPolicy = security?.dmPolicy ?? 'open';

          if (dmPolicy === 'pairing' || dmPolicy === 'allowlist') {
            // Merge AllowFrom sources
            const configAllowFrom = security?.allowFrom ?? [];
            const storeAllowFrom = readAllowFrom({ channel: channelType, accountId });
            const allow = mergeDmAllowFromSources({
              allowFrom: configAllowFrom,
              storeAllowFrom,
              dmPolicy,
            });

            const allowed = isSenderIdAllowed(allow, message.senderId, false);
            if (!allowed) {
              if (dmPolicy === 'pairing') {
                // Issue pairing challenge
                const result = upsertPairingRequest({
                  channel: channelType,
                  id: message.senderId,
                  accountId,
                  meta: { senderName: message.senderName },
                });
                // Send pairing reply
                const channel = this.channels.get(channelType);
                if (channel && result.created) {
                  await channel.sendMessage({
                    chatId: message.chatId,
                    text: `🔒 Access not configured.\nPairing code: ${result.code}\nAsk the bot owner to approve this code.`,
                  });
                }
                console.log(
                  `[SecurityGate] ${channelType}: pairing challenge issued to ${message.senderId} (code: ${result.code})`,
                );
              } else {
                console.log(
                  `[SecurityGate] ${channelType}: DM from ${message.senderId} blocked by allowlist policy`,
                );
              }
              return; // Don't process unauthorized messages
            }
          }
          // dmPolicy === 'open' → allow all DMs
        }

        // ── InboundDebouncer ──
        if (this.debouncer.shouldDebounce(message)) {
          this.debouncer.enqueue(message);
          return;
        }

        // No debounce needed — process immediately
        await this.processVerifiedMessage(message);
      } catch (err: any) {
        console.error(`[ChannelManager] Error handling ${channelType} message: ${err.message}`);
      }
    };
  }

  /**
   * Process a verified (security-checked, debounced) message.
   * Routes to Agent via CommandLane concurrency control and sends the response back.
   */
  private async processVerifiedMessage(message: ChannelMessage): Promise<void> {
    const channelType = message.channelType;
    const accountId = message.accountId ?? 'default';
    const key = `${channelType}:${accountId}`;
    const runtime = this.accountRuntimes.get(key);

    try {
      // Execute through CommandLane for concurrency control
      const response = await enqueueCommandInLane('main', async () => {
        return this.config.onMessage(message);
      }, {
        warnAfterMs: 30_000,
        onWait: (waitMs, queuedAhead) => {
          console.log(`[ChannelManager] Message queued for ${waitMs}ms (${queuedAhead} ahead) in 'main' lane`);
        },
      });

      // Update outbound timestamp
      if (runtime) {
        runtime.snapshot.lastOutboundAt = Date.now();
      }

      // Send response back through the same channel
      const channel = this.channels.get(channelType);
      if (channel && response) {
        // Chunked delivery based on outbound adapter limits
        const outbound = channel.outbound;
        const limit = outbound?.textChunkLimit ?? 4096;

        if (response.length > limit) {
          const chunks = outbound?.chunker
            ? outbound.chunker(response, limit)
            : this.defaultChunker(response, limit);

          for (const chunk of chunks) {
            await channel.sendMessage({
              chatId: message.chatId,
              text: chunk,
              replyTo: message.id,
            });
          }
        } else {
          await channel.sendMessage({
            chatId: message.chatId,
            text: response,
            replyTo: message.id,
          });
        }
      }
    } catch (err: any) {
      console.error(`[ChannelManager] Error processing message from ${channelType}: ${err.message}`);
    }
  }

  /**
   * Check if binding peer kind matches message peer kind.
   * Design doc: "group 和 channel 类型在匹配时互相兼容"
   */
  private peerKindMatches(bindingKind: string, messageKind: string): boolean {
    if (bindingKind === messageKind) return true;
    // group and channel/supergroup are compatible
    const groupLike = ['group', 'supergroup', 'channel'];
    return groupLike.includes(bindingKind) && groupLike.includes(messageKind);
  }

  /**
   * Default text chunker — splits on newlines, respecting chunk limit.
   */
  private defaultChunker(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }
      // Try to split at last newline within limit
      let splitAt = remaining.lastIndexOf('\n', limit);
      if (splitAt <= 0) splitAt = limit;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).replace(/^\n/, '');
    }

    return chunks;
  }
}
