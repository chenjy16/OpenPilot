/**
 * Property-Based Tests for ArbitrageDetector
 *
 * Feature: polymarket-trading
 * Properties 6, 7, 8
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

import * as fc from 'fast-check';
import { ArbitrageDetector } from './ArbitrageDetector';
import type { PolymarketTradingService } from './PolymarketTradingService';
import type { MarketSnapshot } from '../PolymarketScanner';
import type { OrderBookData } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMarket(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    id: 'mkt-1',
    conditionId: 'cond-1',
    question: 'Will it rain?',
    slug: 'will-it-rain',
    yesPrice: 0.6,
    noPrice: 0.4,
    probability: 0.6,
    volume: 100000,
    volume24hr: 5000,
    liquidity: 50000,
    endDate: null,
    tags: [],
    active: true,
    ...overrides,
  };
}

function makeOrderBook(overrides: Partial<OrderBookData> = {}): OrderBookData {
  return {
    bids: [{ price: 0.58, size: 100 }],
    asks: [{ price: 0.62, size: 100 }],
    best_bid: 0.58,
    best_ask: 0.62,
    spread: 0.04,
    midpoint: 0.6,
    ...overrides,
  };
}

function createMockTradingService(
  midpoints: Record<string, number>,
  orderBooks?: Record<string, OrderBookData>,
): PolymarketTradingService {
  return {
    getMidpoint: jest.fn(async (tokenId: string) => {
      if (tokenId in midpoints) return midpoints[tokenId];
      throw new Error(`No midpoint for ${tokenId}`);
    }),
    getOrderBook: jest.fn(async (tokenId: string) => {
      if (orderBooks && tokenId in orderBooks) return orderBooks[tokenId];
      return makeOrderBook();
    }),
  } as unknown as PolymarketTradingService;
}

function mockGammaFetch(
  tokenMap: Record<string, [string, string] | null>,
): void {
  (global.fetch as jest.Mock) = jest.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;

    if (url.includes('gamma-api.polymarket.com/markets')) {
      const idMatch = url.match(/[?&]id=([^&]+)/);
      const condId = idMatch ? decodeURIComponent(idMatch[1]) : '';
      const tokens = tokenMap[condId];

      if (tokens) {
        return new Response(
          JSON.stringify([{ clobTokenIds: JSON.stringify(tokens) }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }

    return new Response('Unknown', { status: 404 });
  }) as any;
}

// ── Property 6: Arbitrage detection threshold ────────────────────────────

// Feature: polymarket-trading, Property 6: Arbitrage detection threshold

/**
 * Property 6: Arbitrage detection threshold
 *
 * *For any* market with yes_price and no_price, the market is flagged as an
 * arbitrage opportunity if and only if `|yes_price + no_price - 1.0| > threshold`.
 * The theoretical profit percentage SHALL equal `|1.0 - (yes_price + no_price)| * 100`.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3**
 */

describe('Property 6: Arbitrage detection threshold', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('flags market iff |yes + no - 1.0| > threshold, with correct profit_pct', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: 0.001, max: 0.2, noNaN: true }),
        async (yesPrice, noPrice, threshold) => {
          const svc = createMockTradingService(
            { 'yes-tok': yesPrice, 'no-tok': noPrice },
          );
          const detector = new ArbitrageDetector(svc, threshold);

          mockGammaFetch({ 'cond-1': ['yes-tok', 'no-tok'] });

          const results = await detector.detectOpportunities([makeMarket()]);

          const sum = yesPrice + noPrice;
          const deviation = Math.abs(sum - 1.0);
          const shouldFlag = deviation > threshold;

          if (shouldFlag) {
            expect(results).toHaveLength(1);
            expect(results[0].profit_pct).toBeCloseTo(
              Math.abs(1.0 - sum) * 100,
              5,
            );
            expect(results[0].yes_price).toBeCloseTo(yesPrice, 10);
            expect(results[0].no_price).toBeCloseTo(noPrice, 10);
          } else {
            expect(results).toHaveLength(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ── Property 7: Arbitrage opportunities sorted by profit ─────────────────

// Feature: polymarket-trading, Property 7: Arbitrage opportunities sorted by profit

/**
 * Property 7: Arbitrage opportunities sorted by profit
 *
 * *For any* list of arbitrage opportunities returned by the ArbitrageDetector,
 * the list SHALL be sorted by theoretical profit percentage in descending order.
 *
 * **Validates: Requirements 9.4**
 */

describe('Property 7: Arbitrage opportunities sorted by profit', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('results are sorted by profit_pct descending', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            yesPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
            noPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
          }),
          { minLength: 2, maxLength: 8 },
        ),
        async (pricePairs) => {
          // Build midpoints and token maps for each market
          const midpoints: Record<string, number> = {};
          const tokenMap: Record<string, [string, string] | null> = {};
          const markets: MarketSnapshot[] = [];

          for (let i = 0; i < pricePairs.length; i++) {
            const yesToken = `yes-${i}`;
            const noToken = `no-${i}`;
            const condId = `cond-${i}`;

            midpoints[yesToken] = pricePairs[i].yesPrice;
            midpoints[noToken] = pricePairs[i].noPrice;
            tokenMap[condId] = [yesToken, noToken];
            markets.push(
              makeMarket({
                id: `mkt-${i}`,
                conditionId: condId,
                question: `Q${i}`,
              }),
            );
          }

          // Use a very small threshold so most markets are flagged
          const svc = createMockTradingService(midpoints);
          const detector = new ArbitrageDetector(svc, 0.0001);

          mockGammaFetch(tokenMap);

          const results = await detector.detectOpportunities(markets);

          // Verify descending sort by profit_pct
          for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].profit_pct).toBeGreaterThanOrEqual(
              results[i].profit_pct,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ── Property 8: Arbitrage spread inclusion ───────────────────────────────

// Feature: polymarket-trading, Property 8: Arbitrage spread inclusion

/**
 * Property 8: Arbitrage spread inclusion
 *
 * *For any* arbitrage opportunity in the output, the spread_yes and spread_no
 * fields SHALL be present and non-negative.
 *
 * **Validates: Requirements 7.5**
 */

describe('Property 8: Arbitrage spread inclusion', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('every opportunity has spread_yes >= 0 and spread_no >= 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            yesPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
            noPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
            spreadYes: fc.double({ min: 0, max: 0.5, noNaN: true }),
            spreadNo: fc.double({ min: 0, max: 0.5, noNaN: true }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (entries) => {
          const midpoints: Record<string, number> = {};
          const orderBooks: Record<string, OrderBookData> = {};
          const tokenMap: Record<string, [string, string] | null> = {};
          const markets: MarketSnapshot[] = [];

          for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const yesToken = `yes-${i}`;
            const noToken = `no-${i}`;
            const condId = `cond-${i}`;

            midpoints[yesToken] = e.yesPrice;
            midpoints[noToken] = e.noPrice;

            orderBooks[yesToken] = makeOrderBook({
              spread: e.spreadYes,
              best_bid: Math.max(0.01, e.yesPrice - e.spreadYes / 2),
              best_ask: e.yesPrice + e.spreadYes / 2,
            });
            orderBooks[noToken] = makeOrderBook({
              spread: e.spreadNo,
              best_bid: Math.max(0.01, e.noPrice - e.spreadNo / 2),
              best_ask: e.noPrice + e.spreadNo / 2,
            });

            tokenMap[condId] = [yesToken, noToken];
            markets.push(
              makeMarket({
                id: `mkt-${i}`,
                conditionId: condId,
                question: `Q${i}`,
              }),
            );
          }

          // Use a very small threshold so most markets are flagged
          const svc = createMockTradingService(midpoints, orderBooks);
          const detector = new ArbitrageDetector(svc, 0.0001);

          mockGammaFetch(tokenMap);

          const results = await detector.detectOpportunities(markets);

          for (const opp of results) {
            expect(opp.spread_yes).toBeDefined();
            expect(opp.spread_no).toBeDefined();
            expect(opp.spread_yes).toBeGreaterThanOrEqual(0);
            expect(opp.spread_no).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
