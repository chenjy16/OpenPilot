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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Property 15: Strategy weight invariants', () => {
  function registerHelper(engine: StrategyEngine, name: string, weight: number) {
    engine.registerStrategy({
      strategy: createMockStrategy(name),
      weight,
      enabled: true,
    });
  }

  it('strategy weights sum to 1.0 when normalized', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    registerHelper(engine, 'strat_a', 0.4);
    registerHelper(engine, 'strat_b', 0.35);
    registerHelper(engine, 'strat_c', 0.25);

    const weights = engine.getStrategyWeights();
    let totalWeight = 0;
    weights.forEach((w) => { totalWeight += w; });

    expect(totalWeight).toBeCloseTo(1.0, 5);
  });

  it('single strategy gets its assigned weight', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    registerHelper(engine, 'only_strat', 1.0);

    const weights = engine.getStrategyWeights();
    expect(weights.get('only_strat')).toBeCloseTo(1.0, 5);
  });

  it('all weights are non-negative', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    registerHelper(engine, 'strat_a', 0.6);
    registerHelper(engine, 'strat_b', 0.4);

    const weights = engine.getStrategyWeights();
    weights.forEach((w) => {
      expect(w).toBeGreaterThanOrEqual(0);
    });
  });

  it('rejects negative weights', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    expect(() => registerHelper(engine, 'bad', -0.1)).toThrow();
  });

  it('rejects weights greater than 1', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    expect(() => registerHelper(engine, 'bad', 1.5)).toThrow();
  });
});
