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
import type { RiskController } from './RiskController';
import { SignalAggregator } from './SignalAggregator';
import type { AggregatedSignal } from './SignalAggregator';
import { calculateOrderQuantity } from './QuantityCalculator';
import { createLogger } from '../../logger';
import type {
  SignalCard,
  PipelineConfig,
  ProcessResult,
  PipelineStatus,
  CreateOrderRequest,
  QuantityMode,
  StrategySignal,
  TradingOrder,
} from './types';

const logger = createLogger('AutoTradingPipeline');

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

/** Minimal interface for AIRuntime dependency (dual-agent debate) */
export interface AIRuntimeLike {
  execute(request: { sessionId: string; message: string; model: string; agentId?: string }): Promise<{ text: string }>;
}

/** Minimal interface for RiskController dependency */
export interface RiskControllerLike {
  checkOrder(
    order: TradingOrder,
    account: { total_assets: number; available_cash: number; frozen_cash: number; currency: string },
    positions: Array<{ symbol: string; quantity: number; avg_cost: number; current_price: number; market_value: number }>,
    todayStats: { total_orders: number; filled_orders: number; cancelled_orders: number; total_filled_amount: number },
  ): { passed: boolean; violations: Array<{ rule_type: string; rule_name: string; threshold: number; current_value: number; message: string }> };
}

/** Result of multi-strategy pipeline processing */
export interface MultiStrategyResult {
  symbol: string;
  action: 'order_created' | 'skipped';
  reason?: string;
  order_id?: number;
  composite_score?: number;
  ai_filter_result?: string;
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
  debate_enabled: false,
  debate_model: 'deepseek/deepseek-reasoner',
  sl_tp_enabled: true,
  sl_tp_check_interval: 30000,
};

const CONFIG_KEYS: (keyof PipelineConfig)[] = [
  'auto_trade_enabled',
  'confidence_threshold',
  'dedup_window_hours',
  'quantity_mode',
  'fixed_quantity_value',
  'fixed_amount_value',
  'signal_poll_interval_ms',
  'debate_enabled',
  'debate_model',
  'sl_tp_enabled',
  'sl_tp_check_interval',
];

// ─── AutoTradingPipeline Class ──────────────────────────────────────────────

export class AutoTradingPipeline {
  private db: Database.Database;
  private tradingGateway: TradingGateway;
  private signalEvaluator: SignalEvaluator;
  private stopLossManager: StopLossManager;
  private tradeNotifier: TradeNotifier;
  private strategyEngine: StrategyEngineLike;
  private aiRuntime: AIRuntimeLike | null = null;
  private riskController: RiskControllerLike | null = null;
  private signalAggregator: SignalAggregator;

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
    this.signalAggregator = new SignalAggregator();
  }

  // ─── start / stop ───────────────────────────────────────────────────────

  /** Set AIRuntime for dual-agent debate (optional, called from index.ts) */
  setAIRuntime(runtime: AIRuntimeLike): void {
    this.aiRuntime = runtime;
  }

  /** Set RiskController for multi-strategy risk checks */
  setRiskController(controller: RiskControllerLike): void {
    this.riskController = controller;
  }

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

      // Process signals sequentially to avoid race conditions with dedup checks
      (async () => {
        for (const signal of rows) {
          try {
            await this.processSignal(signal);
          } catch (err) {
            console.error(`[AutoTradingPipeline] processSignal error for signal ${signal.id}:`, err);
          }
        }
      })().catch((err) => {
        console.error('[AutoTradingPipeline] signal processing loop error:', err);
      });
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

    // 3. Dual-agent debate (if enabled): Bull vs Bear analysis before order placement
    if (config.debate_enabled && this.aiRuntime && signal.action === 'buy') {
      try {
        const debateResult = await this.runDebate(signal, config);
        if (!debateResult.approved) {
          this.logAudit('debate_rejected', undefined, {
            signal_id: signal.id,
            symbol: signal.symbol,
            reason: debateResult.reason,
            confidence: debateResult.confidence,
          });
          return this.logAndReturn(signal, 'skipped', 'skipped_debate', 'quant_analyst');
        }
        this.logAudit('debate_approved', undefined, {
          signal_id: signal.id,
          symbol: signal.symbol,
          confidence: debateResult.confidence,
          reason: debateResult.reason,
        });
      } catch (err: any) {
        // Debate failure is non-fatal — proceed without debate
        console.warn(`[AutoTradingPipeline] Debate failed for ${signal.symbol}: ${err.message}`);
      }
    }

    // 4. Calculate order quantity
    //    For volatility_parity mode, we need total_assets and atr14
    let totalAssets: number | undefined;
    let atr14: number | undefined;
    if (config.quantity_mode === 'volatility_parity' || config.quantity_mode === 'kelly_formula') {
      try {
        const account = await this.tradingGateway.getAccount();
        totalAssets = account.total_assets;
      } catch { /* fallback: quantity will be 0 */ }
    }
    if (config.quantity_mode === 'volatility_parity') {
      // Try to get ATR(14) from dynamic_watchlist (UniverseScreener output) or ohlcv_daily
      try {
        // dynamic_watchlist stores atr_pct (percentage); convert to absolute value
        const wlRow = this.db.prepare(
          `SELECT atr_pct, price FROM dynamic_watchlist WHERE symbol = ? LIMIT 1`,
        ).get(signal.symbol) as { atr_pct: number; price: number } | undefined;
        if (wlRow && wlRow.atr_pct > 0 && wlRow.price > 0) {
          atr14 = wlRow.price * (wlRow.atr_pct / 100);
        }
      } catch { /* table may not exist; atr14 stays undefined → quantity=0 */ }
    }

    const quantity = calculateOrderQuantity({
      mode: config.quantity_mode,
      fixed_quantity_value: config.fixed_quantity_value,
      fixed_amount_value: config.fixed_amount_value,
      entry_price: signal.entry_price!,
      stop_loss: signal.stop_loss ?? undefined,
      take_profit: signal.take_profit ?? undefined,
      total_assets: totalAssets,
      atr14,
    });

    if (quantity === 0) {
      return this.logAndReturn(signal, 'skipped', 'skipped_quantity', 'quant_analyst');
    }

    // 5. Construct CreateOrderRequest
    const orderRequest: CreateOrderRequest = {
      symbol: signal.symbol,
      side: signal.action as 'buy' | 'sell',
      order_type: 'limit',
      quantity,
      price: signal.entry_price!,
      signal_id: signal.id,
    };

    // 6. Place order via TradingGateway
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

    // 7. Register stop-loss if buy order and SL/TP present
    if (signal.action === 'buy' && signal.stop_loss != null && signal.take_profit != null) {
      try {
        this.stopLossManager.register({
          order_id: order.id!,
          symbol: signal.symbol,
          side: 'buy',
          entry_price: signal.entry_price!,
          stop_loss: signal.stop_loss,
          take_profit: signal.take_profit,
          // Chandelier Exit: pass ATR trailing params if available
          trailing_atr_multiplier: atr14 ? 2.0 : undefined,
          atr_value: atr14,
        });
      } catch (err: any) {
        console.warn(`[AutoTradingPipeline] StopLoss registration failed:`, err);
      }
    }

    // 8. Notify via TradeNotifier
    try {
      await this.tradeNotifier.notifyOrderCreated(order);
    } catch { /* notification errors are non-fatal */ }

    // 9. Log to pipeline_signal_log and return
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

  // ─── Multi-Strategy Aggregation Flow ──────────────────────────────────────

  /**
   * Process signals from multiple strategies through the full pipeline:
   *   1. Aggregate via SignalAggregator (score ≥ 0.7, top 3)
   *   2. AI risk filter (dual-agent debate) — skip if not HIGH_PROBABILITY
   *   3. Risk control check (all rules including max_positions, max_weekly_loss)
   *   4. Position sizing (risk_budget mode)
   *   5. Create MOO orders (for after-hours signals)
   *
   * Requirements: 6.1, 6.2, 6.3, 6.4, 9.2, 10.1, 10.2
   */
  async processMultiStrategySignals(
    strategySignals: Map<string, StrategySignal[]>,
  ): Promise<MultiStrategyResult[]> {
    const config = this.getConfig();
    const results: MultiStrategyResult[] = [];

    // 1. Aggregate signals
    const aggregated = this.signalAggregator.aggregate(strategySignals);
    logger.info(`Aggregated ${aggregated.length} signals from ${strategySignals.size} strategies`);

    if (aggregated.length === 0) {
      logger.info('No signals passed aggregation threshold');
      return results;
    }

    // Get account and positions once for all signals
    let account: { total_assets: number; available_cash: number; frozen_cash: number; currency: string };
    let positions: Array<{ symbol: string; quantity: number; avg_cost: number; current_price: number; market_value: number }>;
    try {
      account = await this.tradingGateway.getAccount();
      positions = await this.tradingGateway.getPositions();
    } catch (err: any) {
      logger.error('Failed to get account/positions for multi-strategy processing', { error: err.message });
      return results;
    }

    for (const agg of aggregated) {
      const result = await this.processAggregatedSignal(agg, config, account, positions);
      results.push(result);
    }

    return results;
  }

  /**
   * Process a single aggregated signal through AI filter → risk check → sizing → order.
   */
  private async processAggregatedSignal(
    agg: AggregatedSignal,
    config: PipelineConfig,
    account: { total_assets: number; available_cash: number; frozen_cash: number; currency: string },
    positions: Array<{ symbol: string; quantity: number; avg_cost: number; current_price: number; market_value: number }>,
  ): Promise<MultiStrategyResult> {
    const signal = agg.best_signal;

    // 2. AI risk filter
    const aiResult = await this.runAIRiskFilter(agg);
    if (aiResult !== 'HIGH_PROBABILITY') {
      logger.info(`Signal ${agg.symbol} skipped by AI filter: ${aiResult}`, {
        symbol: agg.symbol,
        composite_score: agg.composite_score,
        ai_filter_result: aiResult,
      });
      return {
        symbol: agg.symbol,
        action: 'skipped',
        reason: `ai_filter_${aiResult.toLowerCase()}`,
        composite_score: agg.composite_score,
        ai_filter_result: aiResult,
      };
    }

    // 3. Risk control check
    if (this.riskController && signal.action === 'buy') {
      const todayStats = this.getTodayOrderStats();
      const mockOrder = {
        symbol: signal.symbol,
        side: signal.action,
        order_type: 'moo' as const,
        quantity: 1, // placeholder, will be recalculated
        price: signal.entry_price,
        status: 'pending' as const,
        trading_mode: 'paper' as const,
        local_order_id: '',
        filled_quantity: 0,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      } as TradingOrder;

      const riskResult = this.riskController.checkOrder(mockOrder, account, positions, todayStats);
      if (!riskResult.passed) {
        const violationMessages = riskResult.violations.map((v) => v.message).join('; ');
        logger.warn(`Signal ${agg.symbol} rejected by risk control: ${violationMessages}`, {
          symbol: agg.symbol,
          violations: riskResult.violations,
        });
        return {
          symbol: agg.symbol,
          action: 'skipped',
          reason: 'risk_control_rejected',
          composite_score: agg.composite_score,
          ai_filter_result: aiResult,
        };
      }
    }

    // 4. Position sizing (risk_budget mode)
    const quantity = calculateOrderQuantity({
      mode: 'risk_budget',
      entry_price: signal.entry_price,
      stop_loss: signal.stop_loss,
      total_assets: account.total_assets,
      max_risk_pct: 0.02, // 2% risk per trade
    });

    if (quantity === 0) {
      logger.warn(`Signal ${agg.symbol} skipped: position size is 0`, {
        symbol: agg.symbol,
        entry_price: signal.entry_price,
        stop_loss: signal.stop_loss,
      });
      return {
        symbol: agg.symbol,
        action: 'skipped',
        reason: 'quantity_zero',
        composite_score: agg.composite_score,
        ai_filter_result: aiResult,
      };
    }

    // 5. Create MOO order (after-hours signals use MOO)
    const orderRequest: CreateOrderRequest = {
      symbol: signal.symbol,
      side: signal.action as 'buy' | 'sell',
      order_type: 'moo',
      quantity,
      price: signal.entry_price,
    };

    let order;
    try {
      order = await this.tradingGateway.placeOrder(orderRequest);
    } catch (err: any) {
      logger.error(`Failed to place MOO order for ${agg.symbol}`, { error: err.message });
      return {
        symbol: agg.symbol,
        action: 'skipped',
        reason: 'order_placement_failed',
        composite_score: agg.composite_score,
        ai_filter_result: aiResult,
      };
    }

    if (order.status === 'rejected' || order.status === 'failed') {
      logger.warn(`MOO order for ${agg.symbol} was ${order.status}`, {
        symbol: agg.symbol,
        reject_reason: order.reject_reason,
      });
      return {
        symbol: agg.symbol,
        action: 'skipped',
        reason: `order_${order.status}`,
        composite_score: agg.composite_score,
        ai_filter_result: aiResult,
      };
    }

    logger.info(`MOO order created for ${agg.symbol}`, {
      symbol: agg.symbol,
      order_id: order.id,
      quantity,
      composite_score: agg.composite_score,
    });

    this.logAudit('multi_strategy_order', order.id, {
      symbol: agg.symbol,
      composite_score: agg.composite_score,
      ai_filter_result: aiResult,
      quantity,
      order_type: 'moo',
    });

    return {
      symbol: agg.symbol,
      action: 'order_created',
      order_id: order.id,
      composite_score: agg.composite_score,
      ai_filter_result: aiResult,
    };
  }

  /**
   * Run AI risk filter on an aggregated signal.
   * Returns 'HIGH_PROBABILITY', 'MEDIUM', or 'LOW'.
   * On error (timeout, API failure), returns 'ERROR' — safety first, signal will be skipped.
   */
  private async runAIRiskFilter(agg: AggregatedSignal): Promise<string> {
    if (!this.aiRuntime) {
      // No AI runtime configured — skip signal (safety first)
      logger.warn(`AI runtime not available, skipping signal ${agg.symbol} (safety first)`);
      return 'NO_AI_RUNTIME';
    }

    const config = this.getConfig();
    const model = config.debate_model || 'deepseek/deepseek-reasoner';
    const sessionId = `ai-risk-filter-${agg.symbol}-${Date.now()}`;

    const prompt = [
      `你是 AI 风险过滤器。请评估以下交易信号的质量。`,
      ``,
      `标的: ${agg.symbol}`,
      `综合评分: ${agg.composite_score.toFixed(3)}`,
      `动量评分: ${agg.component_scores.momentum_score.toFixed(3)}`,
      `成交量评分: ${agg.component_scores.volume_score.toFixed(3)}`,
      `情绪评分: ${agg.component_scores.sentiment_score.toFixed(3)}`,
      `AI 置信度: ${agg.component_scores.ai_confidence.toFixed(3)}`,
      `建议操作: ${agg.best_signal.action}`,
      `入场价: ${agg.best_signal.entry_price}`,
      `止损价: ${agg.best_signal.stop_loss}`,
      `止盈价: ${agg.best_signal.take_profit}`,
      ``,
      `请严格输出以下 JSON 格式（不要输出其他内容）:`,
      `{"probability":"HIGH_PROBABILITY"或"MEDIUM"或"LOW","reason":"一句话理由"}`,
    ].join('\n');

    try {
      const result = await this.aiRuntime.execute({
        sessionId,
        message: prompt,
        model,
      });

      const jsonMatch = result.text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const probability = parsed.probability;
        if (['HIGH_PROBABILITY', 'MEDIUM', 'LOW'].includes(probability)) {
          return probability;
        }
      }

      // Unparseable response — treat as LOW (safety first)
      logger.warn(`AI risk filter returned unparseable response for ${agg.symbol}, treating as LOW`);
      return 'LOW';
    } catch (err: any) {
      // Error (timeout, API failure) — skip signal (safety first)
      logger.error(`AI risk filter error for ${agg.symbol}: ${err.message}`);
      return 'ERROR';
    }
  }

  /**
   * Get today's order statistics for risk control checks.
   */
  private getTodayOrderStats(): { total_orders: number; filled_orders: number; cancelled_orders: number; total_filled_amount: number } {
    const startOfDay = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'filled' THEN 1 ELSE 0 END) as filled_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        COALESCE(SUM(CASE WHEN status = 'filled' THEN filled_quantity * COALESCE(filled_price, price, 0) ELSE 0 END), 0) as total_filled_amount
      FROM trading_orders
      WHERE created_at >= ?
    `).get(startOfDay) as any;

    return {
      total_orders: row?.total_orders ?? 0,
      filled_orders: row?.filled_orders ?? 0,
      cancelled_orders: row?.cancelled_orders ?? 0,
      total_filled_amount: row?.total_filled_amount ?? 0,
    };
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
      debate_enabled: map.get('debate_enabled') === 'true',
      debate_model: map.get('debate_model') || DEFAULT_PIPELINE_CONFIG.debate_model,
      sl_tp_enabled: map.has('sl_tp_enabled') ? map.get('sl_tp_enabled') === 'true' : DEFAULT_PIPELINE_CONFIG.sl_tp_enabled,
      sl_tp_check_interval: (() => {
        const v = parseInt(map.get('sl_tp_check_interval') ?? '', 10);
        return Number.isNaN(v) ? DEFAULT_PIPELINE_CONFIG.sl_tp_check_interval : v;
      })(),
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
    if (config.debate_enabled !== undefined) entries.push({ key: 'debate_enabled', value: String(config.debate_enabled) });
    if (config.debate_model !== undefined) entries.push({ key: 'debate_model', value: config.debate_model });
    if (config.sl_tp_enabled !== undefined) entries.push({ key: 'sl_tp_enabled', value: String(config.sl_tp_enabled) });
    if (config.sl_tp_check_interval !== undefined) entries.push({ key: 'sl_tp_check_interval', value: String(config.sl_tp_check_interval) });

    if (entries.length > 0) {
      updateTxn(entries);
    }
  }

  // ─── Dual-Agent Debate ────────────────────────────────────────────────────

  /**
   * Run bull/bear debate for a buy signal.
   * 1. Bull agent argues for buying
   * 2. Bear agent argues against buying
   * 3. Arbiter (strongest model) makes final decision
   */
  private async runDebate(
    signal: SignalCard,
    config: PipelineConfig,
  ): Promise<{ approved: boolean; confidence: number; reason: string }> {
    if (!this.aiRuntime) {
      return { approved: true, confidence: 1, reason: 'No AI runtime — debate skipped' };
    }

    const model = config.debate_model || DEFAULT_PIPELINE_CONFIG.debate_model;
    const sessionPrefix = `debate-${signal.id}-${Date.now()}`;

    const signalContext = [
      `标的: ${signal.symbol}`,
      `建议操作: ${signal.action}`,
      `入场价: ${signal.entry_price}`,
      `止损位: ${signal.stop_loss ?? 'N/A'}`,
      `止盈位: ${signal.take_profit ?? 'N/A'}`,
      `置信度: ${signal.confidence ?? 'N/A'}`,
    ].join('\n');

    // Run bull and bear agents in parallel (using dedicated agent identities)
    const [bullResult, bearResult] = await Promise.all([
      this.aiRuntime.execute({
        sessionId: `${sessionPrefix}:bull`,
        message: `请为以下标的找出所有利好因素和买入理由，用中文简洁回答（200字以内）：\n\n${signalContext}`,
        model,
        agentId: 'bull-analyst',
      }).catch(() => ({ text: '无法获取多头分析' })),
      this.aiRuntime.execute({
        sessionId: `${sessionPrefix}:bear`,
        message: `请为以下标的找出所有利空因素和不买入的理由，用中文简洁回答（200字以内）：\n\n${signalContext}`,
        model,
        agentId: 'bear-analyst',
      }).catch(() => ({ text: '无法获取空头分析' })),
    ]);

    // Arbiter: final decision
    const arbiterPrompt = [
      `你是首席风控官。请基于多空双方论点做出最终裁决。`,
      ``,
      `标的: ${signal.symbol}`,
      `多头论点: ${bullResult.text}`,
      `空头论点: ${bearResult.text}`,
      ``,
      `请严格输出以下 JSON 格式（不要输出其他内容）:`,
      `{"action":"buy"或"hold","confidence":0到1的数字,"reason":"一句话理由"}`,
    ].join('\n');

    const arbiterResult = await this.aiRuntime.execute({
      sessionId: `${sessionPrefix}:arbiter`,
      message: arbiterPrompt,
      model,
    });

    // Parse arbiter JSON response
    try {
      const jsonMatch = arbiterResult.text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        const confidence = typeof decision.confidence === 'number' ? decision.confidence : 0;
        return {
          approved: decision.action === 'buy' && confidence >= config.confidence_threshold,
          confidence,
          reason: decision.reason || 'No reason provided',
        };
      }
    } catch { /* parse error */ }

    // If parsing fails, default to approved (don't block on AI failure)
    return { approved: true, confidence: 0.5, reason: 'Debate arbiter response unparseable — defaulting to approve' };
  }

  /** Write to trading_audit_log */
  private logAudit(operation: string, orderId?: number, details?: any): void {
    this.db.prepare(`
      INSERT INTO trading_audit_log (timestamp, operation, order_id, request_params, response_result)
      VALUES (@timestamp, @operation, @order_id, @request_params, NULL)
    `).run({
      timestamp: Math.floor(Date.now() / 1000),
      operation,
      order_id: orderId ?? null,
      request_params: details ? JSON.stringify(details) : null,
    });
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
