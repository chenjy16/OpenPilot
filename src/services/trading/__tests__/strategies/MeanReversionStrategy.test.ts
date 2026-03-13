/**
 * Tests for MeanReversionStrategy
 *
 * Feature: multi-strategy-trading
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { MeanReversionStrategy } from '../../strategies/MeanReversionStrategy';

describe('MeanReversionStrategy', () => {
  const strategy = new MeanReversionStrategy();

  it('should have name "mean_reversion"', () => {
    expect(strategy.name).toBe('mean_reversion');
  });

  describe('generateSignal — entry conditions met', () => {
    const validIndicators = {
      price: 95,
      rsi_14: 25,
      bb_lower: 100,
      volume_ratio_20d: 2.0,
    };

    it('should return a buy signal when all entry conditions are met', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators);
      expect(signal).not.toBeNull();
      expect(signal!.symbol).toBe('AAPL');
      expect(signal!.action).toBe('buy');
      expect(signal!.entry_price).toBe(95);
    });

    it('should set stop_loss = entry_price × 0.96', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.stop_loss).toBeCloseTo(95 * 0.96);
    });

    it('should set take_profit = entry_price × 1.06', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.take_profit).toBeCloseTo(95 * 1.06);
    });

    it('should include expected_hold_days { min: 2, max: 5 } in metadata', () => {
      const signal = strategy.generateSignal('AAPL', validIndicators)!;
      expect(signal.metadata.expected_hold_days).toEqual({ min: 2, max: 5 });
    });
  });

  describe('generateSignal — entry conditions NOT met', () => {
    it('should return null when rsi_14 >= 30', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 95,
        rsi_14: 30,
        bb_lower: 100,
        volume_ratio_20d: 2.0,
      });
      expect(signal).toBeNull();
    });

    it('should return null when price >= bb_lower', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 100,
        rsi_14: 25,
        bb_lower: 100,
        volume_ratio_20d: 2.0,
      });
      expect(signal).toBeNull();
    });

    it('should return null when volume_ratio_20d <= 1.5', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 95,
        rsi_14: 25,
        bb_lower: 100,
        volume_ratio_20d: 1.5,
      });
      expect(signal).toBeNull();
    });
  });

  describe('generateSignal — missing/incomplete data', () => {
    it('should return null when price is missing', () => {
      const signal = strategy.generateSignal('AAPL', {
        rsi_14: 25,
        bb_lower: 100,
        volume_ratio_20d: 2.0,
      });
      expect(signal).toBeNull();
    });

    it('should return null when an indicator is null', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 95,
        rsi_14: null,
        bb_lower: 100,
        volume_ratio_20d: 2.0,
      });
      expect(signal).toBeNull();
    });

    it('should return null when an indicator is NaN', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 95,
        rsi_14: 25,
        bb_lower: NaN,
        volume_ratio_20d: 2.0,
      });
      expect(signal).toBeNull();
    });

    it('should return null when an indicator is Infinity', () => {
      const signal = strategy.generateSignal('AAPL', {
        price: 95,
        rsi_14: 25,
        bb_lower: 100,
        volume_ratio_20d: Infinity,
      });
      expect(signal).toBeNull();
    });
  });
});


/**
 * Property-based tests for MeanReversionStrategy
 *
 * Feature: multi-strategy-trading, Property 2: 均值回归策略信号正确性
 * Validates: Requirements 2.1, 2.2
 */

import * as fc from 'fast-check';

describe('MeanReversionStrategy — Property-Based Tests', () => {
  const strategy = new MeanReversionStrategy();

  /**
   * Property 2: 均值回归策略信号正确性
   *
   * For any indicators satisfying entry conditions (rsi_14 < 30,
   * price < bb_lower, volume_ratio_20d > 1.5), generateSignal should
   * return a non-null buy signal with:
   *   - action = 'buy'
   *   - stop_loss = entry_price × 0.96
   *   - take_profit = entry_price × 1.06
   *   - metadata.expected_hold_days = { min: 2, max: 5 }
   *
   * **Validates: Requirements 2.1, 2.2**
   */
  it('should produce a correct buy signal for any valid entry indicators', () => {
    const validIndicatorsArb = fc
      .record({
        rsi_14: fc.double({ min: 0.01, max: 29.99, noNaN: true }),
        bb_lower: fc.double({ min: 1, max: 10000, noNaN: true }),
        volume_ratio_20d: fc.double({ min: 1.500001, max: 100, noNaN: true }),
      })
      .chain(({ rsi_14, bb_lower, volume_ratio_20d }) =>
        fc.record({
          // price must be strictly less than bb_lower
          price: fc.double({ min: 0.01, max: bb_lower - 0.01, noNaN: true }),
          rsi_14: fc.constant(rsi_14),
          bb_lower: fc.constant(bb_lower),
          volume_ratio_20d: fc.constant(volume_ratio_20d),
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

        // stop_loss = entry_price × 0.96
        expect(signal!.stop_loss).toBeCloseTo(indicators.price * 0.96, 8);

        // take_profit = entry_price × 1.06
        expect(signal!.take_profit).toBeCloseTo(indicators.price * 1.06, 8);

        // metadata.expected_hold_days = { min: 2, max: 5 }
        expect(signal!.metadata.expected_hold_days).toEqual({ min: 2, max: 5 });
      }),
      { numRuns: 200 },
    );
  });
});


/**
 * Property-based tests for MeanReversionStrategy — Missing Data Handling
 *
 * Feature: multi-strategy-trading, Property 4 (partial): 策略缺失数据处理 — MeanReversion
 *
 * For any indicator set that is missing one or more required fields
 * (price, rsi_14, bb_lower, volume_ratio_20d) — where "missing"
 * means the key is absent, or its value is null, NaN, or Infinity —
 * generateSignal should return null.
 *
 * **Validates: Requirements 2.3**
 */
describe('MeanReversionStrategy — Property 4: Missing Data Handling', () => {
  const strategy = new MeanReversionStrategy();

  const REQUIRED_KEYS = ['price', 'rsi_14', 'bb_lower', 'volume_ratio_20d'] as const;

  /** Arbitrary that produces a complete, valid indicator set (all entry conditions met). */
  const validIndicatorsArb = fc.record({
    price: fc.double({ min: 0.01, max: 99, noNaN: true }),
    rsi_14: fc.double({ min: 0.01, max: 29.99, noNaN: true }),
    bb_lower: fc.double({ min: 100, max: 10000, noNaN: true }),
    volume_ratio_20d: fc.double({ min: 1.6, max: 50, noNaN: true }),
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
