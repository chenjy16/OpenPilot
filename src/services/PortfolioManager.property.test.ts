/**
 * Property-Based Tests for PortfolioManager
 *
 * Feature: quant-copilot-enhancement, Property 5: 投资组合指标数学正确性
 *
 * For any portfolio positions:
 * - total_market_value = Σ(quantity × current_price)
 * - total_pnl = Σ(quantity × (current_price - cost_price))
 * - Kelly fraction = (winRate * avgWin - (1-winRate) * avgLoss) / avgWin (when avgWin > 0)
 * - Sharpe ratio and max drawdown calculations should match standard formulas
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import {
  PortfolioManager,
  PortfolioPosition,
  computeSharpeRatio,
  computeMaxDrawdown,
  computeKellyFraction,
} from './PortfolioManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an in-memory SQLite database with the portfolio_positions table. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      quantity REAL NOT NULL,
      cost_price REAL NOT NULL,
      current_price REAL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const symbolArb = fc.string({ minLength: 1, maxLength: 5, unit: fc.constantFrom(
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
) });

/** Positive price (avoid 0 to prevent division-by-zero in pnl_pct). */
const priceArb = fc.double({ min: 0.01, max: 10000, noNaN: true, noDefaultInfinity: true });

/** Positive quantity. */
const quantityArb = fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true });

const positionArb: fc.Arbitrary<PortfolioPosition> = fc.record({
  symbol: symbolArb,
  quantity: quantityArb,
  cost_price: priceArb,
  current_price: priceArb,
});

const positionsArb = fc.array(positionArb, { minLength: 1, maxLength: 20 });

// ---------------------------------------------------------------------------
// Property 5: 投资组合指标数学正确性
// Feature: quant-copilot-enhancement, Property 5: 投资组合指标数学正确性
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
// ---------------------------------------------------------------------------

describe('Property 5: 投资组合指标数学正确性', () => {
  it('total_market_value = Σ(quantity × current_price)', () => {
    fc.assert(
      fc.property(positionsArb, (positions) => {
        const db = createTestDb();
        try {
          const pm = new PortfolioManager(db);
          for (const pos of positions) {
            pm.addPosition(pos);
          }

          const metrics = pm.getMetrics();
          const expected = positions.reduce(
            (sum, p) => sum + p.quantity * (p.current_price ?? p.cost_price),
            0,
          );

          expect(metrics.total_market_value).toBeCloseTo(expected, 6);
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('total_pnl = Σ(quantity × (current_price - cost_price))', () => {
    fc.assert(
      fc.property(positionsArb, (positions) => {
        const db = createTestDb();
        try {
          const pm = new PortfolioManager(db);
          for (const pos of positions) {
            pm.addPosition(pos);
          }

          const metrics = pm.getMetrics();
          const expected = positions.reduce(
            (sum, p) => sum + p.quantity * ((p.current_price ?? p.cost_price) - p.cost_price),
            0,
          );

          expect(metrics.total_pnl).toBeCloseTo(expected, 6);
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('total_pnl_pct = total_pnl / total_cost', () => {
    fc.assert(
      fc.property(positionsArb, (positions) => {
        const db = createTestDb();
        try {
          const pm = new PortfolioManager(db);
          for (const pos of positions) {
            pm.addPosition(pos);
          }

          const metrics = pm.getMetrics();
          const totalCost = positions.reduce((s, p) => s + p.quantity * p.cost_price, 0);
          const totalPnl = positions.reduce(
            (s, p) => s + p.quantity * ((p.current_price ?? p.cost_price) - p.cost_price),
            0,
          );
          const expectedPct = totalCost !== 0 ? totalPnl / totalCost : 0;

          expect(metrics.total_pnl_pct).toBeCloseTo(expectedPct, 6);
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Kelly fraction = (p * b - q) / b where b = avgWin/avgLoss', () => {
    const winRateArb = fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true });
    const avgWinArb = fc.double({ min: 0.01, max: 1000, noNaN: true, noDefaultInfinity: true });
    const avgLossArb = fc.double({ min: 0.01, max: 1000, noNaN: true, noDefaultInfinity: true });

    fc.assert(
      fc.property(symbolArb, winRateArb, avgWinArb, avgLossArb, (symbol, winRate, avgWin, avgLoss) => {
        const db = createTestDb();
        try {
          const pm = new PortfolioManager(db);
          const suggestion = pm.getKellySuggestion(symbol, winRate, avgWin, avgLoss);

          const p = winRate;
          const q = 1 - p;
          const b = avgWin / avgLoss;
          const expectedKelly = (p * b - q) / b;

          expect(suggestion.kelly_fraction).toBeCloseTo(expectedKelly, 10);
          expect(suggestion.symbol).toBe(symbol);
          expect(suggestion.suggested_position_pct).toBeGreaterThanOrEqual(0);
          expect(suggestion.suggested_position_pct).toBeLessThanOrEqual(100);
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Sharpe ratio matches standard formula: (mean - rf) / std * sqrt(252)', () => {
    const dailyReturnsArb = fc.array(
      fc.double({ min: -0.1, max: 0.1, noNaN: true, noDefaultInfinity: true }),
      { minLength: 2, maxLength: 252 },
    );
    const riskFreeArb = fc.double({ min: 0, max: 0.1, noNaN: true, noDefaultInfinity: true });

    fc.assert(
      fc.property(dailyReturnsArb, riskFreeArb, (returns, rf) => {
        const result = computeSharpeRatio(returns, rf);

        const n = returns.length;
        const mean = returns.reduce((s, r) => s + r, 0) / n;
        const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
        const std = Math.sqrt(variance);

        if (std === 0) {
          expect(result).toBeNull();
        } else {
          const rfDaily = rf / 252;
          const expected = ((mean - rfDaily) / std) * Math.sqrt(252);
          expect(result).toBeCloseTo(expected, 8);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Max drawdown is always <= 0 and matches peak-to-trough formula', () => {
    const valuesArb = fc.array(
      fc.double({ min: 0.01, max: 10000, noNaN: true, noDefaultInfinity: true }),
      { minLength: 2, maxLength: 500 },
    );

    fc.assert(
      fc.property(valuesArb, (values) => {
        const result = computeMaxDrawdown(values);

        expect(result).not.toBeNull();
        expect(result!).toBeLessThanOrEqual(0);

        // Recompute independently
        let peak = values[0];
        let expectedDd = 0;
        for (let i = 1; i < values.length; i++) {
          if (values[i] > peak) peak = values[i];
          const dd = (values[i] - peak) / peak;
          if (dd < expectedDd) expectedDd = dd;
        }

        expect(result).toBeCloseTo(expectedDd, 10);
      }),
      { numRuns: 100 },
    );
  });
});
