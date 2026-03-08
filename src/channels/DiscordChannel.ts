/**
 * Discord Channel Plugin
 *
 * Full implementation using discord.js v14.
 * Supports: DMs, guild text channels, threads, attachments, message chunking.
 *
 * Configuration:
 *   Set DISCORD_BOT_TOKEN environment variable.
 *   Optionally set DISCORD_ALLOWED_GUILDS (comma-separated guild IDs).
 *
 * Required Discord Bot Permissions:
 *   - Send Messages, Read Message History, View Channels
 *   - Message Content Intent (must be enabled in Discord Developer Portal)
 *
 * Gateway Intents used:
 *   - Guilds, GuildMessages, MessageContent, DirectMessages
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Message as DiscordMessage,
  TextChannel,
  DMChannel,
  ThreadChannel,
  ChannelType,
  AttachmentBuilder,
} from 'discord.js';
import {
  ChannelPlugin,
  ChannelMessage,
  OutboundMessage,
  ChannelInfo,
  ChannelStatus,
  OnMessageCallback,
  ChannelMeta,
  ChannelCapabilities,
  ChannelConfigAdapter,
  ChannelGatewayAdapter,
  ChannelGatewayContext,
  ChannelOutboundAdapter,
  ChannelAccountSnapshot,
  ChatType,
} from './types';

/** Discord message length limit */
const MAX_MESSAGE_LENGTH = 2000;

export interface DiscordChannelConfig {
  token: string;
  allowedGuildIds?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map Discord ChannelType to our ChatType.
 */
function resolveChatType(channel: DiscordMessage['channel']): ChatType {
  switch (channel.type) {
    case ChannelType.DM:
    case ChannelType.GroupDM:
      return 'direct';
    case ChannelType.PublicThread:
    case ChannelType.PrivateThread:
    case ChannelType.AnnouncementThread:
      return 'thread';
    default:
      return 'group';
  }
}

/**
 * Check if a Discord channel is a thread.
 */
function isThread(channel: DiscordMessage['channel']): boolean {
  return (
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
}

/**
 * Split a long message into chunks at paragraph or sentence boundaries.
 */
function splitMessage(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    // Try paragraph boundary
    let splitIdx = remaining.lastIndexOf('\n\n', limit);
    if (splitIdx < limit / 2) {
      // Try sentence boundary
      splitIdx = remaining.lastIndexOf('. ', limit);
    }
    if (splitIdx < limit / 2) {
      // Try any newline
      splitIdx = remaining.lastIndexOf('\n', limit);
    }
    if (splitIdx < limit / 2) {
      // Hard split
      splitIdx = limit;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

// ---------------------------------------------------------------------------
// DiscordChannel
// ---------------------------------------------------------------------------

export class DiscordChannel implements ChannelPlugin {
  readonly type = 'discord';
  readonly displayName = 'Discord';

  readonly meta: ChannelMeta = {
    id: 'discord',
    label: 'Discord',
    selectionLabel: 'Discord (Bot)',
    blurb: 'Discord server integration via bot',
    icon: '🎮',
    order: 2,
  };

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ['direct', 'group', 'thread'],
    reactions: true,
    edit: true,
    media: true,
    threads: true,
    streaming: false,
    maxTextLength: MAX_MESSAGE_LENGTH,
  };

  readonly outbound: ChannelOutboundAdapter = {
    deliveryMode: 'direct',
    textChunkLimit: MAX_MESSAGE_LENGTH,
  };

  readonly channelConfig: ChannelConfigAdapter = {
    listAccountIds: (cfg: any): string[] => {
      const dc = cfg?.channels?.discord ?? cfg?.discord;
      if (!dc) return ['default'];
      if (dc.token) return ['default'];
      return Object.keys(dc).filter(k => typeof dc[k] === 'object');
    },
    resolveAccount: (cfg: any, accountId?: string): any => {
      const dc = cfg?.channels?.discord ?? cfg?.discord;
      // Fall back to constructor config (env-based token) when appConfig has no discord section
      if (!dc) return { token: this.config.token, allowedGuildIds: this.config.allowedGuildIds, enabled: !!this.config.token };
      if (dc.token) return dc;
      const account = dc[accountId ?? 'default'];
      // If account exists but has no token, inject from constructor config
      if (account && !account.token && this.config.token) {
        return { ...account, token: this.config.token };
      }
      return account;
    },
    isEnabled: (account: any): boolean => {
      if (!account) return false;
      return account.enabled !== false;
    },
    isConfigured: (account: any): boolean => {
      if (!account) return false;
      return Boolean(account.token);
    },
  };

  readonly gateway: ChannelGatewayAdapter = {
    startAccount: async (ctx: ChannelGatewayContext): Promise<void> => {
      const token = ctx.account?.token;
      if (!token) throw new Error('Discord bot token is required');

      const client = this.createClient();
      this.client = client;

      const allowedGuildIds: string[] = ctx.account?.allowedGuildIds
        ?? (ctx.account?.guilds
          ? String(ctx.account.guilds).split(',').map((s: string) => s.trim()).filter(Boolean)
          : []);

      client.on('messageCreate', async (msg: DiscordMessage) => {
        if (msg.author.bot) return;
        const guildId = msg.guild?.id;
        if (allowedGuildIds.length && guildId && !allowedGuildIds.includes(guildId)) return;

        const message = this.discordMessageToChannel(msg, ctx.accountId);
        this.messageCount++;
        await ctx.onMessage(message);
      });

      client.on('ready', () => {
        this.status = 'connected';
        this.connectedAt = new Date();
        this.statusMessage = undefined;
        ctx.setStatus({
          connected: true,
          lastConnectedAt: Date.now(),
          name: client.user?.tag,
        });
        ctx.log.info(`Bot ready as ${client.user?.tag}`);
      });

      client.on('error', (err: Error) => {
        ctx.log.error(`Client error: ${err.message}`);
        ctx.setStatus({ lastError: err.message });
      });

      await client.login(token);

      // Wait for abort signal
      await new Promise<void>((_, reject) => {
        ctx.abortSignal.addEventListener('abort', () => {
          try { client.destroy(); } catch { /* ignore */ }
          this.client = null;
          this.status = 'disconnected';
          reject(new Error('aborted'));
        });
      });
    },
    stopAccount: async (ctx: ChannelGatewayContext): Promise<void> => {
      if (this.client) {
        try { this.client.destroy(); } catch { /* ignore */ }
        this.client = null;
      }
      this.status = 'disconnected';
      ctx.log.info('Bot stopped');
    },
  };

  private config: DiscordChannelConfig;
  private client: Client | null = null;
  private status: ChannelStatus = 'disconnected';
  private statusMessage?: string;
  private connectedAt?: Date;
  private messageCount = 0;

  constructor(config: DiscordChannelConfig) {
    this.config = config;
  }

  // -----------------------------------------------------------------------
  // ChannelPlugin interface
  // -----------------------------------------------------------------------

  async connect(onMessage: OnMessageCallback): Promise<void> {
    if (!this.config.token) {
      this.status = 'error';
      this.statusMessage = 'DISCORD_BOT_TOKEN not set';
      throw new Error('Discord bot token is required');
    }

    this.status = 'connecting';
    const client = this.createClient();
    this.client = client;

    client.on('messageCreate', async (msg: DiscordMessage) => {
      if (msg.author.bot) return;

      const guildId = msg.guild?.id;
      if (this.config.allowedGuildIds?.length && guildId && !this.config.allowedGuildIds.includes(guildId)) {
        return;
      }

      const message = this.discordMessageToChannel(msg);
      this.messageCount++;
      await onMessage(message);
    });

    client.on('ready', () => {
      this.status = 'connected';
      this.connectedAt = new Date();
      this.statusMessage = undefined;
      console.log(`[DiscordChannel] Bot ready as ${client.user?.tag}`);
    });

    client.on('error', (err: Error) => {
      console.error(`[DiscordChannel] Client error: ${err.message}`);
      this.statusMessage = `Error: ${err.message}`;
    });

    // Debug: log WebSocket lifecycle events
    client.on('warn', (msg: string) => {
      console.warn(`[DiscordChannel] Warning: ${msg}`);
    });

    client.on('debug', (msg: string) => {
      // Only log connection-related debug messages (skip heartbeat noise)
      if (msg.includes('Connecting') || msg.includes('connect') || msg.includes('Ready')
        || msg.includes('error') || msg.includes('Error') || msg.includes('close')
        || msg.includes('Shard') || msg.includes('Gateway') || msg.includes('READY')
        || msg.includes('Identify') || msg.includes('Hello')) {
        console.log(`[DiscordChannel:debug] ${msg}`);
      }
    });

    console.log(`[DiscordChannel] Logging in...`);
    await client.login(this.config.token);
    console.log(`[DiscordChannel] login() returned, waiting for ready event...`);

    // Give it a moment to connect
    await new Promise(resolve => setTimeout(resolve, 1000));

    if ((this.status as string) !== 'connected') {
      this.status = 'connected';
      this.connectedAt = new Date();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try { this.client.destroy(); } catch { /* ignore */ }
      this.client = null;
    }
    this.status = 'disconnected';
    this.statusMessage = undefined;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.client) throw new Error('Discord bot is not connected');

    const channel = await this.client.channels.fetch(message.chatId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Cannot send to channel ${message.chatId}: not a text channel`);
    }

    const textChannel = channel as TextChannel | DMChannel | ThreadChannel;
    const text = message.text;

    if (text.length <= MAX_MESSAGE_LENGTH) {
      await textChannel.send({
        content: text,
        reply: message.replyTo ? { messageReference: message.replyTo } : undefined,
      });
    } else {
      // Chunk long messages
      const chunks = splitMessage(text);
      for (let i = 0; i < chunks.length; i++) {
        await textChannel.send({
          content: chunks[i],
          reply: i === 0 && message.replyTo
            ? { messageReference: message.replyTo }
            : undefined,
        });
      }
    }
  }

  /**
   * Send a file attachment to a Discord channel.
   */
  async sendFile(chatId: string, file: Buffer, filename: string, caption?: string): Promise<void> {
    if (!this.client) throw new Error('Discord bot is not connected');

    const channel = await this.client.channels.fetch(chatId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Cannot send to channel ${chatId}: not a text channel`);
    }

    const textChannel = channel as TextChannel | DMChannel | ThreadChannel;
    const attachment = new AttachmentBuilder(file, { name: filename });
    await textChannel.send({
      content: caption ?? undefined,
      files: [attachment],
    });
  }

  getStatus(): ChannelInfo {
    return {
      type: this.type,
      status: this.status,
      statusMessage: this.statusMessage,
      connectedAt: this.connectedAt,
      messageCount: this.messageCount,
    };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Create a discord.js Client with the required intents and partials.
   */
  private createClient(): Client {
    return new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      // Partials are needed to receive DM events
      partials: [Partials.Channel, Partials.Message],
    });
  }

  /**
   * Convert a discord.js Message to our ChannelMessage format.
   */
  private discordMessageToChannel(msg: DiscordMessage, accountId?: string): ChannelMessage {
    const chatType = resolveChatType(msg.channel);
    const guildId = msg.guild?.id;
    const threadId = isThread(msg.channel) ? msg.channel.id : undefined;

    // Build content: text + attachment descriptions
    let content = msg.content || '';
    if (msg.attachments.size > 0 && !content) {
      content = '[Attachment]';
    }

    // Collect attachments (use Array.from to handle both Collection and Map)
    const attachments = msg.attachments.size > 0
      ? Array.from(msg.attachments.values()).map((att: any) => ({
          type: (att.contentType?.startsWith('image/') ? 'image'
            : att.contentType?.startsWith('video/') ? 'video'
            : att.contentType?.startsWith('audio/') ? 'audio'
            : 'file') as 'image' | 'video' | 'audio' | 'file',
          url: att.url,
          mimeType: att.contentType ?? undefined,
          filename: att.name ?? undefined,
          size: att.size,
        }))
      : undefined;

    return {
      id: msg.id,
      senderId: msg.author.id,
      senderName: msg.author.displayName ?? msg.author.username,
      channelType: 'discord',
      chatId: msg.channel.id,
      content,
      timestamp: msg.createdAt,
      accountId,
      chatType,
      guildId: guildId ?? undefined,
      threadId,
      replyTo: msg.reference?.messageId ?? undefined,
      attachments,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Discord channel from environment variables.
 * Returns null if DISCORD_BOT_TOKEN is not set.
 */
export function createDiscordChannel(): DiscordChannel | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const allowedGuildIds = process.env.DISCORD_ALLOWED_GUILDS
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return new DiscordChannel({ token, allowedGuildIds });
}
