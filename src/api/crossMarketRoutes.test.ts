/**
 * Unit tests for crossMarketRoutes
 *
 * Covers: GET /arbitrage (success + error), GET /arbitrage/history
 * (default pagination, custom pagination, invalid params, DB error).
 *
 * Requirements: 6.3, 6.4
 */

import express from 'express';
import request from 'supertest';
import { createCrossMarketRoutes } from './crossMarketRoutes';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockDetector(overrides: Record<string, jest.Mock> = {}) {
  return {
    detectOpportunities: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createMockDb(rows: any[] = []) {
  const allFn = jest.fn().mockReturnValue(rows);
  const prepareFn = jest.fn().mockReturnValue({ all: allFn });
  return {
    prepare: prepareFn,
    _allFn: allFn,
    _prepareFn: prepareFn,
  };
}

function buildApp(detector: any, db: any) {
  const app = express();
  app.use('/', createCrossMarketRoutes(detector, db));
  return app;
}

// ---------------------------------------------------------------------------
// Sample DB row (snake_case, as returned by SQLite)
// ---------------------------------------------------------------------------

const sampleDbRow = {
  id: 1,
  platform_a: 'polymarket',
  platform_a_market_id: 'poly-001',
  platform_b: 'kalshi',
  platform_b_market_id: 'kalshi-001',
  question: 'Will BTC hit 100k?',
  direction: 'A_YES_B_NO',
  platform_a_yes_price: 0.62,
  platform_a_no_price: 0.38,
  platform_b_yes_price: 0.58,
  platform_b_no_price: 0.42,
  vwap_buy_price: 0.41,
  vwap_sell_price: 0.36,
  real_arbitrage_cost: 0.77,
  platform_a_fee: 0.02,
  platform_b_fee: 0.03,
  total_fees: 0.05,
  profit_pct: 23.38,
  arb_score: 82,
  liquidity_warning: 0,
  oracle_mismatch: 0,
  depth_status: 'sufficient',
  detected_at: 1700000000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('crossMarketRoutes', () => {
  // -----------------------------------------------------------------------
  // GET /arbitrage
  // -----------------------------------------------------------------------

  describe('GET /arbitrage', () => {
    it('calls detector.detectOpportunities() and returns JSON array', async () => {
      const opportunities = [
        { platformA: 'polymarket', profitPct: 10 },
        { platformA: 'kalshi', profitPct: 5 },
      ];
      const detector = createMockDetector({
        detectOpportunities: jest.fn().mockResolvedValue(opportunities),
      });
      const db = createMockDb();
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(opportunities);
      expect(detector.detectOpportunities).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on detector error', async () => {
      const detector = createMockDetector({
        detectOpportunities: jest.fn().mockRejectedValue(new Error('Detection failed')),
      });
      const db = createMockDb();
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: 'Internal server error',
        message: 'Detection failed',
      });
    });
  });

  // -----------------------------------------------------------------------
  // GET /arbitrage/history
  // -----------------------------------------------------------------------

  describe('GET /arbitrage/history', () => {
    it('returns records from DB with default pagination (limit=50, offset=0)', async () => {
      const detector = createMockDetector();
      const db = createMockDb([sampleDbRow]);
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage/history');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);

      // Verify snake_case → camelCase mapping
      const opp = res.body[0];
      expect(opp.id).toBe(1);
      expect(opp.platformA).toBe('polymarket');
      expect(opp.platformAMarketId).toBe('poly-001');
      expect(opp.platformB).toBe('kalshi');
      expect(opp.platformBMarketId).toBe('kalshi-001');
      expect(opp.question).toBe('Will BTC hit 100k?');
      expect(opp.direction).toBe('A_YES_B_NO');
      expect(opp.platformAYesPrice).toBe(0.62);
      expect(opp.platformANoPrice).toBe(0.38);
      expect(opp.platformBYesPrice).toBe(0.58);
      expect(opp.platformBNoPrice).toBe(0.42);
      expect(opp.vwapBuyPrice).toBe(0.41);
      expect(opp.vwapSellPrice).toBe(0.36);
      expect(opp.realArbitrageCost).toBe(0.77);
      expect(opp.platformAFee).toBe(0.02);
      expect(opp.platformBFee).toBe(0.03);
      expect(opp.totalFees).toBe(0.05);
      expect(opp.profitPct).toBe(23.38);
      expect(opp.arbScore).toBe(82);
      expect(opp.liquidityWarning).toBe(false);
      expect(opp.oracleMismatch).toBe(false);
      expect(opp.depthStatus).toBe('sufficient');
      expect(opp.detectedAt).toBe(1700000000);

      // Verify default pagination params passed to DB
      expect(db._prepareFn).toHaveBeenCalledWith(
        'SELECT * FROM cross_market_arbitrage ORDER BY detected_at DESC LIMIT ? OFFSET ?',
      );
      expect(db._allFn).toHaveBeenCalledWith(50, 0);
    });

    it('respects custom limit and offset params', async () => {
      const detector = createMockDetector();
      const db = createMockDb([]);
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage/history?limit=10&offset=20');

      expect(res.status).toBe(200);
      expect(db._allFn).toHaveBeenCalledWith(10, 20);
    });

    // --- Invalid limit ---

    it('returns 400 for negative limit', async () => {
      const detector = createMockDetector();
      const db = createMockDb();
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage/history?limit=-1');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid parameter');
    });

    it('returns 400 for non-integer limit', async () => {
      const detector = createMockDetector();
      const db = createMockDb();
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage/history?limit=3.5');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid parameter');
    });

    it('returns 400 for limit > 200', async () => {
      const detector = createMockDetector();
      const db = createMockDb();
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage/history?limit=201');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid parameter');
      expect(res.body.message).toContain('200');
    });

    // --- Invalid offset ---

    it('returns 400 for negative offset', async () => {
      const detector = createMockDetector();
      const db = createMockDb();
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage/history?offset=-5');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid parameter');
    });

    it('returns 400 for non-integer offset', async () => {
      const detector = createMockDetector();
      const db = createMockDb();
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage/history?offset=2.7');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid parameter');
    });

    // --- DB error ---

    it('returns 500 on DB error', async () => {
      const detector = createMockDetector();
      const allFn = jest.fn().mockImplementation(() => {
        throw new Error('DB connection lost');
      });
      const prepareFn = jest.fn().mockReturnValue({ all: allFn });
      const db = { prepare: prepareFn };
      const app = buildApp(detector, db);

      const res = await request(app).get('/arbitrage/history');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: 'Internal server error',
        message: 'DB connection lost',
      });
    });
  });
});
