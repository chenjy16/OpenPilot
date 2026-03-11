/**
 * StrategyAllocator — Multi-strategy capital allocation and P&L tracking.
 *
 * Manages per-strategy capital budgets, tracks used capital and realized P&L,
 * and enforces allocation limits before order placement.
 */

import type Database from 'better-sqlite3';

export interface StrategyAllocation {
  strategy_id: number;
  allocated_capital: number;
  used_capital: number;
  realized_pnl: number;
  max_drawdown: number;
  peak_equity: number;
  enabled: boolean;
  updated_at: number;
}

export interface AllocationSummary {
  total_allocated: number;
  total_used: number;
  total_realized_pnl: number;
  strategies: StrategyAllocation[];
}

export class StrategyAllocator {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Set capital allocation for a strategy.
   */
  setAllocation(strategyId: number, capital: number): void {
    this.db.prepare(`
      INSERT INTO strategy_allocations (strategy_id, allocated_capital, peak_equity, updated_at)
      VALUES (@sid, @capital, @capital, unixepoch())
      ON CONFLICT(strategy_id) DO UPDATE SET
        allocated_capital = @capital,
        updated_at = unixepoch()
    `).run({ sid: strategyId, capital });
  }

  /**
   * Get allocation for a specific strategy.
   */
  getAllocation(strategyId: number): StrategyAllocation | null {
    const row = this.db.prepare(
      'SELECT * FROM strategy_allocations WHERE strategy_id = ?'
    ).get(strategyId) as any;
    return row ? this.rowToAllocation(row) : null;
  }

  /**
   * Get all strategy allocations.
   */
  listAllocations(): StrategyAllocation[] {
    const rows = this.db.prepare(
      'SELECT * FROM strategy_allocations ORDER BY strategy_id'
    ).all() as any[];
    return rows.map(r => this.rowToAllocation(r));
  }

  /**
   * Get allocation summary across all strategies.
   */
  getSummary(): AllocationSummary {
    const strategies = this.listAllocations();
    return {
      total_allocated: strategies.reduce((s, a) => s + a.allocated_capital, 0),
      total_used: strategies.reduce((s, a) => s + a.used_capital, 0),
      total_realized_pnl: strategies.reduce((s, a) => s + a.realized_pnl, 0),
      strategies,
    };
  }

  /**
   * Check if a strategy has enough remaining capital for an order.
   * Returns null if OK, or an error message if insufficient.
   */
  checkAllocation(strategyId: number, orderAmount: number): string | null {
    const alloc = this.getAllocation(strategyId);
    if (!alloc) return null; // No allocation set = no limit
    if (!alloc.enabled) return `Strategy ${strategyId} allocation is disabled`;
    const remaining = alloc.allocated_capital - alloc.used_capital;
    if (orderAmount > remaining) {
      return `Strategy ${strategyId} insufficient capital: need ${orderAmount.toFixed(0)}, remaining ${remaining.toFixed(0)} of ${alloc.allocated_capital.toFixed(0)}`;
    }
    return null;
  }

  /**
   * Record capital usage when an order is placed.
   */
  recordUsage(strategyId: number, amount: number): void {
    this.db.prepare(`
      UPDATE strategy_allocations
      SET used_capital = used_capital + @amount, updated_at = unixepoch()
      WHERE strategy_id = @sid
    `).run({ sid: strategyId, amount });
  }

  /**
   * Record realized P&L when a position is closed.
   * Also updates peak equity and max drawdown.
   */
  recordPnl(strategyId: number, pnl: number, releasedCapital: number): void {
    const alloc = this.getAllocation(strategyId);
    if (!alloc) return;

    const newUsed = Math.max(0, alloc.used_capital - releasedCapital);
    const newPnl = alloc.realized_pnl + pnl;
    const currentEquity = alloc.allocated_capital + newPnl;
    const newPeak = Math.max(alloc.peak_equity, currentEquity);
    const drawdown = newPeak > 0 ? (newPeak - currentEquity) / newPeak : 0;
    const newMaxDrawdown = Math.max(alloc.max_drawdown, drawdown);

    this.db.prepare(`
      UPDATE strategy_allocations
      SET used_capital = @used, realized_pnl = @pnl,
          peak_equity = @peak, max_drawdown = @dd, updated_at = unixepoch()
      WHERE strategy_id = @sid
    `).run({ sid: strategyId, used: newUsed, pnl: newPnl, peak: newPeak, dd: newMaxDrawdown });
  }

  /**
   * Enable or disable a strategy's allocation.
   */
  toggleAllocation(strategyId: number, enabled: boolean): void {
    this.db.prepare(`
      UPDATE strategy_allocations SET enabled = @enabled, updated_at = unixepoch()
      WHERE strategy_id = @sid
    `).run({ sid: strategyId, enabled: enabled ? 1 : 0 });
  }

  private rowToAllocation(row: any): StrategyAllocation {
    return {
      strategy_id: row.strategy_id,
      allocated_capital: row.allocated_capital,
      used_capital: row.used_capital,
      realized_pnl: row.realized_pnl,
      max_drawdown: row.max_drawdown,
      peak_equity: row.peak_equity,
      enabled: row.enabled === 1,
      updated_at: row.updated_at,
    };
  }
}
