/**
 * PerformanceAnalytics — trading performance metrics and equity curve.
 *
 * Computes: win rate, avg P&L, Sharpe, Sortino, max drawdown,
 * drawdown recovery days, per-strategy attribution, daily equity curve.
 */

import type Database from 'better-sqlite3';

export interface TradeRecord {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  hold_seconds: number;
  strategy_id?: number;
  created_at: number;
}

export interface DailyEquity {
  date: string; // YYYY-MM-DD
  equity: number;
  daily_pnl: number;
  daily_return: number; // percentage
  cumulative_return: number;
}

export interface PerformanceMetrics {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_pnl: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  avg_hold_hours: number;
  total_pnl: number;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown: number;
  max_drawdown_pct: number;
  recovery_days: number | null;
  best_trade: TradeRecord | null;
  worst_trade: TradeRecord | null;
  equity_curve: DailyEquity[];
  by_strategy: StrategyAttribution[];
}

export interface StrategyAttribution {
  strategy_id: number | null;
  strategy_name: string;
  trades: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
}

export class PerformanceAnalytics {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Build closed trade records by matching buy fills with sell fills per symbol.
   * Uses FIFO matching: earliest buy matched with earliest sell.
   */
  getClosedTrades(periodDays?: number): TradeRecord[] {
    const since = periodDays
      ? Math.floor(Date.now() / 1000) - periodDays * 86400
      : 0;

    const fills = this.db.prepare(`
      SELECT id, symbol, side, quantity, filled_quantity, filled_price, strategy_id, created_at
      FROM trading_orders
      WHERE status = 'filled' AND filled_price IS NOT NULL AND created_at >= ?
      ORDER BY created_at ASC
    `).all(since) as Array<{
      id: number; symbol: string; side: string; quantity: number;
      filled_quantity: number; filled_price: number; strategy_id: number | null; created_at: number;
    }>;

    // Group by symbol, match buys with sells (FIFO)
    const buyQueue = new Map<string, Array<{ price: number; qty: number; strategy_id: number | null; created_at: number; id: number }>>();
    const trades: TradeRecord[] = [];

    for (const fill of fills) {
      const sym = fill.symbol;
      if (fill.side === 'buy') {
        if (!buyQueue.has(sym)) buyQueue.set(sym, []);
        buyQueue.get(sym)!.push({
          price: fill.filled_price,
          qty: fill.filled_quantity,
          strategy_id: fill.strategy_id,
          created_at: fill.created_at,
          id: fill.id,
        });
      } else {
        // sell — match against buy queue
        let remainSell = fill.filled_quantity;
        const queue = buyQueue.get(sym) ?? [];
        while (remainSell > 0 && queue.length > 0) {
          const buy = queue[0];
          const matchQty = Math.min(remainSell, buy.qty);
          const pnl = (fill.filled_price - buy.price) * matchQty;
          const pnlPct = buy.price > 0 ? ((fill.filled_price - buy.price) / buy.price) * 100 : 0;

          trades.push({
            id: fill.id,
            symbol: sym,
            side: 'round_trip',
            quantity: matchQty,
            entry_price: buy.price,
            exit_price: fill.filled_price,
            pnl,
            pnl_pct: Math.round(pnlPct * 100) / 100,
            hold_seconds: fill.created_at - buy.created_at,
            strategy_id: buy.strategy_id ?? undefined,
            created_at: fill.created_at,
          });

          buy.qty -= matchQty;
          remainSell -= matchQty;
          if (buy.qty <= 0) queue.shift();
        }
      }
    }

    return trades;
  }

  /**
   * Compute full performance metrics for a given period.
   */
  getMetrics(periodDays: number = 30): PerformanceMetrics {
    const trades = this.getClosedTrades(periodDays);
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);

    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

    const avgHoldSeconds = trades.length > 0
      ? trades.reduce((s, t) => s + t.hold_seconds, 0) / trades.length
      : 0;

    // Equity curve
    const equityCurve = this.buildEquityCurve(trades);

    // Sharpe & Sortino from daily returns
    const dailyReturns = equityCurve.map(d => d.daily_return / 100);
    const sharpe = this.calcSharpe(dailyReturns);
    const sortino = this.calcSortino(dailyReturns);

    // Max drawdown
    const { maxDrawdown, maxDrawdownPct, recoveryDays } = this.calcDrawdown(equityCurve);

    // Best / worst trade
    const sorted = [...trades].sort((a, b) => b.pnl - a.pnl);

    // Strategy attribution
    const byStrategy = this.calcStrategyAttribution(trades);

    return {
      total_trades: trades.length,
      winning_trades: wins.length,
      losing_trades: losses.length,
      win_rate: trades.length > 0 ? wins.length / trades.length : 0,
      avg_pnl: trades.length > 0 ? totalPnl / trades.length : 0,
      avg_win: wins.length > 0 ? grossProfit / wins.length : 0,
      avg_loss: losses.length > 0 ? -grossLoss / losses.length : 0,
      profit_factor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      avg_hold_hours: avgHoldSeconds / 3600,
      total_pnl: totalPnl,
      sharpe_ratio: sharpe,
      sortino_ratio: sortino,
      max_drawdown: maxDrawdown,
      max_drawdown_pct: maxDrawdownPct,
      recovery_days: recoveryDays,
      best_trade: sorted.length > 0 ? sorted[0] : null,
      worst_trade: sorted.length > 0 ? sorted[sorted.length - 1] : null,
      equity_curve: equityCurve,
      by_strategy: byStrategy,
    };
  }

  private buildEquityCurve(trades: TradeRecord[]): DailyEquity[] {
    if (trades.length === 0) return [];

    // Get initial capital from account
    const accountRow = this.db.prepare(
      `SELECT value FROM trading_config WHERE key = 'paper_initial_capital'`
    ).get() as { value: string } | undefined;
    const initialCapital = accountRow ? Number(accountRow.value) : 1000000;

    // Group PnL by date
    const dailyPnl = new Map<string, number>();
    for (const t of trades) {
      const date = new Date(t.created_at * 1000).toISOString().slice(0, 10);
      dailyPnl.set(date, (dailyPnl.get(date) ?? 0) + t.pnl);
    }

    const sortedDates = [...dailyPnl.keys()].sort();
    let equity = initialCapital;
    const curve: DailyEquity[] = [];

    for (const date of sortedDates) {
      const pnl = dailyPnl.get(date)!;
      const prevEquity = equity;
      equity += pnl;
      const dailyReturn = prevEquity > 0 ? (pnl / prevEquity) * 100 : 0;
      const cumReturn = initialCapital > 0 ? ((equity - initialCapital) / initialCapital) * 100 : 0;

      curve.push({
        date,
        equity: Math.round(equity * 100) / 100,
        daily_pnl: Math.round(pnl * 100) / 100,
        daily_return: Math.round(dailyReturn * 100) / 100,
        cumulative_return: Math.round(cumReturn * 100) / 100,
      });
    }

    return curve;
  }

  private calcSharpe(dailyReturns: number[], riskFreeRate: number = 0.04): number | null {
    if (dailyReturns.length < 2) return null;
    const dailyRf = riskFreeRate / 252;
    const excessReturns = dailyReturns.map(r => r - dailyRf);
    const mean = excessReturns.reduce((s, r) => s + r, 0) / excessReturns.length;
    const variance = excessReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (excessReturns.length - 1);
    const std = Math.sqrt(variance);
    if (std === 0) return null;
    return Math.round((mean / std) * Math.sqrt(252) * 100) / 100;
  }

  private calcSortino(dailyReturns: number[], riskFreeRate: number = 0.04): number | null {
    if (dailyReturns.length < 2) return null;
    const dailyRf = riskFreeRate / 252;
    const excessReturns = dailyReturns.map(r => r - dailyRf);
    const mean = excessReturns.reduce((s, r) => s + r, 0) / excessReturns.length;
    const downside = excessReturns.filter(r => r < 0);
    if (downside.length === 0) return null;
    const downsideVariance = downside.reduce((s, r) => s + r ** 2, 0) / downside.length;
    const downsideStd = Math.sqrt(downsideVariance);
    if (downsideStd === 0) return null;
    return Math.round((mean / downsideStd) * Math.sqrt(252) * 100) / 100;
  }

  private calcDrawdown(curve: DailyEquity[]): { maxDrawdown: number; maxDrawdownPct: number; recoveryDays: number | null } {
    if (curve.length === 0) return { maxDrawdown: 0, maxDrawdownPct: 0, recoveryDays: null };

    let peak = curve[0].equity;
    let maxDD = 0;
    let maxDDPct = 0;
    let recoveryDays: number | null = null;
    let maxDDEndIdx = 0;
    let maxDDPeak = peak; // the peak value when max drawdown occurred

    for (let i = 0; i < curve.length; i++) {
      if (curve[i].equity > peak) {
        peak = curve[i].equity;
      }
      const dd = peak - curve[i].equity;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDPct = ddPct;
        maxDDEndIdx = i;
        maxDDPeak = peak;
      }
    }

    // Find recovery: first time equity >= the peak that caused max drawdown
    for (let i = maxDDEndIdx + 1; i < curve.length; i++) {
      if (curve[i].equity >= maxDDPeak) {
        recoveryDays = i - maxDDEndIdx;
        break;
      }
    }

    return {
      maxDrawdown: Math.round(maxDD * 100) / 100,
      maxDrawdownPct: Math.round(maxDDPct * 100) / 100,
      recoveryDays,
    };
  }

  private calcStrategyAttribution(trades: TradeRecord[]): StrategyAttribution[] {
    const groups = new Map<number | null, TradeRecord[]>();
    for (const t of trades) {
      const key = t.strategy_id ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }

    // Load strategy names
    const strategyNames = new Map<number, string>();
    try {
      const rows = this.db.prepare('SELECT id, name FROM strategies').all() as Array<{ id: number; name: string }>;
      for (const r of rows) strategyNames.set(r.id, r.name);
    } catch { /* strategies table may not exist */ }

    const result: StrategyAttribution[] = [];
    for (const [stratId, group] of groups) {
      const wins = group.filter(t => t.pnl > 0);
      const totalPnl = group.reduce((s, t) => s + t.pnl, 0);
      result.push({
        strategy_id: stratId,
        strategy_name: stratId ? (strategyNames.get(stratId) ?? `策略 #${stratId}`) : '信号交易',
        trades: group.length,
        win_rate: group.length > 0 ? wins.length / group.length : 0,
        total_pnl: Math.round(totalPnl * 100) / 100,
        avg_pnl: group.length > 0 ? Math.round((totalPnl / group.length) * 100) / 100 : 0,
      });
    }

    return result.sort((a, b) => b.total_pnl - a.total_pnl);
  }
}
