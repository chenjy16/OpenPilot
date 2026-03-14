// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MetricsBar from './MetricsBar';
import type { LiveMetrics } from '../../stores/liveDashboardStore';

afterEach(cleanup);

const baseMetrics: LiveMetrics = {
  win_rate: 65.2,
  sharpe_ratio: 1.85,
  max_drawdown_pct: -12.3,
  total_trades: 42,
  profit_factor: 2.31,
};

describe('MetricsBar', () => {
  it('shows placeholder when metrics is null', () => {
    render(<MetricsBar metrics={null} />);
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
    expect(screen.queryByTestId('metrics-bar')).toBeNull();
  });

  it('shows placeholder when metrics is undefined', () => {
    render(<MetricsBar metrics={undefined} />);
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
  });

  it('renders five metric items with correct labels (Req 8.1)', () => {
    render(<MetricsBar metrics={baseMetrics} />);
    expect(screen.getByText('胜率')).toBeTruthy();
    expect(screen.getByText('夏普比率')).toBeTruthy();
    expect(screen.getByText('最大回撤')).toBeTruthy();
    expect(screen.getByText('总交易笔数')).toBeTruthy();
    expect(screen.getByText('盈亏比')).toBeTruthy();
  });

  it('formats win_rate as percentage (Req 8.3)', () => {
    render(<MetricsBar metrics={baseMetrics} />);
    expect(screen.getByTestId('metric-胜率').textContent).toBe('65.2%');
  });

  it('formats sharpe_ratio as two decimals (Req 8.4)', () => {
    render(<MetricsBar metrics={baseMetrics} />);
    expect(screen.getByTestId('metric-夏普比率').textContent).toBe('1.85');
  });

  it('shows N/A when sharpe_ratio is null', () => {
    render(<MetricsBar metrics={{ ...baseMetrics, sharpe_ratio: null }} />);
    expect(screen.getByTestId('metric-夏普比率').textContent).toBe('N/A');
  });

  it('formats max_drawdown_pct as percentage (Req 8.3)', () => {
    render(<MetricsBar metrics={baseMetrics} />);
    expect(screen.getByTestId('metric-最大回撤').textContent).toBe('-12.3%');
  });

  it('displays total_trades as integer', () => {
    render(<MetricsBar metrics={baseMetrics} />);
    expect(screen.getByTestId('metric-总交易笔数').textContent).toBe('42');
  });

  it('formats profit_factor as two decimals (Req 8.4)', () => {
    render(<MetricsBar metrics={baseMetrics} />);
    expect(screen.getByTestId('metric-盈亏比').textContent).toBe('2.31');
  });

  it('uses dark theme card backgrounds', () => {
    const { container } = render(<MetricsBar metrics={baseMetrics} />);
    const cards = container.querySelectorAll('.bg-gray-800');
    expect(cards.length).toBe(5);
  });
});
