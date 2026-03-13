/**
 * Tests for NewsMomentumStrategy
 *
 * Feature: multi-strategy-trading
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import { NewsMomentumStrategy } from '../../strategies/NewsMomentumStrategy';

describe('NewsMomentumStrategy', () => {
  const strategy = new NewsMomentumStrategy();

  it('should have name "news_momentum"', () => {
    expect(strategy.name).toBe('news_momentum');
  });

  describe('generateSignal — entry conditions met', () => {
    const validIndicators = {
      price: 150,
      ma_20: 140,
      volume_ratio_20d: 2.5,
      sentiment_score: 0.9,
    };

    it('should return a buy signal when all entry conditions are met', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators);
      expect(signal).not.toBeNull();
      expect(signal!.symbol).toBe('AAPL');
      expect(signal!.action).toBe('buy');
      expect(signal!.entry_price).toBe(150);
    });

    it('should set stop_loss = entry_price × 0.95', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.stop_loss).toBeCloseTo(150 * 0.95);
    });

    it('should set take_profit = entry_price × 1.15', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.take_profit).toBeCloseTo(150 * 1.15);
    });

    it('should include sentiment_score in scores', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.scores.sentiment_score).toBe(0.9);
    });

    it('should include sentiment_score in metadata', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.metadata.sentiment_score).toBe(0.9);
    });
  });

  describe('generateSignal — entry conditions NOT met', () => {
    it('should return null when sentiment_score <= 0.8', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 150,
        ma_20: 140,
        volume_ratio_20d: 2.5,
        sentiment_score: 0.8,
      });
      expect(signal).toBeNull();
    });

    it('should return null when price <= ma_20', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 140,
        ma_20: 140,
        volume_ratio_20d: 2.5,
        sentiment_score: 0.9,
      });
      expect(signal).toBeNull();
    });

    it('should return null when volume_ratio_20d <= 2.0', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 150,
        ma_20: 140,
        volume_ratio_20d: 2.0,
        sentiment_score: 0.9,
      });
      expect(signal).toBeNull();
    });
  });

  describe('generateSignal — missing/incomplete data', () => {
    it('should return null when sentiment_score is missing', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 150,
        ma_20: 140,
        volume_ratio_20d: 2.5,
      });
      expect(signal).toBeNull();
    });

    it('should return null when sentiment_score is null', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 150,
        ma_20: 140,
        volume_ratio_20d: 2.5,
        sentiment_score: null,
      });
      expect(signal).toBeNull();
    });

    it('should return null when price is missing', () => {
      const signal = strategy.generateSignal('AAPL', {
        ma_20: 140,
        volume_ratio_20d: 2.5,
        sentiment_score: 0.9,
      });
      expect(signal).toBeNull();
    });

    it('should return null when an indicator is NaN', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 150,
        ma_20: NaN,
        volume_ratio_20d: 2.5,
        sentiment_score: 0.9,
      });
      expect(signal).toBeNull();
    });

    it('should return null when an indicator is Infinity', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 150,
        ma_20: 140,
        volume_ratio_20d: Infinity,
        sentiment_score: 0.9,
      });
      expect(signal).toBeNull();
    });
  });
});


/**
 * Property-based tests for NewsMomentumStrategy
 *
 * Feature: multi-strategy-trading, Property 3: 新闻动量策略信号正确性
 * Validates: Requirements 3.1, 3.2
 */

import * as fc from 'fast-check';

describe('NewsMomentumStrategy — Property-Based Tests', () => {
  const strategy = new NewsMomentumStrategy();

  /**
   * Property 3: 新闻动量策略信号正确性
   *
   * For any indicators satisfying entry conditions (sentiment_score > 0.8,
   * price > ma_20, volume_ratio_20d > 2.0), generateSignal should return
   * a non-null buy signal with:
   *   - action = 'buy'
   *   - stop_loss = entry_price × 0.95
   *   - take_profit = entry_price × 1.15
   *   - metadata.sentiment_score equals the input sentiment_score
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  it('should produce a correct buy signal for any valid entry indicators', () => {
    const validIndicatorsArb = fc
      .record({
        ma_20: fc.double({ min: 1, max: 10000, noNaN: true }),
        volume_ratio_20d: fc.double({ min: 2.000001, max: 100, noNaN: true }),
        sentiment_score: fc.double({ min: 0.800001, max: 1.0, noNaN: true }),
      })
      .chain(({ ma_20, volume_ratio_20d, sentiment_score }) =>
        fc.record({
          // price must be strictly greater than ma_20
          price: fc.double({ min: ma_20 + 0.01, max: ma_20 + 50000, noNaN: true }),
          ma_20: fc.constant(ma_20),
          volume_ratio_20d: fc.constant(volume_ratio_20d),
          sentiment_score: fc.constant(sentiment_score),
        }),
      );

    fc.assert(
      fc.property(validIndicatorsArb, (indicators) => {
        const signal = strategy.generateSignal('TEST', indicators);

        // Signal must be non-null
        expect(signal).not.toBeNull();

        // Action must be 'buy'
        expect(signal!.action).toBe('buy');

        // entry_price equals the input price
        expect(signal!.entry_price).toBe(indicators.price);

        // stop_loss = entry_price × 0.95
        expect(signal!.stop_loss).toBeCloseTo(indicators.price * 0.95, 8);

        // take_profit = entry_price × 1.15
        expect(signal!.take_profit).toBeCloseTo(indicators.price * 1.15, 8);

        // metadata.sentiment_score equals input sentiment_score
        expect(signal!.metadata.sentiment_score).toBe(indicators.sentiment_score);

        // scores.sentiment_score equals input sentiment_score
        expect(signal!.scores.sentiment_score).toBe(indicators.sentiment_score);
      }),
      { numRuns: 200 },
    );
  });
});


/**
 * Property-based tests for NewsMomentumStrategy — Missing Data Handling
 *
 * Feature: multi-strategy-trading, Property 4 (partial): 策略缺失数据处理 — NewsMomentum
 *
 * For any indicator set that is missing one or more required fields
 * (price, ma_20, volume_ratio_20d, sentiment_score) — where "missing"
 * means the key is absent, or its value is null, NaN, or Infinity —
 * generateSignal should return null.
 *
 * **Validates: Requirements 3.3**
 */
describe('NewsMomentumStrategy — Property 4: Missing Data Handling', () => {
  const strategy = new NewsMomentumStrategy();

  const REQUIRED_KEYS = ['price', 'ma_20', 'volume_ratio_20d', 'sentiment_score'] as const;

  /** Arbitrary that produces a complete, valid indicator set (all entry conditions met). */
  const validIndicatorsArb = fc.record({
    price: fc.double({ min: 101, max: 10000, noNaN: true }),
    ma_20: fc.double({ min: 1, max: 100, noNaN: true }),
    volume_ratio_20d: fc.double({ min: 2.1, max: 50, noNaN: true }),
    sentiment_score: fc.double({ min: 0.81, max: 1.0, noNaN: true }),
  });

  /** Arbitrary that picks a non-empty subset of required keys to corrupt. */
  const corruptedKeysArb = fc
    .subarray(REQUIRED_KEYS as unknown as string[], { minLength: 1 })
    .filter((arr) => arr.length >= 1);

  /**
   * Arbitrary for the "bad" replacement value:
   *   - undefined (key deleted)
   *   - null
   *   - NaN
   *   - Infinity
   *   - -Infinity
   */
  const badValueArb = fc.constantFrom(
    undefined as unknown as number | null,
    null as unknown as number | null,
    NaN,
    Infinity,
    -Infinity,
  );

  it('should return null when one or more required indicators are missing or invalid', () => {
    fc.assert(
      fc.property(
        validIndicatorsArb,
        corruptedKeysArb,
        fc.array(badValueArb, { minLength: 1, maxLength: 4 }),
        (base, keysToCorrupt, badValues) => {
          // Build a corrupted copy of the indicators
          const corrupted: Record<string, number | null> = { ...base };

          keysToCorrupt.forEach((key, i) => {
            const bad = badValues[i % badValues.length];
            if (bad === undefined) {
              delete corrupted[key];
            } else {
              corrupted[key] = bad;
            }
          });

          const signal = strategy.generateSignal('TEST', corrupted);
          expect(signal).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});
