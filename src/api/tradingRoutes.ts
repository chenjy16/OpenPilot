/**
 * Trading API Routes
 *
 * RESTful endpoints for the trading module:
 *   POST   /orders          — create order
 *   GET    /orders          — list orders (with filters)
 *   GET    /orders/:id      — get single order
 *   POST   /orders/:id/cancel — cancel order
 *   GET    /account         — account info
 *   GET    /positions       — positions
 *   GET    /risk-rules      — list risk rules
 *   PUT    /risk-rules      — update risk rule
 *   GET    /stats           — trading stats
 *   GET    /config          — trading config
 *   PUT    /config          — update trading config
 */

import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { TradingGateway } from '../services/trading/TradingGateway';
import type { RiskController } from '../services/trading/RiskController';
import type { OrderManager } from '../services/trading/OrderManager';
import type { AutoTradingPipeline } from '../services/trading/AutoTradingPipeline';
import type { StopLossManager } from '../services/trading/StopLossManager';
import type { CreateOrderRequest, OrderFilter, OrderStatus, TradingMode } from '../services/trading/types';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_SIDES = ['buy', 'sell'] as const;
const VALID_ORDER_TYPES = ['market', 'limit', 'stop', 'stop_limit'] as const;
const VALID_STATUSES: OrderStatus[] = [
  'pending', 'submitted', 'partial_filled', 'filled', 'cancelled', 'rejected', 'failed',
];

function errorResponse(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

function validateCreateOrder(body: any): { valid: true; request: CreateOrderRequest } | { valid: false; message: string } {
  const { symbol, side, order_type, quantity, price, stop_price, strategy_id, signal_id } = body;

  if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
    return { valid: false, message: 'symbol is required and must be a non-empty string' };
  }
  if (!side || !VALID_SIDES.includes(side)) {
    return { valid: false, message: `side is required and must be one of: ${VALID_SIDES.join(', ')}` };
  }
  if (!order_type || !VALID_ORDER_TYPES.includes(order_type)) {
    return { valid: false, message: `order_type is required and must be one of: ${VALID_ORDER_TYPES.join(', ')}` };
  }
  if (quantity === undefined || quantity === null || typeof quantity !== 'number' || quantity <= 0) {
    return { valid: false, message: 'quantity is required and must be a positive number' };
  }
  if (price !== undefined && price !== null && (typeof price !== 'number' || price <= 0)) {
    return { valid: false, message: 'price must be a positive number' };
  }
  if (order_type === 'limit' && (price === undefined || price === null)) {
    return { valid: false, message: 'price is required for limit orders' };
  }
  if (stop_price !== undefined && stop_price !== null && (typeof stop_price !== 'number' || stop_price <= 0)) {
    return { valid: false, message: 'stop_price must be a positive number' };
  }
  if (strategy_id !== undefined && strategy_id !== null && (!Number.isInteger(strategy_id))) {
    return { valid: false, message: 'strategy_id must be an integer' };
  }
  if (signal_id !== undefined && signal_id !== null && (!Number.isInteger(signal_id))) {
    return { valid: false, message: 'signal_id must be an integer' };
  }

  return {
    valid: true,
    request: {
      symbol: symbol.trim(),
      side,
      order_type,
      quantity,
      price: price ?? undefined,
      stop_price: stop_price ?? undefined,
      strategy_id: strategy_id ?? undefined,
      signal_id: signal_id ?? undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createTradingRoutes(
  gateway: TradingGateway,
  riskController: RiskController,
  orderManager: OrderManager,
  options?: {
    pipeline?: AutoTradingPipeline;
    stopLossManager?: StopLossManager;
    db?: Database.Database;
  },
): Router {
  const pipeline = options?.pipeline;
  const stopLossManager = options?.stopLossManager;
  const db = options?.db;
  const router = Router();

  // POST /orders — create order
  router.post('/orders', async (req: Request, res: Response) => {
    try {
      const validation = validateCreateOrder(req.body);
      if (!validation.valid) {
        return errorResponse(res, 400, 'VALIDATION_ERROR', validation.message);
      }
      const order = await gateway.placeOrder(validation.request);
      res.status(201).json(order);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /orders — list orders with optional filters
  router.get('/orders', (req: Request, res: Response) => {
    try {
      const filter: OrderFilter = {};

      if (req.query.status) {
        const status = req.query.status as string;
        if (!VALID_STATUSES.includes(status as OrderStatus)) {
          return errorResponse(res, 400, 'VALIDATION_ERROR', `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
        }
        filter.status = status as OrderStatus;
      }
      if (req.query.symbol) {
        filter.symbol = req.query.symbol as string;
      }
      if (req.query.start_date) {
        const sd = Number(req.query.start_date);
        if (isNaN(sd)) {
          return errorResponse(res, 400, 'VALIDATION_ERROR', 'start_date must be a valid number (unix timestamp)');
        }
        filter.start_date = sd;
      }
      if (req.query.end_date) {
        const ed = Number(req.query.end_date);
        if (isNaN(ed)) {
          return errorResponse(res, 400, 'VALIDATION_ERROR', 'end_date must be a valid number (unix timestamp)');
        }
        filter.end_date = ed;
      }

      const orders = gateway.listOrders(filter);
      res.status(200).json(orders);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /orders/:id — get single order
  router.get('/orders/:id', (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'Order ID must be a positive integer');
      }
      const order = gateway.getOrder(id);
      if (!order) {
        return errorResponse(res, 404, 'NOT_FOUND', `Order ${id} not found`);
      }
      res.status(200).json(order);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // POST /orders/:id/cancel — cancel order
  router.post('/orders/:id/cancel', async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'Order ID must be a positive integer');
      }
      const order = await gateway.cancelOrder(id);
      res.status(200).json(order);
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return errorResponse(res, 404, 'NOT_FOUND', err.message);
      }
      if (err.message.includes('Invalid status transition')) {
        return errorResponse(res, 400, 'INVALID_OPERATION', err.message);
      }
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /account — account info
  router.get('/account', async (_req: Request, res: Response) => {
    try {
      const account = await gateway.getAccount();
      res.status(200).json(account);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /positions — positions
  router.get('/positions', async (_req: Request, res: Response) => {
    try {
      const positions = await gateway.getPositions();
      res.status(200).json(positions);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /risk-rules — list risk rules
  router.get('/risk-rules', (_req: Request, res: Response) => {
    try {
      const rules = riskController.listRules();
      res.status(200).json(rules);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // PUT /risk-rules — update a risk rule
  router.put('/risk-rules', (req: Request, res: Response) => {
    try {
      const { id, ...updates } = req.body;
      if (!id || !Number.isInteger(id)) {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'id is required and must be an integer');
      }
      if (updates.threshold !== undefined && (typeof updates.threshold !== 'number' || updates.threshold < 0)) {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'threshold must be a non-negative number');
      }
      if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'enabled must be a boolean');
      }
      const rule = riskController.updateRule(id, updates);
      res.status(200).json(rule);
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return errorResponse(res, 404, 'NOT_FOUND', err.message);
      }
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /stats — trading stats
  router.get('/stats', (req: Request, res: Response) => {
    try {
      const tradingMode = req.query.trading_mode as TradingMode | undefined;
      if (tradingMode && tradingMode !== 'paper' && tradingMode !== 'live') {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'trading_mode must be "paper" or "live"');
      }
      const stats = orderManager.getStats(tradingMode);
      res.status(200).json(stats);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /config — trading config (extended with auto-trading fields)
  router.get('/config', (_req: Request, res: Response) => {
    try {
      const config = gateway.getConfig();
      if (pipeline) {
        const pipelineConfig = pipeline.getConfig();
        return res.status(200).json({
          ...config,
          auto_trade_enabled: pipelineConfig.auto_trade_enabled,
          confidence_threshold: pipelineConfig.confidence_threshold,
          dedup_window_hours: pipelineConfig.dedup_window_hours,
          quantity_mode: pipelineConfig.quantity_mode,
          quantity_params: {
            fixed_quantity_value: pipelineConfig.fixed_quantity_value,
            fixed_amount_value: pipelineConfig.fixed_amount_value,
          },
          sl_tp_check_interval: 30000,
          sl_tp_enabled: true,
        });
      }
      res.status(200).json(config);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // PUT /config — update trading config (extended with auto-trading fields)
  router.put('/config', (req: Request, res: Response) => {
    try {
      const config = req.body;
      if (config.trading_mode !== undefined && config.trading_mode !== 'paper' && config.trading_mode !== 'live') {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'trading_mode must be "paper" or "live"');
      }
      if (config.auto_trade_enabled !== undefined && typeof config.auto_trade_enabled !== 'boolean') {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'auto_trade_enabled must be a boolean');
      }
      if (config.broker_region !== undefined) {
        const validRegions = ['hk', 'sg'];
        if (!validRegions.includes(config.broker_region)) {
          return errorResponse(res, 400, 'VALIDATION_ERROR', `broker_region must be one of: ${validRegions.join(', ')}`);
        }
      }
      if (config.confidence_threshold !== undefined) {
        if (typeof config.confidence_threshold !== 'number' || config.confidence_threshold < 0 || config.confidence_threshold > 1) {
          return errorResponse(res, 400, 'VALIDATION_ERROR', 'confidence_threshold must be a number between 0 and 1');
        }
      }
      if (config.dedup_window_hours !== undefined) {
        if (typeof config.dedup_window_hours !== 'number' || config.dedup_window_hours <= 0) {
          return errorResponse(res, 400, 'VALIDATION_ERROR', 'dedup_window_hours must be a positive number');
        }
      }
      if (config.quantity_mode !== undefined) {
        const validModes = ['fixed_quantity', 'fixed_amount', 'kelly_formula'];
        if (!validModes.includes(config.quantity_mode)) {
          return errorResponse(res, 400, 'VALIDATION_ERROR', `quantity_mode must be one of: ${validModes.join(', ')}`);
        }
      }

      // Update gateway config (trading_mode, broker_region, etc.)
      gateway.updateConfig(config);

      // Update pipeline config if pipeline is available
      if (pipeline) {
        const pipelineUpdates: Record<string, any> = {};
        if (config.auto_trade_enabled !== undefined) pipelineUpdates.auto_trade_enabled = config.auto_trade_enabled;
        if (config.confidence_threshold !== undefined) pipelineUpdates.confidence_threshold = config.confidence_threshold;
        if (config.dedup_window_hours !== undefined) pipelineUpdates.dedup_window_hours = config.dedup_window_hours;
        if (config.quantity_mode !== undefined) pipelineUpdates.quantity_mode = config.quantity_mode;
        if (config.quantity_params !== undefined) {
          if (config.quantity_params.fixed_quantity_value !== undefined) {
            pipelineUpdates.fixed_quantity_value = config.quantity_params.fixed_quantity_value;
          }
          if (config.quantity_params.fixed_amount_value !== undefined) {
            pipelineUpdates.fixed_amount_value = config.quantity_params.fixed_amount_value;
          }
        }

        if (Object.keys(pipelineUpdates).length > 0) {
          pipeline.updateConfig(pipelineUpdates);
        }

        // Start/stop pipeline based on auto_trade_enabled
        if (config.auto_trade_enabled === true) {
          pipeline.start();
        } else if (config.auto_trade_enabled === false) {
          pipeline.stop();
        }
      }

      const updated = gateway.getConfig();
      if (pipeline) {
        const pipelineConfig = pipeline.getConfig();
        return res.status(200).json({
          ...updated,
          auto_trade_enabled: pipelineConfig.auto_trade_enabled,
          confidence_threshold: pipelineConfig.confidence_threshold,
          dedup_window_hours: pipelineConfig.dedup_window_hours,
          quantity_mode: pipelineConfig.quantity_mode,
          quantity_params: {
            fixed_quantity_value: pipelineConfig.fixed_quantity_value,
            fixed_amount_value: pipelineConfig.fixed_amount_value,
          },
          sl_tp_check_interval: 30000,
          sl_tp_enabled: true,
        });
      }
      res.status(200).json(updated);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /broker-credentials — get masked credential status
  router.get('/broker-credentials', (_req: Request, res: Response) => {
    try {
      const masked = gateway.getBrokerCredentialsMasked();
      res.status(200).json(masked);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // PUT /broker-credentials — save broker credentials
  router.put('/broker-credentials', (req: Request, res: Response) => {
    try {
      const { app_key, app_secret, access_token, paper_access_token } = req.body;
      if (!app_key && !app_secret && !access_token && !paper_access_token) {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'At least one credential field is required');
      }
      gateway.saveBrokerCredentials({ app_key, app_secret, access_token, paper_access_token });

      // Update the LongportAdapter with new credentials at runtime
      const adapter = gateway.getBrokerAdapter();
      if (adapter && 'updateCredentials' in adapter) {
        const config = gateway.getConfig();
        const creds = gateway.getBrokerCredentials();
        const isLive = config.trading_mode === 'live';
        const token = isLive ? creds.access_token : creds.paper_access_token;
        (adapter as any).updateCredentials({
          appKey: creds.app_key,
          appSecret: creds.app_secret,
          accessToken: token,
          region: config.broker_region as 'hk' | 'cn',
        });
      }

      const masked = gateway.getBrokerCredentialsMasked();
      res.status(200).json(masked);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // POST /broker-test — test broker connection
  router.post('/broker-test', async (_req: Request, res: Response) => {
    try {
      const adapter = gateway.getBrokerAdapter();
      if (!adapter) {
        return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'No broker adapter configured');
      }

      // Ensure adapter has latest credentials from DB, using the correct token for current mode
      if ('updateCredentials' in adapter) {
        const config = gateway.getConfig();
        const creds = gateway.getBrokerCredentials();
        const isLive = config.trading_mode === 'live';
        const token = isLive ? creds.access_token : creds.paper_access_token;
        (adapter as any).updateCredentials({
          appKey: creds.app_key,
          appSecret: creds.app_secret,
          accessToken: token,
          region: config.broker_region as 'hk' | 'cn',
        });
      }

      const connected = await adapter.testConnection();
      res.status(200).json({ connected });
    } catch (err: any) {
      res.status(200).json({ connected: false, error: err.message });
    }
  });

  // ─── Auto-Trading Endpoints ──────────────────────────────────────────────

  // GET /pipeline/status — pipeline running status
  router.get('/pipeline/status', (_req: Request, res: Response) => {
    try {
      if (!pipeline) {
        return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Auto-trading pipeline is not configured');
      }
      const status = pipeline.getStatus();
      res.status(200).json(status);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /pipeline/signals — recent processed signals
  router.get('/pipeline/signals', (_req: Request, res: Response) => {
    try {
      if (!db) {
        return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Database is not configured');
      }
      const rows = db.prepare(
        `SELECT id, signal_id, signal_source, symbol, action, result, order_id, strategy_id, created_at
         FROM pipeline_signal_log
         ORDER BY created_at DESC
         LIMIT 20`,
      ).all();
      res.status(200).json(rows);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /stop-loss — active stop-loss/take-profit monitoring records
  router.get('/stop-loss', (_req: Request, res: Response) => {
    try {
      if (!stopLossManager) {
        return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Stop-loss manager is not configured');
      }
      const records = stopLossManager.getActiveRecords();
      res.status(200).json(records);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /performance — trading performance metrics and equity curve
  router.get('/performance', (_req: Request, res: Response) => {
    try {
      if (!db) {
        return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Database is not configured');
      }
      const periodDays = _req.query.period ? Number(_req.query.period) : 30;
      const { PerformanceAnalytics } = require('../services/trading/PerformanceAnalytics');
      const analytics = new PerformanceAnalytics(db);
      const metrics = analytics.getMetrics(periodDays);
      res.status(200).json(metrics);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /strategy-allocations — list all strategy capital allocations
  router.get('/strategy-allocations', (_req: Request, res: Response) => {
    try {
      if (!db) return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Database not configured');
      const { StrategyAllocator } = require('../services/trading/StrategyAllocator');
      const allocator = new StrategyAllocator(db);
      res.status(200).json(allocator.getSummary());
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // PUT /strategy-allocations — set capital allocation for a strategy
  router.put('/strategy-allocations', (req: Request, res: Response) => {
    try {
      if (!db) return errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Database not configured');
      const { strategy_id, allocated_capital, enabled } = req.body;
      if (!strategy_id) return errorResponse(res, 400, 'VALIDATION_ERROR', 'strategy_id is required');
      const { StrategyAllocator } = require('../services/trading/StrategyAllocator');
      const allocator = new StrategyAllocator(db);
      if (allocated_capital !== undefined) allocator.setAllocation(strategy_id, allocated_capital);
      if (enabled !== undefined) allocator.toggleAllocation(strategy_id, enabled);
      res.status(200).json(allocator.getAllocation(strategy_id));
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // GET /dynamic-risk — get current dynamic risk state
  router.get('/dynamic-risk', (_req: Request, res: Response) => {
    try {
      const state = riskController.getDynamicRiskState();
      res.status(200).json(state);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  // POST /dynamic-risk/update — manually update dynamic risk state
  router.post('/dynamic-risk/update', (_req: Request, res: Response) => {
    try {
      const { portfolio_drawdown, vix_level } = _req.body;
      if (portfolio_drawdown === undefined) {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'portfolio_drawdown is required');
      }
      const result = riskController.updateDynamicRisk(portfolio_drawdown, vix_level);
      res.status(200).json(result);
    } catch (err: any) {
      errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
    }
  });

  return router;
}
