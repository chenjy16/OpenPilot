// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import EquityCurveChart from './EquityCurveChart';
import type { DailyEquityPoint } from '../../stores/liveDashboardStore';

// recharts uses ResizeObserver internally; provide a minimal stub for jsdom
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub;

const sampleCurve: DailyEquityPoint[] = [
  { date: '2024-01-01', equity: 1000, daily_pnl: 0, cumulative_return: 0 },
  { date: '2024-01-02', equity: 1020, daily_pnl: 20, cumulative_return: 2 },
  { date: '2024-01-03', equity: 1015, daily_pnl: -5, cumulative_return: 1.5 },
];

describe('EquityCurveChart', () => {
  afterEach(cleanup);

  it('shows unavailable placeholder when curve is null', () => {
    render(<EquityCurveChart curve={null} />);
    expect(screen.getByTestId('equity-curve-unavailable')).toBeTruthy();
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
  });

  it('shows unavailable placeholder when curve is undefined', () => {
    render(<EquityCurveChart curve={undefined} />);
    expect(screen.getByTestId('equity-curve-unavailable')).toBeTruthy();
  });

  it('shows unavailable placeholder when curve is empty array', () => {
    render(<EquityCurveChart curve={[]} />);
    expect(screen.getByTestId('equity-curve-unavailable')).toBeTruthy();
  });

  it('renders chart container when curve has data', () => {
    render(<EquityCurveChart curve={sampleCurve} />);
    expect(screen.getByTestId('equity-curve-chart')).toBeTruthy();
    expect(screen.queryByTestId('equity-curve-unavailable')).toBeNull();
  });

  it('renders chart title', () => {
    render(<EquityCurveChart curve={sampleCurve} />);
    expect(screen.getByText('净值曲线')).toBeTruthy();
  });

  it('applies dark theme background class', () => {
    render(<EquityCurveChart curve={sampleCurve} />);
    const container = screen.getByTestId('equity-curve-chart');
    expect(container.className).toContain('bg-gray-800');
  });
});
