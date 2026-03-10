import { create } from 'zustand';
import { get, post, put } from '../services/apiClient';

// ---------------------------------------------------------------------------
// Types (mirrors backend types)
// ---------------------------------------------------------------------------

export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus =
  | 'pending' | 'submitted' | 'partial_filled' | 'filled'
  | 'cancelled' | 'rejected' | 'failed';
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

export interface RiskRule {
  id?: number;
  rule_type: string;
  rule_name: string;
  threshold: number;
  enabled: boolean;
}

export interface OrderStats {
  total_orders: number;
  filled_orders: number;
  cancelled_orders: number;
  total_filled_amount: number;
}

export interface TradingConfig {
  trading_mode: TradingMode;
  auto_trade_enabled: boolean;
  broker_name: string;
  broker_region: string;
  paper_initial_capital: number;
  paper_commission_rate: number;
  sync_interval_seconds: number;
  // Auto trading config fields
  confidence_threshold?: number;
  dedup_window_hours?: number;
  quantity_mode?: 'fixed_quantity' | 'fixed_amount' | 'kelly_formula';
  quantity_params?: {
    fixed_quantity_value?: number;
    fixed_amount_value?: number;
  };
  sl_tp_enabled?: boolean;
  sl_tp_check_interval?: number;
}

export interface BrokerCredentialsMasked {
  app_key_set: boolean;
  app_secret_set: boolean;
  access_token_set: boolean;
  paper_access_token_set: boolean;
}

// ---------------------------------------------------------------------------
// Auto Trading Types
// ---------------------------------------------------------------------------

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

export interface StopLossRecord {
  id?: number;
  order_id: number;
  symbol: string;
  side: 'buy';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  status: 'active' | 'triggered_sl' | 'triggered_tp' | 'cancelled';
  triggered_at?: number;
  triggered_price?: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface TradingState {
  // Data
  account: BrokerAccount | null;
  orders: TradingOrder[];
  positions: BrokerPosition[];
  riskRules: RiskRule[];
  stats: OrderStats | null;
  config: TradingConfig | null;
  credentials: BrokerCredentialsMasked | null;
  pipelineStatus: PipelineStatus | null;
  stopLossRecords: StopLossRecord[];
  pipelineSignals: ProcessResult[];

  // UI state
  loading: boolean;
  error: string | null;
  pollingTimer: ReturnType<typeof setInterval> | null;

  // Actions
  fetchAccount: () => Promise<void>;
  fetchOrders: () => Promise<void>;
  fetchPositions: () => Promise<void>;
  fetchRiskRules: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchConfig: () => Promise<void>;
  fetchCredentials: () => Promise<void>;
  fetchPipelineStatus: () => Promise<void>;
  fetchStopLossRecords: () => Promise<void>;
  fetchPipelineSignals: () => Promise<void>;
  placeOrder: (req: CreateOrderRequest) => Promise<TradingOrder>;
  cancelOrder: (id: number) => Promise<void>;
  updateRiskRules: (id: number, updates: Partial<RiskRule>) => Promise<void>;
  updateConfig: (updates: Partial<TradingConfig>) => Promise<void>;
  saveCredentials: (creds: { app_key?: string; app_secret?: string; access_token?: string; paper_access_token?: string }) => Promise<void>;
  testBrokerConnection: () => Promise<{ connected: boolean; error?: string }>;
  fetchAll: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useTradingStore = create<TradingState>()((set, _get) => ({
  account: null,
  orders: [],
  positions: [],
  riskRules: [],
  stats: null,
  config: null,
  credentials: null,
  pipelineStatus: null,
  stopLossRecords: [],
  pipelineSignals: [],
  loading: false,
  error: null,
  pollingTimer: null,

  fetchAccount: async () => {
    try {
      const data = await get<BrokerAccount>('/trading/account');
      set({ account: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchOrders: async () => {
    try {
      const data = await get<TradingOrder[]>('/trading/orders');
      set({ orders: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchPositions: async () => {
    try {
      const data = await get<BrokerPosition[]>('/trading/positions');
      set({ positions: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchRiskRules: async () => {
    try {
      const data = await get<RiskRule[]>('/trading/risk-rules');
      set({ riskRules: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchStats: async () => {
    try {
      const data = await get<OrderStats>('/trading/stats');
      set({ stats: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchConfig: async () => {
    try {
      const data = await get<TradingConfig>('/trading/config');
      set({ config: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchCredentials: async () => {
    try {
      const data = await get<BrokerCredentialsMasked>('/trading/broker-credentials');
      set({ credentials: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchPipelineStatus: async () => {
    try {
      const data = await get<PipelineStatus>('/trading/pipeline/status');
      set({ pipelineStatus: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchStopLossRecords: async () => {
    try {
      const data = await get<StopLossRecord[]>('/trading/stop-loss');
      set({ stopLossRecords: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchPipelineSignals: async () => {
    try {
      const data = await get<ProcessResult[]>('/trading/pipeline/signals');
      set({ pipelineSignals: data });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  placeOrder: async (req: CreateOrderRequest) => {
    const order = await post<TradingOrder>('/trading/orders', req);
    const store = _get();
    set({ orders: [order, ...store.orders] });
    return order;
  },

  cancelOrder: async (id: number) => {
    const updated = await post<TradingOrder>(`/trading/orders/${id}/cancel`);
    const store = _get();
    set({ orders: store.orders.map((o) => (o.id === id ? updated : o)) });
  },

  updateRiskRules: async (id: number, updates: Partial<RiskRule>) => {
    await put<RiskRule>('/trading/risk-rules', { id, ...updates });
    await _get().fetchRiskRules();
  },

  updateConfig: async (updates: Partial<TradingConfig>) => {
    await put<TradingConfig>('/trading/config', updates);
    await _get().fetchConfig();
  },

  saveCredentials: async (creds) => {
    await put<BrokerCredentialsMasked>('/trading/broker-credentials', creds);
    await _get().fetchCredentials();
  },

  testBrokerConnection: async () => {
    const result = await post<{ connected: boolean; error?: string }>('/trading/broker-test');
    return result;
  },

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [account, orders, positions, riskRules, stats, config, credentials] = await Promise.all([
        get<BrokerAccount>('/trading/account'),
        get<TradingOrder[]>('/trading/orders'),
        get<BrokerPosition[]>('/trading/positions'),
        get<RiskRule[]>('/trading/risk-rules'),
        get<OrderStats>('/trading/stats'),
        get<TradingConfig>('/trading/config'),
        get<BrokerCredentialsMasked>('/trading/broker-credentials'),
      ]);
      set({ account, orders, positions, riskRules, stats, config, credentials, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  startPolling: () => {
    const store = _get();
    if (store.pollingTimer) return;
    const timer = setInterval(async () => {
      try {
        const [orders, account, stats] = await Promise.all([
          get<TradingOrder[]>('/trading/orders'),
          get<BrokerAccount>('/trading/account'),
          get<OrderStats>('/trading/stats'),
        ]);
        set({ orders, account, stats });
      } catch {
        // Silently ignore polling errors
      }
    }, 3000);
    set({ pollingTimer: timer });
  },

  stopPolling: () => {
    const store = _get();
    if (store.pollingTimer) {
      clearInterval(store.pollingTimer);
      set({ pollingTimer: null });
    }
  },
}));
