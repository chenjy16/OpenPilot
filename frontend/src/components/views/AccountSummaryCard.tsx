/**
 * AccountSummaryCard — 账户概览卡片组件
 *
 * Displays four key account metrics in a row:
 * 1. Initial capital ($1,000 fixed)
 * 2. Current equity
 * 3. Cumulative return percentage
 * 4. Daily PnL (positive values get "+" prefix)
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatUSD, pnlColorClass } from '../../utils/liveDashboardUtils';
import type { AccountSummary } from '../../stores/liveDashboardStore';

export interface AccountSummaryCardProps {
  summary: AccountSummary | null | undefined;
}

const AccountSummaryCard: React.FC<AccountSummaryCardProps> = ({ summary }) => {
  const { t } = useTranslation();

  if (!summary) {
    return (
      <div data-testid="account-summary-unavailable" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        {t('common.dataUnavailable')}
      </div>
    );
  }

  const dailyPnlFormatted =
    summary.daily_pnl > 0
      ? `+${formatUSD(summary.daily_pnl)}`
      : formatUSD(summary.daily_pnl);

  const returnPctFormatted =
    summary.total_return_pct > 0
      ? `+${summary.total_return_pct.toFixed(2)}%`
      : `${summary.total_return_pct.toFixed(2)}%`;

  const cards: { label: string; value: string; colorClass?: string }[] = [
    { label: t('live.costBasis'), value: formatUSD(summary.initial_capital) },
    { label: t('live.marketValue'), value: formatUSD(summary.current_equity) },
    { label: t('live.cumulativeReturn'), value: returnPctFormatted, colorClass: pnlColorClass(summary.total_return_pct) },
    { label: t('live.dailyPnl'), value: dailyPnlFormatted, colorClass: pnlColorClass(summary.daily_pnl) },
  ];

  return (
    <div data-testid="account-summary-cards" className="grid grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg bg-gray-800 px-4 py-4 text-center">
          <p className="mb-1 text-sm text-gray-400">{card.label}</p>
          <p data-testid={`summary-${card.label}`} className={`text-xl font-semibold ${card.colorClass ?? 'text-white'}`}>
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
};

export default AccountSummaryCard;
