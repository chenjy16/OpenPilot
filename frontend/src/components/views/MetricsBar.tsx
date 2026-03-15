/**
 * MetricsBar — 关键绩效指标栏
 *
 * Displays five key performance metrics in a horizontal row:
 * 1. 胜率 (win_rate) — formatPercent
 * 2. 夏普比率 (sharpe_ratio) — formatDecimal or "N/A"
 * 3. 最大回撤 (max_drawdown_pct) — formatPercent
 * 4. 总交易笔数 (total_trades) — integer
 * 5. 盈亏比 (profit_factor) — formatDecimal
 *
 * Requirements: 8.1, 8.3, 8.4
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatPercent, formatDecimal } from '../../utils/liveDashboardUtils';
import type { LiveMetrics } from '../../stores/liveDashboardStore';

export interface MetricsBarProps {
  metrics: LiveMetrics | null | undefined;
}

const MetricsBar: React.FC<MetricsBarProps> = ({ metrics }) => {
  const { t } = useTranslation();

  if (!metrics) {
    return (
      <div data-testid="metrics-bar-unavailable" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        {t('common.dataUnavailable')}
      </div>
    );
  }

  const items: { label: string; value: string }[] = [
    { label: t('live.winRate'), value: formatPercent(metrics.win_rate) },
    { label: t('live.sharpeRatio'), value: metrics.sharpe_ratio !== null ? formatDecimal(metrics.sharpe_ratio) : 'N/A' },
    { label: t('live.maxDrawdown'), value: formatPercent(metrics.max_drawdown_pct) },
    { label: t('live.totalTrades'), value: String(metrics.total_trades) },
    { label: t('live.profitFactor'), value: formatDecimal(metrics.profit_factor) },
  ];

  return (
    <div data-testid="metrics-bar" className="grid grid-cols-5 gap-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-gray-800 px-4 py-4 text-center">
          <p className="mb-1 text-sm text-gray-400">{item.label}</p>
          <p data-testid={`metric-${item.label}`} className="text-xl font-semibold text-white">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
};

export default MetricsBar;
