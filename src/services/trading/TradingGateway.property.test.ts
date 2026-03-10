/**
 * Property-Based Tests for TradingGateway
 *
 * Feature: quant-trading-broker-integration
 * Property 13: 券商错误标准化
 */

import * as fc from 'fast-check';
import { LongportAdapter } from './LongportAdapter';
import type { TradingOrder, BrokerOrderResult, BrokerAdapter, BrokerAccount, BrokerPosition, CreateOrderRequest } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let orderCounter = 0;

function makeOrder(overrides?: Partial<TradingOrder>): TradingOrder {
  orderCounter++;
  return {
    id: orderCounter,
    local_order_id: `prop13-${orderCounter}-${Date.now()}`,
    symbol: '600519.SH',
    side: 'buy',
    order_type: 'market',
    quantity: 100,
    price: undefined,
    status: 'pending',
    trading_mode: 'live',
    filled_quantity: 0,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function isValidBrokerOrderResult(result: unknown): result is BrokerOrderResult {
  if (typeof result !== 'object' || result === null) return false;
  const r = result as Record<string, unknown>;
  if (typeof r.broker_order_id !== 'string') return false;
  if (r.status !== 'submitted' && r.status !== 'rejected' && r.status !== 'failed') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbSymbol = fc.constantFrom(
  'AAPL', 'GOOG', 'TSLA', '600519.SH', '000001.SZ',
  '', '!@#$%', 'A'.repeat(200), '   ', '\n\t',
);

const arbSide = fc.constantFrom('buy' as const, 'sell' as const);

const arbOrderType = fc.constantFrom(
  'market' as const, 'limit' as const, 'stop' as const, 'stop_limit' as const,
);

const arbQuantity = fc.oneof(
  fc.integer({ min: 1, max: 100000 }),
  fc.integer({ min: -100, max: 0 }),
  fc.constant(0),
  fc.constant(Number.MAX_SAFE_INTEGER),
);

const arbPrice = fc.oneof(
  fc.double({ min: 0.01, max: 10000, noNaN: true }),
  fc.constant(0),
  fc.constant(-1),
  fc.constant(Infinity),
  fc.constant(NaN),
  fc.constant(undefined as unknown as number),
);

const arbBrokerOrderId = fc.oneof(
  fc.string({ minLength: 0, maxLength: 50 }),
  fc.constant(''),
  fc.constant('nonexistent-id'),
  fc.constant(undefined as unknown as string),
  fc.constant(null as unknown as string),
);

/** Generate a random TradingOrder with various edge-case values */
const arbOrder = fc.record({
  symbol: arbSymbol,
  side: arbSide,
  order_type: arbOrderType,
  quantity: arbQuantity,
  price: arbPrice,
}).map((fields) =>
  makeOrder({
    symbol: fields.symbol,
    side: fields.side,
    order_type: fields.order_type,
    quantity: fields.quantity,
    price: fields.price,
  }),
);

// ---------------------------------------------------------------------------
// Property 13: 券商错误标准化
// ---------------------------------------------------------------------------

describe('TradingGateway Property Tests', () => {
  beforeEach(() => {
    orderCounter = 0;
  });

  /**
   * Feature: quant-trading-broker-integration, Property 13: 券商错误标准化
   * Validates: Requirements 1.5, 1.7
   *
   * For any error type or unexpected response format, the BrokerAdapter
   * (LongportAdapter) always returns a standard BrokerOrderResult with
   * a status field and never throws an uncaught exception.
   */
  describe('Property 13: Broker error standardization', () => {
    it('submitOrder always returns a valid BrokerOrderResult and never throws', async () => {
      const adapter = new LongportAdapter();

      await fc.assert(
        fc.asyncProperty(arbOrder, async (order) => {
          const result = await adapter.submitOrder(order);
          expect(isValidBrokerOrderResult(result)).toBe(true);
          expect(result.status).toBe('failed');
          expect(typeof result.message).toBe('string');
          expect(result.message!.length).toBeGreaterThan(0);
        }),
        { numRuns: 10 },
      );
    });

    it('cancelOrder always returns a valid BrokerOrderResult and never throws', async () => {
      const adapter = new LongportAdapter();

      await fc.assert(
        fc.asyncProperty(arbBrokerOrderId, async (brokerOrderId) => {
          const result = await adapter.cancelOrder(brokerOrderId);
          expect(isValidBrokerOrderResult(result)).toBe(true);
          expect(result.status).toBe('failed');
          expect(typeof result.message).toBe('string');
          expect(result.message!.length).toBeGreaterThan(0);
        }),
        { numRuns: 10 },
      );
    });

    it('getOrderStatus always returns a valid BrokerOrderResult and never throws', async () => {
      const adapter = new LongportAdapter();

      await fc.assert(
        fc.asyncProperty(arbBrokerOrderId, async (brokerOrderId) => {
          const result = await adapter.getOrderStatus(brokerOrderId);
          expect(isValidBrokerOrderResult(result)).toBe(true);
          expect(result.status).toBe('failed');
          expect(typeof result.message).toBe('string');
        }),
        { numRuns: 10 },
      );
    });

    it('getAccount always returns a valid BrokerAccount and never throws', async () => {
      const adapter = new LongportAdapter();

      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 100 }), async () => {
          const account = await adapter.getAccount();
          expect(typeof account).toBe('object');
          expect(account).not.toBeNull();
          expect(typeof account.total_assets).toBe('number');
          expect(typeof account.available_cash).toBe('number');
          expect(typeof account.frozen_cash).toBe('number');
          expect(typeof account.currency).toBe('string');
        }),
        { numRuns: 10 },
      );
    });

    it('getPositions always returns a valid array and never throws', async () => {
      const adapter = new LongportAdapter();

      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 100 }), async () => {
          const positions = await adapter.getPositions();
          expect(Array.isArray(positions)).toBe(true);
        }),
        { numRuns: 10 },
      );
    });

    it('testConnection always returns a boolean and never throws', async () => {
      const adapter = new LongportAdapter();

      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 100 }), async () => {
          const connected = await adapter.testConnection();
          expect(typeof connected).toBe('boolean');
          expect(connected).toBe(false);
        }),
        { numRuns: 10 },
      );
    });
  });
});


// ---------------------------------------------------------------------------
// Property 4: 信号-订单关联追溯
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';
import { initTradingTables } from './tradingSchema';
import { OrderManager } from './OrderManager';
import { RiskController } from './RiskController';
import { PaperTradingEngine } from './PaperTradingEngine';
import { TradingGateway } from './TradingGateway';

// ---------------------------------------------------------------------------
// Helpers for Property 4
// ---------------------------------------------------------------------------

const INITIAL_CAPITAL = 10_000_000;
const COMMISSION_RATE = 0.0003;

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  return db;
}

function setupGateway(db: Database.Database): TradingGateway {
  const orderManager = new OrderManager(db);
  const riskController = new RiskController(db);
  riskController.initDefaultRules();
  const paperEngine = new PaperTradingEngine(db, {
    initial_capital: INITIAL_CAPITAL,
    commission_rate: COMMISSION_RATE,
  });
  const gateway = new TradingGateway(db, orderManager, riskController, paperEngine);

  // Enable auto trading
  db.prepare(
    `INSERT INTO trading_config (key, value, updated_at) VALUES ('auto_trade_enabled', 'true', unixepoch())
     ON CONFLICT(key) DO UPDATE SET value = 'true'`,
  ).run();

  // Initialize paper account with sufficient capital
  db.prepare(
    `INSERT OR REPLACE INTO paper_account (id, initial_capital, available_cash, frozen_cash, commission_rate, updated_at)
     VALUES (1, ${INITIAL_CAPITAL}, ${INITIAL_CAPITAL}, 0, ${COMMISSION_RATE}, unixepoch())`,
  ).run();

  return gateway;
}

// ---------------------------------------------------------------------------
// Arbitraries for Property 4
// ---------------------------------------------------------------------------

const arbSignalSymbol = fc.constantFrom(
  'AAPL', 'GOOG', 'TSLA', 'MSFT', 'AMZN', '600519.SH', '000001.SZ',
);

const arbSignalAction = fc.constantFrom('buy' as const, 'sell' as const);

const arbStrategySignal = fc.record({
  strategy_id: fc.integer({ min: 1, max: 100 }),
  signal_id: fc.integer({ min: 1, max: 100 }),
  symbol: arbSignalSymbol,
  action: arbSignalAction,
  price: fc.double({ min: 1, max: 500, noNaN: true }),
});

// ---------------------------------------------------------------------------
// Property 4 Tests
// ---------------------------------------------------------------------------

/**
 * Feature: quant-trading-broker-integration, Property 4: 信号-订单关联追溯
 * Validates: Requirements 5.1, 5.2
 *
 * For any strategy signal that triggers auto-order generation,
 * the resulting order must contain:
 * - non-empty strategy_id matching the signal's strategy_id
 * - non-empty signal_id matching the signal's signal_id
 * - symbol matching the signal's symbol
 * - side matching the signal's action
 */
describe('Property 4: Signal-order traceability', () => {
  it('auto-generated orders contain correct strategy_id, signal_id, symbol, and side from the signal', async () => {
    await fc.assert(
      fc.asyncProperty(arbStrategySignal, async (signal) => {
        const db = createTestDb();
        try {
          // Seed foreign key references so trading_orders FK constraints pass
          db.prepare('INSERT OR IGNORE INTO strategies (id) VALUES (?)').run(signal.strategy_id);
          db.prepare('INSERT OR IGNORE INTO stock_signals (id) VALUES (?)').run(signal.signal_id);

          const gateway = setupGateway(db);

          if (signal.action === 'sell') {
            // For sell signals, create a position first by buying shares
            const buySigId = signal.signal_id + 200000;
            db.prepare('INSERT OR IGNORE INTO stock_signals (id) VALUES (?)').run(buySigId);
            const buySignal = {
              strategy_id: signal.strategy_id,
              signal_id: buySigId,
              symbol: signal.symbol,
              action: 'buy' as const,
              price: signal.price,
            };
            await gateway.handleSignal(buySignal);
          }

          const order = await gateway.handleSignal(signal);

          // auto_trade_enabled is true, so order should be created
          expect(order).not.toBeNull();

          // strategy_id and signal_id must be present and match
          expect(order!.strategy_id).toBe(signal.strategy_id);
          expect(order!.signal_id).toBe(signal.signal_id);

          // symbol must match
          expect(order!.symbol).toBe(signal.symbol);

          // side must match signal action
          expect(order!.side).toBe(signal.action);
        } finally {
          db.close();
        }
      }),
      { numRuns: 10 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 7: 交易模式隔离
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers for Property 7
// ---------------------------------------------------------------------------

/**
 * A mock BrokerAdapter that tracks whether any of its methods were called.
 * Used to verify paper mode never touches the real broker.
 */
class TrackingBrokerAdapter implements BrokerAdapter {
  readonly name = 'tracking-mock';
  callLog: string[] = [];

  async testConnection(): Promise<boolean> {
    this.callLog.push('testConnection');
    return true;
  }

  async submitOrder(_order: TradingOrder): Promise<BrokerOrderResult> {
    this.callLog.push('submitOrder');
    return {
      broker_order_id: `mock-${Date.now()}`,
      status: 'submitted',
      filled_quantity: _order.quantity,
      filled_price: _order.price ?? 100,
    };
  }

  async cancelOrder(_brokerOrderId: string): Promise<BrokerOrderResult> {
    this.callLog.push('cancelOrder');
    return { broker_order_id: _brokerOrderId, status: 'submitted' };
  }

  async getOrderStatus(_brokerOrderId: string): Promise<BrokerOrderResult> {
    this.callLog.push('getOrderStatus');
    return { broker_order_id: _brokerOrderId, status: 'submitted' };
  }

  async getAccount(): Promise<BrokerAccount> {
    this.callLog.push('getAccount');
    return { total_assets: 5_000_000, available_cash: 3_000_000, frozen_cash: 0, currency: 'CNY' };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    this.callLog.push('getPositions');
    return [];
  }

  /** Reset the call log between runs */
  reset(): void {
    this.callLog = [];
  }
}

function createProp7Db(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  return db;
}

function setupPaperGateway(db: Database.Database, mockBroker: TrackingBrokerAdapter): TradingGateway {
  const orderManager = new OrderManager(db);
  const riskController = new RiskController(db);
  riskController.initDefaultRules();
  // Raise thresholds so risk checks don't block our test orders
  for (const rule of riskController.listRules()) {
    riskController.updateRule(rule.id!, { threshold: 999_999_999 });
  }
  const paperEngine = new PaperTradingEngine(db, {
    initial_capital: INITIAL_CAPITAL,
    commission_rate: COMMISSION_RATE,
  });
  // Pass the mock broker adapter — in paper mode it should never be called
  const gateway = new TradingGateway(db, orderManager, riskController, paperEngine, mockBroker);

  // Ensure mode is paper
  db.prepare(
    `INSERT INTO trading_config (key, value, updated_at) VALUES ('trading_mode', 'paper', unixepoch())
     ON CONFLICT(key) DO UPDATE SET value = 'paper'`,
  ).run();

  db.prepare(
    `INSERT OR REPLACE INTO paper_account (id, initial_capital, available_cash, frozen_cash, commission_rate, updated_at)
     VALUES (1, ${INITIAL_CAPITAL}, ${INITIAL_CAPITAL}, 0, ${COMMISSION_RATE}, unixepoch())`,
  ).run();

  return gateway;
}

function setupLiveGateway(db: Database.Database, mockBroker: TrackingBrokerAdapter): TradingGateway {
  const orderManager = new OrderManager(db);
  const riskController = new RiskController(db);
  riskController.initDefaultRules();
  // Raise thresholds so risk checks don't block our test orders
  for (const rule of riskController.listRules()) {
    riskController.updateRule(rule.id!, { threshold: 999_999_999 });
  }
  const paperEngine = new PaperTradingEngine(db, {
    initial_capital: INITIAL_CAPITAL,
    commission_rate: COMMISSION_RATE,
  });
  const gateway = new TradingGateway(db, orderManager, riskController, paperEngine, mockBroker);

  // Set mode to live
  db.prepare(
    `INSERT INTO trading_config (key, value, updated_at) VALUES ('trading_mode', 'live', unixepoch())
     ON CONFLICT(key) DO UPDATE SET value = 'live'`,
  ).run();

  // Initialize paper_account so we have a baseline to snapshot
  db.prepare(
    `INSERT OR REPLACE INTO paper_account (id, initial_capital, available_cash, frozen_cash, commission_rate, updated_at)
     VALUES (1, ${INITIAL_CAPITAL}, ${INITIAL_CAPITAL}, 0, ${COMMISSION_RATE}, unixepoch())`,
  ).run();

  return gateway;
}

// ---------------------------------------------------------------------------
// Arbitraries for Property 7
// ---------------------------------------------------------------------------

const arbProp7Symbol = fc.constantFrom('AAPL', 'GOOG', 'TSLA', '600519.SH', '000001.SZ');
const arbProp7Side = fc.constantFrom('buy' as const, 'sell' as const);
const arbProp7OrderType = fc.constantFrom('market' as const, 'limit' as const);

const arbProp7OrderRequest = fc.record({
  symbol: arbProp7Symbol,
  side: arbProp7Side,
  order_type: arbProp7OrderType,
  quantity: fc.integer({ min: 1, max: 500 }),
  price: fc.double({ min: 1, max: 200, noNaN: true }),
});

// ---------------------------------------------------------------------------
// Property 7 Tests
// ---------------------------------------------------------------------------

/**
 * Feature: quant-trading-broker-integration, Property 7: 交易模式隔离
 * Validates: Requirements 8.2, 4.8
 *
 * - In paper mode: BrokerAdapter methods are NOT called, and orders have trading_mode='paper'
 * - In live mode: paper_account and paper_positions tables are NOT modified
 */
describe('Property 7: Trading mode isolation', () => {
  it('paper mode: BrokerAdapter methods are never called and orders have trading_mode=paper', async () => {
    await fc.assert(
      fc.asyncProperty(arbProp7OrderRequest, async (req) => {
        const db = createProp7Db();
        const mockBroker = new TrackingBrokerAdapter();
        try {
          const gateway = setupPaperGateway(db, mockBroker);

          // Only place buy orders to avoid needing existing positions for sells
          const buyReq: CreateOrderRequest = { ...req, side: 'buy' };
          const order = await gateway.placeOrder(buyReq);

          // BrokerAdapter methods should NOT have been called (excluding getAccount/getPositions
          // which are used internally for risk checks — those route to paperEngine in paper mode)
          const brokerTradingCalls = mockBroker.callLog.filter(
            (c) => c === 'submitOrder' || c === 'cancelOrder' || c === 'getOrderStatus',
          );
          expect(brokerTradingCalls).toEqual([]);

          // Order should have trading_mode = 'paper'
          expect(order.trading_mode).toBe('paper');

          // Verify via DB as well
          const dbOrder = db
            .prepare('SELECT trading_mode FROM trading_orders WHERE id = ?')
            .get(order.id) as { trading_mode: string } | undefined;
          expect(dbOrder).toBeDefined();
          expect(dbOrder!.trading_mode).toBe('paper');

          mockBroker.reset();
        } finally {
          db.close();
        }
      }),
      { numRuns: 10 },
    );
  });

  it('live mode: paper_account and paper_positions tables are not modified', async () => {
    await fc.assert(
      fc.asyncProperty(arbProp7OrderRequest, async (req) => {
        const db = createProp7Db();
        const mockBroker = new TrackingBrokerAdapter();
        try {
          const gateway = setupLiveGateway(db, mockBroker);

          // Snapshot paper_account before
          const paperAccountBefore = db
            .prepare('SELECT * FROM paper_account WHERE id = 1')
            .get() as Record<string, unknown> | undefined;

          // Snapshot paper_positions before
          const paperPositionsBefore = db
            .prepare('SELECT * FROM paper_positions ORDER BY symbol')
            .all() as Array<Record<string, unknown>>;

          // Place a buy order in live mode
          const buyReq: CreateOrderRequest = { ...req, side: 'buy' };
          await gateway.placeOrder(buyReq);

          // Snapshot paper_account after
          const paperAccountAfter = db
            .prepare('SELECT initial_capital, available_cash, frozen_cash, commission_rate FROM paper_account WHERE id = 1')
            .get() as Record<string, unknown> | undefined;

          // Snapshot paper_positions after
          const paperPositionsAfter = db
            .prepare('SELECT * FROM paper_positions ORDER BY symbol')
            .all() as Array<Record<string, unknown>>;

          // paper_account should not have changed (compare key financial fields)
          const beforeFields = paperAccountBefore
            ? {
                initial_capital: paperAccountBefore.initial_capital,
                available_cash: paperAccountBefore.available_cash,
                frozen_cash: paperAccountBefore.frozen_cash,
                commission_rate: paperAccountBefore.commission_rate,
              }
            : undefined;
          expect(paperAccountAfter).toEqual(beforeFields);

          // paper_positions should not have changed
          expect(paperPositionsAfter).toEqual(paperPositionsBefore);
        } finally {
          db.close();
        }
      }),
      { numRuns: 10 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 8: 审计日志完整性
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Arbitraries for Property 8
// ---------------------------------------------------------------------------

const arbProp8Symbol = fc.constantFrom('AAPL', 'GOOG', 'TSLA', '600519.SH', '000001.SZ');
const arbProp8OrderType = fc.constantFrom('market' as const, 'limit' as const);

const arbProp8BuyRequest = fc.record({
  symbol: arbProp8Symbol,
  order_type: arbProp8OrderType,
  quantity: fc.integer({ min: 1, max: 100 }),
  price: fc.double({ min: 10, max: 200, noNaN: true }),
}).map((r) => ({
  ...r,
  side: 'buy' as const,
}));

/**
 * Generates a sequence of trading operations:
 * - 'place': place a buy order
 * - 'cancel': cancel the most recently placed order (if cancellable)
 */
const arbProp8OpSequence = fc.array(
  fc.record({
    op: fc.constantFrom('place' as const, 'cancel' as const),
    request: arbProp8BuyRequest,
  }),
  { minLength: 1, maxLength: 5 },
);

// ---------------------------------------------------------------------------
// Property 8 Tests
// ---------------------------------------------------------------------------

/**
 * Feature: quant-trading-broker-integration, Property 8: 审计日志完整性
 * Validates: Requirements 1.6, 7.11
 *
 * For any sequence of fund-related trading operations (placeOrder, cancelOrder),
 * every operation must have a corresponding record in trading_audit_log, and
 * the audit record's timestamp must be <= the operation completion time.
 */
describe('Property 8: Audit log completeness', () => {
  it('every placeOrder and cancelOrder produces audit log entries with valid timestamps', async () => {
    await fc.assert(
      fc.asyncProperty(arbProp8OpSequence, async (ops) => {
        const db = createTestDb();
        try {
          const gateway = setupGateway(db);

          // Raise risk thresholds so orders are not blocked
          const rc = new RiskController(db);
          for (const rule of rc.listRules()) {
            rc.updateRule(rule.id!, { threshold: 999_999_999 });
          }

          const placedOrderIds: number[] = [];

          for (const { op, request } of ops) {
            const beforeTime = Math.floor(Date.now() / 1000);

            if (op === 'place') {
              const order = await gateway.placeOrder(request);
              const afterTime = Math.floor(Date.now() / 1000);

              // Verify audit log entry exists for this order
              const auditRows = db
                .prepare(
                  'SELECT * FROM trading_audit_log WHERE order_id = ? AND operation LIKE ?',
                )
                .all(order.id, 'place_order%') as Array<{
                id: number;
                timestamp: number;
                operation: string;
                order_id: number;
              }>;

              expect(auditRows.length).toBeGreaterThanOrEqual(1);

              // Verify timestamp is valid: beforeTime <= timestamp <= afterTime
              for (const row of auditRows) {
                expect(row.timestamp).toBeGreaterThanOrEqual(beforeTime);
                expect(row.timestamp).toBeLessThanOrEqual(afterTime + 1); // +1s tolerance
              }

              // Track for potential cancel
              if (order.status === 'submitted' || order.status === 'partial_filled') {
                placedOrderIds.push(order.id!);
              }
            } else if (op === 'cancel' && placedOrderIds.length > 0) {
              const orderId = placedOrderIds.pop()!;
              const cancelled = await gateway.cancelOrder(orderId);
              const afterTime = Math.floor(Date.now() / 1000);

              // Verify audit log entry exists for cancel
              const auditRows = db
                .prepare(
                  'SELECT * FROM trading_audit_log WHERE order_id = ? AND operation = ?',
                )
                .all(cancelled.id, 'cancel_order') as Array<{
                id: number;
                timestamp: number;
                operation: string;
                order_id: number;
              }>;

              expect(auditRows.length).toBeGreaterThanOrEqual(1);

              // Verify timestamp
              for (const row of auditRows) {
                expect(row.timestamp).toBeGreaterThanOrEqual(beforeTime);
                expect(row.timestamp).toBeLessThanOrEqual(afterTime + 1);
              }
            }
          }

          // Final global check: every order in trading_orders should have at least one audit entry
          const allOrders = db
            .prepare('SELECT id FROM trading_orders')
            .all() as Array<{ id: number }>;

          for (const { id } of allOrders) {
            const auditCount = db
              .prepare('SELECT COUNT(*) as cnt FROM trading_audit_log WHERE order_id = ?')
              .get(id) as { cnt: number };
            expect(auditCount.cnt).toBeGreaterThanOrEqual(1);
          }
        } finally {
          db.close();
        }
      }),
      { numRuns: 10 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 14: 下单数量计算正确性
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Arbitraries for Property 14
// ---------------------------------------------------------------------------

const arbPositivePrice = fc.double({ min: 0.01, max: 10000, noNaN: true });

const arbFixedAmountParams = fc.record({
  price: arbPositivePrice,
  fixed_amount: fc.double({ min: 1, max: 1_000_000, noNaN: true }),
});

const arbFixedQuantityParams = fc.record({
  price: arbPositivePrice,
  fixed_quantity: fc.integer({ min: 1, max: 100_000 }),
});

const arbKellyParams = fc.record({
  price: arbPositivePrice,
  kelly_fraction: fc.double({ min: 0.01, max: 1, noNaN: true }),
  total_assets: fc.double({ min: 1, max: 100_000_000, noNaN: true }),
});

// ---------------------------------------------------------------------------
// Property 14 Tests
// ---------------------------------------------------------------------------

/**
 * Feature: quant-trading-broker-integration, Property 14: 下单数量计算正确性
 * Validates: Requirements 5.6
 *
 * For any positive price and config parameters:
 * - fixed_amount mode: quantity = floor(amount / price), minimum 1
 * - fixed_quantity mode: returns the configured fixed value, minimum 1
 * - kelly mode: quantity = floor((kelly_fraction * total_assets) / price), minimum 1
 * - All results are positive integers (>= 1)
 */
describe('Property 14: Order quantity calculation correctness', () => {
  it('fixed_amount mode: quantity = max(1, floor(amount / price))', () => {
    const db = createTestDb();
    try {
      const gateway = setupGateway(db);

      fc.assert(
        fc.property(arbFixedAmountParams, ({ price, fixed_amount }) => {
          const qty = gateway.calculateQuantity(price, 'fixed_amount', { fixed_amount });
          const expected = Math.max(1, Math.floor(Math.floor(fixed_amount / price)));

          expect(qty).toBe(expected);
          expect(qty).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(qty)).toBe(true);
        }),
        { numRuns: 10 },
      );
    } finally {
      db.close();
    }
  });

  it('fixed_quantity mode: returns the configured fixed value, minimum 1', () => {
    const db = createTestDb();
    try {
      const gateway = setupGateway(db);

      fc.assert(
        fc.property(arbFixedQuantityParams, ({ price, fixed_quantity }) => {
          const qty = gateway.calculateQuantity(price, 'fixed_quantity', { fixed_quantity });
          const expected = Math.max(1, Math.floor(fixed_quantity));

          expect(qty).toBe(expected);
          expect(qty).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(qty)).toBe(true);
        }),
        { numRuns: 10 },
      );
    } finally {
      db.close();
    }
  });

  it('kelly mode: quantity = max(1, floor((kelly_fraction * total_assets) / price))', () => {
    const db = createTestDb();
    try {
      const gateway = setupGateway(db);

      fc.assert(
        fc.property(arbKellyParams, ({ price, kelly_fraction, total_assets }) => {
          const qty = gateway.calculateQuantity(price, 'kelly', { kelly_fraction, total_assets });
          const expected = Math.max(1, Math.floor(Math.floor((kelly_fraction * total_assets) / price)));

          expect(qty).toBe(expected);
          expect(qty).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(qty)).toBe(true);
        }),
        { numRuns: 10 },
      );
    } finally {
      db.close();
    }
  });

  it('all modes return positive integers (>= 1)', () => {
    const db = createTestDb();
    try {
      const gateway = setupGateway(db);

      const arbMode = fc.constantFrom('fixed_amount', 'fixed_quantity', 'kelly', 'unknown_mode');
      const arbParams = fc.record({
        fixed_quantity: fc.integer({ min: 1, max: 100_000 }),
        fixed_amount: fc.double({ min: 1, max: 1_000_000, noNaN: true }),
        kelly_fraction: fc.double({ min: 0.01, max: 1, noNaN: true }),
        total_assets: fc.double({ min: 1, max: 100_000_000, noNaN: true }),
      });

      fc.assert(
        fc.property(arbPositivePrice, arbMode, arbParams, (price, mode, params) => {
          const qty = gateway.calculateQuantity(price, mode, params);

          expect(qty).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(qty)).toBe(true);
        }),
        { numRuns: 10 },
      );
    } finally {
      db.close();
    }
  });
});


// ---------------------------------------------------------------------------
// Property 15: 交易配置持久化往返
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Arbitraries for Property 15
// ---------------------------------------------------------------------------

const arbTradingMode = fc.constantFrom('paper' as const, 'live' as const);

const arbTradingConfig = fc.record({
  trading_mode: arbTradingMode,
  auto_trade_enabled: fc.boolean(),
  broker_name: fc.string({ minLength: 1, maxLength: 50 }),
  paper_initial_capital: fc.double({ min: 0.01, max: 100_000_000, noNaN: true }),
  paper_commission_rate: fc.double({ min: 0, max: 1, noNaN: true }),
  sync_interval_seconds: fc.integer({ min: 1, max: 86400 }),
});

// ---------------------------------------------------------------------------
// Property 15 Tests
// ---------------------------------------------------------------------------

/**
 * Feature: quant-trading-broker-integration, Property 15: 交易配置持久化往返
 * Validates: Requirements 8.4
 *
 * For any valid trading config, after writing to trading_config table via
 * updateConfig, reading back via getConfig returns the same values.
 */
describe('Property 15: Trading config persistence round-trip', () => {
  it('writing a config via updateConfig and reading back via getConfig returns the same values', () => {
    fc.assert(
      fc.property(arbTradingConfig, (config) => {
        const db = createTestDb();
        try {
          const gateway = setupGateway(db);

          // Write the config
          gateway.updateConfig(config);

          // Read it back
          const readBack = gateway.getConfig();

          // Verify each field matches
          expect(readBack.trading_mode).toBe(config.trading_mode);
          expect(readBack.auto_trade_enabled).toBe(config.auto_trade_enabled);
          expect(readBack.broker_name).toBe(config.broker_name);
          expect(readBack.paper_initial_capital).toBe(config.paper_initial_capital);
          expect(readBack.paper_commission_rate).toBe(config.paper_commission_rate);
          expect(readBack.sync_interval_seconds).toBe(config.sync_interval_seconds);
        } finally {
          db.close();
        }
      }),
      { numRuns: 10 },
    );
  });
});
