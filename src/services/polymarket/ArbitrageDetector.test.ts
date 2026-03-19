/**
 * Unit tests for ArbitrageDetector.
 */

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

// Gamma API token IDs mock
function mockGammaFetch(
  tokenMap: Record<string, [string, string] | null>,
): void {
  (global.fetch as jest.Mock) = jest.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;

    // Gamma API call for token IDs
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

// ── Tests ────────────────────────────────────────────────────────────────

describe('ArbitrageDetector', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('constructor and setThreshold', () => {
    it('uses default threshold of 0.02', async () => {
      const svc = createMockTradingService({
        'yes-tok': 0.50,
        'no-tok': 0.49,
      });
      const detector = new ArbitrageDetector(svc);

      mockGammaFetch({ 'cond-1': ['yes-tok', 'no-tok'] });

      // sum = 0.99, deviation = 0.01 < 0.02 → no opportunity
      const results = await detector.detectOpportunities([makeMarket()]);
      expect(results).toHaveLength(0);
    });

    it('setThreshold changes the threshold', async () => {
      const svc = createMockTradingService({
        'yes-tok': 0.50,
        'no-tok': 0.49,
      });
      const detector = new ArbitrageDetector(svc);
      detector.setThreshold(0.005);

      mockGammaFetch({ 'cond-1': ['yes-tok', 'no-tok'] });

      // sum = 0.99, deviation = 0.01 > 0.005 → opportunity found
      const results = await detector.detectOpportunities([makeMarket()]);
      expect(results).toHaveLength(1);
    });

    it('accepts custom threshold in constructor', async () => {
      const svc = createMockTradingService({
        'yes-tok': 0.50,
        'no-tok': 0.49,
      });
      const detector = new ArbitrageDetector(svc, 0.005);

      mockGammaFetch({ 'cond-1': ['yes-tok', 'no-tok'] });

      const results = await detector.detectOpportunities([makeMarket()]);
      expect(results).toHaveLength(1);
    });
  });

  describe('detectOpportunities', () => {
    it('flags market when deviation exceeds threshold', async () => {
      const svc = createMockTradingService({
        'yes-tok': 0.55,
        'no-tok': 0.40,
      });
      const detector = new ArbitrageDetector(svc, 0.02);

      mockGammaFetch({ 'cond-1': ['yes-tok', 'no-tok'] });

      const results = await detector.detectOpportunities([makeMarket()]);
      expect(results).toHaveLength(1);

      const opp = results[0];
      expect(opp.market_id).toBe('mkt-1');
      expect(opp.question).toBe('Will it rain?');
      expect(opp.yes_price).toBe(0.55);
      expect(opp.no_price).toBe(0.40);
      expect(opp.sum).toBeCloseTo(0.95);
      expect(opp.deviation).toBeCloseTo(0.05);
      expect(opp.profit_pct).toBeCloseTo(5.0);
    });

    it('does not flag market when deviation is within threshold', async () => {
      const svc = createMockTradingService({
        'yes-tok': 0.51,
        'no-tok': 0.49,
      });
      const detector = new ArbitrageDetector(svc, 0.02);

      mockGammaFetch({ 'cond-1': ['yes-tok', 'no-tok'] });

      const results = await detector.detectOpportunities([makeMarket()]);
      expect(results).toHaveLength(0);
    });

    it('includes spread information from order book', async () => {
      const yesBook = makeOrderBook({
        best_bid: 0.53,
        best_ask: 0.57,
        spread: 0.04,
      });
      const noBook = makeOrderBook({
        best_bid: 0.38,
        best_ask: 0.42,
        spread: 0.04,
      });

      const svc = createMockTradingService(
        { 'yes-tok': 0.55, 'no-tok': 0.40 },
        { 'yes-tok': yesBook, 'no-tok': noBook },
      );
      const detector = new ArbitrageDetector(svc, 0.02);

      mockGammaFetch({ 'cond-1': ['yes-tok', 'no-tok'] });

      const results = await detector.detectOpportunities([makeMarket()]);
      expect(results).toHaveLength(1);

      const opp = results[0];
      expect(opp.best_bid_yes).toBe(0.53);
      expect(opp.best_ask_yes).toBe(0.57);
      expect(opp.spread_yes).toBe(0.04);
      expect(opp.best_bid_no).toBe(0.38);
      expect(opp.best_ask_no).toBe(0.42);
      expect(opp.spread_no).toBe(0.04);
    });

    it('sorts results by profit_pct descending', async () => {
      const svc = createMockTradingService({
        'yes-a': 0.55,
        'no-a': 0.40,
        'yes-b': 0.60,
        'no-b': 0.30,
        'yes-c': 0.52,
        'no-c': 0.45,
      });
      const detector = new ArbitrageDetector(svc, 0.02);

      mockGammaFetch({
        'cond-a': ['yes-a', 'no-a'],
        'cond-b': ['yes-b', 'no-b'],
        'cond-c': ['yes-c', 'no-c'],
      });

      const markets = [
        makeMarket({ id: 'mkt-a', conditionId: 'cond-a', question: 'A' }),
        makeMarket({ id: 'mkt-b', conditionId: 'cond-b', question: 'B' }),
        makeMarket({ id: 'mkt-c', conditionId: 'cond-c', question: 'C' }),
      ];

      const results = await detector.detectOpportunities(markets);

      // B: sum=0.90, profit=10%; A: sum=0.95, profit=5%; C: sum=0.97, profit=3%
      expect(results.length).toBe(3);
      expect(results[0].market_id).toBe('mkt-b');
      expect(results[0].profit_pct).toBeCloseTo(10.0);
      expect(results[1].market_id).toBe('mkt-a');
      expect(results[1].profit_pct).toBeCloseTo(5.0);
      expect(results[2].market_id).toBe('mkt-c');
      expect(results[2].profit_pct).toBeCloseTo(3.0);
    });

    it('skips markets where Gamma API fails to return token IDs', async () => {
      const svc = createMockTradingService({
        'yes-tok': 0.55,
        'no-tok': 0.40,
      });
      const detector = new ArbitrageDetector(svc, 0.02);

      mockGammaFetch({ 'cond-1': null }); // no token IDs

      const results = await detector.detectOpportunities([makeMarket()]);
      expect(results).toHaveLength(0);
    });

    it('skips markets where midpoint fetch fails', async () => {
      const svc = createMockTradingService({}); // no midpoints → throws
      const detector = new ArbitrageDetector(svc, 0.02);

      mockGammaFetch({ 'cond-1': ['yes-tok', 'no-tok'] });

      const results = await detector.detectOpportunities([makeMarket()]);
      expect(results).toHaveLength(0);
    });

    it('returns empty array for empty market list', async () => {
      const svc = createMockTradingService({});
      const detector = new ArbitrageDetector(svc);

      const results = await detector.detectOpportunities([]);
      expect(results).toHaveLength(0);
    });

    it('detects overpriced markets (sum > 1.0)', async () => {
      const svc = createMockTradingService({
        'yes-tok': 0.55,
        'no-tok': 0.50,
      });
      const detector = new ArbitrageDetector(svc, 0.02);

      mockGammaFetch({ 'cond-1': ['yes-tok', 'no-tok'] });

      const results = await detector.detectOpportunities([makeMarket()]);
      expect(results).toHaveLength(1);

      const opp = results[0];
      expect(opp.sum).toBeCloseTo(1.05);
      expect(opp.deviation).toBeCloseTo(0.05);
      expect(opp.profit_pct).toBeCloseTo(5.0);
    });
  });
});
