/**
 * Property-Based Tests for CrossMarketArbitrageOpportunity types
 *
 * Feature: cross-market-arbitrage, Property 19: JSON serialization round-trip consistency
 *
 * Validates: Requirements 7.2, 7.3, 7.4
 */

import * as fc from 'fast-check';
import type { CrossMarketArbitrageOpportunity, Platform } from './types';

// ---------------------------------------------------------------------------
// Arbitraries (from design doc)
// ---------------------------------------------------------------------------

const platformArb = fc.constantFrom<Platform>('polymarket', 'kalshi', 'myriad', 'manifold');

const priceArb = fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true });

const hexStringArb = fc.stringMatching(/^[0-9a-f]{8,16}$/);

const opportunityArb: fc.Arbitrary<CrossMarketArbitrageOpportunity> = fc.record({
  platformA: platformArb,
  platformAMarketId: hexStringArb,
  platformB: platformArb,
  platformBMarketId: hexStringArb,
  question: fc.string({ minLength: 5, maxLength: 200 }),
  direction: fc.constantFrom<'A_YES_B_NO' | 'A_NO_B_YES'>('A_YES_B_NO', 'A_NO_B_YES'),
  platformAYesPrice: priceArb,
  platformANoPrice: priceArb,
  platformBYesPrice: priceArb,
  platformBNoPrice: priceArb,
  vwapBuyPrice: priceArb,
  vwapSellPrice: priceArb,
  realArbitrageCost: fc.double({ min: 0.5, max: 1.5, noNaN: true, noDefaultInfinity: true }),
  platformAFee: fc.double({ min: 0, max: 0.1, noNaN: true, noDefaultInfinity: true }).map(v => v === 0 ? 0 : v),
  platformBFee: fc.double({ min: 0, max: 0.1, noNaN: true, noDefaultInfinity: true }).map(v => v === 0 ? 0 : v),
  totalFees: fc.double({ min: 0, max: 0.2, noNaN: true, noDefaultInfinity: true }).map(v => v === 0 ? 0 : v),
  profitPct: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }).map(v => v === 0 ? 0 : v),
  arbScore: fc.integer({ min: 0, max: 100 }),
  liquidityWarning: fc.boolean(),
  oracleMismatch: fc.boolean(),
  depthStatus: fc.constantFrom<'sufficient' | 'insufficient_depth'>('sufficient', 'insufficient_depth'),
  detectedAt: fc.integer({ min: 1700000000, max: 1800000000 }),
});

// ---------------------------------------------------------------------------
// Property 19: JSON serialization round-trip consistency
// ---------------------------------------------------------------------------

describe('Feature: cross-market-arbitrage, Property 19: JSON serialization round-trip consistency', () => {
  it('JSON.stringify then JSON.parse should produce an object equivalent to the original', () => {
    fc.assert(
      fc.property(opportunityArb, (opportunity) => {
        const serialized = JSON.stringify(opportunity);
        const deserialized = JSON.parse(serialized) as CrossMarketArbitrageOpportunity;

        // All string fields
        expect(deserialized.platformA).toBe(opportunity.platformA);
        expect(deserialized.platformAMarketId).toBe(opportunity.platformAMarketId);
        expect(deserialized.platformB).toBe(opportunity.platformB);
        expect(deserialized.platformBMarketId).toBe(opportunity.platformBMarketId);
        expect(deserialized.question).toBe(opportunity.question);
        expect(deserialized.direction).toBe(opportunity.direction);
        expect(deserialized.depthStatus).toBe(opportunity.depthStatus);

        // All numeric fields
        expect(deserialized.platformAYesPrice).toBe(opportunity.platformAYesPrice);
        expect(deserialized.platformANoPrice).toBe(opportunity.platformANoPrice);
        expect(deserialized.platformBYesPrice).toBe(opportunity.platformBYesPrice);
        expect(deserialized.platformBNoPrice).toBe(opportunity.platformBNoPrice);
        expect(deserialized.vwapBuyPrice).toBe(opportunity.vwapBuyPrice);
        expect(deserialized.vwapSellPrice).toBe(opportunity.vwapSellPrice);
        expect(deserialized.realArbitrageCost).toBe(opportunity.realArbitrageCost);
        expect(deserialized.platformAFee).toBe(opportunity.platformAFee);
        expect(deserialized.platformBFee).toBe(opportunity.platformBFee);
        expect(deserialized.totalFees).toBe(opportunity.totalFees);
        expect(deserialized.profitPct).toBe(opportunity.profitPct);
        expect(deserialized.arbScore).toBe(opportunity.arbScore);
        expect(deserialized.detectedAt).toBe(opportunity.detectedAt);

        // Boolean fields
        expect(deserialized.liquidityWarning).toBe(opportunity.liquidityWarning);
        expect(deserialized.oracleMismatch).toBe(opportunity.oracleMismatch);
      }),
      { numRuns: 100 },
    );
  });
});
