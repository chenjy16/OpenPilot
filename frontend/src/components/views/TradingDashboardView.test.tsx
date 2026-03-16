// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TradingDashboardView from './TradingDashboardView';
import { useTradingStore } from '../../stores/tradingStore';

// Mock the apiClient module
vi.mock('../../services/apiClient', () => ({
  get: vi.fn().mockResolvedValue([]),
  post: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue({}),
}));

// Mock AutoTradingPanel to isolate TradingDashboardView tests
vi.mock('./AutoTradingPanel', () => ({
  default: () => <div data-testid="auto-trading-panel">AutoTradingPanel</div>,
}));

// Mock global fetch — route-aware
const mockFetch = vi.fn().mockImplementation((url: string) => {
  if (typeof url === 'string' && url.includes('/api/trading/dynamic-risk')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        regime: 'normal', vix_level: 15.5, portfolio_drawdown: 0.02, risk_multiplier: 1.0,
      }),
    });
  }
  return Promise.resolve({
    ok: true,
    json: async () => ({ orders: [], total: 0 }),
  });
});
vi.stubGlobal('fetch', mockFetch);

const baseMockConfig = {
  trading_mode: 'paper' as const,
  auto_trade_enabled: false,
  broker_name: 'longport',
  broker_region: 'hk',
  paper_initial_capital: 100000,
  paper_commission_rate: 0.001,
  sync_interval_seconds: 30,
};

const now = Math.floor(Date.now() / 1000);

const mockOrders = [
  {
    id: 1, local_order_id: 'o1', symbol: '0700.HK', side: 'buy' as const,
    order_type: 'limit' as const, quantity: 100, price: 350, status: 'submitted' as const,
    trading_mode: 'paper' as const, filled_quantity: 0, created_at: now, updated_at: now,
    signal_id: 10, strategy_id: undefined,
  },
  {
    id: 2, local_order_id: 'o2', symbol: '9988.HK', side: 'sell' as const,
    order_type: 'market' as const, quantity: 50, status: 'filled' as const,
    trading_mode: 'paper' as const, filled_quantity: 50, filled_price: 82,
    created_at: now - 100, updated_at: now - 50,
    signal_id: undefined, strategy_id: 5,
  },
  {
    id: 3, local_order_id: 'o3', symbol: '1810.HK', side: 'buy' as const,
    order_type: 'market' as const, quantity: 200, status: 'filled' as const,
    trading_mode: 'paper' as const, filled_quantity: 200, filled_price: 15,
    created_at: now - 200, updated_at: now - 150,
    signal_id: undefined, strategy_id: undefined,
  },
  {
    id: 4, local_order_id: 'o4', symbol: '2318.HK', side: 'buy' as const,
    order_type: 'limit' as const, quantity: 100, price: 50, status: 'pending' as const,
    trading_mode: 'paper' as const, filled_quantity: 0,
    created_at: now - 10, updated_at: now - 10,
    signal_id: 20, strategy_id: 3,
  },
];

const mockPositions = [
  { symbol: 'AAPL.US', quantity: 10, avg_cost: 150, current_price: 160, market_value: 1600 },
  { symbol: 'TSLA.US', quantity: 5, avg_cost: 200, current_price: 190, market_value: 950 },
];

const baseStoreState = {
  account: { total_assets: 100000, available_cash: 50000, frozen_cash: 10000, currency: 'USD' },
  orders: mockOrders,
  positions: mockPositions,
  riskRules: [],
  stats: { total_orders: 4, filled_orders: 2, cancelled_orders: 0, total_filled_amount: 5000 },
  config: baseMockConfig,
  credentials: { app_key_set: true, app_secret_set: true, access_token_set: false, paper_access_token_set: true },
  pipelineStatus: null,
  stopLossRecords: [],
  pipelineSignals: [],
  loading: false,
  error: null,
};

describe('TradingDashboardView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/trading/dynamic-risk')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            regime: 'normal', vix_level: 15.5, portfolio_drawdown: 0.02, risk_multiplier: 1.0,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ orders: mockOrders, total: mockOrders.length }),
      });
    });
    useTradingStore.setState(baseStoreState);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('should display positions-based account overview with correct labels', () => {
    render(<TradingDashboardView />);
    expect(screen.getByText('持仓成本')).toBeTruthy();
    expect(screen.getByText('持仓市值')).toBeTruthy();
    expect(screen.getByText('浮动盈亏')).toBeTruthy();
    expect(screen.getByText('当日交易笔数')).toBeTruthy();
  });

  it('should compute account overview values from positions', () => {
    render(<TradingDashboardView />);
    // AAPL: cost=10*150=1500, market=10*160=1600
    // TSLA: cost=5*200=1000, market=5*190=950
    // totalCost=2500, totalMarket=2550, pnl=+50
    expect(screen.getByText('$2,500.00')).toBeTruthy();
    expect(screen.getByText('$2,550.00')).toBeTruthy();
    expect(screen.getByText('+$50.00')).toBeTruthy();
  });

  it('should embed AutoTradingPanel in the dashboard', () => {
    render(<TradingDashboardView />);
    expect(screen.getByTestId('auto-trading-panel')).toBeTruthy();
  });

  it('should show "来源" column header in active orders table', () => {
    render(<TradingDashboardView />);
    const headers = screen.getAllByText('来源');
    expect(headers.length).toBeGreaterThanOrEqual(1);
  });

  it('should classify signal_id-only order as "信号自动"', () => {
    render(<TradingDashboardView />);
    // Order 1: signal_id=10, strategy_id=undefined → 信号自动 (in active orders)
    const badges = screen.getAllByText('信号自动');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('should classify strategy_id order as "策略自动"', () => {
    render(<TradingDashboardView />);
    // Order 4: strategy_id=3 → 策略自动 (in active orders, pending status)
    const badges = screen.getAllByText('策略自动');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('should poll stop-loss records every 15 seconds', () => {
    const mockFetchStopLoss = vi.fn().mockResolvedValue(undefined);
    useTradingStore.setState({ ...baseStoreState, fetchStopLossRecords: mockFetchStopLoss });

    render(<TradingDashboardView />);

    vi.advanceTimersByTime(15000);
    expect(mockFetchStopLoss).toHaveBeenCalled();

    vi.advanceTimersByTime(15000);
    expect(mockFetchStopLoss.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('should clean up stop-loss polling on unmount', () => {
    const mockFetchStopLoss = vi.fn().mockResolvedValue(undefined);
    useTradingStore.setState({ ...baseStoreState, fetchStopLossRecords: mockFetchStopLoss });

    const { unmount } = render(<TradingDashboardView />);
    unmount();

    const callCount = mockFetchStopLoss.mock.calls.length;
    vi.advanceTimersByTime(30000);
    expect(mockFetchStopLoss.mock.calls.length).toBe(callCount);
  });
});
