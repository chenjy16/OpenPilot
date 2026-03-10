import Database from 'better-sqlite3';
import { AutoTradingPipeline } from './AutoTradingPipeline';
import type { StrategyEngineLike, StrategyScanMatch } from './AutoTradingPipeline';
import { SignalEvaluator } from './SignalEvaluator';
import { initTradingTables } from './tradingSchema';
import type { SignalCard, TradingOrder } from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  // Insert stub FK rows
  db.exec('INSERT INTO stock_signals (id) VALUES (1)');
  db.exec('INSERT INTO stock_signals (id) VALUES (2)');
  db.exec('INSERT INTO stock_signals (id) VALUES (3)');
  db.exec('INSERT INTO strategies (id) VALUES (10)');
  return db;
}

function insertTestOrder(db: Database.Database, overrides: Partial<TradingOrder> = {}): number {
  const result = db.prepare(`
    INSERT INTO trading_orders (local_order_id, symbol, side, order_type, quantity, status, trading_mode, filled_quantity, filled_price, created_at, updated_at)
    VALUES (@local_order_id, @symbol, @side, @order_type, @quantity, @status, @trading_mode, @filled_quantity, @filled_price, @created_at, @updated_at)
  `).run({
    local_order_id: overrides.local_order_id || `ORD-${Date.now()}-${Math.random()}`,
    symbol: overrides.symbol || '0700.HK',
    side: overrides.side || 'buy',
    order_type: overrides.order_type || 'limit',
    quantity: overrides.quantity || 100,
    status: overrides.status || 'filled',
    trading_mode: overrides.trading_mode || 'paper',
    filled_quantity: overrides.filled_quantity || 100,
    filled_price: overrides.filled_price || 350,
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    updated_at: overrides.updated_at || Math.floor(Date.now() / 1000),
  });
  return Number(result.lastInsertRowid);
}

function makeSignal(overrides: Partial<SignalCard> = {}): SignalCard {
  return {
    id: 1,
    symbol: '0700.HK',
    action: 'buy',
    entry_price: 350,
    stop_loss: 330,
    take_profit: 400,
    confidence: 'high',
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function makeMockTradingGateway(db: Database.Database, overrides: any = {}) {
  // Insert a real order so FK constraints are satisfied
  const orderId = insertTestOrder(db, { local_order_id: `ORD-AUTO-${Date.now()}` });
  return {
    placeOrder: jest.fn().mockResolvedValue({
      id: orderId,
      local_order_id: `ORD-AUTO-${orderId}`,
      symbol: '0700.HK',
      side: 'buy',
      order_type: 'limit',
      quantity: 100,
      price: 350,
      status: 'submitted',
      trading_mode: 'paper',
      filled_quantity: 0,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    }),
    getPositions: jest.fn().mockResolvedValue([]),
    _orderId: orderId,
    ...overrides,
  } as any;
}

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

// ─── processSignal: auto_trade disabled ─────────────────────────────────────

describe('AutoTradingPipeline.processSignal', () => {
  it('skips signal when auto_trade_enabled is false', async () => {
    const db = createTestDb();
    const { pipeline, gw } = createPipeline(db);
    // auto_trade_enabled defaults to false

    const result = await pipeline.processSignal(makeSignal());

    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('skipped_disabled');
    expect(gw.placeOrder).not.toHaveBeenCalled();

    // Verify log entry
    const log = db.prepare('SELECT * FROM pipeline_signal_log WHERE signal_id = 1').get() as any;
    expect(log).toBeDefined();
    expect(log.result).toBe('skipped_disabled');
  });

  it('skips hold signals', async () => {
    const db = createTestDb();
    const { pipeline, gw } = createPipeline(db);
    pipeline.updateConfig({ auto_trade_enabled: true });

    const result = await pipeline.processSignal(makeSignal({ action: 'hold' }));

    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('skipped_hold');
    expect(gw.placeOrder).not.toHaveBeenCalled();
  });

  it('skips signals with low confidence', async () => {
    const db = createTestDb();
    const { pipeline, gw } = createPipeline(db);
    pipeline.updateConfig({ auto_trade_enabled: true, confidence_threshold: 0.8 });

    const result = await pipeline.processSignal(makeSignal({ confidence: 'low' }));

    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('skipped_confidence');
    expect(gw.placeOrder).not.toHaveBeenCalled();
  });

  it('creates order for valid signal', async () => {
    const db = createTestDb();
    const gw = makeMockTradingGateway(db);
    const tn = makeMockTradeNotifier();
    const { pipeline } = createPipeline(db, { tradingGateway: gw, tradeNotifier: tn });
    pipeline.updateConfig({ auto_trade_enabled: true, confidence_threshold: 0.5 });

    const result = await pipeline.processSignal(makeSignal());

    expect(result.action).toBe('order_created');
    expect(result.order_id).toBe(gw._orderId);
    expect(gw.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: '0700.HK',
        side: 'buy',
        signal_id: 1,
      }),
    );
    expect(tn.notifyOrderCreated).toHaveBeenCalledTimes(1);

    // Verify pipeline_signal_log
    const log = db.prepare('SELECT * FROM pipeline_signal_log WHERE result = ?').get('order_created') as any;
    expect(log).toBeDefined();
    expect(log.order_id).toBe(gw._orderId);
  });

  it('registers stop-loss on buy order with SL/TP', async () => {
    const db = createTestDb();
    const slm = makeMockStopLossManager();
    const { pipeline } = createPipeline(db, { stopLossManager: slm });
    pipeline.updateConfig({ auto_trade_enabled: true, confidence_threshold: 0.5 });

    await pipeline.processSignal(makeSignal({ action: 'buy', stop_loss: 330, take_profit: 400 }));

    expect(slm.register).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: '0700.HK',
        side: 'buy',
        entry_price: 350,
        stop_loss: 330,
        take_profit: 400,
      }),
    );
  });

  it('does not register stop-loss on sell order', async () => {
    const db = createTestDb();
    const slm = makeMockStopLossManager();
    const { pipeline } = createPipeline(db, { stopLossManager: slm });
    pipeline.updateConfig({ auto_trade_enabled: true, confidence_threshold: 0.5 });

    await pipeline.processSignal(makeSignal({ action: 'sell' }));

    expect(slm.register).not.toHaveBeenCalled();
  });

  it('skips and notifies when order is rejected', async () => {
    const db = createTestDb();
    const rejOrderId = insertTestOrder(db, { local_order_id: 'ORD-REJ', status: 'rejected' });
    const gw = makeMockTradingGateway(db, {
      placeOrder: jest.fn().mockResolvedValue({
        id: rejOrderId,
        status: 'rejected',
        reject_reason: 'risk limit',
        symbol: '0700.HK',
        side: 'buy',
        order_type: 'limit',
        quantity: 100,
        trading_mode: 'paper',
        filled_quantity: 0,
        local_order_id: 'ORD-REJ',
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
    });
    const tn = makeMockTradeNotifier();
    const { pipeline } = createPipeline(db, { tradingGateway: gw, tradeNotifier: tn });
    pipeline.updateConfig({ auto_trade_enabled: true, confidence_threshold: 0.5 });

    const result = await pipeline.processSignal(makeSignal());

    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('skipped_risk');
    expect(tn.notifyOrderFailed).toHaveBeenCalledTimes(1);
  });
});

// ─── processStrategyScanResult ──────────────────────────────────────────────

describe('AutoTradingPipeline.processStrategyScanResult', () => {
  it('creates buy order for entry_signal', async () => {
    const db = createTestDb();
    const gw = makeMockTradingGateway(db);
    const tn = makeMockTradeNotifier();
    const { pipeline } = createPipeline(db, { tradingGateway: gw, tradeNotifier: tn });
    pipeline.updateConfig({ auto_trade_enabled: true });

    const match: StrategyScanMatch = {
      symbol: '0700.HK',
      matched: true,
      entry_signal: true,
      exit_signal: false,
      indicator_values: { close: 350 },
    };

    const result = await pipeline.processStrategyScanResult(10, match);

    expect(result.action).toBe('order_created');
    expect(gw.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: '0700.HK',
        side: 'buy',
        strategy_id: 10,
      }),
    );
    expect(tn.notifyOrderCreated).toHaveBeenCalledTimes(1);

    // Verify strategy_id in log
    const log = db.prepare('SELECT * FROM pipeline_signal_log WHERE strategy_id = 10').get() as any;
    expect(log).toBeDefined();
    expect(log.signal_source).toBe('strategy_scan');
  });

  it('creates sell order for exit_signal when holding position', async () => {
    const db = createTestDb();
    const sellOrderId = insertTestOrder(db, { local_order_id: 'ORD-SELL-001', side: 'sell', symbol: '0700.HK' });
    const gw = makeMockTradingGateway(db, {
      placeOrder: jest.fn().mockResolvedValue({
        id: sellOrderId,
        local_order_id: 'ORD-SELL-001',
        symbol: '0700.HK',
        side: 'sell',
        order_type: 'market',
        quantity: 200,
        status: 'submitted',
        trading_mode: 'paper',
        filled_quantity: 0,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      }),
      getPositions: jest.fn().mockResolvedValue([
        { symbol: '0700.HK', quantity: 200, avg_cost: 340, current_price: 360, market_value: 72000 },
      ]),
    });
    const { pipeline } = createPipeline(db, { tradingGateway: gw });
    pipeline.updateConfig({ auto_trade_enabled: true });

    const match: StrategyScanMatch = {
      symbol: '0700.HK',
      matched: true,
      entry_signal: false,
      exit_signal: true,
      indicator_values: {},
    };

    const result = await pipeline.processStrategyScanResult(10, match);

    expect(result.action).toBe('order_created');
    expect(gw.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: '0700.HK',
        side: 'sell',
        quantity: 200,
        strategy_id: 10,
      }),
    );
  });

  it('skips exit_signal when not holding position', async () => {
    const db = createTestDb();
    const gw = makeMockTradingGateway(db, {
      getPositions: jest.fn().mockResolvedValue([]),
    });
    const { pipeline } = createPipeline(db, { tradingGateway: gw });
    pipeline.updateConfig({ auto_trade_enabled: true });

    const match: StrategyScanMatch = {
      symbol: '0700.HK',
      matched: true,
      entry_signal: false,
      exit_signal: true,
      indicator_values: {},
    };

    const result = await pipeline.processStrategyScanResult(10, match);

    expect(result.action).toBe('skipped');
    expect(gw.placeOrder).not.toHaveBeenCalled();
  });

  it('skips when strategy is disabled', async () => {
    const db = createTestDb();
    const se = makeMockStrategyEngine({
      getStrategy: jest.fn().mockReturnValue({ enabled: false, stop_loss_rule: { type: 'percentage', value: 5 }, take_profit_rule: { type: 'percentage', value: 10 } }),
    });
    const gw = makeMockTradingGateway(db);
    const { pipeline } = createPipeline(db, { strategyEngine: se, tradingGateway: gw });
    pipeline.updateConfig({ auto_trade_enabled: true });

    const match: StrategyScanMatch = {
      symbol: '0700.HK',
      matched: true,
      entry_signal: true,
      exit_signal: false,
      indicator_values: { close: 350 },
    };

    const result = await pipeline.processStrategyScanResult(10, match);

    expect(result.action).toBe('skipped');
    expect(gw.placeOrder).not.toHaveBeenCalled();
  });
});

// ─── getConfig / updateConfig ───────────────────────────────────────────────

describe('AutoTradingPipeline config', () => {
  it('returns default config when no values in DB', () => {
    const db = createTestDb();
    const { pipeline } = createPipeline(db);

    const config = pipeline.getConfig();

    expect(config.auto_trade_enabled).toBe(false);
    expect(config.confidence_threshold).toBe(0.6);
    expect(config.dedup_window_hours).toBe(24);
    expect(config.quantity_mode).toBe('fixed_quantity');
    expect(config.fixed_quantity_value).toBe(100);
    expect(config.fixed_amount_value).toBe(10000);
    expect(config.signal_poll_interval_ms).toBe(5000);
  });

  it('round-trips config through updateConfig/getConfig', () => {
    const db = createTestDb();
    const { pipeline } = createPipeline(db);

    pipeline.updateConfig({
      auto_trade_enabled: true,
      confidence_threshold: 0.8,
      dedup_window_hours: 12,
      quantity_mode: 'fixed_amount',
      fixed_quantity_value: 200,
      fixed_amount_value: 50000,
      signal_poll_interval_ms: 3000,
    });

    const config = pipeline.getConfig();

    expect(config.auto_trade_enabled).toBe(true);
    expect(config.confidence_threshold).toBe(0.8);
    expect(config.dedup_window_hours).toBe(12);
    expect(config.quantity_mode).toBe('fixed_amount');
    expect(config.fixed_quantity_value).toBe(200);
    expect(config.fixed_amount_value).toBe(50000);
    expect(config.signal_poll_interval_ms).toBe(3000);
  });

  it('partial update preserves other values', () => {
    const db = createTestDb();
    const { pipeline } = createPipeline(db);

    pipeline.updateConfig({ auto_trade_enabled: true, confidence_threshold: 0.9 });
    pipeline.updateConfig({ dedup_window_hours: 48 });

    const config = pipeline.getConfig();
    expect(config.auto_trade_enabled).toBe(true);
    expect(config.confidence_threshold).toBe(0.9);
    expect(config.dedup_window_hours).toBe(48);
  });
});

// ─── getStatus ──────────────────────────────────────────────────────────────

describe('AutoTradingPipeline.getStatus', () => {
  it('returns correct status data', async () => {
    const db = createTestDb();
    const slm = makeMockStopLossManager();
    slm.getActiveRecords.mockReturnValue([{ id: 1 }, { id: 2 }]);
    const { pipeline } = createPipeline(db, { stopLossManager: slm });
    pipeline.updateConfig({ auto_trade_enabled: true, confidence_threshold: 0.5 });

    // Process a signal to populate recent_signals
    await pipeline.processSignal(makeSignal());

    const status = pipeline.getStatus();

    expect(status.enabled).toBe(true);
    expect(status.last_signal_processed_at).toBeDefined();
    expect(status.recent_signals).toHaveLength(1);
    expect(status.active_stop_loss_count).toBe(2);
  });

  it('returns empty state initially', () => {
    const db = createTestDb();
    const { pipeline } = createPipeline(db);

    const status = pipeline.getStatus();

    expect(status.enabled).toBe(false);
    expect(status.last_signal_processed_at).toBeNull();
    expect(status.recent_signals).toHaveLength(0);
    expect(status.active_stop_loss_count).toBe(0);
  });
});

// ─── start / stop ───────────────────────────────────────────────────────────

describe('AutoTradingPipeline start/stop', () => {
  it('start and stop manage the poll timer', () => {
    const db = createTestDb();
    const { pipeline } = createPipeline(db);

    pipeline.start();
    // calling again should not create a second timer
    pipeline.start();

    pipeline.stop();
    // calling again should be safe
    pipeline.stop();
  });
});
