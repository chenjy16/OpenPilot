// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PositionPanel from './PositionPanel';
import type { LivePosition } from '../../stores/liveDashboardStore';

afterEach(cleanup);

const samplePositions: LivePosition[] = [
  {
    symbol: 'AAPL',
    quantity: 10,
    avg_cost: 150.0,
    current_price: 165.5,
    unrealized_pnl: 155.0,
    unrealized_pnl_pct: 10.33,
  },
  {
    symbol: 'TSLA',
    quantity: 5,
    avg_cost: 250.0,
    current_price: 230.0,
    unrealized_pnl: -100.0,
    unrealized_pnl_pct: -8.0,
  },
];

describe('PositionPanel', () => {
  it('shows "数据暂不可用" when positions is null (Req 6.5)', () => {
    render(<PositionPanel positions={null} />);
    expect(screen.getByTestId('position-panel-unavailable')).toBeTruthy();
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
  });

  it('shows "数据暂不可用" when positions is undefined', () => {
    render(<PositionPanel positions={undefined} />);
    expect(screen.getByTestId('position-panel-unavailable')).toBeTruthy();
  });

  it('shows "当前无持仓" when positions is empty array (Req 6.5)', () => {
    render(<PositionPanel positions={[]} />);
    expect(screen.getByTestId('position-panel-empty')).toBeTruthy();
    expect(screen.getByText('当前无持仓')).toBeTruthy();
  });

  it('renders table with all column headers (Req 6.1)', () => {
    render(<PositionPanel positions={samplePositions} />);
    expect(screen.getByText('标的')).toBeTruthy();
    expect(screen.getByText('数量')).toBeTruthy();
    expect(screen.getByText('成本价')).toBeTruthy();
    expect(screen.getByText('当前价')).toBeTruthy();
    expect(screen.getByText('浮动盈亏')).toBeTruthy();
    expect(screen.getByText('盈亏%')).toBeTruthy();
  });

  it('renders position data correctly (Req 6.1)', () => {
    render(<PositionPanel positions={samplePositions} />);
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByText('TSLA')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('applies green color class for positive PnL (Req 6.2)', () => {
    render(<PositionPanel positions={samplePositions} />);
    // AAPL has positive PnL — find the PnL cell
    const pnlCells = document.querySelectorAll('.text-green-500');
    expect(pnlCells.length).toBeGreaterThan(0);
  });

  it('applies red color class for negative PnL (Req 6.3)', () => {
    render(<PositionPanel positions={samplePositions} />);
    const redCells = document.querySelectorAll('.text-red-500');
    expect(redCells.length).toBeGreaterThan(0);
  });

  it('adds "+" prefix for positive PnL values', () => {
    render(<PositionPanel positions={samplePositions} />);
    const html = document.body.innerHTML;
    // Positive PnL should have + prefix
    expect(html).toContain('+$155.00');
    expect(html).toContain('+10.33%');
  });

  it('does not add "+" prefix for negative PnL values', () => {
    render(<PositionPanel positions={samplePositions} />);
    const html = document.body.innerHTML;
    // Negative PnL should NOT have + prefix (just the minus from formatUSD)
    expect(html).not.toContain('+-');
  });

  it('uses dark theme compatible styling', () => {
    const { container } = render(<PositionPanel positions={samplePositions} />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('bg-gray-800');
  });
});
