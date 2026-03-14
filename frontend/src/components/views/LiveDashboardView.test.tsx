// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LiveDashboardView from './LiveDashboardView';
import { useLiveDashboardStore, type LiveDashboardResponse } from '../../stores/liveDashboardStore';

// Mock the apiClient so the store doesn't make real requests
vi.mock('../../services/apiClient', () => ({
  get: vi.fn().mockResolvedValue({}),
}));

const mockData: LiveDashboardResponse = {
  account_summary: {
    initial_capital: 1000,
    current_equity: 1234.56,
    total_return_pct: 23.456,
    daily_pnl: 12.34,
  },
  equity_curve: [],
  ai_decisions: [],
  positions: [],
  recent_trades: [],
  metrics: {
    win_rate: 65.2,
    sharpe_ratio: 1.85,
    max_drawdown_pct: -12.3,
    total_trades: 42,
    profit_factor: 2.31,
  },
  risk_summary: [],
  first_trade_date: 1700000000,
  warnings: [],
  cached_at: 1700001000,
};

describe('LiveDashboardView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('applies dark theme background classes', () => {
    useLiveDashboardStore.setState({ data: mockData, loading: false, error: null, stale: false });
    const { container } = render(<LiveDashboardView />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bg-gray-900');
    expect(root.className).toContain('text-white');
  });

  it('renders all layout sections in correct order (Req 11.1)', () => {
    useLiveDashboardStore.setState({ data: mockData, loading: false, error: null, stale: false });
    render(<LiveDashboardView />);

    expect(screen.getByTestId('live-header-section')).toBeTruthy();
    expect(screen.getByTestId('account-summary-section')).toBeTruthy();
    expect(screen.getByTestId('equity-curve-section')).toBeTruthy();
    expect(screen.getByTestId('two-column-section')).toBeTruthy();
    expect(screen.getByTestId('ai-decision-feed-section')).toBeTruthy();
    expect(screen.getByTestId('position-panel-section')).toBeTruthy();
    expect(screen.getByTestId('trade-history-section')).toBeTruthy();
    expect(screen.getByTestId('metrics-bar-section')).toBeTruthy();
    expect(screen.getByTestId('risk-summary-section')).toBeTruthy();
  });

  it('calls fetchDashboard on mount and sets up 60s interval (Req 11.2)', () => {
    const mockFetch = vi.fn().mockResolvedValue(undefined);
    useLiveDashboardStore.setState({
      data: mockData,
      loading: false,
      error: null,
      stale: false,
      fetchDashboard: mockFetch,
    });

    render(<LiveDashboardView />);

    // Called once on mount
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance 60 seconds — should call again
    vi.advanceTimersByTime(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Advance another 60 seconds
    vi.advanceTimersByTime(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('cleans up interval on unmount', () => {
    const mockFetch = vi.fn().mockResolvedValue(undefined);
    useLiveDashboardStore.setState({
      data: mockData,
      loading: false,
      error: null,
      stale: false,
      fetchDashboard: mockFetch,
    });

    const { unmount } = render(<LiveDashboardView />);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    unmount();

    // After unmount, advancing timers should not trigger more calls
    const callCount = mockFetch.mock.calls.length;
    vi.advanceTimersByTime(120_000);
    expect(mockFetch.mock.calls.length).toBe(callCount);
  });

  it('shows stale data warning banner when stale=true (Req 11.3)', () => {
    useLiveDashboardStore.setState({ data: mockData, loading: false, error: 'Network error', stale: true });
    render(<LiveDashboardView />);
    expect(screen.getByText('数据更新失败，显示的是缓存数据')).toBeTruthy();
  });

  it('does not show stale banner when stale=false', () => {
    useLiveDashboardStore.setState({ data: mockData, loading: false, error: null, stale: false });
    render(<LiveDashboardView />);
    expect(screen.queryByText('数据更新失败，显示的是缓存数据')).toBeNull();
  });

  it('shows full-screen error with retry button when first load fails (data=null, error set)', () => {
    useLiveDashboardStore.setState({ data: null, loading: false, error: 'Connection refused', stale: false });
    render(<LiveDashboardView />);

    expect(screen.getByText('Connection refused')).toBeTruthy();
    expect(screen.getByText('重试')).toBeTruthy();
    // Layout sections should NOT be rendered
    expect(screen.queryByTestId('live-header-section')).toBeNull();
  });

  it('retry button calls fetchDashboard', () => {
    const mockFetch = vi.fn().mockResolvedValue(undefined);
    useLiveDashboardStore.setState({
      data: null,
      loading: false,
      error: 'Timeout',
      stale: false,
      fetchDashboard: mockFetch,
    });

    render(<LiveDashboardView />);
    // fetchDashboard called once on mount
    const initialCalls = mockFetch.mock.calls.length;

    screen.getByText('重试').click();
    expect(mockFetch.mock.calls.length).toBe(initialCalls + 1);
  });

  it('shows loading state on first load (data=null, loading=true)', () => {
    useLiveDashboardStore.setState({ data: null, loading: true, error: null, stale: false });
    render(<LiveDashboardView />);
    expect(screen.getByText('加载中...')).toBeTruthy();
    expect(screen.queryByTestId('live-header-section')).toBeNull();
  });

  it('does not contain any sensitive operation entries (Req 10.1)', () => {
    useLiveDashboardStore.setState({ data: mockData, loading: false, error: null, stale: false });
    const { container } = render(<LiveDashboardView />);
    const html = container.innerHTML;

    // Must not contain any operation forms or sensitive config UI
    expect(html).not.toContain('手动下单');
    expect(html).not.toContain('券商配置');
    expect(html).not.toContain('API 密钥');
    expect(html).not.toContain('api_key');
    expect(html).not.toContain('交易模式切换');
  });
});
