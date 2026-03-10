/**
 * PaperTradingEngine - Simulated Trading Engine
 *
 * Simulates order matching without connecting to a real broker.
 * - Market orders fill immediately at the provided current price
 * - Limit orders fill when price conditions are met
 * - Maintains a paper account balance and paper positions
 * - Supports configurable commission rates
 */

import type Database from 'better-sqlite3';
import type { TradingOrder, BrokerAccount, BrokerPosition, BrokerOrderResult } from './types';

export class PaperTradingEngine {
  private db: Database.Database;
  private config: { initial_capital: number; commission_rate: number };

  constructor(db: Database.Database, config: { initial_capital: number; commission_rate: number }) {
    this.db = db;
    this.config = config;

    // Initialize paper_account with a single row if not exists
    this.db.prepare(`
      INSERT OR IGNORE INTO paper_account (id, initial_capital, available_cash, frozen_cash, commission_rate)
      VALUES (1, @initial_capital, @initial_capital, 0, @commission_rate)
    `).run({
      initial_capital: config.initial_capital,
      commission_rate: config.commission_rate,
    });
  }

  /**
   * Submit an order for simulated execution.
   * Market orders fill immediately at currentPrice.
   * Limit orders check price conditions before filling.
   */
  async submitOrder(order: TradingOrder, currentPrice: number): Promise<BrokerOrderResult> {
    if (order.order_type === 'market') {
      return this.fillOrder(order, currentPrice);
    }

    // Limit order: check price condition
    if (order.order_type === 'limit') {
      const limitPrice = order.price ?? currentPrice;
      if (order.side === 'buy' && currentPrice <= limitPrice) {
        return this.fillOrder(order, currentPrice);
      }
      if (order.side === 'sell' && currentPrice >= limitPrice) {
        return this.fillOrder(order, currentPrice);
      }
      // Condition not met — pending
      return {
        status: 'submitted',
        broker_order_id: order.local_order_id,
      };
    }

    // For other order types (stop, stop_limit), treat as pending for now
    return {
      status: 'submitted',
      broker_order_id: order.local_order_id,
    };
  }

  /**
   * Cancel a pending order.
   */
  cancelOrder(localOrderId: string): BrokerOrderResult {
    return {
      status: 'submitted',
      broker_order_id: localOrderId,
      message: 'Cancelled',
    };
  }

  /**
   * Get the simulated account information.
   */
  getAccount(): BrokerAccount {
    const account = this.db.prepare('SELECT * FROM paper_account WHERE id = 1').get() as any;
    const positionsValue = this.getPositionsTotalValue();

    return {
      total_assets: account.available_cash + positionsValue,
      available_cash: account.available_cash,
      frozen_cash: account.frozen_cash,
      currency: 'CNY',
    };
  }

  /**
   * Get all simulated positions.
   */
  getPositions(): BrokerPosition[] {
    const rows = this.db.prepare(
      'SELECT * FROM paper_positions WHERE quantity > 0'
    ).all() as any[];

    return rows.map((row) => ({
      symbol: row.symbol,
      quantity: row.quantity,
      avg_cost: row.avg_cost,
      current_price: row.avg_cost, // fallback: use avg_cost when no live price
      market_value: row.quantity * row.avg_cost,
    }));
  }

  /**
   * Check pending limit orders against current prices.
   * Returns empty array — limit order checking is done via submitOrder.
   */
  checkPendingOrders(_priceMap: Record<string, number>): BrokerOrderResult[] {
    return [];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private fillOrder(order: TradingOrder, fillPrice: number): BrokerOrderResult {
    const totalCost = order.quantity * fillPrice;
    const commission = totalCost * this.config.commission_rate;

    if (order.side === 'buy') {
      return this.executeBuy(order, fillPrice, totalCost, commission);
    } else {
      return this.executeSell(order, fillPrice, totalCost, commission);
    }
  }

  private executeBuy(
    order: TradingOrder,
    fillPrice: number,
    totalCost: number,
    commission: number,
  ): BrokerOrderResult {
    const account = this.db.prepare('SELECT * FROM paper_account WHERE id = 1').get() as any;

    if (account.available_cash < totalCost + commission) {
      return {
        status: 'rejected',
        broker_order_id: order.local_order_id,
        message: 'Insufficient funds',
      };
    }

    // Deduct cash
    this.db.prepare(`
      UPDATE paper_account
      SET available_cash = available_cash - @deduction, updated_at = unixepoch()
      WHERE id = 1
    `).run({ deduction: totalCost + commission });

    // Update or create position with weighted average cost
    const existing = this.db.prepare(
      'SELECT * FROM paper_positions WHERE symbol = ?'
    ).get(order.symbol) as any;

    if (existing) {
      const newQuantity = existing.quantity + order.quantity;
      const newAvgCost =
        (existing.quantity * existing.avg_cost + order.quantity * fillPrice) / newQuantity;
      this.db.prepare(`
        UPDATE paper_positions
        SET quantity = @quantity, avg_cost = @avg_cost, updated_at = unixepoch()
        WHERE symbol = @symbol
      `).run({ quantity: newQuantity, avg_cost: newAvgCost, symbol: order.symbol });
    } else {
      this.db.prepare(`
        INSERT INTO paper_positions (symbol, quantity, avg_cost, updated_at)
        VALUES (@symbol, @quantity, @avg_cost, unixepoch())
      `).run({ symbol: order.symbol, quantity: order.quantity, avg_cost: fillPrice });
    }

    return {
      status: 'submitted',
      broker_order_id: order.local_order_id,
      filled_quantity: order.quantity,
      filled_price: fillPrice,
    };
  }

  private executeSell(
    order: TradingOrder,
    fillPrice: number,
    totalCost: number,
    commission: number,
  ): BrokerOrderResult {
    const existing = this.db.prepare(
      'SELECT * FROM paper_positions WHERE symbol = ?'
    ).get(order.symbol) as any;

    if (!existing || existing.quantity < order.quantity) {
      return {
        status: 'rejected',
        broker_order_id: order.local_order_id,
        message: 'Insufficient position',
      };
    }

    // Add cash (minus commission)
    this.db.prepare(`
      UPDATE paper_account
      SET available_cash = available_cash + @addition, updated_at = unixepoch()
      WHERE id = 1
    `).run({ addition: totalCost - commission });

    // Reduce position
    const newQuantity = existing.quantity - order.quantity;
    if (newQuantity === 0) {
      this.db.prepare('DELETE FROM paper_positions WHERE symbol = ?').run(order.symbol);
    } else {
      this.db.prepare(`
        UPDATE paper_positions
        SET quantity = @quantity, updated_at = unixepoch()
        WHERE symbol = @symbol
      `).run({ quantity: newQuantity, symbol: order.symbol });
    }

    return {
      status: 'submitted',
      broker_order_id: order.local_order_id,
      filled_quantity: order.quantity,
      filled_price: fillPrice,
    };
  }

  private getPositionsTotalValue(): number {
    const result = this.db.prepare(
      'SELECT COALESCE(SUM(quantity * avg_cost), 0) as total FROM paper_positions WHERE quantity > 0'
    ).get() as any;
    return result.total;
  }
}
