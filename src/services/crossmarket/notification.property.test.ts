/**
 * Property-Based Tests for Cross-Market Arbitrage Notification Message Format
 *
 * Feature: cross-market-arbitrage, Property 15: Notification message format completeness
 *
 * Validates: Requirements 4.2
 */

import * as fc from 'fast-check';
import { formatCrossMarketAlert } from '../NotificationService';
import type { CrossMarketArbitrageOpportunity, Platform } from './types';

// ---------------------------------------------------------------------------
// Arbitraries (same as types.property.test.ts)
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
// Property 15: Notification message format completeness
// ---------------------------------------------------------------------------

describe('Feature: cross-market-arbitrage, Property 15: Notification message format completeness', () => {
  it('formatted message must contain all required fields from the opportunity', () => {
    fc.assert(
      fc.property(opportunityArb, (opp) => {
        const message = formatCrossMarketAlert(opp);

        // Must contain the arbitrage direction value
        expect(message).toContain(opp.direction);

        // Must contain both platform names
        expect(message).toContain(opp.platformA);
        expect(message).toContain(opp.platformB);

        // Must contain the market question
        expect(message).toContain(opp.question);

        // Must contain VWAP prices (formatted to 4 decimal places)
        expect(message).toContain(opp.vwapBuyPrice.toFixed(4));
        expect(message).toContain(opp.vwapSellPrice.toFixed(4));

        // Must contain real arbitrage cost
        expect(message).toContain(opp.realArbitrageCost.toFixed(4));

        // Must contain expected profit percentage
        expect(message).toContain(opp.profitPct.toFixed(2));

        // Must contain Arb_Score
        expect(message).toContain(`Arb_Score: ${opp.arbScore}`);

        // Liquidity warning conditional check
        if (opp.liquidityWarning) {
          expect(message).toContain('流动性警告');
        } else {
          expect(message).not.toContain('流动性警告');
        }
      }),
      { numRuns: 100 },
    );
  });
});
