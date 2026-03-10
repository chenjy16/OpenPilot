/**
 * SignalEvaluator — Signal evaluation and filtering module
 *
 * Pure functions for confidence mapping and threshold checking,
 * plus a class that adds deduplication via pipeline_signal_log queries.
 */

import type Database from 'better-sqlite3';
import type { SignalCard, EvaluationConfig, EvaluationResult } from './types';

/**
 * Map confidence string to numeric value.
 * high → 0.9, medium → 0.6, low → 0.3, null/unknown → 0
 */
export function confidenceToNumber(confidence: string | null): number {
  switch (confidence) {
    case 'high':
      return 0.9;
    case 'medium':
      return 0.6;
    case 'low':
      return 0.3;
    default:
      return 0;
  }
}

/**
 * Check whether a confidence level meets or exceeds the given threshold.
 */
export function meetsConfidenceThreshold(
  confidence: string | null,
  threshold: number,
): boolean {
  return confidenceToNumber(confidence) >= threshold;
}

/**
 * SignalEvaluator evaluates whether a signal should trigger an automatic trade.
 *
 * Evaluation order:
 * 1. action === 'hold' → skip
 * 2. entry_price missing → skip
 * 3. confidence below threshold → skip
 * 4. duplicate signal within dedup window → skip
 * 5. All checks passed → pass
 */
export class SignalEvaluator {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  evaluate(signal: SignalCard, config: EvaluationConfig): EvaluationResult {
    // 1. Hold signals are always skipped
    if (signal.action === 'hold') {
      return { pass: false, reason: 'action_hold' };
    }

    // 2. Missing entry_price
    if (signal.entry_price == null) {
      return { pass: false, reason: 'missing_price' };
    }

    // 3. Confidence threshold check
    if (!meetsConfidenceThreshold(signal.confidence, config.confidence_threshold)) {
      return { pass: false, reason: 'confidence_below_threshold' };
    }

    // 4. Deduplication window check
    if (this.isDuplicate(signal, config.dedup_window_hours)) {
      return { pass: false, reason: 'duplicate_signal' };
    }

    // 5. All checks passed
    return { pass: true };
  }

  /**
   * Query pipeline_signal_log for a matching symbol+action with result='order_created'
   * within the dedup window.
   */
  private isDuplicate(signal: SignalCard, dedupWindowHours: number): boolean {
    const windowStartEpoch = Math.floor(Date.now() / 1000) - dedupWindowHours * 3600;

    const row = this.db
      .prepare(
        `SELECT 1 FROM pipeline_signal_log
         WHERE symbol = ? AND action = ? AND result = 'order_created'
           AND created_at >= ?
         LIMIT 1`,
      )
      .get(signal.symbol, signal.action, windowStartEpoch);

    return row !== undefined;
  }
}
