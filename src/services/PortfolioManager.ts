/**
 * PortfolioManager - Portfolio & Risk Management
 *
 * Manages portfolio positions (CRUD) and computes risk metrics:
 * - Total market value, PnL, PnL percentage
 * - Sharpe ratio (annualized, configurable risk-free rate)
 * - Maximum drawdown
 * - Kelly criterion position sizing
 */

import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PortfolioPosition {
  id?: number;
  symbol: string;
  quantity: number;
  cost_price: number;
  current_price?: number;
  created_at?: number;
  updated_at?: number;
}

export interface PortfolioPositionWithMetrics extends PortfolioPosition {
  market_value: number;
  pnl: number;
  pnl_pct: number;
}

export interface PortfolioMetrics {
  total_market_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  positions: PortfolioPositionWithMetrics[];
}

export interface KellySuggestion {
  symbol: string;
  kelly_fraction: number;
  suggested_position_pct: number;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function rowToPosition(row: any): PortfolioPosition {
  return {
    id: row.id,
    symbol: row.symbol,
    quantity: row.quantity,
    cost_price: row.cost_price,
    current_price: row.current_price ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Compute the Sharpe ratio from an array of daily returns.
 * Formula: (mean(returns) - riskFreeDaily) / std(returns) * sqrt(252)
 * Returns null when there are fewer than 2 returns or std is 0.
 */
export function computeSharpeRatio(
  dailyReturns: number[],
  annualRiskFreeRate: number = 0,
): number | null {
  if (dailyReturns.length < 2) return null;

  const riskFreeDaily = annualRiskFreeRate / 252;
  const n = dailyReturns.length;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / n;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return null;

  return ((mean - riskFreeDaily) / std) * Math.sqrt(252);
}

/**
 * Compute maximum drawdown from a series of portfolio values.
 * Returns the worst peak-to-trough decline as a non-positive number (e.g. -0.15 = -15%).
 * Returns null when fewer than 2 values.
 */
export function computeMaxDrawdown(values: number[]): number | null {
  if (values.length < 2) return null;

  let peak = values[0];
  let maxDd = 0;

  for (let i = 1; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
    }
    const dd = (values[i] - peak) / peak;
    if (dd < maxDd) {
      maxDd = dd;
    }
  }

  return maxDd;
}

/**
 * Kelly criterion: f* = (p * b - q) / b
 * where p = winRate, q = 1-p, b = avgWin / avgLoss
 * Returns fraction clamped so suggested_position_pct is in [0, 100].
 */
export function computeKellyFraction(
  winRate: number,
  avgWin: number,
  avgLoss: number,
): number {
  if (avgWin <= 0 || avgLoss <= 0) return 0;

  const p = winRate;
  const q = 1 - p;
  const b = avgWin / avgLoss;
  const kelly = (p * b - q) / b;

  return kelly;
}

// ---------------------------------------------------------------------------
// PortfolioManager class
// ---------------------------------------------------------------------------

export class PortfolioManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ---- CRUD ---------------------------------------------------------------

  addPosition(pos: PortfolioPosition): PortfolioPosition {
    const stmt = this.db.prepare(`
      INSERT INTO portfolio_positions (symbol, quantity, cost_price, current_price)
      VALUES (@symbol, @quantity, @cost_price, @current_price)
    `);
    const info = stmt.run({
      symbol: pos.symbol,
      quantity: pos.quantity,
      cost_price: pos.cost_price,
      current_price: pos.current_price ?? null,
    });
    return this.getPosition(Number(info.lastInsertRowid))!;
  }

  getPosition(id: number): PortfolioPosition | null {
    const row = this.db.prepare('SELECT * FROM portfolio_positions WHERE id = ?').get(id) as any;
    return row ? rowToPosition(row) : null;
  }

  listPositions(): PortfolioPosition[] {
    const rows = this.db.prepare('SELECT * FROM portfolio_positions ORDER BY id').all() as any[];
    return rows.map(rowToPosition);
  }

  updatePosition(id: number, pos: Partial<PortfolioPosition>): PortfolioPosition {
    const existing = this.getPosition(id);
    if (!existing) throw new Error(`Position ${id} not found`);

    const fields: string[] = [];
    const params: Record<string, any> = { id };

    if (pos.symbol !== undefined) { fields.push('symbol = @symbol'); params.symbol = pos.symbol; }
    if (pos.quantity !== undefined) { fields.push('quantity = @quantity'); params.quantity = pos.quantity; }
    if (pos.cost_price !== undefined) { fields.push('cost_price = @cost_price'); params.cost_price = pos.cost_price; }
    if (pos.current_price !== undefined) { fields.push('current_price = @current_price'); params.current_price = pos.current_price; }

    if (fields.length > 0) {
      fields.push('updated_at = unixepoch()');
      this.db.prepare(`UPDATE portfolio_positions SET ${fields.join(', ')} WHERE id = @id`).run(params);
    }

    return this.getPosition(id)!;
  }

  deletePosition(id: number): void {
    this.db.prepare('DELETE FROM portfolio_positions WHERE id = ?').run(id);
  }

  // ---- Metrics ------------------------------------------------------------

  /**
   * Compute portfolio-level metrics.
   * If current_price is null for a position, cost_price is used as fallback.
   */
  getMetrics(dailyReturns?: number[], portfolioValues?: number[], riskFreeRate?: number): PortfolioMetrics {
    const positions = this.listPositions();

    const positionsWithMetrics: PortfolioPositionWithMetrics[] = positions.map((p) => {
      const price = p.current_price ?? p.cost_price;
      const marketValue = p.quantity * price;
      const pnl = p.quantity * (price - p.cost_price);
      const totalCost = p.quantity * p.cost_price;
      const pnlPct = totalCost !== 0 ? pnl / totalCost : 0;

      return {
        ...p,
        market_value: marketValue,
        pnl,
        pnl_pct: pnlPct,
      };
    });

    const totalMarketValue = positionsWithMetrics.reduce((s, p) => s + p.market_value, 0);
    const totalPnl = positionsWithMetrics.reduce((s, p) => s + p.pnl, 0);
    const totalCost = positionsWithMetrics.reduce((s, p) => s + p.quantity * p.cost_price, 0);
    const totalPnlPct = totalCost !== 0 ? totalPnl / totalCost : 0;

    const sharpeRatio = dailyReturns ? computeSharpeRatio(dailyReturns, riskFreeRate) : null;
    const maxDrawdown = portfolioValues ? computeMaxDrawdown(portfolioValues) : null;

    return {
      total_market_value: totalMarketValue,
      total_pnl: totalPnl,
      total_pnl_pct: totalPnlPct,
      sharpe_ratio: sharpeRatio,
      max_drawdown: maxDrawdown,
      positions: positionsWithMetrics,
    };
  }

  // ---- Kelly --------------------------------------------------------------

  getKellySuggestion(
    symbol: string,
    winRate: number,
    avgWin: number,
    avgLoss: number,
  ): KellySuggestion {
    const kelly = computeKellyFraction(winRate, avgWin, avgLoss);
    const suggestedPct = Math.max(0, Math.min(100, kelly * 100));

    return {
      symbol,
      kelly_fraction: kelly,
      suggested_position_pct: suggestedPct,
    };
  }
}
