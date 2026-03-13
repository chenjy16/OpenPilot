/**
 * Property-based tests for StrategySignal JSON serialization round-trip.
 *
 * Feature: multi-strategy-trading, Property 5: Signal JSON 序列化 round-trip
 * Validates: Requirements 4.4
 */

import * as fc from 'fast-check';
import type { StrategySignal } from '../../types';

/**
 * Arbitrary generator for valid StrategySignal objects.
 * Uses finite numbers for prices and valid action values.
 */
const strategySignalArb: fc.Arbitrary<StrategySignal> = fc.record({
  symbol: fc.stringMatching(/^[A-Z]{1,5}$/),
  action: fc.constantFrom('buy' as const, 'sell' as const, 'hold' as const),
  entry_price: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  stop_loss: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  take_profit: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  scores: fc.dictionary(
    fc.stringMatching(/^[a-z_]{1,20}$/),
    fc.double({ min: 0, max: 1, noNaN: true }),
  ),
  metadata: fc.dictionary(
    fc.stringMatching(/^[a-z_]{1,20}$/),
    fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e308, max: 1e308 }),
      fc.string(),
      fc.boolean(),
      fc.constant(null),
    ),
  ),
});

describe('StrategySignal JSON round-trip', () => {
  /**
   * Property 5: Signal JSON 序列化 round-trip
   *
   * For any valid StrategySignal object, JSON.parse(JSON.stringify(signal))
   * should deep equal the original object.
   *
   * **Validates: Requirements 4.4**
   */
  it('should survive JSON serialization round-trip for any valid signal', () => {
    fc.assert(
      fc.property(strategySignalArb, (signal: StrategySignal) => {
        const roundTripped = JSON.parse(JSON.stringify(signal));
        expect(roundTripped).toEqual(signal);
      }),
      { numRuns: 200 },
    );
  });
});
