/**
 * EquityCurveChart — 净值曲线图表组件
 *
 * Renders an AreaChart (recharts) showing daily equity over time with
 * gradient fill. Tooltip displays date, equity (USD), daily PnL, and
 * cumulative return percentage.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatUSD } from '../../utils/liveDashboardUtils';
import type { DailyEquityPoint } from '../../stores/liveDashboardStore';

export interface EquityCurveChartProps {
  curve: DailyEquityPoint[] | null | undefined;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload: DailyEquityPoint }[];
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const pnlPrefix = point.daily_pnl > 0 ? '+' : '';
  // Note: tooltip uses English labels since useTranslation can't be used in non-component
  return (
    <div className="rounded bg-gray-800 px-3 py-2 text-sm text-white shadow-lg">
      <p className="mb-1 font-medium">{point.date}</p>
      <p>Equity: {formatUSD(point.equity)}</p>
      <p>Daily PnL: {pnlPrefix}{formatUSD(point.daily_pnl)}</p>
      <p>Cumulative: {point.cumulative_return.toFixed(2)}%</p>
    </div>
  );
};

const EquityCurveChart: React.FC<EquityCurveChartProps> = ({ curve }) => {
  const { t } = useTranslation();

  if (!curve || curve.length === 0) {
    return (
      <div
        data-testid="equity-curve-unavailable"
        className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400"
      >
        {t('common.dataUnavailable')}
      </div>
    );
  }

  return (
    <div data-testid="equity-curve-chart" className="rounded-lg bg-gray-800 p-4">
      <h3 className="mb-2 text-sm font-medium text-gray-400">{t('live.equityCurve')}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={curve}>
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            axisLine={{ stroke: '#4b5563' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            axisLine={{ stroke: '#4b5563' }}
            tickLine={false}
            tickFormatter={(v: number) => formatUSD(v)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#22c55e"
            strokeWidth={2}
            fill="url(#equityGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default EquityCurveChart;
