// Feature: auto-quant-trading, Property 3: 下单数量计算正确性
/**
 * Property-based tests for QuantityCalculator — order quantity calculation correctness.
 *
 * Property 3: For any positive entry_price and positive config parameters:
 * - fixed_quantity mode: result equals fixed_quantity_value
 * - fixed_amount mode: result equals floor(fixed_amount_value / entry_price)
 * - kelly_formula mode: result equals floor(kellyFraction × total_assets / entry_price)
 *   where kellyFraction is based on take_profit, stop_loss, entry_price
 *
 * All modes produce non-negative integers; when computed result < 1, return 0.
 *
 * **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
 */

import * as fc from 'fast-check';
import { calculateOrderQuantity, calculateKellyFraction } from './QuantityCalculator';
import type { QuantityParams } from './types';

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Positive entry price (avoid extremely small values that cause overflow) */
const arbPositivePrice = fc.double({ min: 0.01, max: 1_000_000, noNaN: true });

/** Positive fixed quantity value */
const arbFixedQuantity = fc.integer({ min: 1, max: 100_000 });

/** Positive fixed amount value */
const arbFixedAmount = fc.double({ min: 1, max: 100_000_000, noNaN: true });

/** Positive total assets */
const arbTotalAssets = fc.double({ min: 1, max: 100_000_000, noNaN: true });

/**
 * Generate stop_loss < entry_price < take_profit for Kelly mode.
 * We generate entry_price first, then derive stop_loss and take_profit.
 */
const arbKellyPrices = fc
  .tuple(
    fc.double({ min: 1, max: 100_000, noNaN: true }),   // entry_price
    fc.double({ min: 0.01, max: 0.99, noNaN: true }),   // stop_loss fraction below entry
    fc.double({ min: 0.01, max: 10, noNaN: true }),      // take_profit fraction above entry
  )
  .map(([entry, slFrac, tpFrac]) => ({
    entry_price: entry,
    stop_loss: entry * (1 - slFrac),
    take_profit: entry * (1 + tpFrac),
  }));

// ─── Property 3: 下单数量计算正确性 ────────────────────────────────────────

describe('QuantityCalculator Property Tests', () => {
  // **Validates: Requirements 3.2**
  describe('fixed_quantity mode', () => {
    it('result equals fixed_quantity_value for any positive entry_price', () => {
      fc.assert(
        fc.property(arbPositivePrice, arbFixedQuantity, (entryPrice, fixedQty) => {
          const params: QuantityParams = {
            mode: 'fixed_quantity',
            entry_price: entryPrice,
            fixed_quantity_value: fixedQty,
          };

          const result = calculateOrderQuantity(params);

          // fixed_quantity_value is always >= 1, so result should equal it
          expect(result).toBe(fixedQty);
        }),
        { numRuns: 10 },
      );
    });
  });

  // **Validates: Requirements 3.3**
  describe('fixed_amount mode', () => {
    it('result equals floor(fixed_amount_value / entry_price), or 0 when < 1', () => {
      fc.assert(
        fc.property(arbPositivePrice, arbFixedAmount, (entryPrice, fixedAmount) => {
          const params: QuantityParams = {
            mode: 'fixed_amount',
            entry_price: entryPrice,
            fixed_amount_value: fixedAmount,
          };

          const result = calculateOrderQuantity(params);
          const expected = Math.floor(fixedAmount / entryPrice);

          if (expected < 1) {
            expect(result).toBe(0);
          } else {
            expect(result).toBe(expected);
          }
        }),
        { numRuns: 10 },
      );
    });
  });

  // **Validates: Requirements 3.4**
  describe('kelly_formula mode', () => {
    it('result equals floor(kellyFraction × total_assets / entry_price), or 0 when < 1', () => {
      fc.assert(
        fc.property(arbKellyPrices, arbTotalAssets, (prices, totalAssets) => {
          const { entry_price, stop_loss, take_profit } = prices;

          const params: QuantityParams = {
            mode: 'kelly_formula',
            entry_price,
            stop_loss,
            take_profit,
            total_assets: totalAssets,
          };

          const result = calculateOrderQuantity(params);
          const kellyFraction = calculateKellyFraction(entry_price, take_profit, stop_loss);
          const expected = Math.floor(kellyFraction * totalAssets / entry_price);

          if (expected < 1) {
            expect(result).toBe(0);
          } else {
            expect(result).toBe(expected);
          }
        }),
        { numRuns: 10 },
      );
    });
  });

  // **Validates: Requirements 3.5**
  describe('all modes produce non-negative integers', () => {
    it('fixed_quantity result is a non-negative integer', () => {
      fc.assert(
        fc.property(arbPositivePrice, arbFixedQuantity, (entryPrice, fixedQty) => {
          const result = calculateOrderQuantity({
            mode: 'fixed_quantity',
            entry_price: entryPrice,
            fixed_quantity_value: fixedQty,
          });

          expect(result).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(result)).toBe(true);
        }),
        { numRuns: 10 },
      );
    });

    it('fixed_amount result is a non-negative integer', () => {
      fc.assert(
        fc.property(arbPositivePrice, arbFixedAmount, (entryPrice, fixedAmount) => {
          const result = calculateOrderQuantity({
            mode: 'fixed_amount',
            entry_price: entryPrice,
            fixed_amount_value: fixedAmount,
          });

          expect(result).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(result)).toBe(true);
        }),
        { numRuns: 10 },
      );
    });

    it('kelly_formula result is a non-negative integer', () => {
      fc.assert(
        fc.property(arbKellyPrices, arbTotalAssets, (prices, totalAssets) => {
          const result = calculateOrderQuantity({
            mode: 'kelly_formula',
            entry_price: prices.entry_price,
            stop_loss: prices.stop_loss,
            take_profit: prices.take_profit,
            total_assets: totalAssets,
          });

          expect(result).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(result)).toBe(true);
        }),
        { numRuns: 10 },
      );
    });
  });

  // **Validates: Requirements 3.5**
  describe('result < 1 returns 0', () => {
    it('fixed_amount with very high price returns 0', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1_000_000, max: 10_000_000, noNaN: true }),
          fc.double({ min: 0.01, max: 0.99, noNaN: true }),
          (highPrice, smallAmount) => {
            const result = calculateOrderQuantity({
              mode: 'fixed_amount',
              entry_price: highPrice,
              fixed_amount_value: smallAmount,
            });

            // smallAmount / highPrice < 1, so floor < 1, should return 0
            expect(result).toBe(0);
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
