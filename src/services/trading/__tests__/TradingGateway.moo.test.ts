/**
 * Unit tests for TradingGateway MOO (Market on Open) order handling
 *
 * Covers:
 * - placeOrder with moo type creates pending order with expected execution time
 * - executePendingMOO converts MOO orders to market orders (fallback)
 * - executePendingMOO with broker support submits directly
 * - executePendingMOO handles execution failures gracefully
 * - getNextMarketOpen computes correct next open times
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4
 */

import Database from 'better-sqlite3';
import { TradingGateway } from '../TradingGateway';
import { OrderManager } from '../OrderManager';
import { RiskController } from '../RiskController';
import { PaperTradingEngine } from '../PaperTradingEngine';
import { initTradingTables } from '../tradingSchema';
import type { CreateOrderRequest, BrokerAdapter, BrokerOrderResult } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  db.exec('INSERT INTO strategies (id) VALUES (1)');
  db.exec('INSERT INTO stock_signals (id) VALUES (10)');
  initTradingTables(db);
  return db;
}

function createGateway(db: Database.Database, brokerAdapter?: BrokerAdapter) {
  const om = new OrderManager(db);
  const rc = new RiskController(db);
  rc.initDefaultRules();
  const pe = new PaperTradingEngine(db, { initial_capital: 1000000, commission_rate: 0.0003 });
  const gw = new TradingGateway(db, om, rc, pe, brokerAdapter);
  return { gw, om, rc, pe };
}

function mooRequest(overrides?: Partial<CreateOrderRequest>): CreateOrderRequest {
  return {
    symbol: 'AAPL',
    side: 'buy',
    order_type: 'moo',
    quantity: 100,
    price: 150,
    strategy_id: 1,
    signal_id: 10,
    ...overrides,
  };
}

function createMockBroker(overrides?: Partial<BrokerAdapter>): BrokerAdapter {
  return {
    name: 'mock',
    testConnection: async () => true,
    submitOrder: async () => ({
      broker_order_id: 'B-001',
      status: 'submitted' as const,
      filled_quantity: 100,
      filled_price: 150,
    }),
    cancelOrder: async () => ({ broker_order_id: '', status: 'failed' as const, message: 'mock' }),
    getOrderStatus: async () => ({ broker_order_id: '', status: 'failed' as const, message: 'mock' }),
    getAccount: async () => ({ total_assets: 1000000, available_cash: 500000, frozen_cash: 0, currency: 'USD' }),
    getPositions: async () => [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TradingGateway — MOO Order Handling', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('placeOrder with moo type', () => {
    it('should create a pending MOO order', async () => {
      const { gw } = createGateway(db);
      const order = await gw.placeOrder(mooRequest());

      expect(order.status).toBe('pending');
      expect(order.order_type).toBe('moo');
      expect(order.symbol).toBe('AAPL');
      expect(order.quantity).toBe(100);
    });

    it('should annotate expected execution time as next market open', async () => {
      const { gw } = createGateway(db);
      const order = await gw.placeOrder(mooRequest());

      // Check that the expected execution time was stored in trading_config
      const row = db.prepare(
        'SELECT value FROM trading_config WHERE key = ?'
      ).get(`moo_expected_exec_${order.id}`) as { value: string } | undefined;

      expect(row).toBeDefined();
      const expectedTime = Number(row!.value);
      expect(expectedTime).toBeGreaterThan(0);

      // The expected time should be in the future (or at least today's open)
      const now = Math.floor(Date.now() / 1000);
      // Allow some tolerance — the next open could be today if before 9:30 ET
      expect(expectedTime).toBeGreaterThanOrEqual(now - 86400);
    });

    it('should log an audit entry for MOO order placement', async () => {
      const { gw } = createGateway(db);
      await gw.placeOrder(mooRequest());

      const logs = db.prepare(
        "SELECT * FROM trading_audit_log WHERE operation = 'place_moo_order'"
      ).all() as any[];
      expect(logs.length).toBe(1);
      const result = JSON.parse(logs[0].response_result);
      expect(result.status).toBe('pending');
      expect(result.expected_execution_time).toBeGreaterThan(0);
    });

    it('should NOT route MOO orders to execution engine', async () => {
      const { gw } = createGateway(db);
      const order = await gw.placeOrder(mooRequest());

      // Order should remain pending — not submitted or filled
      expect(order.status).toBe('pending');
      expect(order.filled_quantity).toBe(0);
      expect(order.broker_order_id).toBeUndefined();
    });

    it('should preserve strategy_id and signal_id on MOO orders', async () => {
      const { gw } = createGateway(db);
      const order = await gw.placeOrder(mooRequest({ strategy_id: 1, signal_id: 10 }));

      expect(order.strategy_id).toBe(1);
      expect(order.signal_id).toBe(10);
    });
  });

  describe('executePendingMOO — fallback (broker does not support MOO)', () => {
    it('should convert pending MOO orders to market orders', async () => {
      const { gw } = createGateway(db);

      // Place a MOO order
      const moo = await gw.placeOrder(mooRequest());
      expect(moo.status).toBe('pending');

      // Execute pending MOO orders (fallback mode)
      const results = await gw.executePendingMOO(false);

      expect(results.length).toBe(1);
      // The new market order should be filled (paper mode fills immediately)
      expect(results[0].status).toBe('filled');
      expect(results[0].order_type).toBe('market');
      expect(results[0].symbol).toBe('AAPL');
    });

    it('should mark original MOO order as failed when converting', async () => {
      const { gw } = createGateway(db);

      const moo = await gw.placeOrder(mooRequest());
      await gw.executePendingMOO(false);

      // The original MOO order should be marked as failed
      const original = gw.getOrder(moo.id!);
      expect(original!.status).toBe('failed');
      expect(original!.reject_reason).toContain('Converted to market order');
    });

    it('should log fallback audit entry', async () => {
      const { gw } = createGateway(db);

      await gw.placeOrder(mooRequest());
      await gw.executePendingMOO(false);

      const logs = db.prepare(
        "SELECT * FROM trading_audit_log WHERE operation = 'moo_fallback_market'"
      ).all() as any[];
      expect(logs.length).toBe(1);
    });

    it('should return empty array when no pending MOO orders', async () => {
      const { gw } = createGateway(db);
      const results = await gw.executePendingMOO(false);
      expect(results).toEqual([]);
    });

    it('should handle multiple pending MOO orders', async () => {
      const { gw } = createGateway(db);

      await gw.placeOrder(mooRequest({ symbol: 'AAPL' }));
      await gw.placeOrder(mooRequest({ symbol: 'GOOG' }));
      await gw.placeOrder(mooRequest({ symbol: 'MSFT' }));

      const results = await gw.executePendingMOO(false);
      expect(results.length).toBe(3);

      const symbols = results.map(r => r.symbol).sort();
      expect(symbols).toEqual(['AAPL', 'GOOG', 'MSFT']);
    });
  });

  describe('executePendingMOO — broker supports MOO', () => {
    it('should submit MOO orders directly to broker', async () => {
      const submitSpy = jest.fn<Promise<BrokerOrderResult>, any[]>(async () => ({
        broker_order_id: 'B-MOO-001',
        status: 'submitted' as const,
        filled_quantity: 100,
        filled_price: 150,
      }));

      const broker = createMockBroker({ submitOrder: submitSpy });
      const { gw } = createGateway(db, broker);

      // Set paper credentials so broker is used
      gw.saveBrokerCredentials({
        app_key: 'key',
        app_secret: 'secret',
        access_token: 'token',
        paper_access_token: 'paper_token',
      });

      await gw.placeOrder(mooRequest());
      const results = await gw.executePendingMOO(true);

      expect(results.length).toBe(1);
      expect(results[0].status).toBe('filled');
      expect(submitSpy).toHaveBeenCalled();
    });

    it('should handle broker rejection of MOO order', async () => {
      const broker = createMockBroker({
        submitOrder: async () => ({
          broker_order_id: 'B-MOO-002',
          status: 'failed' as const,
          message: 'MOO not supported',
        }),
      });
      const { gw } = createGateway(db, broker);
      gw.saveBrokerCredentials({
        app_key: 'key',
        app_secret: 'secret',
        access_token: 'token',
        paper_access_token: 'paper_token',
      });

      await gw.placeOrder(mooRequest());
      const results = await gw.executePendingMOO(true);

      expect(results.length).toBe(1);
      expect(results[0].status).toBe('failed');
      expect(results[0].reject_reason).toContain('MOO not supported');
    });
  });

  describe('executePendingMOO — error handling', () => {
    it('should mark order as failed when execution throws', async () => {
      const broker = createMockBroker({
        submitOrder: async () => { throw new Error('Network timeout'); },
      });
      const { gw } = createGateway(db, broker);
      gw.saveBrokerCredentials({
        app_key: 'key',
        app_secret: 'secret',
        access_token: 'token',
        paper_access_token: 'paper_token',
      });

      const moo = await gw.placeOrder(mooRequest());
      const results = await gw.executePendingMOO(true);

      expect(results.length).toBe(1);
      expect(results[0].status).toBe('failed');
      expect(results[0].reject_reason).toContain('MOO execution failed');

      // Verify audit log
      const logs = db.prepare(
        "SELECT * FROM trading_audit_log WHERE operation = 'moo_execution_failed'"
      ).all() as any[];
      expect(logs.length).toBe(1);
    });
  });

  describe('getNextMarketOpen', () => {
    it('should return next weekday open for a Saturday', () => {
      // Saturday, Jan 6, 2024 at 12:00 UTC
      const sat = new Date('2024-01-06T12:00:00Z');
      const nextOpen = TradingGateway.getNextMarketOpen(sat);
      const openDate = new Date(nextOpen * 1000);

      // Should be Monday Jan 8, 2024 at 14:30 UTC (09:30 EST, January = UTC-5)
      expect(openDate.getUTCDay()).toBe(1); // Monday
      expect(openDate.getUTCHours()).toBe(14); // 9:30 ET = 14:30 UTC in winter
      expect(openDate.getUTCMinutes()).toBe(30);
    });

    it('should return next weekday open for a Sunday', () => {
      // Sunday, Jan 7, 2024 at 12:00 UTC
      const sun = new Date('2024-01-07T12:00:00Z');
      const nextOpen = TradingGateway.getNextMarketOpen(sun);
      const openDate = new Date(nextOpen * 1000);

      expect(openDate.getUTCDay()).toBe(1); // Monday
    });

    it('should return today open if before 9:30 ET on a weekday', () => {
      // Wednesday, Jan 10, 2024 at 13:00 UTC (08:00 EST — before market open)
      const wed = new Date('2024-01-10T13:00:00Z');
      const nextOpen = TradingGateway.getNextMarketOpen(wed);
      const openDate = new Date(nextOpen * 1000);

      expect(openDate.getUTCDate()).toBe(10); // Same day
      expect(openDate.getUTCHours()).toBe(14); // 9:30 EST = 14:30 UTC
      expect(openDate.getUTCMinutes()).toBe(30);
    });

    it('should return next day open if after 9:30 ET on a weekday', () => {
      // Wednesday, Jan 10, 2024 at 16:00 UTC (11:00 EST — after market open)
      const wed = new Date('2024-01-10T16:00:00Z');
      const nextOpen = TradingGateway.getNextMarketOpen(wed);
      const openDate = new Date(nextOpen * 1000);

      expect(openDate.getUTCDate()).toBe(11); // Next day (Thursday)
      expect(openDate.getUTCDay()).toBe(4); // Thursday
    });

    it('should skip to Monday if after open on Friday', () => {
      // Friday, Jan 12, 2024 at 20:00 UTC (15:00 EST — after market open)
      const fri = new Date('2024-01-12T20:00:00Z');
      const nextOpen = TradingGateway.getNextMarketOpen(fri);
      const openDate = new Date(nextOpen * 1000);

      expect(openDate.getUTCDay()).toBe(1); // Monday
      expect(openDate.getUTCDate()).toBe(15);
    });

    it('should handle EDT (summer time) correctly', () => {
      // Wednesday, Jul 10, 2024 at 12:00 UTC (08:00 EDT — before market open)
      const summer = new Date('2024-07-10T12:00:00Z');
      const nextOpen = TradingGateway.getNextMarketOpen(summer);
      const openDate = new Date(nextOpen * 1000);

      expect(openDate.getUTCDate()).toBe(10); // Same day
      expect(openDate.getUTCHours()).toBe(13); // 9:30 EDT = 13:30 UTC
      expect(openDate.getUTCMinutes()).toBe(30);
    });
  });
});
