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
import type { CrossMarketArbitrageOpportunity } from './crossmarket/types';

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
  /** Cross-market dedup window in hours (default: 4) */
  crossMarketDedupHours?: number;
}

// ---------------------------------------------------------------------------
// Cross-market dedup state
// ---------------------------------------------------------------------------

interface CrossMarketDedupEntry {
  notifiedAt: number;
  profitPct: number;
}

// ---------------------------------------------------------------------------
// Standalone formatter (exported for property testing)
// ---------------------------------------------------------------------------

/**
 * Format a cross-market arbitrage opportunity into a human-readable alert message.
 * Exported as a standalone function for property testing (Property 15).
 */
export function formatCrossMarketAlert(opp: CrossMarketArbitrageOpportunity): string {
  const directionLabel =
    opp.direction === 'A_YES_B_NO'
      ? `Buy ${opp.platformA} YES + Buy ${opp.platformB} NO`
      : `Buy ${opp.platformA} NO + Buy ${opp.platformB} YES`;

  const lines: string[] = [
    '🔀 跨市场套利机会',
    '',
    `📊 ${opp.question}`,
    '',
    `🔄 方向: ${opp.direction} — ${directionLabel}`,
    '',
    `🅰️ ${opp.platformA}`,
    `   Yes: ${opp.platformAYesPrice.toFixed(4)}  |  No: ${opp.platformANoPrice.toFixed(4)}`,
    `🅱️ ${opp.platformB}`,
    `   Yes: ${opp.platformBYesPrice.toFixed(4)}  |  No: ${opp.platformBNoPrice.toFixed(4)}`,
    '',
    `📈 VWAP Buy: ${opp.vwapBuyPrice.toFixed(4)}  |  VWAP Sell: ${opp.vwapSellPrice.toFixed(4)}`,
    `💰 实际套利成本: ${opp.realArbitrageCost.toFixed(4)}`,
    `📊 预期利润: ${opp.profitPct.toFixed(2)}%`,
    `⭐ Arb_Score: ${opp.arbScore}`,
  ];

  if (opp.liquidityWarning) {
    lines.push('⚠️ 流动性警告: 买卖价差较大，执行风险较高');
  }

  if (opp.oracleMismatch) {
    lines.push('⚠️ Oracle Mismatch: 双方结算规则存在差异，请谨慎评估');
  }

  lines.push('');
  lines.push(`💡 建议: ${opp.profitPct >= 5 ? '值得关注，建议进一步验证深度后执行' : '利润较薄，建议持续观察'}`);
  lines.push(`⏰ ${new Date(opp.detectedAt * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class NotificationService {
  private db: Database.Database;
  private channelManager?: ChannelManager;
  private config: NotifyConfig;
  /** In-memory dedup state for cross-market alerts: key = "platformA:marketIdA|platformB:marketIdB" */
  private crossMarketDedup: Map<string, CrossMarketDedupEntry> = new Map();

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
  // Cross-market arbitrage alerts
  // -------------------------------------------------------------------------

  /**
   * Send a cross-market arbitrage alert via Telegram.
   * Dedup: same market pair not re-notified within crossMarketDedupHours (default 4),
   * unless profitPct changes by more than 2 percentage points.
   * On send failure, retries once after 30 seconds.
   */
  async sendCrossMarketAlert(opportunity: CrossMarketArbitrageOpportunity): Promise<void> {
    if (!this.config.enabled || !this.channelManager) return;

    const dedupHours = this.config.crossMarketDedupHours ?? 4;
    const dedupKey = `${opportunity.platformA}:${opportunity.platformAMarketId}|${opportunity.platformB}:${opportunity.platformBMarketId}`;

    // Dedup check
    const existing = this.crossMarketDedup.get(dedupKey);
    if (existing) {
      const elapsedMs = Date.now() - existing.notifiedAt;
      const withinWindow = elapsedMs < dedupHours * 3600 * 1000;
      const profitChange = Math.abs(opportunity.profitPct - existing.profitPct);
      if (withinWindow && profitChange <= 2) {
        return; // skip — dedup hit
      }
    }

    const text = formatCrossMarketAlert(opportunity);

    if (this.config.telegram?.chatId) {
      let sent = false;
      try {
        await this.channelManager.sendMessage('telegram', {
          chatId: this.config.telegram.chatId,
          text,
        });
        sent = true;
      } catch (err: any) {
        console.warn(`[NotificationService] Cross-market alert send failed: ${err.message}`);
      }

      // Retry once after 30 seconds on failure
      if (!sent) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 30_000));
          await this.channelManager!.sendMessage('telegram', {
            chatId: this.config.telegram.chatId,
            text,
          });
          sent = true;
        } catch (err: any) {
          console.warn(`[NotificationService] Cross-market alert retry failed: ${err.message}`);
        }
      }

      if (sent) {
        // Update dedup state
        this.crossMarketDedup.set(dedupKey, {
          notifiedAt: Date.now(),
          profitPct: opportunity.profitPct,
        });
      }
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
