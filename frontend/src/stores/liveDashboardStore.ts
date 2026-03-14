import { create } from 'zustand';
import { get } from '../services/apiClient';

// ---------------------------------------------------------------------------
// Types (mirrors backend LiveDashboard types from src/services/trading/types.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface LiveDashboardState {
  data: LiveDashboardResponse | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  stale: boolean;

  fetchDashboard: () => Promise<void>;
}

export const useLiveDashboardStore = create<LiveDashboardState>()((set, _get) => ({
  data: null,
  loading: false,
  error: null,
  lastUpdated: null,
  stale: false,

  fetchDashboard: async () => {
    set({ loading: true });
    try {
      const data = await get<LiveDashboardResponse>('/trading/live-dashboard');
      set({
        data,
        loading: false,
        error: null,
        stale: false,
        lastUpdated: Date.now(),
      });
    } catch (err) {
      const prev = _get();
      set({
        loading: false,
        error: (err as Error).message,
        // Keep previous data if it exists, mark as stale
        stale: prev.data !== null,
      });
    }
  },
}));
