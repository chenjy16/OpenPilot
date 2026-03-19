/**
 * polymarketRoutes — REST API routes for Polymarket trading operations.
 *
 * Factory function creates an Express Router with endpoints for:
 * - Trading status check
 * - Order placement and cancellation
 * - Position and trade history queries
 * - Order book queries (public)
 * - Arbitrage opportunity detection (public)
 *
 * Trading endpoints return 503 when POLYMARKET_PRIVATE_KEY is not configured.
 */

import { Router, Request, Response } from 'express';
import type { PolymarketTradingService } from '../services/polymarket/PolymarketTradingService';
import type { ArbitrageDetector } from '../services/polymarket/ArbitrageDetector';
import type { PolymarketScanner } from '../services/PolymarketScanner';

// ─── Helpers ───────────────────────────────────────────────────────────────

function errorResponse(
  res: Response,
  status: number,
  error: string,
  message: string,
): void {
  res.status(status).json({ error, message });
}

/**
 * Map service errors to appropriate HTTP status codes.
 */
function mapErrorStatus(err: Error): number {
  const msg = err.message ?? '';
  if (msg.includes('Validation error')) return 400;
  if (msg.includes('Trading not configured')) return 503;
  return 502;
}

/**
 * Middleware-style guard: returns true (and sends 503) when trading is not
 * configured. Callers should `return` immediately when this returns true.
 */
function requireConfigured(
  tradingService: PolymarketTradingService,
  res: Response,
): boolean {
  if (!tradingService.isConfigured()) {
    errorResponse(
      res,
      503,
      'Trading not configured',
      'POLYMARKET_PRIVATE_KEY not set',
    );
    return true; // blocked
  }
  return false; // ok
}

// ─── Route factory ─────────────────────────────────────────────────────────

export function createPolymarketTradingRoutes(
  tradingService: PolymarketTradingService,
  arbitrageDetector: ArbitrageDetector,
  scanner: PolymarketScanner,
): Router {
  const router = Router();

  // ── GET /trading-status — public, no auth check ──────────────────────

  router.get('/trading-status', (_req: Request, res: Response) => {
    try {
      res.json({ configured: tradingService.isConfigured() });
    } catch (err: any) {
      errorResponse(res, 500, 'Internal error', err.message);
    }
  });

  // ── POST /order — place an order ─────────────────────────────────────

  router.post('/order', async (req: Request, res: Response) => {
    try {
      if (requireConfigured(tradingService, res)) return;

      const { token_id, side, price, size } = req.body;

      // Basic presence validation
      if (!token_id || typeof token_id !== 'string') {
        return errorResponse(res, 400, 'Validation error', 'token_id is required and must be a string');
      }
      if (!side || (side !== 'BUY' && side !== 'SELL')) {
        return errorResponse(res, 400, 'Validation error', 'side is required and must be BUY or SELL');
      }
      if (price == null || typeof price !== 'number') {
        return errorResponse(res, 400, 'Validation error', 'price is required and must be a number');
      }
      if (size == null || typeof size !== 'number') {
        return errorResponse(res, 400, 'Validation error', 'size is required and must be a number');
      }

      const result = await tradingService.placeOrder({ token_id, side, price, size });
      res.json(result);
    } catch (err: any) {
      const status = mapErrorStatus(err);
      errorResponse(res, status, err.message, err.message);
    }
  });

  // ── DELETE /order/:orderId — cancel a specific order ─────────────────

  router.delete('/order/:orderId', async (req: Request, res: Response) => {
    try {
      if (requireConfigured(tradingService, res)) return;

      const orderId = req.params.orderId as string;
      await tradingService.cancelOrder(orderId);
      res.json({ success: true, order_id: orderId });
    } catch (err: any) {
      const status = mapErrorStatus(err);
      errorResponse(res, status, err.message, err.message);
    }
  });

  // ── DELETE /orders — cancel all orders ───────────────────────────────

  router.delete('/orders', async (_req: Request, res: Response) => {
    try {
      if (requireConfigured(tradingService, res)) return;

      const count = await tradingService.cancelAllOrders();
      res.json({ success: true, canceled: count });
    } catch (err: any) {
      const status = mapErrorStatus(err);
      errorResponse(res, status, err.message, err.message);
    }
  });

  // ── GET /positions — query user positions ────────────────────────────

  router.get('/positions', async (_req: Request, res: Response) => {
    try {
      if (requireConfigured(tradingService, res)) return;

      const positions = await tradingService.getPositions();
      res.json(positions);
    } catch (err: any) {
      const status = mapErrorStatus(err);
      errorResponse(res, status, err.message, err.message);
    }
  });

  // ── GET /trades — query trade history with pagination ────────────────

  router.get('/trades', async (req: Request, res: Response) => {
    try {
      if (requireConfigured(tradingService, res)) return;

      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;

      const trades = await tradingService.getTradeHistory(limit, offset);
      res.json(trades);
    } catch (err: any) {
      const status = mapErrorStatus(err);
      errorResponse(res, status, err.message, err.message);
    }
  });

  // ── GET /book/:tokenId — query order book (public) ───────────────────

  router.get('/book/:tokenId', async (req: Request, res: Response) => {
    try {
      const tokenId = req.params.tokenId as string;
      const book = await tradingService.getOrderBook(tokenId);
      res.json(book);
    } catch (err: any) {
      const status = mapErrorStatus(err);
      errorResponse(res, status, err.message, err.message);
    }
  });

  // ── GET /arbitrage — detect arbitrage opportunities (public) ─────────

  router.get('/arbitrage', async (_req: Request, res: Response) => {
    try {
      const markets = await scanner.fetchTrendingMarkets();
      const opportunities = await arbitrageDetector.detectOpportunities(markets);
      res.json(opportunities);
    } catch (err: any) {
      const status = mapErrorStatus(err);
      errorResponse(res, status, err.message, err.message);
    }
  });

  return router;
}
