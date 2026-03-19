/**
 * crossMarketRoutes — REST API routes for cross-market arbitrage operations.
 *
 * Factory function creates an Express Router with endpoints for:
 * - Current cross-market arbitrage opportunity detection
 * - Historical arbitrage records with pagination
 */

import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { CrossMarketArbitrageDetector } from '../services/crossmarket/CrossMarketArbitrageDetector';
import type { CrossMarketArbitrageOpportunity } from '../services/crossmarket/types';

// ─── Route factory ─────────────────────────────────────────────────────────

export function createCrossMarketRoutes(
  detector: CrossMarketArbitrageDetector,
  db: Database.Database,
): Router {
  const router = Router();

  // ── GET /arbitrage — detect current cross-market arbitrage opportunities ──

  router.get('/arbitrage', async (_req: Request, res: Response) => {
    try {
      const opportunities = await detector.detectOpportunities();
      res.json(opportunities);
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error', message: err.message });
    }
  });

  // ── GET /arbitrage/history — query historical records with pagination ─────

  router.get('/arbitrage/history', (req: Request, res: Response) => {
    try {
      const rawLimit = req.query.limit;
      const rawOffset = req.query.offset;

      let limit = 50;
      let offset = 0;

      if (rawLimit !== undefined) {
        limit = Number(rawLimit);
        if (!Number.isFinite(limit) || limit < 0 || limit !== Math.floor(limit)) {
          return res.status(400).json({ error: 'Invalid parameter', message: 'limit must be a non-negative integer' });
        }
        if (limit > 200) {
          return res.status(400).json({ error: 'Invalid parameter', message: 'limit must not exceed 200' });
        }
      }

      if (rawOffset !== undefined) {
        offset = Number(rawOffset);
        if (!Number.isFinite(offset) || offset < 0 || offset !== Math.floor(offset)) {
          return res.status(400).json({ error: 'Invalid parameter', message: 'offset must be a non-negative integer' });
        }
      }

      const rows = db
        .prepare('SELECT * FROM cross_market_arbitrage ORDER BY detected_at DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as any[];

      const opportunities: CrossMarketArbitrageOpportunity[] = rows.map((row) => ({
        id: row.id,
        platformA: row.platform_a,
        platformAMarketId: row.platform_a_market_id,
        platformB: row.platform_b,
        platformBMarketId: row.platform_b_market_id,
        question: row.question,
        direction: row.direction,
        platformAYesPrice: row.platform_a_yes_price,
        platformANoPrice: row.platform_a_no_price,
        platformBYesPrice: row.platform_b_yes_price,
        platformBNoPrice: row.platform_b_no_price,
        vwapBuyPrice: row.vwap_buy_price,
        vwapSellPrice: row.vwap_sell_price,
        realArbitrageCost: row.real_arbitrage_cost,
        platformAFee: row.platform_a_fee,
        platformBFee: row.platform_b_fee,
        totalFees: row.total_fees,
        profitPct: row.profit_pct,
        arbScore: row.arb_score,
        liquidityWarning: !!row.liquidity_warning,
        oracleMismatch: !!row.oracle_mismatch,
        depthStatus: row.depth_status,
        detectedAt: row.detected_at,
      }));

      res.json(opportunities);
    } catch (err: any) {
      res.status(500).json({ error: 'Internal server error', message: err.message });
    }
  });

  return router;
}
