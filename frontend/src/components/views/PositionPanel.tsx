/**
 * PositionPanel — 当前持仓面板
 *
 * Table displaying current positions: symbol, quantity, avg cost,
 * current price, unrealized PnL amount, and unrealized PnL percentage.
 * PnL values are colored via pnlColorClass. Positive PnL gets "+" prefix.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.5
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatUSD, pnlColorClass } from '../../utils/liveDashboardUtils';
import type { LivePosition } from '../../stores/liveDashboardStore';

export interface PositionPanelProps {
  positions: LivePosition[] | null | undefined;
}

const PositionPanel: React.FC<PositionPanelProps> = ({ positions }) => {
  const { t } = useTranslation();

  if (positions == null) {
    return (
      <div data-testid="position-panel-unavailable" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        {t('common.dataUnavailable')}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div data-testid="position-panel-empty" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        {t('live.noPositions')}
      </div>
    );
  }

  return (
    <div data-testid="position-panel" className="overflow-hidden rounded-lg bg-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-gray-400">
            <th className="px-4 py-3 text-left">{t('live.positionSymbol')}</th>
            <th className="px-4 py-3 text-right">{t('live.positionQty')}</th>
            <th className="px-4 py-3 text-right">{t('live.positionCost')}</th>
            <th className="px-4 py-3 text-right">{t('live.positionPrice')}</th>
            <th className="px-4 py-3 text-right">{t('live.positionPnl')}</th>
            <th className="px-4 py-3 text-right">{t('live.positionPnlPct')}</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const pnlColor = pnlColorClass(pos.unrealized_pnl);
            const pnlPrefix = pos.unrealized_pnl > 0 ? '+' : '';
            const pctPrefix = pos.unrealized_pnl_pct > 0 ? '+' : '';

            return (
              <tr key={pos.symbol} className="border-b border-gray-700/50">
                <td className="px-4 py-3 font-medium text-white">{pos.symbol}</td>
                <td className="px-4 py-3 text-right text-gray-300">{pos.quantity}</td>
                <td className="px-4 py-3 text-right text-gray-300">{formatUSD(pos.avg_cost)}</td>
                <td className="px-4 py-3 text-right text-gray-300">{formatUSD(pos.current_price)}</td>
                <td className={`px-4 py-3 text-right ${pnlColor}`}>
                  {pnlPrefix}{formatUSD(pos.unrealized_pnl)}
                </td>
                <td className={`px-4 py-3 text-right ${pnlColor}`}>
                  {pctPrefix}{pos.unrealized_pnl_pct.toFixed(2)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PositionPanel;
