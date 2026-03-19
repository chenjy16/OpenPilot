/**
 * Property-Based Tests for FinFeedAPIClient
 *
 * Feature: cross-market-arbitrage, Property 1: Market data normalization completeness
 *
 * Validates: Requirements 1.3
 */

import * as fc from 'fast-check';
import type { Platform, NormalizedMarket } from './types';
import { FinFeedAPIClient } from './FinFeedAPIClient';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const platformArb = fc.constantFrom<Platform>('polymarket', 'kalshi', 'myriad', 'manifold');

/**
 * Generate raw market data as it might come from FinFeedAPI.
 * We randomly use either camelCase or snake_case field names to exercise
 * both parsing branches in parseMarket.
 */
const rawMarketArb = fc.record({
  useCamelCase: fc.boolean(),
  id: fc.string({ minLength: 1, maxLength: 32 }),
  question: fc.string({ minLength: 1, maxLength: 200 }),
  yesPrice: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  noPrice: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  volume: fc.double({ min: 0, max: 1e8, noNaN: true, noDefaultInfinity: true }),
  liquidity: fc.double({ min: 0, max: 1e7, noNaN: true, noDefaultInfinity: true }),
  endDate: fc.option(fc.integer({ min: 1704067200000, max: 1893456000000 }).map(ms => new Date(ms).toISOString()), { nil: null }),
  resolutionSource: fc.string({ minLength: 1, maxLength: 500 }),
  active: fc.boolean(),
}).map(({ useCamelCase, id, question, yesPrice, noPrice, volume, liquidity, endDate, resolutionSource, active }) => {
  if (useCamelCase) {
    return {
      id,
      question,
      yesPrice,
      noPrice,
      volume,
      liquidity,
      endDate,
      resolutionSource,
      active,
    };
  }
  // snake_case variant
  return {
    marketId: id,
    title: question,
    yes_price: yesPrice,
    no_price: noPrice,
    volume,
    liquidity,
    end_date: endDate,
    resolution_source: resolutionSource,
    active,
  };
});

// ---------------------------------------------------------------------------
// Property 1: Market data normalization completeness
// ---------------------------------------------------------------------------

describe('Feature: cross-market-arbitrage, Property 1: Market data normalization completeness', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalized NormalizedMarket must contain all required fields and yesPrice/noPrice in [0, 1]', async () => {
    await fc.assert(
      fc.asyncProperty(
        platformArb,
        fc.array(rawMarketArb, { minLength: 1, maxLength: 10 }),
        async (platform, rawMarkets) => {
          // Mock global fetch to return our generated raw data
          const mockResponse = {
            ok: true,
            status: 200,
            json: async () => rawMarkets,
          } as Response;

          jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

          const client = new FinFeedAPIClient({
            baseUrl: 'https://mock.finfeed.io',
            timeoutMs: 5000,
          });

          const markets: NormalizedMarket[] = await client.fetchMarkets(platform);

          // Must return same number of markets as raw input
          expect(markets.length).toBe(rawMarkets.length);

          for (const market of markets) {
            // All required fields must be present and have correct types
            expect(typeof market.platform).toBe('string');
            expect(['polymarket', 'kalshi', 'myriad', 'manifold']).toContain(market.platform);
            expect(market.platform).toBe(platform);

            expect(typeof market.marketId).toBe('string');

            expect(typeof market.question).toBe('string');

            expect(typeof market.yesPrice).toBe('number');
            expect(market.yesPrice).toBeGreaterThanOrEqual(0);
            expect(market.yesPrice).toBeLessThanOrEqual(1);

            expect(typeof market.noPrice).toBe('number');
            expect(market.noPrice).toBeGreaterThanOrEqual(0);
            expect(market.noPrice).toBeLessThanOrEqual(1);

            expect(typeof market.resolutionSource).toBe('string');

            // endDate must be string or null
            expect(
              market.endDate === null || typeof market.endDate === 'string',
            ).toBe(true);

            // Additional structural fields must exist
            expect(typeof market.volume).toBe('number');
            expect(typeof market.liquidity).toBe('number');
            expect(typeof market.active).toBe('boolean');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Exponential backoff retry interval (with jitter)
// ---------------------------------------------------------------------------

import { calculateBackoffDelay } from './FinFeedAPIClient';

describe('Feature: cross-market-arbitrage, Property 2: Exponential backoff retry interval (with jitter)', () => {
  it('delay must be in [baseDelay × 0.8, baseDelay × 1.2] for any attempt number', () => {
    fc.assert(
      fc.property(
        // Generate attempt numbers covering the full range including values
        // well past the cap (2000 × 2^k caps at 60000 when k >= ~5)
        fc.integer({ min: 0, max: 20 }),
        (attempt) => {
          const baseDelay = Math.min(2000 * Math.pow(2, attempt), 60000);
          const lowerBound = baseDelay * 0.8;
          const upperBound = baseDelay * 1.2;

          // Run multiple samples to exercise the random jitter
          for (let i = 0; i < 50; i++) {
            const delay = calculateBackoffDelay(attempt);

            expect(delay).toBeGreaterThanOrEqual(Math.floor(lowerBound));
            expect(delay).toBeLessThanOrEqual(Math.ceil(upperBound));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 1.6
   */
  it('base delay doubles each attempt up to the 60s cap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        (attempt) => {
          const expectedBase = Math.min(2000 * Math.pow(2, attempt), 60000);

          // The delay should be Math.round(expectedBase * jitter) where jitter ∈ [0.8, 1.2]
          const delay = calculateBackoffDelay(attempt);

          // Derive the implicit jitter from the result
          const impliedJitter = delay / expectedBase;

          // Jitter must be within [0.8, 1.2] (with small tolerance for rounding)
          expect(impliedJitter).toBeGreaterThanOrEqual(0.8 - 0.01);
          expect(impliedJitter).toBeLessThanOrEqual(1.2 + 0.01);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('delay is capped at 60000 × 1.2 = 72000 for very large attempt values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        (attempt) => {
          const delay = calculateBackoffDelay(attempt);
          // Max possible delay: 60000 * 1.2 = 72000
          expect(delay).toBeLessThanOrEqual(72000);
          // Min possible delay at cap: 60000 * 0.8 = 48000
          expect(delay).toBeGreaterThanOrEqual(48000);
        },
      ),
      { numRuns: 100 },
    );
  });
});
