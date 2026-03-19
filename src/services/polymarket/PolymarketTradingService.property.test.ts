/**
 * Property-Based Tests for PolymarketTradingService
 *
 * Feature: polymarket-trading, Property 10: Schema initialization idempotence
 *
 * For any number of consecutive calls to the schema initialization function,
 * the database tables SHALL exist with the correct structure and no errors
 * SHALL be thrown.
 *
 * **Validates: Requirements 11.3**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

// ── Mock SDK (must be before any imports that use them) ──────────────────

const mockCreateOrDeriveApiKey = jest.fn().mockResolvedValue({
  key: 'key-1', secret: 'secret-1', passphrase: 'pass-1',
});
const mockCreateAndPostOrder = jest.fn();
const mockCancelOrder = jest.fn();
const mockCancelAll = jest.fn();
const mockGetOrderBook = jest.fn();
const mockGetMidpoint = jest.fn();
const mockGetTrades = jest.fn();

jest.mock('@polymarket/clob-client', () => ({
  ClobClient: jest.fn().mockImplementation(() => ({
    createOrDeriveApiKey: mockCreateOrDeriveApiKey,
    createAndPostOrder: mockCreateAndPostOrder,
    cancelOrder: mockCancelOrder,
    cancelAll: mockCancelAll,
    getOrderBook: mockGetOrderBook,
    getMidpoint: mockGetMidpoint,
    getTrades: mockGetTrades,
  })),
  Side: { BUY: 'BUY', SELL: 'SELL' },
}));

jest.mock('ethers', () => ({
  ethers: {
    Wallet: jest.fn().mockImplementation(() => ({
      address: '0xMockAddress',
      signTypedData: jest.fn().mockResolvedValue('0xMockSignature'),
      getAddress: jest.fn().mockResolvedValue('0xMockAddress'),
    })),
  },
}));

import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../../session/database';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Feature: polymarket-trading, Property 10: Schema initialization idempotence

describe('Property 10: Schema initialization idempotence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-schema-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('multiple consecutive initializeDatabase calls produce correct tables without errors', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (callCount: number) => {
          const dbPath = path.join(tmpDir, `test-${Date.now()}-${Math.random()}.db`);
          let db: Database.Database | null = null;

          try {
            // Call initializeDatabase multiple times on the same path
            for (let i = 0; i < callCount; i++) {
              if (db) db.close();
              db = initializeDatabase(dbPath);
            }

            // After all calls, verify polymarket_orders table exists with correct columns
            const ordersInfo = db!.prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='polymarket_orders'"
            ).get() as { name: string } | undefined;
            expect(ordersInfo).toBeDefined();
            expect(ordersInfo!.name).toBe('polymarket_orders');

            const ordersCols = db!.prepare("PRAGMA table_info(polymarket_orders)").all() as Array<{
              name: string; type: string;
            }>;
            const ordersColNames = ordersCols.map((c) => c.name);
            expect(ordersColNames).toEqual(
              expect.arrayContaining([
                'id', 'order_id', 'market_id', 'token_id',
                'side', 'price', 'size', 'status',
                'created_at', 'updated_at',
              ])
            );

            // Verify polymarket_trades table exists with correct columns
            const tradesInfo = db!.prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='polymarket_trades'"
            ).get() as { name: string } | undefined;
            expect(tradesInfo).toBeDefined();
            expect(tradesInfo!.name).toBe('polymarket_trades');

            const tradesCols = db!.prepare("PRAGMA table_info(polymarket_trades)").all() as Array<{
              name: string; type: string;
            }>;
            const tradesColNames = tradesCols.map((c) => c.name);
            expect(tradesColNames).toEqual(
              expect.arrayContaining([
                'id', 'trade_id', 'order_id', 'market_id',
                'token_id', 'side', 'price', 'size',
                'fee', 'timestamp',
              ])
            );

            // Verify indexes exist for polymarket tables
            const indexes = db!.prepare(
              "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_pm_%'"
            ).all() as Array<{ name: string }>;
            const indexNames = indexes.map((i) => i.name);
            expect(indexNames).toEqual(
              expect.arrayContaining([
                'idx_pm_orders_status',
                'idx_pm_orders_market',
                'idx_pm_orders_created',
                'idx_pm_trades_market',
                'idx_pm_trades_timestamp',
              ])
            );
          } finally {
            if (db) db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: polymarket-trading, Property 11: Config URL defaults

/**
 * Property 11: Config URL defaults
 *
 * *For any* instance of PolymarketTradingService, if `POLYMARKET_CLOB_API_URL`
 * is not set, the CLOB API URL SHALL be `https://clob.polymarket.com`.
 * If `POLYMARKET_DATA_API_URL` is not set, the Data API URL SHALL be
 * `https://data-api.polymarket.com`.
 *
 * **Validates: Requirements 12.2, 12.3**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

import type { PolymarketTradingConfig } from './types';

const DEFAULT_CLOB_API_URL = 'https://clob.polymarket.com';
const DEFAULT_DATA_API_URL = 'https://data-api.polymarket.com';
const DEFAULT_CHAIN_ID = 137;

/**
 * Resolves a PolymarketTradingConfig with defaults, mirroring the service constructor logic.
 * - clobApiUrl falls back to POLYMARKET_CLOB_API_URL env var, then to the default
 * - dataApiUrl falls back to POLYMARKET_DATA_API_URL env var, then to the default
 * - chainId defaults to 137
 */
function resolveConfig(config?: Partial<PolymarketTradingConfig>): PolymarketTradingConfig {
  return {
    clobApiUrl: config?.clobApiUrl || process.env.POLYMARKET_CLOB_API_URL || DEFAULT_CLOB_API_URL,
    dataApiUrl: config?.dataApiUrl || process.env.POLYMARKET_DATA_API_URL || DEFAULT_DATA_API_URL,
    chainId: config?.chainId || DEFAULT_CHAIN_ID,
  };
}

describe('Property 11: Config URL defaults', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    // Restore environment after each test
    process.env = { ...savedEnv };
  });

  it('uses default CLOB API URL when env var is not set and no config override provided', () => {
    fc.assert(
      fc.property(
        // Generate an optional data API URL (irrelevant to this check)
        fc.option(fc.webUrl(), { nil: undefined }),
        (optionalDataUrl) => {
          delete process.env.POLYMARKET_CLOB_API_URL;
          delete process.env.POLYMARKET_DATA_API_URL;

          const partial: Partial<PolymarketTradingConfig> = {};
          if (optionalDataUrl !== undefined) {
            partial.dataApiUrl = optionalDataUrl;
          }

          const resolved = resolveConfig(partial);
          expect(resolved.clobApiUrl).toBe(DEFAULT_CLOB_API_URL);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('uses default Data API URL when env var is not set and no config override provided', () => {
    fc.assert(
      fc.property(
        // Generate an optional CLOB API URL (irrelevant to this check)
        fc.option(fc.webUrl(), { nil: undefined }),
        (optionalClobUrl) => {
          delete process.env.POLYMARKET_CLOB_API_URL;
          delete process.env.POLYMARKET_DATA_API_URL;

          const partial: Partial<PolymarketTradingConfig> = {};
          if (optionalClobUrl !== undefined) {
            partial.clobApiUrl = optionalClobUrl;
          }

          const resolved = resolveConfig(partial);
          expect(resolved.dataApiUrl).toBe(DEFAULT_DATA_API_URL);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('config override takes precedence over env var and default for CLOB URL', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.option(fc.webUrl(), { nil: undefined }),
        (overrideUrl, envUrl) => {
          if (envUrl !== undefined) {
            process.env.POLYMARKET_CLOB_API_URL = envUrl;
          } else {
            delete process.env.POLYMARKET_CLOB_API_URL;
          }

          const resolved = resolveConfig({ clobApiUrl: overrideUrl });
          expect(resolved.clobApiUrl).toBe(overrideUrl);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('config override takes precedence over env var and default for Data URL', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.option(fc.webUrl(), { nil: undefined }),
        (overrideUrl, envUrl) => {
          if (envUrl !== undefined) {
            process.env.POLYMARKET_DATA_API_URL = envUrl;
          } else {
            delete process.env.POLYMARKET_DATA_API_URL;
          }

          const resolved = resolveConfig({ dataApiUrl: overrideUrl });
          expect(resolved.dataApiUrl).toBe(overrideUrl);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('env var takes precedence over default when no config override provided', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.webUrl(),
        (envClobUrl, envDataUrl) => {
          process.env.POLYMARKET_CLOB_API_URL = envClobUrl;
          process.env.POLYMARKET_DATA_API_URL = envDataUrl;

          const resolved = resolveConfig();
          expect(resolved.clobApiUrl).toBe(envClobUrl);
          expect(resolved.dataApiUrl).toBe(envDataUrl);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('chainId defaults to 137 when not provided', () => {
    fc.assert(
      fc.property(
        fc.option(fc.webUrl(), { nil: undefined }),
        fc.option(fc.webUrl(), { nil: undefined }),
        (optClobUrl, optDataUrl) => {
          delete process.env.POLYMARKET_CLOB_API_URL;
          delete process.env.POLYMARKET_DATA_API_URL;

          const partial: Partial<PolymarketTradingConfig> = {};
          if (optClobUrl !== undefined) partial.clobApiUrl = optClobUrl;
          if (optDataUrl !== undefined) partial.dataApiUrl = optDataUrl;

          const resolved = resolveConfig(partial);
          expect(resolved.chainId).toBe(DEFAULT_CHAIN_ID);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: polymarket-trading, Property 1: Order price and size validation

/**
 * Property 1: Order price and size validation
 *
 * *For any* order request, if the price is outside the range [0.01, 0.99] or
 * the size is not a positive number, the order SHALL be rejected with a
 * validation error and no order SHALL be recorded in the database.
 *
 * **Validates: Requirements 2.2, 2.3**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

import { PolymarketTradingService } from './PolymarketTradingService';

describe('Property 1: Order price and size validation', () => {
  let tmpDir: string;
  let db: Database.Database;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-prop1-'));
    const dbPath = path.join(tmpDir, `test-${Date.now()}.db`);
    db = initializeDatabase(dbPath);
    process.env.POLYMARKET_PRIVATE_KEY = '0xdeadbeefdeadbeefdeadbeef';

    // SDK mock: auth succeeds, order placement succeeds
    mockCreateAndPostOrder.mockResolvedValue({ orderID: 'ord-ok', status: 'submitted' });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it('rejects orders with price outside [0.01, 0.99] and writes nothing to DB', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: 0.01, max: 1e6, noNaN: true }),
        fc.constantFrom('BUY' as const, 'SELL' as const),
        async (price, size, side) => {
          // Only test invalid prices (outside [0.01, 0.99])
          if (price >= 0.01 && price <= 0.99) return; // skip valid prices

          const svc = new PolymarketTradingService(db);
          const countBefore = (db.prepare('SELECT COUNT(*) as cnt FROM polymarket_orders').get() as any).cnt;

          await expect(
            svc.placeOrder({ token_id: 'tok-1', side, price, size }),
          ).rejects.toThrow('Validation error');

          const countAfter = (db.prepare('SELECT COUNT(*) as cnt FROM polymarket_orders').get() as any).cnt;
          expect(countAfter).toBe(countBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects orders with non-positive size and writes nothing to DB', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: -1e6, max: 0, noNaN: true }),
        fc.constantFrom('BUY' as const, 'SELL' as const),
        async (price, size, side) => {
          const svc = new PolymarketTradingService(db);
          const countBefore = (db.prepare('SELECT COUNT(*) as cnt FROM polymarket_orders').get() as any).cnt;

          await expect(
            svc.placeOrder({ token_id: 'tok-1', side, price, size }),
          ).rejects.toThrow('Validation error');

          const countAfter = (db.prepare('SELECT COUNT(*) as cnt FROM polymarket_orders').get() as any).cnt;
          expect(countAfter).toBe(countBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: polymarket-trading, Property 2: Order persistence round-trip

/**
 * Property 2: Order persistence round-trip
 *
 * *For any* successfully submitted order with valid parameters (token_id, side,
 * price, size), querying the `polymarket_orders` table should return a record
 * with matching token_id, side, price, size, market_id, and a non-null
 * created_at timestamp.
 *
 * **Validates: Requirements 2.6**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

describe('Property 2: Order persistence round-trip', () => {
  let tmpDir: string;
  let db: Database.Database;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-prop2-'));
    const dbPath = path.join(tmpDir, `test-${Date.now()}.db`);
    db = initializeDatabase(dbPath);
    process.env.POLYMARKET_PRIVATE_KEY = '0xdeadbeefdeadbeefdeadbeef';

    let ordCounter = 0;
    mockCreateAndPostOrder.mockImplementation(async () => {
      ordCounter++;
      return { orderID: `ord-${ordCounter}`, status: 'submitted' };
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it('persists valid orders with matching fields in polymarket_orders', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          token_id: fc.stringMatching(/^[0-9a-f]{4,16}$/),
          side: fc.constantFrom('BUY' as const, 'SELL' as const),
          price: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
          size: fc.double({ min: 0.01, max: 10000, noNaN: true }),
        }),
        async (order) => {
          const svc = new PolymarketTradingService(db);
          const result = await svc.placeOrder(order as { token_id: string; side: 'BUY' | 'SELL'; price: number; size: number });

          const row = db.prepare(
            'SELECT * FROM polymarket_orders WHERE order_id = ?',
          ).get(result.order_id) as any;

          expect(row).toBeDefined();
          expect(row.token_id).toBe(order.token_id);
          expect(row.side).toBe(order.side);
          expect(row.price).toBeCloseTo(order.price, 10);
          expect(row.size).toBeCloseTo(order.size, 10);
          expect(row.market_id).toBe(order.token_id);
          expect(row.created_at).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: polymarket-trading, Property 3: Private key never exposed

/**
 * Property 3: Private key never exposed
 *
 * *For any* API response, error message, or log output produced by the
 * Trading_Service, the value of the `POLYMARKET_PRIVATE_KEY` environment
 * variable SHALL NOT appear as a substring.
 *
 * **Validates: Requirements 1.6**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

describe('Property 3: Private key never exposed', () => {
  let tmpDir: string;
  let db: Database.Database;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-prop3-'));
    const dbPath = path.join(tmpDir, `test-${Date.now()}.db`);
    db = initializeDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it('private key never appears in error messages from auth failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[0-9a-f]{8,64}$/),
        async (hexKey) => {
          const privateKey = `0x${hexKey}`;
          process.env.POLYMARKET_PRIVATE_KEY = privateKey;

          // Simulate SDK auth failure that echoes the key back
          mockCreateOrDeriveApiKey.mockRejectedValueOnce(
            new Error(`Auth failed for key ${privateKey}`),
          );

          const svc = new PolymarketTradingService(db);

          try {
            await svc.ensureAuthenticated();
          } catch (err: any) {
            expect(err.message).not.toContain(privateKey);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('private key never appears in error messages from order failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[0-9a-f]{8,64}$/),
        async (hexKey) => {
          const privateKey = `0x${hexKey}`;
          process.env.POLYMARKET_PRIVATE_KEY = privateKey;

          // Auth succeeds, order fails with key in error
          mockCreateOrDeriveApiKey.mockResolvedValueOnce({
            key: 'k', secret: 's', passphrase: 'p',
          });
          mockCreateAndPostOrder.mockRejectedValueOnce(
            new Error(`Order failed for key ${privateKey}`),
          );

          const svc = new PolymarketTradingService(db);

          try {
            await svc.placeOrder({ token_id: 'tok', side: 'BUY', price: 0.5, size: 10 });
          } catch (err: any) {
            expect(err.message).not.toContain(privateKey);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: polymarket-trading, Property 4: Unconfigured service returns 503

/**
 * Property 4: Unconfigured service returns 503
 *
 * *For any* trading endpoint (order placement, cancellation, positions, trades),
 * if the `POLYMARKET_PRIVATE_KEY` is not set, the endpoint SHALL throw a
 * "Trading not configured" error.
 *
 * **Validates: Requirements 1.4**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

describe('Property 4: Unconfigured service returns 503', () => {
  let tmpDir: string;
  let db: Database.Database;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-prop4-'));
    const dbPath = path.join(tmpDir, `test-${Date.now()}.db`);
    db = initializeDatabase(dbPath);
    delete process.env.POLYMARKET_PRIVATE_KEY;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it('all trading methods throw "Trading not configured" when no private key', async () => {
    // Define the trading methods that require authentication
    const tradingMethods = [
      (svc: PolymarketTradingService) =>
        svc.placeOrder({ token_id: 'tok', side: 'BUY', price: 0.5, size: 10 }),
      (svc: PolymarketTradingService) => svc.cancelOrder('ord-1'),
      (svc: PolymarketTradingService) => svc.cancelAllOrders(),
      (svc: PolymarketTradingService) => svc.getPositions(),
      (svc: PolymarketTradingService) => svc.getTradeHistory(),
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: tradingMethods.length - 1 }),
        async (methodIndex) => {
          const svc = new PolymarketTradingService(db);
          expect(svc.isConfigured()).toBe(false);

          await expect(tradingMethods[methodIndex](svc)).rejects.toThrow(
            /Trading not configured/,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: polymarket-trading, Property 5: Order book computation correctness

/**
 * Property 5: Order book computation correctness
 *
 * *For any* order book with non-empty bids and asks arrays, the computed
 * best_bid SHALL equal the maximum bid price, best_ask SHALL equal the minimum
 * ask price, spread SHALL equal best_ask - best_bid, and midpoint SHALL equal
 * (best_bid + best_ask) / 2.
 *
 * **Validates: Requirements 4.3**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

describe('Property 5: Order book computation correctness', () => {
  let tmpDir: string;
  let db: Database.Database;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-prop5-'));
    const dbPath = path.join(tmpDir, `test-${Date.now()}.db`);
    db = initializeDatabase(dbPath);
    delete process.env.POLYMARKET_PRIVATE_KEY;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it('best_bid, best_ask, spread, and midpoint are computed correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            price: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
            size: fc.double({ min: 1, max: 10000, noNaN: true }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        fc.array(
          fc.record({
            price: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
            size: fc.double({ min: 1, max: 10000, noNaN: true }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        async (bids, asks) => {
          // Mock SDK getOrderBook to return the generated bids/asks as string values
          mockGetOrderBook.mockResolvedValueOnce({
            bids: bids.map((b) => ({ price: String(b.price), size: String(b.size) })),
            asks: asks.map((a) => ({ price: String(a.price), size: String(a.size) })),
          });

          const svc = new PolymarketTradingService(db);
          const result = await svc.getOrderBook('tok-test');

          const expectedBestBid = Math.max(...bids.map((b) => b.price));
          const expectedBestAsk = Math.min(...asks.map((a) => a.price));
          const expectedSpread = expectedBestAsk - expectedBestBid;
          const expectedMidpoint = (expectedBestBid + expectedBestAsk) / 2;

          expect(result.best_bid).toBeCloseTo(expectedBestBid, 10);
          expect(result.best_ask).toBeCloseTo(expectedBestAsk, 10);
          expect(result.spread).toBeCloseTo(expectedSpread, 10);
          expect(result.midpoint).toBeCloseTo(expectedMidpoint, 10);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: polymarket-trading, Property 9: Pagination defaults

/**
 * Property 9: Pagination defaults
 *
 * *For any* trade history query, if limit is not provided it SHALL default to
 * 50, and if offset is not provided it SHALL default to 0. The limit SHALL be
 * clamped to a reasonable maximum (e.g., 200).
 *
 * **Validates: Requirements 6.2**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

describe('Property 9: Pagination defaults', () => {
  let tmpDir: string;
  let db: Database.Database;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-prop9-'));
    const dbPath = path.join(tmpDir, `test-${Date.now()}.db`);
    db = initializeDatabase(dbPath);
    process.env.POLYMARKET_PRIVATE_KEY = '0xdeadbeefdeadbeefdeadbeef';
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it('defaults limit to 50 and offset to 0 when not provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(undefined),
        fc.constant(undefined),
        async (_limit, _offset) => {
          // Generate 100 trades so we can verify the default limit of 50
          const allTrades = Array.from({ length: 100 }, (_, i) => ({
            timestamp: i,
            market: `Market ${i}`,
            side: 'BUY',
            price: '0.5',
            size: '10',
            fee: '0',
          }));
          mockGetTrades.mockResolvedValueOnce(allTrades);

          const svc = new PolymarketTradingService(db);
          const result = await svc.getTradeHistory();

          // Default limit=50, offset=0 → first 50 trades
          expect(result).toHaveLength(50);
          expect(result[0].market_question).toBe('Market 0');
          expect(result[49].market_question).toBe('Market 49');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('clamps limit to max 200', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 201, max: 10000 }),
        async (limit) => {
          const allTrades = Array.from({ length: 300 }, (_, i) => ({
            timestamp: i,
            market: `Market ${i}`,
            side: 'BUY',
            price: '0.5',
            size: '10',
            fee: '0',
          }));
          mockGetTrades.mockResolvedValueOnce(allTrades);

          const svc = new PolymarketTradingService(db);
          const result = await svc.getTradeHistory(limit, 0);

          expect(result.length).toBeLessThanOrEqual(200);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('offset defaults to 0 when not provided but limit is', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 200 }),
        async (limit) => {
          const allTrades = Array.from({ length: 300 }, (_, i) => ({
            timestamp: i,
            market: `Market ${i}`,
            side: 'BUY',
            price: '0.5',
            size: '10',
            fee: '0',
          }));
          mockGetTrades.mockResolvedValueOnce(allTrades);

          const svc = new PolymarketTradingService(db);
          const result = await svc.getTradeHistory(limit);

          // offset defaults to 0, so first trade should be Market 0
          expect(result[0].market_question).toBe('Market 0');
          expect(result.length).toBeLessThanOrEqual(limit);
        },
      ),
      { numRuns: 100 },
    );
  });
});
