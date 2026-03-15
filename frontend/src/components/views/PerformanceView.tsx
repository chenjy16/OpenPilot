/**
 * PerformanceView — 交易绩效仪表盘
 *
 * Displays: key metrics, equity curve, strategy attribution, best/worst trades.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTradingStore } from '../../stores/tradingStore';

const API_BASE = '/api';

interface BacktestResult {
  id: number;
  strategy_id: number;
  strategy_name?: string;
  symbol: string;
  period_start: string;
  period_end: string;
  initial_capital: number;
  final_equity: number;
  total_return: number;
  total_trades: number;
  win_rate: number;
  max_drawdown: number;
  sharpe_ratio: number | null;
  equity_curve: Array<{ date: string; equity: number }>;
  created_at: number;
}

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
  const { t } = useTranslation();
  if (curve.length === 0) return <p className="py-8 text-center text-sm text-gray-400">{t('performance.noEquityData')}</p>;

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
        <span className="text-xs text-gray-500">{t('performance.equityCurve')}</span>
        <span className={`text-sm font-medium ${lastReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {t('performance.cumulativeReturn')} {lastReturn >= 0 ? '+' : ''}{lastReturn.toFixed(2)}%
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

function BacktestComparison({ results, loading }: { results: BacktestResult[]; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) return <p className="py-8 text-center text-sm text-gray-400">{t('performance.loadingBacktest')}</p>;
  if (results.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
        <p className="text-gray-400">{t('performance.noBacktestResults')}</p>
        <p className="mt-1 text-xs text-gray-300">{t('performance.backtestHint')}</p>
      </div>
    );
  }

  // Sharpe Ratio bar chart (simple SVG)
  const maxSharpe = Math.max(...results.filter(r => r.sharpe_ratio != null).map(r => Math.abs(r.sharpe_ratio!)), 1);

  return (
    <div className="space-y-6">
      {/* Sharpe Ratio comparison */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('performance.sharpeComparison')}</h3>
        <div className="space-y-2">
          {results.slice(0, 10).map(r => {
            const sharpe = r.sharpe_ratio ?? 0;
            const width = Math.min(Math.abs(sharpe) / maxSharpe * 100, 100);
            const color = sharpe >= 1 ? 'bg-green-500' : sharpe >= 0 ? 'bg-blue-400' : 'bg-red-400';
            return (
              <div key={r.id} className="flex items-center gap-3">
                <span className="w-32 truncate text-xs text-gray-600">{r.strategy_name || t('performance.strategyId', { id: r.strategy_id })}</span>
                <span className="w-16 text-xs text-gray-500">{r.symbol}</span>
                <div className="flex-1">
                  <div className={`h-4 rounded ${color}`} style={{ width: `${width}%` }} />
                </div>
                <span className={`w-12 text-right text-xs font-medium ${sharpe >= 1 ? 'text-green-600' : sharpe >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {sharpe.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Results table */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('performance.backtestDetails')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-gray-500">
                <th className="pb-2 pr-4">{t('performance.strategy')}</th>
                <th className="pb-2 pr-4">{t('performance.target')}</th>
                <th className="pb-2 pr-4">{t('performance.period')}</th>
                <th className="pb-2 pr-4 text-right">{t('performance.returnRate')}</th>
                <th className="pb-2 pr-4 text-right">{t('performance.winRate')}</th>
                <th className="pb-2 pr-4 text-right">{t('performance.maxDrawdown')}</th>
                <th className="pb-2 pr-4 text-right">{t('performance.sharpe')}</th>
                <th className="pb-2 text-right">{t('performance.trades')}</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="whitespace-nowrap py-2 pr-4 text-gray-700">{r.strategy_name || t('performance.strategyId', { id: r.strategy_id })}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-gray-600">{r.symbol}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-xs text-gray-400">{r.period_start} ~ {r.period_end}</td>
                  <td className={`whitespace-nowrap py-2 pr-4 text-right ${r.total_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {(r.total_return * 100).toFixed(2)}%
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-600">{(r.win_rate * 100).toFixed(1)}%</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-red-500">{(r.max_drawdown * 100).toFixed(2)}%</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-700">{r.sharpe_ratio?.toFixed(2) ?? '—'}</td>
                  <td className="whitespace-nowrap py-2 text-right text-gray-600">{r.total_trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Equity curves overlay for top results */}
      {results.filter(r => r.equity_curve && r.equity_curve.length > 0).length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('performance.equityCurveComparison')}</h3>
          <BacktestEquityCurves results={results.filter(r => r.equity_curve && r.equity_curve.length > 1).slice(0, 5)} />
        </section>
      )}
    </div>
  );
}

const CURVE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

function BacktestEquityCurves({ results }: { results: BacktestResult[] }) {
  const { t } = useTranslation();
  if (results.length === 0) return <p className="py-4 text-center text-sm text-gray-400">{t('performance.noEquityCurveData')}</p>;

  // Normalize all curves to percentage returns for comparison
  const w = 100;
  const h = 50;
  const allReturns = results.flatMap(r => {
    const initial = r.equity_curve[0]?.equity || 1;
    return r.equity_curve.map(p => (p.equity / initial - 1) * 100);
  });
  const maxReturn = Math.max(...allReturns, 1);
  const minReturn = Math.min(...allReturns, -1);
  const range = maxReturn - minReturn || 1;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full" preserveAspectRatio="none">
        {/* Zero line */}
        <line
          x1="0" y1={h - ((0 - minReturn) / range) * h}
          x2={w} y2={h - ((0 - minReturn) / range) * h}
          stroke="#e5e7eb" strokeWidth="0.3" strokeDasharray="1,1"
        />
        {results.map((r, idx) => {
          const initial = r.equity_curve[0]?.equity || 1;
          const points = r.equity_curve.map((p, i) => {
            const x = (i / (r.equity_curve.length - 1)) * w;
            const ret = (p.equity / initial - 1) * 100;
            const y = h - ((ret - minReturn) / range) * h;
            return `${x},${y}`;
          });
          return (
            <path
              key={r.id}
              d={`M ${points.join(' L ')}`}
              fill="none"
              stroke={CURVE_COLORS[idx % CURVE_COLORS.length]}
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3">
        {results.map((r, idx) => (
          <span key={r.id} className="flex items-center gap-1 text-xs text-gray-600">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CURVE_COLORS[idx % CURVE_COLORS.length] }} />
            {r.strategy_name || t('performance.strategyId', { id: r.strategy_id })} ({r.symbol})
          </span>
        ))}
      </div>
    </div>
  );
}

const PerformanceView: React.FC = () => {
  const { t } = useTranslation();
  const { performanceMetrics, fetchPerformance } = useTradingStore();
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState(false);
  const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([]);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'live' | 'backtest'>('live');

  useEffect(() => {
    setLoading(true);
    fetchPerformance(period).finally(() => setLoading(false));
  }, [period, fetchPerformance]);

  const fetchBacktests = useCallback(async () => {
    setBacktestLoading(true);
    try {
      const res = await fetch(`${API_BASE}/backtest`);
      if (res.ok) {
        const data = await res.json();
        setBacktestResults(data);
      }
    } catch { /* ignore */ }
    setBacktestLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === 'backtest') fetchBacktests();
  }, [activeTab, fetchBacktests]);

  const m = performanceMetrics;

  if (loading && !m) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-gray-500">{t('common.loading')}</p></div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header with tabs */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-900">{t('performance.title')}</h1>
            <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
              <button
                onClick={() => setActiveTab('live')}
                className={`rounded-md px-3 py-1 text-sm ${activeTab === 'live' ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                {t('performance.livePerformance')}
              </button>
              <button
                onClick={() => setActiveTab('backtest')}
                className={`rounded-md px-3 py-1 text-sm ${activeTab === 'backtest' ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                {t('performance.backtestComparison')}
              </button>
            </div>
          </div>
          {activeTab === 'live' && (
            <div className="flex gap-1">
              {[7, 30, 90, 365].map(d => (
                <button
                  key={d}
                  onClick={() => setPeriod(d)}
                  className={`rounded px-3 py-1 text-sm ${period === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {d === 365 ? t('performance.year1') : t('performance.days', { count: d })}
                </button>
              ))}
            </div>
          )}
        </div>

        {activeTab === 'backtest' ? (
          <BacktestComparison results={backtestResults} loading={backtestLoading} />
        ) : (
        <>

        {!m || m.total_trades === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-400">{t('performance.noTradesInPeriod')}</p>
            <p className="mt-1 text-xs text-gray-300">{t('performance.noTradesHint')}</p>
          </div>
        ) : (
          <>
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard label={t('performance.totalTrades')} value={String(m.total_trades)} />
              <MetricCard
                label={t('performance.winRate')}
                value={`${(m.win_rate * 100).toFixed(1)}%`}
                color={m.win_rate >= 0.5 ? 'text-green-600' : 'text-red-600'}
              />
              <MetricCard
                label={t('performance.totalPnl')}
                value={`$${m.total_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                color={m.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}
              />
              <MetricCard
                label={t('performance.profitFactor')}
                value={m.profit_factor === Infinity ? '∞' : m.profit_factor.toFixed(2)}
                sub={`${t('performance.avgWin')} $${m.avg_win.toFixed(0)} / ${t('performance.avgLoss')} $${Math.abs(m.avg_loss).toFixed(0)}`}
              />
              <MetricCard
                label={t('performance.sharpeRatio')}
                value={m.sharpe_ratio != null ? m.sharpe_ratio.toFixed(2) : '—'}
                color={m.sharpe_ratio != null && m.sharpe_ratio >= 1 ? 'text-green-600' : undefined}
              />
              <MetricCard
                label={t('performance.sortinoRatio')}
                value={m.sortino_ratio != null ? m.sortino_ratio.toFixed(2) : '—'}
                color={m.sortino_ratio != null && m.sortino_ratio >= 1.5 ? 'text-green-600' : undefined}
              />
            </div>

            {/* Second row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                label={t('performance.maxDrawdownAmount')}
                value={`${m.max_drawdown_pct.toFixed(2)}%`}
                sub={`$${m.max_drawdown.toLocaleString()}`}
                color="text-red-600"
              />
              <MetricCard
                label={t('performance.recoveryDays')}
                value={m.recovery_days != null ? t('performance.days', { count: m.recovery_days }) : t('performance.notRecovered')}
              />
              <MetricCard
                label={t('performance.avgHoldHours')}
                value={m.avg_hold_hours < 24 ? t('performance.hours', { count: Number(m.avg_hold_hours.toFixed(1)) }) : t('performance.days', { count: Number((m.avg_hold_hours / 24).toFixed(1)) })}
              />
              <MetricCard
                label={t('performance.avgPnl')}
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
                <h3 className="mb-3 text-xs font-semibold text-gray-500">{t('performance.strategyAttribution')}</h3>
                {m.by_strategy.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-400">{t('common.noData')}</p>
                ) : (
                  <div className="space-y-2">
                    {m.by_strategy.map((s, i) => (
                      <div key={i} className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-gray-700">{s.strategy_name}</p>
                          <p className="text-xs text-gray-400">{t('performance.tradesCount', { count: s.trades })} · {t('performance.winRate')} {(s.win_rate * 100).toFixed(0)}%</p>
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
                  <p className="text-xs font-semibold text-green-700">{t('performance.bestTrade')}</p>
                  <p className="mt-1 text-lg font-bold text-green-700">{m.best_trade.symbol}</p>
                  <p className="text-sm text-green-600">+${m.best_trade.pnl.toFixed(2)} ({m.best_trade.pnl_pct > 0 ? '+' : ''}{m.best_trade.pnl_pct}%)</p>
                </div>
              )}
              {m.worst_trade && (
                <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
                  <p className="text-xs font-semibold text-red-700">{t('performance.worstTrade')}</p>
                  <p className="mt-1 text-lg font-bold text-red-700">{m.worst_trade.symbol}</p>
                  <p className="text-sm text-red-600">${m.worst_trade.pnl.toFixed(2)} ({m.worst_trade.pnl_pct}%)</p>
                </div>
              )}
            </div>
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
};

export default PerformanceView;
