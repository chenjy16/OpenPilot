// ─── Polymarket Trading Types ──────────────────────────────────────────────

/** Order side for Polymarket (binary outcomes) */
export type PolymarketSide = 'BUY' | 'SELL';

/** Order status lifecycle */
export type PolymarketOrderStatus = 'pending' | 'submitted' | 'filled' | 'canceled' | 'failed';

/** Service configuration */
export interface PolymarketTradingConfig {
  clobApiUrl: string;    // default: https://clob.polymarket.com
  dataApiUrl: string;    // default: https://data-api.polymarket.com
  chainId: number;       // default: 137
}

/** CLOB API derived credentials */
export interface ClobCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

/** Order placement request */
export interface PolymarketOrder {
  token_id: string;
  side: PolymarketSide;
  price: number;   // 0.01–0.99
  size: number;     // positive
}

/** Order placement result */
export interface OrderResult {
  order_id: string;
  status: string;
}

/** Order book snapshot */
export interface OrderBookData {
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  best_bid: number;
  best_ask: number;
  spread: number;
  midpoint: number;
}

/** User position on a market */
export interface PolymarketPosition {
  market_question: string;
  token_id: string;
  outcome: 'Yes' | 'No';
  size: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pnl: number;
}

/** Historical trade record */
export interface TradeRecord {
  timestamp: number;
  market_question: string;
  side: PolymarketSide;
  price: number;
  size: number;
  fee: number;
}

/** Detected arbitrage opportunity */
export interface ArbitrageOpportunity {
  market_id: string;
  question: string;
  yes_price: number;
  no_price: number;
  sum: number;
  deviation: number;
  profit_pct: number;
  best_bid_yes: number;
  best_ask_yes: number;
  best_bid_no: number;
  best_ask_no: number;
  spread_yes: number;
  spread_no: number;
}
