// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import AutoTradingPanel from './AutoTradingPanel';
import { useTradingStore } from '../../stores/tradingStore';

// Mock the apiClient module
vi.mock('../../services/apiClient', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

const baseMockConfig = {
  trading_mode: 'paper' as const,
  auto_trade_enabled: false,
  broker_name: 'longport',
  broker_region: 'hk',
  paper_initial_capital: 100000,
  paper_commission_rate: 0.001,
  sync_interval_seconds: 30,
  confidence_threshold: 0.6,
  dedup_window_hours: 24,
  quantity_mode: 'fixed_quantity' as const,
  quantity_params: { fixed_quantity_value: 100, fixed_amount_value: 10000 },
  sl_tp_enabled: true,
  sl_tp_check_interval: 30000,
};

const mockSignals = [
  { signal_id: 1, action: 'order_created' as const, order_id: 10 },
  { signal_id: 2, action: 'skipped' as const, reason: 'confidence_below_threshold' },
  { signal_id: 3, action: 'skipped' as const, reason: 'duplicate_signal' },
  { signal_id: 4, action: 'skipped' as const, reason: 'risk_rejected' },
  { signal_id: 5, action: 'skipped' as const, reason: 'quantity_insufficient' },
];

const mockStopLossRecords = [
  {
    id: 1, order_id: 100, symbol: '0700.HK', side: 'buy' as const,
    entry_price: 350, stop_loss: 330, take_profit: 380,
    status: 'active' as const, created_at: Math.floor(Date.now() / 1000),
  },
  {
    id: 2, order_id: 101, symbol: '9988.HK', side: 'buy' as const,
    entry_price: 80, stop_loss: 75, take_profit: 90,
    status: 'triggered_tp' as const, triggered_at: Math.floor(Date.now() / 1000),
    triggered_price: 90, created_at: Math.floor(Date.now() / 1000) - 3600,
  },
];

describe('AutoTradingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTradingStore.setState({
      config: baseMockConfig,
      pipelineSignals: mockSignals,
      stopLossRecords: mockStopLossRecords,
      pipelineStatus: {
        enabled: false,
        last_signal_processed_at: null,
        recent_signals: mockSignals,
        active_stop_loss_count: 1,
      },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('should render the panel header', () => {
    render(<AutoTradingPanel />);
    expect(screen.getByText('自动交易')).toBeTruthy();
  });

  it('should show pipeline disabled state', () => {
    render(<AutoTradingPanel />);
    expect(screen.getByText('流水线已停用')).toBeTruthy();
  });

  it('should show pipeline enabled state', () => {
    useTradingStore.setState({
      config: { ...baseMockConfig, auto_trade_enabled: true },
    });
    render(<AutoTradingPanel />);
    expect(screen.getByText('流水线已启用')).toBeTruthy();
  });

  it('should render summary stats cards', () => {
    render(<AutoTradingPanel />);
    expect(screen.getByText('今日自动下单')).toBeTruthy();
    expect(screen.getByText('止盈触发')).toBeTruthy();
    expect(screen.getByText('止损触发')).toBeTruthy();
    expect(screen.getByText('信号处理数')).toBeTruthy();
  });

  it('should display recent signals with Chinese labels', () => {
    render(<AutoTradingPanel />);
    expect(screen.getByText('已下单')).toBeTruthy();
    expect(screen.getByText('置信度不足跳过')).toBeTruthy();
    expect(screen.getByText('去重跳过')).toBeTruthy();
    expect(screen.getByText('风控拒绝')).toBeTruthy();
    expect(screen.getByText('数量不足跳过')).toBeTruthy();
  });

  it('should display active stop-loss records', () => {
    render(<AutoTradingPanel />);
    expect(screen.getByText('0700.HK')).toBeTruthy();
    expect(screen.getByText('350.00')).toBeTruthy();
    expect(screen.getByText('330.00')).toBeTruthy();
    expect(screen.getByText('380.00')).toBeTruthy();
    expect(screen.getByText('监控中')).toBeTruthy();
  });

  it('should only show active records in stop-loss list (not triggered ones)', () => {
    render(<AutoTradingPanel />);
    // 9988.HK is triggered_tp, should not appear in the active list
    expect(screen.queryByText('9988.HK')).toBeNull();
  });

  it('should show config panel when config button is clicked', () => {
    render(<AutoTradingPanel />);
    const configBtn = screen.getByText('⚙️ 配置');
    fireEvent.click(configBtn);
    expect(screen.getByText('自动交易配置')).toBeTruthy();
    expect(screen.getByText('置信度阈值: 0.60')).toBeTruthy();
  });

  it('should show empty state for signals when none exist', () => {
    useTradingStore.setState({ pipelineSignals: [] });
    render(<AutoTradingPanel />);
    expect(screen.getByText('暂无信号处理记录')).toBeTruthy();
  });

  it('should show empty state for stop-loss when no active records', () => {
    useTradingStore.setState({ stopLossRecords: [] });
    render(<AutoTradingPanel />);
    expect(screen.getByText('暂无活跃止盈止损监控')).toBeTruthy();
  });

  it('should toggle pipeline when switch is clicked', async () => {
    const mockUpdateConfig = vi.fn().mockResolvedValue(undefined);
    useTradingStore.setState({
      updateConfig: mockUpdateConfig,
    });
    render(<AutoTradingPanel />);
    const toggle = screen.getByRole('switch', { name: '自动交易开关' });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith({ auto_trade_enabled: true });
    });
  });

  it('should display active stop-loss count from pipeline status', () => {
    render(<AutoTradingPanel />);
    expect(screen.getByText('(1 条)')).toBeTruthy();
  });
});
