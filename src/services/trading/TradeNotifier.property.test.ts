// Feature: auto-quant-trading, Property 8: 通知消息包含必要字段
/**
 * Property-based tests for TradeNotifier — notification messages contain required fields.
 *
 * Property 8:
 * - Filled notification contains: symbol, side, quantity, filled_price, trading_mode
 * - Failed notification contains: symbol, reject_reason
 * - Risk alert contains all violation rule_names
 * - Stop-loss notification contains: trigger_type, symbol, triggered_price, pnl_amount
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
 */

import * as fc from 'fast-check';
import {
  formatOrderNotification,
  formatStopLossNotification,
  formatRiskAlert,
} from './TradeNotifier';
import type {
  TradingOrder,
  RiskCheckResult,
  StopLossTriggerEvent,
  StopLossRecord,
} from './types';

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Random non-empty symbol string */
const arbSymbol = fc.string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.'.split('')), minLength: 2, maxLength: 10 });

/** Random order side */
const arbSide = fc.constantFrom('buy' as const, 'sell' as const);

/** Random order type */
const arbOrderType = fc.constantFrom('market' as const, 'limit' as const, 'stop' as const, 'stop_limit' as const);

/** Random trading mode */
const arbTradingMode = fc.constantFrom('paper' as const, 'live' as const);

/** Random positive quantity */
const arbQuantity = fc.integer({ min: 1, max: 100_000 });

/** Random positive price */
const arbPrice = fc.double({ min: 0.01, max: 1_000_000, noNaN: true });

/** Random reject reason string */
const arbRejectReason = fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz _-'.split('')), minLength: 3, maxLength: 50 });

/** Random risk rule name */
const arbRuleName = fc.string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz _'.split('')), minLength: 3, maxLength: 30 });

/** Random TradingOrder with filled fields */
const arbFilledOrder: fc.Arbitrary<TradingOrder> = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  local_order_id: fc.string({ minLength: 3, maxLength: 20 }),
  symbol: arbSymbol,
  side: arbSide,
  order_type: arbOrderType,
  quantity: arbQuantity,
  price: fc.option(arbPrice, { nil: undefined }),
  status: fc.constant('filled' as const),
  trading_mode: arbTradingMode,
  filled_quantity: arbQuantity,
  filled_price: arbPrice,
  reject_reason: fc.constant(undefined),
  created_at: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
  updated_at: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
});

/** Random TradingOrder with failed/rejected fields */
const arbFailedOrder: fc.Arbitrary<TradingOrder> = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  local_order_id: fc.string({ minLength: 3, maxLength: 20 }),
  symbol: arbSymbol,
  side: arbSide,
  order_type: arbOrderType,
  quantity: arbQuantity,
  price: fc.option(arbPrice, { nil: undefined }),
  status: fc.constantFrom('rejected' as const, 'failed' as const),
  trading_mode: arbTradingMode,
  filled_quantity: fc.constant(0),
  filled_price: fc.constant(undefined),
  reject_reason: arbRejectReason,
  created_at: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
  updated_at: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
});

/** Random risk violation */
const arbViolation = fc.record({
  rule_type: fc.constantFrom(
    'max_order_amount' as const,
    'max_daily_amount' as const,
    'max_position_ratio' as const,
    'max_daily_loss' as const,
    'max_daily_trades' as const,
  ),
  rule_name: arbRuleName,
  threshold: fc.double({ min: 1, max: 1_000_000, noNaN: true }),
  current_value: fc.double({ min: 1, max: 1_000_000, noNaN: true }),
  message: fc.string({ minLength: 5, maxLength: 100 }),
});

/** Random non-empty violations array */
const arbViolations = fc.array(arbViolation, { minLength: 1, maxLength: 5 });

/** Random trigger type */
const arbTriggerType = fc.constantFrom('stop_loss' as const, 'take_profit' as const);

/** Random StopLossTriggerEvent */
const arbStopLossEvent: fc.Arbitrary<StopLossTriggerEvent> = fc
  .tuple(
    arbSymbol,
    arbPrice, // entry_price
    arbPrice, // stop_loss
    arbPrice, // take_profit
    arbPrice, // current_price
    arbTriggerType,
    fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }), // pnl_amount
    fc.integer({ min: 1, max: 100_000 }), // order_id
  )
  .map(([symbol, entryPrice, stopLoss, takeProfit, currentPrice, triggerType, pnlAmount, orderId]) => {
    const record: StopLossRecord = {
      id: orderId,
      order_id: orderId,
      symbol,
      side: 'buy',
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      status: 'active',
      created_at: Date.now(),
    };
    return {
      record,
      trigger_type: triggerType,
      current_price: currentPrice,
      pnl_amount: pnlAmount,
    } as StopLossTriggerEvent;
  });

// ─── Property 8: 通知消息包含必要字段 ──────────────────────────────────────

describe('TradeNotifier Property Tests', () => {
  // **Validates: Requirements 6.1**
  describe('filled notification contains required fields', () => {
    it('message includes symbol, side, filled_quantity, filled_price, trading_mode', () => {
      fc.assert(
        fc.property(arbFilledOrder, (order) => {
          const msg = formatOrderNotification(order, 'filled');

          expect(msg).toContain(String(order.symbol));
          expect(msg).toContain(String(order.side));
          expect(msg).toContain(String(order.filled_quantity));
          expect(msg).toContain(String(order.filled_price));
          expect(msg).toContain(String(order.trading_mode));
        }),
        { numRuns: 10 },
      );
    });
  });

  // **Validates: Requirements 6.2**
  describe('failed notification contains required fields', () => {
    it('message includes symbol and reject_reason', () => {
      fc.assert(
        fc.property(arbFailedOrder, (order) => {
          const msg = formatOrderNotification(order, 'failed');

          expect(msg).toContain(String(order.symbol));
          expect(msg).toContain(String(order.reject_reason));
        }),
        { numRuns: 10 },
      );
    });
  });

  // **Validates: Requirements 6.3**
  describe('risk alert contains all violation rule_names', () => {
    it('message includes every rule_name from violations array', () => {
      fc.assert(
        fc.property(arbViolations, (violations) => {
          const msg = formatRiskAlert(violations);

          for (const v of violations) {
            expect(msg).toContain(v.rule_name);
          }
        }),
        { numRuns: 10 },
      );
    });
  });

  // **Validates: Requirements 6.4**
  describe('stop-loss notification contains required fields', () => {
    it('message includes trigger_type, symbol, triggered_price, pnl_amount', () => {
      fc.assert(
        fc.property(arbStopLossEvent, (event) => {
          const msg = formatStopLossNotification(event);

          expect(msg).toContain(String(event.trigger_type));
          expect(msg).toContain(String(event.record.symbol));
          expect(msg).toContain(String(event.current_price));
          expect(msg).toContain(event.pnl_amount.toFixed(2));
        }),
        { numRuns: 10 },
      );
    });
  });
});
