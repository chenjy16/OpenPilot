/**
 * LiveHeader — 页面标题栏组件
 *
 * Displays the dashboard title, market status indicator, and running days counter.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { isMarketOpen, calcRunningDays } from '../../utils/liveDashboardUtils';

export interface LiveHeaderProps {
  firstTradeDate: number | null;
}

const LiveHeader: React.FC<LiveHeaderProps> = ({ firstTradeDate }) => {
  const { t } = useTranslation();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const marketOpen = isMarketOpen(nowSeconds);

  const runningDays =
    firstTradeDate != null ? calcRunningDays(firstTradeDate, nowSeconds) : null;

  return (
    <div className="flex flex-wrap items-center justify-between rounded-lg bg-gray-800 px-6 py-4">
      <h1 className="text-2xl font-bold tracking-wide text-white">
        {t('live.title')}
      </h1>

      <div className="flex items-center gap-6">
        <span className="flex items-center gap-2 text-sm">
          <span
            data-testid="market-status-dot"
            className={`inline-block h-3 w-3 rounded-full ${
              marketOpen ? 'bg-green-500' : 'bg-gray-500'
            }`}
          />
          <span
            data-testid="market-status-text"
            className={marketOpen ? 'text-green-400' : 'text-gray-400'}
          >
            {marketOpen ? t('live.marketOpen') : t('live.marketClosed')}
          </span>
        </span>

        {runningDays != null && (
          <span data-testid="running-days" className="text-sm text-gray-300">
            {t('live.runningDays', { days: runningDays })}
          </span>
        )}
      </div>
    </div>
  );
};

export default LiveHeader;
