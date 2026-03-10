/**
 * Trading module database schema initialization
 * Creates all trading-related tables and indexes
 */

import type Database from 'better-sqlite3';

/**
 * Initialize all trading-related database tables
 * @param db - better-sqlite3 Database instance
 */
export function initTradingTables(db: Database.Database): void {
  // trading_orders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS trading_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_order_id TEXT NOT NULL UNIQUE,
      broker_order_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
      order_type TEXT NOT NULL CHECK(order_type IN ('market', 'limit', 'stop', 'stop_limit')),
      quantity REAL NOT NULL CHECK(quantity > 0),
      price REAL,
      stop_price REAL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'submitted', 'partial_filled', 'filled', 'cancelled', 'rejected', 'failed')),
      trading_mode TEXT NOT NULL CHECK(trading_mode IN ('paper', 'live')),
      filled_quantity REAL NOT NULL DEFAULT 0,
      filled_price REAL,
      strategy_id INTEGER,
      signal_id INTEGER,
      reject_reason TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (strategy_id) REFERENCES strategies(id),
      FOREIGN KEY (signal_id) REFERENCES stock_signals(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trading_orders_status ON trading_orders(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trading_orders_symbol ON trading_orders(symbol)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trading_orders_created ON trading_orders(created_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trading_orders_mode ON trading_orders(trading_mode)
  `);

  // risk_rules table
  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_type TEXT NOT NULL UNIQUE
        CHECK(rule_type IN ('max_order_amount', 'max_daily_amount', 'max_position_ratio', 'max_daily_loss', 'max_daily_trades')),
      rule_name TEXT NOT NULL,
      threshold REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // trading_audit_log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS trading_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      operation TEXT NOT NULL,
      order_id INTEGER,
      request_params TEXT,
      response_result TEXT,
      trading_mode TEXT,
      FOREIGN KEY (order_id) REFERENCES trading_orders(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON trading_audit_log(timestamp DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_order ON trading_audit_log(order_id)
  `);

  // paper_account table (single-row)
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_account (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      initial_capital REAL NOT NULL DEFAULT 1000000,
      available_cash REAL NOT NULL DEFAULT 1000000,
      frozen_cash REAL NOT NULL DEFAULT 0,
      commission_rate REAL NOT NULL DEFAULT 0.0003,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // paper_positions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      quantity REAL NOT NULL DEFAULT 0,
      avg_cost REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // trading_config table (key-value)
  db.exec(`
    CREATE TABLE IF NOT EXISTS trading_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // stop_loss_records table
  db.exec(`
    CREATE TABLE IF NOT EXISTS stop_loss_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'buy',
      entry_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'triggered_sl', 'triggered_tp', 'cancelled')),
      triggered_at INTEGER,
      triggered_price REAL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (order_id) REFERENCES trading_orders(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stop_loss_status ON stop_loss_records(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stop_loss_symbol ON stop_loss_records(symbol)
  `);

  // pipeline_signal_log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_signal_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id INTEGER,
      signal_source TEXT NOT NULL CHECK(signal_source IN ('quant_analyst', 'strategy_scan')),
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      result TEXT NOT NULL CHECK(result IN ('order_created', 'skipped_confidence', 'skipped_dedup', 'skipped_hold', 'skipped_quantity', 'skipped_risk', 'skipped_disabled', 'skipped_missing_price')),
      order_id INTEGER,
      strategy_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (signal_id) REFERENCES stock_signals(id),
      FOREIGN KEY (order_id) REFERENCES trading_orders(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pipeline_log_created ON pipeline_signal_log(created_at DESC)
  `);
}
