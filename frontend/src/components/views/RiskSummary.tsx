/**
 * RiskSummary — 风控摘要组件
 *
 * Displays a list of risk control rules with:
 * 1. Status icon: green circle (normal) / red circle (triggered)
 * 2. Rule name
 * 3. Natural language description
 *
 * Requirements: 9.1, 9.3, 9.4
 */

import React from 'react';
import type { LiveRiskRule } from '../../stores/liveDashboardStore';

export interface RiskSummaryProps {
  rules: LiveRiskRule[] | null | undefined;
}

const RiskSummary: React.FC<RiskSummaryProps> = ({ rules }) => {
  if (rules == null) {
    return (
      <div data-testid="risk-summary-unavailable" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        数据暂不可用
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div data-testid="risk-summary-empty" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        暂无风控规则
      </div>
    );
  }

  return (
    <div data-testid="risk-summary" className="space-y-2">
      {rules.map((rule) => (
        <div
          key={rule.rule_name}
          data-testid={`risk-rule-${rule.rule_name}`}
          className="flex items-center gap-3 rounded-lg bg-gray-800 px-4 py-3"
        >
          {/* Status icon */}
          <span
            data-testid={`risk-status-${rule.rule_name}`}
            className={`inline-block h-3 w-3 shrink-0 rounded-full ${rule.triggered ? 'bg-red-500' : 'bg-green-500'}`}
            aria-label={rule.triggered ? '已触发' : '正常'}
          />
          {/* Rule name */}
          <span className="shrink-0 font-medium text-white">{rule.rule_name}</span>
          {/* Description */}
          <span className="text-sm text-gray-400">{rule.description}</span>
        </div>
      ))}
    </div>
  );
};

export default RiskSummary;
