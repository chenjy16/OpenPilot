/**
 * Unit tests for auto-trading API route extensions (Task 10.1)
 *
 * Tests the new/extended endpoints:
 *   GET  /api/trading/config          — extended with auto-trading fields
 *   PUT  /api/trading/config          — extended with auto-trading config updates + pipeline start/stop
 *   GET  /api/trading/pipeline/status — pipeline running status
 *   GET  /api/trading/pipeline/signals — recent processed signals from DB
 *   GET  /api/trading/stop-loss       — active stop-loss monitoring records
 */

import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTradingRoutes } from './tradingRoutes';
import { initTradingTables } from '../services/trading/tradingSchema';
import type { TradingGateway } from '../services/trading/TradingGateway';
import type { RiskController } from '../services/trading/RiskController';
import type { OrderManager } from '../services/trading/OrderManager';
import type { AutoTradingPipeline } from '../services/trading/AutoTradingPipeline';
import type { StopLossManager } from '../services/trading/StopLossManager';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockGateway(): TradingGateway {
  return {
    placeOrder: jest.fn().mockResolvedValue({}),
    listOrders: jest.fn().mockReturnValue([]),
    getOrder: jest.fn().mockReturnValue(null),
    cancelOrder: jest.fn().mockResolvedValue({}),
    getAccount: jest.fn().mockResolvedValue({}),
    getPositions: jest.fn().mockResolvedValue([]),
    getConfig: jest.fn().mockReturnValue({ trading_mode: 'paper', auto_trade_enabled: false }),
    updateConfig: jest.fn(),
    getBrokerCredentialsMasked: jest.fn().mockReturnValue({}),
    saveBrokerCredentials: jest.fn(),
    getBrokerAdapter: jest.fn().mockReturnValue(null),
    getBrokerCredentials: jest.fn().mockReturnValue({}),
  } as unknown as TradingGateway;
}

function createMockRiskController(): RiskController {
  return {
    listRules: jest.fn().mockReturnValue([]),
    updateRule: jest.fn(),
  } as unknown as RiskController;
}

function createMockOrderManager(): OrderManager {
  return {
    getStats: jest.fn().mockReturnValue({ total_orders: 0 }),
  } as unknown as OrderManager;
}

function createMockPipeline(overrides?: Partial<AutoTradingPipeline>): AutoTradingPipeline {
  return {
    getConfig: jest.fn().mockReturnValue({
      auto_trade_enabled: false,
      confidence_threshold: 0.6,
      dedup_window_hours: 24,
      quantity_mode: 'fixed_quantity',
      fixed_quantity_value: 100,
      fixed_amount_value: 10000,
      signal_poll_interval_ms: 5000,
    }),
    updateConfig: jest.fn(),
    getStatus: jest.fn().mockReturnValue({
      enabled: false,
      last_signal_processed_at: null,
      recent_signals: [],
      active_stop_loss_count: 0,
    }),
    start: jest.fn(),
    stop: jest.fn(),
    ...overrides,
  } as unknown as AutoTradingPipeline;
}

function createMockStopLossManager(overrides?: Partial<StopLossManager>): StopLossManager {
  return {
    getActiveRecords: jest.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as StopLossManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Trading Routes — Auto-Trading Extensions', () => {
  let db: Database.Database;
  let mockGateway: TradingGateway;
  let mockRiskController: RiskController;
  let mockOrderManager: OrderManager;
  let mockPipeline: AutoTradingPipeline;
  let mockStopLossManager: StopLossManager;
  let app: express.Application;

  beforeEach(() => {
    db = new Database(':memory:');
    // Stub FK-referenced tables needed by initTradingTables
    db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
    initTradingTables(db);
    mockGateway = createMockGateway();
    mockRiskController = createMockRiskController();
    mockOrderManager = createMockOrderManager();
    mockPipeline = createMockPipeline();
    mockStopLossManager = createMockStopLossManager();

    app = express();
    app.use(express.json());
    app.use(
      '/api/trading',
      createTradingRoutes(mockGateway, mockRiskController, mockOrderManager, {
        pipeline: mockPipeline,
        stopLossManager: mockStopLossManager,
        db,
      }),
    );
  });

  afterEach(() => {
    db.close();
  });

  // ─── GET /config ────────────────────────────────────────────────────────

  describe('GET /api/trading/config', () => {
    it('returns merged config with auto-trading fields when pipeline is available', async () => {
      const res = await request(app).get('/api/trading/config');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('auto_trade_enabled', false);
      expect(res.body).toHaveProperty('confidence_threshold', 0.6);
      expect(res.body).toHaveProperty('dedup_window_hours', 24);
      expect(res.body).toHaveProperty('quantity_mode', 'fixed_quantity');
      expect(res.body).toHaveProperty('quantity_params');
      expect(res.body.quantity_params).toEqual({
        fixed_quantity_value: 100,
        fixed_amount_value: 10000,
      });
      expect(res.body).toHaveProperty('sl_tp_check_interval', 30000);
      expect(res.body).toHaveProperty('sl_tp_enabled', true);
    });

    it('returns base config without auto-trading fields when pipeline is not available', async () => {
      const appNoPipeline = express();
      appNoPipeline.use(express.json());
      appNoPipeline.use(
        '/api/trading',
        createTradingRoutes(mockGateway, mockRiskController, mockOrderManager),
      );

      const res = await request(appNoPipeline).get('/api/trading/config');
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('confidence_threshold');
      expect(res.body).not.toHaveProperty('quantity_params');
    });
  });

  // ─── PUT /config ────────────────────────────────────────────────────────

  describe('PUT /api/trading/config', () => {
    it('updates auto-trading config fields via pipeline', async () => {
      const res = await request(app)
        .put('/api/trading/config')
        .send({ confidence_threshold: 0.8, dedup_window_hours: 12 });
      expect(res.status).toBe(200);
      expect(mockPipeline.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence_threshold: 0.8,
          dedup_window_hours: 12,
        }),
      );
    });

    it('calls pipeline.start() when auto_trade_enabled is set to true', async () => {
      const res = await request(app)
        .put('/api/trading/config')
        .send({ auto_trade_enabled: true });
      expect(res.status).toBe(200);
      expect(mockPipeline.start).toHaveBeenCalled();
      expect(mockPipeline.stop).not.toHaveBeenCalled();
    });

    it('calls pipeline.stop() when auto_trade_enabled is set to false', async () => {
      const res = await request(app)
        .put('/api/trading/config')
        .send({ auto_trade_enabled: false });
      expect(res.status).toBe(200);
      expect(mockPipeline.stop).toHaveBeenCalled();
      expect(mockPipeline.start).not.toHaveBeenCalled();
    });

    it('updates quantity_params through pipeline', async () => {
      const res = await request(app)
        .put('/api/trading/config')
        .send({ quantity_params: { fixed_quantity_value: 200, fixed_amount_value: 20000 } });
      expect(res.status).toBe(200);
      expect(mockPipeline.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          fixed_quantity_value: 200,
          fixed_amount_value: 20000,
        }),
      );
    });

    it('validates confidence_threshold range', async () => {
      const res = await request(app)
        .put('/api/trading/config')
        .send({ confidence_threshold: 1.5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('validates dedup_window_hours is positive', async () => {
      const res = await request(app)
        .put('/api/trading/config')
        .send({ dedup_window_hours: -1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('validates quantity_mode is a valid enum', async () => {
      const res = await request(app)
        .put('/api/trading/config')
        .send({ quantity_mode: 'invalid_mode' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  // ─── GET /pipeline/status ───────────────────────────────────────────────

  describe('GET /api/trading/pipeline/status', () => {
    it('returns pipeline status', async () => {
      const res = await request(app).get('/api/trading/pipeline/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('enabled', false);
      expect(res.body).toHaveProperty('last_signal_processed_at', null);
      expect(res.body).toHaveProperty('recent_signals');
      expect(res.body).toHaveProperty('active_stop_loss_count', 0);
    });

    it('returns 503 when pipeline is not configured', async () => {
      const appNoPipeline = express();
      appNoPipeline.use(express.json());
      appNoPipeline.use(
        '/api/trading',
        createTradingRoutes(mockGateway, mockRiskController, mockOrderManager),
      );

      const res = await request(appNoPipeline).get('/api/trading/pipeline/status');
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('SERVICE_UNAVAILABLE');
    });
  });

  // ─── GET /pipeline/signals ──────────────────────────────────────────────

  describe('GET /api/trading/pipeline/signals', () => {
    it('returns empty array when no signals exist', async () => {
      const res = await request(app).get('/api/trading/pipeline/signals');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns recent signals ordered by created_at DESC, limited to 20', async () => {
      const now = Math.floor(Date.now() / 1000);
      // Insert stub signal rows for FK
      for (let i = 1; i <= 25; i++) {
        db.prepare('INSERT INTO stock_signals (id) VALUES (?)').run(i);
      }
      const stmt = db.prepare(
        `INSERT INTO pipeline_signal_log (signal_id, signal_source, symbol, action, result, created_at)
         VALUES (@signal_id, @signal_source, @symbol, @action, @result, @created_at)`,
      );
      for (let i = 0; i < 25; i++) {
        stmt.run({
          signal_id: i + 1,
          signal_source: 'quant_analyst',
          symbol: `SYM${i}`,
          action: 'buy',
          result: 'order_created',
          created_at: now + i,
        });
      }

      const res = await request(app).get('/api/trading/pipeline/signals');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(20);
      // Most recent first
      expect(res.body[0].symbol).toBe('SYM24');
      expect(res.body[19].symbol).toBe('SYM5');
    });

    it('returns 503 when db is not configured', async () => {
      const appNoDb = express();
      appNoDb.use(express.json());
      appNoDb.use(
        '/api/trading',
        createTradingRoutes(mockGateway, mockRiskController, mockOrderManager, {
          pipeline: mockPipeline,
          stopLossManager: mockStopLossManager,
        }),
      );

      const res = await request(appNoDb).get('/api/trading/pipeline/signals');
      expect(res.status).toBe(503);
    });
  });

  // ─── GET /stop-loss ─────────────────────────────────────────────────────

  describe('GET /api/trading/stop-loss', () => {
    it('returns active stop-loss records', async () => {
      const records = [
        { id: 1, order_id: 10, symbol: 'AAPL', side: 'buy', entry_price: 150, stop_loss: 140, take_profit: 170, status: 'active', created_at: 1000 },
      ];
      (mockStopLossManager.getActiveRecords as jest.Mock).mockReturnValue(records);

      const res = await request(app).get('/api/trading/stop-loss');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].symbol).toBe('AAPL');
    });

    it('returns 503 when stopLossManager is not configured', async () => {
      const appNoSLM = express();
      appNoSLM.use(express.json());
      appNoSLM.use(
        '/api/trading',
        createTradingRoutes(mockGateway, mockRiskController, mockOrderManager),
      );

      const res = await request(appNoSLM).get('/api/trading/stop-loss');
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('SERVICE_UNAVAILABLE');
    });
  });
});
