/**
 * Property-based tests for QuantityCalculator risk_budget mode.
 *
 * Feature: multi-strategy-trading, Property 11: 风险预算仓位计算
 * Validates: Requirements 10.1, 10.3, 10.4
 */

import fc from 'fast-check';
import { calculateOrderQuantity } from '../QuantityCalculator';
import type { QuantityParams } from '../types';

// ---------------------------------------------------------------------------
// Property 11: 风险预算仓位计算
// ---------------------------------------------------------------------------

describe('Property 11: 风险预算仓位计算', () => {
  /**
   * **Validates: Requirements 10.1, 10.4**
   *
   * For any entry_price > 0, stop_loss < entry_price, total_assets > 0,
   * and max_risk_pct in (0, 1), the result should equal
   * floor(total_assets × max_risk_pct / (entry_price - stop_loss)).
   */
  it('should compute floor(total_assets × max_risk_pct / (entry_price - stop_loss))', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10000, noNaN: true }),       // entry_price
        fc.double({ min: 0.01, max: 9999, noNaN: true }),     // stop_loss_offset (entry - stop)
        fc.double({ min: 1000, max: 1_000_000, noNaN: true }),// total_assets
        fc.double({ min: 0.001, max: 0.1, noNaN: true }),     // max_risk_pct
        (entryPrice, stopLossOffset, totalAssets, maxRiskPct) => {
          // Ensure stop_loss < entry_price by using offset
          const stopLoss = entryPrice - stopLossOffset;
          fc.pre(stopLoss > 0); // stop_loss must be positive for realistic scenario
          fc.pre(stopLossOffset > 0); // risk_per_share > 0

          const params: QuantityParams = {
            mode: 'risk_budget',
            entry_price: entryPrice,
            stop_loss: stopLoss,
            total_assets: totalAssets,
            max_risk_pct: maxRiskPct,
          };

          const result = calculateOrderQuantity(params);

          // Replicate the exact floating-point computation the implementation performs
          const riskPerShare = entryPrice - stopLoss;
          const maxRiskAmount = totalAssets * maxRiskPct;
          const expected = Math.floor(maxRiskAmount / riskPerShare);
          const finalExpected = expected < 1 ? 0 : expected;

          return result === finalExpected;
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 10.4**
   *
   * The result must always be a non-negative integer.
   */
  it('should always return a non-negative integer', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10000, noNaN: true }),       // entry_price
        fc.double({ min: 0.01, max: 9999, noNaN: true }),     // stop_loss_offset
        fc.double({ min: 1000, max: 1_000_000, noNaN: true }),// total_assets
        fc.double({ min: 0.001, max: 0.1, noNaN: true }),     // max_risk_pct
        (entryPrice, stopLossOffset, totalAssets, maxRiskPct) => {
          const stopLoss = entryPrice - stopLossOffset;
          fc.pre(stopLoss > 0);
          fc.pre(stopLossOffset > 0);

          const params: QuantityParams = {
            mode: 'risk_budget',
            entry_price: entryPrice,
            stop_loss: stopLoss,
            total_assets: totalAssets,
            max_risk_pct: maxRiskPct,
          };

          const result = calculateOrderQuantity(params);

          return Number.isInteger(result) && result >= 0;
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 10.3**
   *
   * When stop_loss >= entry_price (risk_per_share <= 0), the result must be 0.
   */
  it('should return 0 when stop_loss >= entry_price', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10000, noNaN: true }),       // entry_price
        fc.double({ min: 0, max: 5000, noNaN: true }),        // extra above entry
        fc.double({ min: 1000, max: 1_000_000, noNaN: true }),// total_assets
        fc.double({ min: 0.001, max: 0.1, noNaN: true }),     // max_risk_pct
        (entryPrice, extra, totalAssets, maxRiskPct) => {
          // stop_loss >= entry_price
          const stopLoss = entryPrice + extra;

          const params: QuantityParams = {
            mode: 'risk_budget',
            entry_price: entryPrice,
            stop_loss: stopLoss,
            total_assets: totalAssets,
            max_risk_pct: maxRiskPct,
          };

          const result = calculateOrderQuantity(params);

          return result === 0;
        },
      ),
      { numRuns: 100 },
    );
  });
});
