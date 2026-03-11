/**
 * TradingGateway - Unified Trading Entry Point
 *
 * Coordinates OrderManager, RiskController, and execution layer (PaperTradingEngine / BrokerAdapter).
 * Manages trading mode (paper/live) switching, signal auto-trading, and audit logging.
 *
 * - Default mode: paper
 * - All fund-related operations are logged to trading_audit_log
 * - Signal auto-trading: converts strategy signals into orders with quantity calculation
 */

import type Database from 'better-sqlite3';
import type {
  TradingOrder,
  CreateOrderRequest,
  OrderFilter,
  TradingConfig,
  TradingMode,
  BrokerAdapter,
  BrokerAccount,
  BrokerPosition,
  BrokerCredentials,
  BrokerCredentialsMasked,
} from './types';
import { OrderManager } from './OrderManager';
import { RiskController } from './RiskController';
import { PaperTradingEngine } from './PaperTradingEngine';
import type { StrategyAllocator } from './StrategyAllocator';

// ---------------------------------------------------------------------------
// Default config values
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TradingConfig = {
  trading_mode: 'paper',
  auto_trade_enabled: false,
  broker_name: 'longport',
  broker_region: 'hk',
  paper_initial_capital: 1000000,
  paper_commission_rate: 0.0003,
  sync_interval_seconds: 60,
};

// ---------------------------------------------------------------------------
// TradingGateway class
// ---------------------------------------------------------------------------

export class TradingGateway {
  private db: Database.Database;
  private orderManager: OrderManager;
  private riskController: RiskController;
  private paperEngine: PaperTradingEngine;
  private brokerAdapter?: BrokerAdapter;
  private strategyAllocator?: StrategyAllocator;

  constructor(
    db: Database.Database,
    orderManager: OrderManager,
    riskController: RiskController,
    paperEngine: PaperTradingEngine,
    brokerAdapter?: BrokerAdapter,
  ) {
    this.db = db;
    this.orderManager = orderManager;
    this.riskController = riskController;
    this.paperEngine = paperEngine;
    this.brokerAdapter = brokerAdapter;
  }

  /** Set the strategy allocator for multi-strategy capital management. */
  setStrategyAllocator(allocator: StrategyAllocator): void {
    this.strategyAllocator = allocator;
  }

  // -------------------------------------------------------------------------
  // Core trading operations
  // -------------------------------------------------------------------------

  // ─── TWAP state ──────────────────────────────────────────────────────────
  private twapTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  /** TWAP threshold: orders above this USD value are auto-split */
  private static readonly TWAP_THRESHOLD = 50000;
  private static readonly TWAP_SLICES = 5;
  private static readonly TWAP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Place an order: create → risk check → route to engine → update status → audit.
   * Large market orders (>$50k) are automatically split via TWAP.
   */
  async placeOrder(request: CreateOrderRequest): Promise<TradingOrder> {
    // TWAP interception: split large market orders into time-weighted slices
    if (!this._skipTwap) {
      const estimatedPrice = request.price || 100;
      const estimatedValue = request.quantity * estimatedPrice;
      if (
        estimatedValue > TradingGateway.TWAP_THRESHOLD &&
        request.order_type === 'market' &&
        request.quantity > TradingGateway.TWAP_SLICES
      ) {
        return this.executeTWAP(request, TradingGateway.TWAP_SLICES, TradingGateway.TWAP_INTERVAL_MS);
      }
    }

    const config = this.getConfig();
    const mode = config.trading_mode;

    // 1. Create order (pending)
    const order = this.orderManager.createOrder(request, mode);

    // 2. Risk check
    const account = await this.getAccount();
    const positions = await this.getPositions();
    const todayStats = this.orderManager.getStats(mode);

    // For market orders without price, estimate from request.price or current position price
    // This ensures risk checks aren't bypassed for market orders
    if (!order.price && request.price) {
      order.price = request.price;
    }
    if (!order.price) {
      const pos = positions.find(p => p.symbol === order.symbol);
      if (pos) order.price = pos.current_price;
    }

    const riskResult = this.riskController.checkOrder(order, account, positions, todayStats);

    if (!riskResult.passed) {
      const rejectReason = riskResult.violations.map((v) => v.message).join('; ');
      // pending → failed is valid; we store reject_reason for the risk violation detail
      const failed = this.orderManager.updateOrderStatus(order.id!, 'failed', {
        reject_reason: rejectReason,
      });
      this.logAudit('place_order_rejected', failed.id, request, { reason: rejectReason });
      return failed;
    }

    // 2b. Sector exposure check
    const orderAmount = order.quantity * (order.price || 0);
    if (order.side === 'buy' && orderAmount > 0) {
      const sectorViolation = this.riskController.checkSectorExposure(
        order.symbol, orderAmount, positions, account.total_assets,
      );
      if (sectorViolation) {
        const failed = this.orderManager.updateOrderStatus(order.id!, 'failed', {
          reject_reason: sectorViolation,
        });
        this.logAudit('place_order_rejected', failed.id, request, { reason: sectorViolation });
        return failed;
      }
    }

    // 2c. Strategy allocation check (multi-strategy capital management)
    if (this.strategyAllocator && order.strategy_id && order.side === 'buy') {
      const allocViolation = this.strategyAllocator.checkAllocation(order.strategy_id, orderAmount);
      if (allocViolation) {
        const failed = this.orderManager.updateOrderStatus(order.id!, 'failed', {
          reject_reason: allocViolation,
        });
        this.logAudit('place_order_rejected', failed.id, request, { reason: allocViolation });
        return failed;
      }
    }

    // 3. Route to execution engine
    //    Paper mode with broker credentials → use broker adapter (Longport simulated API)
    //    Paper mode without credentials → fallback to local paper engine
    //    Live mode → use broker adapter
    const useBroker = mode === 'live' || (mode === 'paper' && this.brokerAdapter && this.hasPaperCredentials());

    if (useBroker) {
      this.syncAdapterCredentials();
      if (!this.brokerAdapter) {
        const failed = this.orderManager.updateOrderStatus(order.id!, 'failed', {
          reject_reason: 'No broker adapter configured',
        });
        this.logAudit('place_order_failed', failed.id, request, { reason: 'No broker adapter' });
        return failed;
      }

      const result = await this.brokerAdapter.submitOrder(order);

      if (result.status === 'failed' || result.status === 'rejected') {
        const updated = this.orderManager.updateOrderStatus(order.id!, 'failed', {
          broker_order_id: result.broker_order_id,
          reject_reason: result.message,
        });
        this.logAudit('place_order_failed', updated.id, request, result);
        return updated;
      }

      const submitted = this.orderManager.updateOrderStatus(order.id!, 'submitted', {
        broker_order_id: result.broker_order_id,
      });

      if (result.filled_quantity && result.filled_quantity > 0) {
        const filled = this.orderManager.updateOrderStatus(submitted.id!, 'filled', {
          filled_quantity: result.filled_quantity,
          filled_price: result.filled_price,
        });
        this.logAudit('place_order_filled', filled.id, request, result);
        this.recordStrategyUsage(filled);
        return filled;
      }

      this.logAudit('place_order_submitted', submitted.id, request, result);
      return submitted;
    } else {
      // Fallback: local paper engine (no broker credentials configured)
      const currentPrice = request.price || 100;
      const result = await this.paperEngine.submitOrder(order, currentPrice);

      if (result.status === 'rejected') {
        const rejected = this.orderManager.updateOrderStatus(order.id!, 'rejected', {
          broker_order_id: result.broker_order_id,
          reject_reason: result.message,
        });
        this.logAudit('place_order_rejected', rejected.id, request, result);
        return rejected;
      }

      if (result.filled_quantity && result.filled_quantity > 0) {
        const submitted = this.orderManager.updateOrderStatus(order.id!, 'submitted', {
          broker_order_id: result.broker_order_id,
        });
        const filled = this.orderManager.updateOrderStatus(submitted.id!, 'filled', {
          filled_quantity: result.filled_quantity,
          filled_price: result.filled_price,
        });
        this.logAudit('place_order_filled', filled.id, request, result);
        this.recordStrategyUsage(filled);
        return filled;
      }

      const submitted = this.orderManager.updateOrderStatus(order.id!, 'submitted', {
        broker_order_id: result.broker_order_id,
      });
      this.logAudit('place_order_submitted', submitted.id, request, result);
      return submitted;
    }
  }

  /**
   * Cancel an order.
   */
  async cancelOrder(orderId: number): Promise<TradingOrder> {
    const order = this.orderManager.getOrder(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const config = this.getConfig();

    if (config.trading_mode === 'paper' && this.brokerAdapter && this.hasPaperCredentials() && order.broker_order_id) {
      this.syncAdapterCredentials();
      await this.brokerAdapter.cancelOrder(order.broker_order_id);
    } else if (config.trading_mode === 'paper') {
      this.paperEngine.cancelOrder(order.local_order_id);
    } else if (this.brokerAdapter && order.broker_order_id) {
      this.syncAdapterCredentials();
      await this.brokerAdapter.cancelOrder(order.broker_order_id);
    }

    const cancelled = this.orderManager.updateOrderStatus(orderId, 'cancelled');
    this.logAudit('cancel_order', cancelled.id, { orderId }, { status: 'cancelled' });
    return cancelled;
  }
  /**
   * Sync order statuses with broker for all submitted orders.
   * Polls the broker for each submitted order and updates local status if filled/cancelled/failed.
   * Returns the number of orders that changed status.
   */
  async syncOrderStatuses(): Promise<number> {
    if (!this.brokerAdapter) return 0;
    this.syncAdapterCredentials();

    const submittedOrders = this.orderManager.listOrders({ status: 'submitted' });
    let changed = 0;

    for (const order of submittedOrders) {
      if (!order.broker_order_id) continue;

      try {
        const result = await this.brokerAdapter.getOrderStatus(order.broker_order_id);

        if (result.filled_quantity && result.filled_quantity > 0 && result.filled_price) {
          this.orderManager.updateOrderStatus(order.id!, 'filled', {
            filled_quantity: result.filled_quantity,
            filled_price: result.filled_price,
          });
          this.logAudit('order_sync_filled', order.id, { broker_order_id: order.broker_order_id }, result);
          changed++;
        } else if (result.status === 'failed' || result.status === 'rejected') {
          this.orderManager.updateOrderStatus(order.id!, 'failed', {
            reject_reason: result.message || 'Order failed/rejected by broker',
          });
          this.logAudit('order_sync_failed', order.id, { broker_order_id: order.broker_order_id }, result);
          changed++;
        }
      } catch {
        // Skip this order, retry next cycle
      }
    }

    return changed;
  }

  /**
   * Get a single order by ID.
   */
  getOrder(orderId: number): TradingOrder | null {
    return this.orderManager.getOrder(orderId);
  }

  /**
   * List orders with optional filtering.
   */
  listOrders(filter?: OrderFilter): TradingOrder[] {
    return this.orderManager.listOrders(filter);
  }

  /**
   * Get positions — routed by trading mode.
   */
  async getPositions(): Promise<BrokerPosition[]> {
    const config = this.getConfig();
    if (config.trading_mode === 'paper') {
      // Use real broker API with paper token when credentials are available
      if (this.brokerAdapter && this.hasPaperCredentials()) {
        this.syncAdapterCredentials();
        try {
          return await this.brokerAdapter.getPositions();
        } catch {
          // Fall back to local paper engine on error
          return this.paperEngine.getPositions();
        }
      }
      return this.paperEngine.getPositions();
    }
    if (this.brokerAdapter) {
      this.syncAdapterCredentials();
      return this.brokerAdapter.getPositions();
    }
    return [];
  }

  /**
   * Get account info — routed by trading mode.
   */
  async getAccount(): Promise<BrokerAccount> {
    const config = this.getConfig();
    if (config.trading_mode === 'paper') {
      // Use real broker API with paper token when credentials are available
      if (this.brokerAdapter && this.hasPaperCredentials()) {
        this.syncAdapterCredentials();
        try {
          return await this.brokerAdapter.getAccount();
        } catch {
          // Fall back to local paper engine on error
          return this.paperEngine.getAccount();
        }
      }
      return this.paperEngine.getAccount();
    }
    if (this.brokerAdapter) {
      this.syncAdapterCredentials();
      return this.brokerAdapter.getAccount();
    }
    return { total_assets: 0, available_cash: 0, frozen_cash: 0, currency: 'CNY' };
  }

  // -------------------------------------------------------------------------
  // Mode & config management
  // -------------------------------------------------------------------------

  /**
   * Switch trading mode. Switching to 'live' requires broker connection verification.
   */
  async switchMode(mode: TradingMode): Promise<void> {
    if (mode === 'live') {
      if (!this.brokerAdapter) {
        throw new Error('Cannot switch to live mode: no broker adapter configured');
      }
      // Sync credentials with the live Access Token before testing
      const creds = this.getBrokerCredentials();
      if (!creds.access_token) {
        throw new Error('Cannot switch to live mode: live Access Token not configured');
      }
      if ('updateCredentials' in this.brokerAdapter) {
        const config = this.getConfig();
        (this.brokerAdapter as any).updateCredentials({
          appKey: creds.app_key,
          appSecret: creds.app_secret,
          accessToken: creds.access_token,
          region: config.broker_region as any,
        });
      }
      const connected = await this.brokerAdapter.testConnection();
      if (!connected) {
        throw new Error('Cannot switch to live mode: broker connection test failed');
      }
    }

    this.setConfigValue('trading_mode', mode);
  }

  /**
   * Read full trading config from trading_config table, with defaults.
   */
  getConfig(): TradingConfig {
    const rows = this.db
      .prepare('SELECT key, value FROM trading_config')
      .all() as Array<{ key: string; value: string }>;

    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.key, row.value);
    }

    return {
      trading_mode: (map.get('trading_mode') as TradingMode) || DEFAULT_CONFIG.trading_mode,
      auto_trade_enabled: map.get('auto_trade_enabled') === 'true' ? true : DEFAULT_CONFIG.auto_trade_enabled,
      broker_name: map.get('broker_name') || DEFAULT_CONFIG.broker_name,
      broker_region: map.get('broker_region') || DEFAULT_CONFIG.broker_region,
      paper_initial_capital: map.has('paper_initial_capital')
        ? Number(map.get('paper_initial_capital'))
        : DEFAULT_CONFIG.paper_initial_capital,
      paper_commission_rate: map.has('paper_commission_rate')
        ? Number(map.get('paper_commission_rate'))
        : DEFAULT_CONFIG.paper_commission_rate,
      sync_interval_seconds: map.has('sync_interval_seconds')
        ? Number(map.get('sync_interval_seconds'))
        : DEFAULT_CONFIG.sync_interval_seconds,
    };
  }

  /**
   * Update trading config (partial). Persists each key to trading_config table.
   */
  updateConfig(config: Partial<TradingConfig>): void {
    if (config.trading_mode !== undefined) {
      this.setConfigValue('trading_mode', config.trading_mode);
    }
    if (config.auto_trade_enabled !== undefined) {
      this.setConfigValue('auto_trade_enabled', String(config.auto_trade_enabled));
    }
    if (config.broker_name !== undefined) {
      this.setConfigValue('broker_name', config.broker_name);
    }
    if (config.broker_region !== undefined) {
      this.setConfigValue('broker_region', config.broker_region);
    }
    if (config.paper_initial_capital !== undefined) {
      this.setConfigValue('paper_initial_capital', String(config.paper_initial_capital));
    }
    if (config.paper_commission_rate !== undefined) {
      this.setConfigValue('paper_commission_rate', String(config.paper_commission_rate));
    }
    if (config.sync_interval_seconds !== undefined) {
      this.setConfigValue('sync_interval_seconds', String(config.sync_interval_seconds));
    }
  }

  // -------------------------------------------------------------------------
  // Signal auto-trading (Task 7.2)
  // -------------------------------------------------------------------------

  /**
   * Handle a strategy signal — auto-generate an order if auto_trade_enabled.
   */
  async handleSignal(signal: {
    strategy_id: number;
    signal_id: number;
    symbol: string;
    action: 'buy' | 'sell';
    price: number;
  }): Promise<TradingOrder | null> {
    const config = this.getConfig();
    if (!config.auto_trade_enabled) {
      return null;
    }

    const quantity = this.calculateQuantity(signal.price, 'fixed_quantity', {
      fixed_quantity: 100,
      total_assets: (await this.getAccount()).total_assets,
    });

    const request: CreateOrderRequest = {
      symbol: signal.symbol,
      side: signal.action,
      order_type: 'market',
      quantity,
      price: signal.price,
      strategy_id: signal.strategy_id,
      signal_id: signal.signal_id,
    };

    const order = await this.placeOrder(request);

    if (order.status === 'rejected' || order.status === 'failed') {
      this.logAudit('signal_order_rejected', order.id, signal, { reject_reason: order.reject_reason });
    }

    return order;
  }

  /**
   * Calculate order quantity based on sizing mode.
   * All results are positive integers (minimum 1).
   */
  calculateQuantity(
    price: number,
    mode: string,
    params: {
      fixed_quantity?: number;
      fixed_amount?: number;
      kelly_fraction?: number;
      total_assets?: number;
    },
  ): number {
    let qty: number;

    switch (mode) {
      case 'fixed_quantity':
        qty = params.fixed_quantity ?? 100;
        break;
      case 'fixed_amount':
        qty = Math.floor((params.fixed_amount ?? 10000) / price);
        break;
      case 'kelly':
        qty = Math.floor(
          ((params.kelly_fraction ?? 0.1) * (params.total_assets ?? 1000000)) / price,
        );
        break;
      default:
        qty = 100;
    }

    return Math.max(1, Math.floor(qty));
  }

  // -------------------------------------------------------------------------
  // Broker credential management
  // -------------------------------------------------------------------------

  /**
   * Save broker credentials to trading_config table.
   * Credentials are stored as config keys with 'broker_cred_' prefix.
   */
  saveBrokerCredentials(creds: BrokerCredentials): void {
    if (creds.app_key) this.setConfigValue('broker_cred_app_key', creds.app_key);
    if (creds.app_secret) this.setConfigValue('broker_cred_app_secret', creds.app_secret);
    if (creds.access_token) this.setConfigValue('broker_cred_access_token', creds.access_token);
    if (creds.paper_access_token) this.setConfigValue('broker_cred_paper_access_token', creds.paper_access_token);
  }

  /**
   * Get masked credential status (never expose actual secrets).
   */
  getBrokerCredentialsMasked(): BrokerCredentialsMasked {
    const rows = this.db
      .prepare("SELECT key, value FROM trading_config WHERE key LIKE 'broker_cred_%'")
      .all() as Array<{ key: string; value: string }>;
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.key, row.value);

    return {
      app_key_set: !!(map.get('broker_cred_app_key')?.length),
      app_secret_set: !!(map.get('broker_cred_app_secret')?.length),
      access_token_set: !!(map.get('broker_cred_access_token')?.length),
      paper_access_token_set: !!(map.get('broker_cred_paper_access_token')?.length),
    };
  }

  /**
   * Get raw broker credentials (for internal use by LongportAdapter).
   */
  getBrokerCredentials(): BrokerCredentials {
    const rows = this.db
      .prepare("SELECT key, value FROM trading_config WHERE key LIKE 'broker_cred_%'")
      .all() as Array<{ key: string; value: string }>;
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.key, row.value);

    return {
      app_key: map.get('broker_cred_app_key') ?? '',
      app_secret: map.get('broker_cred_app_secret') ?? '',
      access_token: map.get('broker_cred_access_token') ?? '',
      paper_access_token: map.get('broker_cred_paper_access_token') ?? '',
    };
  }

  /**
   * Get the broker adapter instance (for credential updates).
   */
  getBrokerAdapter(): BrokerAdapter | undefined {
    return this.brokerAdapter;
  }

  // -------------------------------------------------------------------------
  // TWAP (Time-Weighted Average Price) execution
  // -------------------------------------------------------------------------

  /**
   * Split a large order into N slices executed at fixed intervals.
   * Returns the first slice's order immediately; remaining slices run in background.
   */
  private async executeTWAP(
    request: CreateOrderRequest,
    slices: number,
    intervalMs: number,
  ): Promise<TradingOrder> {
    const qtyPerSlice = Math.floor(request.quantity / slices);
    if (qtyPerSlice < 1) {
      // Too small to split — execute as single order
      return this.processSingleOrder(request);
    }

    const twapId = `twap-${Date.now()}-${request.symbol}`;
    const sliceOrderIds: number[] = [];

    this.logAudit('twap_started', undefined, {
      twap_id: twapId,
      symbol: request.symbol,
      total_quantity: request.quantity,
      slices,
      interval_ms: intervalMs,
    });

    // First slice: execute immediately
    const firstOrder = await this.processSingleOrder({ ...request, quantity: qtyPerSlice });
    if (firstOrder.id) sliceOrderIds.push(firstOrder.id);

    // Remaining slices: execute in background at intervals
    let executed = 1;
    const timer = setInterval(async () => {
      if (executed >= slices) {
        clearInterval(timer);
        this.twapTimers.delete(twapId);
        this.logAudit('twap_completed', undefined, {
          twap_id: twapId,
          slices_executed: executed,
          order_ids: sliceOrderIds,
        });
        return;
      }
      // Last slice gets the remainder to avoid rounding loss
      const qty = (executed === slices - 1)
        ? (request.quantity - qtyPerSlice * executed)
        : qtyPerSlice;
      try {
        const sliceOrder = await this.processSingleOrder({ ...request, quantity: qty });
        if (sliceOrder.id) sliceOrderIds.push(sliceOrder.id);
      } catch (err: any) {
        console.error(`[TWAP] Slice ${executed + 1}/${slices} failed for ${request.symbol}: ${err.message}`);
      }
      executed++;
    }, intervalMs);

    this.twapTimers.set(twapId, timer);
    return firstOrder;
  }

  /**
   * Execute a single order through the full pipeline (risk check → route → fill).
   * This is the core of placeOrder without TWAP interception.
   */
  private async processSingleOrder(request: CreateOrderRequest): Promise<TradingOrder> {
    // Save and restore the original placeOrder logic by calling it with a flag
    // We temporarily set a flag to skip TWAP check to avoid infinite recursion
    const saved = this._skipTwap;
    this._skipTwap = true;
    try {
      return await this.placeOrder(request);
    } finally {
      this._skipTwap = saved;
    }
  }
  private _skipTwap = false;

  /** Cancel all pending TWAP timers (called on shutdown) */
  cancelAllTWAP(): void {
    for (const [id, timer] of this.twapTimers) {
      clearInterval(timer);
      this.logAudit('twap_cancelled', undefined, { twap_id: id });
    }
    this.twapTimers.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private logAudit(
    operation: string,
    orderId?: number,
    requestParams?: any,
    responseResult?: any,
  ): void {
    const config = this.getConfig();
    this.db.prepare(`
      INSERT INTO trading_audit_log (timestamp, operation, order_id, request_params, response_result, trading_mode)
      VALUES (@timestamp, @operation, @order_id, @request_params, @response_result, @trading_mode)
    `).run({
      timestamp: Math.floor(Date.now() / 1000),
      operation,
      order_id: orderId ?? null,
      request_params: requestParams ? JSON.stringify(requestParams) : null,
      response_result: responseResult ? JSON.stringify(responseResult) : null,
      trading_mode: config.trading_mode,
    });
  }

  private setConfigValue(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO trading_config (key, value, updated_at)
      VALUES (@key, @value, unixepoch())
      ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = unixepoch()
    `).run({ key, value });
  }

  /**
   * Sync the broker adapter's credentials from DB, using the correct
   * Access Token for the current trading mode.
   *
   * Longport paper and live accounts share the same App Key / App Secret
   * but use different Access Tokens.
   */
  private syncAdapterCredentials(): void {
    if (!this.brokerAdapter || !('updateCredentials' in this.brokerAdapter)) return;
    const creds = this.getBrokerCredentials();
    const config = this.getConfig();
    const isLive = config.trading_mode === 'live';
    const token = isLive ? creds.access_token : creds.paper_access_token;
    if (!creds.app_key || !creds.app_secret || !token) return;
    (this.brokerAdapter as any).updateCredentials({
      appKey: creds.app_key,
      appSecret: creds.app_secret,
      accessToken: token,
      region: config.broker_region as any,
    });
  }
  /** Check if paper-mode broker credentials (app_key + app_secret + paper_access_token) are set */
  private hasPaperCredentials(): boolean {
    const masked = this.getBrokerCredentialsMasked();
    return masked.app_key_set && masked.app_secret_set && masked.paper_access_token_set;
  }

  /** Record strategy capital usage when an order is filled. */
  private recordStrategyUsage(order: TradingOrder): void {
    if (!this.strategyAllocator || !order.strategy_id) return;
    if (order.side === 'buy' && order.filled_quantity && order.filled_price) {
      this.strategyAllocator.recordUsage(order.strategy_id, order.filled_quantity * order.filled_price);
    }
    // Sell fill → record realized PnL and release capital
    if (order.side === 'sell' && order.filled_quantity && order.filled_price) {
      const releasedCapital = order.filled_quantity * order.filled_price;
      // Estimate PnL from current position avg_cost (sync call to paper positions or cached)
      try {
        const positions = this.paperEngine.getPositions();
        const pos = positions.find(p => p.symbol === order.symbol);
        const avgCost = pos?.avg_cost ?? order.filled_price;
        const pnl = (order.filled_price - avgCost) * order.filled_quantity;
        this.strategyAllocator.recordPnl(order.strategy_id, pnl, releasedCapital);
      } catch {
        // Fallback: record zero PnL but still release capital
        this.strategyAllocator.recordPnl(order.strategy_id, 0, releasedCapital);
      }
    }
  }
}
