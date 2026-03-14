export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'moo';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'submitted' | 'partial_filled' | 'filled' | 'cancelled' | 'rejected' | 'failed';
export type TradingMode = 'paper' | 'live';

export interface TradingOrder {
  id?: number;
  local_order_id: string;
  broker_order_id?: string;
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  quantity: number;
  price?: number;
  stop_price?: number;
  status: OrderStatus;
  trading_mode: TradingMode;
  filled_quantity: number;
  filled_price?: number;
  strategy_id?: number;
  signal_id?: number;
  reject_reason?: string;
  created_at: number;
  updated_at: number;
}

export interface CreateOrderRequest {
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  quantity: number;
  price?: number;
  stop_price?: number;
  strategy_id?: number;
  signal_id?: number;
}

export interface OrderFilter {
  status?: OrderStatus;
  symbol?: string;
  start_date?: number;
  end_date?: number;
  trading_mode?: TradingMode;
  limit?: number;
  offset?: number;
}

export interface OrderStats {
  total_orders: number;
  filled_orders: number;
  cancelled_orders: number;
  total_filled_amount: number;
}

export type RiskRuleType = 'max_order_amount' | 'max_daily_amount' | 'max_position_ratio' | 'max_daily_loss' | 'max_daily_trades' | 'max_positions' | 'max_weekly_loss';

export interface RiskRule {
  id?: number;
  rule_type: RiskRuleType;
  rule_name: string;
  threshold: number;
  enabled: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface RiskCheckResult {
  passed: boolean;
  violations: Array<{
    rule_type: RiskRuleType;
    rule_name: string;
    threshold: number;
    current_value: number;
    message: string;
  }>;
}

export interface BrokerAccount {
  total_assets: number;
  available_cash: number;
  frozen_cash: number;
  currency: string;
}

export interface BrokerPosition {
  symbol: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
}

export interface BrokerOrderResult {
  broker_order_id: string;
  status: 'submitted' | 'rejected' | 'failed';
  filled_quantity?: number;
  filled_price?: number;
  message?: string;
}

export interface BrokerAdapter {
  readonly name: string;
  testConnection(): Promise<boolean>;
  submitOrder(order: TradingOrder): Promise<BrokerOrderResult>;
  cancelOrder(brokerOrderId: string): Promise<BrokerOrderResult>;
  getOrderStatus(brokerOrderId: string): Promise<BrokerOrderResult>;
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
}

export interface TradingConfig {
  trading_mode: TradingMode;
  auto_trade_enabled: boolean;
  broker_name: string;
  broker_region: string;
  paper_initial_capital: number;
  paper_commission_rate: number;
  sync_interval_seconds: number;
}

export interface BrokerCredentials {
  app_key: string;
  app_secret: string;
  access_token: string;
  /** Access Token for Longport paper (sandbox) account */
  paper_access_token: string;
}

/** Masked version of credentials for API responses (never expose secrets) */
export interface BrokerCredentialsMasked {
  app_key_set: boolean;
  app_secret_set: boolean;
  access_token_set: boolean;
  paper_access_token_set: boolean;
}

export const VALID_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['submitted', 'failed'],
  submitted: ['partial_filled', 'filled', 'cancelled', 'rejected'],
  partial_filled: ['filled', 'cancelled'],
  filled: [],
  cancelled: [],
  rejected: [],
  failed: [],
};

// ─── Auto Trading Pipeline Types ───────────────────────────────────────────

export interface SignalCard {
  id: number;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  confidence: string | null; // 'high' | 'medium' | 'low'
  created_at: number;
}

export interface PipelineConfig {
  auto_trade_enabled: boolean;
  confidence_threshold: number; // 0-1
  dedup_window_hours: number; // 默认 24
  quantity_mode: QuantityMode;
  fixed_quantity_value: number; // 固定数量模式参数
  fixed_amount_value: number; // 固定金额模式参数
  signal_poll_interval_ms: number; // 默认 5000
  /** Enable dual-agent (bull/bear) debate before order placement */
  debate_enabled: boolean;
  /** Model to use for the final arbiter in debate mode */
  debate_model: string;
  /** Enable stop-loss / take-profit monitoring */
  sl_tp_enabled: boolean;
  /** Stop-loss check interval in milliseconds */
  sl_tp_check_interval: number;
}

export interface ProcessResult {
  signal_id: number;
  action: 'order_created' | 'skipped';
  reason?: string;
  order_id?: number;
}

export interface PipelineStatus {
  enabled: boolean;
  last_signal_processed_at: number | null;
  recent_signals: ProcessResult[];
  active_stop_loss_count: number;
}

export interface EvaluationConfig {
  confidence_threshold: number;
  dedup_window_hours: number;
}

export interface EvaluationResult {
  pass: boolean;
  reason?: 'confidence_below_threshold' | 'duplicate_signal' | 'action_hold' | 'missing_price';
}

export type QuantityMode = 'fixed_quantity' | 'fixed_amount' | 'kelly_formula' | 'volatility_parity' | 'risk_budget';

export interface QuantityParams {
  mode: QuantityMode;
  fixed_quantity_value?: number;
  fixed_amount_value?: number;
  entry_price: number;
  stop_loss?: number;
  take_profit?: number;
  total_assets?: number;
  /** ATR(14) value for volatility_parity mode */
  atr14?: number;
  /** Maximum risk percentage per trade for risk_budget mode (e.g. 0.02 = 2%) */
  max_risk_pct?: number;
}

export interface StopLossRecord {
  id?: number;
  order_id: number;
  symbol: string;
  side: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  trailing_percent?: number;
  /** ATR multiplier for Chandelier Exit (e.g. 2.0 = 2×ATR) */
  trailing_atr_multiplier?: number;
  /** ATR(14) value at time of registration, used with trailing_atr_multiplier */
  atr_value?: number;
  highest_price?: number;
  status: 'active' | 'triggered_sl' | 'triggered_tp' | 'cancelled';
  triggered_at?: number;
  triggered_price?: number;
  created_at: number;
}

export interface StopLossTriggerEvent {
  record: StopLossRecord;
  trigger_type: 'stop_loss' | 'take_profit';
  current_price: number;
  pnl_amount: number;
}

// ─── Multi-Strategy Types ──────────────────────────────────────────────────

/** 策略信号 */
export interface StrategySignal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  scores: Record<string, number>;
  metadata: Record<string, any>;
}

/** 统一策略接口 */
export interface Strategy {
  readonly name: string;
  generateSignal(symbol: string, indicators: Record<string, number | null>): StrategySignal | null;
}

/** 策略注册信息 */
export interface StrategyRegistration {
  strategy: Strategy;
  weight: number;
  enabled: boolean;
}

// ─── Live Dashboard Types ──────────────────────────────────────────────────

export interface LiveDashboardResponse {
  account_summary: AccountSummary | null;
  equity_curve: DailyEquityPoint[] | null;
  ai_decisions: AIDecision[] | null;
  positions: LivePosition[] | null;
  recent_trades: LiveTradeRecord[] | null;
  metrics: LiveMetrics | null;
  risk_summary: LiveRiskRule[] | null;
  first_trade_date: number | null;
  warnings: string[];
  cached_at: number;
}

export interface AccountSummary {
  initial_capital: number;
  current_equity: number;
  total_return_pct: number;
  daily_pnl: number;
}

export interface DailyEquityPoint {
  date: string;
  equity: number;
  daily_pnl: number;
  cumulative_return: number;
}

export interface AIDecision {
  timestamp: number;
  symbol: string;
  strategy_name: string;
  side: 'buy' | 'sell';
  composite_score: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  reason: string;
}

export interface LivePosition {
  symbol: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
}

export interface LiveTradeRecord {
  symbol: string;
  strategy_name: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  hold_days: number;
  exit_time: number;
}

export interface LiveMetrics {
  win_rate: number;
  sharpe_ratio: number | null;
  max_drawdown_pct: number;
  total_trades: number;
  profit_factor: number;
}

export interface LiveRiskRule {
  rule_name: string;
  threshold: number;
  triggered: boolean;
  description: string;
}

// ─── Sensitive Field Filtering ─────────────────────────────────────────────

const SENSITIVE_KEYWORDS = [
  'credential',
  'secret',
  'token',
  'api_key',
  'app_key',
  'app_secret',
  'access_token',
];

/**
 * Recursively strips fields whose names contain sensitive keywords.
 * Matching is case-insensitive.
 */
export function stripSensitiveFields<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => stripSensitiveFields(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYWORDS.some((kw) => lowerKey.includes(kw));
    if (!isSensitive) {
      result[key] = stripSensitiveFields((obj as Record<string, unknown>)[key]);
    }
  }
  return result as T;
}

