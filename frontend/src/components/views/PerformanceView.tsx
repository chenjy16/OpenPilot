/**
 * PerformanceView — 交易绩效仪表盘
 *
 * Displays: key metrics, equity curve, strategy attribution, best/worst trades.
 */

import React, { useEffect, useState } from 'react';
import { useTradingStore } from '../../stores/tradingStore';

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${color ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function EquityCurve({ curve }: { curve: Array<{ date: string; equity: number; daily_pnl: number; cumulative_return: number }> }) {
  if (curve.length === 0) return <p className="py-8 text-center text-sm text-gray-400">暂无权益数据</p>;

  const maxEquity = Math.max(...curve.map(d => d.equity));
  const minEquity = Math.min(...curve.map(d => d.equity));
  const range = maxEquity - minEquity || 1;
  const w = 100;
  const h = 40;

  // Build SVG path
  const points = curve.map((d, i) => {
    const x = (i / (curve.length - 1)) * w;
    const y = h - ((d.equity - minEquity) / range) * h;
    return `${x},${y}`;
  });
  const pathD = `M ${points.join(' L ')}`;

  const lastReturn = curve[curve.length - 1].cumulative_return;
  const lineColor = lastReturn >= 0 ? '#22c55e' : '#ef4444';

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs text-gray-500">权益曲线</span>
        <span className={`text-sm font-medium ${lastReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          累计收益 {lastReturn >= 0 ? '+' : ''}{lastReturn.toFixed(2)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" preserveAspectRatio="none">
        <path d={pathD} fill="none" stroke={lineColor} strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>{curve[0].date}</span>
        <span>{curve[curve.length - 1].date}</span>
      </div>
    </div>
  );
}

const PerformanceView: React.FC = () => {
  const { performanceMetrics, fetchPerformance } = useTradingStore();
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchPerformance(period).finally(() => setLoading(false));
  }, [period, fetchPerformance]);

  const m = performanceMetrics;

  if (loading && !m) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-gray-500">加载中...</p></div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">交易绩效</h1>
          <div className="flex gap-1">
            {[7, 30, 90, 365].map(d => (
              <button
                key={d}
                onClick={() => setPeriod(d)}
                className={`rounded px-3 py-1 text-sm ${period === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {d === 365 ? '1年' : `${d}天`}
              </button>
            ))}
          </div>
        </div>

        {!m || m.total_trades === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-400">选定周期内暂无已平仓交易记录</p>
            <p className="mt-1 text-xs text-gray-300">绩效数据基于买入→卖出配对的完整交易</p>
          </div>
        ) : (
          <>
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard label="总交易数" value={String(m.total_trades)} />
              <MetricCard
                label="胜率"
                value={`${(m.win_rate * 100).toFixed(1)}%`}
                color={m.win_rate >= 0.5 ? 'text-green-600' : 'text-red-600'}
              />
              <MetricCard
                label="总盈亏"
                value={`$${m.total_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                color={m.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}
              />
              <MetricCard
                label="盈亏比"
                value={m.profit_factor === Infinity ? '∞' : m.profit_factor.toFixed(2)}
                sub={`平均盈利 $${m.avg_win.toFixed(0)} / 平均亏损 $${Math.abs(m.avg_loss).toFixed(0)}`}
              />
              <MetricCard
                label="Sharpe Ratio"
                value={m.sharpe_ratio != null ? m.sharpe_ratio.toFixed(2) : '—'}
                color={m.sharpe_ratio != null && m.sharpe_ratio >= 1 ? 'text-green-600' : undefined}
              />
              <MetricCard
                label="Sortino Ratio"
                value={m.sortino_ratio != null ? m.sortino_ratio.toFixed(2) : '—'}
                color={m.sortino_ratio != null && m.sortino_ratio >= 1.5 ? 'text-green-600' : undefined}
              />
            </div>

            {/* Second row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                label="最大回撤"
                value={`${m.max_drawdown_pct.toFixed(2)}%`}
                sub={`$${m.max_drawdown.toLocaleString()}`}
                color="text-red-600"
              />
              <MetricCard
                label="回撤恢复"
                value={m.recovery_days != null ? `${m.recovery_days}天` : '未恢复'}
              />
              <MetricCard
                label="平均持仓"
                value={m.avg_hold_hours < 24 ? `${m.avg_hold_hours.toFixed(1)}小时` : `${(m.avg_hold_hours / 24).toFixed(1)}天`}
              />
              <MetricCard
                label="平均盈亏"
                value={`$${m.avg_pnl.toFixed(2)}`}
                color={m.avg_pnl >= 0 ? 'text-green-600' : 'text-red-600'}
              />
            </div>

            {/* Equity Curve + Strategy Attribution */}
            <div className="grid gap-6 lg:grid-cols-5">
              <section className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-3">
                <EquityCurve curve={m.equity_curve} />
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-2">
                <h3 className="mb-3 text-xs font-semibold text-gray-500">策略归因</h3>
                {m.by_strategy.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-400">暂无数据</p>
                ) : (
                  <div className="space-y-2">
                    {m.by_strategy.map((s, i) => (
                      <div key={i} className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-gray-700">{s.strategy_name}</p>
                          <p className="text-xs text-gray-400">{s.trades}笔 · 胜率 {(s.win_rate * 100).toFixed(0)}%</p>
                        </div>
                        <span className={`text-sm font-semibold ${s.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {s.total_pnl >= 0 ? '+' : ''}${s.total_pnl.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Best / Worst Trades */}
            <div className="grid gap-6 lg:grid-cols-2">
              {m.best_trade && (
                <div className="rounded-lg border border-green-200 bg-green-50/50 p-4">
                  <p className="text-xs font-semibold text-green-700">最佳交易</p>
                  <p className="mt-1 text-lg font-bold text-green-700">{m.best_trade.symbol}</p>
                  <p className="text-sm text-green-600">+${m.best_trade.pnl.toFixed(2)} ({m.best_trade.pnl_pct > 0 ? '+' : ''}{m.best_trade.pnl_pct}%)</p>
                </div>
              )}
              {m.worst_trade && (
                <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
                  <p className="text-xs font-semibold text-red-700">最差交易</p>
                  <p className="mt-1 text-lg font-bold text-red-700">{m.worst_trade.symbol}</p>
                  <p className="text-sm text-red-600">${m.worst_trade.pnl.toFixed(2)} ({m.worst_trade.pnl_pct}%)</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PerformanceView;
