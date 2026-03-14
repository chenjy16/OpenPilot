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
  return (
    <div className="rounded bg-gray-800 px-3 py-2 text-sm text-white shadow-lg">
      <p className="mb-1 font-medium">{point.date}</p>
      <p>净值: {formatUSD(point.equity)}</p>
      <p>日收益: {pnlPrefix}{formatUSD(point.daily_pnl)}</p>
      <p>累计收益率: {point.cumulative_return.toFixed(2)}%</p>
    </div>
  );
};

const EquityCurveChart: React.FC<EquityCurveChartProps> = ({ curve }) => {
  if (!curve || curve.length === 0) {
    return (
      <div
        data-testid="equity-curve-unavailable"
        className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400"
      >
        数据暂不可用
      </div>
    );
  }

  return (
    <div data-testid="equity-curve-chart" className="rounded-lg bg-gray-800 p-4">
      <h3 className="mb-2 text-sm font-medium text-gray-400">净值曲线</h3>
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
