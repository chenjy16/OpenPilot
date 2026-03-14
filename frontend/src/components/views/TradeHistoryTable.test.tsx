// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TradeHistoryTable from './TradeHistoryTable';
import type { LiveTradeRecord } from '../../stores/liveDashboardStore';

afterEach(cleanup);

const sampleTrades: LiveTradeRecord[] = [
  {
    symbol: 'AAPL',
    strategy_name: 'Momentum',
    entry_price: 150.0,
    exit_price: 165.5,
    pnl: 155.0,
    pnl_pct: 10.33,
    hold_days: 5,
    exit_time: 1705312200, // 2024-01-15 ~14:30 UTC
  },
  {
    symbol: 'TSLA',
    strategy_name: 'MeanReversion',
    entry_price: 250.0,
    exit_price: 230.0,
    pnl: -100.0,
    pnl_pct: -8.0,
    hold_days: 3,
    exit_time: 1705225800,
  },
];

describe('TradeHistoryTable', () => {
  it('shows "数据暂不可用" when trades is null (Req 7.2)', () => {
    render(<TradeHistoryTable trades={null} />);
    expect(screen.getByTestId('trade-history-unavailable')).toBeTruthy();
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
  });

  it('shows "数据暂不可用" when trades is undefined', () => {
    render(<TradeHistoryTable trades={undefined} />);
    expect(screen.getByTestId('trade-history-unavailable')).toBeTruthy();
  });

  it('shows "暂无交易记录" when trades is empty array', () => {
    render(<TradeHistoryTable trades={[]} />);
    expect(screen.getByTestId('trade-history-empty')).toBeTruthy();
    expect(screen.getByText('暂无交易记录')).toBeTruthy();
  });

  it('renders table with all column headers (Req 7.2)', () => {
    render(<TradeHistoryTable trades={sampleTrades} />);
    expect(screen.getByText('标的')).toBeTruthy();
    expect(screen.getByText('策略')).toBeTruthy();
    expect(screen.getByText('买入价')).toBeTruthy();
    expect(screen.getByText('卖出价')).toBeTruthy();
    expect(screen.getByText('盈亏')).toBeTruthy();
    expect(screen.getByText('盈亏%')).toBeTruthy();
    expect(screen.getByText('持仓天数')).toBeTruthy();
    expect(screen.getByText('平仓时间')).toBeTruthy();
  });

  it('renders trade data correctly (Req 7.1, 7.2)', () => {
    render(<TradeHistoryTable trades={sampleTrades} />);
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByText('TSLA')).toBeTruthy();
    expect(screen.getByText('Momentum')).toBeTruthy();
    expect(screen.getByText('MeanReversion')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('applies green color class for positive PnL (Req 7.4)', () => {
    render(<TradeHistoryTable trades={sampleTrades} />);
    const greenCells = document.querySelectorAll('.text-green-500');
    expect(greenCells.length).toBeGreaterThan(0);
  });

  it('applies red color class for negative PnL (Req 7.5)', () => {
    render(<TradeHistoryTable trades={sampleTrades} />);
    const redCells = document.querySelectorAll('.text-red-500');
    expect(redCells.length).toBeGreaterThan(0);
  });

  it('adds "+" prefix for positive PnL values', () => {
    render(<TradeHistoryTable trades={sampleTrades} />);
    const html = document.body.innerHTML;
    expect(html).toContain('+$155.00');
    expect(html).toContain('+10.33%');
  });

  it('does not add "+" prefix for negative PnL values', () => {
    render(<TradeHistoryTable trades={sampleTrades} />);
    const html = document.body.innerHTML;
    expect(html).not.toContain('+-');
  });

  it('formats exit_time as readable date string', () => {
    render(<TradeHistoryTable trades={sampleTrades} />);
    // The exact output depends on local timezone, but it should contain a date pattern
    const html = document.body.innerHTML;
    // Should contain year-month-day pattern
    expect(html).toMatch(/2024-01-\d{2}\s\d{2}:\d{2}/);
  });

  it('uses dark theme compatible styling', () => {
    const { container } = render(<TradeHistoryTable trades={sampleTrades} />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('bg-gray-800');
  });
});
