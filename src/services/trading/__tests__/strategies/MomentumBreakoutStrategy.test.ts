/**
 * Tests for MomentumBreakoutStrategy
 *
 * Feature: multi-strategy-trading
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

import { MomentumBreakoutStrategy } from '../../strategies/MomentumBreakoutStrategy';

describe('MomentumBreakoutStrategy', () => {
  const strategy = new MomentumBreakoutStrategy();

  it('should have name "momentum_breakout"', () => {
    expect(strategy.name).toBe('momentum_breakout');
  });

  describe('generateSignal — entry conditions met', () => {
    const validIndicators = {
      price: 110,
      high_20d: 100,
      volume_ratio_20d: 2.0,
      momentum_20d: 0.10,
    };

    it('should return a buy signal when all entry conditions are met', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators);
      expect(signal).not.toBeNull();
      expect(signal!.symbol).toBe('AAPL');
      expect(signal!.action).toBe('buy');
      expect(signal!.entry_price).toBe(110);
    });

    it('should set stop_loss = entry_price × 0.95', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.stop_loss).toBeCloseTo(110 * 0.95);
    });

    it('should set take_profit = entry_price × 1.12', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.take_profit).toBeCloseTo(110 * 1.12);
    });

    it('should include momentum_score and volume_score in [0, 1]', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.scores.momentum_score).toBeGreaterThanOrEqual(0);
      expect(signal.scores.momentum_score).toBeLessThanOrEqual(1);
      expect(signal.scores.volume_score).toBeGreaterThanOrEqual(0);
      expect(signal.scores.volume_score).toBeLessThanOrEqual(1);
    });
  });

  describe('generateSignal — entry conditions NOT met', () => {
    it('should return null when price <= high_20d', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 100,
        high_20d: 100,
        volume_ratio_20d: 2.0,
        momentum_20d: 0.10,
      });
      expect(signal).toBeNull();
    });

    it('should return null when volume_ratio_20d <= 1.5', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 110,
        high_20d: 100,
        volume_ratio_20d: 1.5,
        momentum_20d: 0.10,
      });
      expect(signal).toBeNull();
    });

    it('should return null when momentum_20d <= 0.05', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 110,
        high_20d: 100,
        volume_ratio_20d: 2.0,
        momentum_20d: 0.05,
      });
      expect(signal).toBeNull();
    });
  });

  describe('generateSignal — missing/incomplete data', () => {
    it('should return null when price is missing', () => {
      const signal = strategy.generateSignal('AAPL', {
        high_20d: 100,
        volume_ratio_20d: 2.0,
        momentum_20d: 0.10,
      });
      expect(signal).toBeNull();
    });

    it('should return null when an indicator is null', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 110,
        high_20d: null,
        volume_ratio_20d: 2.0,
        momentum_20d: 0.10,
      });
      expect(signal).toBeNull();
    });

    it('should return null when an indicator is NaN', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 110,
        high_20d: 100,
        volume_ratio_20d: NaN,
        momentum_20d: 0.10,
      });
      expect(signal).toBeNull();
    });

    it('should return null when an indicator is Infinity', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 110,
        high_20d: 100,
        volume_ratio_20d: 2.0,
        momentum_20d: Infinity,
      });
      expect(signal).toBeNull();
    });
  });
});


/**
 * Property-based tests for MomentumBreakoutStrategy
 *
 * Feature: multi-strategy-trading, Property 1: 动量突破策略信号正确性
 * Validates: Requirements 1.1, 1.2
 */

import * as fc from 'fast-check';

describe('MomentumBreakoutStrategy — Property-Based Tests', () => {
  const strategy = new MomentumBreakoutStrategy();

  /**
   * Property 1: 动量突破策略信号正确性
   *
   * For any indicators satisfying entry conditions (price > high_20d,
   * volume_ratio_20d > 1.5, momentum_20d > 0.05), generateSignal should
   * return a non-null buy signal with correct stop_loss, take_profit,
   * and scores in [0, 1].
   *
   * **Validates: Requirements 1.1, 1.2**
   */
  it('should produce a correct buy signal for any valid entry indicators', () => {
    const validIndicatorsArb = fc
      .record({
        high_20d: fc.double({ min: 1, max: 10000, noNaN: true }),
        volume_ratio_20d: fc.double({ min: 1.500001, max: 100, noNaN: true }),
        momentum_20d: fc.double({ min: 0.050001, max: 10, noNaN: true }),
      })
      .chain(({ high_20d, volume_ratio_20d, momentum_20d }) =>
        fc.record({
          // price must be strictly greater than high_20d
          price: fc.double({ min: high_20d + 0.01, max: high_20d + 50000, noNaN: true }),
          high_20d: fc.constant(high_20d),
          volume_ratio_20d: fc.constant(volume_ratio_20d),
          momentum_20d: fc.constant(momentum_20d),
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

        // take_profit = entry_price × 1.12
        expect(signal!.take_profit).toBeCloseTo(indicators.price * 1.12, 8);

        // momentum_score ∈ [0, 1]
        expect(signal!.scores.momentum_score).toBeGreaterThanOrEqual(0);
        expect(signal!.scores.momentum_score).toBeLessThanOrEqual(1);

        // volume_score ∈ [0, 1]
        expect(signal!.scores.volume_score).toBeGreaterThanOrEqual(0);
        expect(signal!.scores.volume_score).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });
});


/**
 * Property-based tests for MomentumBreakoutStrategy — Missing Data Handling
 *
 * Feature: multi-strategy-trading, Property 4 (partial): 策略缺失数据处理 — MomentumBreakout
 *
 * For any indicator set that is missing one or more required fields
 * (price, high_20d, volume_ratio_20d, momentum_20d) — where "missing"
 * means the key is absent, or its value is null, NaN, or Infinity —
 * generateSignal should return null.
 *
 * **Validates: Requirements 1.3**
 */
describe('MomentumBreakoutStrategy — Property 4: Missing Data Handling', () => {
  const strategy = new MomentumBreakoutStrategy();

  const REQUIRED_KEYS = ['price', 'high_20d', 'volume_ratio_20d', 'momentum_20d'] as const;

  /** Arbitrary that produces a complete, valid indicator set (all entry conditions met). */
  const validIndicatorsArb = fc.record({
    price: fc.double({ min: 101, max: 10000, noNaN: true }),
    high_20d: fc.double({ min: 1, max: 100, noNaN: true }),
    volume_ratio_20d: fc.double({ min: 1.6, max: 50, noNaN: true }),
    momentum_20d: fc.double({ min: 0.06, max: 5, noNaN: true }),
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
