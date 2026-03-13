/**
 * Property-based tests for extended RiskController rules.
 *
 * Feature: multi-strategy-trading, Property 9: 最大持仓数风控
 * Validates: Requirements 7.2, 7.3, 7.4
 */

import fc from 'fast-check';
import Database from 'better-sqlite3';
import { RiskController } from '../RiskController';
import { initTradingTables } from '../tradingSchema';
import type { TradingOrder, BrokerAccount, BrokerPosition, OrderStats } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  return db;
}

function makeOrder(overrides?: Partial<TradingOrder>): TradingOrder {
  return {
    id: 1,
    local_order_id: 'test-001',
    symbol: 'TEST',
    side: 'buy',
    order_type: 'limit',
    quantity: 10,
    price: 100,
    status: 'pending',
    trading_mode: 'paper',
    filled_quantity: 0,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function makeAccount(overrides?: Partial<BrokerAccount>): BrokerAccount {
  return {
    total_assets: 1_000_000,
    available_cash: 500_000,
    frozen_cash: 0,
    currency: 'USD',
    ...overrides,
  };
}

function makeStats(): OrderStats {
  return { total_orders: 0, filled_orders: 0, cancelled_orders: 0, total_filled_amount: 0 };
}

/** Build an array of active BrokerPositions with quantity > 0. */
function buildPositions(count: number): BrokerPosition[] {
  const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return Array.from({ length: count }, (_, i) => ({
    symbol: symbols[i % symbols.length] + i,
    quantity: 100,
    avg_cost: 50,
    current_price: 50,
    market_value: 5000,
  }));
}

// ---------------------------------------------------------------------------
// Property 9: 最大持仓数风控
// ---------------------------------------------------------------------------

describe('Property 9: 最大持仓数风控', () => {
  let db: Database.Database;
  let rc: RiskController;

  beforeEach(() => {
    db = createTestDb();
    rc = new RiskController(db);
    rc.initDefaultRules();
    // Disable all rules except max_positions to isolate the property under test
    const rules = rc.listRules();
    for (const rule of rules) {
      if (rule.rule_type !== 'max_positions') {
        rc.toggleRule(rule.id!, false);
      }
    }
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * For any position count n and threshold t (1 ≤ t ≤ 10),
   * when n ≥ t, a buy order MUST be rejected by the max_positions rule.
   */
  it('should reject buy orders when position count >= threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),  // threshold
        fc.integer({ min: 0, max: 10 }),  // position count
        (threshold, positionCount) => {
          // Only test the case where positionCount >= threshold
          fc.pre(positionCount >= threshold);

          // Set the threshold
          const rule = rc.listRules().find((r) => r.rule_type === 'max_positions')!;
          rc.updateRule(rule.id!, { threshold });

          const order = makeOrder({ side: 'buy' });
          const positions = buildPositions(positionCount);
          const result = rc.checkOrder(order, makeAccount(), positions, makeStats());

          const violation = result.violations.find((v) => v.rule_type === 'max_positions');
          return violation !== undefined && violation.current_value === positionCount;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * For any position count n and threshold t (1 ≤ t ≤ 10),
   * when n < t, a buy order MUST pass the max_positions rule.
   */
  it('should allow buy orders when position count < threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),  // threshold
        fc.integer({ min: 0, max: 10 }),  // position count
        (threshold, positionCount) => {
          // Only test the case where positionCount < threshold
          fc.pre(positionCount < threshold);

          const rule = rc.listRules().find((r) => r.rule_type === 'max_positions')!;
          rc.updateRule(rule.id!, { threshold });

          const order = makeOrder({ side: 'buy' });
          const positions = buildPositions(positionCount);
          const result = rc.checkOrder(order, makeAccount(), positions, makeStats());

          const violation = result.violations.find((v) => v.rule_type === 'max_positions');
          return violation === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * Sell orders must always bypass the max_positions rule regardless of position count.
   */
  it('should always allow sell orders regardless of position count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),  // threshold
        fc.integer({ min: 0, max: 10 }),  // position count
        (threshold, positionCount) => {
          const rule = rc.listRules().find((r) => r.rule_type === 'max_positions')!;
          rc.updateRule(rule.id!, { threshold });

          const order = makeOrder({ side: 'sell' });
          const positions = buildPositions(positionCount);
          const result = rc.checkOrder(order, makeAccount(), positions, makeStats());

          const violation = result.violations.find((v) => v.rule_type === 'max_positions');
          return violation === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * Dynamic adjustment: effective threshold = floor(base_threshold × risk_multiplier).
   * In crisis mode (multiplier = 0.25), high_vol (0.5), normal (1.0), low_vol (1.5).
   * The rule should use the adjusted threshold for comparison.
   */
  it('should apply dynamic risk adjustment: threshold = floor(base × multiplier)', () => {
    // Regime configs: [drawdown, expected_multiplier]
    const regimes: Array<[number, number]> = [
      [0.20, 0.25],  // crisis
      [0.10, 0.5],   // high_vol
      [0.05, 1.0],   // normal
      [0.01, 1.5],   // low_vol (drawdown < 0.02, no VIX)
    ];

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),  // base threshold
        fc.integer({ min: 0, max: 10 }),  // position count
        fc.integer({ min: 0, max: regimes.length - 1 }),  // regime index
        (baseThreshold, positionCount, regimeIdx) => {
          const [drawdown, expectedMultiplier] = regimes[regimeIdx];

          // Reset dynamic risk state
          rc.updateDynamicRisk(drawdown);

          const rule = rc.listRules().find((r) => r.rule_type === 'max_positions')!;
          rc.updateRule(rule.id!, { threshold: baseThreshold });

          const effectiveThreshold = Math.floor(baseThreshold * expectedMultiplier);

          const order = makeOrder({ side: 'buy' });
          const positions = buildPositions(positionCount);
          const result = rc.checkOrder(order, makeAccount(), positions, makeStats());

          const violation = result.violations.find((v) => v.rule_type === 'max_positions');

          if (positionCount >= effectiveThreshold) {
            // Should be rejected
            return violation !== undefined && violation.threshold === effectiveThreshold;
          } else {
            // Should pass
            return violation === undefined;
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * Positions with quantity = 0 should not count toward the position limit.
   */
  it('should not count positions with zero quantity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),   // active positions
        fc.integer({ min: 0, max: 5 }),   // zero-quantity positions
        fc.integer({ min: 1, max: 10 }),  // threshold
        (activeCount, zeroCount, threshold) => {
          const rule = rc.listRules().find((r) => r.rule_type === 'max_positions')!;
          rc.updateRule(rule.id!, { threshold });

          const activePositions = buildPositions(activeCount);
          const zeroPositions: BrokerPosition[] = Array.from({ length: zeroCount }, (_, i) => ({
            symbol: `ZERO${i}`,
            quantity: 0,
            avg_cost: 100,
            current_price: 100,
            market_value: 0,
          }));

          const allPositions = [...activePositions, ...zeroPositions];
          const order = makeOrder({ side: 'buy' });
          const result = rc.checkOrder(order, makeAccount(), allPositions, makeStats());

          const violation = result.violations.find((v) => v.rule_type === 'max_positions');

          if (activeCount >= threshold) {
            return violation !== undefined && violation.current_value === activeCount;
          } else {
            return violation === undefined;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 10: 周度止损保护
// ---------------------------------------------------------------------------

describe('Property 10: 周度止损保护', () => {
  let db: Database.Database;
  let rc: RiskController;

  /** Get the current Monday 00:00 UTC epoch for weekly_loss_tracker */
  function getCurrentMondayEpoch(): number {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
    );
    return Math.floor(monday.getTime() / 1000);
  }

  /** Insert or update the weekly_loss_tracker row with given cumulative loss */
  function setWeeklyLoss(cumulativeLoss: number): void {
    const mondayEpoch = getCurrentMondayEpoch();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO weekly_loss_tracker (id, week_start, cumulative_loss, updated_at)
       VALUES (1, @week_start, @cumulative_loss, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         week_start = @week_start,
         cumulative_loss = @cumulative_loss,
         updated_at = @updated_at`,
    ).run({
      week_start: mondayEpoch,
      cumulative_loss: cumulativeLoss,
      updated_at: now,
    });
  }

  beforeEach(() => {
    db = createTestDb();
    rc = new RiskController(db);
    rc.initDefaultRules();
    // Disable all rules except max_weekly_loss to isolate the property under test
    const rules = rc.listRules();
    for (const rule of rules) {
      if (rule.rule_type !== 'max_weekly_loss') {
        rc.toggleRule(rule.id!, false);
      }
    }
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * For any total_assets A and cumulative_loss L,
   * when L > A × 0.10, buy orders MUST be rejected by the max_weekly_loss rule.
   */
  it('should reject buy orders when cumulative_loss > total_assets × 10%', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000, max: 1_000_000, noNaN: true }),  // total_assets
        fc.double({ min: 0, max: 200_000, noNaN: true }),        // cumulative_loss
        (totalAssets, cumulativeLoss) => {
          const maxLoss = totalAssets * 0.10;
          // Only test the case where cumulative_loss > maxLoss
          fc.pre(cumulativeLoss > maxLoss);

          setWeeklyLoss(cumulativeLoss);

          const order = makeOrder({ side: 'buy' });
          const account = makeAccount({ total_assets: totalAssets });
          const result = rc.checkOrder(order, account, [], makeStats());

          const violation = result.violations.find((v) => v.rule_type === 'max_weekly_loss');
          return violation !== undefined && violation.current_value === cumulativeLoss;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * For any total_assets A and cumulative_loss L,
   * when L <= A × 0.10, buy orders MUST pass the max_weekly_loss rule.
   */
  it('should allow buy orders when cumulative_loss <= total_assets × 10%', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000, max: 1_000_000, noNaN: true }),  // total_assets
        fc.double({ min: 0, max: 200_000, noNaN: true }),        // cumulative_loss
        (totalAssets, cumulativeLoss) => {
          const maxLoss = totalAssets * 0.10;
          // Only test the case where cumulative_loss <= maxLoss
          fc.pre(cumulativeLoss <= maxLoss);

          setWeeklyLoss(cumulativeLoss);

          const order = makeOrder({ side: 'buy' });
          const account = makeAccount({ total_assets: totalAssets });
          const result = rc.checkOrder(order, account, [], makeStats());

          const violation = result.violations.find((v) => v.rule_type === 'max_weekly_loss');
          return violation === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * Sell orders must always bypass the max_weekly_loss rule regardless of cumulative loss.
   */
  it('should always allow sell orders regardless of cumulative loss', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000, max: 1_000_000, noNaN: true }),  // total_assets
        fc.double({ min: 0, max: 200_000, noNaN: true }),        // cumulative_loss
        (totalAssets, cumulativeLoss) => {
          setWeeklyLoss(cumulativeLoss);

          const order = makeOrder({ side: 'sell' });
          const account = makeAccount({ total_assets: totalAssets });
          const result = rc.checkOrder(order, account, [], makeStats());

          const violation = result.violations.find((v) => v.rule_type === 'max_weekly_loss');
          return violation === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });
});
