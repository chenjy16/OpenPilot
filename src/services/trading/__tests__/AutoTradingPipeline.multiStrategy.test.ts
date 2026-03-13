import Database from 'better-sqlite3';
import { AutoTradingPipeline } from '../AutoTradingPipeline';
import type { AIRuntimeLike, RiskControllerLike } from '../AutoTradingPipeline';
import { SignalEvaluator } from '../SignalEvaluator';
import { initTradingTables } from '../tradingSchema';
import type { StrategySignal, TradingOrder } from '../types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  db.exec('INSERT INTO strategies (id) VALUES (10)');
  return db;
}

function insertTestOrder(db: Database.Database, overrides: Partial<TradingOrder> = {}): number {
  const result = db.prepare(`
    INSERT INTO trading_orders (local_order_id, symbol, side, order_type, quantity, status, trading_mode, filled_quantity, filled_price, created_at, updated_at)
    VALUES (@local_order_id, @symbol, @side, @order_type, @quantity, @status, @trading_mode, @filled_quantity, @filled_price, @created_at, @updated_at)
  `).run({
    local_order_id: overrides.local_order_id || `ORD-${Date.now()}-${Math.random()}`,
    symbol: overrides.symbol || 'AAPL',
    side: overrides.side || 'buy',
    order_type: overrides.order_type || 'moo',
    quantity: overrides.quantity || 100,
    status: overrides.status || 'pending',
    trading_mode: overrides.trading_mode || 'paper',
    filled_quantity: overrides.filled_quantity || 0,
    filled_price: overrides.filled_price || null,
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    updated_at: overrides.updated_at || Math.floor(Date.now() / 1000),
  });
  return Number(result.lastInsertRowid);
}

function makeStrategySignal(overrides: Partial<StrategySignal> = {}): StrategySignal {
  return {
    symbol: 'AAPL',
    action: 'buy',
    entry_price: 150,
    stop_loss: 142.5,  // 5% below
    take_profit: 168,   // 12% above
    scores: {
      momentum_score: 0.9,
      volume_score: 0.8,
      sentiment_score: 0.85,
      ai_confidence: 0.7,
    },
    metadata: {},
    ...overrides,
  };
}

function makeMockTradingGateway(db: Database.Database, overrides: any = {}) {
  const orderId = insertTestOrder(db);
  return {
    placeOrder: jest.fn().mockResolvedValue({
      id: orderId,
      local_order_id: `ORD-MOO-${orderId}`,
      symbol: 'AAPL',
      side: 'buy',
      order_type: 'moo',
      quantity: 100,
      price: 150,
      status: 'pending',
      trading_mode: 'paper',
      filled_quantity: 0,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    }),
    getPositions: jest.fn().mockResolvedValue([]),
    getAccount: jest.fn().mockResolvedValue({
      total_assets: 100000,
      available_cash: 50000,
      frozen_cash: 0,
      currency: 'USD',
    }),
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

function makeMockStrategyEngine(): any {
  return {
    getStrategy: jest.fn().mockReturnValue({
      enabled: true,
      stop_loss_rule: { type: 'percentage', value: 5 },
      take_profit_rule: { type: 'percentage', value: 10 },
    }),
  };
}

function makeAIRuntime(probability: string = 'HIGH_PROBABILITY'): AIRuntimeLike {
  return {
    execute: jest.fn().mockResolvedValue({
      text: JSON.stringify({ probability, reason: 'Test reason' }),
    }),
  };
}

function makeRiskController(passed: boolean = true): RiskControllerLike {
  return {
    checkOrder: jest.fn().mockReturnValue({
      passed,
      violations: passed ? [] : [{
        rule_type: 'max_positions',
        rule_name: 'Max positions',
        threshold: 3,
        current_value: 3,
        message: 'Current positions 3 reached limit 3',
      }],
    }),
  };
}

function createPipeline(db: Database.Database, overrides: any = {}) {
  const evaluator = new SignalEvaluator(db);
  const gw = overrides.tradingGateway || makeMockTradingGateway(db);
  const tn = overrides.tradeNotifier || makeMockTradeNotifier();
  const slm = overrides.stopLossManager || makeMockStopLossManager();
  const se = overrides.strategyEngine || makeMockStrategyEngine();

  const pipeline = new AutoTradingPipeline(db, gw, evaluator, slm, tn, se);

  if (overrides.aiRuntime) {
    pipeline.setAIRuntime(overrides.aiRuntime);
  }
  if (overrides.riskController) {
    pipeline.setRiskController(overrides.riskController);
  }

  return { pipeline, gw, tn, slm, se };
}

function makeSignalMap(...signals: StrategySignal[]): Map<string, StrategySignal[]> {
  const map = new Map<string, StrategySignal[]>();
  for (const sig of signals) {
    const strategyName = sig.metadata?.strategy_name || 'momentum_breakout';
    const existing = map.get(strategyName) || [];
    existing.push(sig);
    map.set(strategyName, existing);
  }
  return map;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AutoTradingPipeline.processMultiStrategySignals', () => {
  describe('full pipeline flow: aggregate → AI filter → risk → sizing → MOO order', () => {
    it('creates MOO order when signal passes all stages', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');
      const riskController = makeRiskController(true);

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
        riskController,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('order_created');
      expect(results[0].symbol).toBe('AAPL');
      expect(results[0].order_id).toBeDefined();
      expect(results[0].ai_filter_result).toBe('HIGH_PROBABILITY');

      // Verify MOO order was placed
      expect(gw.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'AAPL',
          side: 'buy',
          order_type: 'moo',
        }),
      );
    });

    it('returns empty results when no signals pass aggregation threshold', async () => {
      const db = createTestDb();
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');
      const { pipeline } = createPipeline(db, { aiRuntime });

      // Low scores that won't pass 0.7 threshold
      const lowSignal = makeStrategySignal({
        scores: {
          momentum_score: 0.1,
          volume_score: 0.1,
          sentiment_score: 0.1,
          ai_confidence: 0.1,
        },
      });

      const signals = makeSignalMap(lowSignal);
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(0);
    });
  });

  describe('AI risk filter gating (Property 8)', () => {
    it('skips signal when AI filter returns MEDIUM', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime = makeAIRuntime('MEDIUM');

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toBe('ai_filter_medium');
      expect(results[0].ai_filter_result).toBe('MEDIUM');
      expect(gw.placeOrder).not.toHaveBeenCalled();
    });

    it('skips signal when AI filter returns LOW', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime = makeAIRuntime('LOW');

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toBe('ai_filter_low');
      expect(gw.placeOrder).not.toHaveBeenCalled();
    });

    it('skips signal when AI filter errors (timeout/API failure) — safety first', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime: AIRuntimeLike = {
        execute: jest.fn().mockRejectedValue(new Error('API timeout')),
      };

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toBe('ai_filter_error');
      expect(gw.placeOrder).not.toHaveBeenCalled();
    });

    it('skips signal when AI runtime is not configured — safety first', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);

      // No aiRuntime set
      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toBe('ai_filter_no_ai_runtime');
      expect(gw.placeOrder).not.toHaveBeenCalled();
    });

    it('skips signal when AI returns unparseable response', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime: AIRuntimeLike = {
        execute: jest.fn().mockResolvedValue({ text: 'garbage response' }),
      };

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toBe('ai_filter_low');
      expect(gw.placeOrder).not.toHaveBeenCalled();
    });
  });

  describe('risk control check', () => {
    it('skips signal when risk controller rejects', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');
      const riskController = makeRiskController(false);

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
        riskController,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toBe('risk_control_rejected');
      expect(gw.placeOrder).not.toHaveBeenCalled();
    });

    it('proceeds when no risk controller is set', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');

      // No riskController set
      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('order_created');
    });
  });

  describe('position sizing (risk_budget mode)', () => {
    it('skips signal when position size calculates to 0', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db, {
        getAccount: jest.fn().mockResolvedValue({
          total_assets: 100,  // Very small account
          available_cash: 100,
          frozen_cash: 0,
          currency: 'USD',
        }),
      });
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      // stop_loss very close to entry_price, small account → quantity = 0
      const signal = makeStrategySignal({
        entry_price: 1000,
        stop_loss: 999,  // risk_per_share = 1, max_risk = 100*0.02 = 2, qty = floor(2/1) = 2
      });

      // Actually this would give qty=2, let's make stop_loss >= entry_price
      const signal2 = makeStrategySignal({
        entry_price: 1000,
        stop_loss: 1000,  // risk_per_share = 0 → qty = 0
      });

      const signals = makeSignalMap(signal2);
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toBe('quantity_zero');
    });

    it('uses risk_budget mode with 2% risk per trade', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      // total_assets=100000, max_risk_pct=0.02, entry=150, stop=142.5
      // risk_per_share = 150 - 142.5 = 7.5
      // max_risk_amount = 100000 * 0.02 = 2000
      // quantity = floor(2000 / 7.5) = 266
      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('order_created');
      expect(gw.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 266,
        }),
      );
    });
  });

  describe('MOO order creation', () => {
    it('creates order with order_type moo', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signals = makeSignalMap(makeStrategySignal());
      await pipeline.processMultiStrategySignals(signals);

      expect(gw.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          order_type: 'moo',
        }),
      );
    });

    it('handles order placement failure gracefully', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db, {
        placeOrder: jest.fn().mockRejectedValue(new Error('Broker unavailable')),
      });
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toBe('order_placement_failed');
    });

    it('handles rejected order status', async () => {
      const db = createTestDb();
      const rejOrderId = insertTestOrder(db, { status: 'rejected' });
      const gw = makeMockTradingGateway(db, {
        placeOrder: jest.fn().mockResolvedValue({
          id: rejOrderId,
          status: 'rejected',
          reject_reason: 'Insufficient funds',
          symbol: 'AAPL',
          side: 'buy',
          order_type: 'moo',
          quantity: 100,
          trading_mode: 'paper',
          filled_quantity: 0,
          local_order_id: 'ORD-REJ',
          created_at: Date.now(),
          updated_at: Date.now(),
        }),
      });
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toBe('order_rejected');
    });
  });

  describe('multiple signals processing', () => {
    it('processes multiple aggregated signals independently', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db);
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signal1 = makeStrategySignal({ symbol: 'AAPL' });
      const signal2 = makeStrategySignal({ symbol: 'GOOGL' });
      const signal3 = makeStrategySignal({ symbol: 'MSFT' });

      const map = new Map<string, StrategySignal[]>();
      map.set('momentum_breakout', [signal1, signal2, signal3]);

      const results = await pipeline.processMultiStrategySignals(map);

      // All 3 should pass (scores are high enough)
      // But aggregator limits to top 3, so max 3
      expect(results.length).toBeLessThanOrEqual(3);
      for (const r of results) {
        expect(r.action).toBe('order_created');
      }
    });
  });

  describe('account/positions fetch failure', () => {
    it('returns empty results when getAccount fails', async () => {
      const db = createTestDb();
      const gw = makeMockTradingGateway(db, {
        getAccount: jest.fn().mockRejectedValue(new Error('Network error')),
      });
      const aiRuntime = makeAIRuntime('HIGH_PROBABILITY');

      const { pipeline } = createPipeline(db, {
        tradingGateway: gw,
        aiRuntime,
      });

      const signals = makeSignalMap(makeStrategySignal());
      const results = await pipeline.processMultiStrategySignals(signals);

      expect(results).toHaveLength(0);
    });
  });
});
