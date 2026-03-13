/**
 * Tests for SignalAggregator
 *
 * Feature: multi-strategy-trading
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import type { StrategySignal } from '../types';
import {
  computeCompositeScore,
  aggregateSignals,
  SignalAggregator,
} from '../SignalAggregator';

// ─── Helper ────────────────────────────────────────────────────────────────

function makeSignal(
  symbol: string,
  scores: Record<string, number> = {},
  overrides: Partial<StrategySignal> = {},
): StrategySignal {
  return {
    symbol,
    action: 'buy',
    entry_price: 100,
    stop_loss: 95,
    take_profit: 112,
    scores,
    metadata: {},
    ...overrides,
  };
}

// ─── computeCompositeScore ─────────────────────────────────────────────────

describe('computeCompositeScore', () => {
  it('should compute the weighted sum correctly', () => {
    const score = computeCompositeScore({
      momentum_score: 1,
      volume_score: 1,
      sentiment_score: 1,
      ai_confidence: 1,
    });
    // 1*0.4 + 1*0.2 + 1*0.3 + 1*0.1 = 1.0
    expect(score).toBeCloseTo(1.0);
  });

  it('should return 0 when all components are 0', () => {
    const score = computeCompositeScore({
      momentum_score: 0,
      volume_score: 0,
      sentiment_score: 0,
      ai_confidence: 0,
    });
    expect(score).toBe(0);
  });

  it('should handle partial scores correctly', () => {
    const score = computeCompositeScore({
      momentum_score: 0.8,
      volume_score: 0,
      sentiment_score: 0.9,
      ai_confidence: 0,
    });
    // 0.8*0.4 + 0*0.2 + 0.9*0.3 + 0*0.1 = 0.32 + 0.27 = 0.59
    expect(score).toBeCloseTo(0.59);
  });
});

// ─── aggregateSignals ──────────────────────────────────────────────────────

describe('aggregateSignals', () => {
  it('should return empty array for empty input', () => {
    expect(aggregateSignals([], 0.7, 3)).toEqual([]);
  });

  it('should group signals by symbol and merge scores using max', () => {
    const signals: StrategySignal[] = [
      makeSignal('AAPL', { momentum_score: 0.8, volume_score: 0.3 }),
      makeSignal('AAPL', { momentum_score: 0.6, volume_score: 0.9, sentiment_score: 0.85 }),
    ];

    const result = aggregateSignals(signals, 0, 10);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('AAPL');
    // max of each: momentum=0.8, volume=0.9, sentiment=0.85, ai=0
    expect(result[0].component_scores.momentum_score).toBe(0.8);
    expect(result[0].component_scores.volume_score).toBe(0.9);
    expect(result[0].component_scores.sentiment_score).toBe(0.85);
    expect(result[0].component_scores.ai_confidence).toBe(0);
  });

  it('should filter signals below threshold', () => {
    const signals: StrategySignal[] = [
      makeSignal('AAPL', { momentum_score: 1, volume_score: 1, sentiment_score: 1, ai_confidence: 1 }),
      makeSignal('GOOG', { momentum_score: 0.1 }), // composite ≈ 0.04
    ];

    const result = aggregateSignals(signals, 0.7, 10);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('AAPL');
  });

  it('should sort by composite_score descending', () => {
    const signals: StrategySignal[] = [
      makeSignal('LOW', { momentum_score: 0.8, sentiment_score: 0.8 }), // 0.32+0.24=0.56 → below 0.5 threshold
      makeSignal('HIGH', { momentum_score: 1, volume_score: 1, sentiment_score: 1, ai_confidence: 1 }), // 1.0
      makeSignal('MID', { momentum_score: 0.9, volume_score: 0.8, sentiment_score: 0.9, ai_confidence: 0.7 }), // 0.36+0.16+0.27+0.07=0.86
    ];

    const result = aggregateSignals(signals, 0.5, 10);
    expect(result[0].symbol).toBe('HIGH');
    expect(result[1].symbol).toBe('MID');
    expect(result[2].symbol).toBe('LOW');
  });

  it('should limit results to topN', () => {
    const signals: StrategySignal[] = [
      makeSignal('A', { momentum_score: 1, volume_score: 1, sentiment_score: 1, ai_confidence: 1 }),
      makeSignal('B', { momentum_score: 0.9, volume_score: 0.9, sentiment_score: 0.9, ai_confidence: 0.9 }),
      makeSignal('C', { momentum_score: 0.8, volume_score: 0.8, sentiment_score: 0.8, ai_confidence: 0.8 }),
      makeSignal('D', { momentum_score: 0.7, volume_score: 0.7, sentiment_score: 0.7, ai_confidence: 0.7 }),
    ];

    const result = aggregateSignals(signals, 0, 3);
    expect(result).toHaveLength(3);
  });

  it('should treat missing component scores as 0', () => {
    const signals: StrategySignal[] = [
      makeSignal('AAPL', { momentum_score: 1.0 }), // only momentum, rest = 0
    ];

    const result = aggregateSignals(signals, 0, 10);
    expect(result).toHaveLength(1);
    expect(result[0].component_scores.momentum_score).toBe(1.0);
    expect(result[0].component_scores.volume_score).toBe(0);
    expect(result[0].component_scores.sentiment_score).toBe(0);
    expect(result[0].component_scores.ai_confidence).toBe(0);
    // composite = 1.0 * 0.4 = 0.4
    expect(result[0].composite_score).toBeCloseTo(0.4);
  });

  it('should preserve all source signals', () => {
    const sig1 = makeSignal('AAPL', { momentum_score: 0.8 });
    const sig2 = makeSignal('AAPL', { sentiment_score: 0.9 });

    const result = aggregateSignals([sig1, sig2], 0, 10);
    expect(result[0].source_signals).toHaveLength(2);
    expect(result[0].source_signals).toContain(sig1);
    expect(result[0].source_signals).toContain(sig2);
  });

  it('should select best_signal based on highest individual composite score', () => {
    const weakSignal = makeSignal('AAPL', { momentum_score: 0.2 });
    const strongSignal = makeSignal('AAPL', { momentum_score: 0.9, sentiment_score: 0.8 });

    const result = aggregateSignals([weakSignal, strongSignal], 0, 10);
    expect(result[0].best_signal).toBe(strongSignal);
  });
});

// ─── SignalAggregator class ────────────────────────────────────────────────

describe('SignalAggregator', () => {
  const aggregator = new SignalAggregator();

  it('should aggregate signals from a Map with default threshold and topN', () => {
    const strategySignals = new Map<string, StrategySignal[]>();
    strategySignals.set('momentum', [
      makeSignal('AAPL', { momentum_score: 1, volume_score: 1, sentiment_score: 1, ai_confidence: 1 }),
    ]);

    const result = aggregator.aggregate(strategySignals);
    expect(result).toHaveLength(1);
    expect(result[0].composite_score).toBeCloseTo(1.0);
  });

  it('should use default threshold of 0.7', () => {
    const strategySignals = new Map<string, StrategySignal[]>();
    strategySignals.set('momentum', [
      makeSignal('AAPL', { momentum_score: 0.1 }), // composite = 0.04, below 0.7
    ]);

    const result = aggregator.aggregate(strategySignals);
    expect(result).toHaveLength(0);
  });

  it('should use default topN of 3', () => {
    const strategySignals = new Map<string, StrategySignal[]>();
    strategySignals.set('strategy1', [
      makeSignal('A', { momentum_score: 1, volume_score: 1, sentiment_score: 1, ai_confidence: 1 }),
      makeSignal('B', { momentum_score: 1, volume_score: 1, sentiment_score: 1, ai_confidence: 1 }),
      makeSignal('C', { momentum_score: 1, volume_score: 1, sentiment_score: 1, ai_confidence: 1 }),
      makeSignal('D', { momentum_score: 1, volume_score: 1, sentiment_score: 1, ai_confidence: 1 }),
    ]);

    const result = aggregator.aggregate(strategySignals);
    expect(result).toHaveLength(3);
  });

  it('should allow custom threshold and topN', () => {
    const strategySignals = new Map<string, StrategySignal[]>();
    strategySignals.set('strategy1', [
      makeSignal('A', { momentum_score: 0.5 }), // composite = 0.2
      makeSignal('B', { momentum_score: 0.8 }), // composite = 0.32
    ]);

    const result = aggregator.aggregate(strategySignals, 0.1, 1);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('B');
  });

  it('should flatten signals from multiple strategy keys', () => {
    const strategySignals = new Map<string, StrategySignal[]>();
    strategySignals.set('momentum', [
      makeSignal('AAPL', { momentum_score: 0.9 }),
    ]);
    strategySignals.set('news', [
      makeSignal('AAPL', { sentiment_score: 0.95 }),
    ]);

    const result = aggregator.aggregate(strategySignals, 0, 10);
    expect(result).toHaveLength(1);
    // Merged: momentum=0.9, sentiment=0.95
    expect(result[0].component_scores.momentum_score).toBe(0.9);
    expect(result[0].component_scores.sentiment_score).toBe(0.95);
    expect(result[0].source_signals).toHaveLength(2);
  });
});


// ─── Property-Based Tests ──────────────────────────────────────────────────

/**
 * Property-based tests for SignalAggregator — Composite Score Calculation
 *
 * Feature: multi-strategy-trading, Property 6: 综合评分计算正确性
 *
 * For any four component scores (momentum_score, volume_score,
 * sentiment_score, ai_confidence) in [0, 1], computeCompositeScore
 * should return momentum_score × 0.4 + volume_score × 0.2 +
 * sentiment_score × 0.3 + ai_confidence × 0.1, and aggregation
 * results should preserve all component original scores.
 *
 * **Validates: Requirements 5.1, 5.4, 5.5**
 */

import * as fc from 'fast-check';

describe('SignalAggregator — Property-Based Tests', () => {
  /**
   * Property 6: 综合评分计算正确性
   *
   * **Validates: Requirements 5.1, 5.4, 5.5**
   */
  describe('Property 6: Composite score formula correctness', () => {
    it('should compute score = momentum×0.4 + volume×0.2 + sentiment×0.3 + ai×0.1', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (momentum_score, volume_score, sentiment_score, ai_confidence) => {
            const result = computeCompositeScore({
              momentum_score,
              volume_score,
              sentiment_score,
              ai_confidence,
            });

            const expected =
              momentum_score * 0.4 +
              volume_score * 0.2 +
              sentiment_score * 0.3 +
              ai_confidence * 0.1;

            expect(result).toBeCloseTo(expected, 10);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('should preserve all component original scores in aggregation results', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (momentum_score, volume_score, sentiment_score, ai_confidence) => {
            const signal = makeSignal('TEST', {
              momentum_score,
              volume_score,
              sentiment_score,
              ai_confidence,
            });

            // Use threshold 0 so nothing is filtered out
            const results = aggregateSignals([signal], 0, 10);

            expect(results).toHaveLength(1);
            const agg = results[0];

            // All component scores must be preserved in the aggregation result
            expect(agg.component_scores.momentum_score).toBe(momentum_score);
            expect(agg.component_scores.volume_score).toBe(volume_score);
            expect(agg.component_scores.sentiment_score).toBe(sentiment_score);
            expect(agg.component_scores.ai_confidence).toBe(ai_confidence);

            // Composite score must match the formula
            const expectedScore =
              momentum_score * 0.4 +
              volume_score * 0.2 +
              sentiment_score * 0.3 +
              ai_confidence * 0.1;

            expect(agg.composite_score).toBeCloseTo(expectedScore, 10);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});


/**
 * Property 7: 信号聚合过滤与排序不变量
 *
 * Feature: multi-strategy-trading, Property 7
 *
 * For any set of signals passed through aggregateSignals with
 * threshold=0.7 and topN=3, the output must satisfy:
 *   1. All composite_score ≥ 0.7
 *   2. Output is sorted by composite_score in descending order
 *   3. Output length ≤ 3
 *
 * **Validates: Requirements 5.2, 5.3**
 */
describe('Property 7: Signal aggregation filtering and sorting invariant', () => {
  /** Generator for a random StrategySignal with scores in [0, 1] */
  const signalArb = fc
    .record({
      symbol: fc.constantFrom('AAPL', 'GOOG', 'MSFT', 'TSLA', 'AMZN', 'META', 'NVDA', 'NFLX'),
      momentum_score: fc.double({ min: 0, max: 1, noNaN: true }),
      volume_score: fc.double({ min: 0, max: 1, noNaN: true }),
      sentiment_score: fc.double({ min: 0, max: 1, noNaN: true }),
      ai_confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    .map(({ symbol, momentum_score, volume_score, sentiment_score, ai_confidence }) =>
      makeSignal(symbol, {
        momentum_score,
        volume_score,
        sentiment_score,
        ai_confidence,
      }),
    );

  it('should only output signals with composite_score ≥ 0.7', () => {
    fc.assert(
      fc.property(fc.array(signalArb, { minLength: 0, maxLength: 20 }), (signals) => {
        const result = aggregateSignals(signals, 0.7, 3);
        for (const agg of result) {
          expect(agg.composite_score).toBeGreaterThanOrEqual(0.7);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('should output signals sorted by composite_score in descending order', () => {
    fc.assert(
      fc.property(fc.array(signalArb, { minLength: 0, maxLength: 20 }), (signals) => {
        const result = aggregateSignals(signals, 0.7, 3);
        for (let i = 1; i < result.length; i++) {
          expect(result[i - 1].composite_score).toBeGreaterThanOrEqual(
            result[i].composite_score,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it('should output at most 3 signals', () => {
    fc.assert(
      fc.property(fc.array(signalArb, { minLength: 0, maxLength: 20 }), (signals) => {
        const result = aggregateSignals(signals, 0.7, 3);
        expect(result.length).toBeLessThanOrEqual(3);
      }),
      { numRuns: 200 },
    );
  });
});
