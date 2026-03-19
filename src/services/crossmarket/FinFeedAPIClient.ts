/**
 * FinFeedAPIClient — unified cross-platform prediction market data client.
 *
 * Fetches market data and order books from Polymarket, Kalshi, and Myriad
 * via the FinFeedAPI. Includes per-platform exponential backoff with jitter
 * for HTTP 429 rate limiting.
 */

import type {
  Platform,
  NormalizedMarket,
  CrossMarketOrderBook,
  FinFeedConfig,
} from './types';

// ---------------------------------------------------------------------------
// Backoff helpers
// ---------------------------------------------------------------------------

interface BackoffState {
  attempt: number;
  nextRetryTime: number;
}

/**
 * Calculate exponential backoff delay with random jitter.
 * Formula: min(2000 × 2^attempt, 60000) × (0.8 + Math.random() × 0.4)
 *
 * Exported for property testing (Property 2).
 */
export function calculateBackoffDelay(attempt: number): number {
  const baseDelay = Math.min(2000 * Math.pow(2, attempt), 60000);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(baseDelay * jitter);
}

const ALL_PLATFORMS: Platform[] = ['polymarket', 'kalshi', 'myriad'];

const DEFAULT_CONFIG: FinFeedConfig = {
  baseUrl: process.env.FINFEED_API_URL || 'https://api.finfeed.io',
  syncIntervalMs: 60000,
  timeoutMs: 15000,
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class FinFeedAPIClient {
  private config: FinFeedConfig;
  private backoffStates: Map<Platform, BackoffState> = new Map();

  constructor(config?: Partial<FinFeedConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Update configuration at runtime. */
  updateConfig(config: Partial<FinFeedConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Fetch active markets for a specific platform via FinFeedAPI.
   */
  async fetchMarkets(platform: Platform): Promise<NormalizedMarket[]> {
    const url = `${this.config.baseUrl}/v1/markets/${platform}?active=true`;

    try {
      const data = await this.request<any[]>(platform, url);
      return (Array.isArray(data) ? data : []).map((m) =>
        this.parseMarket(platform, m),
      );
    } catch (err: any) {
      console.error(
        `[FinFeedAPIClient] Failed to fetch markets for ${platform}: ${err.message}`,
      );
      return [];
    }
  }

  /**
   * Fetch markets from all 3 platforms independently.
   * One platform failure doesn't block others.
   */
  async fetchAllMarkets(): Promise<NormalizedMarket[]> {
    const results = await Promise.allSettled(
      ALL_PLATFORMS.map((p) => this.fetchMarkets(p)),
    );

    const markets: NormalizedMarket[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        markets.push(...result.value);
      } else {
        console.error(
          `[FinFeedAPIClient] Platform ${ALL_PLATFORMS[i]} failed: ${result.reason?.message ?? result.reason}`,
        );
      }
    }
    return markets;
  }

  /**
   * Fetch order book depth for a specific market.
   */
  async getOrderBook(
    platform: Platform,
    marketId: string,
  ): Promise<CrossMarketOrderBook> {
    const url = `${this.config.baseUrl}/v1/orderbook/${platform}/${marketId}`;
    const data = await this.request<any>(platform, url);
    return this.parseOrderBook(platform, marketId, data);
  }

  // -------------------------------------------------------------------------
  // Private: HTTP request with timeout + per-platform backoff on 429
  // -------------------------------------------------------------------------

  private async request<T>(platform: Platform, url: string): Promise<T> {
    // Check if we're in a backoff window for this platform
    const backoff = this.backoffStates.get(platform);
    if (backoff && Date.now() < backoff.nextRetryTime) {
      const waitMs = backoff.nextRetryTime - Date.now();
      await this.sleep(waitMs);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const resp = await fetch(url, {
        signal: controller.signal,
        headers,
      });

      if (resp.status === 429) {
        return this.handleRateLimit<T>(platform, url);
      }

      if (!resp.ok) {
        throw new Error(`FinFeedAPI ${resp.status} for ${platform}`);
      }

      // Successful response — reset backoff for this platform
      this.backoffStates.delete(platform);

      return (await resp.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async handleRateLimit<T>(
    platform: Platform,
    url: string,
  ): Promise<T> {
    const state = this.backoffStates.get(platform) ?? {
      attempt: 0,
      nextRetryTime: 0,
    };

    const delay = calculateBackoffDelay(state.attempt);
    state.attempt += 1;
    state.nextRetryTime = Date.now() + delay;
    this.backoffStates.set(platform, state);

    console.warn(
      `[FinFeedAPIClient] Rate limited (429) on ${platform}, retrying in ${delay}ms (attempt ${state.attempt})`,
    );

    await this.sleep(delay);
    return this.request<T>(platform, url);
  }

  // -------------------------------------------------------------------------
  // Private: Parsers
  // -------------------------------------------------------------------------

  private parseMarket(platform: Platform, m: any): NormalizedMarket {
    return {
      platform,
      marketId: String(m.id ?? m.marketId ?? ''),
      question: String(m.question ?? m.title ?? ''),
      yesPrice: Number(m.yesPrice ?? m.yes_price ?? 0),
      noPrice: Number(m.noPrice ?? m.no_price ?? 0),
      volume: Number(m.volume ?? 0),
      liquidity: Number(m.liquidity ?? 0),
      endDate: m.endDate ?? m.end_date ?? null,
      resolutionSource: String(m.resolutionSource ?? m.resolution_source ?? ''),
      active: m.active !== false,
    };
  }

  private parseOrderBook(
    platform: Platform,
    marketId: string,
    data: any,
  ): CrossMarketOrderBook {
    const bids: Array<{ price: number; size: number }> = (
      data.bids ?? []
    ).map((b: any) => ({
      price: Number(b.price ?? b.p ?? 0),
      size: Number(b.size ?? b.s ?? 0),
    }));

    const asks: Array<{ price: number; size: number }> = (
      data.asks ?? []
    ).map((a: any) => ({
      price: Number(a.price ?? a.p ?? 0),
      size: Number(a.size ?? a.s ?? 0),
    }));

    const bestBid = bids.length > 0 ? Math.max(...bids.map((b) => b.price)) : 0;
    const bestAsk = asks.length > 0 ? Math.min(...asks.map((a) => a.price)) : 0;

    return {
      platform,
      marketId,
      bids,
      asks,
      bestBid,
      bestAsk,
      spread: bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0,
      timestamp: Date.now(),
    };
  }

  // -------------------------------------------------------------------------
  // Private: Utilities
  // -------------------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
