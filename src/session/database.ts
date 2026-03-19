/**
 * Database initialization and schema management
 * Sets up SQLite database for session and message storage
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * Initialize the SQLite database with required schema
 * @param dbPath - Path to the database file
 * @returns Database instance
 */
export function initializeDatabase(dbPath: string): Database.Database {
  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Open database connection
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Enable WAL mode for better concurrent write performance
  db.pragma('journal_mode = WAL');

  // Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT NOT NULL
    )
  `);

  // Create messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      tool_calls TEXT,
      tool_results TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  // Create index on session_id for efficient queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session_id 
    ON messages(session_id)
  `);

  // Create index on timestamp for ordering
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp 
    ON messages(session_id, timestamp)
  `);

  // Create market_signals table (PolyOracle)
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      question TEXT NOT NULL,
      market_probability REAL NOT NULL,
      ai_probability REAL,
      edge REAL,
      confidence TEXT,
      reasoning TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      notified_at INTEGER
    )
  `);

  // Migration: add notified_at if missing (existing DBs)
  try {
    db.exec(`ALTER TABLE market_signals ADD COLUMN notified_at INTEGER`);
  } catch { /* column already exists */ }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_market_signals_created
    ON market_signals(created_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_market_signals_edge
    ON market_signals(edge DESC)
  `);

  // Create stock_signals table (Quant Stock Analysis)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'hold')),
      entry_price REAL,
      stop_loss REAL,
      take_profit REAL,
      reasoning TEXT,
      technical_summary TEXT,
      sentiment_summary TEXT,
      confidence TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      notified_at INTEGER
    )
  `);

  // Migration: add signal tracking fields to stock_signals (REQ-6)
  try {
    db.exec(`ALTER TABLE stock_signals ADD COLUMN outcome TEXT DEFAULT 'pending' CHECK(outcome IN ('pending', 'hit_tp', 'hit_sl', 'expired'))`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE stock_signals ADD COLUMN outcome_at INTEGER`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE stock_signals ADD COLUMN technical_score REAL`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE stock_signals ADD COLUMN sentiment_score REAL`);
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE stock_signals ADD COLUMN overall_score REAL`);
  } catch { /* column already exists */ }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stock_signals_symbol
    ON stock_signals(symbol)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stock_signals_created
    ON stock_signals(created_at DESC)
  `);

  // Create backtest_results table (Quant Backtest Engine)
  db.exec(`
    CREATE TABLE IF NOT EXISTS backtest_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER,
      symbol TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      total_return REAL,
      annual_return REAL,
      max_drawdown REAL,
      sharpe_ratio REAL,
      win_rate REAL,
      profit_loss_ratio REAL,
      total_trades INTEGER,
      trades_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (strategy_id) REFERENCES strategies(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_backtest_results_symbol
    ON backtest_results(symbol)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_backtest_results_created
    ON backtest_results(created_at DESC)
  `);

  // Create strategies table (Quant Strategy Framework)
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      entry_conditions TEXT NOT NULL,
      exit_conditions TEXT NOT NULL,
      stop_loss_rule TEXT NOT NULL,
      take_profit_rule TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Create portfolio_positions table (Portfolio & Risk Management)
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      quantity REAL NOT NULL,
      cost_price REAL NOT NULL,
      current_price REAL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Create cron_jobs table (persistent cron storage)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      handler TEXT NOT NULL,
      config TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      last_status TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Create polymarket_orders table (Polymarket Trading)
  db.exec(`
    CREATE TABLE IF NOT EXISTS polymarket_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT,
      market_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
      price REAL NOT NULL CHECK(price >= 0.01 AND price <= 0.99),
      size REAL NOT NULL CHECK(size > 0),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'submitted', 'filled', 'canceled', 'failed')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pm_orders_status ON polymarket_orders(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pm_orders_market ON polymarket_orders(market_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pm_orders_created ON polymarket_orders(created_at DESC)
  `);

  // Create polymarket_trades table (Polymarket Trading)
  db.exec(`
    CREATE TABLE IF NOT EXISTS polymarket_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT,
      order_id TEXT,
      market_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
      price REAL NOT NULL,
      size REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pm_trades_market ON polymarket_trades(market_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pm_trades_timestamp ON polymarket_trades(timestamp DESC)
  `);

  // Create cross_market_match_cache table (Cross-Market Arbitrage Radar)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_market_match_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_a TEXT NOT NULL,
      market_id_a TEXT NOT NULL,
      platform_b TEXT NOT NULL,
      market_id_b TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low')),
      confidence_score REAL NOT NULL,
      oracle_mismatch INTEGER NOT NULL DEFAULT 0,
      oracle_mismatch_reason TEXT,
      market_end_date TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      UNIQUE(platform_a, market_id_a, platform_b, market_id_b)
    )
  `);

  // Create cross_market_arbitrage table (Cross-Market Arbitrage Radar)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_market_arbitrage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_a TEXT NOT NULL,
      platform_a_market_id TEXT NOT NULL,
      platform_b TEXT NOT NULL,
      platform_b_market_id TEXT NOT NULL,
      question TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('A_YES_B_NO', 'A_NO_B_YES')),
      platform_a_yes_price REAL NOT NULL,
      platform_a_no_price REAL,
      platform_b_yes_price REAL,
      platform_b_no_price REAL NOT NULL,
      vwap_buy_price REAL NOT NULL,
      vwap_sell_price REAL NOT NULL,
      real_arbitrage_cost REAL NOT NULL,
      platform_a_fee REAL NOT NULL,
      platform_b_fee REAL NOT NULL,
      total_fees REAL NOT NULL,
      profit_pct REAL NOT NULL,
      arb_score INTEGER NOT NULL,
      liquidity_warning INTEGER NOT NULL DEFAULT 0,
      oracle_mismatch INTEGER NOT NULL DEFAULT 0,
      depth_status TEXT NOT NULL DEFAULT 'sufficient',
      detected_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cross_market_arb_detected
    ON cross_market_arbitrage(detected_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cross_market_arb_profit
    ON cross_market_arbitrage(profit_pct DESC)
  `);

  return db;
}

/**
 * Get database instance (singleton pattern)
 */
let dbInstance: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (!dbInstance) {
    const path = dbPath || process.env.DATABASE_PATH || './data/sessions.db';
    dbInstance = initializeDatabase(path);
  }
  return dbInstance;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
