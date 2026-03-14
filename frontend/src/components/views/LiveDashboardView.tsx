/**
 * LiveDashboardView — 直播看板页面容器
 *
 * Read-only live trading dashboard optimized for 1920×1080 streaming.
 * Dark theme, 60-second auto-refresh, no sensitive operation entries.
 *
 * Requirements: 10.1, 10.2, 10.4, 11.1, 11.2, 11.3, 11.4, 11.5
 */

import React, { useEffect, useCallback } from 'react';
import { useLiveDashboardStore } from '../../stores/liveDashboardStore';
import LiveHeader from './LiveHeader';
import AccountSummaryCard from './AccountSummaryCard';
import EquityCurveChart from './EquityCurveChart';
import AIDecisionFeed from './AIDecisionFeed';
import PositionPanel from './PositionPanel';
import TradeHistoryTable from './TradeHistoryTable';
import MetricsBar from './MetricsBar';
import RiskSummary from './RiskSummary';

const REFRESH_INTERVAL_MS = 60_000; // 60 seconds

const LiveDashboardView: React.FC = () => {
  const { data, loading, error, stale, fetchDashboard } = useLiveDashboardStore();

  // Fetch on mount + set up 60-second auto-refresh interval
  useEffect(() => {
    fetchDashboard();
    const intervalId = setInterval(() => {
      fetchDashboard();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [fetchDashboard]);

  const handleRetry = useCallback(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // First load failure: full-screen error with retry button
  if (!data && error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <p className="mb-4 text-lg text-red-400">{error}</p>
          <button
            onClick={handleRetry}
            className="rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-500"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // First load in progress
  if (!data && loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-900 text-white">
        <p className="text-gray-400">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gray-900 text-white">
      {/* Stale data warning banner — Requirement 11.3 */}
      {stale && (
        <div className="w-full bg-yellow-600 px-4 py-2 text-center text-sm text-white">
          数据更新失败，显示的是缓存数据
        </div>
      )}

      <div className="mx-auto max-w-[1920px] space-y-4 p-4">
        {/* 1. LiveHeader — 标题 + 直播状态 + 运行天数 (Task 5.2) */}
        <section data-testid="live-header-section">
          <LiveHeader firstTradeDate={data?.first_trade_date ?? null} />
        </section>

        {/* 2. AccountSummaryCard — 账户概览卡片组 (Task 5.3) */}
        <section data-testid="account-summary-section">
          <AccountSummaryCard summary={data?.account_summary} />
        </section>

        {/* 3. EquityCurveChart — 净值曲线图表 (Task 5.4) */}
        <section data-testid="equity-curve-section">
          <EquityCurveChart curve={data?.equity_curve} />
        </section>

        {/* 4. Two-column area: AI Decision Feed + Position Panel (Tasks 5.5, 5.6) */}
        <section data-testid="two-column-section" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: AI Decision Feed */}
          <div data-testid="ai-decision-feed-section">
            <AIDecisionFeed decisions={data?.ai_decisions} />
          </div>
          {/* Right: Position Panel */}
          <div data-testid="position-panel-section">
            <PositionPanel positions={data?.positions} />
          </div>
        </section>

        {/* 5. TradeHistoryTable — 近期交易历史表格 (Task 5.7) */}
        <section data-testid="trade-history-section">
          <TradeHistoryTable trades={data?.recent_trades} />
        </section>

        {/* 6. MetricsBar + RiskSummary — 底部指标栏 + 风控摘要 (Tasks 5.8, 5.9) */}
        <section data-testid="bottom-section" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div data-testid="metrics-bar-section">
            <MetricsBar metrics={data?.metrics} />
          </div>
          <div data-testid="risk-summary-section">
            <RiskSummary rules={data?.risk_summary} />
          </div>
        </section>
      </div>
    </div>
  );
};

export default LiveDashboardView;
