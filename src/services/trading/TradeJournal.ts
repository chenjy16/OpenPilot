/**
 * Trade Journal — records closed trades and generates AI weekly reviews
 *
 * Feature: multi-strategy-trading
 * Requirements: 12.1, 12.2, 12.3
 */

import type Database from 'better-sqlite3';

// ─── Interfaces ────────────────────────────────────────────────────────────

export interface TradeRecord {
  id?: number;
  symbol: string;
  strategy_name: string;
  entry_price: number;
  exit_price: number;
  entry_time: number;
  exit_time: number;
  pnl: number;
  pnl_pct: number;
  hold_days: number;
  reason: string;
}

export interface WeeklyReviewRequest {
  start_date: number;
  end_date: number;
}

export interface WeeklyReview {
  total_trades: number;
  win_rate: number;
  total_pnl: number;
  strategy_breakdown: Record<string, {
    trades: number;
    win_rate: number;
    pnl: number;
  }>;
  ai_suggestions: string;
}

/** Minimal AI runtime interface for generating text */
export interface AIRuntimeLike {
  generateText(prompt: string): Promise<string>;
}

// ─── Pure helper: compute weekly stats ─────────────────────────────────────

export interface WeeklyStats {
  total_trades: number;
  win_rate: number;
  total_pnl: number;
  strategy_breakdown: Record<string, {
    trades: number;
    win_rate: number;
    pnl: number;
  }>;
}

/**
 * Compute weekly review statistics from a list of trade records.
 * Pure function — no side effects, easy to test independently.
 */
export function computeWeeklyStats(trades: TradeRecord[]): WeeklyStats {
  const total_trades = trades.length;

  if (total_trades === 0) {
    return {
      total_trades: 0,
      win_rate: 0,
      total_pnl: 0,
      strategy_breakdown: {},
    };
  }

  const winning = trades.filter(t => t.pnl > 0).length;
  const win_rate = winning / total_trades;
  const total_pnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  // Build per-strategy breakdown
  const strategyMap = new Map<string, TradeRecord[]>();
  for (const trade of trades) {
    const list = strategyMap.get(trade.strategy_name) ?? [];
    list.push(trade);
    strategyMap.set(trade.strategy_name, list);
  }

  const strategy_breakdown: WeeklyStats['strategy_breakdown'] = {};
  for (const [name, stratTrades] of strategyMap) {
    const stratWinning = stratTrades.filter(t => t.pnl > 0).length;
    strategy_breakdown[name] = {
      trades: stratTrades.length,
      win_rate: stratWinning / stratTrades.length,
      pnl: stratTrades.reduce((sum, t) => sum + t.pnl, 0),
    };
  }

  return { total_trades, win_rate, total_pnl, strategy_breakdown };
}

// ─── TradeJournal class ────────────────────────────────────────────────────

export class TradeJournal {
  private insertStmt: Database.Statement;
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO trade_journal (symbol, strategy_name, entry_price, exit_price, entry_time, exit_time, pnl, pnl_pct, hold_days, reason)
      VALUES (@symbol, @strategy_name, @entry_price, @exit_price, @entry_time, @exit_time, @pnl, @pnl_pct, @hold_days, @reason)
    `);
  }

  /**
   * Record a closed trade into the trade_journal table.
   * Returns the full TradeRecord with the assigned id.
   */
  record(trade: Omit<TradeRecord, 'id'>): TradeRecord {
    const info = this.insertStmt.run(trade);
    return { ...trade, id: Number(info.lastInsertRowid) };
  }

  /**
   * Query trade records with optional filters.
   * Supports filtering by strategy_name, time range (entry_time based on exit_time), and profitable status.
   */
  query(filter: {
    strategy_name?: string;
    start_time?: number;
    end_time?: number;
    profitable?: boolean;
  } = {}): TradeRecord[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.strategy_name !== undefined) {
      conditions.push('strategy_name = @strategy_name');
      params.strategy_name = filter.strategy_name;
    }
    if (filter.start_time !== undefined) {
      conditions.push('exit_time >= @start_time');
      params.start_time = filter.start_time;
    }
    if (filter.end_time !== undefined) {
      conditions.push('exit_time <= @end_time');
      params.end_time = filter.end_time;
    }
    if (filter.profitable === true) {
      conditions.push('pnl > 0');
    } else if (filter.profitable === false) {
      conditions.push('pnl <= 0');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT id, symbol, strategy_name, entry_price, exit_price, entry_time, exit_time, pnl, pnl_pct, hold_days, reason FROM trade_journal ${where} ORDER BY exit_time DESC`;

    return this.db.prepare(sql).all(params) as TradeRecord[];
  }

  /**
   * Generate a weekly review: aggregate stats for the date range + AI-generated suggestions.
   */
  async generateWeeklyReview(
    request: WeeklyReviewRequest,
    aiRuntime: AIRuntimeLike,
  ): Promise<WeeklyReview> {
    const trades = this.query({
      start_time: request.start_date,
      end_time: request.end_date,
    });

    const stats = computeWeeklyStats(trades);

    // Build prompt for AI suggestions
    const prompt = [
      'You are a quantitative trading analyst. Review the following weekly trading performance and provide actionable improvement suggestions.',
      '',
      `Total trades: ${stats.total_trades}`,
      `Win rate: ${(stats.win_rate * 100).toFixed(1)}%`,
      `Total P&L: $${stats.total_pnl.toFixed(2)}`,
      '',
      'Strategy breakdown:',
      ...Object.entries(stats.strategy_breakdown).map(
        ([name, s]) => `  ${name}: ${s.trades} trades, ${(s.win_rate * 100).toFixed(1)}% win rate, $${s.pnl.toFixed(2)} P&L`,
      ),
      '',
      'Provide 3-5 concise, actionable suggestions for improving trading performance.',
    ].join('\n');

    let ai_suggestions: string;
    try {
      ai_suggestions = await aiRuntime.generateText(prompt);
    } catch {
      ai_suggestions = 'AI review unavailable — failed to generate suggestions.';
    }

    return {
      total_trades: stats.total_trades,
      win_rate: stats.win_rate,
      total_pnl: stats.total_pnl,
      strategy_breakdown: stats.strategy_breakdown,
      ai_suggestions,
    };
  }
}
