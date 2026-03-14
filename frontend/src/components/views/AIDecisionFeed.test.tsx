// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AIDecisionFeed from './AIDecisionFeed';
import type { AIDecision } from '../../stores/liveDashboardStore';

const makeDecision = (overrides: Partial<AIDecision> = {}): AIDecision => ({
  timestamp: 1700000000,
  symbol: 'AAPL',
  strategy_name: 'MomentumAlpha',
  side: 'buy',
  composite_score: 0.85,
  entry_price: 150.5,
  stop_loss: 145.0,
  take_profit: 165.0,
  reason: 'Strong upward momentum detected',
  ...overrides,
});

describe('AIDecisionFeed', () => {
  afterEach(cleanup);

  it('shows unavailable placeholder when decisions is null', () => {
    render(<AIDecisionFeed decisions={null} />);
    expect(screen.getByTestId('ai-decisions-unavailable')).toBeTruthy();
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
  });

  it('shows unavailable placeholder when decisions is undefined', () => {
    render(<AIDecisionFeed decisions={undefined} />);
    expect(screen.getByTestId('ai-decisions-unavailable')).toBeTruthy();
  });

  it('shows empty message when decisions is empty array', () => {
    render(<AIDecisionFeed decisions={[]} />);
    expect(screen.getByTestId('ai-decisions-empty')).toBeTruthy();
    expect(screen.getByText('暂无 AI 决策')).toBeTruthy();
  });

  it('renders decision cards with strategy name and symbol', () => {
    render(<AIDecisionFeed decisions={[makeDecision()]} />);
    expect(screen.getByText('MomentumAlpha')).toBeTruthy();
    expect(screen.getByText('AAPL')).toBeTruthy();
  });

  it('renders buy side label in green', () => {
    render(<AIDecisionFeed decisions={[makeDecision({ side: 'buy' })]} />);
    const label = screen.getByTestId('side-label');
    expect(label.textContent).toBe('买入');
    expect(label.className).toContain('text-green-500');
  });

  it('renders sell side label in red', () => {
    render(<AIDecisionFeed decisions={[makeDecision({ side: 'sell' })]} />);
    const label = screen.getByTestId('side-label');
    expect(label.textContent).toBe('卖出');
    expect(label.className).toContain('text-red-500');
  });

  it('renders composite score bar with correct width', () => {
    render(<AIDecisionFeed decisions={[makeDecision({ composite_score: 0.7 })]} />);
    const bar = screen.getByTestId('score-bar');
    expect(bar.style.width).toBe('70%');
  });

  it('renders entry, stop loss, and take profit prices formatted as USD', () => {
    render(<AIDecisionFeed decisions={[makeDecision({ entry_price: 1234.56, stop_loss: 1200.0, take_profit: 1300.0 })]} />);
    expect(screen.getByText('$1,234.56')).toBeTruthy();
    expect(screen.getByText('$1,200.00')).toBeTruthy();
    expect(screen.getByText('$1,300.00')).toBeTruthy();
  });

  it('omits stop loss when null', () => {
    render(<AIDecisionFeed decisions={[makeDecision({ stop_loss: null })]} />);
    expect(screen.queryByText('止损')).toBeNull();
  });

  it('omits take profit when null', () => {
    render(<AIDecisionFeed decisions={[makeDecision({ take_profit: null })]} />);
    expect(screen.queryByText('止盈')).toBeNull();
  });

  it('renders decision reason text', () => {
    render(<AIDecisionFeed decisions={[makeDecision({ reason: 'RSI oversold signal' })]} />);
    expect(screen.getByText('RSI oversold signal')).toBeTruthy();
  });

  it('renders at most 10 cards even if more decisions provided', () => {
    const decisions = Array.from({ length: 15 }, (_, i) =>
      makeDecision({ timestamp: 1700000000 + i, symbol: `SYM${i}` }),
    );
    render(<AIDecisionFeed decisions={decisions} />);
    expect(screen.getByTestId('ai-decision-feed')).toBeTruthy();
    // Only first 10 symbols should appear
    expect(screen.getByText('SYM0')).toBeTruthy();
    expect(screen.getByText('SYM9')).toBeTruthy();
    expect(screen.queryByText('SYM10')).toBeNull();
  });
});
