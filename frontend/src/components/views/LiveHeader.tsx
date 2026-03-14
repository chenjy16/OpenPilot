/**
 * LiveHeader — 页面标题栏组件
 *
 * Displays the dashboard title, market status indicator, and running days counter.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import React from 'react';
import { isMarketOpen, calcRunningDays } from '../../utils/liveDashboardUtils';

export interface LiveHeaderProps {
  firstTradeDate: number | null;
}

const LiveHeader: React.FC<LiveHeaderProps> = ({ firstTradeDate }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const marketOpen = isMarketOpen(nowSeconds);

  const runningDays =
    firstTradeDate != null ? calcRunningDays(firstTradeDate, nowSeconds) : null;

  return (
    <div className="flex flex-wrap items-center justify-between rounded-lg bg-gray-800 px-6 py-4">
      {/* Title — Req 3.2 */}
      <h1 className="text-2xl font-bold tracking-wide text-white">
        AI 量化交易实盘大屏
      </h1>

      <div className="flex items-center gap-6">
        {/* Market status indicator — Req 3.3, 3.4 */}
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
            {marketOpen ? '交易中' : '休市'}
          </span>
        </span>

        {/* Running days counter — Req 3.1 */}
        {runningDays != null && (
          <span data-testid="running-days" className="text-sm text-gray-300">
            运行 {runningDays} 天
          </span>
        )}
      </div>
    </div>
  );
};

export default LiveHeader;
