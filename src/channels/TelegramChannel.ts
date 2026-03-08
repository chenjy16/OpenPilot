/**
 * Telegram Channel Plugin
 *
 * OpenPilot equivalent: src/telegram/ + extensions/telegram/
 * Uses the grammy library for Telegram Bot API integration.
 *
 * Features:
 *   - Receives text messages from Telegram chats
 *   - Sends responses back (with chunking for long messages)
 *   - Supports reply-to threading
 *   - Handles images as attachments
 *
 * Configuration:
 *   Set TELEGRAM_BOT_TOKEN environment variable.
 *
 * grammy is lazy-loaded — if not installed, the channel reports an error
 * on connect() but doesn't crash the application.
 */

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
  ChannelSecurityAdapter,
  ChannelAccountSnapshot,
} from './types';

/** Telegram message length limit */
const MAX_MESSAGE_LENGTH = 4096;

export interface TelegramChannelConfig {
  /** Bot token from @BotFather */
  token: string;
  /** Optional: allowed chat IDs (whitelist). Empty = allow all. */
  allowedChatIds?: string[];
}

export class TelegramChannel implements ChannelPlugin {
  readonly type = 'telegram';
  readonly displayName = 'Telegram';

  readonly meta: ChannelMeta = {
    id: 'telegram',
    label: 'Telegram',
    selectionLabel: 'Telegram (Bot API)',
    blurb: 'simplest way to get started',
    icon: '✈️',
    order: 1,
  };

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ['direct', 'group', 'supergroup', 'channel'],
    reactions: true,
    edit: true,
    media: true,
    polls: true,
    threads: false,
    streaming: false,
    maxTextLength: MAX_MESSAGE_LENGTH,
  };

  readonly outbound: ChannelOutboundAdapter = {
    deliveryMode: 'direct',
    textChunkLimit: MAX_MESSAGE_LENGTH,
    chunkerMode: 'text',
  };

  readonly security: ChannelSecurityAdapter = {
    dmPolicy: 'open',
  };

  readonly channelConfig: ChannelConfigAdapter = {
    listAccountIds: (cfg: any): string[] => {
      const tg = cfg?.channels?.telegram ?? cfg?.telegram;
      if (!tg) return ['default'];
      if (tg.token) return ['default']; // flat config → single account
      return Object.keys(tg).filter(k => typeof tg[k] === 'object');
    },
    resolveAccount: (cfg: any, accountId?: string): any => {
      const tg = cfg?.channels?.telegram ?? cfg?.telegram;
      if (!tg) return { token: this.config.token, allowedChatIds: this.config.allowedChatIds, enabled: !!this.config.token };
      if (tg.token) return tg; // flat config
      const account = tg[accountId ?? 'default'];
      if (account && !account.token && this.config.token) {
        return { ...account, token: this.config.token };
      }
      return account;
    },
    isEnabled: (account: any, _cfg?: any): boolean => {
      if (!account) return false;
      return account.enabled !== false;
    },
    isConfigured: (account: any, _cfg?: any): boolean => {
      if (!account) return false;
      return Boolean(account.token);
    },
  };

  readonly gateway: ChannelGatewayAdapter = {
    startAccount: async (ctx: ChannelGatewayContext): Promise<void> => {
      const token = ctx.account?.token;
      if (!token) throw new Error('Telegram bot token is required');

      let grammy: any;
      try {
        grammy = require('grammy');
      } catch {
        throw new Error('grammy package not installed. Run: npm install grammy');
      }

      const bot = new grammy.Bot(token);
      this.bot = bot;

      const allowedChatIds: string[] = ctx.account?.allowedChatIds
        ?? (ctx.account?.allowedChats
          ? String(ctx.account.allowedChats).split(',').map((s: string) => s.trim()).filter(Boolean)
          : []);

      bot.on('message:text', async (tgCtx: any) => {
        const chatId = String(tgCtx.chat.id);
        if (allowedChatIds.length && !allowedChatIds.includes(chatId)) return;

        const message: ChannelMessage = {
          id: String(tgCtx.message.message_id),
          senderId: String(tgCtx.from?.id ?? 'unknown'),
          senderName: tgCtx.from?.first_name ?? tgCtx.from?.username ?? 'Unknown',
          channelType: 'telegram',
          chatId,
          content: tgCtx.message.text,
          timestamp: new Date(tgCtx.message.date * 1000),
          accountId: ctx.accountId,
          chatType: chatId.startsWith('-') ? 'group' : 'direct',
          replyTo: tgCtx.message.reply_to_message
            ? String(tgCtx.message.reply_to_message.message_id)
            : undefined,
        };
        this.messageCount++;
        await ctx.onMessage(message);
      });

      bot.on('message:photo', async (tgCtx: any) => {
        const chatId = String(tgCtx.chat.id);
        if (allowedChatIds.length && !allowedChatIds.includes(chatId)) return;

        const photo = tgCtx.message.photo[tgCtx.message.photo.length - 1];
        const file = await tgCtx.api.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

        const message: ChannelMessage = {
          id: String(tgCtx.message.message_id),
          senderId: String(tgCtx.from?.id ?? 'unknown'),
          senderName: tgCtx.from?.first_name ?? tgCtx.from?.username ?? 'Unknown',
          channelType: 'telegram',
          chatId,
          content: tgCtx.message.caption ?? '[Image]',
          timestamp: new Date(tgCtx.message.date * 1000),
          accountId: ctx.accountId,
          chatType: chatId.startsWith('-') ? 'group' : 'direct',
          attachments: [{ type: 'image', url: fileUrl, mimeType: 'image/jpeg' }],
        };
        this.messageCount++;
        await ctx.onMessage(message);
      });

      // Handle voice messages
      bot.on('message:voice', async (tgCtx: any) => {
        const chatId = String(tgCtx.chat.id);
        if (allowedChatIds.length && !allowedChatIds.includes(chatId)) return;

        const voice = tgCtx.message.voice;
        const file = await tgCtx.api.getFile(voice.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

        const message: ChannelMessage = {
          id: String(tgCtx.message.message_id),
          senderId: String(tgCtx.from?.id ?? 'unknown'),
          senderName: tgCtx.from?.first_name ?? tgCtx.from?.username ?? 'Unknown',
          channelType: 'telegram',
          chatId,
          content: tgCtx.message.caption ?? '[Voice]',
          timestamp: new Date(tgCtx.message.date * 1000),
          accountId: ctx.accountId,
          chatType: chatId.startsWith('-') ? 'group' : 'direct',
          attachments: [{ type: 'audio', url: fileUrl, mimeType: voice.mime_type ?? 'audio/ogg' }],
        };
        this.messageCount++;
        await ctx.onMessage(message);
      });

      // Handle audio file messages
      bot.on('message:audio', async (tgCtx: any) => {
        const chatId = String(tgCtx.chat.id);
        if (allowedChatIds.length && !allowedChatIds.includes(chatId)) return;

        const audio = tgCtx.message.audio;
        const file = await tgCtx.api.getFile(audio.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

        const message: ChannelMessage = {
          id: String(tgCtx.message.message_id),
          senderId: String(tgCtx.from?.id ?? 'unknown'),
          senderName: tgCtx.from?.first_name ?? tgCtx.from?.username ?? 'Unknown',
          channelType: 'telegram',
          chatId,
          content: tgCtx.message.caption ?? `[Audio: ${audio.title ?? audio.file_name ?? 'untitled'}]`,
          timestamp: new Date(tgCtx.message.date * 1000),
          accountId: ctx.accountId,
          chatType: chatId.startsWith('-') ? 'group' : 'direct',
          attachments: [{ type: 'audio', url: fileUrl, mimeType: audio.mime_type ?? 'audio/mpeg' }],
        };
        this.messageCount++;
        await ctx.onMessage(message);
      });

      bot.catch((err: any) => {
        ctx.log.error(`Bot error: ${err.message}`);
        ctx.setStatus({ lastError: err.message });
      });

      // Start polling
      bot.start({
        onStart: () => {
          this.status = 'connected';
          this.connectedAt = new Date();
          this.statusMessage = undefined;
          ctx.setStatus({ connected: true, lastConnectedAt: Date.now() });
          ctx.log.info('Bot started polling');
        },
      });

      // Wait for abort signal
      await new Promise<void>((_, reject) => {
        ctx.abortSignal.addEventListener('abort', () => {
          bot.stop().catch(() => {});
          this.bot = null;
          this.status = 'disconnected';
          reject(new Error('aborted'));
        });
      });
    },
    stopAccount: async (ctx: ChannelGatewayContext): Promise<void> => {
      if (this.bot) {
        try { await this.bot.stop(); } catch { /* ignore */ }
        this.bot = null;
      }
      this.status = 'disconnected';
      ctx.log.info('Bot stopped');
    },
  };

  private config: TelegramChannelConfig;
  private bot: any = null;
  private status: ChannelStatus = 'disconnected';
  private statusMessage?: string;
  private connectedAt?: Date;
  private messageCount = 0;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
  }

  async connect(onMessage: OnMessageCallback): Promise<void> {
    if (!this.config.token) {
      this.status = 'error';
      this.statusMessage = 'TELEGRAM_BOT_TOKEN not set';
      throw new Error('Telegram bot token is required');
    }

    let grammy: any;
    try {
      grammy = require('grammy');
    } catch {
      this.status = 'error';
      this.statusMessage = 'grammy package not installed. Run: npm install grammy';
      throw new Error(this.statusMessage);
    }

    this.status = 'connecting';
    this.bot = new grammy.Bot(this.config.token);

    // Handle text messages
    this.bot.on('message:text', async (ctx: any) => {
      const chatId = String(ctx.chat.id);

      // Whitelist check
      if (this.config.allowedChatIds?.length && !this.config.allowedChatIds.includes(chatId)) {
        return; // Silently ignore messages from non-whitelisted chats
      }

      const message: ChannelMessage = {
        id: String(ctx.message.message_id),
        senderId: String(ctx.from?.id ?? 'unknown'),
        senderName: ctx.from?.first_name ?? ctx.from?.username ?? 'Unknown',
        channelType: 'telegram',
        chatId,
        content: ctx.message.text,
        timestamp: new Date(ctx.message.date * 1000),
        replyTo: ctx.message.reply_to_message
          ? String(ctx.message.reply_to_message.message_id)
          : undefined,
      };

      this.messageCount++;
      await onMessage(message);
    });

    // Handle photo messages
    this.bot.on('message:photo', async (ctx: any) => {
      const chatId = String(ctx.chat.id);
      if (this.config.allowedChatIds?.length && !this.config.allowedChatIds.includes(chatId)) {
        return;
      }

      const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Largest size
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;

      const message: ChannelMessage = {
        id: String(ctx.message.message_id),
        senderId: String(ctx.from?.id ?? 'unknown'),
        senderName: ctx.from?.first_name ?? ctx.from?.username ?? 'Unknown',
        channelType: 'telegram',
        chatId,
        content: ctx.message.caption ?? '[Image]',
        timestamp: new Date(ctx.message.date * 1000),
        attachments: [{
          type: 'image',
          url: fileUrl,
          mimeType: 'image/jpeg',
        }],
      };

      this.messageCount++;
      await onMessage(message);
    });

    // Handle voice messages
    this.bot.on('message:voice', async (ctx: any) => {
      const chatId = String(ctx.chat.id);
      if (this.config.allowedChatIds?.length && !this.config.allowedChatIds.includes(chatId)) return;

      const voice = ctx.message.voice;
      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;

      const message: ChannelMessage = {
        id: String(ctx.message.message_id),
        senderId: String(ctx.from?.id ?? 'unknown'),
        senderName: ctx.from?.first_name ?? ctx.from?.username ?? 'Unknown',
        channelType: 'telegram',
        chatId,
        content: ctx.message.caption ?? '[Voice]',
        timestamp: new Date(ctx.message.date * 1000),
        attachments: [{ type: 'audio', url: fileUrl, mimeType: voice.mime_type ?? 'audio/ogg' }],
      };
      this.messageCount++;
      await onMessage(message);
    });

    // Handle audio file messages
    this.bot.on('message:audio', async (ctx: any) => {
      const chatId = String(ctx.chat.id);
      if (this.config.allowedChatIds?.length && !this.config.allowedChatIds.includes(chatId)) return;

      const audio = ctx.message.audio;
      const file = await ctx.api.getFile(audio.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;

      const message: ChannelMessage = {
        id: String(ctx.message.message_id),
        senderId: String(ctx.from?.id ?? 'unknown'),
        senderName: ctx.from?.first_name ?? ctx.from?.username ?? 'Unknown',
        channelType: 'telegram',
        chatId,
        content: ctx.message.caption ?? `[Audio: ${audio.title ?? audio.file_name ?? 'untitled'}]`,
        timestamp: new Date(ctx.message.date * 1000),
        attachments: [{ type: 'audio', url: fileUrl, mimeType: audio.mime_type ?? 'audio/mpeg' }],
      };
      this.messageCount++;
      await onMessage(message);
    });

    // Error handling
    this.bot.catch((err: any) => {
      console.error(`[TelegramChannel] Bot error: ${err.message}`);
      this.statusMessage = `Error: ${err.message}`;
    });

    // Start polling (non-blocking)
    this.bot.start({
      onStart: () => {
        this.status = 'connected';
        this.connectedAt = new Date();
        this.statusMessage = undefined;
        console.log('[TelegramChannel] Bot started polling');
      },
    });

    // Give it a moment to connect
    await new Promise(resolve => setTimeout(resolve, 500));

    if (this.status as string !== 'connected') {
      this.status = 'connected'; // Assume connected if no error
      this.connectedAt = new Date();
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stop();
      } catch { /* ignore */ }
      this.bot = null;
    }
    this.status = 'disconnected';
    this.statusMessage = undefined;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot is not connected');
    }

    // If message has audio attachment, send as voice note
    const audioAttachment = message.attachments?.find(a => a.type === 'audio');
    if (audioAttachment?.data) {
      await this.sendVoice(message.chatId, Buffer.from(audioAttachment.data, 'base64'), message.replyTo);
      // Also send text if present and non-trivial
      if (message.text && message.text.length > 0 && message.text !== '[Voice]') {
        await this.bot.api.sendMessage(message.chatId, message.text, {
          reply_to_message_id: message.replyTo ? parseInt(message.replyTo, 10) : undefined,
        });
      }
      return;
    }

    const text = message.text;

    // Chunk long messages (Telegram limit: 4096 chars)
    if (text.length <= MAX_MESSAGE_LENGTH) {
      await this.bot.api.sendMessage(message.chatId, text, {
        reply_to_message_id: message.replyTo ? parseInt(message.replyTo, 10) : undefined,
        parse_mode: undefined, // Plain text for safety
      });
    } else {
      // Split into chunks
      const chunks = this.splitMessage(text);
      for (let i = 0; i < chunks.length; i++) {
        await this.bot.api.sendMessage(message.chatId, chunks[i], {
          reply_to_message_id: i === 0 && message.replyTo
            ? parseInt(message.replyTo, 10)
            : undefined,
        });
      }
    }
  }

  /**
   * Send a voice note to a Telegram chat.
   */
  async sendVoice(chatId: string, audio: Buffer, replyTo?: string): Promise<void> {
    if (!this.bot) throw new Error('Telegram bot is not connected');

    let InputFile: any;
    try {
      const grammy = require('grammy');
      InputFile = grammy.InputFile;
    } catch {
      // Fallback: send as raw buffer
      InputFile = null;
    }

    const voice = InputFile ? new InputFile(audio, 'voice.ogg') : audio;
    await this.bot.api.sendVoice(chatId, voice, {
      reply_to_message_id: replyTo ? parseInt(replyTo, 10) : undefined,
    });
  }

  /**
   * Send a document/file to a Telegram chat.
   */
  async sendDocument(chatId: string, file: Buffer, filename: string, caption?: string, replyTo?: string): Promise<void> {
    if (!this.bot) throw new Error('Telegram bot is not connected');

    let InputFile: any;
    try {
      const grammy = require('grammy');
      InputFile = grammy.InputFile;
    } catch {
      InputFile = null;
    }

    const doc = InputFile ? new InputFile(file, filename) : file;
    await this.bot.api.sendDocument(chatId, doc, {
      caption: caption?.slice(0, 1024),
      reply_to_message_id: replyTo ? parseInt(replyTo, 10) : undefined,
    });
  }

  /**
   * Send a photo to a Telegram chat.
   */
  async sendPhoto(chatId: string, photo: Buffer, caption?: string, replyTo?: string): Promise<void> {
    if (!this.bot) throw new Error('Telegram bot is not connected');

    let InputFile: any;
    try {
      const grammy = require('grammy');
      InputFile = grammy.InputFile;
    } catch {
      InputFile = null;
    }

    const img = InputFile ? new InputFile(photo, 'image.png') : photo;
    await this.bot.api.sendPhoto(chatId, img, {
      caption: caption?.slice(0, 1024),
      reply_to_message_id: replyTo ? parseInt(replyTo, 10) : undefined,
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

  /**
   * Split a long message into chunks at paragraph or sentence boundaries.
   */
  private splitMessage(text: string): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > MAX_MESSAGE_LENGTH) {
      // Try to split at paragraph boundary
      let splitIdx = remaining.lastIndexOf('\n\n', MAX_MESSAGE_LENGTH);
      if (splitIdx < MAX_MESSAGE_LENGTH / 2) {
        // Try sentence boundary
        splitIdx = remaining.lastIndexOf('. ', MAX_MESSAGE_LENGTH);
      }
      if (splitIdx < MAX_MESSAGE_LENGTH / 2) {
        // Hard split
        splitIdx = MAX_MESSAGE_LENGTH;
      }

      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx).trimStart();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }
}

/**
 * Create a Telegram channel from environment variables.
 * Returns null if TELEGRAM_BOT_TOKEN is not set.
 */
export function createTelegramChannel(): TelegramChannel | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const allowedChatIds = process.env.TELEGRAM_ALLOWED_CHATS
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean);

  return new TelegramChannel({ token, allowedChatIds });
}
