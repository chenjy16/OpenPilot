/**
 * QuoteService — Real-time quote data via pluggable providers.
 *
 * Provides:
 * - PriceCache: in-memory latest price for each subscribed symbol
 * - subscribe/unsubscribe: manage symbol subscriptions
 * - getPrice(symbol): get latest cached price
 * - onPriceUpdate callback: notify listeners of price changes
 * - Feeds StopLossManager.checkAll with real prices
 *
 * Default provider: Longport (free accounts have ~15-minute delay for US stocks).
 * Provider interface allows future switching to Alpaca, Polygon, etc.
 */

import { EventEmitter } from 'events';
import {
  Config,
  QuoteContext,
  SubType,
} from 'longport';
import type { PushQuoteEvent } from 'longport';

export interface PriceData {
  symbol: string;
  lastPrice: number;
  timestamp: number;
  volume?: number;
  turnover?: number;
  high?: number;
  low?: number;
  open?: number;
  prevClose?: number;
}

export interface QuoteServiceOptions {
  appKey: string;
  appSecret: string;
  accessToken: string;
  region?: 'hk' | 'sg' | 'cn';
}

/**
 * QuoteProvider interface — abstraction for pluggable quote data sources.
 * Implement this to add Alpaca, Polygon, or other providers.
 */
export interface QuoteProvider {
  readonly name: string;
  configure(options: Record<string, any>): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(symbols: string[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  getQuotes(symbols: string[]): Promise<PriceData[]>;
  onPrice(callback: (data: PriceData) => void): void;
}

export class QuoteService extends EventEmitter {
  private quoteCtx: QuoteContext | null = null;
  private config: Config | null = null;
  private options: QuoteServiceOptions | null = null;
  private priceCache: Map<string, PriceData> = new Map();
  private subscribedSymbols: Set<string> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  /**
   * Initialize with credentials. Call start() to begin.
   */
  configure(options: QuoteServiceOptions): void {
    this.options = options;
    // Reset connection if reconfigured
    this.quoteCtx = null;
    this.config = null;
  }

  isConfigured(): boolean {
    return this.options !== null && !!this.options.appKey && !!this.options.appSecret && !!this.options.accessToken;
  }

  /**
   * Lazily create QuoteContext.
   */
  private async ensureContext(): Promise<QuoteContext> {
    if (this.quoteCtx) return this.quoteCtx;
    if (!this.options) throw new Error('QuoteService not configured');

    const { appKey, appSecret, accessToken, region } = this.options;
    const isCN = region === 'cn';
    const baseUrl = isCN ? 'https://openapi.longportapp.cn' : 'https://openapi.longportapp.com';
    const quoteWsUrl = isCN ? 'wss://openapi-quote.longportapp.cn/v2' : 'wss://openapi-quote.longportapp.com/v2';
    const tradeWsUrl = isCN ? 'wss://openapi-trade.longportapp.cn/v2' : 'wss://openapi-trade.longportapp.com/v2';

    this.config = new Config({
      appKey,
      appSecret,
      accessToken,
      httpUrl: baseUrl,
      quoteWsUrl,
      tradeWsUrl,
      enablePrintQuotePackages: false,
    });

    this.quoteCtx = await QuoteContext.new(this.config);

    // Register push callback for real-time quote updates
    this.quoteCtx.setOnQuote((_err: Error | null, event: PushQuoteEvent) => {
      if (_err) {
        console.error(`[QuoteService] Quote push error: ${_err.message}`);
        return;
      }
      this.handleQuoteEvent(event);
    });

    return this.quoteCtx;
  }

  /**
   * Handle incoming quote push events.
   */
  private handleQuoteEvent(event: PushQuoteEvent): void {
    try {
      const symbol = event.symbol;
      const quote = event.data;
      const lastDone = quote.lastDone;
      if (!symbol || !lastDone) return;

      const price = typeof lastDone.toNumber === 'function' ? lastDone.toNumber() : Number(lastDone);
      if (isNaN(price) || price <= 0) return;

      const data: PriceData = {
        symbol,
        lastPrice: price,
        timestamp: Date.now(),
        volume: quote.volume != null ? Number(quote.volume) : undefined,
        turnover: quote.turnover != null ? (typeof quote.turnover.toNumber === 'function' ? quote.turnover.toNumber() : Number(quote.turnover)) : undefined,
        high: quote.high != null ? (typeof quote.high.toNumber === 'function' ? quote.high.toNumber() : Number(quote.high)) : undefined,
        low: quote.low != null ? (typeof quote.low.toNumber === 'function' ? quote.low.toNumber() : Number(quote.low)) : undefined,
        open: quote.open != null ? (typeof quote.open.toNumber === 'function' ? quote.open.toNumber() : Number(quote.open)) : undefined,
      };

      this.priceCache.set(symbol, data);
      this.emit('price', data);
    } catch {
      // Ignore malformed events
    }
  }

  /**
   * Start the quote service. Subscribes to symbols and begins polling.
   */
  async start(symbols: string[], pollIntervalMs: number = 60000): Promise<void> {
    if (this.started) return;
    if (!this.isConfigured()) {
      console.log('[QuoteService] Not configured, skipping start');
      return;
    }

    this.started = true;

    try {
      const ctx = await this.ensureContext();

      // Normalize symbols to Longport format
      const lpSymbols = symbols.map(s => this.normalizeSymbol(s));

      if (lpSymbols.length > 0) {
        // Subscribe to quote push
        await ctx.subscribe(lpSymbols, [SubType.Quote]);
        for (const s of lpSymbols) this.subscribedSymbols.add(s);
        console.log(`[QuoteService] Subscribed to ${lpSymbols.length} symbols`);
      }

      // Initial fetch of all prices
      await this.refreshPrices(lpSymbols);

      // Start periodic polling (for free accounts with delayed data, polling ensures freshness)
      this.pollTimer = setInterval(() => {
        const syms = Array.from(this.subscribedSymbols);
        if (syms.length > 0) {
          this.refreshPrices(syms).catch(err => {
            console.error(`[QuoteService] Poll error: ${err.message}`);
          });
        }
      }, pollIntervalMs);

      console.log(`[QuoteService] Started (${lpSymbols.length} symbols, poll every ${pollIntervalMs / 1000}s)`);
    } catch (err: any) {
      console.error(`[QuoteService] Start failed: ${err.message}`);
      this.started = false;
    }
  }

  /**
   * Stop the quote service.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.quoteCtx && this.subscribedSymbols.size > 0) {
      try {
        await this.quoteCtx.unsubscribe(Array.from(this.subscribedSymbols), [SubType.Quote]);
      } catch {
        // Ignore unsubscribe errors on shutdown
      }
    }

    this.subscribedSymbols.clear();
    console.log('[QuoteService] Stopped');
  }

  /**
   * Subscribe to additional symbols.
   */
  async subscribe(symbols: string[]): Promise<void> {
    if (!this.quoteCtx) return;
    const lpSymbols = symbols.map(s => this.normalizeSymbol(s)).filter(s => !this.subscribedSymbols.has(s));
    if (lpSymbols.length === 0) return;

    try {
      await this.quoteCtx.subscribe(lpSymbols, [SubType.Quote]);
      for (const s of lpSymbols) this.subscribedSymbols.add(s);
      await this.refreshPrices(lpSymbols);
      console.log(`[QuoteService] Subscribed to ${lpSymbols.length} additional symbols`);
    } catch (err: any) {
      console.error(`[QuoteService] Subscribe error: ${err.message}`);
    }
  }

  /**
   * Unsubscribe from symbols.
   */
  async unsubscribe(symbols: string[]): Promise<void> {
    if (!this.quoteCtx) return;
    const lpSymbols = symbols.map(s => this.normalizeSymbol(s)).filter(s => this.subscribedSymbols.has(s));
    if (lpSymbols.length === 0) return;

    try {
      await this.quoteCtx.unsubscribe(lpSymbols, [SubType.Quote]);
      for (const s of lpSymbols) {
        this.subscribedSymbols.delete(s);
        this.priceCache.delete(s);
      }
    } catch (err: any) {
      console.error(`[QuoteService] Unsubscribe error: ${err.message}`);
    }
  }

  /**
   * Get the latest cached price for a symbol.
   * Returns null if no price data is available.
   */
  getPrice(symbol: string): PriceData | null {
    const lpSymbol = this.normalizeSymbol(symbol);
    return this.priceCache.get(lpSymbol) ?? null;
  }

  /**
   * Get latest price as a number (for StopLossManager compatibility).
   * Throws if no price available.
   */
  async getPriceNumber(symbol: string): Promise<number> {
    const data = this.getPrice(symbol);
    if (data && data.lastPrice > 0) return data.lastPrice;

    // Try a direct fetch if cache miss
    if (this.quoteCtx) {
      try {
        const lpSymbol = this.normalizeSymbol(symbol);
        const quotes = await this.quoteCtx.quote([lpSymbol]);
        if (quotes.length > 0) {
          const q = quotes[0];
          const price = typeof q.lastDone.toNumber === 'function' ? q.lastDone.toNumber() : Number(q.lastDone);
          if (price > 0) {
            this.priceCache.set(lpSymbol, {
              symbol: lpSymbol,
              lastPrice: price,
              timestamp: Date.now(),
            });
            return price;
          }
        }
      } catch {
        // Fall through
      }
    }

    throw new Error(`No price data for ${symbol}`);
  }

  /**
   * Get all cached prices.
   */
  getAllPrices(): Map<string, PriceData> {
    return new Map(this.priceCache);
  }

  /**
   * Get the number of subscribed symbols.
   */
  getSubscriptionCount(): number {
    return this.subscribedSymbols.size;
  }

  /**
   * Fetch latest quotes for a batch of symbols and update cache.
   */
  private async refreshPrices(symbols: string[]): Promise<void> {
    if (!this.quoteCtx || symbols.length === 0) return;

    // Longport API has batch limits, process in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      try {
        const quotes = await this.quoteCtx.quote(chunk);
        for (const q of quotes) {
          const price = typeof q.lastDone.toNumber === 'function' ? q.lastDone.toNumber() : Number(q.lastDone);
          if (price > 0) {
            const data: PriceData = {
              symbol: q.symbol,
              lastPrice: price,
              timestamp: Date.now(),
              volume: q.volume != null ? Number(q.volume) : undefined,
              turnover: q.turnover != null ? (typeof q.turnover.toNumber === 'function' ? q.turnover.toNumber() : Number(q.turnover)) : undefined,
              high: q.high != null ? (typeof q.high.toNumber === 'function' ? q.high.toNumber() : Number(q.high)) : undefined,
              low: q.low != null ? (typeof q.low.toNumber === 'function' ? q.low.toNumber() : Number(q.low)) : undefined,
              open: q.open != null ? (typeof q.open.toNumber === 'function' ? q.open.toNumber() : Number(q.open)) : undefined,
              prevClose: q.prevClose != null ? (typeof q.prevClose.toNumber === 'function' ? q.prevClose.toNumber() : Number(q.prevClose)) : undefined,
            };
            this.priceCache.set(q.symbol, data);
            this.emit('price', data);
          }
        }
      } catch (err: any) {
        console.error(`[QuoteService] refreshPrices chunk error: ${err.message}`);
      }
    }
  }

  /**
   * Normalize symbol to Longport format (AAPL → AAPL.US).
   */
  private normalizeSymbol(symbol: string): string {
    if (symbol.includes('.')) return symbol;
    if (/^\d+$/.test(symbol)) return `${symbol}.HK`;
    return `${symbol}.US`;
  }
}
