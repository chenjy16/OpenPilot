/**
 * AIDecisionFeed — AI 决策流组件
 *
 * Card list showing the most recent 10 AI trading decisions.
 * Each card displays: strategy name, symbol, side label (买入/卖出),
 * composite_score visual progress bar, entry/stop-loss/take-profit prices,
 * and decision reason.
 *
 * Requirements: 5.1, 5.2, 5.4, 5.5, 5.6
 */

import React from 'react';
import type { AIDecision } from '../../stores/liveDashboardStore';
import { getSideLabel, formatUSD } from '../../utils/liveDashboardUtils';

export interface AIDecisionFeedProps {
  decisions: AIDecision[] | null | undefined;
}

const AIDecisionFeed: React.FC<AIDecisionFeedProps> = ({ decisions }) => {
  if (decisions == null) {
    return (
      <div data-testid="ai-decisions-unavailable" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        数据暂不可用
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <div data-testid="ai-decisions-empty" className="rounded-lg bg-gray-800 px-6 py-4 text-center text-gray-400">
        暂无 AI 决策
      </div>
    );
  }

  return (
    <div data-testid="ai-decision-feed" className="space-y-3">
      <h3 className="text-lg font-semibold text-white">AI 决策流</h3>
      {decisions.slice(0, 10).map((d, idx) => {
        const side = getSideLabel(d.side);
        const scorePercent = Math.round(d.composite_score * 100);

        return (
          <div key={`${d.timestamp}-${d.symbol}-${idx}`} className="rounded-lg bg-gray-800 p-4">
            {/* Row 1: Strategy + Symbol + Side label */}
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{d.strategy_name}</span>
                <span className="text-gray-300">{d.symbol}</span>
              </div>
              <span data-testid="side-label" className={`rounded px-2 py-0.5 text-sm font-medium ${side.colorClass}`}>
                {side.text}
              </span>
            </div>

            {/* Row 2: Composite score bar */}
            <div className="mb-2">
              <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                <span>综合评分</span>
                <span>{scorePercent}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-700">
                <div
                  data-testid="score-bar"
                  className="h-2 rounded-full bg-blue-500 transition-all"
                  style={{
                    width: `${scorePercent}%`,
                    opacity: 0.4 + d.composite_score * 0.6,
                  }}
                />
              </div>
            </div>

            {/* Row 3: Prices */}
            <div className="mb-2 flex gap-4 text-sm">
              <span className="text-gray-400">
                入场 <span className="text-white">{formatUSD(d.entry_price)}</span>
              </span>
              {d.stop_loss != null && (
                <span className="text-gray-400">
                  止损 <span className="text-red-400">{formatUSD(d.stop_loss)}</span>
                </span>
              )}
              {d.take_profit != null && (
                <span className="text-gray-400">
                  止盈 <span className="text-green-400">{formatUSD(d.take_profit)}</span>
                </span>
              )}
            </div>

            {/* Row 4: Reason */}
            <p className="text-sm text-gray-400">{d.reason}</p>
          </div>
        );
      })}
    </div>
  );
};

export default AIDecisionFeed;
