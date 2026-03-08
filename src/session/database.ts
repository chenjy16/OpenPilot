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
