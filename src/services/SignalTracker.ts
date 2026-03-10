/**
 * SignalTracker - Signal Performance Tracking
 *
 * Tracks historical signal outcomes (hit_tp, hit_sl, expired) and
 * computes performance statistics (win rate, avg PnL ratio, by-confidence breakdown).
 */

import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalOutcome = 'pending' | 'hit_tp' | 'hit_sl' | 'expired';

export interface SignalStats {
  total_signals: number;
  hit_tp_count: number;
  hit_sl_count: number;
  expired_count: number;
  pending_count: number;
  win_rate: number;
  avg_pnl_ratio: number;
  by_confidence: Record<string, { total: number; win_rate: number }>;
}

export interface SignalRow {
  id: number;
  symbol: string;
  action: string;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  confidence: string | null;
  created_at: number;
  outcome: SignalOutcome;
  outcome_at: number | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Determine the outcome of a signal given a price series.
 *
 * Walks through `prices` in order. For a **buy** signal the TP is above entry
 * and SL is below; for a **sell** signal the TP is below entry and SL is above.
 *
 * Returns 'hit_tp' if TP is reached first, 'hit_sl' if SL is reached first,
 * or 'pending' if neither is reached.
 */
export function determineOutcome(
  action: string,
  entryPrice: number,
  takeProfit: number,
  stopLoss: number,
  prices: number[],
): SignalOutcome {
  for (const price of prices) {
    if (action === 'buy') {
      // Buy: TP is above entry, SL is below
      const hitTp = price >= takeProfit;
      const hitSl = price <= stopLoss;
      if (hitTp && hitSl) {
        // Both hit simultaneously – TP wins (conservative: favour the target)
        return 'hit_tp';
      }
      if (hitTp) return 'hit_tp';
      if (hitSl) return 'hit_sl';
    } else if (action === 'sell') {
      // Sell: TP is below entry, SL is above
      const hitTp = price <= takeProfit;
      const hitSl = price >= stopLoss;
      if (hitTp && hitSl) {
        return 'hit_tp';
      }
      if (hitTp) return 'hit_tp';
      if (hitSl) return 'hit_sl';
    }
  }
  return 'pending';
}

/**
 * Compute win rate: hit_tp_count / (hit_tp_count + hit_sl_count).
 * Returns 0 when there are no completed (non-pending, non-expired) signals.
 */
export function computeWinRate(hitTp: number, hitSl: number): number {
  const completed = hitTp + hitSl;
  if (completed === 0) return 0;
  return hitTp / completed;
}

/**
 * Compute average PnL ratio for completed signals.
 * PnL ratio per signal = |take_profit - entry_price| / |entry_price - stop_loss|
 * Returns 0 when no completed signals exist or when stop_loss === entry_price.
 */
export function computeAvgPnlRatio(
  signals: Array<{ entry_price: number; stop_loss: number; take_profit: number; outcome: SignalOutcome }>,
): number {
  const completed = signals.filter((s) => s.outcome === 'hit_tp' || s.outcome === 'hit_sl');
  if (completed.length === 0) return 0;

  let totalRatio = 0;
  let validCount = 0;
  for (const s of completed) {
    const risk = Math.abs(s.entry_price - s.stop_loss);
    if (risk === 0) continue;
    const reward = Math.abs(s.take_profit - s.entry_price);
    totalRatio += reward / risk;
    validCount++;
  }

  return validCount > 0 ? totalRatio / validCount : 0;
}

// ---------------------------------------------------------------------------
// SignalTracker class
// ---------------------------------------------------------------------------

const EXPIRY_DAYS = 30;

export class SignalTracker {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Check pending signals and update their outcomes.
   *
   * - Signals older than 30 days that are still pending → expired
   * - For remaining pending signals, the caller would normally fetch current
   *   prices; here we mark expired ones and return the count of updates.
   *
   * In a production system, checkAndUpdateOutcomes would fetch live prices
   * via yfinance/sandbox. For testability the price-checking logic is in
   * the pure `determineOutcome` helper.
   */
  async checkAndUpdateOutcomes(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const expiryThreshold = now - EXPIRY_DAYS * 24 * 60 * 60;

    // Mark expired signals (pending + older than 30 days)
    const expireResult = this.db.prepare(`
      UPDATE stock_signals
      SET outcome = 'expired', outcome_at = @now
      WHERE outcome = 'pending' AND created_at < @threshold
    `).run({ now, threshold: expiryThreshold });

    return expireResult.changes;
  }

  /**
   * Update a specific signal's outcome (used after price checking).
   */
  updateSignalOutcome(signalId: number, outcome: SignalOutcome): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      UPDATE stock_signals
      SET outcome = @outcome, outcome_at = @now
      WHERE id = @id
    `).run({ id: signalId, outcome, now });
  }

  /**
   * Compute signal performance statistics with optional filters.
   */
  getStats(filters?: { symbol?: string; days?: number }): SignalStats {
    let whereClause = '1=1';
    const params: Record<string, any> = {};

    if (filters?.symbol) {
      whereClause += ' AND symbol = @symbol';
      params.symbol = filters.symbol;
    }
    if (filters?.days) {
      const threshold = Math.floor(Date.now() / 1000) - filters.days * 24 * 60 * 60;
      whereClause += ' AND created_at >= @threshold';
      params.threshold = threshold;
    }

    const rows = this.db.prepare(`
      SELECT id, symbol, action, entry_price, stop_loss, take_profit,
             confidence, created_at, outcome, outcome_at
      FROM stock_signals
      WHERE ${whereClause}
    `).all(params) as SignalRow[];

    const total = rows.length;
    const hitTpCount = rows.filter((r) => r.outcome === 'hit_tp').length;
    const hitSlCount = rows.filter((r) => r.outcome === 'hit_sl').length;
    const expiredCount = rows.filter((r) => r.outcome === 'expired').length;
    const pendingCount = rows.filter((r) => r.outcome === 'pending').length;

    const winRate = computeWinRate(hitTpCount, hitSlCount);

    const completedWithPrices = rows
      .filter((r) => (r.outcome === 'hit_tp' || r.outcome === 'hit_sl')
        && r.entry_price != null && r.stop_loss != null && r.take_profit != null)
      .map((r) => ({
        entry_price: r.entry_price!,
        stop_loss: r.stop_loss!,
        take_profit: r.take_profit!,
        outcome: r.outcome,
      }));

    const avgPnlRatio = computeAvgPnlRatio(completedWithPrices);

    // By-confidence grouping
    const byConfidence: Record<string, { total: number; win_rate: number }> = {};
    const groups: Record<string, { total: number; hitTp: number; hitSl: number }> = {};

    for (const row of rows) {
      const conf = (row.confidence || 'unknown').toLowerCase();
      if (!groups[conf]) {
        groups[conf] = { total: 0, hitTp: 0, hitSl: 0 };
      }
      groups[conf].total++;
      if (row.outcome === 'hit_tp') groups[conf].hitTp++;
      if (row.outcome === 'hit_sl') groups[conf].hitSl++;
    }

    for (const [key, g] of Object.entries(groups)) {
      byConfidence[key] = {
        total: g.total,
        win_rate: computeWinRate(g.hitTp, g.hitSl),
      };
    }

    return {
      total_signals: total,
      hit_tp_count: hitTpCount,
      hit_sl_count: hitSlCount,
      expired_count: expiredCount,
      pending_count: pendingCount,
      win_rate: winRate,
      avg_pnl_ratio: avgPnlRatio,
      by_confidence: byConfidence,
    };
  }
}
