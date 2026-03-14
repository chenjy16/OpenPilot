/**
 * Property-Based Tests for StrategyEngine — Strategy Weight Invariants
 *
 * Feature: multi-strategy-trading, Property 15: 策略权重不变量
 * Validates: Requirements 13.1, 13.2
 */

import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initTradingTables } from '../trading/tradingSchema';
import { StrategyEngine } from '../StrategyEngine';
import type { Strategy, StrategySignal } from '../trading/types';

// ─── Helpers ───────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
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
  initTradingTables(db);
  return db;
}

const mockSandbox = {
  exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
} as any;

function createMockStrategy(name: string): Strategy {
  return {
    name,
    generateSignal(
      _symbol: string,
      _indicators: Record<string, number | null>,
    ): StrategySignal | null {
      return null;
    },
  };
}
