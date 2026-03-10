// Feature: auto-quant-trading, Property 4: 止盈止损触发判断正确性
/**
 * Property-based tests for StopLossManager — stop-loss / take-profit trigger correctness.
 *
 * Property 4:
 * For any stop_loss, take_profit (stop_loss < take_profit) and currentPrice:
 * - currentPrice <= stop_loss  → checkStopLossTrigger returns 'stop_loss'
 * - currentPrice >= take_profit → checkStopLossTrigger returns 'take_profit'
 * - stop_loss < currentPrice < take_profit → returns null
 *
 * **Validates: Requirements 4.3, 4.4**
 */

import * as fc from 'fast-check';
import { checkStopLossTrigger } from './StopLossManager';

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generate stop_loss and take_profit where stop_loss < take_profit.
 * We generate stop_loss first, then add a positive delta for take_profit.
 */
const arbStopLossAndTakeProfit = fc
  .tuple(
    fc.double({ min: 0.01, max: 999_999, noNaN: true }),  // stop_loss
    fc.double({ min: 0.01, max: 1_000_000, noNaN: true }), // delta
  )
  .map(([stopLoss, delta]) => ({
    stopLoss,
    takeProfit: stopLoss + delta,
  }));

// ─── Property 4: 止盈止损触发判断正确性 ────────────────────────────────────

describe('StopLossManager Property Tests', () => {
  // **Validates: Requirements 4.3**
  describe('currentPrice <= stop_loss triggers stop_loss', () => {
    it('returns "stop_loss" when currentPrice is at or below stop_loss', () => {
      fc.assert(
        fc.property(
          arbStopLossAndTakeProfit,
          fc.double({ min: 0, max: 1, noNaN: true }), // fraction: 0 = at stop_loss, >0 = below
          ({ stopLoss, takeProfit }, fraction) => {
            // currentPrice ranges from 0 to stop_loss (inclusive)
            const currentPrice = stopLoss * fraction;

            const result = checkStopLossTrigger(currentPrice, stopLoss, takeProfit);
            expect(result).toBe('stop_loss');
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // **Validates: Requirements 4.4**
  describe('currentPrice >= take_profit triggers take_profit', () => {
    it('returns "take_profit" when currentPrice is at or above take_profit', () => {
      fc.assert(
        fc.property(
          arbStopLossAndTakeProfit,
          fc.double({ min: 0, max: 1_000_000, noNaN: true }), // extra above take_profit
          ({ stopLoss, takeProfit }, extra) => {
            const currentPrice = takeProfit + extra;

            const result = checkStopLossTrigger(currentPrice, stopLoss, takeProfit);
            expect(result).toBe('take_profit');
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // **Validates: Requirements 4.3, 4.4**
  describe('stop_loss < currentPrice < take_profit returns null', () => {
    it('returns null when currentPrice is strictly between stop_loss and take_profit', () => {
      fc.assert(
        fc.property(
          arbStopLossAndTakeProfit.filter(({ stopLoss, takeProfit }) => takeProfit - stopLoss > 0.02),
          fc.double({ min: 0.01, max: 0.99, noNaN: true }), // interpolation factor
          ({ stopLoss, takeProfit }, t) => {
            // Interpolate strictly between stop_loss and take_profit
            const currentPrice = stopLoss + t * (takeProfit - stopLoss);

            // Guard: ensure strictly between (avoid floating-point edge landing on boundaries)
            fc.pre(currentPrice > stopLoss && currentPrice < takeProfit);

            const result = checkStopLossTrigger(currentPrice, stopLoss, takeProfit);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});


// Feature: auto-quant-trading, Property 10: 止盈止损监控记录持久化往返
/**
 * Property 10: 止盈止损监控记录持久化往返
 *
 * For any set of active StopLossRecords, after writing to stop_loss_records table
 * and reading back via restoreFromDb, the records should match
 * (symbol, stop_loss, take_profit, order_id, status are all consistent).
 *
 * **Validates: Requirements 4.8**
 */

import Database from 'better-sqlite3';
import { StopLossManager } from './StopLossManager';
import { initTradingTables } from './tradingSchema';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createFreshDb(): Database.Database {
  const db = new Database(':memory:');
  // Stub FK-referenced tables
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  return db;
}

/** Insert a test order into trading_orders and return its id (needed for FK constraint). */
function insertOrder(db: Database.Database, symbol: string): number {
  const result = db.prepare(`
    INSERT INTO trading_orders (local_order_id, symbol, side, order_type, quantity, status, trading_mode, filled_quantity, created_at, updated_at)
    VALUES (@local_order_id, @symbol, 'buy', 'market', 100, 'filled', 'paper', 100, @ts, @ts)
  `).run({
    local_order_id: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    ts: Math.floor(Date.now() / 1000),
  });
  return Number(result.lastInsertRowid);
}

function makeMockGateway() {
  return { placeOrder: jest.fn(), getOrder: jest.fn() } as any;
}

function makeMockNotifier() {
  return { notifyStopLossTriggered: jest.fn(), notifyUrgentAlert: jest.fn() } as any;
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const arbSymbol = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.'.split('')), { minLength: 1, maxLength: 10 })
  .map((chars) => chars.join(''));

const arbStopLossRecord = fc
  .tuple(
    arbSymbol,
    fc.double({ min: 0.01, max: 999_999, noNaN: true, noDefaultInfinity: true }), // entry_price
    fc.double({ min: 0.01, max: 999_999, noNaN: true, noDefaultInfinity: true }), // stop_loss
    fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true }), // delta for take_profit
  )
  .map(([symbol, entryPrice, stopLoss, delta]) => ({
    symbol,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit: stopLoss + delta, // ensure take_profit > stop_loss
    side: 'buy' as const,
  }));

// ─── Property 10 Tests ─────────────────────────────────────────────────────

describe('StopLossManager Property 10: 止盈止损监控记录持久化往返', () => {
  // **Validates: Requirements 4.8**
  it('records survive register → restoreFromDb round-trip with matching fields', () => {
    fc.assert(
      fc.property(
        fc.array(arbStopLossRecord, { minLength: 1, maxLength: 5 }),
        (records) => {
          const db = createFreshDb();
          const mgr = new StopLossManager(db, makeMockGateway(), makeMockNotifier());

          // Register each record (insert an order first for FK)
          const registered = records.map((rec) => {
            const orderId = insertOrder(db, rec.symbol);
            return mgr.register({
              order_id: orderId,
              symbol: rec.symbol,
              side: rec.side,
              entry_price: rec.entry_price,
              stop_loss: rec.stop_loss,
              take_profit: rec.take_profit,
            });
          });

          // Create a fresh manager to simulate restart
          const mgr2 = new StopLossManager(db, makeMockGateway(), makeMockNotifier());
          const restored = mgr2.restoreFromDb();

          // Same count
          expect(restored.length).toBe(registered.length);

          // Sort both by id for stable comparison
          const sortById = (a: any, b: any) => a.id - b.id;
          const regSorted = [...registered].sort(sortById);
          const resSorted = [...restored].sort(sortById);

          for (let i = 0; i < regSorted.length; i++) {
            expect(resSorted[i].symbol).toBe(regSorted[i].symbol);
            expect(resSorted[i].stop_loss).toBe(regSorted[i].stop_loss);
            expect(resSorted[i].take_profit).toBe(regSorted[i].take_profit);
            expect(resSorted[i].order_id).toBe(regSorted[i].order_id);
            expect(resSorted[i].status).toBe('active');
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});
