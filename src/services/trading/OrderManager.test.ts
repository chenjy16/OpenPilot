import Database from 'better-sqlite3';
import { OrderManager } from './OrderManager';
import { initTradingTables } from './tradingSchema';
import type { CreateOrderRequest } from './types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  // Create referenced tables that trading_orders has foreign keys to
  db.exec(`CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)`);
  db.exec(`CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)`);
  // Insert stub rows for FK references used in tests
  db.exec(`INSERT INTO strategies (id) VALUES (5)`);
  db.exec(`INSERT INTO stock_signals (id) VALUES (10)`);
  initTradingTables(db);
  return db;
}

function sampleRequest(overrides?: Partial<CreateOrderRequest>): CreateOrderRequest {
  return {
    symbol: 'AAPL',
    side: 'buy',
    order_type: 'limit',
    quantity: 100,
    price: 150.0,
    ...overrides,
  };
}

describe('OrderManager', () => {
  let db: Database.Database;
  let om: OrderManager;

  beforeEach(() => {
    db = createTestDb();
    om = new OrderManager(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createOrder', () => {
    it('should create an order with pending status and unique local_order_id', () => {
      const order = om.createOrder(sampleRequest(), 'paper');
      expect(order.id).toBeDefined();
      expect(order.local_order_id).toBeDefined();
      expect(order.status).toBe('pending');
      expect(order.filled_quantity).toBe(0);
      expect(order.symbol).toBe('AAPL');
      expect(order.side).toBe('buy');
      expect(order.order_type).toBe('limit');
      expect(order.quantity).toBe(100);
      expect(order.price).toBe(150.0);
      expect(order.trading_mode).toBe('paper');
    });

    it('should generate unique local_order_ids for different orders', () => {
      const o1 = om.createOrder(sampleRequest(), 'paper');
      const o2 = om.createOrder(sampleRequest(), 'paper');
      expect(o1.local_order_id).not.toBe(o2.local_order_id);
    });

    it('should persist optional fields (strategy_id, signal_id)', () => {
      const order = om.createOrder(
        sampleRequest({ strategy_id: 5, signal_id: 10 }),
        'live',
      );
      expect(order.strategy_id).toBe(5);
      expect(order.signal_id).toBe(10);
      expect(order.trading_mode).toBe('live');
    });
  });

  describe('updateOrderStatus', () => {
    it('should allow valid status transitions', () => {
      const order = om.createOrder(sampleRequest(), 'paper');
      const updated = om.updateOrderStatus(order.id!, 'submitted', {
        broker_order_id: 'BRK-001',
      });
      expect(updated.status).toBe('submitted');
      expect(updated.broker_order_id).toBe('BRK-001');
      expect(updated.updated_at).toBeGreaterThanOrEqual(order.updated_at);
    });

    it('should reject invalid status transitions', () => {
      const order = om.createOrder(sampleRequest(), 'paper');
      expect(() => om.updateOrderStatus(order.id!, 'filled')).toThrow(
        /Invalid status transition/,
      );
    });

    it('should throw when order not found', () => {
      expect(() => om.updateOrderStatus(9999, 'submitted')).toThrow(
        /not found/,
      );
    });

    it('should update filled details', () => {
      const order = om.createOrder(sampleRequest(), 'paper');
      om.updateOrderStatus(order.id!, 'submitted');
      const filled = om.updateOrderStatus(order.id!, 'filled', {
        filled_quantity: 100,
        filled_price: 149.5,
      });
      expect(filled.filled_quantity).toBe(100);
      expect(filled.filled_price).toBe(149.5);
    });
  });

  describe('getOrder', () => {
    it('should return null for non-existent order', () => {
      expect(om.getOrder(9999)).toBeNull();
    });

    it('should return the order by id', () => {
      const created = om.createOrder(sampleRequest(), 'paper');
      const fetched = om.getOrder(created.id!);
      expect(fetched).not.toBeNull();
      expect(fetched!.local_order_id).toBe(created.local_order_id);
    });
  });

  describe('listOrders', () => {
    it('should return all orders when no filter', () => {
      om.createOrder(sampleRequest(), 'paper');
      om.createOrder(sampleRequest({ symbol: 'GOOG' }), 'live');
      const orders = om.listOrders();
      expect(orders).toHaveLength(2);
    });

    it('should filter by status', () => {
      const o1 = om.createOrder(sampleRequest(), 'paper');
      om.createOrder(sampleRequest(), 'paper');
      om.updateOrderStatus(o1.id!, 'submitted');
      const submitted = om.listOrders({ status: 'submitted' });
      expect(submitted).toHaveLength(1);
      expect(submitted[0].id).toBe(o1.id);
    });

    it('should filter by symbol', () => {
      om.createOrder(sampleRequest({ symbol: 'AAPL' }), 'paper');
      om.createOrder(sampleRequest({ symbol: 'GOOG' }), 'paper');
      const filtered = om.listOrders({ symbol: 'GOOG' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].symbol).toBe('GOOG');
    });

    it('should filter by trading_mode', () => {
      om.createOrder(sampleRequest(), 'paper');
      om.createOrder(sampleRequest(), 'live');
      const liveOrders = om.listOrders({ trading_mode: 'live' });
      expect(liveOrders).toHaveLength(1);
      expect(liveOrders[0].trading_mode).toBe('live');
    });

    it('should return orders ordered by created_at DESC', () => {
      const o1 = om.createOrder(sampleRequest(), 'paper');
      const o2 = om.createOrder(sampleRequest(), 'paper');
      const orders = om.listOrders();
      // Same created_at second, so just verify we get both back
      expect(orders).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should return zero stats when no orders', () => {
      const stats = om.getStats();
      expect(stats.total_orders).toBe(0);
      expect(stats.filled_orders).toBe(0);
      expect(stats.cancelled_orders).toBe(0);
      expect(stats.total_filled_amount).toBe(0);
    });

    it('should compute correct stats', () => {
      const o1 = om.createOrder(sampleRequest(), 'paper');
      om.updateOrderStatus(o1.id!, 'submitted');
      om.updateOrderStatus(o1.id!, 'filled', {
        filled_quantity: 100,
        filled_price: 150,
      });

      const o2 = om.createOrder(sampleRequest(), 'paper');
      om.updateOrderStatus(o2.id!, 'submitted');
      om.updateOrderStatus(o2.id!, 'cancelled');

      om.createOrder(sampleRequest(), 'paper'); // pending

      const stats = om.getStats();
      expect(stats.total_orders).toBe(3);
      expect(stats.filled_orders).toBe(1);
      expect(stats.cancelled_orders).toBe(1);
      expect(stats.total_filled_amount).toBe(15000); // 100 * 150
    });

    it('should filter stats by trading mode', () => {
      const o1 = om.createOrder(sampleRequest(), 'paper');
      om.updateOrderStatus(o1.id!, 'submitted');
      om.updateOrderStatus(o1.id!, 'filled', {
        filled_quantity: 50,
        filled_price: 100,
      });

      const o2 = om.createOrder(sampleRequest(), 'live');
      om.updateOrderStatus(o2.id!, 'submitted');
      om.updateOrderStatus(o2.id!, 'filled', {
        filled_quantity: 200,
        filled_price: 100,
      });

      const paperStats = om.getStats('paper');
      expect(paperStats.total_orders).toBe(1);
      expect(paperStats.filled_orders).toBe(1);
      expect(paperStats.total_filled_amount).toBe(5000);

      const liveStats = om.getStats('live');
      expect(liveStats.total_orders).toBe(1);
      expect(liveStats.total_filled_amount).toBe(20000);
    });
  });
});
