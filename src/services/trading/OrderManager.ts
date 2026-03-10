/**
 * OrderManager - Trading Order Lifecycle Management
 *
 * Manages the full lifecycle of trading orders:
 * - Create orders with unique local IDs
 * - Track and validate status transitions
 * - Query and filter orders
 * - Compute order statistics
 */

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  TradingOrder,
  CreateOrderRequest,
  OrderFilter,
  OrderStats,
  OrderStatus,
  TradingMode,
} from './types';
import { VALID_STATUS_TRANSITIONS } from './types';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function rowToOrder(row: any): TradingOrder {
  return {
    id: row.id,
    local_order_id: row.local_order_id,
    broker_order_id: row.broker_order_id ?? undefined,
    symbol: row.symbol,
    side: row.side,
    order_type: row.order_type,
    quantity: row.quantity,
    price: row.price ?? undefined,
    stop_price: row.stop_price ?? undefined,
    status: row.status,
    trading_mode: row.trading_mode,
    filled_quantity: row.filled_quantity,
    filled_price: row.filled_price ?? undefined,
    strategy_id: row.strategy_id ?? undefined,
    signal_id: row.signal_id ?? undefined,
    reject_reason: row.reject_reason ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// OrderManager class
// ---------------------------------------------------------------------------

export class OrderManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a new trading order.
   * Generates a unique local_order_id, sets initial status to 'pending',
   * persists to DB, and returns the created order read back from DB.
   */
  createOrder(request: CreateOrderRequest, tradingMode: TradingMode): TradingOrder {
    const localOrderId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      INSERT INTO trading_orders
        (local_order_id, symbol, side, order_type, quantity, price, stop_price,
         status, trading_mode, filled_quantity, strategy_id, signal_id, created_at, updated_at)
      VALUES
        (@local_order_id, @symbol, @side, @order_type, @quantity, @price, @stop_price,
         'pending', @trading_mode, 0, @strategy_id, @signal_id, @created_at, @updated_at)
    `);

    const info = stmt.run({
      local_order_id: localOrderId,
      symbol: request.symbol,
      side: request.side,
      order_type: request.order_type,
      quantity: request.quantity,
      price: request.price ?? null,
      stop_price: request.stop_price ?? null,
      trading_mode: tradingMode,
      strategy_id: request.strategy_id ?? null,
      signal_id: request.signal_id ?? null,
      created_at: now,
      updated_at: now,
    });

    return this.getOrder(Number(info.lastInsertRowid))!;
  }

  /**
   * Update order status with validation against VALID_STATUS_TRANSITIONS.
   * Throws Error if order not found or if the transition is invalid.
   */
  updateOrderStatus(
    orderId: number,
    newStatus: OrderStatus,
    details?: {
      broker_order_id?: string;
      filled_quantity?: number;
      filled_price?: number;
      reject_reason?: string;
    },
  ): TradingOrder {
    const order = this.getOrder(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const allowedTransitions = VALID_STATUS_TRANSITIONS[order.status];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${order.status} → ${newStatus}. Allowed: [${allowedTransitions.join(', ')}]`,
      );
    }

    const fields: string[] = ['status = @status', 'updated_at = @updated_at'];
    const params: Record<string, any> = {
      id: orderId,
      status: newStatus,
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (details?.broker_order_id !== undefined) {
      fields.push('broker_order_id = @broker_order_id');
      params.broker_order_id = details.broker_order_id;
    }
    if (details?.filled_quantity !== undefined) {
      fields.push('filled_quantity = @filled_quantity');
      params.filled_quantity = details.filled_quantity;
    }
    if (details?.filled_price !== undefined) {
      fields.push('filled_price = @filled_price');
      params.filled_price = details.filled_price;
    }
    if (details?.reject_reason !== undefined) {
      fields.push('reject_reason = @reject_reason');
      params.reject_reason = details.reject_reason;
    }

    this.db.prepare(
      `UPDATE trading_orders SET ${fields.join(', ')} WHERE id = @id`,
    ).run(params);

    return this.getOrder(orderId)!;
  }

  /**
   * Get a single order by ID. Returns null if not found.
   */
  getOrder(orderId: number): TradingOrder | null {
    const row = this.db
      .prepare('SELECT * FROM trading_orders WHERE id = ?')
      .get(orderId) as any;
    return row ? rowToOrder(row) : null;
  }

  /**
   * List orders with optional filtering.
   * Supports filtering by status, symbol, start_date, end_date, trading_mode.
   * Results ordered by created_at DESC.
   */
  listOrders(filter?: OrderFilter): TradingOrder[] {
    const conditions: string[] = [];
    const params: Record<string, any> = {};

    if (filter?.status) {
      conditions.push('status = @status');
      params.status = filter.status;
    }
    if (filter?.symbol) {
      conditions.push('symbol = @symbol');
      params.symbol = filter.symbol;
    }
    if (filter?.start_date !== undefined) {
      conditions.push('created_at >= @start_date');
      params.start_date = filter.start_date;
    }
    if (filter?.end_date !== undefined) {
      conditions.push('created_at <= @end_date');
      params.end_date = filter.end_date;
    }
    if (filter?.trading_mode) {
      conditions.push('trading_mode = @trading_mode');
      params.trading_mode = filter.trading_mode;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM trading_orders ${whereClause} ORDER BY created_at DESC`;

    const rows = this.db.prepare(sql).all(params) as any[];
    return rows.map(rowToOrder);
  }

  /**
   * Get order statistics: total, filled, cancelled counts and total filled amount.
   * Optionally filtered by trading mode.
   */
  getStats(tradingMode?: TradingMode): OrderStats {
    const modeCondition = tradingMode ? 'WHERE trading_mode = @trading_mode' : '';
    const params: Record<string, any> = tradingMode ? { trading_mode: tradingMode } : {};

    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(CASE WHEN status = 'filled' THEN 1 ELSE 0 END), 0) as filled_orders,
        COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_orders,
        COALESCE(SUM(CASE WHEN status = 'filled' THEN filled_quantity * filled_price ELSE 0 END), 0) as total_filled_amount
      FROM trading_orders
      ${modeCondition}
    `).get(params) as any;

    return {
      total_orders: row.total_orders,
      filled_orders: row.filled_orders,
      cancelled_orders: row.cancelled_orders,
      total_filled_amount: row.total_filled_amount,
    };
  }
}
