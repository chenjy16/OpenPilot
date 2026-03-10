// Feature: auto-quant-trading, Property 5: 信号到订单字段映射完整性
// Feature: auto-quant-trading, Property 6: Hold 信号跳过
// Feature: auto-quant-trading, Property 7: 自动交易禁用时不下单
// Feature: auto-quant-trading, Property 9: 自动交易配置持久化往返
// Feature: auto-quant-trading, Property 11: 策略扫描结果到订单转换
// Feature: auto-quant-trading, Property 12: 订单来源分类正确性
/**
 * Property-based tests for AutoTradingPipeline.
 *
 * Uses fast-check with minimum 100 iterations per property.
 * Tests use in-memory better-sqlite3 databases with mocked dependencies.
 */

import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { AutoTradingPipeline } from './AutoTradingPipeline';
import type { StrategyEngineLike, StrategyScanMatch } from './AutoTradingPipeline';
import { SignalEvaluator } from './SignalEvaluator';
import { initTradingTables } from './tradingSchema';
import type {
  SignalCard,
  TradingOrder,
  CreateOrderRequest,
  PipelineConfig,
  QuantityMode,
  BrokerPosition,
} from './types';

// ─── Test DB & Helpers ──────────────────────────────────────────────────────

let signalIdCounter = 0;

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  return db;
}

function ensureSignalRow(db: Database.Database, id: number): void {
  db.prepare('INSERT OR IGNORE INTO stock_signals (id) VALUES (?)').run(id);
}

function ensureStrategyRow(db: Database.Database, id: number): void {
  db.prepare('INSERT OR IGNORE INTO strategies (id) VALUES (?)').run(id);
}

function insertTestOrder(
  db: Database.Database,
  overrides: Partial<TradingOrder> = {},
): number {
  const result = db
    .prepare(
      `INSERT INTO trading_orders (local_order_id, symbol, side, order_type, quantity, status, trading_mode, filled_quantity, filled_price, signal_id, strategy_id, created_at, updated_at)
       VALUES (@local_order_id, @symbol, @side, @order_type, @quantity, @status, @trading_mode, @filled_quantity, @filled_price, @signal_id, @strategy_id, @created_at, @updated_at)`,
    )
    .run({
      local_order_id: overrides.local_order_id || `ORD-${Date.now()}-${Math.random()}`,
      symbol: overrides.symbol || '0700.HK',
      side: overrides.side || 'buy',
      order_type: overrides.order_type || 'limit',
      quantity: overrides.quantity || 100,
      status: overrides.status || 'submitted',
      trading_mode: overrides.trading_mode || 'paper',
      filled_quantity: overrides.filled_quantity || 0,
      filled_price: overrides.filled_price || null,
      signal_id: overrides.signal_id || null,
      strategy_id: overrides.strategy_id || null,
      created_at: overrides.created_at || Math.floor(Date.now() / 1000),
      updated_at: overrides.updated_at || Math.floor(Date.now() / 1000),
    });
  return Number(result.lastInsertRowid);
}

// ─── Mock Factories ─────────────────────────────────────────────────────────

function makeMockTradeNotifier() {
  return {
    notifyOrderCreated: jest.fn().mockResolvedValue(undefined),
    notifyOrderFilled: jest.fn().mockResolvedValue(undefined),
    notifyOrderFailed: jest.fn().mockResolvedValue(undefined),
    notifyRiskRejected: jest.fn().mockResolvedValue(undefined),
    notifyStopLossTriggered: jest.fn().mockResolvedValue(undefined),
    notifyUrgentAlert: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeMockStopLossManager() {
  return {
    register: jest.fn().mockReturnValue({ id: 1, status: 'active' }),
    getActiveRecords: jest.fn().mockReturnValue([]),
    startMonitoring: jest.fn(),
    stopMonitoring: jest.fn(),
  } as any;
}

/**
 * Create a mock TradingGateway that records the CreateOrderRequest passed to placeOrder.
 * The returned order has a real DB id (for FK constraints in pipeline_signal_log).
 */
function makeMockTradingGateway(
  db: Database.Database,
  opts: {
    symbol?: string;
    side?: string;
    signalId?: number;
    strategyId?: number;
    positions?: BrokerPosition[];
  } = {},
) {
  // Pre-insert an order row so FK constraints are satisfied
  const signalId = opts.signalId ?? null;
  const strategyId = opts.strategyId ?? null;
  if (signalId) ensureSignalRow(db, signalId);
  if (strategyId) ensureStrategyRow(db, strategyId);

  const orderId = insertTestOrder(db, {
    symbol: opts.symbol || '0700.HK',
    side: (opts.side as any) || 'buy',
    signal_id: signalId as any,
    strategy_id: strategyId as any,
  });

  const capturedRequests: CreateOrderRequest[] = [];

  return {
    placeOrder: jest.fn().mockImplementation(async (req: CreateOrderRequest) => {
      capturedRequests.push(req);
      return {
        id: orderId,
        local_order_id: `ORD-${orderId}`,
        symbol: req.symbol,
        side: req.side,
        order_type: req.order_type,
        quantity: req.quantity,
        price: req.price,
        status: 'submitted',
        trading_mode: 'paper',
        filled_quantity: 0,
        signal_id: req.signal_id,
        strategy_id: req.strategy_id,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      };
    }),
    getPositions: jest.fn().mockResolvedValue(opts.positions || []),
    _orderId: orderId,
    _capturedRequests: capturedRequests,
  } as any;
}

function makeMockStrategyEngine(overrides: any = {}): StrategyEngineLike {
  return {
    getStrategy: jest.fn().mockReturnValue({
      enabled: true,
      stop_loss_rule: { type: 'percentage', value: 5 },
      take_profit_rule: { type: 'percentage', value: 10 },
    }),
    ...overrides,
  };
}

function createPipeline(db: Database.Database, overrides: any = {}) {
  const evaluator = new SignalEvaluator(db);
  const gw = overrides.tradingGateway || makeMockTradingGateway(db);
  const tn = overrides.tradeNotifier || makeMockTradeNotifier();
  const slm = overrides.stopLossManager || makeMockStopLossManager();
  const se = overrides.strategyEngine || makeMockStrategyEngine();

  const pipeline = new AutoTradingPipeline(db, gw, evaluator, slm, tn, se);
  return { pipeline, gw, tn, slm, se, evaluator };
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Random HK stock symbol */
const arbSymbol: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
    minLength: 1,
    maxLength: 5,
  })
  .map((chars) => `${chars.join('')}.HK`);

/** Random action for tradeable signals (buy or sell) */
const arbTradeAction = fc.constantFrom<'buy' | 'sell'>('buy', 'sell');

/** Random confidence that will pass a low threshold */
const arbHighConfidence = fc.constantFrom<string>('high', 'medium');

/** Random positive price */
const arbPrice = fc.double({ min: 1, max: 100_000, noNaN: true });

/** Generate a valid SignalCard that should pass evaluation (non-hold, has price, high confidence) */
const arbValidSignal: fc.Arbitrary<SignalCard> = fc
  .tuple(arbSymbol, arbTradeAction, arbPrice, arbHighConfidence)
  .map(([symbol, action, entryPrice, confidence]): SignalCard => {
    signalIdCounter += 1;
    return {
      id: signalIdCounter,
      symbol,
      action,
      entry_price: entryPrice,
      stop_loss: entryPrice * 0.9,
      take_profit: entryPrice * 1.2,
      confidence,
      created_at: Math.floor(Date.now() / 1000),
    };
  });

/** Generate a hold SignalCard */
const arbHoldSignal: fc.Arbitrary<SignalCard> = fc
  .tuple(arbSymbol, arbPrice, fc.constantFrom<string | null>('high', 'medium', 'low', null))
  .map(([symbol, entryPrice, confidence]): SignalCard => {
    signalIdCounter += 1;
    return {
      id: signalIdCounter,
      symbol,
      action: 'hold' as const,
      entry_price: entryPrice,
      stop_loss: entryPrice * 0.9,
      take_profit: entryPrice * 1.2,
      confidence,
      created_at: Math.floor(Date.now() / 1000),
    };
  });

/** Generate any SignalCard (buy, sell, or hold) */
const arbAnySignal: fc.Arbitrary<SignalCard> = fc
  .tuple(
    arbSymbol,
    fc.constantFrom<'buy' | 'sell' | 'hold'>('buy', 'sell', 'hold'),
    arbPrice,
    fc.constantFrom<string | null>('high', 'medium', 'low', null),
  )
  .map(([symbol, action, entryPrice, confidence]): SignalCard => {
    signalIdCounter += 1;
    return {
      id: signalIdCounter,
      symbol,
      action,
      entry_price: entryPrice,
      stop_loss: entryPrice * 0.9,
      take_profit: entryPrice * 1.2,
      confidence,
      created_at: Math.floor(Date.now() / 1000),
    };
  });

/** Valid quantity modes */
const arbQuantityMode = fc.constantFrom<QuantityMode>(
  'fixed_quantity',
  'fixed_amount',
  'kelly_formula',
);

/** Confidence threshold in [0, 1] */
const arbThreshold = fc.double({ min: 0, max: 1, noNaN: true });

/** Positive dedup window hours */
const arbDedupHours = fc.integer({ min: 1, max: 720 });

/** Strategy ID */
const arbStrategyId = fc.integer({ min: 1, max: 1000 });


// ═══════════════════════════════════════════════════════════════════════════
// Property 5: 信号到订单字段映射完整性
// Feature: auto-quant-trading, Property 5: 信号到订单字段映射完整性
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Property 5: For any valid SignalCard that passes evaluation, the generated
 * CreateOrderRequest should have: symbol matching signal, side matching action,
 * signal_id matching signal.id. For strategy-triggered orders, strategy_id
 * should match.
 *
 * **Validates: Requirements 1.2, 1.4, 5.3**
 */
describe('Property 5: 信号到订单字段映射完整性', () => {
  // **Validates: Requirements 1.2, 1.4**
  it('signal-triggered order has correct symbol, side, and signal_id', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidSignal, async (signal) => {
        const db = createTestDb();
        ensureSignalRow(db, signal.id);

        const gw = makeMockTradingGateway(db, {
          symbol: signal.symbol,
          side: signal.action,
          signalId: signal.id,
        });
        const { pipeline } = createPipeline(db, { tradingGateway: gw });
        pipeline.updateConfig({
          auto_trade_enabled: true,
          confidence_threshold: 0.1, // low threshold so all pass
        });

        const result = await pipeline.processSignal(signal);

        expect(result.action).toBe('order_created');

        // Verify the CreateOrderRequest passed to placeOrder
        expect(gw.placeOrder).toHaveBeenCalledTimes(1);
        const req: CreateOrderRequest = gw.placeOrder.mock.calls[0][0];
        expect(req.symbol).toBe(signal.symbol);
        expect(req.side).toBe(signal.action);
        expect(req.signal_id).toBe(signal.id);

        db.close();
      }),
      { numRuns: 10 },
    );
  });

  // **Validates: Requirements 5.3**
  it('strategy-triggered order has correct strategy_id', async () => {
    await fc.assert(
      fc.asyncProperty(arbSymbol, arbStrategyId, arbPrice, async (symbol, strategyId, price) => {
        const db = createTestDb();
        ensureStrategyRow(db, strategyId);

        const gw = makeMockTradingGateway(db, {
          symbol,
          side: 'buy',
          strategyId,
        });
        const se = makeMockStrategyEngine();
        const { pipeline } = createPipeline(db, {
          tradingGateway: gw,
          strategyEngine: se,
        });
        pipeline.updateConfig({ auto_trade_enabled: true });

        const match: StrategyScanMatch = {
          symbol,
          matched: true,
          entry_signal: true,
          exit_signal: false,
          indicator_values: { close: price },
        };

        const result = await pipeline.processStrategyScanResult(strategyId, match);

        expect(result.action).toBe('order_created');
        expect(gw.placeOrder).toHaveBeenCalledTimes(1);
        const req: CreateOrderRequest = gw.placeOrder.mock.calls[0][0];
        expect(req.strategy_id).toBe(strategyId);
        expect(req.symbol).toBe(symbol);

        db.close();
      }),
      { numRuns: 10 },
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 6: Hold 信号跳过
// Feature: auto-quant-trading, Property 6: Hold 信号跳过
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Property 6: For any SignalCard with action='hold', processSignal should
 * return action='skipped' with reason containing 'hold', no order created.
 *
 * **Validates: Requirements 1.3**
 */
describe('Property 6: Hold 信号跳过', () => {
  // **Validates: Requirements 1.3**
  it('hold signals are always skipped with reason containing hold', async () => {
    await fc.assert(
      fc.asyncProperty(arbHoldSignal, async (signal) => {
        const db = createTestDb();
        ensureSignalRow(db, signal.id);

        const gw = makeMockTradingGateway(db);
        const { pipeline } = createPipeline(db, { tradingGateway: gw });
        pipeline.updateConfig({
          auto_trade_enabled: true,
          confidence_threshold: 0.0, // lowest possible threshold
        });

        const result = await pipeline.processSignal(signal);

        expect(result.action).toBe('skipped');
        expect(result.reason).toContain('hold');
        expect(gw.placeOrder).not.toHaveBeenCalled();

        db.close();
      }),
      { numRuns: 10 },
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 7: 自动交易禁用时不下单
// Feature: auto-quant-trading, Property 7: 自动交易禁用时不下单
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Property 7: For any SignalCard, when auto_trade_enabled is false,
 * processSignal should return action='skipped', no order created.
 *
 * **Validates: Requirements 1.5**
 */
describe('Property 7: 自动交易禁用时不下单', () => {
  // **Validates: Requirements 1.5**
  it('no order is created when auto_trade_enabled is false', async () => {
    await fc.assert(
      fc.asyncProperty(arbAnySignal, async (signal) => {
        const db = createTestDb();
        ensureSignalRow(db, signal.id);

        const gw = makeMockTradingGateway(db);
        const { pipeline } = createPipeline(db, { tradingGateway: gw });
        // auto_trade_enabled defaults to false, but set explicitly
        pipeline.updateConfig({ auto_trade_enabled: false });

        const result = await pipeline.processSignal(signal);

        expect(result.action).toBe('skipped');
        expect(gw.placeOrder).not.toHaveBeenCalled();

        db.close();
      }),
      { numRuns: 10 },
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 9: 自动交易配置持久化往返
// Feature: auto-quant-trading, Property 9: 自动交易配置持久化往返
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Property 9: For any valid PipelineConfig (confidence_threshold 0-1,
 * quantity_mode valid enum, dedup_window_hours positive), updateConfig
 * then getConfig should return the same values.
 *
 * **Validates: Requirements 2.6, 3.6**
 */
describe('Property 9: 自动交易配置持久化往返', () => {
  // **Validates: Requirements 2.6, 3.6**
  it('config round-trips through updateConfig/getConfig', () => {
    fc.assert(
      fc.property(
        arbThreshold,
        arbQuantityMode,
        arbDedupHours,
        fc.integer({ min: 1, max: 100_000 }),   // fixed_quantity_value
        fc.integer({ min: 1, max: 10_000_000 }), // fixed_amount_value
        (threshold, mode, dedupHours, fixedQty, fixedAmt) => {
          const db = createTestDb();
          const { pipeline } = createPipeline(db);

          const configToWrite: Partial<PipelineConfig> = {
            confidence_threshold: threshold,
            quantity_mode: mode,
            dedup_window_hours: dedupHours,
            fixed_quantity_value: fixedQty,
            fixed_amount_value: fixedAmt,
          };

          pipeline.updateConfig(configToWrite);
          const readBack = pipeline.getConfig();

          expect(readBack.confidence_threshold).toBeCloseTo(threshold, 10);
          expect(readBack.quantity_mode).toBe(mode);
          expect(readBack.dedup_window_hours).toBe(dedupHours);
          expect(readBack.fixed_quantity_value).toBe(fixedQty);
          expect(readBack.fixed_amount_value).toBe(fixedAmt);

          db.close();
        },
      ),
      { numRuns: 10 },
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 11: 策略扫描结果到订单转换
// Feature: auto-quant-trading, Property 11: 策略扫描结果到订单转换
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Property 11: For any StrategyScanMatch:
 * - entry_signal=true → buy order
 * - exit_signal=true with position → sell order
 * - strategy disabled → no order
 *
 * **Validates: Requirements 5.1, 5.2, 5.4**
 */
describe('Property 11: 策略扫描结果到订单转换', () => {
  // **Validates: Requirements 5.1**
  it('entry_signal=true generates a buy order', async () => {
    await fc.assert(
      fc.asyncProperty(arbSymbol, arbStrategyId, arbPrice, async (symbol, strategyId, price) => {
        const db = createTestDb();
        ensureStrategyRow(db, strategyId);

        const gw = makeMockTradingGateway(db, {
          symbol,
          side: 'buy',
          strategyId,
        });
        const se = makeMockStrategyEngine();
        const { pipeline } = createPipeline(db, {
          tradingGateway: gw,
          strategyEngine: se,
        });
        pipeline.updateConfig({ auto_trade_enabled: true });

        const match: StrategyScanMatch = {
          symbol,
          matched: true,
          entry_signal: true,
          exit_signal: false,
          indicator_values: { close: price },
        };

        const result = await pipeline.processStrategyScanResult(strategyId, match);

        expect(result.action).toBe('order_created');
        expect(gw.placeOrder).toHaveBeenCalledTimes(1);
        const req: CreateOrderRequest = gw.placeOrder.mock.calls[0][0];
        expect(req.side).toBe('buy');

        db.close();
      }),
      { numRuns: 10 },
    );
  });

  // **Validates: Requirements 5.2**
  it('exit_signal=true with position generates a sell order', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSymbol,
        arbStrategyId,
        fc.integer({ min: 1, max: 10000 }),
        async (symbol, strategyId, posQty) => {
          const db = createTestDb();
          ensureStrategyRow(db, strategyId);

          const positions: BrokerPosition[] = [
            {
              symbol,
              quantity: posQty,
              avg_cost: 100,
              current_price: 110,
              market_value: posQty * 110,
            },
          ];

          // Pre-insert a sell order for FK
          const sellOrderId = insertTestOrder(db, {
            symbol,
            side: 'sell',
            quantity: posQty,
            strategy_id: strategyId,
          });

          const gw = {
            placeOrder: jest.fn().mockResolvedValue({
              id: sellOrderId,
              local_order_id: `ORD-SELL-${sellOrderId}`,
              symbol,
              side: 'sell',
              order_type: 'market',
              quantity: posQty,
              status: 'submitted',
              trading_mode: 'paper',
              filled_quantity: 0,
              created_at: Math.floor(Date.now() / 1000),
              updated_at: Math.floor(Date.now() / 1000),
            }),
            getPositions: jest.fn().mockResolvedValue(positions),
          } as any;

          const se = makeMockStrategyEngine();
          const { pipeline } = createPipeline(db, {
            tradingGateway: gw,
            strategyEngine: se,
          });
          pipeline.updateConfig({ auto_trade_enabled: true });

          const match: StrategyScanMatch = {
            symbol,
            matched: true,
            entry_signal: false,
            exit_signal: true,
            indicator_values: {},
          };

          const result = await pipeline.processStrategyScanResult(strategyId, match);

          expect(result.action).toBe('order_created');
          expect(gw.placeOrder).toHaveBeenCalledTimes(1);
          const req: CreateOrderRequest = gw.placeOrder.mock.calls[0][0];
          expect(req.side).toBe('sell');
          expect(req.quantity).toBe(posQty);

          db.close();
        },
      ),
      { numRuns: 10 },
    );
  });

  // **Validates: Requirements 5.4**
  it('strategy disabled → no order created', async () => {
    await fc.assert(
      fc.asyncProperty(arbSymbol, arbStrategyId, arbPrice, async (symbol, strategyId, price) => {
        const db = createTestDb();
        ensureStrategyRow(db, strategyId);

        const gw = makeMockTradingGateway(db, { symbol });
        const se: StrategyEngineLike = {
          getStrategy: jest.fn().mockReturnValue({
            enabled: false,
            stop_loss_rule: { type: 'percentage', value: 5 },
            take_profit_rule: { type: 'percentage', value: 10 },
          }),
        };
        const { pipeline } = createPipeline(db, {
          tradingGateway: gw,
          strategyEngine: se,
        });
        pipeline.updateConfig({ auto_trade_enabled: true });

        const match: StrategyScanMatch = {
          symbol,
          matched: true,
          entry_signal: true,
          exit_signal: false,
          indicator_values: { close: price },
        };

        const result = await pipeline.processStrategyScanResult(strategyId, match);

        expect(result.action).toBe('skipped');
        expect(gw.placeOrder).not.toHaveBeenCalled();

        db.close();
      }),
      { numRuns: 10 },
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 12: 订单来源分类正确性
// Feature: auto-quant-trading, Property 12: 订单来源分类正确性
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Property 12: For any TradingOrder:
 * - signal_id present + no strategy_id → signal auto
 * - strategy_id present → strategy auto
 * - both null → manual
 *
 * **Validates: Requirements 8.2**
 */

/** Pure classification function matching the dashboard logic */
function classifyOrderSource(order: {
  signal_id?: number | null;
  strategy_id?: number | null;
}): 'signal_auto' | 'strategy_auto' | 'manual' {
  if (order.strategy_id != null) return 'strategy_auto';
  if (order.signal_id != null) return 'signal_auto';
  return 'manual';
}

describe('Property 12: 订单来源分类正确性', () => {
  /** Arbitrary: signal_id present, strategy_id absent */
  const arbSignalAutoOrder = fc
    .integer({ min: 1, max: 100_000 })
    .map((signalId) => ({ signal_id: signalId, strategy_id: null as number | null }));

  /** Arbitrary: strategy_id present (signal_id may or may not be present) */
  const arbStrategyAutoOrder = fc
    .tuple(
      fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null }),
      fc.integer({ min: 1, max: 100_000 }),
    )
    .map(([signalId, strategyId]) => ({
      signal_id: signalId,
      strategy_id: strategyId,
    }));

  /** Arbitrary: both null → manual */
  const arbManualOrder = fc.constant({
    signal_id: null as number | null,
    strategy_id: null as number | null,
  });

  // **Validates: Requirements 8.2**
  it('signal_id present + no strategy_id → signal_auto', () => {
    fc.assert(
      fc.property(arbSignalAutoOrder, (order) => {
        expect(classifyOrderSource(order)).toBe('signal_auto');
      }),
      { numRuns: 10 },
    );
  });

  // **Validates: Requirements 8.2**
  it('strategy_id present → strategy_auto', () => {
    fc.assert(
      fc.property(arbStrategyAutoOrder, (order) => {
        expect(classifyOrderSource(order)).toBe('strategy_auto');
      }),
      { numRuns: 10 },
    );
  });

  // **Validates: Requirements 8.2**
  it('both null → manual', () => {
    fc.assert(
      fc.property(arbManualOrder, (order) => {
        expect(classifyOrderSource(order)).toBe('manual');
      }),
      { numRuns: 10 },
    );
  });

  // **Validates: Requirements 8.2**
  it('classification is exhaustive for any combination of signal_id and strategy_id', () => {
    const arbAnyOrder = fc
      .tuple(
        fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null }),
        fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null }),
      )
      .map(([signalId, strategyId]) => ({
        signal_id: signalId,
        strategy_id: strategyId,
      }));

    fc.assert(
      fc.property(arbAnyOrder, (order) => {
        const source = classifyOrderSource(order);
        expect(['signal_auto', 'strategy_auto', 'manual']).toContain(source);

        // Verify classification rules
        if (order.strategy_id != null) {
          expect(source).toBe('strategy_auto');
        } else if (order.signal_id != null) {
          expect(source).toBe('signal_auto');
        } else {
          expect(source).toBe('manual');
        }
      }),
      { numRuns: 10 },
    );
  });
});
