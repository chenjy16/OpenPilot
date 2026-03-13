/**
 * Mean Reversion Strategy
 *
 * Reversal strategy based on RSI oversold and Bollinger Band lower band.
 *
 * Entry conditions (ALL must be met):
 *   - rsi_14 < 30 (RSI oversold)
 *   - price < bb_lower (price below Bollinger Band lower)
 *   - volume_ratio_20d > 1.5 (volume confirmation)
 *
 * Signal parameters:
 *   - stop_loss  = entry_price × 0.96 (4% below)
 *   - take_profit = entry_price × 1.06 (6% above)
 *   - metadata.expected_hold_days = { min: 2, max: 5 }
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { createLogger } from '../../../logger';
import type { Strategy, StrategySignal } from '../types';

const logger = createLogger('MeanReversionStrategy');

const REQUIRED_INDICATORS = ['price', 'rsi_14', 'bb_lower', 'volume_ratio_20d'] as const;

export class MeanReversionStrategy implements Strategy {
  readonly name = 'mean_reversion';

  generateSignal(symbol: string, indicators: Record<string, number | null>): StrategySignal | null {
    // Check for missing / null / NaN / Infinity indicators
    for (const key of REQUIRED_INDICATORS) {
      const v = indicators[key];
      if (v === undefined || v === null || !Number.isFinite(v)) {
        logger.warn(`Missing or invalid indicator "${key}" for ${symbol}, skipping`);
        return null;
      }
    }

    const price = indicators.price as number;
    const rsi14 = indicators.rsi_14 as number;
    const bbLower = indicators.bb_lower as number;
    const volumeRatio20d = indicators.volume_ratio_20d as number;

    // Entry conditions — all must be met
    if (!(rsi14 < 30 && price < bbLower && volumeRatio20d > 1.5)) {
      return null;
    }

    const entry_price = price;
    const stop_loss = entry_price * 0.96;
    const take_profit = entry_price * 1.06;

    return {
      symbol,
      action: 'buy',
      entry_price,
      stop_loss,
      take_profit,
      scores: {},
      metadata: {
        strategy: this.name,
        expected_hold_days: { min: 2, max: 5 },
        rsi_14: rsi14,
        bb_lower: bbLower,
        volume_ratio_20d: volumeRatio20d,
      },
    };
  }
}
