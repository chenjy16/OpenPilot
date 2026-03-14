// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RiskSummary from './RiskSummary';
import type { LiveRiskRule } from '../../stores/liveDashboardStore';

afterEach(cleanup);

const sampleRules: LiveRiskRule[] = [
  { rule_name: 'max_loss_per_trade', threshold: 2, triggered: false, description: '单笔最大亏损 2%' },
  { rule_name: 'max_positions', threshold: 3, triggered: true, description: '最多同时持有 3 个仓位' },
];

describe('RiskSummary', () => {
  it('shows placeholder when rules is null', () => {
    render(<RiskSummary rules={null} />);
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
    expect(screen.queryByTestId('risk-summary')).toBeNull();
  });

  it('shows placeholder when rules is undefined', () => {
    render(<RiskSummary rules={undefined} />);
    expect(screen.getByText('数据暂不可用')).toBeTruthy();
  });

  it('shows empty message when rules is empty array', () => {
    render(<RiskSummary rules={[]} />);
    expect(screen.getByText('暂无风控规则')).toBeTruthy();
    expect(screen.queryByTestId('risk-summary')).toBeNull();
  });

  it('renders each rule with name and description (Req 9.1, 9.4)', () => {
    render(<RiskSummary rules={sampleRules} />);
    expect(screen.getByText('max_loss_per_trade')).toBeTruthy();
    expect(screen.getByText('单笔最大亏损 2%')).toBeTruthy();
    expect(screen.getByText('max_positions')).toBeTruthy();
    expect(screen.getByText('最多同时持有 3 个仓位')).toBeTruthy();
  });

  it('shows green icon for normal rules and red icon for triggered rules (Req 9.3)', () => {
    render(<RiskSummary rules={sampleRules} />);

    const normalIcon = screen.getByTestId('risk-status-max_loss_per_trade');
    expect(normalIcon.className).toContain('bg-green-500');

    const triggeredIcon = screen.getByTestId('risk-status-max_positions');
    expect(triggeredIcon.className).toContain('bg-red-500');
  });

  it('uses dark theme card backgrounds', () => {
    const { container } = render(<RiskSummary rules={sampleRules} />);
    const cards = container.querySelectorAll('.bg-gray-800');
    expect(cards.length).toBe(sampleRules.length);
  });
});
