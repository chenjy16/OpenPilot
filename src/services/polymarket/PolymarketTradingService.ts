/**
 * PolymarketTradingService — core trading service for Polymarket CLOB API.
 *
 * Uses the official @polymarket/clob-client SDK for authentication (EIP-712
 * signing) and all CLOB operations. Private key is NEVER logged, persisted,
 * or exposed in API responses.
 */

import type Database from 'better-sqlite3';
import { ClobClient, Side as SDKSide } from '@polymarket/clob-client';
import type { ApiKeyCreds, Chain } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import type { ClobSigner } from '@polymarket/clob-client';
import type {
  PolymarketTradingConfig,
  ClobCredentials,
  PolymarketOrder,
  OrderResult,
  OrderBookData,
  PolymarketPosition,
  TradeRecord,
} from './types';

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_CLOB_API_URL = 'https://clob.polymarket.com';
const DEFAULT_DATA_API_URL = 'https://data-api.polymarket.com';
const DEFAULT_CHAIN_ID = 137;

// ─── Config resolution ─────────────────────────────────────────────────────

export function resolveConfig(
  config?: Partial<PolymarketTradingConfig>,
): PolymarketTradingConfig {
  return {
    clobApiUrl:
      config?.clobApiUrl ||
      process.env.POLYMARKET_CLOB_API_URL ||
      DEFAULT_CLOB_API_URL,
    dataApiUrl:
      config?.dataApiUrl ||
      process.env.POLYMARKET_DATA_API_URL ||
      DEFAULT_DATA_API_URL,
    chainId: config?.chainId || DEFAULT_CHAIN_ID,
  };
}

// ─── Ethers v6 → SDK signer adapter ────────────────────────────────────────

/**
 * Wraps an ethers v6 Wallet into the EthersSigner interface expected by
 * @polymarket/clob-client (which uses ethers v5's `_signTypedData`).
 */
function toEthersSigner(wallet: ethers.Wallet): ClobSigner {
  return {
    _signTypedData: (domain: any, types: any, value: any) =>
      wallet.signTypedData(domain, types, value),
    getAddress: () => Promise.resolve(wallet.address),
  } as ClobSigner;
}

// ─── Service ───────────────────────────────────────────────────────────────

export class PolymarketTradingService {
  private db: Database.Database;
  private config: PolymarketTradingConfig;
  private privateKey: string | undefined;
  private credentials: ClobCredentials | null = null;
  private clobClient: ClobClient | null = null;

  constructor(db: Database.Database, config?: Partial<PolymarketTradingConfig>) {
    this.db = db;
    this.config = resolveConfig(config);
    let key = process.env.POLYMARKET_PRIVATE_KEY || undefined;
    // MetaMask exports private keys without 0x prefix — auto-add it
    if (key && /^[0-9a-fA-F]{64}$/.test(key)) {
      key = '0x' + key;
    }
    this.privateKey = key;
  }

  // ── Getters (for testing) ──────────────────────────────────────────────

  /** Resolved service configuration. */
  getConfig(): PolymarketTradingConfig {
    return this.config;
  }

  // ── Authentication ─────────────────────────────────────────────────────

  /**
   * Returns true when a private key is present and trading can proceed.
   */
  isConfigured(): boolean {
    // Re-check env in case the key was set after construction (e.g. via config UI)
    if (!this.privateKey) {
      let key = process.env.POLYMARKET_PRIVATE_KEY || undefined;
      if (key && /^[0-9a-fA-F]{64}$/.test(key)) {
        key = '0x' + key;
      }
      this.privateKey = key;
    }
    return typeof this.privateKey === 'string' && this.privateKey.length > 0;
  }

  /**
   * Derive and cache CLOB API credentials using the official SDK.
   *
   * Creates an ethers Wallet from the private key, initialises a ClobClient,
   * calls createOrDeriveApiKey() for EIP-712 signed authentication, then
   * re-creates the ClobClient with the derived credentials for subsequent calls.
   *
   * @throws Error when the private key is not configured or the SDK returns an error.
   *         Error messages NEVER contain the private key.
   */
  async ensureAuthenticated(): Promise<void> {
    if (this.credentials && this.clobClient) return;

    if (!this.isConfigured()) {
      throw new Error('Trading not configured: POLYMARKET_PRIVATE_KEY not set');
    }

    try {
      const wallet = new ethers.Wallet(this.privateKey!);
      const signer = toEthersSigner(wallet);
      const chainId = this.config.chainId as Chain;

      // Step 1: Create an unauthenticated client to derive API keys
      const tempClient = new ClobClient(
        this.config.clobApiUrl,
        chainId,
        signer,
      );

      const creds: ApiKeyCreds = await tempClient.createOrDeriveApiKey();

      if (!creds.key || !creds.secret || !creds.passphrase) {
        throw new Error(
          'CLOB authentication failed: incomplete credentials returned',
        );
      }

      this.credentials = {
        apiKey: creds.key,
        apiSecret: creds.secret,
        passphrase: creds.passphrase,
      };

      // Step 2: Re-create client with credentials for authenticated requests
      this.clobClient = new ClobClient(
        this.config.clobApiUrl,
        chainId,
        signer,
        creds,
      );
    } catch (err: unknown) {
      // Re-throw but guarantee the private key is never in the message
      if (err instanceof Error) {
        err.message = this.sanitise(err.message);
        throw err;
      }
      throw new Error('CLOB authentication failed: unknown error');
    }
  }

  // ── Trading operations ─────────────────────────────────────────────────

  async placeOrder(order: PolymarketOrder): Promise<OrderResult> {
    // Validate price range [0.01, 0.99]
    if (order.price < 0.01 || order.price > 0.99) {
      throw new Error('Validation error: price must be between 0.01 and 0.99');
    }

    // Validate size is positive
    if (order.size <= 0) {
      throw new Error('Validation error: size must be a positive number');
    }

    await this.ensureAuthenticated();

    try {
      const sdkSide = order.side === 'BUY' ? SDKSide.BUY : SDKSide.SELL;

      const response = await this.clobClient!.createAndPostOrder({
        tokenID: order.token_id,
        side: sdkSide,
        price: order.price,
        size: order.size,
      });

      const orderId = String(
        response?.orderID ?? response?.orderIds?.[0] ?? response?.id ?? '',
      );
      const status = String(response?.status ?? 'submitted');

      // Record order in polymarket_orders table
      this.db.prepare(
        `INSERT INTO polymarket_orders (order_id, market_id, token_id, side, price, size, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(orderId, order.token_id, order.token_id, order.side, order.price, order.size, status);

      return { order_id: orderId, status };
    } catch (err: unknown) {
      if (err instanceof Error) {
        err.message = this.sanitise(err.message);
      }
      throw err;
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.ensureAuthenticated();

    try {
      await this.clobClient!.cancelOrder({ orderID: orderId });
    } catch (err: unknown) {
      if (err instanceof Error) {
        err.message = this.sanitise(err.message);
      }
      throw err;
    }

    // Update local DB record to canceled
    this.db.prepare(
      `UPDATE polymarket_orders SET status = 'canceled', updated_at = unixepoch() WHERE order_id = ?`,
    ).run(orderId);
  }

  async cancelAllOrders(): Promise<number> {
    await this.ensureAuthenticated();

    try {
      await this.clobClient!.cancelAll();
    } catch (err: unknown) {
      if (err instanceof Error) {
        err.message = this.sanitise(err.message);
      }
      throw err;
    }

    // Update all non-terminal orders in local DB
    const result = this.db.prepare(
      `UPDATE polymarket_orders SET status = 'canceled', updated_at = unixepoch() WHERE status NOT IN ('canceled', 'filled', 'failed')`,
    ).run();

    return result.changes;
  }

  // ── Public endpoints (no auth required) ────────────────────────────────

  async getOrderBook(tokenId: string): Promise<OrderBookData> {
    // Use a lightweight unauthenticated client for public endpoints
    const publicClient = new ClobClient(
      this.config.clobApiUrl,
      this.config.chainId as Chain,
    );

    const data = await publicClient.getOrderBook(tokenId);

    const bids = (data.bids ?? []).map((b: any) => ({
      price: Number(b.price),
      size: Number(b.size),
    }));
    const asks = (data.asks ?? []).map((a: any) => ({
      price: Number(a.price),
      size: Number(a.size),
    }));

    const best_bid = bids.length > 0 ? Math.max(...bids.map((b: { price: number }) => b.price)) : 0;
    const best_ask = asks.length > 0 ? Math.min(...asks.map((a: { price: number }) => a.price)) : 0;
    const spread = best_ask - best_bid;
    const midpoint = (best_bid + best_ask) / 2;

    return { bids, asks, best_bid, best_ask, spread, midpoint };
  }

  async getMidpoint(tokenId: string): Promise<number> {
    const publicClient = new ClobClient(
      this.config.clobApiUrl,
      this.config.chainId as Chain,
    );

    const result = await publicClient.getMidpoint(tokenId);
    return Number(result ?? 0);
  }

  // ── Authenticated data queries ─────────────────────────────────────────

  async getPositions(): Promise<PolymarketPosition[]> {
    await this.ensureAuthenticated();

    // The CLOB client doesn't have a direct getPositions method.
    // Positions are available via the Data API with auth headers.
    const creds = this.credentials!;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const wallet = new ethers.Wallet(this.privateKey!);
    const address = await wallet.getAddress();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      POLY_ADDRESS: address.toLowerCase(),
      POLY_SIGNATURE: '',
      POLY_TIMESTAMP: timestamp,
      POLY_API_KEY: creds.apiKey,
      POLY_PASSPHRASE: creds.passphrase,
      POLY_SECRET: creds.apiSecret,
    };

    const url = `${this.config.dataApiUrl}/positions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let rawPositions: Array<Record<string, any>> = [];
    try {
      const resp = await fetch(url, { headers, signal: controller.signal });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`Data API error (${resp.status}): ${this.sanitise(errBody)}`);
      }
      rawPositions = await resp.json() as Array<Record<string, any>>;
    } finally {
      clearTimeout(timeout);
    }

    const positions: PolymarketPosition[] = [];

    for (const pos of rawPositions) {
      const tokenId = String(pos.token_id ?? pos.asset ?? '');
      const size = Number(pos.size ?? 0);
      if (size === 0) continue;

      const avgEntryPrice = Number(pos.avgPrice ?? pos.avg_price ?? 0);
      const outcome = (String(pos.outcome ?? 'Yes')) as 'Yes' | 'No';
      const marketId = String(pos.condition_id ?? pos.market_id ?? '');

      let currentPrice = Number(pos.curPrice ?? pos.cur_price ?? 0);
      let marketQuestion = String(pos.market ?? '');

      if (marketId) {
        try {
          const gammaUrl = `https://gamma-api.polymarket.com/markets?id=${encodeURIComponent(marketId)}`;
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15_000);
          try {
            const resp = await fetch(gammaUrl, { signal: ctrl.signal });
            if (resp.ok) {
              const gammaData = await resp.json() as any;
              const market = Array.isArray(gammaData) ? gammaData[0] : gammaData;
              if (market) {
                if (market.question) marketQuestion = market.question;
                const pricesStr = market.outcomePrices ?? market.outcome_prices;
                if (pricesStr) {
                  try {
                    const prices = JSON.parse(pricesStr) as number[];
                    currentPrice = outcome === 'Yes' ? (prices[0] ?? currentPrice) : (prices[1] ?? currentPrice);
                  } catch { /* keep existing */ }
                }
              }
            }
          } finally {
            clearTimeout(t);
          }
        } catch { /* Gamma enrichment is best-effort */ }
      }

      const unrealizedPnl = (currentPrice - avgEntryPrice) * size;

      positions.push({
        market_question: marketQuestion,
        token_id: tokenId,
        outcome,
        size,
        avg_entry_price: avgEntryPrice,
        current_price: currentPrice,
        unrealized_pnl: unrealizedPnl,
      });
    }

    return positions;
  }

  async getTradeHistory(
    limit?: number,
    offset?: number,
  ): Promise<TradeRecord[]> {
    const effectiveLimit = Math.min(Math.max(1, limit ?? 50), 200);
    const effectiveOffset = Math.max(0, offset ?? 0);

    await this.ensureAuthenticated();

    // Use the SDK's getTrades method for authenticated trade history
    try {
      const trades = await this.clobClient!.getTrades(
        undefined, // params — use defaults
        false,     // only_first_page
      );

      // Apply offset and limit manually since SDK may not support them directly
      const sliced = trades.slice(effectiveOffset, effectiveOffset + effectiveLimit);

      return sliced.map((t: any) => ({
        timestamp: Number(t.timestamp ?? t.match_time ?? 0),
        market_question: String(t.market ?? t.market_question ?? ''),
        side: (String(t.side ?? 'BUY').toUpperCase() as 'BUY' | 'SELL'),
        price: Number(t.price ?? 0),
        size: Number(t.size ?? 0),
        fee: Number(t.fee ?? 0),
      }));
    } catch (err: unknown) {
      if (err instanceof Error) {
        err.message = this.sanitise(err.message);
      }
      throw err;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Remove the private key value from any string to prevent accidental leaks.
   */
  private sanitise(text: string): string {
    if (!this.privateKey) return text;
    return text.replaceAll(this.privateKey, '[REDACTED]');
  }
}
