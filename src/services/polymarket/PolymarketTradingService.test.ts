/**
 * Unit tests for PolymarketTradingService
 *
 * Tests constructor, isConfigured(), ensureAuthenticated(), config resolution,
 * order placement, cancellation, order book, positions, trade history,
 * and private key sanitisation.
 *
 * Mocks the @polymarket/clob-client SDK and ethers to avoid real network calls.
 */

import Database from 'better-sqlite3';
import { initializeDatabase } from '../../session/database';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ── Mock SDK ─────────────────────────────────────────────────────────────

const mockCreateOrDeriveApiKey = jest.fn();
const mockCreateAndPostOrder = jest.fn();
const mockCancelOrder = jest.fn();
const mockCancelAll = jest.fn();
const mockGetOrderBook = jest.fn();
const mockGetMidpoint = jest.fn();
const mockGetTrades = jest.fn();

jest.mock('@polymarket/clob-client', () => {
  return {
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
  };
});

jest.mock('ethers', () => ({
  ethers: {
    Wallet: jest.fn().mockImplementation((key: string) => ({
      address: '0xMockAddress',
      signTypedData: jest.fn().mockResolvedValue('0xMockSignature'),
      getAddress: jest.fn().mockResolvedValue('0xMockAddress'),
    })),
  },
}));

import { PolymarketTradingService, resolveConfig } from './PolymarketTradingService';

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string;
let db: Database.Database;

function freshDb(): Database.Database {
  const dbPath = path.join(tmpDir, `test-${Date.now()}-${Math.random()}.db`);
  return initializeDatabase(dbPath);
}

// ── Setup / Teardown ─────────────────────────────────────────────────────

const savedEnv = { ...process.env };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-svc-test-'));
  db = freshDb();
  jest.clearAllMocks();

  // Default: auth succeeds
  mockCreateOrDeriveApiKey.mockResolvedValue({
    key: 'key-1',
    secret: 'secret-1',
    passphrase: 'pass-1',
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

// ── resolveConfig ────────────────────────────────────────────────────────

describe('resolveConfig', () => {
  it('uses defaults when no config or env vars provided', () => {
    delete process.env.POLYMARKET_CLOB_API_URL;
    delete process.env.POLYMARKET_DATA_API_URL;

    const cfg = resolveConfig();
    expect(cfg.clobApiUrl).toBe('https://clob.polymarket.com');
    expect(cfg.dataApiUrl).toBe('https://data-api.polymarket.com');
    expect(cfg.chainId).toBe(137);
  });

  it('config overrides take precedence', () => {
    const cfg = resolveConfig({
      clobApiUrl: 'https://custom-clob.example.com',
      dataApiUrl: 'https://custom-data.example.com',
      chainId: 80001,
    });
    expect(cfg.clobApiUrl).toBe('https://custom-clob.example.com');
    expect(cfg.dataApiUrl).toBe('https://custom-data.example.com');
    expect(cfg.chainId).toBe(80001);
  });
});

// ── isConfigured ─────────────────────────────────────────────────────────

describe('isConfigured', () => {
  it('returns false when POLYMARKET_PRIVATE_KEY is not set', () => {
    delete process.env.POLYMARKET_PRIVATE_KEY;
    const svc = new PolymarketTradingService(db);
    expect(svc.isConfigured()).toBe(false);
  });

  it('returns false when POLYMARKET_PRIVATE_KEY is empty string', () => {
    process.env.POLYMARKET_PRIVATE_KEY = '';
    const svc = new PolymarketTradingService(db);
    expect(svc.isConfigured()).toBe(false);
  });

  it('returns true when POLYMARKET_PRIVATE_KEY is set', () => {
    process.env.POLYMARKET_PRIVATE_KEY = '0xdeadbeef1234567890abcdef';
    const svc = new PolymarketTradingService(db);
    expect(svc.isConfigured()).toBe(true);
  });
});

// ── ensureAuthenticated ──────────────────────────────────────────────────

describe('ensureAuthenticated', () => {
  it('throws when private key is not configured', async () => {
    delete process.env.POLYMARKET_PRIVATE_KEY;
    const svc = new PolymarketTradingService(db);
    await expect(svc.ensureAuthenticated()).rejects.toThrow(
      'Trading not configured: POLYMARKET_PRIVATE_KEY not set',
    );
  });

  it('caches credentials and does not call SDK on second invocation', async () => {
    process.env.POLYMARKET_PRIVATE_KEY = '0xabc123';

    const svc = new PolymarketTradingService(db);
    await svc.ensureAuthenticated();
    await svc.ensureAuthenticated(); // second call — should be cached
    expect(mockCreateOrDeriveApiKey).toHaveBeenCalledTimes(1);
  });

  it('throws when SDK returns incomplete credentials', async () => {
    process.env.POLYMARKET_PRIVATE_KEY = '0xabc123';
    mockCreateOrDeriveApiKey.mockResolvedValue({ key: 'k' }); // missing secret and passphrase

    const svc = new PolymarketTradingService(db);
    await expect(svc.ensureAuthenticated()).rejects.toThrow(
      'CLOB authentication failed: incomplete credentials returned',
    );
  });

  it('throws on SDK error without exposing private key', async () => {
    const secretKey = '0xSuperSecretKey999';
    process.env.POLYMARKET_PRIVATE_KEY = secretKey;
    mockCreateOrDeriveApiKey.mockRejectedValue(
      new Error(`Auth failed for key ${secretKey}`),
    );

    const svc = new PolymarketTradingService(db);
    try {
      await svc.ensureAuthenticated();
    } catch (err: any) {
      expect(err.message).not.toContain(secretKey);
      expect(err.message).toContain('[REDACTED]');
    }
  });
});

// ── getConfig ────────────────────────────────────────────────────────────

describe('getConfig', () => {
  it('returns resolved config', () => {
    delete process.env.POLYMARKET_CLOB_API_URL;
    delete process.env.POLYMARKET_DATA_API_URL;

    const svc = new PolymarketTradingService(db, { chainId: 80001 });
    const cfg = svc.getConfig();
    expect(cfg.chainId).toBe(80001);
    expect(cfg.clobApiUrl).toBe('https://clob.polymarket.com');
    expect(cfg.dataApiUrl).toBe('https://data-api.polymarket.com');
  });
});

// ── Stub methods ─────────────────────────────────────────────────────────

describe('stub methods throw Not implemented', () => {
  let svc: PolymarketTradingService;

  beforeEach(() => {
    delete process.env.POLYMARKET_PRIVATE_KEY;
    svc = new PolymarketTradingService(db);
  });

  it('placeOrder rejects when not configured', async () => {
    await expect(
      svc.placeOrder({ token_id: 't', side: 'BUY', price: 0.5, size: 10 }),
    ).rejects.toThrow('Trading not configured');
  });

  it('cancelOrder rejects when not configured', async () => {
    await expect(svc.cancelOrder('id')).rejects.toThrow('Trading not configured');
  });

  it('cancelAllOrders rejects when not configured', async () => {
    await expect(svc.cancelAllOrders()).rejects.toThrow('Trading not configured');
  });

  it('getPositions rejects when not configured', async () => {
    await expect(svc.getPositions()).rejects.toThrow('Trading not configured');
  });

  it('getTradeHistory rejects when not configured', async () => {
    await expect(svc.getTradeHistory()).rejects.toThrow('Trading not configured');
  });
});

// ── placeOrder ───────────────────────────────────────────────────────────

describe('placeOrder', () => {
  let svc: PolymarketTradingService;

  beforeEach(() => {
    process.env.POLYMARKET_PRIVATE_KEY = '0xdeadbeef1234567890abcdef';
    mockCreateAndPostOrder.mockResolvedValue({ orderID: 'ord-123', status: 'submitted' });
    svc = new PolymarketTradingService(db);
  });

  it('rejects price below 0.01', async () => {
    await expect(
      svc.placeOrder({ token_id: 't1', side: 'BUY', price: 0.005, size: 10 }),
    ).rejects.toThrow('Validation error: price must be between 0.01 and 0.99');
  });

  it('rejects price above 0.99', async () => {
    await expect(
      svc.placeOrder({ token_id: 't1', side: 'BUY', price: 1.0, size: 10 }),
    ).rejects.toThrow('Validation error: price must be between 0.01 and 0.99');
  });

  it('rejects zero size', async () => {
    await expect(
      svc.placeOrder({ token_id: 't1', side: 'BUY', price: 0.5, size: 0 }),
    ).rejects.toThrow('Validation error: size must be a positive number');
  });

  it('rejects negative size', async () => {
    await expect(
      svc.placeOrder({ token_id: 't1', side: 'BUY', price: 0.5, size: -5 }),
    ).rejects.toThrow('Validation error: size must be a positive number');
  });

  it('places order successfully and returns order_id and status', async () => {
    const result = await svc.placeOrder({
      token_id: 'token-abc',
      side: 'BUY',
      price: 0.55,
      size: 100,
    });

    expect(result.order_id).toBe('ord-123');
    expect(result.status).toBe('submitted');
    expect(mockCreateAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenID: 'token-abc',
        side: 'BUY',
        price: 0.55,
        size: 100,
      }),
    );
  });

  it('records order in polymarket_orders table', async () => {
    await svc.placeOrder({
      token_id: 'token-abc',
      side: 'SELL',
      price: 0.30,
      size: 50,
    });

    const row = db.prepare(
      'SELECT * FROM polymarket_orders WHERE order_id = ?',
    ).get('ord-123') as any;

    expect(row).toBeDefined();
    expect(row.token_id).toBe('token-abc');
    expect(row.side).toBe('SELL');
    expect(row.price).toBe(0.30);
    expect(row.size).toBe(50);
    expect(row.status).toBe('submitted');
    expect(row.market_id).toBe('token-abc');
  });

  it('propagates SDK errors without retrying', async () => {
    mockCreateAndPostOrder.mockRejectedValue(new Error('Insufficient balance'));

    await expect(
      svc.placeOrder({ token_id: 't1', side: 'BUY', price: 0.5, size: 10 }),
    ).rejects.toThrow('Insufficient balance');

    expect(mockCreateAndPostOrder).toHaveBeenCalledTimes(1);
  });

  it('accepts boundary price 0.01', async () => {
    const result = await svc.placeOrder({
      token_id: 't1',
      side: 'BUY',
      price: 0.01,
      size: 1,
    });
    expect(result.order_id).toBe('ord-123');
  });

  it('accepts boundary price 0.99', async () => {
    const result = await svc.placeOrder({
      token_id: 't1',
      side: 'SELL',
      price: 0.99,
      size: 1,
    });
    expect(result.order_id).toBe('ord-123');
  });
});

// ── cancelOrder ──────────────────────────────────────────────────────────

describe('cancelOrder', () => {
  let svc: PolymarketTradingService;

  beforeEach(() => {
    process.env.POLYMARKET_PRIVATE_KEY = '0xdeadbeef1234567890abcdef';
    mockCancelOrder.mockResolvedValue({ success: true });
    svc = new PolymarketTradingService(db);
  });

  it('calls SDK cancelOrder with correct orderID', async () => {
    db.prepare(
      `INSERT INTO polymarket_orders (order_id, market_id, token_id, side, price, size, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('ord-cancel-1', 'mkt-1', 'tok-1', 'BUY', 0.5, 10, 'submitted');

    await svc.cancelOrder('ord-cancel-1');

    expect(mockCancelOrder).toHaveBeenCalledWith({ orderID: 'ord-cancel-1' });
  });

  it('updates order status to canceled in DB', async () => {
    db.prepare(
      `INSERT INTO polymarket_orders (order_id, market_id, token_id, side, price, size, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('ord-cancel-2', 'mkt-1', 'tok-1', 'BUY', 0.5, 10, 'submitted');

    await svc.cancelOrder('ord-cancel-2');

    const row = db.prepare(
      'SELECT status FROM polymarket_orders WHERE order_id = ?',
    ).get('ord-cancel-2') as any;

    expect(row.status).toBe('canceled');
  });

  it('propagates SDK errors', async () => {
    mockCancelOrder.mockRejectedValue(new Error('Order not found'));

    await expect(svc.cancelOrder('nonexistent')).rejects.toThrow('Order not found');
  });

  it('does not update DB when SDK fails', async () => {
    db.prepare(
      `INSERT INTO polymarket_orders (order_id, market_id, token_id, side, price, size, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('ord-cancel-3', 'mkt-1', 'tok-1', 'BUY', 0.5, 10, 'submitted');

    mockCancelOrder.mockRejectedValue(new Error('Server error'));

    await expect(svc.cancelOrder('ord-cancel-3')).rejects.toThrow();

    const row = db.prepare(
      'SELECT status FROM polymarket_orders WHERE order_id = ?',
    ).get('ord-cancel-3') as any;
    expect(row.status).toBe('submitted');
  });
});

// ── cancelAllOrders ──────────────────────────────────────────────────────

describe('cancelAllOrders', () => {
  let svc: PolymarketTradingService;

  beforeEach(() => {
    process.env.POLYMARKET_PRIVATE_KEY = '0xdeadbeef1234567890abcdef';
    mockCancelAll.mockResolvedValue({ success: true });
    svc = new PolymarketTradingService(db);
  });

  it('calls SDK cancelAll', async () => {
    await svc.cancelAllOrders();
    expect(mockCancelAll).toHaveBeenCalled();
  });

  it('updates non-terminal orders to canceled and returns count', async () => {
    const insert = db.prepare(
      `INSERT INTO polymarket_orders (order_id, market_id, token_id, side, price, size, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('ord-a', 'mkt-1', 'tok-1', 'BUY', 0.5, 10, 'submitted');
    insert.run('ord-b', 'mkt-1', 'tok-1', 'SELL', 0.6, 20, 'pending');
    insert.run('ord-c', 'mkt-1', 'tok-1', 'BUY', 0.4, 5, 'filled');    // terminal
    insert.run('ord-d', 'mkt-1', 'tok-1', 'BUY', 0.3, 15, 'canceled');  // terminal
    insert.run('ord-e', 'mkt-1', 'tok-1', 'SELL', 0.7, 8, 'failed');    // terminal

    const count = await svc.cancelAllOrders();

    expect(count).toBe(2);

    const getStatus = (id: string) =>
      (db.prepare('SELECT status FROM polymarket_orders WHERE order_id = ?').get(id) as any).status;

    expect(getStatus('ord-a')).toBe('canceled');
    expect(getStatus('ord-b')).toBe('canceled');
    expect(getStatus('ord-c')).toBe('filled');
    expect(getStatus('ord-d')).toBe('canceled');
    expect(getStatus('ord-e')).toBe('failed');
  });

  it('returns 0 when no non-terminal orders exist', async () => {
    const insert = db.prepare(
      `INSERT INTO polymarket_orders (order_id, market_id, token_id, side, price, size, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('ord-x', 'mkt-1', 'tok-1', 'BUY', 0.5, 10, 'filled');
    insert.run('ord-y', 'mkt-1', 'tok-1', 'SELL', 0.6, 20, 'canceled');

    const count = await svc.cancelAllOrders();
    expect(count).toBe(0);
  });

  it('propagates SDK errors and does not update DB', async () => {
    const insert = db.prepare(
      `INSERT INTO polymarket_orders (order_id, market_id, token_id, side, price, size, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('ord-f', 'mkt-1', 'tok-1', 'BUY', 0.5, 10, 'submitted');

    mockCancelAll.mockRejectedValue(new Error('Internal server error'));

    await expect(svc.cancelAllOrders()).rejects.toThrow('Internal server error');

    const row = db.prepare(
      'SELECT status FROM polymarket_orders WHERE order_id = ?',
    ).get('ord-f') as any;
    expect(row.status).toBe('submitted');
  });
});

// ── getOrderBook ─────────────────────────────────────────────────────────

describe('getOrderBook', () => {
  let svc: PolymarketTradingService;

  beforeEach(() => {
    delete process.env.POLYMARKET_PRIVATE_KEY;
    svc = new PolymarketTradingService(db, {
      clobApiUrl: 'https://test-clob.example.com',
    });
  });

  it('calls SDK getOrderBook and returns parsed order book', async () => {
    mockGetOrderBook.mockResolvedValue({
      bids: [
        { price: '0.45', size: '100' },
        { price: '0.50', size: '200' },
      ],
      asks: [
        { price: '0.55', size: '150' },
        { price: '0.60', size: '80' },
      ],
    });

    const result = await svc.getOrderBook('token-xyz');

    expect(result.bids).toHaveLength(2);
    expect(result.asks).toHaveLength(2);
    expect(result.best_bid).toBe(0.50);
    expect(result.best_ask).toBe(0.55);
    expect(result.spread).toBeCloseTo(0.05);
    expect(result.midpoint).toBeCloseTo(0.525);
  });

  it('returns zeros for empty bids and asks', async () => {
    mockGetOrderBook.mockResolvedValue({ bids: [], asks: [] });

    const result = await svc.getOrderBook('token-empty');

    expect(result.best_bid).toBe(0);
    expect(result.best_ask).toBe(0);
    expect(result.spread).toBe(0);
    expect(result.midpoint).toBe(0);
    expect(result.bids).toHaveLength(0);
    expect(result.asks).toHaveLength(0);
  });

  it('handles missing bids/asks fields gracefully', async () => {
    mockGetOrderBook.mockResolvedValue({});

    const result = await svc.getOrderBook('token-missing');

    expect(result.bids).toHaveLength(0);
    expect(result.asks).toHaveLength(0);
    expect(result.best_bid).toBe(0);
    expect(result.best_ask).toBe(0);
  });

  it('propagates SDK errors', async () => {
    mockGetOrderBook.mockRejectedValue(new Error('Not found'));

    await expect(svc.getOrderBook('bad-token')).rejects.toThrow('Not found');
  });
});

// ── getMidpoint ──────────────────────────────────────────────────────────

describe('getMidpoint', () => {
  let svc: PolymarketTradingService;

  beforeEach(() => {
    delete process.env.POLYMARKET_PRIVATE_KEY;
    svc = new PolymarketTradingService(db, {
      clobApiUrl: 'https://test-clob.example.com',
    });
  });

  it('calls SDK getMidpoint and returns number', async () => {
    mockGetMidpoint.mockResolvedValue('0.525');

    const result = await svc.getMidpoint('token-xyz');
    expect(result).toBeCloseTo(0.525);
  });

  it('returns 0 for null/undefined result', async () => {
    mockGetMidpoint.mockResolvedValue(null);

    const result = await svc.getMidpoint('token-abc');
    expect(result).toBe(0);
  });

  it('propagates SDK errors', async () => {
    mockGetMidpoint.mockRejectedValue(new Error('Server error'));

    await expect(svc.getMidpoint('bad-token')).rejects.toThrow('Server error');
  });
});

// ── getPositions ─────────────────────────────────────────────────────────

describe('getPositions', () => {
  let svc: PolymarketTradingService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.POLYMARKET_PRIVATE_KEY = '0xdeadbeef1234567890abcdef';
    svc = new PolymarketTradingService(db, {
      clobApiUrl: 'https://test-clob.example.com',
      dataApiUrl: 'https://test-data.example.com',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /**
   * Helper: creates a mock fetch that handles Data API positions and Gamma API enrichment.
   * (getPositions still uses fetch for the Data API since the SDK doesn't have a positions method)
   */
  function mockFetchForPositions(
    positionsPayload: unknown[],
    gammaResponses?: Record<string, unknown>,
  ) {
    global.fetch = jest.fn(async (url: any) => {
      const urlStr = String(url);

      // Data API positions
      if (urlStr.includes('/positions')) {
        return new Response(JSON.stringify(positionsPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Gamma API market enrichment
      if (urlStr.includes('gamma-api.polymarket.com/markets')) {
        const idMatch = urlStr.match(/[?&]id=([^&]+)/);
        const marketId = idMatch ? decodeURIComponent(idMatch[1]) : '';
        const gammaData = gammaResponses?.[marketId];
        if (gammaData) {
          return new Response(JSON.stringify(gammaData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }

      return new Response('Unknown endpoint', { status: 404 });
    }) as any;
  }

  it('calls Data API /positions with auth headers', async () => {
    mockFetchForPositions([]);

    await svc.getPositions();

    const calls = (global.fetch as jest.Mock).mock.calls;
    const posCall = calls.find(
      (c: any) => String(c[0]).includes('test-data.example.com/positions'),
    );
    expect(posCall).toBeDefined();
    expect(posCall![1].headers.POLY_API_KEY).toBe('key-1');
    expect(posCall![1].headers.POLY_PASSPHRASE).toBe('pass-1');
    expect(posCall![1].headers.POLY_SECRET).toBe('secret-1');
  });

  it('returns empty array when no positions', async () => {
    mockFetchForPositions([]);

    const result = await svc.getPositions();
    expect(result).toEqual([]);
  });

  it('returns positions with correct fields', async () => {
    mockFetchForPositions(
      [
        {
          market: 'Will it rain tomorrow?',
          token_id: 'tok-1',
          outcome: 'Yes',
          size: '100',
          avgPrice: '0.40',
          condition_id: 'mkt-1',
        },
      ],
      {
        'mkt-1': [
          {
            question: 'Will it rain tomorrow?',
            outcomePrices: JSON.stringify([0.65, 0.35]),
          },
        ],
      },
    );

    const result = await svc.getPositions();

    expect(result).toHaveLength(1);
    expect(result[0].market_question).toBe('Will it rain tomorrow?');
    expect(result[0].token_id).toBe('tok-1');
    expect(result[0].outcome).toBe('Yes');
    expect(result[0].size).toBe(100);
    expect(result[0].avg_entry_price).toBe(0.40);
    expect(result[0].current_price).toBe(0.65);
    expect(result[0].unrealized_pnl).toBeCloseTo((0.65 - 0.40) * 100);
  });

  it('enriches No outcome with second price from Gamma API', async () => {
    mockFetchForPositions(
      [
        {
          market: 'Election result?',
          token_id: 'tok-2',
          outcome: 'No',
          size: '50',
          avgPrice: '0.30',
          condition_id: 'mkt-2',
        },
      ],
      {
        'mkt-2': [
          {
            question: 'Election result?',
            outcomePrices: JSON.stringify([0.70, 0.30]),
          },
        ],
      },
    );

    const result = await svc.getPositions();

    expect(result).toHaveLength(1);
    expect(result[0].outcome).toBe('No');
    expect(result[0].current_price).toBe(0.30);
    expect(result[0].unrealized_pnl).toBeCloseTo((0.30 - 0.30) * 50);
  });

  it('skips positions with zero size', async () => {
    mockFetchForPositions([
      { token_id: 'tok-1', outcome: 'Yes', size: '0', avgPrice: '0.50' },
      { token_id: 'tok-2', outcome: 'No', size: '10', avgPrice: '0.40' },
    ]);

    const result = await svc.getPositions();
    expect(result).toHaveLength(1);
    expect(result[0].token_id).toBe('tok-2');
  });

  it('handles Gamma API failure gracefully (keeps existing values)', async () => {
    mockFetchForPositions(
      [
        {
          market: 'Some market',
          token_id: 'tok-1',
          outcome: 'Yes',
          size: '100',
          avgPrice: '0.40',
          curPrice: '0.55',
          condition_id: 'mkt-fail',
        },
      ],
      {},
    );

    const result = await svc.getPositions();

    expect(result).toHaveLength(1);
    expect(result[0].current_price).toBe(0.55);
    expect(result[0].market_question).toBe('Some market');
  });

  it('throws on Data API error with descriptive message', async () => {
    global.fetch = jest.fn(async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as any;

    await expect(svc.getPositions()).rejects.toThrow('Data API error (401)');
  });

  it('calculates unrealized_pnl correctly', async () => {
    mockFetchForPositions(
      [
        {
          token_id: 'tok-1',
          outcome: 'Yes',
          size: '200',
          avgPrice: '0.25',
          condition_id: 'mkt-1',
        },
      ],
      {
        'mkt-1': [
          {
            question: 'Test market',
            outcomePrices: JSON.stringify([0.80, 0.20]),
          },
        ],
      },
    );

    const result = await svc.getPositions();
    expect(result[0].unrealized_pnl).toBeCloseTo((0.80 - 0.25) * 200);
  });

  it('handles multiple positions', async () => {
    mockFetchForPositions(
      [
        {
          market: 'Market A',
          token_id: 'tok-a',
          outcome: 'Yes',
          size: '50',
          avgPrice: '0.30',
          condition_id: 'mkt-a',
        },
        {
          market: 'Market B',
          token_id: 'tok-b',
          outcome: 'No',
          size: '75',
          avgPrice: '0.60',
          condition_id: 'mkt-b',
        },
      ],
      {
        'mkt-a': [{ question: 'Market A', outcomePrices: JSON.stringify([0.55, 0.45]) }],
        'mkt-b': [{ question: 'Market B', outcomePrices: JSON.stringify([0.40, 0.60]) }],
      },
    );

    const result = await svc.getPositions();

    expect(result).toHaveLength(2);
    expect(result[0].token_id).toBe('tok-a');
    expect(result[0].current_price).toBe(0.55);
    expect(result[1].token_id).toBe('tok-b');
    expect(result[1].current_price).toBe(0.60);
  });
});

// ── getTradeHistory ──────────────────────────────────────────────────────

describe('getTradeHistory', () => {
  let svc: PolymarketTradingService;

  beforeEach(() => {
    process.env.POLYMARKET_PRIVATE_KEY = '0xdeadbeef1234567890abcdef';
    mockGetTrades.mockResolvedValue([]);
    svc = new PolymarketTradingService(db, {
      clobApiUrl: 'https://test-clob.example.com',
      dataApiUrl: 'https://test-data.example.com',
    });
  });

  it('returns empty array when no trades', async () => {
    const result = await svc.getTradeHistory();
    expect(result).toEqual([]);
  });

  it('maps trade records with correct fields', async () => {
    mockGetTrades.mockResolvedValue([
      {
        timestamp: 1700000000,
        market: 'Will BTC hit 100k?',
        side: 'BUY',
        price: '0.65',
        size: '100',
        fee: '0.50',
      },
    ]);

    const result = await svc.getTradeHistory();

    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(1700000000);
    expect(result[0].market_question).toBe('Will BTC hit 100k?');
    expect(result[0].side).toBe('BUY');
    expect(result[0].price).toBe(0.65);
    expect(result[0].size).toBe(100);
    expect(result[0].fee).toBe(0.50);
  });

  it('handles multiple trades', async () => {
    mockGetTrades.mockResolvedValue([
      { timestamp: 1700000000, market: 'Market A', side: 'BUY', price: '0.50', size: '10', fee: '0.1' },
      { timestamp: 1700001000, market: 'Market B', side: 'SELL', price: '0.70', size: '20', fee: '0.2' },
    ]);

    const result = await svc.getTradeHistory();

    expect(result).toHaveLength(2);
    expect(result[0].market_question).toBe('Market A');
    expect(result[1].market_question).toBe('Market B');
    expect(result[1].side).toBe('SELL');
  });

  it('applies limit and offset to results', async () => {
    const trades = Array.from({ length: 10 }, (_, i) => ({
      timestamp: 1700000000 + i,
      market: `Market ${i}`,
      side: 'BUY',
      price: '0.50',
      size: '10',
      fee: '0',
    }));
    mockGetTrades.mockResolvedValue(trades);

    const result = await svc.getTradeHistory(3, 2);

    expect(result).toHaveLength(3);
    expect(result[0].market_question).toBe('Market 2');
    expect(result[2].market_question).toBe('Market 4');
  });

  it('clamps limit to max 200', async () => {
    const trades = Array.from({ length: 250 }, (_, i) => ({
      timestamp: i,
      market: `M${i}`,
      side: 'BUY',
      price: '0.5',
      size: '1',
      fee: '0',
    }));
    mockGetTrades.mockResolvedValue(trades);

    const result = await svc.getTradeHistory(500, 0);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('defaults missing fields to sensible values', async () => {
    mockGetTrades.mockResolvedValue([{}]);

    const result = await svc.getTradeHistory();

    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(0);
    expect(result[0].market_question).toBe('');
    expect(result[0].price).toBe(0);
    expect(result[0].size).toBe(0);
    expect(result[0].fee).toBe(0);
  });

  it('propagates SDK errors', async () => {
    mockGetTrades.mockRejectedValue(new Error('Unauthorized'));

    await expect(svc.getTradeHistory()).rejects.toThrow('Unauthorized');
  });
});
