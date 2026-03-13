/**
 * Signal Aggregator
 *
 * Aggregates signals from multiple trading strategies into ranked composite scores.
 *
 * Scoring formula:
 *   composite_score = momentum_score × 0.4 + volume_score × 0.2
 *                   + sentiment_score × 0.3 + ai_confidence × 0.1
 *
 * Aggregation logic:
 *   1. Group all strategy signals by symbol
 *   2. For each symbol, merge scores (take max value per key)
 *   3. Compute composite_score
 *   4. Filter out signals with score < threshold (default 0.7)
 *   5. Sort by composite_score descending
 *   6. Take top N (default 3)
 *   7. Missing component scores default to 0
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import type { StrategySignal } from './types';

export interface AggregatedSignal {
  symbol: string;
  composite_score: number;
  component_scores: {
    momentum_score: number;
    volume_score: number;
    sentiment_score: number;
    ai_confidence: number;
  };
  source_signals: StrategySignal[];
  best_signal: StrategySignal;
}

const WEIGHTS = {
  momentum_score: 0.4,
  volume_score: 0.2,
  sentiment_score: 0.3,
  ai_confidence: 0.1,
} as const;

const COMPONENT_KEYS: ReadonlyArray<keyof typeof WEIGHTS> = [
  'momentum_score',
  'volume_score',
  'sentiment_score',
  'ai_confidence',
];

/**
 * Pure function: compute composite score from component scores.
 * Missing components are treated as 0.
 */
export function computeCompositeScore(scores: {
  momentum_score: number;
  volume_score: number;
  sentiment_score: number;
  ai_confidence: number;
}): number {
  let total = 0;
  for (const key of COMPONENT_KEYS) {
    total += (scores[key] ?? 0) * WEIGHTS[key];
  }
  return total;
}

/**
 * Pure function: aggregate strategy signals into ranked composite signals.
 *
 * Steps:
 *   1. Group by symbol
 *   2. Merge scores per symbol (max of each component across all signals)
 *   3. Compute composite score
 *   4. Filter below threshold
 *   5. Sort descending
 *   6. Take topN
 */
export function aggregateSignals(
  signals: StrategySignal[],
  threshold: number,
  topN: number,
): AggregatedSignal[] {
  // 1. Group by symbol
  const grouped = new Map<string, StrategySignal[]>();
  for (const signal of signals) {
    const list = grouped.get(signal.symbol);
    if (list) {
      list.push(signal);
    } else {
      grouped.set(signal.symbol, [signal]);
    }
  }

  const results: AggregatedSignal[] = [];

  for (const [symbol, symbolSignals] of grouped) {
    // 2. Merge scores — take max value for each component key
    const mergedScores = {
      momentum_score: 0,
      volume_score: 0,
      sentiment_score: 0,
      ai_confidence: 0,
    };

    for (const sig of symbolSignals) {
      for (const key of COMPONENT_KEYS) {
        const val = sig.scores[key] ?? 0;
        if (val > mergedScores[key]) {
          mergedScores[key] = val;
        }
      }
    }

    // 3. Compute composite score
    const composite_score = computeCompositeScore(mergedScores);

    // 4. Filter below threshold
    if (composite_score < threshold) {
      continue;
    }

    // Pick best signal: the one with the highest individual composite-like contribution
    let bestSignal = symbolSignals[0];
    let bestScore = -1;
    for (const sig of symbolSignals) {
      const sigComposite = computeCompositeScore({
        momentum_score: sig.scores.momentum_score ?? 0,
        volume_score: sig.scores.volume_score ?? 0,
        sentiment_score: sig.scores.sentiment_score ?? 0,
        ai_confidence: sig.scores.ai_confidence ?? 0,
      });
      if (sigComposite > bestScore) {
        bestScore = sigComposite;
        bestSignal = sig;
      }
    }

    results.push({
      symbol,
      composite_score,
      component_scores: { ...mergedScores },
      source_signals: symbolSignals,
      best_signal: bestSignal,
    });
  }

  // 5. Sort descending by composite_score
  results.sort((a, b) => b.composite_score - a.composite_score);

  // 6. Take topN
  return results.slice(0, topN);
}

const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_TOP_N = 3;

/**
 * SignalAggregator class wrapping the aggregation flow.
 */
export class SignalAggregator {
  aggregate(
    strategySignals: Map<string, StrategySignal[]>,
    threshold: number = DEFAULT_THRESHOLD,
    topN: number = DEFAULT_TOP_N,
  ): AggregatedSignal[] {
    // Flatten all signals from the map
    const allSignals: StrategySignal[] = [];
    for (const signals of strategySignals.values()) {
      allSignals.push(...signals);
    }
    return aggregateSignals(allSignals, threshold, topN);
  }
}
