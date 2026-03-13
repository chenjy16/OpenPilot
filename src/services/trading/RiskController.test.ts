import Database from 'better-sqlite3';
import { RiskController } from './RiskController';
import { initTradingTables } from './tradingSchema';
import type { TradingOrder, BrokerAccount, BrokerPosition, OrderStats } from './types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)`);
  db.exec(`CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)`);
  initTradingTables(db);
  return db;
}

function makeOrder(overrides?: Partial<TradingOrder>): TradingOrder {
  return {
    id: 1,
    local_order_id: 'test-001',
    symbol: 'AAPL',
    side: 'buy',
    order_type: 'limit',
    quantity: 100,
    price: 150,
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
    total_assets: 1000000,
    available_cash: 500000,
    frozen_cash: 0,
    currency: 'CNY',
    ...overrides,
  };
}

function makeStats(overrides?: Partial<OrderStats>): OrderStats {
  return {
    total_orders: 0,
    filled_orders: 0,
    cancelled_orders: 0,
    total_filled_amount: 0,
    ...overrides,
  };
}

describe('RiskController', () => {
  let db: Database.Database;
  let rc: RiskController;

  beforeEach(() => {
    db = createTestDb();
    rc = new RiskController(db);
    rc.initDefaultRules();
  });

  afterEach(() => {
    db.close();
  });

  // -----------------------------------------------------------------------
  // initDefaultRules
  // -----------------------------------------------------------------------
  describe('initDefaultRules', () => {
    it('should insert 7 default rules', () => {
      const rules = rc.listRules();
      expect(rules).toHaveLength(7);
      const types = rules.map((r) => r.rule_type);
      expect(types).toContain('max_order_amount');
      expect(types).toContain('max_daily_amount');
      expect(types).toContain('max_position_ratio');
      expect(types).toContain('max_daily_loss');
      expect(types).toContain('max_daily_trades');
      expect(types).toContain('max_positions');
      expect(types).toContain('max_weekly_loss');
    });

    it('should not duplicate rules on repeated calls', () => {
      rc.initDefaultRules(); // second call
      const rules = rc.listRules();
      expect(rules).toHaveLength(7);
    });

    it('should set correct default thresholds', () => {
      const rules = rc.listRules();
      const byType = Object.fromEntries(rules.map((r) => [r.rule_type, r]));
      expect(byType['max_order_amount'].threshold).toBe(100000);
      expect(byType['max_daily_amount'].threshold).toBe(500000);
      expect(byType['max_position_ratio'].threshold).toBe(0.3);
      expect(byType['max_daily_loss'].threshold).toBe(50000);
      expect(byType['max_daily_trades'].threshold).toBe(50);
      expect(byType['max_positions'].threshold).toBe(3);
      expect(byType['max_weekly_loss'].threshold).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // listRules
  // -----------------------------------------------------------------------
  describe('listRules', () => {
    it('should return all rules ordered by id', () => {
      const rules = rc.listRules();
      expect(rules.length).toBeGreaterThan(0);
      for (let i = 1; i < rules.length; i++) {
        expect(rules[i].id!).toBeGreaterThan(rules[i - 1].id!);
      }
    });

    it('should return rules with enabled as boolean', () => {
      const rules = rc.listRules();
      for (const rule of rules) {
        expect(typeof rule.enabled).toBe('boolean');
      }
    });
  });

  // -----------------------------------------------------------------------
  // updateRule
  // -----------------------------------------------------------------------
  describe('updateRule', () => {
    it('should update threshold', () => {
      const rules = rc.listRules();
      const rule = rules[0];
      const updated = rc.updateRule(rule.id!, { threshold: 200000 });
      expect(updated.threshold).toBe(200000);
      expect(updated.updated_at).toBeGreaterThanOrEqual(rule.updated_at!);
    });

    it('should update rule_name', () => {
      const rules = rc.listRules();
      const rule = rules[0];
      const updated = rc.updateRule(rule.id!, { rule_name: 'New Name' });
      expect(updated.rule_name).toBe('New Name');
    });

    it('should update enabled field', () => {
      const rules = rc.listRules();
      const rule = rules[0];
      const updated = rc.updateRule(rule.id!, { enabled: false });
      expect(updated.enabled).toBe(false);
    });

    it('should throw for non-existent rule', () => {
      expect(() => rc.updateRule(9999, { threshold: 1 })).toThrow(/not found/);
    });
  });

  // -----------------------------------------------------------------------
  // toggleRule
  // -----------------------------------------------------------------------
  describe('toggleRule', () => {
    it('should disable a rule', () => {
      const rules = rc.listRules();
      const rule = rules[0];
      rc.toggleRule(rule.id!, false);
      const updated = rc.listRules().find((r) => r.id === rule.id);
      expect(updated!.enabled).toBe(false);
    });

    it('should re-enable a rule', () => {
      const rules = rc.listRules();
      const rule = rules[0];
      rc.toggleRule(rule.id!, false);
      rc.toggleRule(rule.id!, true);
      const updated = rc.listRules().find((r) => r.id === rule.id);
      expect(updated!.enabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // checkOrder — passing scenarios
  // -----------------------------------------------------------------------
  describe('checkOrder — passing', () => {
    it('should pass when order is within all limits', () => {
      const order = makeOrder({ quantity: 10, price: 100 }); // amount = 1000
      const result = rc.checkOrder(order, makeAccount(), [], makeStats());
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should pass when all rules are disabled', () => {
      const rules = rc.listRules();
      for (const rule of rules) {
        rc.toggleRule(rule.id!, false);
      }
      // Order that would normally violate max_order_amount
      const order = makeOrder({ quantity: 10000, price: 100 }); // amount = 1,000,000
      const result = rc.checkOrder(order, makeAccount(), [], makeStats());
      expect(result.passed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // checkOrder — failing scenarios
  // -----------------------------------------------------------------------
  describe('checkOrder — failing', () => {
    it('should fail on max_order_amount violation', () => {
      const order = makeOrder({ quantity: 1000, price: 200 }); // amount = 200,000 > 100,000
      const result = rc.checkOrder(order, makeAccount(), [], makeStats());
      expect(result.passed).toBe(false);
      const v = result.violations.find((v) => v.rule_type === 'max_order_amount');
      expect(v).toBeDefined();
      expect(v!.current_value).toBe(200000);
      expect(v!.threshold).toBe(100000);
    });

    it('should fail on max_daily_amount violation', () => {
      const order = makeOrder({ quantity: 100, price: 100 }); // amount = 10,000
      const stats = makeStats({ total_filled_amount: 495000 }); // 495000 + 10000 = 505000 > 500000
      const result = rc.checkOrder(order, makeAccount(), [], stats);
      expect(result.passed).toBe(false);
      const v = result.violations.find((v) => v.rule_type === 'max_daily_amount');
      expect(v).toBeDefined();
    });

    it('should fail on max_position_ratio violation', () => {
      const order = makeOrder({ symbol: 'AAPL', quantity: 10, price: 100 });
      const account = makeAccount({ total_assets: 1000000 });
      const positions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 1000, avg_cost: 100, current_price: 400, market_value: 400000 },
      ];
      // ratio = 400000 / 1000000 = 0.4 > 0.3
      const result = rc.checkOrder(order, account, positions, makeStats());
      expect(result.passed).toBe(false);
      const v = result.violations.find((v) => v.rule_type === 'max_position_ratio');
      expect(v).toBeDefined();
      expect(v!.current_value).toBeCloseTo(0.4);
    });

    it('should fail on max_daily_loss violation', () => {
      const order = makeOrder({ quantity: 10, price: 100 });
      const positions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 100, avg_cost: 200, current_price: 100, market_value: 10000 },
      ];
      // cost = 100 * 200 = 20000, value = 10000, loss = 10000
      // But we need loss > 50000 to trigger
      const bigPositions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 1000, avg_cost: 200, current_price: 100, market_value: 100000 },
      ];
      // cost = 1000 * 200 = 200000, value = 100000, loss = 100000 > 50000
      const result = rc.checkOrder(order, makeAccount(), bigPositions, makeStats());
      expect(result.passed).toBe(false);
      const v = result.violations.find((v) => v.rule_type === 'max_daily_loss');
      expect(v).toBeDefined();
    });

    it('should fail on max_daily_trades violation', () => {
      const order = makeOrder({ quantity: 10, price: 100 });
      const stats = makeStats({ total_orders: 50 }); // 50 >= 50
      const result = rc.checkOrder(order, makeAccount(), [], stats);
      expect(result.passed).toBe(false);
      const v = result.violations.find((v) => v.rule_type === 'max_daily_trades');
      expect(v).toBeDefined();
    });

    it('should report multiple violations at once', () => {
      // Violate both max_order_amount and max_daily_trades
      const order = makeOrder({ quantity: 1000, price: 200 }); // amount = 200,000 > 100,000
      const stats = makeStats({ total_orders: 60 }); // 60 >= 50
      const result = rc.checkOrder(order, makeAccount(), [], stats);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
      const types = result.violations.map((v) => v.rule_type);
      expect(types).toContain('max_order_amount');
      expect(types).toContain('max_daily_trades');
    });
  });

  // -----------------------------------------------------------------------
  // checkOrder — edge cases
  // -----------------------------------------------------------------------
  describe('checkOrder — edge cases', () => {
    it('should handle market order with no price (price=0)', () => {
      const order = makeOrder({ order_type: 'market', price: undefined, quantity: 100 });
      // amount = 100 * 0 = 0, should pass max_order_amount
      const result = rc.checkOrder(order, makeAccount(), [], makeStats());
      expect(result.passed).toBe(true);
    });

    it('should handle zero total_assets for position ratio check', () => {
      const order = makeOrder({ quantity: 10, price: 100 });
      const account = makeAccount({ total_assets: 0 });
      const positions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 100, avg_cost: 100, current_price: 100, market_value: 10000 },
      ];
      // total_assets = 0, should skip position ratio check
      const result = rc.checkOrder(order, account, positions, makeStats());
      // Should not have position_ratio violation
      const v = result.violations.find((v) => v.rule_type === 'max_position_ratio');
      expect(v).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // checkOrder — max_positions rule
  // -----------------------------------------------------------------------
  describe('checkOrder — max_positions', () => {
    it('should reject buy order when positions >= threshold (default 3)', () => {
      const order = makeOrder({ side: 'buy', quantity: 10, price: 100 });
      const positions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 100, avg_cost: 150, current_price: 150, market_value: 15000 },
        { symbol: 'GOOG', quantity: 50, avg_cost: 100, current_price: 100, market_value: 5000 },
        { symbol: 'MSFT', quantity: 80, avg_cost: 200, current_price: 200, market_value: 16000 },
      ];
      const result = rc.checkOrder(order, makeAccount(), positions, makeStats());
      const v = result.violations.find((v) => v.rule_type === 'max_positions');
      expect(v).toBeDefined();
      expect(v!.current_value).toBe(3);
      expect(v!.threshold).toBe(3);
    });

    it('should allow buy order when positions < threshold', () => {
      const order = makeOrder({ side: 'buy', quantity: 10, price: 100 });
      const positions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 100, avg_cost: 150, current_price: 150, market_value: 15000 },
        { symbol: 'GOOG', quantity: 50, avg_cost: 100, current_price: 100, market_value: 5000 },
      ];
      const result = rc.checkOrder(order, makeAccount(), positions, makeStats());
      const v = result.violations.find((v) => v.rule_type === 'max_positions');
      expect(v).toBeUndefined();
    });

    it('should allow sell orders regardless of position count', () => {
      const order = makeOrder({ side: 'sell', quantity: 10, price: 100 });
      const positions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 100, avg_cost: 150, current_price: 150, market_value: 15000 },
        { symbol: 'GOOG', quantity: 50, avg_cost: 100, current_price: 100, market_value: 5000 },
        { symbol: 'MSFT', quantity: 80, avg_cost: 200, current_price: 200, market_value: 16000 },
        { symbol: 'TSLA', quantity: 30, avg_cost: 300, current_price: 300, market_value: 9000 },
      ];
      const result = rc.checkOrder(order, makeAccount(), positions, makeStats());
      const v = result.violations.find((v) => v.rule_type === 'max_positions');
      expect(v).toBeUndefined();
    });

    it('should ignore positions with zero quantity', () => {
      const order = makeOrder({ side: 'buy', quantity: 10, price: 100 });
      const positions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 100, avg_cost: 150, current_price: 150, market_value: 15000 },
        { symbol: 'GOOG', quantity: 50, avg_cost: 100, current_price: 100, market_value: 5000 },
        { symbol: 'MSFT', quantity: 0, avg_cost: 200, current_price: 200, market_value: 0 },
      ];
      // Only 2 active positions (MSFT has quantity 0), should pass
      const result = rc.checkOrder(order, makeAccount(), positions, makeStats());
      const v = result.violations.find((v) => v.rule_type === 'max_positions');
      expect(v).toBeUndefined();
    });

    it('should apply dynamic risk multiplier in crisis mode (floor)', () => {
      // Set crisis mode: risk_multiplier = 0.25
      rc.updateDynamicRisk(0.20); // drawdown > 0.15 → crisis, multiplier = 0.25
      // threshold = 3 * 0.25 = 0.75, floor = 0
      // Any buy with any positions should be rejected
      const order = makeOrder({ side: 'buy', quantity: 10, price: 100 });
      const positions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 100, avg_cost: 150, current_price: 150, market_value: 15000 },
      ];
      const result = rc.checkOrder(order, makeAccount(), positions, makeStats());
      const v = result.violations.find((v) => v.rule_type === 'max_positions');
      expect(v).toBeDefined();
      expect(v!.threshold).toBe(0); // floor(3 * 0.25) = 0
    });

    it('should apply dynamic risk multiplier in high_vol mode', () => {
      // Set high_vol mode: risk_multiplier = 0.5
      rc.updateDynamicRisk(0.10); // drawdown > 0.08 → high_vol, multiplier = 0.5
      // threshold = 3 * 0.5 = 1.5, floor = 1
      const order = makeOrder({ side: 'buy', quantity: 10, price: 100 });
      const positions: BrokerPosition[] = [
        { symbol: 'AAPL', quantity: 100, avg_cost: 150, current_price: 150, market_value: 15000 },
      ];
      // 1 position >= 1 threshold → reject
      const result = rc.checkOrder(order, makeAccount(), positions, makeStats());
      const v = result.violations.find((v) => v.rule_type === 'max_positions');
      expect(v).toBeDefined();
      expect(v!.threshold).toBe(1); // floor(3 * 0.5) = 1
    });
  });
});
