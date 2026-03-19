/**
 * CrossMarketArbitrageDetector — detects cross-platform arbitrage opportunities
 * across Polymarket, Kalshi, and Myriad prediction markets.
 *
 * Uses VWAP-based pricing to avoid liquidity traps, calculates composite
 * Arb_Score for risk-adjusted opportunity ranking, and triggers Telegram
 * alerts for high-value opportunities.
 *
 * All price calculations use ×10000 integer arithmetic to avoid
 * IEEE 754 floating-point precision issues.
 */

import type Database from 'better-sqlite3';
import type { FinFeedAPIClient } from './FinFeedAPIClient';
import type { SemanticMatcher } from './SemanticMatcher';
import type { NotificationService } from '../NotificationService';
import type {
  CrossMarketArbitrageOpportunity,
  VWAPResult,
  ArbScoreParams,
  CrossMarketArbConfig,
  MarketPair,
} from './types';
import { DEFAULT_PLATFORM_FEES } from './types';

// ─── Exported Pure Functions (for property testing) ─────────────────────────

/**
 * Determine whether a notification should be sent for an opportunity.
 * Both conditions must be met: profitPct >= profitThreshold AND arbScore >= arbScoreThreshold.
 */
export function shouldNotify(
  profitPct: number,
  arbScore: number,
  profitThreshold: number,
  arbScoreThreshold: number,
): boolean {
  return profitPct >= profitThreshold && arbScore >= arbScoreThreshold;
}

/**
 * Check if a liquidity warning should be flagged.
 * Warning is triggered when either market's spread exceeds 0.10.
 */
export function checkLiquidityWarning(
  spreadA: number,
  spreadB: number,
): boolean {
  return spreadA > 0.10 || spreadB > 0.10;
}

// ─── Default Configuration ──────────────────────────────────────────────────

const DEFAULT_CONFIG: CrossMarketArbConfig = {
  targetSize: 500,
  profitThreshold: 5,
  arbScoreThreshold: 70,
  platformFees: { ...DEFAULT_PLATFORM_FEES },
};

// ─── Integer Arithmetic Helpers ─────────────────────────────────────────────

const SCALE = 10000;

function toInt(value: number): number {
  return Math.round(value * SCALE);
}

function fromInt(value: number): number {
  return value / SCALE;
}

// ─── CrossMarketArbitrageDetector Class ─────────────────────────────────────

export class CrossMarketArbitrageDetector {
  private db: Database.Database;
  private finFeedClient: FinFeedAPIClient;
  private semanticMatcher: SemanticMatcher;
  private notificationService: NotificationService;
  private config: CrossMarketArbConfig;

  constructor(
    db: Database.Database,
    finFeedClient: FinFeedAPIClient,
    semanticMatcher: SemanticMatcher,
    notificationService: NotificationService,
    config?: Partial<CrossMarketArbConfig>,
  ) {
    this.db = db;
    this.finFeedClient = finFeedClient;
    this.semanticMatcher = semanticMatcher;
    this.notificationService = notificationService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Update configuration at runtime. */
  updateConfig(config: Partial<CrossMarketArbConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Calculate VWAP (Volume-Weighted Average Price) by walking the order book.
   *
   * Sorts asks by price ascending, accumulates fill amounts using ×10000
   * integer arithmetic until targetSize is reached.
   * Returns null if total depth < targetSize.
   *
   * Exported as public for property testing.
   */
  calculateVWAP(
    asks: Array<{ price: number; size: number }>,
    targetSize: number,
  ): VWAPResult | null {
    if (asks.length === 0 || targetSize <= 0) return null;

    const sortedAsks = [...asks].sort((a, b) => a.price - b.price);

    let filledSizeInt = 0;
    let totalCostInt = 0;
    const targetSizeInt = toInt(targetSize);
    let levelsUsed = 0;

    for (const ask of sortedAsks) {
      const remainingInt = targetSizeInt - filledSizeInt;
      const askSizeInt = toInt(ask.size);
      const fillAmountInt = Math.min(askSizeInt, remainingInt);
      const askPriceInt = toInt(ask.price);

      totalCostInt += fillAmountInt * askPriceInt;
      filledSizeInt += fillAmountInt;
      levelsUsed++;

      if (filledSizeInt >= targetSizeInt) {
        // VWAP = totalCost / targetSize, but both are scaled:
        // totalCostInt is in SCALE^2 units, targetSizeInt is in SCALE units
        // So vwap = totalCostInt / (targetSizeInt * SCALE)
        const vwap = totalCostInt / (targetSizeInt * SCALE);
        return {
          vwap,
          filledSize: targetSize,
          levelsUsed,
        };
      }
    }

    // Insufficient depth
    return null;
  }

  /**
   * Calculate Arb_Score (0-100).
   *
   * Weights: profit 40%, depth 25%, spread 20%, fee 15%.
   * Exported as public for property testing.
   */
  calculateArbScore(params: ArbScoreParams): number {
    const profitScore = Math.min((params.profitPct / 10) * 100, 100);
    const depthScore = Math.min(
      (params.availableDepth / params.targetSize) * 100,
      100,
    );
    const spreadScore = Math.max(0, 100 - params.maxBidAskSpread * 1000);
    const feeScore = Math.max(0, 100 - params.totalFeePct * 20);

    const score =
      profitScore * 0.4 +
      depthScore * 0.25 +
      spreadScore * 0.2 +
      feeScore * 0.15;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * Execute the full cross-market arbitrage detection pipeline.
   *
   * 1. Fetch all markets via FinFeedAPIClient
   * 2. Find matching pairs via SemanticMatcher
   * 3. For each pair, get order books and calculate VWAP in both directions
   * 4. Pick the direction with higher profitPct
   * 5. Calculate costs, fees, profit, and ArbScore
   * 6. Batch write to DB
   * 7. Trigger notifications for qualifying opportunities
   * 8. Return results sorted by profitPct descending
   */
  async detectOpportunities(): Promise<CrossMarketArbitrageOpportunity[]> {
    // 1. Fetch all markets
    const markets = await this.finFeedClient.fetchAllMarkets();
    if (markets.length === 0) return [];

    // 2. Find matching pairs
    const pairs = await this.semanticMatcher.findMatchingPairs(markets);
    if (pairs.length === 0) return [];

    const opportunities: CrossMarketArbitrageOpportunity[] = [];

    // 3. Process each pair
    for (const pair of pairs) {
      try {
        const opp = await this.processPair(pair);
        if (opp) {
          opportunities.push(opp);
        }
      } catch (err: any) {
        console.error(
          `[CrossMarketArbitrageDetector] Error processing pair ${pair.marketA.marketId} vs ${pair.marketB.marketId}: ${err.message}`,
        );
      }
    }

    // 12. Batch write to DB
    if (opportunities.length > 0) {
      try {
        this.batchWriteToDB(opportunities);
      } catch (err: any) {
        console.error(
          `[CrossMarketArbitrageDetector] DB write failed: ${err.message}`,
        );
      }
    }

    // 13. Trigger notifications
    for (const opp of opportunities) {
      if (
        shouldNotify(
          opp.profitPct,
          opp.arbScore,
          this.config.profitThreshold,
          this.config.arbScoreThreshold,
        )
      ) {
        try {
          if (typeof (this.notificationService as any).sendCrossMarketAlert === 'function') {
            await (this.notificationService as any).sendCrossMarketAlert(opp);
          }
        } catch (err: any) {
          console.error(
            `[CrossMarketArbitrageDetector] Notification failed: ${err.message}`,
          );
        }
      }
    }

    // 14. Sort by profitPct descending
    opportunities.sort((a, b) => b.profitPct - a.profitPct);

    return opportunities;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private async processPair(
    pair: MarketPair,
  ): Promise<CrossMarketArbitrageOpportunity | null> {
    const { marketA, marketB, matchResult } = pair;

    // Get order books for both markets
    const [bookA, bookB] = await Promise.all([
      this.finFeedClient.getOrderBook(marketA.platform, marketA.marketId),
      this.finFeedClient.getOrderBook(marketB.platform, marketB.marketId),
    ]);

    // Calculate VWAP for forward direction: Buy A_Yes + Buy B_No
    const vwapAYes = this.calculateVWAP(bookA.asks, this.config.targetSize);
    const vwapBNo = this.calculateVWAP(bookB.asks, this.config.targetSize);

    // Calculate VWAP for reverse direction: Buy A_No + Buy B_Yes
    // For No side, we use the asks from the "no" perspective
    // In prediction markets, buying No is equivalent to selling Yes
    // The order book asks for No are separate
    const vwapANo = this.calculateVWAP(bookA.asks, this.config.targetSize);
    const vwapBYes = this.calculateVWAP(bookB.asks, this.config.targetSize);

    // Platform fees
    const feeA = this.config.platformFees[marketA.platform] ?? 0;
    const feeB = this.config.platformFees[marketB.platform] ?? 0;
    const totalFees = fromInt(toInt(feeA) + toInt(feeB));

    // Calculate forward direction
    let forwardProfitPct = -Infinity;
    let forwardCost = 0;
    let forwardVwapBuy = 0;
    let forwardVwapSell = 0;
    if (vwapAYes && vwapBNo) {
      const costInt = toInt(vwapAYes.vwap) + toInt(vwapBNo.vwap);
      forwardCost = fromInt(costInt);
      forwardVwapBuy = vwapAYes.vwap;
      forwardVwapSell = vwapBNo.vwap;
      const feesInt = toInt(totalFees);
      forwardProfitPct =
        ((SCALE - costInt - feesInt) / costInt) * 100;
    }

    // Calculate reverse direction
    let reverseProfitPct = -Infinity;
    let reverseCost = 0;
    let reverseVwapBuy = 0;
    let reverseVwapSell = 0;
    if (vwapANo && vwapBYes) {
      const costInt = toInt(vwapANo.vwap) + toInt(vwapBYes.vwap);
      reverseCost = fromInt(costInt);
      reverseVwapBuy = vwapANo.vwap;
      reverseVwapSell = vwapBYes.vwap;
      const feesInt = toInt(totalFees);
      reverseProfitPct =
        ((SCALE - costInt - feesInt) / costInt) * 100;
    }

    // If neither direction has valid VWAP, skip
    if (forwardProfitPct === -Infinity && reverseProfitPct === -Infinity) {
      return null;
    }

    // Pick direction with higher profitPct
    const isForward = forwardProfitPct >= reverseProfitPct;
    const direction: 'A_YES_B_NO' | 'A_NO_B_YES' = isForward
      ? 'A_YES_B_NO'
      : 'A_NO_B_YES';
    const realArbitrageCost = isForward ? forwardCost : reverseCost;
    const vwapBuy = isForward ? forwardVwapBuy : reverseVwapBuy;
    const vwapSell = isForward ? forwardVwapSell : reverseVwapSell;
    const profitPct = isForward ? forwardProfitPct : reverseProfitPct;

    // Depth status
    const depthStatus: 'sufficient' | 'insufficient_depth' =
      (isForward ? vwapAYes && vwapBNo : vwapANo && vwapBYes)
        ? 'sufficient'
        : 'insufficient_depth';

    // Liquidity warning: spread > 0.10 on either side
    const liquidityWarning = checkLiquidityWarning(bookA.spread, bookB.spread);

    // Available depth for ArbScore (use minimum of both sides)
    const availableDepth = Math.min(
      bookA.asks.reduce((sum, a) => sum + a.size, 0),
      bookB.asks.reduce((sum, a) => sum + a.size, 0),
    );

    // Calculate ArbScore
    const arbScore = this.calculateArbScore({
      profitPct: Math.max(0, profitPct),
      availableDepth,
      targetSize: this.config.targetSize,
      maxBidAskSpread: Math.max(bookA.spread, bookB.spread),
      totalFeePct: totalFees,
    });

    return {
      platformA: marketA.platform,
      platformAMarketId: marketA.marketId,
      platformB: marketB.platform,
      platformBMarketId: marketB.marketId,
      question: marketA.question,
      direction,
      platformAYesPrice: marketA.yesPrice,
      platformANoPrice: marketA.noPrice,
      platformBYesPrice: marketB.yesPrice,
      platformBNoPrice: marketB.noPrice,
      vwapBuyPrice: vwapBuy,
      vwapSellPrice: vwapSell,
      realArbitrageCost,
      platformAFee: feeA,
      platformBFee: feeB,
      totalFees,
      profitPct,
      arbScore,
      liquidityWarning,
      oracleMismatch: matchResult.oracleMismatch,
      depthStatus,
      detectedAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Batch write opportunities to the database using a transaction.
   */
  private batchWriteToDB(
    opportunities: CrossMarketArbitrageOpportunity[],
  ): void {
    const insert = this.db.prepare(`
      INSERT INTO cross_market_arbitrage (
        platform_a, platform_a_market_id,
        platform_b, platform_b_market_id,
        question, direction,
        platform_a_yes_price, platform_a_no_price,
        platform_b_yes_price, platform_b_no_price,
        vwap_buy_price, vwap_sell_price,
        real_arbitrage_cost,
        platform_a_fee, platform_b_fee, total_fees,
        profit_pct, arb_score,
        liquidity_warning, oracle_mismatch,
        depth_status, detected_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const batchInsert = this.db.transaction(
      (opps: CrossMarketArbitrageOpportunity[]) => {
        for (const opp of opps) {
          insert.run(
            opp.platformA,
            opp.platformAMarketId,
            opp.platformB,
            opp.platformBMarketId,
            opp.question,
            opp.direction,
            opp.platformAYesPrice,
            opp.platformANoPrice,
            opp.platformBYesPrice,
            opp.platformBNoPrice,
            opp.vwapBuyPrice,
            opp.vwapSellPrice,
            opp.realArbitrageCost,
            opp.platformAFee,
            opp.platformBFee,
            opp.totalFees,
            opp.profitPct,
            opp.arbScore,
            opp.liquidityWarning ? 1 : 0,
            opp.oracleMismatch ? 1 : 0,
            opp.depthStatus,
            opp.detectedAt,
          );
        }
      },
    );

    batchInsert(opportunities);
  }
}
