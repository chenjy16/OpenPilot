/**
 * Unit tests for FinFeedAPIClient
 *
 * Covers: API call mocking, HTTP error handling, timeout handling, 429 backoff logic
 * Requirements: 1.5, 1.6
 */

import { FinFeedAPIClient, calculateBackoffDelay } from './FinFeedAPIClient';
import type { Platform } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: any, status = 200, ok = true): Response {
  return {
    ok,
    status,
    json: async () => body,
    headers: new Headers(),
    redirected: false,
    statusText: status === 200 ? 'OK' : 'Error',
    type: 'basic',
    url: '',
    clone: () => mockFetchResponse(body, status, ok),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob([]),
    formData: async () => new FormData(),
    text: async () => JSON.stringify(body),
  } as Response;
}

const SAMPLE_MARKETS = [
  {
    id: 'mkt-1',
    question: 'Will it rain tomorrow?',
    yesPrice: 0.65,
    noPrice: 0.35,
    volume: 10000,
    liquidity: 5000,
    endDate: '2025-12-31T00:00:00Z',
    resolutionSource: 'Weather.gov',
    active: true,
  },
  {
    id: 'mkt-2',
    question: 'Will BTC hit 100k?',
    yesPrice: 0.42,
    noPrice: 0.58,
    volume: 50000,
    liquidity: 20000,
    endDate: null,
    resolutionSource: 'CoinGecko',
    active: true,
  },
];

const SAMPLE_ORDERBOOK = {
  bids: [
    { price: 0.60, size: 200 },
    { price: 0.58, size: 300 },
  ],
  asks: [
    { price: 0.62, size: 150 },
    { price: 0.65, size: 400 },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FinFeedAPIClient', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // API call mocking: URL construction & response parsing
  // -------------------------------------------------------------------------

  describe('fetchMarkets — URL construction and response parsing', () => {
    it('constructs the correct URL for a given platform', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(SAMPLE_MARKETS));

      const client = new FinFeedAPIClient({
        baseUrl: 'https://api.test.io',
        timeoutMs: 5000,
      });

      await client.fetchMarkets('polymarket');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe('https://api.test.io/v1/markets/POLYMARKET?active=true');
    });

    it('constructs correct URLs for each platform', async () => {
      const client = new FinFeedAPIClient({
        baseUrl: 'https://api.test.io',
        timeoutMs: 5000,
      });

      const platforms: Platform[] = ['polymarket', 'kalshi', 'myriad', 'manifold'];
      for (const platform of platforms) {
        fetchSpy.mockResolvedValue(mockFetchResponse([]));
        await client.fetchMarkets(platform);
        const calledUrl = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0];
        const expectedExchangeId = platform.toUpperCase();
        expect(calledUrl).toBe(`https://api.test.io/v1/markets/${expectedExchangeId}?active=true`);
      }
    });

    it('parses response into NormalizedMarket array', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(SAMPLE_MARKETS));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const markets = await client.fetchMarkets('kalshi');

      expect(markets).toHaveLength(2);
      expect(markets[0]).toMatchObject({
        platform: 'kalshi',
        marketId: 'mkt-1',
        question: 'Will it rain tomorrow?',
        yesPrice: 0.65,
        noPrice: 0.35,
        active: true,
      });
      expect(markets[1]).toMatchObject({
        platform: 'kalshi',
        marketId: 'mkt-2',
        question: 'Will BTC hit 100k?',
        yesPrice: 0.42,
        noPrice: 0.58,
      });
    });

    it('includes Authorization header when apiKey is configured', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse([]));

      const client = new FinFeedAPIClient({
        baseUrl: 'https://api.test.io',
        apiKey: 'test-key-123',
        timeoutMs: 5000,
      });

      await client.fetchMarkets('myriad');

      const fetchOptions = fetchSpy.mock.calls[0][1];
      expect(fetchOptions.headers['Authorization']).toBe('test-key-123');
    });

    it('sends Accept: application/json header', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse([]));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      await client.fetchMarkets('polymarket');

      const fetchOptions = fetchSpy.mock.calls[0][1];
      expect(fetchOptions.headers['Accept']).toBe('application/json');
    });

    it('returns empty array when API returns non-array', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse({ error: 'unexpected' }));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const markets = await client.fetchMarkets('polymarket');

      expect(markets).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // fetchAllMarkets
  // -------------------------------------------------------------------------

  describe('fetchAllMarkets', () => {
    it('fetches from all 4 platforms independently', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(SAMPLE_MARKETS));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const markets = await client.fetchAllMarkets();

      // 4 platforms × 2 markets each = 8
      expect(markets).toHaveLength(8);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('one platform failure does not block others', async () => {
      let callCount = 0;
      fetchSpy.mockImplementation(async (url: string) => {
        callCount++;
        if (url.includes('KALSHI')) {
          throw new Error('Network error');
        }
        return mockFetchResponse(SAMPLE_MARKETS);
      });

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const markets = await client.fetchAllMarkets();

      // polymarket + myriad + manifold succeed (2 markets each), kalshi fails
      expect(markets).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------
  // getOrderBook
  // -------------------------------------------------------------------------

  describe('getOrderBook', () => {
    it('constructs correct URL and parses order book', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(SAMPLE_ORDERBOOK));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const ob = await client.getOrderBook('polymarket', 'mkt-abc');

      expect(fetchSpy.mock.calls[0][0]).toBe('https://api.test.io/v1/orderbook/POLYMARKET/mkt-abc');
      expect(ob.platform).toBe('polymarket');
      expect(ob.marketId).toBe('mkt-abc');
      expect(ob.bids).toHaveLength(2);
      expect(ob.asks).toHaveLength(2);
      expect(ob.bestBid).toBe(0.60);
      expect(ob.bestAsk).toBe(0.62);
      expect(ob.spread).toBeCloseTo(0.02, 5);
      expect(typeof ob.timestamp).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // HTTP error handling (non-429)
  // -------------------------------------------------------------------------

  describe('HTTP error handling (non-429)', () => {
    it('fetchMarkets logs error and returns empty array on HTTP 500', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(null, 500, false));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const markets = await client.fetchMarkets('polymarket');

      expect(markets).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });

    it('fetchMarkets logs error and returns empty array on HTTP 403', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(null, 403, false));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const markets = await client.fetchMarkets('kalshi');

      expect(markets).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });

    it('fetchMarkets handles network errors gracefully', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const markets = await client.fetchMarkets('myriad');

      expect(markets).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });

    it('getOrderBook throws on HTTP error (not caught internally)', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse(null, 502, false));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });

      await expect(client.getOrderBook('polymarket', 'mkt-1')).rejects.toThrow(
        /FinFeedAPI 502/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Timeout handling (AbortController)
  // -------------------------------------------------------------------------

  describe('timeout handling', () => {
    it('fetchMarkets returns empty array when request is aborted', async () => {
      fetchSpy.mockImplementation(async (_url: string, options: RequestInit) => {
        // Simulate abort by throwing AbortError
        const error = new DOMException('The operation was aborted.', 'AbortError');
        throw error;
      });

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 100 });
      const markets = await client.fetchMarkets('polymarket');

      expect(markets).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });

    it('passes AbortController signal to fetch', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse([]));

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      await client.fetchMarkets('kalshi');

      const fetchOptions = fetchSpy.mock.calls[0][1];
      expect(fetchOptions.signal).toBeDefined();
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // -------------------------------------------------------------------------
  // 429 backoff logic
  // -------------------------------------------------------------------------

  describe('429 backoff retry logic', () => {
    it('retries on HTTP 429 and succeeds on second attempt', async () => {
      // First call: 429, second call: success
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(null, 429, false))
        .mockResolvedValueOnce(mockFetchResponse(SAMPLE_MARKETS));

      // Patch sleep to avoid real delays
      const sleepSpy = jest
        .spyOn(FinFeedAPIClient.prototype as any, 'sleep')
        .mockResolvedValue(undefined);

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const markets = await client.fetchMarkets('polymarket');

      expect(markets).toHaveLength(2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // sleep should have been called for the backoff delay
      expect(sleepSpy).toHaveBeenCalled();

      sleepSpy.mockRestore();
    });

    it('retries multiple times on consecutive 429s', async () => {
      // 3 consecutive 429s, then success
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(null, 429, false))
        .mockResolvedValueOnce(mockFetchResponse(null, 429, false))
        .mockResolvedValueOnce(mockFetchResponse(null, 429, false))
        .mockResolvedValueOnce(mockFetchResponse(SAMPLE_MARKETS));

      const sleepSpy = jest
        .spyOn(FinFeedAPIClient.prototype as any, 'sleep')
        .mockResolvedValue(undefined);

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });
      const markets = await client.fetchMarkets('kalshi');

      expect(markets).toHaveLength(2);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      // sleep is called in handleRateLimit AND in request's backoff check
      // so total sleep calls >= number of 429 retries
      expect(sleepSpy.mock.calls.length).toBeGreaterThanOrEqual(3);

      sleepSpy.mockRestore();
    });

    it('backoff state is per-platform', async () => {
      // polymarket gets 429, kalshi succeeds immediately
      fetchSpy.mockImplementation(async (url: string) => {
        if (url.includes('POLYMARKET')) {
          return mockFetchResponse(null, 429, false);
        }
        return mockFetchResponse(SAMPLE_MARKETS);
      });

      // After first 429, make polymarket succeed on retry
      let polyCallCount = 0;
      fetchSpy.mockImplementation(async (url: string) => {
        if (url.includes('POLYMARKET')) {
          polyCallCount++;
          if (polyCallCount === 1) {
            return mockFetchResponse(null, 429, false);
          }
          return mockFetchResponse(SAMPLE_MARKETS);
        }
        return mockFetchResponse(SAMPLE_MARKETS);
      });

      const sleepSpy = jest
        .spyOn(FinFeedAPIClient.prototype as any, 'sleep')
        .mockResolvedValue(undefined);

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });

      // kalshi should succeed without backoff
      const kalshiMarkets = await client.fetchMarkets('kalshi');
      expect(kalshiMarkets).toHaveLength(2);

      // polymarket triggers 429 then succeeds on retry
      const polyMarkets = await client.fetchMarkets('polymarket');
      expect(polyMarkets).toHaveLength(2);

      sleepSpy.mockRestore();
    });

    it('resets backoff state after successful response', async () => {
      // First: 429, second: success, third: new request should not wait
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(null, 429, false))
        .mockResolvedValueOnce(mockFetchResponse(SAMPLE_MARKETS))
        .mockResolvedValueOnce(mockFetchResponse(SAMPLE_MARKETS));

      const sleepSpy = jest
        .spyOn(FinFeedAPIClient.prototype as any, 'sleep')
        .mockResolvedValue(undefined);

      const client = new FinFeedAPIClient({ baseUrl: 'https://api.test.io', timeoutMs: 5000 });

      // First call triggers 429 → retry → success (resets backoff)
      await client.fetchMarkets('polymarket');

      // Second call should not trigger any backoff sleep
      const sleepCallsBefore = sleepSpy.mock.calls.length;
      await client.fetchMarkets('polymarket');
      // No additional sleep calls for backoff (the only sleep was from the 429 retry)
      expect(sleepSpy.mock.calls.length).toBe(sleepCallsBefore);

      sleepSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // updateConfig
  // -------------------------------------------------------------------------

  describe('updateConfig', () => {
    it('updates configuration at runtime', async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse([]));

      const client = new FinFeedAPIClient({ baseUrl: 'https://old.api.io', timeoutMs: 5000 });
      client.updateConfig({ baseUrl: 'https://new.api.io' });

      await client.fetchMarkets('polymarket');

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toContain('https://new.api.io');
    });
  });
});
