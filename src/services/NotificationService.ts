/**
 * NotificationService — sends alerts to Telegram/Discord channels.
 *
 * Responsibilities:
 *   - Format signal notifications
 *   - Dedup: same market_id not notified within 24h
 *   - Send via ChannelManager.sendMessage()
 *   - Error notifications and system alerts
 */

import type Database from 'better-sqlite3';
import type { ChannelManager } from '../channels/ChannelManager';
import type { SignalResult } from './PolymarketScanner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotifyConfig {
  enabled?: boolean;
  telegram?: { chatId: string };
  discord?: { channelId: string };
  /** Minimum |edge| to trigger notification (default: 0.10) */
  minEdge?: number;
  /** Dedup window in hours (default: 24) */
  dedupHours?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class NotificationService {
  private db: Database.Database;
  private channelManager?: ChannelManager;
  private config: NotifyConfig;

  constructor(db: Database.Database, channelManager?: ChannelManager, config?: NotifyConfig) {
    this.db = db;
    this.channelManager = channelManager;
    this.config = config ?? {};
  }

  updateConfig(config: Partial<NotifyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // -------------------------------------------------------------------------
  // Signal notifications
  // -------------------------------------------------------------------------

  /**
   * Send notifications for +EV opportunities.
   * Filters by minEdge and dedup window.
   * Returns number of notifications sent.
   */
  async notifySignals(signals: SignalResult[]): Promise<number> {
    if (!this.config.enabled) return 0;
    if (!this.channelManager) {
      console.warn('[NotificationService] No ChannelManager — skipping notifications');
      return 0;
    }

    const minEdge = this.config.minEdge ?? 0.10;
    const dedupHours = this.config.dedupHours ?? 24;
    let sent = 0;

    for (const signal of signals) {
      // Filter: only notify if edge exceeds threshold
      if (Math.abs(signal.edge) < minEdge) continue;

      // Dedup: check if this market was notified recently
      if (this.wasRecentlyNotified(signal.marketId, dedupHours)) continue;

      const text = this.formatSignalMessage(signal);

      // Send to Telegram
      if (this.config.telegram?.chatId) {
        try {
          await this.channelManager.sendMessage('telegram', {
            chatId: this.config.telegram.chatId,
            text,
          });
          sent++;
        } catch (err: any) {
          console.warn(`[NotificationService] Telegram send failed: ${err.message}`);
        }
      }

      // Send to Discord
      if (this.config.discord?.channelId) {
        try {
          await this.channelManager.sendMessage('discord', {
            chatId: this.config.discord.channelId,
            text,
          });
          sent++;
        } catch (err: any) {
          console.warn(`[NotificationService] Discord send failed: ${err.message}`);
        }
      }

      // Mark as notified
      this.markNotified(signal.marketId);
    }

    if (sent > 0) {
      console.log(`[NotificationService] Sent ${sent} signal notifications`);
    }
    return sent;
  }

  /**
   * Send a system alert (scan errors, etc.)
   */
  async sendSystemAlert(message: string): Promise<void> {
    if (!this.config.enabled || !this.channelManager) return;

    const text = `⚠️ PolyOracle 系统通知\n\n${message}`;

    if (this.config.telegram?.chatId) {
      try {
        await this.channelManager.sendMessage('telegram', {
          chatId: this.config.telegram.chatId,
          text,
        });
      } catch (err: any) {
        console.warn(`[NotificationService] Alert send failed: ${err.message}`);
      }
    }
  }

  /**
   * Send a scan summary after each cron run.
   */
  async sendScanSummary(stats: {
    marketsScanned: number;
    signalsGenerated: number;
    opportunities: number;
    errors: number;
    durationMs: number;
  }): Promise<void> {
    if (!this.config.enabled || !this.channelManager) return;

    // Only send summary if there are opportunities or errors
    if (stats.opportunities === 0 && stats.errors === 0) return;

    const text = [
      '📡 PolyOracle 扫描报告',
      '',
      `🔍 扫描市场: ${stats.marketsScanned}`,
      `📊 生成信号: ${stats.signalsGenerated}`,
      `⚡ +EV 机会: ${stats.opportunities}`,
      stats.errors > 0 ? `❌ 错误: ${stats.errors}` : '',
      `⏱️ 耗时: ${(stats.durationMs / 1000).toFixed(1)}s`,
    ].filter(Boolean).join('\n');

    if (this.config.telegram?.chatId) {
      try {
        await this.channelManager.sendMessage('telegram', {
          chatId: this.config.telegram.chatId,
          text,
        });
      } catch { /* ignore */ }
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private formatSignalMessage(signal: SignalResult): string {
    const edgeSign = signal.edge > 0 ? '+' : '';
    const edgePct = (signal.edge * 100).toFixed(1);
    const marketPct = (signal.marketProbability * 100).toFixed(1);
    const aiPct = (signal.aiProbability * 100).toFixed(1);

    return [
      '🔮 PolyOracle 发现预测市场机会',
      '',
      `📊 ${signal.question}`,
      `   市场概率: ${marketPct}%`,
      `   AI 预测:  ${aiPct}%`,
      `   Edge:     ${edgeSign}${edgePct}%`,
      `   置信度:   ${signal.confidence}`,
      '',
      signal.reasoning ? `💡 ${signal.reasoning}` : '',
      '',
      `⏰ ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    ].filter(Boolean).join('\n');
  }

  private wasRecentlyNotified(marketId: string, hours: number): boolean {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
      const row = this.db.prepare(`
        SELECT id FROM market_signals
        WHERE market_id = ? AND notified_at IS NOT NULL AND notified_at > ?
        LIMIT 1
      `).get(marketId, cutoff) as any;
      return !!row;
    } catch {
      return false;
    }
  }

  private markNotified(marketId: string): void {
    try {
      const now = Math.floor(Date.now() / 1000);
      this.db.prepare(`
        UPDATE market_signals SET notified_at = ?
        WHERE market_id = ? AND notified_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).run(now, marketId);
    } catch (err: any) {
      console.warn(`[NotificationService] markNotified failed: ${err.message}`);
    }
  }
}
