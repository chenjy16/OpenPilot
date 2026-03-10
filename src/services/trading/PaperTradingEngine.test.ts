import Database from 'better-sqlite3';
import { PaperTradingEngine } from './PaperTradingEngine';
import { initTradingTables } from './tradingSchema';
import type { TradingOrder } from './types';

const INITIAL_CAPITAL = 1_000_000;
const COMMISSION_RATE = 0.001; // 0.1%

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
    symbol: '600519.SH',
    side: 'buy',
    order_type: 'market',
    quantity: 100,
    price: undefined,
    status: 'pending',
    trading_mode: 'paper',
    filled_quantity: 0,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe('PaperTradingEngine', () => {
  let db: Database.Database;
  let engine: PaperTradingEngine;

  beforeEach(() => {
    db = createTestDb();
    engine = new PaperTradingEngine(db, {
      initial_capital: INITIAL_CAPITAL,
      commission_rate: COMMISSION_RATE,
    });
  });

  afterEach(() => {
    db.close();
  });

  // -----------------------------------------------------------------------
  // Market buy order
  // -----------------------------------------------------------------------
  describe('market buy order', () => {
    it('should fill immediately and deduct from available_cash', async () => {
      const order = makeOrder({ side: 'buy', order_type: 'market', quantity: 100 });
      const price = 50;
      const result = await engine.submitOrder(order, price);

      expect(result.status).toBe('submitted');
      expect(result.filled_quantity).toBe(100);
      expect(result.filled_price).toBe(50);

      const account = engine.getAccount();
      const expectedCost = 100 * 50;
      const expectedCommission = expectedCost * COMMISSION_RATE;
      expect(account.available_cash).toBeCloseTo(INITIAL_CAPITAL - expectedCost - expectedCommission);
    });
  });

  // -----------------------------------------------------------------------
  // Market sell order
  // -----------------------------------------------------------------------
  describe('market sell order', () => {
    it('should fill and add to available_cash', async () => {
      // First buy some shares
      const buyOrder = makeOrder({ side: 'buy', order_type: 'market', quantity: 200 });
      await engine.submitOrder(buyOrder, 100);

      const cashAfterBuy = engine.getAccount().available_cash;

      // Now sell
      const sellOrder = makeOrder({
        local_order_id: 'test-002',
        side: 'sell',
        order_type: 'market',
        quantity: 100,
      });
      const result = await engine.submitOrder(sellOrder, 120);

      expect(result.status).toBe('submitted');
      expect(result.filled_quantity).toBe(100);
      expect(result.filled_price).toBe(120);

      const account = engine.getAccount();
      const sellProceeds = 100 * 120;
      const sellCommission = sellProceeds * COMMISSION_RATE;
      expect(account.available_cash).toBeCloseTo(cashAfterBuy + sellProceeds - sellCommission);
    });
  });

  // -----------------------------------------------------------------------
  // Insufficient funds rejection
  // -----------------------------------------------------------------------
  describe('insufficient funds', () => {
    it('should reject buy order when cash is insufficient', async () => {
      const order = makeOrder({
        side: 'buy',
        order_type: 'market',
        quantity: 100000,
      });
      // 100000 * 100 = 10,000,000 > 1,000,000
      const result = await engine.submitOrder(order, 100);

      expect(result.status).toBe('rejected');
      expect(result.message).toMatch(/Insufficient funds/);
    });

    it('should not change account state on rejection', async () => {
      const accountBefore = engine.getAccount();
      const order = makeOrder({ side: 'buy', order_type: 'market', quantity: 100000 });
      await engine.submitOrder(order, 100);
      const accountAfter = engine.getAccount();

      expect(accountAfter.available_cash).toBe(accountBefore.available_cash);
    });
  });

  // -----------------------------------------------------------------------
  // Insufficient position rejection
  // -----------------------------------------------------------------------
  describe('insufficient position', () => {
    it('should reject sell order when position is insufficient', async () => {
      const order = makeOrder({ side: 'sell', order_type: 'market', quantity: 100 });
      const result = await engine.submitOrder(order, 50);

      expect(result.status).toBe('rejected');
      expect(result.message).toMatch(/Insufficient position/);
    });
  });

  // -----------------------------------------------------------------------
  // Limit buy order
  // -----------------------------------------------------------------------
  describe('limit buy order', () => {
    it('should fill when currentPrice <= limit price', async () => {
      const order = makeOrder({
        side: 'buy',
        order_type: 'limit',
        quantity: 100,
        price: 60,
      });
      const result = await engine.submitOrder(order, 55); // 55 <= 60

      expect(result.status).toBe('submitted');
      expect(result.filled_quantity).toBe(100);
      expect(result.filled_price).toBe(55);
    });

    it('should stay pending when currentPrice > limit price', async () => {
      const order = makeOrder({
        side: 'buy',
        order_type: 'limit',
        quantity: 100,
        price: 60,
      });
      const result = await engine.submitOrder(order, 65); // 65 > 60

      expect(result.status).toBe('submitted');
      expect(result.filled_quantity).toBeUndefined();
      expect(result.filled_price).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Limit sell order
  // -----------------------------------------------------------------------
  describe('limit sell order', () => {
    it('should fill when currentPrice >= limit price', async () => {
      // Buy first
      const buyOrder = makeOrder({ side: 'buy', order_type: 'market', quantity: 100 });
      await engine.submitOrder(buyOrder, 50);

      const sellOrder = makeOrder({
        local_order_id: 'test-sell-001',
        side: 'sell',
        order_type: 'limit',
        quantity: 100,
        price: 55,
      });
      const result = await engine.submitOrder(sellOrder, 60); // 60 >= 55

      expect(result.status).toBe('submitted');
      expect(result.filled_quantity).toBe(100);
      expect(result.filled_price).toBe(60);
    });

    it('should stay pending when currentPrice < limit price', async () => {
      // Buy first
      const buyOrder = makeOrder({ side: 'buy', order_type: 'market', quantity: 100 });
      await engine.submitOrder(buyOrder, 50);

      const sellOrder = makeOrder({
        local_order_id: 'test-sell-002',
        side: 'sell',
        order_type: 'limit',
        quantity: 100,
        price: 55,
      });
      const result = await engine.submitOrder(sellOrder, 50); // 50 < 55

      expect(result.status).toBe('submitted');
      expect(result.filled_quantity).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Commission deduction
  // -----------------------------------------------------------------------
  describe('commission deduction', () => {
    it('should deduct commission on buy', async () => {
      const order = makeOrder({ side: 'buy', order_type: 'market', quantity: 1000 });
      const price = 100;
      await engine.submitOrder(order, price);

      const account = engine.getAccount();
      const cost = 1000 * 100;
      const commission = cost * COMMISSION_RATE;
      expect(account.available_cash).toBeCloseTo(INITIAL_CAPITAL - cost - commission);
    });

    it('should deduct commission on sell', async () => {
      // Buy first
      const buyOrder = makeOrder({ side: 'buy', order_type: 'market', quantity: 1000 });
      await engine.submitOrder(buyOrder, 100);
      const cashAfterBuy = engine.getAccount().available_cash;

      // Sell
      const sellOrder = makeOrder({
        local_order_id: 'test-sell-comm',
        side: 'sell',
        order_type: 'market',
        quantity: 500,
      });
      await engine.submitOrder(sellOrder, 110);

      const account = engine.getAccount();
      const sellProceeds = 500 * 110;
      const sellCommission = sellProceeds * COMMISSION_RATE;
      expect(account.available_cash).toBeCloseTo(cashAfterBuy + sellProceeds - sellCommission);
    });
  });

  // -----------------------------------------------------------------------
  // getAccount
  // -----------------------------------------------------------------------
  describe('getAccount', () => {
    it('should return correct totals with no positions', () => {
      const account = engine.getAccount();
      expect(account.available_cash).toBe(INITIAL_CAPITAL);
      expect(account.total_assets).toBe(INITIAL_CAPITAL);
      expect(account.frozen_cash).toBe(0);
      expect(account.currency).toBe('CNY');
    });

    it('should include position value in total_assets', async () => {
      const order = makeOrder({ side: 'buy', order_type: 'market', quantity: 100 });
      await engine.submitOrder(order, 200);

      const account = engine.getAccount();
      const cost = 100 * 200;
      const commission = cost * COMMISSION_RATE;
      // total_assets = available_cash + positions_value (at avg_cost)
      // positions_value = 100 * 200 = 20000
      expect(account.total_assets).toBeCloseTo(INITIAL_CAPITAL - commission);
    });
  });

  // -----------------------------------------------------------------------
  // getPositions
  // -----------------------------------------------------------------------
  describe('getPositions', () => {
    it('should return empty array when no positions', () => {
      const positions = engine.getPositions();
      expect(positions).toHaveLength(0);
    });

    it('should return positions after buying', async () => {
      const order = makeOrder({ side: 'buy', order_type: 'market', quantity: 100 });
      await engine.submitOrder(order, 50);

      const positions = engine.getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].symbol).toBe('600519.SH');
      expect(positions[0].quantity).toBe(100);
      expect(positions[0].avg_cost).toBe(50);
      expect(positions[0].market_value).toBe(5000);
    });

    it('should update avg_cost with weighted average on additional buys', async () => {
      const order1 = makeOrder({ side: 'buy', order_type: 'market', quantity: 100 });
      await engine.submitOrder(order1, 50);

      const order2 = makeOrder({
        local_order_id: 'test-002',
        side: 'buy',
        order_type: 'market',
        quantity: 100,
      });
      await engine.submitOrder(order2, 60);

      const positions = engine.getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].quantity).toBe(200);
      // weighted avg = (100*50 + 100*60) / 200 = 55
      expect(positions[0].avg_cost).toBeCloseTo(55);
    });

    it('should remove position when fully sold', async () => {
      const buyOrder = makeOrder({ side: 'buy', order_type: 'market', quantity: 100 });
      await engine.submitOrder(buyOrder, 50);

      const sellOrder = makeOrder({
        local_order_id: 'test-sell-all',
        side: 'sell',
        order_type: 'market',
        quantity: 100,
      });
      await engine.submitOrder(sellOrder, 60);

      const positions = engine.getPositions();
      expect(positions).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // cancelOrder
  // -----------------------------------------------------------------------
  describe('cancelOrder', () => {
    it('should return cancelled result', () => {
      const result = engine.cancelOrder('test-001');
      expect(result.status).toBe('submitted');
      expect(result.broker_order_id).toBe('test-001');
      expect(result.message).toBe('Cancelled');
    });
  });

  // -----------------------------------------------------------------------
  // checkPendingOrders
  // -----------------------------------------------------------------------
  describe('checkPendingOrders', () => {
    it('should return empty array', () => {
      const results = engine.checkPendingOrders({ '600519.SH': 100 });
      expect(results).toEqual([]);
    });
  });
});
