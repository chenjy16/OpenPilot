// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AccountSummaryCard from './AccountSummaryCard';
import type { AccountSummary } from '../../stores/liveDashboardStore';

afterEach(cleanup);

const baseSummary: AccountSummary = {
  initial_capital: 1000,
  current_equity: 1234.56,
  total_return_pct: 23.46,
  daily_pnl: 12.34,
};

describe('AccountSummaryCard', () => {
  it('shows placeholder when summary is null', () => {
    render(<AccountSummaryCard summary={null} />);
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
    expect(screen.queryByTestId('account-summary-cards')).toBeNull();
  });

  it('shows placeholder when summary is undefined', () => {
    render(<AccountSummaryCard summary={undefined} />);
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
  });

  it('renders four cards with correct labels (Req 2.1)', () => {
    render(<AccountSummaryCard summary={baseSummary} />);
    expect(screen.getByText('持仓成本')).toBeTruthy();
    expect(screen.getByText('持仓市值')).toBeTruthy();
    expect(screen.getByText('累计收益率')).toBeTruthy();
    expect(screen.getByText('当日盈亏')).toBeTruthy();
  });

  it('displays initial capital from summary (Req 2.1)', () => {
    render(<AccountSummaryCard summary={baseSummary} />);
    expect(screen.getByTestId('summary-持仓成本').textContent).toBe('$1,000.00');
  });

  it('formats current equity as USD (Req 2.6)', () => {
    render(<AccountSummaryCard summary={baseSummary} />);
    expect(screen.getByTestId('summary-持仓市值').textContent).toBe('$1,234.56');
  });

  it('shows positive return in green with + prefix (Req 2.2)', () => {
    render(<AccountSummaryCard summary={baseSummary} />);
    const el = screen.getByTestId('summary-累计收益率');
    expect(el.textContent).toBe('+23.46%');
    expect(el.className).toContain('text-green-500');
  });

  it('shows negative return in red (Req 2.3)', () => {
    render(<AccountSummaryCard summary={{ ...baseSummary, total_return_pct: -5.12 }} />);
    const el = screen.getByTestId('summary-累计收益率');
    expect(el.textContent).toBe('-5.12%');
    expect(el.className).toContain('text-red-500');
  });

  it('shows positive daily PnL in green with + prefix (Req 2.4)', () => {
    render(<AccountSummaryCard summary={baseSummary} />);
    const el = screen.getByTestId('summary-当日盈亏');
    expect(el.textContent).toBe('+$12.34');
    expect(el.className).toContain('text-green-500');
  });

  it('shows negative daily PnL in red without + prefix (Req 2.5)', () => {
    render(<AccountSummaryCard summary={{ ...baseSummary, daily_pnl: -8.50 }} />);
    const el = screen.getByTestId('summary-当日盈亏');
    expect(el.textContent).toContain('-$8.50');
    expect(el.className).toContain('text-red-500');
  });

  it('shows zero daily PnL in gray (Req 2.4, 2.5)', () => {
    render(<AccountSummaryCard summary={{ ...baseSummary, daily_pnl: 0 }} />);
    const el = screen.getByTestId('summary-当日盈亏');
    expect(el.textContent).toBe('$0.00');
    expect(el.className).toContain('text-gray-400');
  });

  it('uses dark theme card backgrounds', () => {
    const { container } = render(<AccountSummaryCard summary={baseSummary} />);
    const cards = container.querySelectorAll('.bg-gray-800');
    expect(cards.length).toBe(4);
  });
});
