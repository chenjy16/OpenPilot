/**
 * Property-Based Tests for PaperTradingEngine
 *
 * Feature: quant-trading-broker-integration
 * Properties 3, 11, 12
 */

import Database from 'better-sqlite3';
import * as fc from 'fast-check';
import { PaperTradingEngine } from './PaperTradingEngine';
import { initTradingTables } from './tradingSchema';
import type { TradingOrder } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_CAPITAL = 10_000_000;
const COMMISSION_RATE = 0.001;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)');
  initTradingTables(db);
  return db;
}

let orderCounter = 0;

function makeOrder(overrides?: Partial<TradingOrder>): TradingOrder {
  orderCounter++;
  return {
    id: orderCounter,
    local_order_id: `prop-${orderCounter}-${Date.now()}`,
    symbol: '600519.SH',
    side: 'buy',
    order_type: 'market',
    quantity: 100,
    price: undefined,
    status: 'pending',
    trading_mode: 'paper',
    filled_quantity: 0,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbSymbol = fc.constantFrom('AAPL', 'GOOG', 'TSLA', 'MSFT', 'AMZN');

/** A single buy trade: symbol, quantity (small), price (small) */
const arbBuyTrade = fc.record({
  symbol: arbSymbol,
  quantity: fc.integer({ min: 1, max: 100 }),
  price: fc.double({ min: 1, max: 100, noNaN: true }),
});

// ---------------------------------------------------------------------------
// Property 3: 模拟账户资金守恒
// ---------------------------------------------------------------------------

describe('PaperTradingEngine Property Tests', () => {
  beforeEach(() => {
    orderCounter = 0;
  });

  /**
   * Feature: quant-trading-broker-integration, Property 3: 模拟账户资金守恒
   * Validates: Requirements 4.4, 4.5, 4.6, 4.7
   *
   * For any sequence of buy trades:
   * - initial_capital = available_cash + sum(position.quantity * position.avg_cost) + accumulated_commission
   * - Each buy reduces available_cash
   * - Insufficient funds rejection leaves account state unchanged
   */
  describe('Property 3: Paper account capital conservation', () => {
    it('capital conservation holds across random buy trade sequences', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbBuyTrade, { minLength: 1, maxLength: 10 }),
          async (trades) => {
            const db = createTestDb();
            try {
              const engine = new PaperTradingEngine(db, {
                initial_capital: INITIAL_CAPITAL,
                commission_rate: COMMISSION_RATE,
              });

              let accumulatedCommission = 0;
              let prevCash = engine.getAccount().available_cash;

              for (const trade of trades) {
                const order = makeOrder({
                  symbol: trade.symbol,
                  side: 'buy',
                  order_type: 'market',
                  quantity: trade.quantity,
                });

                const cashBefore = engine.getAccount().available_cash;
                const positionsBefore = engine.getPositions();

                const result = await engine.submitOrder(order, trade.price);

                if (result.status === 'rejected') {
                  // Insufficient funds — account state must be unchanged
                  const cashAfter = engine.getAccount().available_cash;
                  const positionsAfter = engine.getPositions();
                  expect(cashAfter).toBe(cashBefore);
                  expect(positionsAfter.length).toBe(positionsBefore.length);
                  for (const pAfter of positionsAfter) {
                    const pBefore = positionsBefore.find((p) => p.symbol === pAfter.symbol);
                    expect(pBefore).toBeDefined();
                    expect(pAfter.quantity).toBe(pBefore!.quantity);
                    expect(pAfter.avg_cost).toBeCloseTo(pBefore!.avg_cost);
                  }
                } else {
                  // Successful buy — cash should decrease
                  const cashAfter = engine.getAccount().available_cash;
                  expect(cashAfter).toBeLessThan(prevCash);
                  prevCash = cashAfter;

                  const totalCost = trade.quantity * trade.price;
                  const commission = totalCost * COMMISSION_RATE;
                  accumulatedCommission += commission;
                }
              }

              // Verify conservation equation:
              // initial_capital = available_cash + sum(position.quantity * position.avg_cost) + accumulated_commission
              const account = engine.getAccount();
              const positions = engine.getPositions();
              const positionsCost = positions.reduce(
                (sum, p) => sum + p.quantity * p.avg_cost,
                0,
              );

              expect(account.available_cash + positionsCost + accumulatedCommission).toBeCloseTo(
                INITIAL_CAPITAL,
                2,
              );
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 11: 市价单立即成交
  // -------------------------------------------------------------------------

  /**
   * Feature: quant-trading-broker-integration, Property 11: 市价单立即成交
   * Validates: Requirements 4.2
   *
   * For any market order with a random current price, after submission:
   * - result has filled_quantity = order.quantity
   * - result has filled_price = currentPrice
   */
  describe('Property 11: Market orders fill immediately', () => {
    it('market buy orders fill at current price with full quantity', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbSymbol,
          fc.integer({ min: 1, max: 50 }),
          fc.double({ min: 1, max: 100, noNaN: true }),
          async (symbol, quantity, currentPrice) => {
            const db = createTestDb();
            try {
              const engine = new PaperTradingEngine(db, {
                initial_capital: INITIAL_CAPITAL,
                commission_rate: COMMISSION_RATE,
              });

              const order = makeOrder({
                symbol,
                side: 'buy',
                order_type: 'market',
                quantity,
              });

              const result = await engine.submitOrder(order, currentPrice);

              // With 10M capital and small quantities/prices, should always fill
              expect(result.filled_quantity).toBe(quantity);
              expect(result.filled_price).toBe(currentPrice);
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('market sell orders fill at current price with full quantity', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbSymbol,
          fc.integer({ min: 1, max: 50 }),
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.double({ min: 1, max: 100, noNaN: true }),
          async (symbol, quantity, buyPrice, sellPrice) => {
            const db = createTestDb();
            try {
              const engine = new PaperTradingEngine(db, {
                initial_capital: INITIAL_CAPITAL,
                commission_rate: COMMISSION_RATE,
              });

              // Buy first to have a position
              const buyOrder = makeOrder({
                symbol,
                side: 'buy',
                order_type: 'market',
                quantity,
              });
              await engine.submitOrder(buyOrder, buyPrice);

              // Now sell
              const sellOrder = makeOrder({
                symbol,
                side: 'sell',
                order_type: 'market',
                quantity,
              });
              const result = await engine.submitOrder(sellOrder, sellPrice);

              expect(result.filled_quantity).toBe(quantity);
              expect(result.filled_price).toBe(sellPrice);
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 12: 限价单条件成交
  // -------------------------------------------------------------------------

  /**
   * Feature: quant-trading-broker-integration, Property 12: 限价单条件成交
   * Validates: Requirements 4.3
   *
   * For buy limit orders:
   *   - if currentPrice <= limitPrice → should fill
   *   - if currentPrice > limitPrice → should NOT fill
   * For sell limit orders:
   *   - if currentPrice >= limitPrice → should fill
   *   - if currentPrice < limitPrice → should NOT fill
   */
  describe('Property 12: Limit order conditional fill', () => {
    it('buy limit orders fill when currentPrice <= limitPrice', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbSymbol,
          fc.integer({ min: 1, max: 50 }),
          fc.double({ min: 2, max: 100, noNaN: true }),
          async (symbol, quantity, limitPrice) => {
            const db = createTestDb();
            try {
              const engine = new PaperTradingEngine(db, {
                initial_capital: INITIAL_CAPITAL,
                commission_rate: COMMISSION_RATE,
              });

              // currentPrice <= limitPrice → should fill
              const currentPrice = limitPrice * 0.5; // always <= limitPrice
              const order = makeOrder({
                symbol,
                side: 'buy',
                order_type: 'limit',
                quantity,
                price: limitPrice,
              });

              const result = await engine.submitOrder(order, currentPrice);
              expect(result.filled_quantity).toBe(quantity);
              expect(result.filled_price).toBe(currentPrice);
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('buy limit orders do NOT fill when currentPrice > limitPrice', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbSymbol,
          fc.integer({ min: 1, max: 50 }),
          fc.double({ min: 1, max: 99, noNaN: true }),
          async (symbol, quantity, limitPrice) => {
            const db = createTestDb();
            try {
              const engine = new PaperTradingEngine(db, {
                initial_capital: INITIAL_CAPITAL,
                commission_rate: COMMISSION_RATE,
              });

              // currentPrice > limitPrice → should NOT fill
              const currentPrice = limitPrice + 1; // always > limitPrice
              const order = makeOrder({
                symbol,
                side: 'buy',
                order_type: 'limit',
                quantity,
                price: limitPrice,
              });

              const result = await engine.submitOrder(order, currentPrice);
              expect(result.filled_quantity).toBeUndefined();
              expect(result.filled_price).toBeUndefined();
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('sell limit orders fill when currentPrice >= limitPrice', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbSymbol,
          fc.integer({ min: 1, max: 50 }),
          fc.double({ min: 1, max: 50, noNaN: true }),
          async (symbol, quantity, limitPrice) => {
            const db = createTestDb();
            try {
              const engine = new PaperTradingEngine(db, {
                initial_capital: INITIAL_CAPITAL,
                commission_rate: COMMISSION_RATE,
              });

              // Buy shares first so we can sell
              const buyOrder = makeOrder({
                symbol,
                side: 'buy',
                order_type: 'market',
                quantity,
              });
              await engine.submitOrder(buyOrder, 200);

              // currentPrice >= limitPrice → should fill
              const currentPrice = limitPrice + 10; // always >= limitPrice
              const sellOrder = makeOrder({
                symbol,
                side: 'sell',
                order_type: 'limit',
                quantity,
                price: limitPrice,
              });

              const result = await engine.submitOrder(sellOrder, currentPrice);
              expect(result.filled_quantity).toBe(quantity);
              expect(result.filled_price).toBe(currentPrice);
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('sell limit orders do NOT fill when currentPrice < limitPrice', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbSymbol,
          fc.integer({ min: 1, max: 50 }),
          fc.double({ min: 2, max: 100, noNaN: true }),
          async (symbol, quantity, limitPrice) => {
            const db = createTestDb();
            try {
              const engine = new PaperTradingEngine(db, {
                initial_capital: INITIAL_CAPITAL,
                commission_rate: COMMISSION_RATE,
              });

              // Buy shares first so we can sell
              const buyOrder = makeOrder({
                symbol,
                side: 'buy',
                order_type: 'market',
                quantity,
              });
              await engine.submitOrder(buyOrder, 200);

              // currentPrice < limitPrice → should NOT fill
              const currentPrice = limitPrice - 1; // always < limitPrice
              const sellOrder = makeOrder({
                symbol,
                side: 'sell',
                order_type: 'limit',
                quantity,
                price: limitPrice,
              });

              const result = await engine.submitOrder(sellOrder, currentPrice);
              expect(result.filled_quantity).toBeUndefined();
              expect(result.filled_price).toBeUndefined();
            } finally {
              db.close();
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
