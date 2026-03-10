/**
 * Property-Based Tests for Trading API Routes
 *
 * Feature: quant-trading-broker-integration, Property 6: API 输入验证健壮性
 * Validates: Requirements 7.10
 *
 * For any invalid input (negative quantity, zero price, invalid symbol,
 * missing required fields, extra-long strings), all trading API endpoints
 * should return HTTP 400 with { error, message } — never 500 or silent acceptance.
 */

import express from 'express';
import request from 'supertest';
import * as fc from 'fast-check';
import { createTradingRoutes } from './tradingRoutes';
import type { TradingGateway } from '../services/trading/TradingGateway';
import type { RiskController } from '../services/trading/RiskController';
import type { OrderManager } from '../services/trading/OrderManager';

// ---------------------------------------------------------------------------
// Mock dependencies — validation should reject before reaching these
// ---------------------------------------------------------------------------

const mockGateway = {
  placeOrder: jest.fn().mockRejectedValue(new Error('Should not be called for invalid input')),
  listOrders: jest.fn().mockReturnValue([]),
  getOrder: jest.fn().mockReturnValue(null),
  cancelOrder: jest.fn().mockRejectedValue(new Error('Should not be called')),
  getAccount: jest.fn().mockResolvedValue({}),
  getPositions: jest.fn().mockResolvedValue([]),
  getConfig: jest.fn().mockReturnValue({}),
  updateConfig: jest.fn(),
} as unknown as TradingGateway;

const mockRiskController = {
  listRules: jest.fn().mockReturnValue([]),
  updateRule: jest.fn(),
  toggleRule: jest.fn(),
} as unknown as RiskController;

const mockOrderManager = {
  getStats: jest.fn().mockReturnValue({ total_orders: 0, filled_orders: 0, cancelled_orders: 0, total_filled_amount: 0 }),
} as unknown as OrderManager;

// ---------------------------------------------------------------------------
// Express app setup
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use('/api/trading', createTradingRoutes(mockGateway, mockRiskController, mockOrderManager));

// ---------------------------------------------------------------------------
// Assertion helper
// ---------------------------------------------------------------------------

function assert400WithErrorMessage(res: request.Response): void {
  expect(res.status).toBe(400);
  expect(res.body).toHaveProperty('error');
  expect(res.body).toHaveProperty('message');
  expect(typeof res.body.error).toBe('string');
  expect(typeof res.body.message).toBe('string');
}

// ---------------------------------------------------------------------------
// Property 6: API 输入验证健壮性
// ---------------------------------------------------------------------------

describe('Trading API Property Tests', () => {
  /**
   * Feature: quant-trading-broker-integration, Property 6: API 输入验证健壮性
   * **Validates: Requirements 7.10**
   */
  describe('Property 6: API input validation robustness', () => {
    // -----------------------------------------------------------------------
    // POST /api/trading/orders — invalid inputs
    // -----------------------------------------------------------------------

    describe('POST /api/trading/orders', () => {
      it('rejects missing symbol', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom('buy', 'sell'),
            fc.constantFrom('market', 'limit'),
            fc.double({ min: 1, max: 1000, noNaN: true }),
            async (side, order_type, quantity) => {
              const res = await request(app)
                .post('/api/trading/orders')
                .send({ side, order_type, quantity });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects empty symbol', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom('', '   ', '\t'),
            async (symbol) => {
              const res = await request(app)
                .post('/api/trading/orders')
                .send({ symbol, side: 'buy', order_type: 'market', quantity: 100 });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects invalid side', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => s !== 'buy' && s !== 'sell'),
            async (side) => {
              const res = await request(app)
                .post('/api/trading/orders')
                .send({ symbol: 'AAPL', side, order_type: 'market', quantity: 100 });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects invalid order_type', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 20 }).filter(
              s => !['market', 'limit', 'stop', 'stop_limit'].includes(s),
            ),
            async (order_type) => {
              const res = await request(app)
                .post('/api/trading/orders')
                .send({ symbol: 'AAPL', side: 'buy', order_type, quantity: 100 });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects negative quantity', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.double({ min: -1e9, max: -0.01, noNaN: true }),
            async (quantity) => {
              const res = await request(app)
                .post('/api/trading/orders')
                .send({ symbol: 'AAPL', side: 'buy', order_type: 'market', quantity });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects zero quantity', async () => {
        const res = await request(app)
          .post('/api/trading/orders')
          .send({ symbol: 'AAPL', side: 'buy', order_type: 'market', quantity: 0 });
        assert400WithErrorMessage(res);
      });

      it('rejects non-number quantity', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom('abc', true, null, {}, []),
            async (quantity) => {
              const res = await request(app)
                .post('/api/trading/orders')
                .send({ symbol: 'AAPL', side: 'buy', order_type: 'market', quantity });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects missing quantity', async () => {
        const res = await request(app)
          .post('/api/trading/orders')
          .send({ symbol: 'AAPL', side: 'buy', order_type: 'market' });
        assert400WithErrorMessage(res);
      });

      it('rejects negative price', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.double({ min: -1e9, max: -0.01, noNaN: true }),
            async (price) => {
              const res = await request(app)
                .post('/api/trading/orders')
                .send({ symbol: 'AAPL', side: 'buy', order_type: 'limit', quantity: 100, price });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects zero price', async () => {
        const res = await request(app)
          .post('/api/trading/orders')
          .send({ symbol: 'AAPL', side: 'buy', order_type: 'limit', quantity: 100, price: 0 });
        assert400WithErrorMessage(res);
      });

      it('rejects limit order without price', async () => {
        const res = await request(app)
          .post('/api/trading/orders')
          .send({ symbol: 'AAPL', side: 'buy', order_type: 'limit', quantity: 100 });
        assert400WithErrorMessage(res);
      });

      it('rejects non-integer strategy_id', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.double({ min: 0.01, max: 100, noNaN: true }).filter(n => !Number.isInteger(n)),
            async (strategy_id) => {
              const res = await request(app)
                .post('/api/trading/orders')
                .send({ symbol: 'AAPL', side: 'buy', order_type: 'market', quantity: 100, strategy_id });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects non-integer signal_id', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.double({ min: 0.01, max: 100, noNaN: true }).filter(n => !Number.isInteger(n)),
            async (signal_id) => {
              const res = await request(app)
                .post('/api/trading/orders')
                .send({ symbol: 'AAPL', side: 'buy', order_type: 'market', quantity: 100, signal_id });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });
    });

    // -----------------------------------------------------------------------
    // GET /api/trading/orders — invalid filters
    // -----------------------------------------------------------------------

    describe('GET /api/trading/orders', () => {
      it('rejects invalid status value', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 20 }).filter(
              s => !['pending', 'submitted', 'partial_filled', 'filled', 'cancelled', 'rejected', 'failed'].includes(s),
            ),
            async (status) => {
              const res = await request(app)
                .get('/api/trading/orders')
                .query({ status });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects non-numeric start_date', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => isNaN(Number(s))),
            async (start_date) => {
              const res = await request(app)
                .get('/api/trading/orders')
                .query({ start_date });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects non-numeric end_date', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => isNaN(Number(s))),
            async (end_date) => {
              const res = await request(app)
                .get('/api/trading/orders')
                .query({ end_date });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });
    });

    // -----------------------------------------------------------------------
    // GET /api/trading/orders/:id — invalid ID
    // -----------------------------------------------------------------------

    describe('GET /api/trading/orders/:id', () => {
      it('rejects non-numeric ID', async () => {
        await fc.assert(
          fc.asyncProperty(
            // Avoid URL-special chars (#, ?, /) that would alter routing before reaching the handler
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,19}$/).filter(s => isNaN(Number(s))),
            async (id) => {
              const res = await request(app)
                .get(`/api/trading/orders/${id}`);
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects negative ID', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: -1000, max: -1 }),
            async (id) => {
              const res = await request(app)
                .get(`/api/trading/orders/${id}`);
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects zero ID', async () => {
        const res = await request(app)
          .get('/api/trading/orders/0');
        assert400WithErrorMessage(res);
      });
    });

    // -----------------------------------------------------------------------
    // PUT /api/trading/config — invalid values
    // -----------------------------------------------------------------------

    describe('PUT /api/trading/config', () => {
      it('rejects invalid trading_mode', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => s !== 'paper' && s !== 'live'),
            async (trading_mode) => {
              const res = await request(app)
                .put('/api/trading/config')
                .send({ trading_mode });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('rejects non-boolean auto_trade_enabled', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom('true', 'false', 1, 0, 'yes', 'no', null),
            async (auto_trade_enabled) => {
              const res = await request(app)
                .put('/api/trading/config')
                .send({ auto_trade_enabled });
              assert400WithErrorMessage(res);
            },
          ),
          { numRuns: 10 },
        );
      });
    });
  });
});
