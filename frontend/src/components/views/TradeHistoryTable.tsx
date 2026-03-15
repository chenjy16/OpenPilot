/**
 * TradeHistoryTable — 近期交易历史表格
 *
 * Table displaying the most recent 20 closed trades: symbol, strategy,
 * entry price, exit price, PnL amount, PnL percentage, hold days, exit time.
 * PnL values are colored via pnlColorClass. Positive PnL gets "+" prefix.
 *
 * Requirements: 7.1, 7.2, 7.4, 7.5
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatUSD, pnlColorClass } from '../../utils/liveDashboardUtils';
import type { LiveTradeRecord } from '../../stores/liveDashboardStore';

export interface TradeHistoryTableProps {
  trades: LiveTradeRecord[] | null | undefined;
}

/** Format a Unix timestamp (seconds) to "YYYY-MM-DD HH:mm" local string. */
function formatExitTime(ts: number): string {
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

const TradeHistoryTable: React.FC<TradeHistoryTableProps> = ({ trades }) => {
  const { t } = useTranslation();

  if (trades == null) {
    return (
      <div data-testid="trade-history-unavailable" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        {t('common.dataUnavailable')}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div data-testid="trade-history-empty" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        {t('live.noTrades')}
      </div>
    );
  }

  return (
    <div data-testid="trade-history-table" className="overflow-hidden rounded-lg bg-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-gray-400">
            <th className="px-4 py-3 text-left">{t('live.tradeSymbol')}</th>
            <th className="px-4 py-3 text-left">{t('live.tradeStrategy')}</th>
            <th className="px-4 py-3 text-right">{t('live.tradeEntryPrice')}</th>
            <th className="px-4 py-3 text-right">{t('live.tradeExitPrice')}</th>
            <th className="px-4 py-3 text-right">{t('live.tradePnl')}</th>
            <th className="px-4 py-3 text-right">{t('live.tradePnlPct')}</th>
            <th className="px-4 py-3 text-right">{t('live.tradeHoldDays')}</th>
            <th className="px-4 py-3 text-right">{t('live.tradeExitTime')}</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade, idx) => {
            const color = pnlColorClass(trade.pnl);
            const pnlPrefix = trade.pnl > 0 ? '+' : '';
            const pctPrefix = trade.pnl_pct > 0 ? '+' : '';

            return (
              <tr key={`${trade.symbol}-${trade.exit_time}-${idx}`} className="border-b border-gray-700/50">
                <td className="px-4 py-3 font-medium text-white">{trade.symbol}</td>
                <td className="px-4 py-3 text-gray-300">{trade.strategy_name}</td>
                <td className="px-4 py-3 text-right text-gray-300">{formatUSD(trade.entry_price)}</td>
                <td className="px-4 py-3 text-right text-gray-300">{formatUSD(trade.exit_price)}</td>
                <td className={`px-4 py-3 text-right ${color}`}>
                  {pnlPrefix}{formatUSD(trade.pnl)}
                </td>
                <td className={`px-4 py-3 text-right ${color}`}>
                  {pctPrefix}{trade.pnl_pct.toFixed(2)}%
                </td>
                <td className="px-4 py-3 text-right text-gray-300">{trade.hold_days}</td>
                <td className="px-4 py-3 text-right text-gray-300">{formatExitTime(trade.exit_time)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default TradeHistoryTable;
