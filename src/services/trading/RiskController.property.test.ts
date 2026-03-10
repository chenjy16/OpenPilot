/**
 * Property-Based Tests for RiskController
 *
 * Feature: quant-trading-broker-integration, Property 2: 风控规则确定性执行
 * Validates: Requirements 3.1, 3.2, 3.3, 3.7
 *
 * For any order and any account state combination:
 * - Orders violating any enabled rule are rejected with specific violation details
 * - Orders not violating any enabled rule are passed
 * - Disabled rules don't affect the result
 * - Same inputs always produce the same result (determinism)
 */

import Database from 'better-sqlite3';
import * as fc from 'fast-check';
import { RiskController } from './RiskController';
import { initTradingTables } from './tradingSchema';
import type {
  TradingOrder,
  BrokerAccount,
  BrokerPosition,
  OrderStats,
  RiskRuleType,
} from './types';

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

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbSymbol = fc.constantFrom('AAPL', 'GOOG', 'TSLA', 'MSFT', 'AMZN', 'BABA', 'NVDA');

const arbTradingOrder: fc.Arbitrary<TradingOrder> = fc.record({
  id: fc.constant(1),
  local_order_id: fc.constant('test-001'),
  symbol: arbSymbol,
  side: fc.constantFrom<'buy' | 'sell'>('buy', 'sell'),
  order_type: fc.constantFrom<'market' | 'limit' | 'stop' | 'stop_limit'>(
    'market', 'limit', 'stop', 'stop_limit',
  ),
  quantity: fc.integer({ min: 1, max: 5000 }),
  price: fc.option(fc.double({ min: 0.01, max: 1000, noNaN: true }), { nil: undefined }),
  status: fc.constant<'pending'>('pending'),
  trading_mode: fc.constantFrom<'paper' | 'live'>('paper', 'live'),
  filled_quantity: fc.constant(0),
  created_at: fc.constant(Math.floor(Date.now() / 1000)),
  updated_at: fc.constant(Math.floor(Date.now() / 1000)),
});

const arbBrokerAccount: fc.Arbitrary<BrokerAccount> = fc.record({
  total_assets: fc.double({ min: 1000, max: 10_000_000, noNaN: true }),
  available_cash: fc.double({ min: 0, max: 5_000_000, noNaN: true }),
  frozen_cash: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
  currency: fc.constant('CNY'),
});

const arbBrokerPosition: fc.Arbitrary<BrokerPosition> = fc.record({
  symbol: arbSymbol,
  quantity: fc.integer({ min: 1, max: 10000 }),
  avg_cost: fc.double({ min: 1, max: 1000, noNaN: true }),
  current_price: fc.double({ min: 1, max: 1000, noNaN: true }),
  market_value: fc.double({ min: 0, max: 5_000_000, noNaN: true }),
});

const arbOrderStats: fc.Arbitrary<OrderStats> = fc.record({
  total_orders: fc.integer({ min: 0, max: 200 }),
  filled_orders: fc.integer({ min: 0, max: 100 }),
  cancelled_orders: fc.integer({ min: 0, max: 50 }),
  total_filled_amount: fc.double({ min: 0, max: 2_000_000, noNaN: true }),
});

// ---------------------------------------------------------------------------
// Property 2: 风控规则确定性执行
// ---------------------------------------------------------------------------

describe('RiskController Property Tests', () => {
  /**
   * Feature: quant-trading-broker-integration, Property 2: 风控规则确定性执行
   * Validates: Requirements 3.1, 3.2, 3.3, 3.7
   */
  describe('Property 2: Risk rule deterministic execution', () => {
    it('determinism — same inputs always produce the same result', () => {
      fc.assert(
        fc.property(
          arbTradingOrder,
          arbBrokerAccount,
          fc.array(arbBrokerPosition, { minLength: 0, maxLength: 5 }),
          arbOrderStats,
          (order, account, positions, stats) => {
            const db = createTestDb();
            try {
              const rc = new RiskController(db);
              rc.initDefaultRules();

              const result1 = rc.checkOrder(order, account, positions, stats);
              const result2 = rc.checkOrder(order, account, positions, stats);

              // Same passed/failed outcome
              expect(result1.passed).toBe(result2.passed);
              // Same number of violations
              expect(result1.violations.length).toBe(result2.violations.length);
              // Same violation details
              for (let i = 0; i < result1.violations.length; i++) {
                expect(result1.violations[i].rule_type).toBe(result2.violations[i].rule_type);
                expect(result1.violations[i].threshold).toBe(result2.violations[i].threshold);
                expect(result1.violations[i].current_value).toBe(result2.violations[i].current_value);
              }
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('orders violating enabled rules are rejected with specific violation details', () => {
      fc.assert(
        fc.property(
          arbTradingOrder,
          arbBrokerAccount,
          fc.array(arbBrokerPosition, { minLength: 0, maxLength: 5 }),
          arbOrderStats,
          (order, account, positions, stats) => {
            const db = createTestDb();
            try {
              const rc = new RiskController(db);
              rc.initDefaultRules();

              const result = rc.checkOrder(order, account, positions, stats);

              // Manually compute which rules should be violated
              const rules = rc.listRules().filter((r) => r.enabled);
              const expectedViolatedTypes: RiskRuleType[] = [];
              const orderAmount = order.quantity * (order.price || 0);

              for (const rule of rules) {
                switch (rule.rule_type) {
                  case 'max_order_amount':
                    if (orderAmount > rule.threshold) expectedViolatedTypes.push(rule.rule_type);
                    break;
                  case 'max_daily_amount': {
                    const dailyTotal = stats.total_filled_amount + orderAmount;
                    if (dailyTotal > rule.threshold) expectedViolatedTypes.push(rule.rule_type);
                    break;
                  }
                  case 'max_position_ratio': {
                    if (account.total_assets > 0) {
                      const pos = positions.find((p) => p.symbol === order.symbol);
                      const posValue = pos ? pos.market_value : 0;
                      const ratio = posValue / account.total_assets;
                      if (ratio > rule.threshold) expectedViolatedTypes.push(rule.rule_type);
                    }
                    break;
                  }
                  case 'max_daily_loss': {
                    const totalPositionValue = positions.reduce((s, p) => s + p.market_value, 0);
                    const totalPositionCost = positions.reduce((s, p) => s + p.avg_cost * p.quantity, 0);
                    const unrealizedLoss = Math.max(0, totalPositionCost - totalPositionValue);
                    if (unrealizedLoss > rule.threshold) expectedViolatedTypes.push(rule.rule_type);
                    break;
                  }
                  case 'max_daily_trades':
                    if (stats.total_orders >= rule.threshold) expectedViolatedTypes.push(rule.rule_type);
                    break;
                }
              }

              // If any rule is violated, result should be rejected
              if (expectedViolatedTypes.length > 0) {
                expect(result.passed).toBe(false);
                // Each expected violation should appear in the result
                const actualTypes = result.violations.map((v) => v.rule_type);
                for (const expected of expectedViolatedTypes) {
                  expect(actualTypes).toContain(expected);
                }
              }

              // If no rule is violated, result should pass
              if (expectedViolatedTypes.length === 0) {
                expect(result.passed).toBe(true);
                expect(result.violations).toHaveLength(0);
              }

              // Every violation should have specific details
              for (const v of result.violations) {
                expect(v.rule_type).toBeDefined();
                expect(v.rule_name).toBeDefined();
                expect(typeof v.threshold).toBe('number');
                expect(typeof v.current_value).toBe('number');
                expect(typeof v.message).toBe('string');
                expect(v.message.length).toBeGreaterThan(0);
              }
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('disabled rules do not affect the result', () => {
      fc.assert(
        fc.property(
          arbTradingOrder,
          arbBrokerAccount,
          fc.array(arbBrokerPosition, { minLength: 0, maxLength: 5 }),
          arbOrderStats,
          fc.constantFrom<RiskRuleType>(
            'max_order_amount', 'max_daily_amount', 'max_position_ratio',
            'max_daily_loss', 'max_daily_trades',
          ),
          (order, account, positions, stats, ruleToDisable) => {
            const db = createTestDb();
            try {
              const rc = new RiskController(db);
              rc.initDefaultRules();

              // Get result with all rules enabled
              const resultAllEnabled = rc.checkOrder(order, account, positions, stats);

              // Disable one rule
              const rules = rc.listRules();
              const targetRule = rules.find((r) => r.rule_type === ruleToDisable);
              if (!targetRule) return;
              rc.toggleRule(targetRule.id!, false);

              // Get result with one rule disabled
              const resultOneDisabled = rc.checkOrder(order, account, positions, stats);

              // The disabled rule should NOT appear in violations
              const disabledViolation = resultOneDisabled.violations.find(
                (v) => v.rule_type === ruleToDisable,
              );
              expect(disabledViolation).toBeUndefined();

              // All violations from the disabled result should also exist in the all-enabled result
              // (disabling a rule can only remove violations, not add new ones)
              for (const v of resultOneDisabled.violations) {
                const matchInFull = resultAllEnabled.violations.find(
                  (fv) => fv.rule_type === v.rule_type,
                );
                expect(matchInFull).toBeDefined();
              }

              // If the disabled rule was violated when enabled, the disabled result
              // should have one fewer violation of that type
              const wasViolated = resultAllEnabled.violations.some(
                (v) => v.rule_type === ruleToDisable,
              );
              if (wasViolated) {
                expect(resultOneDisabled.violations.length).toBeLessThan(
                  resultAllEnabled.violations.length,
                );
              } else {
                // If the disabled rule wasn't violated anyway, results should be identical
                expect(resultOneDisabled.violations.length).toBe(
                  resultAllEnabled.violations.length,
                );
              }
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('all rules disabled means all orders pass', () => {
      fc.assert(
        fc.property(
          arbTradingOrder,
          arbBrokerAccount,
          fc.array(arbBrokerPosition, { minLength: 0, maxLength: 5 }),
          arbOrderStats,
          (order, account, positions, stats) => {
            const db = createTestDb();
            try {
              const rc = new RiskController(db);
              rc.initDefaultRules();

              // Disable all rules
              const rules = rc.listRules();
              for (const rule of rules) {
                rc.toggleRule(rule.id!, false);
              }

              const result = rc.checkOrder(order, account, positions, stats);
              expect(result.passed).toBe(true);
              expect(result.violations).toHaveLength(0);
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
