/**
 * LongportAdapter — Real implementation of BrokerAdapter for Longport (长桥证券).
 *
 * Uses the official `longport` Node.js SDK to connect to Longport OpenAPI.
 *
 * Configuration via environment variables:
 *   LONGPORT_APP_KEY, LONGPORT_APP_SECRET, LONGPORT_ACCESS_TOKEN
 *   LONGPORT_REGION (optional: 'hk' or 'cn', default 'hk')
 *
 * Or pass ConfigParams directly to the constructor.
 *
 * - Query operations (getAccount, getPositions, getOrderStatus) support up to
 *   2 retries with 1-second delay.
 * - Order operations (submitOrder, cancelOrder) do NOT retry.
 */

import type {
  TradingOrder,
  BrokerAdapter,
  BrokerAccount,
  BrokerPosition,
  BrokerOrderResult,
} from './types';

import {
  Config,
  TradeContext,
  Decimal as LPDecimal,
  OrderType as LPOrderType,
  OrderSide as LPOrderSide,
  OrderStatus as LPOrderStatus,
  TimeInForceType,
} from 'longport';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeFailedResult(message: string): BrokerOrderResult {
  return {
    broker_order_id: '',
    status: 'failed',
    message,
  };
}

/**
 * Map our internal order type to Longport SDK OrderType.
 */
function mapOrderType(type: string): LPOrderType {
  switch (type) {
    case 'market': return LPOrderType.MO;
    case 'limit': return LPOrderType.LO;
    case 'stop': return LPOrderType.MIT;       // Market If Touched
    case 'stop_limit': return LPOrderType.LIT; // Limit If Touched
    default: return LPOrderType.LO;
  }
}

/**
 * Map our internal order side to Longport SDK OrderSide.
 */
function mapOrderSide(side: string): LPOrderSide {
  return side === 'sell' ? LPOrderSide.Sell : LPOrderSide.Buy;
}

/**
 * Map Longport SDK OrderStatus to our internal status string.
 */
function mapLPOrderStatus(status: LPOrderStatus): 'submitted' | 'rejected' | 'failed' {
  switch (status) {
    case LPOrderStatus.Filled:
    case LPOrderStatus.PartialFilled:
    case LPOrderStatus.New:
    case LPOrderStatus.NotReported:
    case LPOrderStatus.ReplacedNotReported:
    case LPOrderStatus.ProtectedNotReported:
    case LPOrderStatus.VarietiesNotReported:
    case LPOrderStatus.WaitToNew:
    case LPOrderStatus.WaitToReplace:
    case LPOrderStatus.PendingReplace:
    case LPOrderStatus.Replaced:
    case LPOrderStatus.WaitToCancel:
    case LPOrderStatus.PendingCancel:
    case LPOrderStatus.PartialWithdrawal:
      return 'submitted';
    case LPOrderStatus.Rejected:
      return 'rejected';
    case LPOrderStatus.Canceled:
    case LPOrderStatus.Expired:
    default:
      return 'failed';
  }
}

export interface LongportAdapterOptions {
  /** Longport App Key (overrides env LONGPORT_APP_KEY) */
  appKey?: string;
  /** Longport App Secret (overrides env LONGPORT_APP_SECRET) */
  appSecret?: string;
  /** Longport Access Token (overrides env LONGPORT_ACCESS_TOKEN) */
  accessToken?: string;
  /** API region: 'hk', 'sg', or 'cn' (overrides env LONGPORT_REGION, default 'hk') */
  region?: 'hk' | 'sg' | 'cn';
}

export class LongportAdapter implements BrokerAdapter {
  readonly name = 'longport';

  private readonly maxRetries = 2;
  private readonly retryDelayMs = 1000;

  private tradeCtx: TradeContext | null = null;
  private config: Config | null = null;
  private options: LongportAdapterOptions;

  constructor(options?: LongportAdapterOptions) {
    this.options = options ?? {};
  }

  /**
   * Update credentials at runtime (e.g. from UI settings).
   * Only resets the existing connection if credentials actually changed.
   */
  updateCredentials(options: LongportAdapterOptions): void {
    const changed =
      options.appKey !== this.options.appKey ||
      options.appSecret !== this.options.appSecret ||
      options.accessToken !== this.options.accessToken ||
      options.region !== this.options.region;

    this.options = { ...this.options, ...options };

    if (changed) {
      // Reset connection so next call uses new credentials
      this.tradeCtx = null;
      this.config = null;
    }
  }

  /**
   * Lazily initialize the Longport Config and TradeContext.
   * Reads from constructor options first, then falls back to env vars.
   */
  private async ensureContext(): Promise<TradeContext> {
    if (this.tradeCtx) return this.tradeCtx;

    const appKey = this.options.appKey ?? process.env.LONGPORT_APP_KEY;
    const appSecret = this.options.appSecret ?? process.env.LONGPORT_APP_SECRET;
    const accessToken = this.options.accessToken ?? process.env.LONGPORT_ACCESS_TOKEN;

    if (!appKey || !appSecret || !accessToken) {
      throw new Error(
        'Longport credentials not configured. Set LONGPORT_APP_KEY, LONGPORT_APP_SECRET, LONGPORT_ACCESS_TOKEN environment variables or pass them via constructor options.',
      );
    }

    const region = this.options.region ?? process.env.LONGPORT_REGION ?? 'hk';
    const isCN = region === 'cn';
    const baseUrl = isCN
      ? 'https://openapi.longportapp.cn'
      : 'https://openapi.longportapp.com';
    const quoteWsUrl = isCN
      ? 'wss://openapi-quote.longportapp.cn/v2'
      : 'wss://openapi-quote.longportapp.com/v2';
    const tradeWsUrl = isCN
      ? 'wss://openapi-trade.longportapp.cn/v2'
      : 'wss://openapi-trade.longportapp.com/v2';

    this.config = new Config({
      appKey,
      appSecret,
      accessToken,
      httpUrl: baseUrl,
      quoteWsUrl,
      tradeWsUrl,
      enablePrintQuotePackages: false,
    });

    this.tradeCtx = await TradeContext.new(this.config);
    return this.tradeCtx;
  }

  /**
   * Execute an async operation with retry logic for query operations.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          await sleep(this.retryDelayMs);
        }
      }
    }
    throw lastError;
  }

  /**
   * Extract a human-readable message from an unknown error value.
   */
  private extractErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err === undefined || err === null) return 'Unknown error (no details)';
    try { return JSON.stringify(err); } catch { return String(err); }
  }

  async testConnection(): Promise<boolean> {
    try {
      const ctx = await this.ensureContext();
      // Try fetching account balance as a connectivity check
      const balances = await ctx.accountBalance();
      return balances.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Normalize symbol to Longport format (e.g. AAPL → AAPL.US, 0700 → 0700.HK).
   * If the symbol already contains a dot (market suffix), return as-is.
   */
  private normalizeSymbol(symbol: string): string {
    if (symbol.includes('.')) return symbol;
    // If symbol is all digits, assume HK market
    if (/^\d+$/.test(symbol)) return `${symbol}.HK`;
    // Otherwise assume US market
    return `${symbol}.US`;
  }

  async submitOrder(order: TradingOrder): Promise<BrokerOrderResult> {
    try {
      const ctx = await this.ensureContext();

      const lpOrderType = mapOrderType(order.order_type);
      const lpSide = mapOrderSide(order.side);

      const opts: any = {
        symbol: this.normalizeSymbol(order.symbol),
        orderType: lpOrderType,
        side: lpSide,
        submittedQuantity: new LPDecimal(order.quantity),
        timeInForce: TimeInForceType.Day,
      };

      // Limit orders require a price
      if (order.price != null && (order.order_type === 'limit' || order.order_type === 'stop_limit')) {
        opts.submittedPrice = new LPDecimal(order.price);
      }

      // Stop / stop-limit orders require a trigger price
      if (order.stop_price != null && (order.order_type === 'stop' || order.order_type === 'stop_limit')) {
        opts.triggerPrice = new LPDecimal(order.stop_price);
      }

      const resp = await ctx.submitOrder(opts);

      return {
        broker_order_id: resp.orderId,
        status: 'submitted',
      };
    } catch (err: unknown) {
      return makeFailedResult(this.extractErrorMessage(err));
    }
  }

  async cancelOrder(brokerOrderId: string): Promise<BrokerOrderResult> {
    try {
      const ctx = await this.ensureContext();
      await ctx.cancelOrder(brokerOrderId);
      return {
        broker_order_id: brokerOrderId,
        status: 'submitted',
        message: 'Cancel request submitted',
      };
    } catch (err: unknown) {
      return makeFailedResult(this.extractErrorMessage(err));
    }
  }

  async getOrderStatus(brokerOrderId: string): Promise<BrokerOrderResult> {
    try {
      return await this.withRetry(async () => {
        const ctx = await this.ensureContext();
        const detail = await ctx.orderDetail(brokerOrderId);

        const result: BrokerOrderResult = {
          broker_order_id: detail.orderId,
          status: mapLPOrderStatus(detail.status),
          message: detail.msg || undefined,
        };

        // If there's execution data, include it
        const execQty = detail.executedQuantity;
        if (execQty && !execQty.isZero()) {
          result.filled_quantity = execQty.toNumber();
          const execPrice = detail.executedPrice;
          if (execPrice) {
            result.filled_price = execPrice.toNumber();
          }
        }

        return result;
      });
    } catch (err: unknown) {
      return makeFailedResult(this.extractErrorMessage(err));
    }
  }

  async getAccount(): Promise<BrokerAccount> {
    try {
      return await this.withRetry(async () => {
        const ctx = await this.ensureContext();
        const balances = await ctx.accountBalance();

        if (balances.length === 0) {
          return { total_assets: 0, available_cash: 0, frozen_cash: 0, currency: 'HKD' };
        }

        // Use the first (primary) account balance
        const bal = balances[0];
        const currency = bal.currency || 'HKD';

        // Sum up cash info for the primary currency
        let availableCash = 0;
        let frozenCash = 0;
        for (const info of bal.cashInfos) {
          if (info.currency === currency) {
            availableCash = info.availableCash.toNumber();
            frozenCash = info.frozenCash.toNumber();
            break;
          }
        }

        return {
          total_assets: bal.totalCash.toNumber(),
          available_cash: availableCash,
          frozen_cash: frozenCash,
          currency,
        };
      });
    } catch (err: unknown) {
      // Never throw — return zeroed account
      console.error(`[LongportAdapter] getAccount error: ${this.extractErrorMessage(err)}`);
      return { total_assets: 0, available_cash: 0, frozen_cash: 0, currency: 'HKD' };
    }
  }

  async getPositions(): Promise<BrokerPosition[]> {
    try {
      return await this.withRetry(async () => {
        const ctx = await this.ensureContext();
        const resp = await ctx.stockPositions();
        const positions: BrokerPosition[] = [];

        for (const channel of resp.channels) {
          for (const pos of channel.positions) {
            const qty = pos.quantity.toNumber();
            if (qty <= 0) continue;

            const costPrice = pos.costPrice.toNumber();
            positions.push({
              symbol: pos.symbol,
              quantity: qty,
              avg_cost: costPrice,
              current_price: costPrice, // fallback; will be overwritten by quote below
              market_value: qty * costPrice,
            });
          }
        }

        // Note: current_price is set to costPrice as fallback here.
        // PositionSyncer enriches positions with real-time prices from
        // QuoteService (which already maintains a WS connection + Finnhub
        // HTTP fallback), so we don't create a separate QuoteContext here.

        return positions;
      });
    } catch (err: unknown) {
      // Never throw — return empty positions
      console.error(`[LongportAdapter] getPositions error: ${this.extractErrorMessage(err)}`);
      return [];
    }
  }
}
