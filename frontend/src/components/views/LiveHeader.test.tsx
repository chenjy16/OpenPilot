// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LiveHeader from './LiveHeader';

// Stub the utility functions so we can control their output
vi.mock('../../utils/liveDashboardUtils', () => ({
  isMarketOpen: vi.fn(),
  calcRunningDays: vi.fn(),
}));

import { isMarketOpen, calcRunningDays } from '../../utils/liveDashboardUtils';

const mockedIsMarketOpen = vi.mocked(isMarketOpen);
const mockedCalcRunningDays = vi.mocked(calcRunningDays);

describe('LiveHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: market closed, 42 running days
    mockedIsMarketOpen.mockReturnValue(false);
    mockedCalcRunningDays.mockReturnValue(42);
  });

  afterEach(cleanup);

  it('renders the title "AI 量化交易实盘大屏" (Req 3.2)', () => {
    render(<LiveHeader firstTradeDate={1700000000} />);
    expect(screen.getByText('AI 量化交易实盘大屏')).toBeTruthy();
  });

  it('shows green "交易中" when market is open (Req 3.3)', () => {
    mockedIsMarketOpen.mockReturnValue(true);
    render(<LiveHeader firstTradeDate={1700000000} />);

    const dot = screen.getByTestId('market-status-dot');
    expect(dot.className).toContain('bg-green-500');

    const text = screen.getByTestId('market-status-text');
    expect(text.textContent).toBe('交易中');
    expect(text.className).toContain('text-green-400');
  });

  it('shows gray "休市" when market is closed (Req 3.4)', () => {
    mockedIsMarketOpen.mockReturnValue(false);
    render(<LiveHeader firstTradeDate={1700000000} />);

    const dot = screen.getByTestId('market-status-dot');
    expect(dot.className).toContain('bg-gray-500');

    const text = screen.getByTestId('market-status-text');
    expect(text.textContent).toBe('休市');
    expect(text.className).toContain('text-gray-400');
  });

  it('displays running days when firstTradeDate is provided (Req 3.1)', () => {
    mockedCalcRunningDays.mockReturnValue(100);
    render(<LiveHeader firstTradeDate={1700000000} />);

    const el = screen.getByTestId('running-days');
    expect(el.textContent).toBe('运行 100 天');
  });

  it('does not display running days when firstTradeDate is null', () => {
    render(<LiveHeader firstTradeDate={null} />);
    expect(screen.queryByTestId('running-days')).toBeNull();
  });

  it('calls isMarketOpen with current time in seconds', () => {
    const fakeNow = 1700001000000; // ms
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);

    render(<LiveHeader firstTradeDate={1700000000} />);
    expect(mockedIsMarketOpen).toHaveBeenCalledWith(Math.floor(fakeNow / 1000));

    vi.restoreAllMocks();
  });

  it('calls calcRunningDays with firstTradeDate and current seconds', () => {
    const fakeNow = 1700001000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);

    render(<LiveHeader firstTradeDate={1700000000} />);
    expect(mockedCalcRunningDays).toHaveBeenCalledWith(1700000000, Math.floor(fakeNow / 1000));

    vi.restoreAllMocks();
  });
});
