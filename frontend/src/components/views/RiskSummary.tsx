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
import { useTranslation } from 'react-i18next';
import type { LiveRiskRule } from '../../stores/liveDashboardStore';

export interface RiskSummaryProps {
  rules: LiveRiskRule[] | null | undefined;
}

const RiskSummary: React.FC<RiskSummaryProps> = ({ rules }) => {
  const { t } = useTranslation();

  if (rules == null) {
    return (
      <div data-testid="risk-summary-unavailable" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        {t('common.dataUnavailable')}
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div data-testid="risk-summary-empty" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        {t('live.noRiskRules')}
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
          <span
            data-testid={`risk-status-${rule.rule_name}`}
            className={`inline-block h-3 w-3 shrink-0 rounded-full ${rule.triggered ? 'bg-red-500' : 'bg-green-500'}`}
            aria-label={rule.triggered ? t('live.riskTriggered') : t('live.riskNormal')}
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
