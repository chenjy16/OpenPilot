// ─── Cross-Market Arbitrage Types ──────────────────────────────────────────

/** 支持的预测市场平台 */
export type Platform = 'polymarket' | 'kalshi' | 'myriad' | 'manifold';

/** 标准化市场数据 */
export interface NormalizedMarket {
  platform: Platform;
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  liquidity: number;
  endDate: string | null;
  resolutionSource: string;
  active: boolean;
}

/** 跨平台订单簿 */
export interface CrossMarketOrderBook {
  platform: Platform;
  marketId: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  bestBid: number;
  bestAsk: number;
  spread: number;
  timestamp: number;
}

/** 语义匹配结果 */
export interface MatchResult {
  marketA: { platform: Platform; marketId: string };
  marketB: { platform: Platform; marketId: string };
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  oracleMismatch: boolean;
  oracleMismatchReason?: string;
  fromCache: boolean;
}

/** 已确认的市场配对 */
export interface MarketPair {
  marketA: NormalizedMarket;
  marketB: NormalizedMarket;
  matchResult: MatchResult;
}

/** VWAP 计算结果 */
export interface VWAPResult {
  vwap: number;
  filledSize: number;
  levelsUsed: number;
}

/** Arb_Score 计算参数 */
export interface ArbScoreParams {
  profitPct: number;
  availableDepth: number;
  targetSize: number;
  maxBidAskSpread: number;
  totalFeePct: number;
}

/** 跨市场套利机会 */
export interface CrossMarketArbitrageOpportunity {
  id?: number;
  platformA: Platform;
  platformAMarketId: string;
  platformB: Platform;
  platformBMarketId: string;
  question: string;
  direction: 'A_YES_B_NO' | 'A_NO_B_YES';

  // 价格
  platformAYesPrice: number;
  platformANoPrice: number;
  platformBYesPrice: number;
  platformBNoPrice: number;

  // VWAP
  vwapBuyPrice: number;
  vwapSellPrice: number;

  // 成本与利润
  realArbitrageCost: number;
  platformAFee: number;
  platformBFee: number;
  totalFees: number;
  profitPct: number;

  // 评分与状态
  arbScore: number;
  liquidityWarning: boolean;
  oracleMismatch: boolean;
  depthStatus: 'sufficient' | 'insufficient_depth';

  // 时间
  detectedAt: number;
}

/** 匹配缓存记录 */
export interface MatchCacheRecord {
  id?: number;
  platformA: Platform;
  marketIdA: string;
  platformB: Platform;
  marketIdB: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  oracleMismatch: boolean;
  oracleMismatchReason?: string;
  marketEndDate: string | null;
  createdAt: number;
  expiresAt: number;
}

/** 平台费率配置 */
export const DEFAULT_PLATFORM_FEES: Record<Platform, number> = {
  polymarket: 0.02,
  kalshi: 0.03,
  myriad: 0.01,
  manifold: 0.0,
};

/** FinFeedAPI 配置 */
export interface FinFeedConfig {
  baseUrl: string;
  apiKey?: string;
  syncIntervalMs: number;
  timeoutMs: number;
}

/** 跨市场套利检测配置 */
export interface CrossMarketArbConfig {
  targetSize: number;
  profitThreshold: number;
  arbScoreThreshold: number;
  platformFees: Record<Platform, number>;
}
