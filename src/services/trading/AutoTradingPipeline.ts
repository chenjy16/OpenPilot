/**
 * AutoTradingPipeline — orchestration layer for the automated trading loop.
 *
 * Connects signal detection → evaluation → quantity calculation → order placement
 * → stop-loss registration → notification → logging.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.2, 5.3, 5.4, 5.5, 7.3, 7.4
 */

import type Database from 'better-sqlite3';
import type { TradingGateway } from './TradingGateway';
import type { SignalEvaluator } from './SignalEvaluator';
import type { StopLossManager } from './StopLossManager';
import type { TradeNotifier } from './TradeNotifier';
import { calculateOrderQuantity } from './QuantityCalculator';
import type {
  SignalCard,
  PipelineConfig,
  ProcessResult,
  PipelineStatus,
  CreateOrderRequest,
  QuantityMode,
} from './types';

/** Minimal interface for StrategyEngine dependency */
export interface StrategyEngineLike {
  getStrategy(id: number): { enabled: boolean; stop_loss_rule: { type: string; value: number }; take_profit_rule: { type: string; value: number } } | null;
}

/** Minimal interface for strategy scan match */
export interface StrategyScanMatch {
  symbol: string;
  matched: boolean;
  entry_signal: boolean;
  exit_signal: boolean;
  indicator_values: Record<string, number | null>;
}

// ─── Default config values ──────────────────────────────────────────────────

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  auto_trade_enabled: false,
  confidence_threshold: 0.6,
  dedup_window_hours: 24,
  quantity_mode: 'fixed_quantity',
  fixed_quantity_value: 100,
  fixed_amount_value: 10000,
  signal_poll_interval_ms: 5000,
};

const CONFIG_KEYS: (keyof PipelineConfig)[] = [
  'auto_trade_enabled',
  'confidence_threshold',
  'dedup_window_hours',
  'quantity_mode',
  'fixed_quantity_value',
  'fixed_amount_value',
  'signal_poll_interval_ms',
];

// ─── AutoTradingPipeline Class ──────────────────────────────────────────────

export class AutoTradingPipeline {
  private db: Database.Database;
  private tradingGateway: TradingGateway;
  private signalEvaluator: SignalEvaluator;
  private stopLossManager: StopLossManager;
  private tradeNotifier: TradeNotifier;
  private strategyEngine: StrategyEngineLike;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastProcessedAt: number | null = null;
  private recentSignals: ProcessResult[] = [];

  constructor(
    db: Database.Database,
    tradingGateway: TradingGateway,
    signalEvaluator: SignalEvaluator,
    stopLossManager: StopLossManager,
    tradeNotifier: TradeNotifier,
    strategyEngine: StrategyEngineLike,
  ) {
    this.db = db;
    this.tradingGateway = tradingGateway;
    this.signalEvaluator = signalEvaluator;
    this.stopLossManager = stopLossManager;
    this.tradeNotifier = tradeNotifier;
    this.strategyEngine = strategyEngine;
  }

  // ─── start / stop ───────────────────────────────────────────────────────

  /** Start polling stock_signals for new signals */
  start(): void {
    if (this.pollTimer) return;
    const config = this.getConfig();
    const intervalMs = config.signal_poll_interval_ms || DEFAULT_PIPELINE_CONFIG.signal_poll_interval_ms;

    this.pollTimer = setInterval(() => {
      this.pollNewSignals();
    }, intervalMs);
  }

  /** Stop polling; does not affect existing orders or stop-loss monitoring */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ─── Signal polling ─────────────────────────────────────────────────────

  private pollNewSignals(): void {
    try {
      const since = this.lastProcessedAt ?? 0;
      const rows = this.db
        .prepare(
          `SELECT id, symbol, action, entry_price, stop_loss, take_profit, confidence, created_at
           FROM stock_signals
           WHERE created_at > ?
           ORDER BY created_at ASC`,
        )
        .all(since) as SignalCard[];

      for (const signal of rows) {
        this.processSignal(signal).catch((err) => {
          console.error(`[AutoTradingPipeline] processSignal error for signal ${signal.id}:`, err);
        });
      }
    } catch (err) {
      console.error('[AutoTradingPipeline] pollNewSignals error:', err);
    }
  }

  // ─── processSignal ──────────────────────────────────────────────────────

  async processSignal(signal: SignalCard): Promise<ProcessResult> {
    // Track last processed timestamp
    this.lastProcessedAt = signal.created_at;

    const config = this.getConfig();

    // 1. Check auto_trade_enabled
    if (!config.auto_trade_enabled) {
      return this.logAndReturn(signal, 'skipped', 'skipped_disabled', 'quant_analyst');
    }

    // 2. Evaluate signal (hold, missing price, confidence, dedup)
    const evalResult = this.signalEvaluator.evaluate(signal, {
      confidence_threshold: config.confidence_threshold,
      dedup_window_hours: config.dedup_window_hours,
    });

    if (!evalResult.pass) {
      const resultMap: Record<string, string> = {
        action_hold: 'skipped_hold',
        missing_price: 'skipped_missing_price',
        confidence_below_threshold: 'skipped_confidence',
        duplicate_signal: 'skipped_dedup',
      };
      const logResult = resultMap[evalResult.reason!] || 'skipped_confidence';
      return this.logAndReturn(signal, 'skipped', logResult, 'quant_analyst');
    }

    // 3. Calculate order quantity
    const quantity = calculateOrderQuantity({
      mode: config.quantity_mode,
      fixed_quantity_value: config.fixed_quantity_value,
      fixed_amount_value: config.fixed_amount_value,
      entry_price: signal.entry_price!,
      stop_loss: signal.stop_loss ?? undefined,
      take_profit: signal.take_profit ?? undefined,
    });

    if (quantity === 0) {
      return this.logAndReturn(signal, 'skipped', 'skipped_quantity', 'quant_analyst');
    }

    // 4. Construct CreateOrderRequest
    const orderRequest: CreateOrderRequest = {
      symbol: signal.symbol,
      side: signal.action as 'buy' | 'sell',
      order_type: 'limit',
      quantity,
      price: signal.entry_price!,
      signal_id: signal.id,
    };

    // 5. Place order via TradingGateway
    let order;
    try {
      order = await this.tradingGateway.placeOrder(orderRequest);
    } catch (err: any) {
      console.error(`[AutoTradingPipeline] placeOrder failed for signal ${signal.id}:`, err);
      return this.logAndReturn(signal, 'skipped', 'skipped_risk', 'quant_analyst');
    }

    // Check if order was rejected/failed
    if (order.status === 'rejected' || order.status === 'failed') {
      try {
        await this.tradeNotifier.notifyOrderFailed(order);
      } catch { /* notification errors are non-fatal */ }
      return this.logAndReturn(signal, 'skipped', 'skipped_risk', 'quant_analyst');
    }

    // 6. Register stop-loss if buy order and SL/TP present
    if (signal.action === 'buy' && signal.stop_loss != null && signal.take_profit != null) {
      try {
        this.stopLossManager.register({
          order_id: order.id!,
          symbol: signal.symbol,
          side: 'buy',
          entry_price: signal.entry_price!,
          stop_loss: signal.stop_loss,
          take_profit: signal.take_profit,
        });
      } catch (err: any) {
        console.warn(`[AutoTradingPipeline] StopLoss registration failed:`, err);
      }
    }

    // 7. Notify via TradeNotifier
    try {
      await this.tradeNotifier.notifyOrderCreated(order);
    } catch { /* notification errors are non-fatal */ }

    // 8. Log to pipeline_signal_log and return
    return this.logAndReturn(signal, 'order_created', 'order_created', 'quant_analyst', order.id);
  }

  // ─── processStrategyScanResult ──────────────────────────────────────────

  async processStrategyScanResult(
    strategyId: number,
    match: StrategyScanMatch,
  ): Promise<ProcessResult> {
    const config = this.getConfig();

    // Check auto_trade_enabled globally
    if (!config.auto_trade_enabled) {
      return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_disabled');
    }

    // Check strategy exists and is enabled (acts as per-strategy auto_trade switch)
    const strategy = this.strategyEngine.getStrategy(strategyId);
    if (!strategy || !strategy.enabled) {
      return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_disabled');
    }

    if (!match.matched) {
      return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_confidence');
    }

    // Determine action based on entry/exit signals
    if (match.entry_signal) {
      // Buy order
      const entryPrice = match.indicator_values?.close ?? match.indicator_values?.price ?? 0;
      if (entryPrice <= 0) {
        return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_missing_price');
      }

      // Calculate SL/TP from strategy rules
      const stopLossPrice = this.calculateRulePrice(entryPrice, strategy.stop_loss_rule, 'stop_loss');
      const takeProfitPrice = this.calculateRulePrice(entryPrice, strategy.take_profit_rule, 'take_profit');

      const quantity = calculateOrderQuantity({
        mode: config.quantity_mode,
        fixed_quantity_value: config.fixed_quantity_value,
        fixed_amount_value: config.fixed_amount_value,
        entry_price: entryPrice,
        stop_loss: stopLossPrice,
        take_profit: takeProfitPrice,
      });

      if (quantity === 0) {
        return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_quantity');
      }

      const orderRequest: CreateOrderRequest = {
        symbol: match.symbol,
        side: 'buy',
        order_type: 'limit',
        quantity,
        price: entryPrice,
        strategy_id: strategyId,
      };

      let order;
      try {
        order = await this.tradingGateway.placeOrder(orderRequest);
      } catch {
        return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_risk');
      }

      if (order.status === 'rejected' || order.status === 'failed') {
        try { await this.tradeNotifier.notifyOrderFailed(order); } catch { /* non-fatal */ }
        return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_risk');
      }

      // Register stop-loss
      if (stopLossPrice > 0 && takeProfitPrice > 0) {
        try {
          this.stopLossManager.register({
            order_id: order.id!,
            symbol: match.symbol,
            side: 'buy',
            entry_price: entryPrice,
            stop_loss: stopLossPrice,
            take_profit: takeProfitPrice,
          });
        } catch { /* non-fatal */ }
      }

      try { await this.tradeNotifier.notifyOrderCreated(order); } catch { /* non-fatal */ }
      return this.logStrategyResult(match, strategyId, 'order_created', 'order_created', order.id);
    }

    if (match.exit_signal) {
      // Sell order — check if holding position
      let positions;
      try {
        positions = await this.tradingGateway.getPositions();
      } catch {
        return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_risk');
      }

      const position = positions.find((p) => p.symbol === match.symbol && p.quantity > 0);
      if (!position) {
        return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_quantity');
      }

      const orderRequest: CreateOrderRequest = {
        symbol: match.symbol,
        side: 'sell',
        order_type: 'market',
        quantity: position.quantity,
        strategy_id: strategyId,
      };

      let order;
      try {
        order = await this.tradingGateway.placeOrder(orderRequest);
      } catch {
        return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_risk');
      }

      if (order.status === 'rejected' || order.status === 'failed') {
        try { await this.tradeNotifier.notifyOrderFailed(order); } catch { /* non-fatal */ }
        return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_risk');
      }

      try { await this.tradeNotifier.notifyOrderCreated(order); } catch { /* non-fatal */ }
      return this.logStrategyResult(match, strategyId, 'order_created', 'order_created', order.id);
    }

    // No entry or exit signal
    return this.logStrategyResult(match, strategyId, 'skipped', 'skipped_confidence');
  }

  // ─── getStatus / getConfig / updateConfig ───────────────────────────────

  getStatus(): PipelineStatus {
    const config = this.getConfig();
    return {
      enabled: config.auto_trade_enabled,
      last_signal_processed_at: this.lastProcessedAt,
      recent_signals: [...this.recentSignals],
      active_stop_loss_count: this.stopLossManager.getActiveRecords().length,
    };
  }

  getConfig(): PipelineConfig {
    const rows = this.db
      .prepare(`SELECT key, value FROM trading_config WHERE key IN (${CONFIG_KEYS.map(() => '?').join(',')})`)
      .all(...CONFIG_KEYS) as Array<{ key: string; value: string }>;

    const map = new Map(rows.map((r) => [r.key, r.value]));

    const parsedThreshold = parseFloat(map.get('confidence_threshold') ?? '');
    const parsedDedupHours = parseInt(map.get('dedup_window_hours') ?? '', 10);
    const parsedFixedQty = parseFloat(map.get('fixed_quantity_value') ?? '');
    const parsedFixedAmt = parseFloat(map.get('fixed_amount_value') ?? '');
    const parsedPollInterval = parseInt(map.get('signal_poll_interval_ms') ?? '', 10);

    return {
      auto_trade_enabled: map.get('auto_trade_enabled') === 'true',
      confidence_threshold: Number.isNaN(parsedThreshold) ? DEFAULT_PIPELINE_CONFIG.confidence_threshold : parsedThreshold,
      dedup_window_hours: Number.isNaN(parsedDedupHours) ? DEFAULT_PIPELINE_CONFIG.dedup_window_hours : parsedDedupHours,
      quantity_mode: (map.get('quantity_mode') as QuantityMode) || DEFAULT_PIPELINE_CONFIG.quantity_mode,
      fixed_quantity_value: Number.isNaN(parsedFixedQty) ? DEFAULT_PIPELINE_CONFIG.fixed_quantity_value : parsedFixedQty,
      fixed_amount_value: Number.isNaN(parsedFixedAmt) ? DEFAULT_PIPELINE_CONFIG.fixed_amount_value : parsedFixedAmt,
      signal_poll_interval_ms: Number.isNaN(parsedPollInterval) ? DEFAULT_PIPELINE_CONFIG.signal_poll_interval_ms : parsedPollInterval,
    };
  }

  updateConfig(config: Partial<PipelineConfig>): void {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(
      `INSERT INTO trading_config (key, value, updated_at) VALUES (@key, @value, @updated_at)
       ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @updated_at`,
    );

    const updateTxn = this.db.transaction((entries: Array<{ key: string; value: string }>) => {
      for (const entry of entries) {
        stmt.run({ key: entry.key, value: entry.value, updated_at: now });
      }
    });

    const entries: Array<{ key: string; value: string }> = [];
    if (config.auto_trade_enabled !== undefined) entries.push({ key: 'auto_trade_enabled', value: String(config.auto_trade_enabled) });
    if (config.confidence_threshold !== undefined) entries.push({ key: 'confidence_threshold', value: String(config.confidence_threshold) });
    if (config.dedup_window_hours !== undefined) entries.push({ key: 'dedup_window_hours', value: String(config.dedup_window_hours) });
    if (config.quantity_mode !== undefined) entries.push({ key: 'quantity_mode', value: config.quantity_mode });
    if (config.fixed_quantity_value !== undefined) entries.push({ key: 'fixed_quantity_value', value: String(config.fixed_quantity_value) });
    if (config.fixed_amount_value !== undefined) entries.push({ key: 'fixed_amount_value', value: String(config.fixed_amount_value) });
    if (config.signal_poll_interval_ms !== undefined) entries.push({ key: 'signal_poll_interval_ms', value: String(config.signal_poll_interval_ms) });

    if (entries.length > 0) {
      updateTxn(entries);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private logAndReturn(
    signal: SignalCard,
    action: 'order_created' | 'skipped',
    result: string,
    source: 'quant_analyst' | 'strategy_scan',
    orderId?: number,
  ): ProcessResult {
    this.db.prepare(
      `INSERT INTO pipeline_signal_log (signal_id, signal_source, symbol, action, result, order_id, created_at)
       VALUES (@signal_id, @signal_source, @symbol, @action, @result, @order_id, @created_at)`,
    ).run({
      signal_id: signal.id,
      signal_source: source,
      symbol: signal.symbol,
      action: signal.action,
      result,
      order_id: orderId ?? null,
      created_at: Math.floor(Date.now() / 1000),
    });

    const processResult: ProcessResult = {
      signal_id: signal.id,
      action,
      reason: action === 'skipped' ? result : undefined,
      order_id: orderId,
    };

    this.addRecentSignal(processResult);
    return processResult;
  }

  private logStrategyResult(
    match: StrategyScanMatch,
    strategyId: number,
    action: 'order_created' | 'skipped',
    result: string,
    orderId?: number,
  ): ProcessResult {
    const signalAction = match.entry_signal ? 'buy' : match.exit_signal ? 'sell' : 'hold';

    this.db.prepare(
      `INSERT INTO pipeline_signal_log (signal_id, signal_source, symbol, action, result, order_id, strategy_id, created_at)
       VALUES (NULL, 'strategy_scan', @symbol, @action, @result, @order_id, @strategy_id, @created_at)`,
    ).run({
      symbol: match.symbol,
      action: signalAction,
      result,
      order_id: orderId ?? null,
      strategy_id: strategyId,
      created_at: Math.floor(Date.now() / 1000),
    });

    const processResult: ProcessResult = {
      signal_id: 0, // no signal_id for strategy scans
      action,
      reason: action === 'skipped' ? result : undefined,
      order_id: orderId,
    };

    this.addRecentSignal(processResult);
    return processResult;
  }

  private addRecentSignal(result: ProcessResult): void {
    this.recentSignals.push(result);
    if (this.recentSignals.length > 10) {
      this.recentSignals.shift();
    }
  }

  /** Calculate stop-loss or take-profit price from a strategy rule */
  private calculateRulePrice(
    entryPrice: number,
    rule: { type: string; value: number },
    direction: 'stop_loss' | 'take_profit',
  ): number {
    switch (rule.type) {
      case 'percentage':
        return direction === 'stop_loss'
          ? entryPrice * (1 - rule.value / 100)
          : entryPrice * (1 + rule.value / 100);
      case 'fixed':
        return direction === 'stop_loss'
          ? entryPrice - rule.value
          : entryPrice + rule.value;
      case 'risk_reward':
        // risk_reward only applies to take_profit; use value as multiplier of a default risk
        return entryPrice * (1 + rule.value / 100);
      case 'atr':
        // ATR-based: use value as multiplier (simplified — no actual ATR data)
        return direction === 'stop_loss'
          ? entryPrice * (1 - rule.value / 100)
          : entryPrice * (1 + rule.value / 100);
      default:
        return 0;
    }
  }
}
