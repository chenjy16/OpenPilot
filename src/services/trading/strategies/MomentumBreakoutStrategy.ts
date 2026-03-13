/**
 * Momentum Breakout Strategy
 *
 * Trend-following strategy based on price breakout with volume confirmation.
 *
 * Entry conditions (ALL must be met):
 *   - price > high_20d (current price above 20-day high)
 *   - volume_ratio_20d > 1.5 (volume 1.5x above 20-day average)
 *   - momentum_20d > 0.05 (20-day momentum > 5%)
 *
 * Signal parameters:
 *   - stop_loss  = entry_price × 0.95 (5% below)
 *   - take_profit = entry_price × 1.12 (12% above)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

import { createLogger } from '../../../logger';
import type { Strategy, StrategySignal } from '../types';

const logger = createLogger('MomentumBreakoutStrategy');

const REQUIRED_INDICATORS = ['price', 'high_20d', 'volume_ratio_20d', 'momentum_20d'] as const;

/**
 * Clamp a value to the [0, 1] range.
 */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class MomentumBreakoutStrategy implements Strategy {
  readonly name = 'momentum_breakout';

  generateSignal(symbol: string, indicators: Record<string, number | null>): StrategySignal | null {
    // Check for missing / null indicators
    for (const key of REQUIRED_INDICATORS) {
      const v = indicators[key];
      if (v === undefined || v === null || !Number.isFinite(v)) {
        logger.warn(`Missing or invalid indicator "${key}" for ${symbol}, skipping`);
        return null;
      }
    }

    const price = indicators.price as number;
    const high20d = indicators.high_20d as number;
    const volumeRatio20d = indicators.volume_ratio_20d as number;
    const momentum20d = indicators.momentum_20d as number;

    // Entry conditions — all must be met
    if (!(price > high20d && volumeRatio20d > 1.5 && momentum20d > 0.05)) {
      return null;
    }

    const entry_price = price;
    const stop_loss = entry_price * 0.95;
    const take_profit = entry_price * 1.12;

    // Normalized scores clamped to [0, 1]
    const momentum_score = clamp01(momentum20d);
    const volume_score = clamp01(volumeRatio20d / 3); // normalize: 1.5 → 0.5, 3.0 → 1.0

    return {
      symbol,
      action: 'buy',
      entry_price,
      stop_loss,
      take_profit,
      scores: {
        momentum_score,
        volume_score,
      },
      metadata: {
        strategy: this.name,
        high_20d: high20d,
        volume_ratio_20d: volumeRatio20d,
        momentum_20d: momentum20d,
      },
    };
  }
}
