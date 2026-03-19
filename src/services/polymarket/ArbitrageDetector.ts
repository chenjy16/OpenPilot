/**
 * ArbitrageDetector — detects pricing inefficiencies in Polymarket markets.
 *
 * Identifies markets where Yes + No midpoint prices deviate from 1.0,
 * indicating potential arbitrage opportunities. Uses CLOB API midpoint
 * prices (not Gamma API) for accurate live order book pricing.
 */

import type { PolymarketTradingService } from './PolymarketTradingService';
import type { ArbitrageOpportunity } from './types';
import type { MarketSnapshot } from '../PolymarketScanner';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const DEFAULT_THRESHOLD = 0.02;

export class ArbitrageDetector {
  private tradingService: PolymarketTradingService;
  private threshold: number;

  constructor(tradingService: PolymarketTradingService, threshold?: number) {
    this.tradingService = tradingService;
    this.threshold = threshold ?? DEFAULT_THRESHOLD;
  }

  /**
   * Update the deviation threshold for flagging arbitrage opportunities.
   */
  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  /**
   * Detect arbitrage opportunities across a list of markets.
   *
   * For each market, fetches CLOB token IDs from the Gamma API, then
   * queries CLOB midpoint prices and order book data for Yes/No outcomes.
   * Markets where |yes + no - 1.0| > threshold are flagged.
   *
   * Results are sorted by profit_pct descending.
   * Markets that fail price fetching are silently skipped.
   */
  async detectOpportunities(
    markets: MarketSnapshot[],
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    for (const market of markets) {
      try {
        const opportunity = await this.analyzeMarket(market);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      } catch {
        // Skip markets where price fetch fails — graceful degradation
      }
    }

    // Sort by profit_pct descending
    opportunities.sort((a, b) => b.profit_pct - a.profit_pct);

    return opportunities;
  }

  /**
   * Analyze a single market for arbitrage. Returns an opportunity if the
   * deviation exceeds the threshold, or null otherwise.
   */
  private async analyzeMarket(
    market: MarketSnapshot,
  ): Promise<ArbitrageOpportunity | null> {
    // Fetch CLOB token IDs from Gamma API
    const tokenIds = await this.fetchTokenIds(market.conditionId);
    if (!tokenIds) return null;

    const [yesTokenId, noTokenId] = tokenIds;

    // Fetch CLOB midpoint prices for both outcomes
    const [yesPrice, noPrice] = await Promise.all([
      this.tradingService.getMidpoint(yesTokenId),
      this.tradingService.getMidpoint(noTokenId),
    ]);

    const sum = yesPrice + noPrice;
    const deviation = Math.abs(sum - 1.0);

    // Only flag if deviation exceeds threshold
    if (deviation <= this.threshold) return null;

    // Fetch order book data for spread information
    const [yesBook, noBook] = await Promise.all([
      this.tradingService.getOrderBook(yesTokenId),
      this.tradingService.getOrderBook(noTokenId),
    ]);

    const profitPct = Math.abs(1.0 - sum) * 100;

    return {
      market_id: market.id,
      question: market.question,
      yes_price: yesPrice,
      no_price: noPrice,
      sum,
      deviation,
      profit_pct: profitPct,
      best_bid_yes: yesBook.best_bid,
      best_ask_yes: yesBook.best_ask,
      best_bid_no: noBook.best_bid,
      best_ask_no: noBook.best_ask,
      spread_yes: yesBook.spread,
      spread_no: noBook.spread,
    };
  }

  /**
   * Fetch CLOB token IDs (Yes, No) for a market from the Gamma API.
   *
   * Returns [yesTokenId, noTokenId] or null if unavailable.
   */
  private async fetchTokenIds(
    conditionId: string,
  ): Promise<[string, string] | null> {
    const url = `${GAMMA_API}/markets?id=${encodeURIComponent(conditionId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!resp.ok) return null;

      const data = await resp.json();
      const market = Array.isArray(data) ? data[0] : data;
      if (!market) return null;

      const raw = market.clobTokenIds ?? market.clob_token_ids;
      if (!raw) return null;

      const ids: string[] =
        typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (!Array.isArray(ids) || ids.length < 2) return null;

      return [ids[0], ids[1]];
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
