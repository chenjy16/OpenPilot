/**
 * News Momentum Strategy
 *
 * Event-driven strategy based on sentiment score with technical confirmation.
 *
 * Entry conditions (ALL must be met):
 *   - sentiment_score > 0.8 (high sentiment)
 *   - price > ma_20 (price above 20-day MA)
 *   - volume_ratio_20d > 2.0 (volume 2x above 20-day average)
 *
 * Signal parameters:
 *   - stop_loss  = entry_price × 0.95 (5% below)
 *   - take_profit = entry_price × 1.15 (15% above)
 *   - scores.sentiment_score = raw sentiment score
 *   - metadata.sentiment_score = raw sentiment score
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import { createLogger } from '../../../logger';
import type { Strategy, StrategySignal } from '../types';

const logger = createLogger('NewsMomentumStrategy');

const REQUIRED_INDICATORS = ['price', 'ma_20', 'volume_ratio_20d', 'sentiment_score'] as const;

export class NewsMomentumStrategy implements Strategy {
  readonly name = 'news_momentum';

  generateSignal(symbol: string, indicators: Record<string, number | null>): StrategySignal | null {
    // Check sentiment_score first — use info level if missing (Requirement 3.3)
    const sentimentVal = indicators.sentiment_score;
    if (sentimentVal === undefined || sentimentVal === null || !Number.isFinite(sentimentVal)) {
      logger.info(`Missing or invalid indicator "sentiment_score" for ${symbol}, skipping`);
      return null;
    }

    // Check remaining required indicators — use warn level
    for (const key of REQUIRED_INDICATORS) {
      if (key === 'sentiment_score') continue; // already checked above
      const v = indicators[key];
      if (v === undefined || v === null || !Number.isFinite(v)) {
        logger.warn(`Missing or invalid indicator "${key}" for ${symbol}, skipping`);
        return null;
      }
    }

    const price = indicators.price as number;
    const ma20 = indicators.ma_20 as number;
    const volumeRatio20d = indicators.volume_ratio_20d as number;
    const sentimentScore = sentimentVal;

    // Entry conditions — all must be met
    if (!(sentimentScore > 0.8 && price > ma20 && volumeRatio20d > 2.0)) {
      return null;
    }

    const entry_price = price;
    const stop_loss = entry_price * 0.95;
    const take_profit = entry_price * 1.15;

    return {
      symbol,
      action: 'buy',
      entry_price,
      stop_loss,
      take_profit,
      scores: {
        sentiment_score: sentimentScore,
      },
      metadata: {
        strategy: this.name,
        sentiment_score: sentimentScore,
        ma_20: ma20,
        volume_ratio_20d: volumeRatio20d,
      },
    };
  }
}
