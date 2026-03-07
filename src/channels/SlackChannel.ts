/**
 * Slack Channel Plugin (Stub)
 *
 * OpenPilot equivalent: extensions/slack/
 * Uses @slack/bolt for Slack App integration.
 *
 * Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET to enable.
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
  ChannelAccountSnapshot,
} from './types';

export interface SlackChannelConfig {
  token: string;
  signingSecret: string;
  appToken?: string;
}

export class SlackChannel implements ChannelPlugin {
  readonly type = 'slack';
  readonly displayName = 'Slack';

  readonly meta: ChannelMeta = {
    id: 'slack',
    label: 'Slack',
    selectionLabel: 'Slack (Bolt)',
    blurb: 'Slack workspace integration',
    icon: '💼',
    order: 3,
  };

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ['direct', 'group', 'thread'],
    reactions: true,
    edit: true,
    media: true,
    threads: true,
    streaming: false,
    maxTextLength: 40000,
  };

  readonly outbound: ChannelOutboundAdapter = {
    deliveryMode: 'direct',
    textChunkLimit: 40000,
  };

  readonly channelConfig: ChannelConfigAdapter = {
    listAccountIds: (cfg: any): string[] => {
      const sl = cfg?.channels?.slack ?? cfg?.slack;
      if (!sl) return ['default'];
      if (sl.token) return ['default'];
      return Object.keys(sl).filter(k => typeof sl[k] === 'object');
    },
    resolveAccount: (cfg: any, accountId?: string): any => {
      const sl = cfg?.channels?.slack ?? cfg?.slack;
      if (!sl) return undefined;
      if (sl.token) return sl;
      return sl[accountId ?? 'default'];
    },
    isEnabled: (account: any): boolean => {
      if (!account) return false;
      return account.enabled !== false;
    },
    isConfigured: (account: any): boolean => {
      if (!account) return false;
      return Boolean(account.token && account.signingSecret);
    },
  };

  readonly gateway: ChannelGatewayAdapter = {
    startAccount: async (ctx: ChannelGatewayContext): Promise<void> => {
      const token = ctx.account?.token;
      const signingSecret = ctx.account?.signingSecret;
      if (!token || !signingSecret) throw new Error('SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET required');

      let bolt: any;
      try {
        bolt = require('@slack/bolt');
      } catch {
        throw new Error('@slack/bolt package not installed. Run: npm install @slack/bolt');
      }

      const app = new bolt.App({
        token,
        signingSecret,
        socketMode: !!ctx.account?.appToken,
        appToken: ctx.account?.appToken,
      });
      this.app = app;

      app.message(async ({ message: msg, say }: any) => {
        if (msg.subtype) return;

        const channelMessage: ChannelMessage = {
          id: msg.ts,
          senderId: msg.user,
          senderName: msg.user,
          channelType: 'slack',
          chatId: msg.channel,
          content: msg.text || '',
          timestamp: new Date(parseFloat(msg.ts) * 1000),
          accountId: ctx.accountId,
          chatType: msg.channel_type === 'im' ? 'direct' : 'group',
          threadId: msg.thread_ts ?? undefined,
        };
        this.messageCount++;
        await ctx.onMessage(channelMessage);
      });

      await app.start();
      this.status = 'connected';
      this.connectedAt = new Date();
      ctx.setStatus({ connected: true, lastConnectedAt: Date.now() });
      ctx.log.info('App started');

      // Wait for abort signal
      await new Promise<void>((_, reject) => {
        ctx.abortSignal.addEventListener('abort', () => {
          app.stop().catch(() => {});
          this.app = null;
          this.status = 'disconnected';
          reject(new Error('aborted'));
        });
      });
    },
    stopAccount: async (ctx: ChannelGatewayContext): Promise<void> => {
      if (this.app) {
        try { await this.app.stop(); } catch { /* ignore */ }
        this.app = null;
      }
      this.status = 'disconnected';
      ctx.log.info('App stopped');
    },
  };

  private config: SlackChannelConfig;
  private app: any = null;
  private status: ChannelStatus = 'disconnected';
  private statusMessage?: string;
  private connectedAt?: Date;
  private messageCount = 0;

  constructor(config: SlackChannelConfig) {
    this.config = config;
  }

  async connect(onMessage: OnMessageCallback): Promise<void> {
    if (!this.config.token || !this.config.signingSecret) {
      this.status = 'error';
      this.statusMessage = 'SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET required';
      throw new Error(this.statusMessage);
    }

    let bolt: any;
    try {
      bolt = require('@slack/bolt');
    } catch {
      this.status = 'error';
      this.statusMessage = '@slack/bolt package not installed. Run: npm install @slack/bolt';
      throw new Error(this.statusMessage);
    }

    this.status = 'connecting';
    this.app = new bolt.App({
      token: this.config.token,
      signingSecret: this.config.signingSecret,
      socketMode: !!this.config.appToken,
      appToken: this.config.appToken,
    });

    this.app.message(async ({ message: msg, say }: any) => {
      if (msg.subtype) return; // Skip bot messages, edits, etc.

      const channelMessage: ChannelMessage = {
        id: msg.ts,
        senderId: msg.user,
        senderName: msg.user,
        channelType: 'slack',
        chatId: msg.channel,
        content: msg.text || '',
        timestamp: new Date(parseFloat(msg.ts) * 1000),
      };

      this.messageCount++;
      await onMessage(channelMessage);
    });

    await this.app.start();
    this.status = 'connected';
    this.connectedAt = new Date();
    console.log('[SlackChannel] App started');
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      try { await this.app.stop(); } catch { /* ignore */ }
      this.app = null;
    }
    this.status = 'disconnected';
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.app) throw new Error('Slack app is not connected');
    await this.app.client.chat.postMessage({
      channel: message.chatId,
      text: message.text,
      thread_ts: message.replyTo,
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
}

export function createSlackChannel(): SlackChannel | null {
  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!token || !signingSecret) return null;
  return new SlackChannel({
    token,
    signingSecret,
    appToken: process.env.SLACK_APP_TOKEN,
  });
}
