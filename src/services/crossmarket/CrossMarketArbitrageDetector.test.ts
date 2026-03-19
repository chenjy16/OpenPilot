/**
 * Unit tests for CrossMarketArbitrageDetector
 *
 * Covers: end-to-end detection flow mock, DB batch write, insufficient_depth handling,
 * integer arithmetic precision, notification trigger, sort order.
 *
 * Requirements: 3.3, 3.10, 6.1
 */

import Database from 'better-sqlite3';
import { CrossMarketArbitrageDetector } from './CrossMarketArbitrageDetector';
import type {
  NormalizedMarket,
  MarketPair,
  CrossMarketOrderBook,
} from './types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFinFeedClient = {
  fetchAllMarkets: jest.fn(),
  getOrderBook: jest.fn(),
};

const mockSemanticMatcher = {
  findMatchingPairs: jest.fn(),
};

const mockNotificationService = {
  sendCrossMarketAlert: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const marketA: NormalizedMarket = {
  platform: 'polymarket',
  marketId: 'poly-001',
  question: 'Will BTC hit 100k by end of 2025?',
  yesPrice: 0.62,
  noPrice: 0.38,
  volume: 50000,
  liquidity: 20000,
  endDate: '2025-12-31T00:00:00Z',
  resolutionSource: 'CoinGecko price feed',
  active: true,
};

const marketB: NormalizedMarket = {
  platform: 'kalshi',
  marketId: 'kalshi-001',
  question: 'Bitcoin to reach $100,000 by December 2025?',
  yesPrice: 0.58,
  noPrice: 0.42,
  volume: 30000,
  liquidity: 15000,
  endDate: '2025-12-31T00:00:00Z',
  resolutionSource: 'CoinMarketCap closing price',
  active: true,
};

function makeOrderBook(
  platform: NormalizedMarket['platform'],
  marketId: string,
  asks: Array<{ price: number; size: number }>,
  spread = 0.02,
): CrossMarketOrderBook {
  return {
    platform,
    marketId,
    bids: [{ price: 0.50, size: 1000 }],
    asks,
    bestBid: 0.50,
    bestAsk: asks.length > 0 ? Math.min(...asks.map((a) => a.price)) : 0,
    spread,
    timestamp: Date.now(),
  };
}

function makePair(mA: NormalizedMarket, mB: NormalizedMarket): MarketPair {
  return {
    marketA: mA,
    marketB: mB,
    matchResult: {
      marketA: { platform: mA.platform, marketId: mA.marketId },
      marketB: { platform: mB.platform, marketId: mB.marketId },
      confidence: 'high',
      confidenceScore: 0.95,
      oracleMismatch: false,
      fromCache: false,
    },
  };
}

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_market_arbitrage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_a TEXT NOT NULL,
      platform_a_market_id TEXT NOT NULL,
      platform_b TEXT NOT NULL,
      platform_b_market_id TEXT NOT NULL,
      question TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('A_YES_B_NO', 'A_NO_B_YES')),
      platform_a_yes_price REAL NOT NULL,
      platform_a_no_price REAL,
      platform_b_yes_price REAL,
      platform_b_no_price REAL NOT NULL,
      vwap_buy_price REAL NOT NULL,
      vwap_sell_price REAL NOT NULL,
      real_arbitrage_cost REAL NOT NULL,
      platform_a_fee REAL NOT NULL,
      platform_b_fee REAL NOT NULL,
      total_fees REAL NOT NULL,
      profit_pct REAL NOT NULL,
      arb_score INTEGER NOT NULL,
      liquidity_warning INTEGER NOT NULL DEFAULT 0,
      oracle_mismatch INTEGER NOT NULL DEFAULT 0,
      depth_status TEXT NOT NULL DEFAULT 'sufficient',
      detected_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrossMarketArbitrageDetector', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createTestDb();
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    jest.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. End-to-end detection flow mock
  // -----------------------------------------------------------------------

  describe('end-to-end detection flow', () => {
    it('returns correct opportunities with expected fields', async () => {
      // Setup: fetchAllMarkets returns markets
      mockFinFeedClient.fetchAllMarkets.mockResolvedValue([marketA, marketB]);

      // Setup: findMatchingPairs returns one pair
      mockSemanticMatcher.findMatchingPairs.mockResolvedValue([
        makePair(marketA, marketB),
      ]);

      // Setup: getOrderBook returns order books with sufficient depth
      const bookA = makeOrderBook('polymarket', 'poly-001', [
        { price: 0.40, size: 600 },
        { price: 0.42, size: 400 },
      ]);
      const bookB = makeOrderBook('kalshi', 'kalshi-001', [
        { price: 0.35, size: 600 },
        { price: 0.38, size: 400 },
      ]);

      mockFinFeedClient.getOrderBook.mockImplementation(
        async (platform: string, _marketId: string) => {
          return platform === 'polymarket' ? bookA : bookB;
        },
      );

      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      const opportunities = await detector.detectOpportunities();

      expect(opportunities.length).toBeGreaterThanOrEqual(1);

      const opp = opportunities[0];
      // Verify all expected fields exist
      expect(opp).toHaveProperty('platformA');
      expect(opp).toHaveProperty('platformAMarketId');
      expect(opp).toHaveProperty('platformB');
      expect(opp).toHaveProperty('platformBMarketId');
      expect(opp).toHaveProperty('question');
      expect(opp).toHaveProperty('direction');
      expect(opp).toHaveProperty('platformAYesPrice');
      expect(opp).toHaveProperty('platformANoPrice');
      expect(opp).toHaveProperty('platformBYesPrice');
      expect(opp).toHaveProperty('platformBNoPrice');
      expect(opp).toHaveProperty('vwapBuyPrice');
      expect(opp).toHaveProperty('vwapSellPrice');
      expect(opp).toHaveProperty('realArbitrageCost');
      expect(opp).toHaveProperty('platformAFee');
      expect(opp).toHaveProperty('platformBFee');
      expect(opp).toHaveProperty('totalFees');
      expect(opp).toHaveProperty('profitPct');
      expect(opp).toHaveProperty('arbScore');
      expect(opp).toHaveProperty('liquidityWarning');
      expect(opp).toHaveProperty('oracleMismatch');
      expect(opp).toHaveProperty('depthStatus');
      expect(opp).toHaveProperty('detectedAt');

      // Verify correct values
      expect(opp.platformA).toBe('polymarket');
      expect(opp.platformB).toBe('kalshi');
      expect(opp.question).toBe(marketA.question);
      expect(['A_YES_B_NO', 'A_NO_B_YES']).toContain(opp.direction);
      expect(opp.depthStatus).toBe('sufficient');
      expect(typeof opp.profitPct).toBe('number');
      expect(typeof opp.arbScore).toBe('number');
      expect(typeof opp.detectedAt).toBe('number');

      // Verify mocks were called correctly
      expect(mockFinFeedClient.fetchAllMarkets).toHaveBeenCalledTimes(1);
      expect(mockSemanticMatcher.findMatchingPairs).toHaveBeenCalledTimes(1);
      expect(mockFinFeedClient.getOrderBook).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when no markets found', async () => {
      mockFinFeedClient.fetchAllMarkets.mockResolvedValue([]);

      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      const opportunities = await detector.detectOpportunities();
      expect(opportunities).toEqual([]);
      expect(mockSemanticMatcher.findMatchingPairs).not.toHaveBeenCalled();
    });

    it('returns empty array when no matching pairs found', async () => {
      mockFinFeedClient.fetchAllMarkets.mockResolvedValue([marketA, marketB]);
      mockSemanticMatcher.findMatchingPairs.mockResolvedValue([]);

      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      const opportunities = await detector.detectOpportunities();
      expect(opportunities).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 2. DB batch write
  // -----------------------------------------------------------------------

  describe('DB batch write', () => {
    it('writes opportunities to cross_market_arbitrage table after detectOpportunities', async () => {
      mockFinFeedClient.fetchAllMarkets.mockResolvedValue([marketA, marketB]);
      mockSemanticMatcher.findMatchingPairs.mockResolvedValue([
        makePair(marketA, marketB),
      ]);

      const bookA = makeOrderBook('polymarket', 'poly-001', [
        { price: 0.40, size: 600 },
      ]);
      const bookB = makeOrderBook('kalshi', 'kalshi-001', [
        { price: 0.35, size: 600 },
      ]);

      mockFinFeedClient.getOrderBook.mockImplementation(
        async (platform: string) =>
          platform === 'polymarket' ? bookA : bookB,
      );

      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      const opportunities = await detector.detectOpportunities();
      expect(opportunities.length).toBeGreaterThanOrEqual(1);

      // Verify DB rows
      const rows = db
        .prepare('SELECT * FROM cross_market_arbitrage')
        .all() as any[];
      expect(rows.length).toBe(opportunities.length);

      const row = rows[0];
      expect(row.platform_a).toBe('polymarket');
      expect(row.platform_a_market_id).toBe('poly-001');
      expect(row.platform_b).toBe('kalshi');
      expect(row.platform_b_market_id).toBe('kalshi-001');
      expect(row.question).toBe(marketA.question);
      expect(['A_YES_B_NO', 'A_NO_B_YES']).toContain(row.direction);
      expect(typeof row.profit_pct).toBe('number');
      expect(typeof row.arb_score).toBe('number');
      expect(row.depth_status).toBe('sufficient');
    });
  });

  // -----------------------------------------------------------------------
  // 3. insufficient_depth handling
  // -----------------------------------------------------------------------

  describe('insufficient_depth handling', () => {
    it('skips pair when order book depth is insufficient (calculateVWAP returns null)', async () => {
      mockFinFeedClient.fetchAllMarkets.mockResolvedValue([marketA, marketB]);
      mockSemanticMatcher.findMatchingPairs.mockResolvedValue([
        makePair(marketA, marketB),
      ]);

      // Order books with very small sizes — insufficient for default targetSize of 500
      const bookA = makeOrderBook('polymarket', 'poly-001', [
        { price: 0.40, size: 1 },
      ]);
      const bookB = makeOrderBook('kalshi', 'kalshi-001', [
        { price: 0.35, size: 1 },
      ]);

      mockFinFeedClient.getOrderBook.mockImplementation(
        async (platform: string) =>
          platform === 'polymarket' ? bookA : bookB,
      );

      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      const opportunities = await detector.detectOpportunities();

      // Pair should be skipped because VWAP returns null for insufficient depth
      expect(opportunities).toHaveLength(0);
    });

    it('calculateVWAP returns null when total depth < targetSize', () => {
      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      const asks = [
        { price: 0.50, size: 100 },
        { price: 0.55, size: 100 },
      ];

      // Total depth = 200, targetSize = 500 → null
      const result = detector.calculateVWAP(asks, 500);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 4. Integer arithmetic precision
  // -----------------------------------------------------------------------

  describe('integer arithmetic precision', () => {
    it('calculateVWAP with known values matches expected VWAP within tolerance', () => {
      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      // Known scenario: 3 ask levels, targetSize = 500
      // Level 1: price=0.40, size=200 → fill 200 @ 0.40 = cost 80
      // Level 2: price=0.45, size=200 → fill 200 @ 0.45 = cost 90
      // Level 3: price=0.50, size=200 → fill 100 @ 0.50 = cost 50
      // Total cost = 220, VWAP = 220/500 = 0.44
      const asks = [
        { price: 0.40, size: 200 },
        { price: 0.45, size: 200 },
        { price: 0.50, size: 200 },
      ];

      const result = detector.calculateVWAP(asks, 500);

      expect(result).not.toBeNull();
      expect(result!.filledSize).toBe(500);
      expect(result!.levelsUsed).toBe(3);

      // Expected VWAP = (200*0.40 + 200*0.45 + 100*0.50) / 500 = 220/500 = 0.44
      expect(Math.abs(result!.vwap - 0.44)).toBeLessThan(1e-4);
    });

    it('calculateVWAP with single level fills exactly', () => {
      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      const asks = [{ price: 0.60, size: 1000 }];
      const result = detector.calculateVWAP(asks, 500);

      expect(result).not.toBeNull();
      expect(result!.filledSize).toBe(500);
      expect(result!.levelsUsed).toBe(1);
      expect(Math.abs(result!.vwap - 0.60)).toBeLessThan(1e-4);
    });

    it('calculateVWAP sorts asks by price ascending', () => {
      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      // Unsorted asks — should still fill cheapest first
      const asks = [
        { price: 0.60, size: 300 },
        { price: 0.40, size: 300 },
        { price: 0.50, size: 300 },
      ];

      const result = detector.calculateVWAP(asks, 500);

      expect(result).not.toBeNull();
      // Should fill: 300@0.40 + 200@0.50 = 120+100 = 220, VWAP = 220/500 = 0.44
      expect(Math.abs(result!.vwap - 0.44)).toBeLessThan(1e-4);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Notification trigger
  // -----------------------------------------------------------------------

  describe('notification trigger', () => {
    it('calls sendCrossMarketAlert when profitPct >= 5 and arbScore >= 70', async () => {
      mockFinFeedClient.fetchAllMarkets.mockResolvedValue([marketA, marketB]);
      mockSemanticMatcher.findMatchingPairs.mockResolvedValue([
        makePair(marketA, marketB),
      ]);

      // Create order books that produce a high profit opportunity
      // Low cost = high profit: A_Yes VWAP ~0.30, B_No VWAP ~0.30
      // Cost = 0.60, Fees = 0.05, Profit = (1 - 0.60 - 0.05)/0.60 * 100 ≈ 58.3%
      const bookA = makeOrderBook('polymarket', 'poly-001', [
        { price: 0.30, size: 1000 },
      ]);
      const bookB = makeOrderBook('kalshi', 'kalshi-001', [
        { price: 0.30, size: 1000 },
      ]);

      mockFinFeedClient.getOrderBook.mockImplementation(
        async (platform: string) =>
          platform === 'polymarket' ? bookA : bookB,
      );
      mockNotificationService.sendCrossMarketAlert.mockResolvedValue(
        undefined,
      );

      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      const opportunities = await detector.detectOpportunities();
      expect(opportunities.length).toBeGreaterThanOrEqual(1);

      // With cost ~0.60 and fees 0.05, profitPct should be well above 5%
      // and arbScore should be high enough
      const opp = opportunities[0];
      expect(opp.profitPct).toBeGreaterThanOrEqual(5);

      // Notification should have been called
      expect(
        mockNotificationService.sendCrossMarketAlert,
      ).toHaveBeenCalled();
    });

    it('does NOT call sendCrossMarketAlert when profitPct < 5', async () => {
      mockFinFeedClient.fetchAllMarkets.mockResolvedValue([marketA, marketB]);
      mockSemanticMatcher.findMatchingPairs.mockResolvedValue([
        makePair(marketA, marketB),
      ]);

      // High cost = low/negative profit: A_Yes VWAP ~0.55, B_No VWAP ~0.55
      // Cost = 1.10, which is > 1.0, so profitPct will be negative
      const bookA = makeOrderBook('polymarket', 'poly-001', [
        { price: 0.55, size: 1000 },
      ]);
      const bookB = makeOrderBook('kalshi', 'kalshi-001', [
        { price: 0.55, size: 1000 },
      ]);

      mockFinFeedClient.getOrderBook.mockImplementation(
        async (platform: string) =>
          platform === 'polymarket' ? bookA : bookB,
      );

      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      await detector.detectOpportunities();

      // Notification should NOT have been called
      expect(
        mockNotificationService.sendCrossMarketAlert,
      ).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Sort order
  // -----------------------------------------------------------------------

  describe('sort order', () => {
    it('results are sorted by profitPct descending', async () => {
      const marketC: NormalizedMarket = {
        platform: 'myriad',
        marketId: 'myriad-001',
        question: 'Will ETH hit 10k?',
        yesPrice: 0.45,
        noPrice: 0.55,
        volume: 20000,
        liquidity: 10000,
        endDate: '2025-12-31T00:00:00Z',
        resolutionSource: 'CoinGecko',
        active: true,
      };

      const marketD: NormalizedMarket = {
        platform: 'kalshi',
        marketId: 'kalshi-002',
        question: 'Will ETH hit 10k by 2025?',
        yesPrice: 0.40,
        noPrice: 0.60,
        volume: 15000,
        liquidity: 8000,
        endDate: '2025-12-31T00:00:00Z',
        resolutionSource: 'CoinMarketCap',
        active: true,
      };

      mockFinFeedClient.fetchAllMarkets.mockResolvedValue([
        marketA,
        marketB,
        marketC,
        marketD,
      ]);

      // Two pairs with different profit levels
      mockSemanticMatcher.findMatchingPairs.mockResolvedValue([
        makePair(marketA, marketB),
        makePair(marketC, marketD),
      ]);

      // Pair 1 (A-B): higher cost → lower profit
      const bookA = makeOrderBook('polymarket', 'poly-001', [
        { price: 0.50, size: 1000 },
      ]);
      const bookB = makeOrderBook('kalshi', 'kalshi-001', [
        { price: 0.45, size: 1000 },
      ]);

      // Pair 2 (C-D): lower cost → higher profit
      const bookC = makeOrderBook('myriad', 'myriad-001', [
        { price: 0.30, size: 1000 },
      ]);
      const bookD = makeOrderBook('kalshi', 'kalshi-002', [
        { price: 0.30, size: 1000 },
      ]);

      mockFinFeedClient.getOrderBook.mockImplementation(
        async (platform: string, marketId: string) => {
          if (platform === 'polymarket' && marketId === 'poly-001')
            return bookA;
          if (platform === 'kalshi' && marketId === 'kalshi-001') return bookB;
          if (platform === 'myriad' && marketId === 'myriad-001') return bookC;
          if (platform === 'kalshi' && marketId === 'kalshi-002') return bookD;
          throw new Error(`Unexpected getOrderBook call: ${platform}/${marketId}`);
        },
      );

      const detector = new CrossMarketArbitrageDetector(
        db,
        mockFinFeedClient as any,
        mockSemanticMatcher as any,
        mockNotificationService as any,
      );

      const opportunities = await detector.detectOpportunities();

      expect(opportunities.length).toBe(2);

      // Verify descending sort by profitPct
      for (let i = 0; i < opportunities.length - 1; i++) {
        expect(opportunities[i].profitPct).toBeGreaterThanOrEqual(
          opportunities[i + 1].profitPct,
        );
      }

      // Pair C-D (lower cost) should have higher profitPct and come first
      expect(opportunities[0].platformA).toBe('myriad');
      expect(opportunities[1].platformA).toBe('polymarket');
    });
  });
});
