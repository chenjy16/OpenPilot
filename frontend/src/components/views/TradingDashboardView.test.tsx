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

describe('TradingDashboardView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useTradingStore.setState({
      account: { total_assets: 100000, available_cash: 50000, frozen_cash: 10000, currency: 'HKD' },
      orders: mockOrders,
      riskRules: [],
      stats: { total_orders: 4, filled_orders: 2, cancelled_orders: 0, total_filled_amount: 5000 },
      config: baseMockConfig,
      credentials: { app_key_set: true, app_secret_set: true, access_token_set: false, paper_access_token_set: true },
      pipelineStatus: null,
      stopLossRecords: [],
      pipelineSignals: [],
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('should embed AutoTradingPanel in the dashboard', () => {
    render(<TradingDashboardView />);
    expect(screen.getByTestId('auto-trading-panel')).toBeTruthy();
  });

  it('should show "来源" column header in active orders table', () => {
    render(<TradingDashboardView />);
    // Active orders section has "来源" header
    const headers = screen.getAllByText('来源');
    expect(headers.length).toBeGreaterThanOrEqual(1);
  });

  it('should classify signal_id-only order as "信号自动"', () => {
    render(<TradingDashboardView />);
    // Order 1: signal_id=10, strategy_id=undefined → 信号自动
    // Appears in both active orders and order history tables
    const badges = screen.getAllByText('信号自动');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('should classify strategy_id order as "策略自动"', () => {
    render(<TradingDashboardView />);
    // Order 2 (strategy_id=5) and Order 4 (strategy_id=3) → 策略自动
    // Some appear in both active and history tables
    const badges = screen.getAllByText('策略自动');
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('should classify order with no signal_id/strategy_id as "手动"', () => {
    render(<TradingDashboardView />);
    // Order 3: both null → 手动
    expect(screen.getByText('手动')).toBeTruthy();
  });

  it('should poll stop-loss records every 3 seconds', () => {
    const mockFetchStopLoss = vi.fn().mockResolvedValue(undefined);
    useTradingStore.setState({ fetchStopLossRecords: mockFetchStopLoss });

    render(<TradingDashboardView />);

    // Advance timer by 3 seconds
    vi.advanceTimersByTime(3000);
    expect(mockFetchStopLoss).toHaveBeenCalled();

    // Advance another 3 seconds
    vi.advanceTimersByTime(3000);
    expect(mockFetchStopLoss.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('should clean up stop-loss polling on unmount', () => {
    const mockFetchStopLoss = vi.fn().mockResolvedValue(undefined);
    useTradingStore.setState({ fetchStopLossRecords: mockFetchStopLoss });

    const { unmount } = render(<TradingDashboardView />);
    unmount();

    // After unmount, advancing timers should not trigger more calls
    const callCount = mockFetchStopLoss.mock.calls.length;
    vi.advanceTimersByTime(6000);
    expect(mockFetchStopLoss.mock.calls.length).toBe(callCount);
  });
});
