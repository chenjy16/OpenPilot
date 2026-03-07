/**
 * Channel Plugin Abstraction Layer — OpenClaw-aligned
 */
export type ChannelId = string;
export type ChatType = 'direct' | 'group' | 'supergroup' | 'channel' | 'thread';

export interface ChannelMessage {
  id: string;
  senderId: string;
  senderName: string;
  channelType: string;
  chatId: string;
  content: string;
  timestamp: Date;
  attachments?: ChannelAttachment[];
  replyTo?: string;
  accountId?: string;
  chatType?: ChatType;
  guildId?: string;
  threadId?: string;
}

export interface ChannelAttachment {
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  data?: string;
  mimeType?: string;
  filename?: string;
  size?: number;
}

export interface OutboundMessage {
  chatId: string;
  text: string;
  replyTo?: string;
  attachments?: ChannelAttachment[];
  threadId?: string;
}

export interface ChannelMeta {
  id: ChannelId;
  label: string;
  selectionLabel?: string;
  blurb?: string;
  icon?: string;
  order?: number;
  aliases?: string[];
}

export interface ChannelCapabilities {
  chatTypes: ChatType[];
  reactions?: boolean;
  edit?: boolean;
  media?: boolean;
  polls?: boolean;
  threads?: boolean;
  streaming?: boolean;
  maxTextLength?: number;
}

export interface ChannelConfigAdapter<ResolvedAccount = any> {
  listAccountIds(cfg: any): string[];
  resolveAccount(cfg: any, accountId?: string): ResolvedAccount | undefined;
  isEnabled(account: ResolvedAccount, cfg?: any): boolean;
  isConfigured(account: ResolvedAccount, cfg?: any): boolean;
}

export interface ChannelGatewayAdapter<ResolvedAccount = any> {
  startAccount(ctx: ChannelGatewayContext<ResolvedAccount>): Promise<void>;
  stopAccount?(ctx: ChannelGatewayContext<ResolvedAccount>): Promise<void>;
}

export interface ChannelGatewayContext<ResolvedAccount = any> {
  cfg: any;
  accountId: string;
  account: ResolvedAccount;
  abortSignal: AbortSignal;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  setStatus(update: Partial<ChannelAccountSnapshot>): void;
  onMessage: OnMessageCallback;
}

export interface ChannelOutboundAdapter {
  deliveryMode: 'direct' | 'gateway' | 'hybrid';
  textChunkLimit?: number;
  chunkerMode?: 'text' | 'markdown';
  chunker?: ((text: string, limit: number) => string[]) | null;
  sendText?(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult>;
  sendMedia?(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult>;
  sendPayload?(ctx: ChannelOutboundPayloadContext): Promise<OutboundDeliveryResult>;
}

export interface ChannelOutboundContext {
  to: string;
  text: string;
  replyTo?: string;
  threadId?: string;
  mediaUrl?: string;
  mediaType?: string;
}

export interface ChannelOutboundPayloadContext extends ChannelOutboundContext {
  payload: any;
}

export interface OutboundDeliveryResult {
  channel: string;
  messageId?: string;
  chatId?: string;
  error?: string;
}

export interface ChannelSecurityAdapter<ResolvedAccount = any> {
  dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
  allowFrom?: string[];
  isAllowed?(account: ResolvedAccount, senderId: string, chatType?: ChatType): boolean;
  resolveDmPolicy?(cfg: any, accountId?: string): { policy: string; allowFrom?: string[] };
}

export interface ChannelStatusAdapter<ResolvedAccount = any, Probe = unknown, Audit = unknown> {
  probe?(account: ResolvedAccount): Promise<Probe>;
  audit?(account: ResolvedAccount): Promise<Audit>;
}

export interface ChannelAccountSnapshot {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  connected?: boolean;
  reconnectAttempts?: number;
  lastConnectedAt?: number | null;
  lastDisconnect?: { at: number; error?: string; loggedOut?: boolean } | null;
  lastMessageAt?: number | null;
  lastError?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  busy?: boolean;
  activeRuns?: number;
  /** DM security policy active on this account */
  dmPolicy?: string;
  /** AllowFrom whitelist entries */
  allowFrom?: string[];
  /** Account mode (e.g. 'bot', 'user') */
  mode?: string;
  /** Last run activity timestamp */
  lastRunActivityAt?: number | null;
  /** Token source identifier */
  tokenSource?: string;
  /** Probe result from status adapter */
  probe?: unknown;
}

export type ChannelStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface ChannelInfo {
  type: string;
  status: ChannelStatus;
  statusMessage?: string;
  connectedAt?: Date;
  messageCount: number;
  accounts?: ChannelAccountSnapshot[];
}

export interface ChannelRuntimeEntry {
  channelId: ChannelId;
  meta?: ChannelMeta;
  capabilities?: ChannelCapabilities;
  accounts: ChannelAccountSnapshot[];
}

export interface ChannelRuntimeSnapshot {
  channels: ChannelRuntimeEntry[];
  timestamp: number;
}

export interface RoutePeer {
  kind: ChatType;
  id: string;
}

export interface AgentBinding {
  agentId: string;
  match: {
    channel?: string;
    accountId?: string;
    peer?: RoutePeer;
    guildId?: string;
    teamId?: string;
    roles?: string[];
  };
}

export interface ResolvedAgentRoute {
  agentId: string;
  channel: string;
  accountId: string;
  sessionKey: string;
  mainSessionKey: string;
  matchedBy: 'binding.peer' | 'binding.peer.parent' | 'binding.guild+roles'
    | 'binding.guild' | 'binding.team' | 'binding.account' | 'binding.channel' | 'default';
}

export type OnMessageCallback = (message: ChannelMessage) => Promise<void>;

export interface ChannelPlugin {
  readonly type: string;
  readonly displayName: string;
  readonly meta?: ChannelMeta;
  readonly capabilities?: ChannelCapabilities;
  readonly channelConfig?: ChannelConfigAdapter;
  readonly gateway?: ChannelGatewayAdapter;
  readonly outbound?: ChannelOutboundAdapter;
  readonly security?: ChannelSecurityAdapter;
  readonly statusAdapter?: ChannelStatusAdapter;

  connect(onMessage: OnMessageCallback): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(message: OutboundMessage): Promise<void>;
  sendChunked?(chatId: string, chunks: AsyncIterable<string>, replyTo?: string): Promise<void>;
  getStatus(): ChannelInfo;
}
