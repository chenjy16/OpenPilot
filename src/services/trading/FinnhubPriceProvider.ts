/**
 * FinnhubPriceProvider — HTTP-based fallback price provider using Finnhub Quote API.
 *
 * Used when Longport WebSocket is unreachable (network/region issues).
 * Finnhub free tier: 60 calls/minute, quote endpoint returns real-time US stock prices.
 *
 * API: GET https://finnhub.io/api/v1/quote?symbol=AAPL&token=<key>
 * Response: { c: currentPrice, h: high, l: low, o: open, pc: previousClose, ... }
 */

export class FinnhubPriceProvider {
  private apiKey: string;
  private cache: Map<string, { price: number; ts: number }> = new Map();
  /** Cache TTL in ms (default 30s to stay within rate limits) */
  private cacheTtlMs: number;

  constructor(apiKey: string, cacheTtlMs: number = 30_000) {
    this.apiKey = apiKey;
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Get the current price for a US stock symbol.
   * Returns cached value if fresh enough, otherwise fetches from Finnhub.
   */
  async getPrice(symbol: string): Promise<number> {
    // Strip market suffix if present (AAPL.US → AAPL)
    const bare = symbol.includes('.') ? symbol.split('.')[0] : symbol;

    // Check cache
    const cached = this.cache.get(bare);
    if (cached && Date.now() - cached.ts < this.cacheTtlMs) {
      return cached.price;
    }

    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(bare)}&token=${this.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Finnhub quote API ${res.status}: ${res.statusText}`);
      }
      const data = await res.json() as { c?: number; pc?: number };
      const price = data.c ?? 0;
      if (price > 0) {
        this.cache.set(bare, { price, ts: Date.now() });
        return price;
      }
      // c=0 means market closed or invalid symbol; try previousClose
      if (data.pc && data.pc > 0) {
        this.cache.set(bare, { price: data.pc, ts: Date.now() });
        return data.pc;
      }
      throw new Error(`Finnhub returned zero price for ${bare}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
