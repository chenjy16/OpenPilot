/**
 * Property-Based Tests for OrderManager
 *
 * Feature: quant-trading-broker-integration, Property 1: 订单状态机合法性
 * Validates: Requirements 2.4, 2.5
 *
 * For any order and any status transition attempt, only transitions matching
 * VALID_STATUS_TRANSITIONS should succeed. Invalid transitions should throw
 * an Error. Each valid status change should update the timestamp.
 */

import Database from 'better-sqlite3';
import * as fc from 'fast-check';
import { OrderManager } from './OrderManager';
import { initTradingTables } from './tradingSchema';
import {
  VALID_STATUS_TRANSITIONS,
  type OrderStatus,
  type OrderSide,
  type OrderType,
  type CreateOrderRequest,
  type TradingOrder,
  type OrderFilter,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_STATUSES: OrderStatus[] = [
  'pending', 'submitted', 'partial_filled', 'filled',
  'cancelled', 'rejected', 'failed',
];

/** Number of pre-seeded reference rows for FK targets */
const REF_ROW_COUNT = 10;

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  // Pre-populate FK target tables so generated strategy_id / signal_id are valid
  for (let i = 1; i <= REF_ROW_COUNT; i++) {
    db.exec(`INSERT INTO strategies (id) VALUES (${i})`);
    db.exec(`INSERT INTO stock_signals (id) VALUES (${i})`);
  }
  return db;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbOrderStatus = fc.constantFrom<OrderStatus>(...ALL_STATUSES);

const arbOrderSide = fc.constantFrom<OrderSide>('buy', 'sell');

const arbOrderType = fc.constantFrom<OrderType>('market', 'limit', 'stop', 'stop_limit');

const arbCreateOrderRequest: fc.Arbitrary<CreateOrderRequest> = fc.record({
  symbol: fc.stringMatching(/^[A-Z]{1,5}$/),
  side: arbOrderSide,
  order_type: arbOrderType,
  quantity: fc.integer({ min: 1, max: 10000 }),
  price: fc.option(fc.double({ min: 0.01, max: 10000, noNaN: true }), { nil: undefined }),
  stop_price: fc.option(fc.double({ min: 0.01, max: 10000, noNaN: true }), { nil: undefined }),
  strategy_id: fc.option(fc.integer({ min: 1, max: REF_ROW_COUNT }), { nil: undefined }),
  signal_id: fc.option(fc.integer({ min: 1, max: REF_ROW_COUNT }), { nil: undefined }),
});

/**
 * Build a reachable path from 'pending' to a given target status using only
 * valid transitions. Returns the sequence of statuses to traverse (excluding
 * the initial 'pending'). Returns null if the target is unreachable.
 */
function pathToStatus(target: OrderStatus): OrderStatus[] | null {
  if (target === 'pending') return [];

  // BFS
  const queue: Array<{ status: OrderStatus; path: OrderStatus[] }> = [
    { status: 'pending', path: [] },
  ];
  const visited = new Set<OrderStatus>(['pending']);

  while (queue.length > 0) {
    const { status, path } = queue.shift()!;
    for (const next of VALID_STATUS_TRANSITIONS[status]) {
      if (next === target) return [...path, next];
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ status: next, path: [...path, next] });
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Property 1: 订单状态机合法性
// ---------------------------------------------------------------------------

describe('OrderManager Property Tests', () => {
  /**
   * Feature: quant-trading-broker-integration, Property 1: 订单状态机合法性
   * Validates: Requirements 2.4, 2.5
   */
  describe('Property 1: Order state machine validity', () => {
    it('valid transitions succeed and update timestamp; invalid transitions throw', () => {
      fc.assert(
        fc.property(
          arbCreateOrderRequest,
          arbOrderStatus,  // fromStatus — the status we want the order to be in
          arbOrderStatus,  // toStatus — the status we attempt to transition to
          (request, fromStatus, toStatus) => {
            const db = createTestDb();
            try {
              const om = new OrderManager(db);
              const order = om.createOrder(request, 'paper');

              // Walk the order to fromStatus via valid transitions
              const path = pathToStatus(fromStatus);
              if (path === null) return; // unreachable status, skip

              let currentOrder = order;
              for (const step of path) {
                currentOrder = om.updateOrderStatus(currentOrder.id!, step);
              }

              // Now attempt the transition fromStatus → toStatus
              const isValid = VALID_STATUS_TRANSITIONS[fromStatus].includes(toStatus);

              if (isValid) {
                const beforeUpdate = currentOrder.updated_at;
                const updated = om.updateOrderStatus(currentOrder.id!, toStatus);
                // Status should be updated
                expect(updated.status).toBe(toStatus);
                // Timestamp should be updated (>= because same-second is possible)
                expect(updated.updated_at).toBeGreaterThanOrEqual(beforeUpdate);
              } else {
                // Invalid transition should throw
                expect(() => om.updateOrderStatus(currentOrder.id!, toStatus)).toThrow(Error);
              }
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  /**
   * Feature: quant-trading-broker-integration, Property 9: 订单创建属性保持
   * Validates: Requirements 2.1, 2.2, 2.3, 2.6
   *
   * For any valid CreateOrderRequest, after creation:
   * - All input properties are preserved (symbol, side, order_type, quantity, price, stop_price, strategy_id, signal_id)
   * - A unique local_order_id is generated
   * - Initial status is 'pending'
   * - filled_quantity is 0
   * - Reading back from DB (via getOrder) returns identical data (DB round-trip consistency)
   */
  describe('Property 9: Order creation property preservation', () => {
    it('created order preserves all input properties, has unique ID, pending status, zero fill, and DB round-trip consistency', () => {
      fc.assert(
        fc.property(
          arbCreateOrderRequest,
          fc.constantFrom<'paper' | 'live'>('paper', 'live'),
          (request, tradingMode) => {
            const db = createTestDb();
            try {
              const om = new OrderManager(db);
              const order = om.createOrder(request, tradingMode);

              // --- Input properties preserved ---
              expect(order.symbol).toBe(request.symbol);
              expect(order.side).toBe(request.side);
              expect(order.order_type).toBe(request.order_type);
              expect(order.quantity).toBe(request.quantity);
              expect(order.price).toBe(request.price);
              expect(order.stop_price).toBe(request.stop_price);
              expect(order.strategy_id).toBe(request.strategy_id);
              expect(order.signal_id).toBe(request.signal_id);

              // --- Unique local_order_id generated ---
              expect(typeof order.local_order_id).toBe('string');
              expect(order.local_order_id.length).toBeGreaterThan(0);

              // --- Initial status is 'pending' ---
              expect(order.status).toBe('pending');

              // --- filled_quantity is 0 ---
              expect(order.filled_quantity).toBe(0);

              // --- trading_mode preserved ---
              expect(order.trading_mode).toBe(tradingMode);

              // --- DB round-trip consistency ---
              const readBack = om.getOrder(order.id!);
              expect(readBack).not.toBeNull();
              expect(readBack!.local_order_id).toBe(order.local_order_id);
              expect(readBack!.symbol).toBe(order.symbol);
              expect(readBack!.side).toBe(order.side);
              expect(readBack!.order_type).toBe(order.order_type);
              expect(readBack!.quantity).toBe(order.quantity);
              expect(readBack!.price).toBe(order.price);
              expect(readBack!.stop_price).toBe(order.stop_price);
              expect(readBack!.status).toBe(order.status);
              expect(readBack!.trading_mode).toBe(order.trading_mode);
              expect(readBack!.filled_quantity).toBe(order.filled_quantity);
              expect(readBack!.strategy_id).toBe(order.strategy_id);
              expect(readBack!.signal_id).toBe(order.signal_id);
              expect(readBack!.created_at).toBe(order.created_at);
              expect(readBack!.updated_at).toBe(order.updated_at);
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('each created order gets a unique local_order_id', () => {
      fc.assert(
        fc.property(
          fc.array(arbCreateOrderRequest, { minLength: 2, maxLength: 20 }),
          (requests) => {
            const db = createTestDb();
            try {
              const om = new OrderManager(db);
              const ids = requests.map(
                (req) => om.createOrder(req, 'paper').local_order_id,
              );
              const uniqueIds = new Set(ids);
              expect(uniqueIds.size).toBe(ids.length);
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  /**
   * Feature: quant-trading-broker-integration, Property 10: 订单过滤正确性
   * Validates: Requirements 2.7
   *
   * For any set of orders and any combination of filter conditions
   * (symbol, trading_mode), listOrders should return exactly the orders
   * that satisfy ALL specified conditions — no false positives, no omissions.
   *
   * Since orders start as 'pending' and status transitions require valid paths,
   * we focus on filtering by symbol and trading_mode which are set at creation time.
   * We also test start_date / end_date filtering using the created_at timestamps.
   */
  describe('Property 10: Order filter correctness', () => {
    /** Small pool of symbols to increase filter hit rate */
    const arbSymbol = fc.constantFrom('AAPL', 'GOOG', 'TSLA', 'MSFT', 'AMZN');
    const arbTradingMode = fc.constantFrom<'paper' | 'live'>('paper', 'live');

    const arbOrderReq = fc.record({
      symbol: arbSymbol,
      side: arbOrderSide,
      order_type: arbOrderType,
      quantity: fc.integer({ min: 1, max: 1000 }),
    });

    /** Generate an optional filter field — undefined means "don't filter on this" */
    const arbOptSymbol = fc.option(arbSymbol, { nil: undefined });
    const arbOptMode = fc.option(arbTradingMode, { nil: undefined });

    it('every returned order satisfies all filter conditions and no matching order is omitted', () => {
      fc.assert(
        fc.property(
          fc.array(arbOrderReq, { minLength: 1, maxLength: 20 }),
          fc.array(arbTradingMode, { minLength: 1, maxLength: 20 }),
          arbOptSymbol,
          arbOptMode,
          (requests, modes, filterSymbol, filterMode) => {
            const db = createTestDb();
            try {
              const om = new OrderManager(db);

              // Create orders — pair each request with a trading mode (cycle modes if shorter)
              const createdOrders: TradingOrder[] = [];
              for (let i = 0; i < requests.length; i++) {
                const mode = modes[i % modes.length];
                const order = om.createOrder(requests[i] as CreateOrderRequest, mode);
                createdOrders.push(order);
              }

              // Build filter
              const filter: OrderFilter = {};
              if (filterSymbol !== undefined) filter.symbol = filterSymbol;
              if (filterMode !== undefined) filter.trading_mode = filterMode;

              // Query
              const result = om.listOrders(filter);

              // Manual reference filter — compute expected set
              const expected = createdOrders.filter((o) => {
                if (filterSymbol !== undefined && o.symbol !== filterSymbol) return false;
                if (filterMode !== undefined && o.trading_mode !== filterMode) return false;
                return true;
              });

              // Every returned order must satisfy all filter conditions
              for (const o of result) {
                if (filterSymbol !== undefined) {
                  expect(o.symbol).toBe(filterSymbol);
                }
                if (filterMode !== undefined) {
                  expect(o.trading_mode).toBe(filterMode);
                }
              }

              // No matching orders should be omitted (compare by id sets)
              const resultIds = new Set(result.map((o) => o.id));
              const expectedIds = new Set(expected.map((o) => o.id));
              expect(resultIds).toEqual(expectedIds);
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('start_date and end_date filters correctly bound results by created_at', () => {
      fc.assert(
        fc.property(
          fc.array(arbOrderReq, { minLength: 3, maxLength: 15 }),
          (requests) => {
            const db = createTestDb();
            try {
              const om = new OrderManager(db);

              // Create orders — all will share the same created_at (same second)
              const createdOrders: TradingOrder[] = [];
              for (const req of requests) {
                createdOrders.push(om.createOrder(req as CreateOrderRequest, 'paper'));
              }

              // Use the actual created_at from the first order as reference
              const refTime = createdOrders[0].created_at;

              // Filter with start_date = refTime should include all orders
              const withStart = om.listOrders({ start_date: refTime });
              expect(withStart.length).toBe(createdOrders.length);
              for (const o of withStart) {
                expect(o.created_at).toBeGreaterThanOrEqual(refTime);
              }

              // Filter with end_date = refTime should include all orders
              const withEnd = om.listOrders({ end_date: refTime });
              expect(withEnd.length).toBe(createdOrders.length);
              for (const o of withEnd) {
                expect(o.created_at).toBeLessThanOrEqual(refTime);
              }

              // Filter with start_date far in the future should return empty
              const futureFilter = om.listOrders({ start_date: refTime + 100000 });
              expect(futureFilter.length).toBe(0);

              // Filter with end_date far in the past should return empty
              const pastFilter = om.listOrders({ end_date: refTime - 100000 });
              expect(pastFilter.length).toBe(0);
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
