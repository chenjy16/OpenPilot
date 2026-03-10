/**
 * Property-Based Tests for StrategyEngine
 *
 * Feature: quant-copilot-enhancement, Property 4: 策略 CRUD 读写一致性
 *
 * For any valid strategy definition JSON, creating a strategy then immediately
 * reading it should return equivalent data. Toggling a strategy enabled/disabled
 * twice should restore the original state (idempotency).
 *
 * **Validates: Requirements 4.2, 4.3, 4.5, 4.6**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import {
  StrategyEngine,
  StrategyDefinition,
  ConditionGroup,
  Condition,
  StopLossRule,
  TakeProfitRule,
} from './StrategyEngine';
import type { ExecutionSandbox } from '../runtime/sandbox';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an in-memory SQLite database with the strategies table. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
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
  // Also create backtest_results for completeness (FK reference)
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
  return db;
}

/** Minimal no-op sandbox (CRUD tests don't call Python). */
const noopSandbox: ExecutionSandbox = {
  type: 'noop',
  async exec() { return { stdout: '', stderr: '', exitCode: 0 }; },
  async destroy() {},
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const indicatorArb = fc.constantFrom(
  'sma20', 'sma50', 'rsi14', 'macd_line', 'macd_signal',
  'macd_histogram', 'bollinger_upper', 'bollinger_lower',
  'price', 'atr14', 'obv', 'vwap', 'kdj_k', 'kdj_d', 'kdj_j', 'williams_r',
);

const comparatorArb = fc.constantFrom(
  '>' as const, '<' as const, '>=' as const, '<=' as const,
  'crosses_above' as const, 'crosses_below' as const,
);

/** Positive-zero safe double: JSON.stringify(-0) === "0", so avoid -0 in generators. */
const safeDoubleArb = fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })
  .map(v => Object.is(v, -0) ? 0 : v);

const conditionValueArb = fc.oneof(safeDoubleArb, indicatorArb);

const conditionArb: fc.Arbitrary<Condition> = fc.record({
  indicator: indicatorArb,
  comparator: comparatorArb,
  value: conditionValueArb,
});

const conditionGroupArb: fc.Arbitrary<ConditionGroup> = fc.record({
  operator: fc.constantFrom('AND' as const, 'OR' as const),
  conditions: fc.array(conditionArb, { minLength: 1, maxLength: 5 }),
});

const stopLossRuleArb: fc.Arbitrary<StopLossRule> = fc.record({
  type: fc.constantFrom('percentage' as const, 'fixed' as const, 'atr' as const),
  value: fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true })
    .map(v => Object.is(v, -0) ? 0 : v),
});

const takeProfitRuleArb: fc.Arbitrary<TakeProfitRule> = fc.record({
  type: fc.constantFrom('percentage' as const, 'fixed' as const, 'risk_reward' as const),
  value: fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true })
    .map(v => Object.is(v, -0) ? 0 : v),
});

/** Unique strategy name (alphanumeric + spaces, avoids collisions). */
let nameCounter = 0;
const strategyNameArb = fc.string({ minLength: 1, maxLength: 30, unit: fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '.split(''),
) }).map(s => {
  nameCounter++;
  return `${s.trim() || 'strat'}_${nameCounter}`;
});

const strategyDefArb: fc.Arbitrary<StrategyDefinition> = fc.record({
  name: strategyNameArb,
  description: fc.string({ minLength: 0, maxLength: 200 }),
  entry_conditions: conditionGroupArb,
  exit_conditions: conditionGroupArb,
  stop_loss_rule: stopLossRuleArb,
  take_profit_rule: takeProfitRuleArb,
  enabled: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Property 4: 策略 CRUD 读写一致性
// Feature: quant-copilot-enhancement, Property 4: 策略 CRUD 读写一致性
// **Validates: Requirements 4.2, 4.3, 4.5, 4.6**
// ---------------------------------------------------------------------------

describe('Property 4: 策略 CRUD 读写一致性', () => {
  beforeEach(() => { nameCounter = 0; });

  it('creating a strategy then reading it back should return equivalent data', () => {
    fc.assert(
      fc.property(strategyDefArb, (def) => {
        const db = createTestDb();
        try {
          const engine = new StrategyEngine(db, noopSandbox);
          const created = engine.createStrategy(def);

          // Read back by id
          const fetched = engine.getStrategy(created.id!);
          expect(fetched).not.toBeNull();

          // Core fields must match
          expect(fetched!.name).toBe(def.name);
          expect(fetched!.description).toBe(def.description);
          expect(fetched!.enabled).toBe(def.enabled);

          // JSON-serialized condition groups must be deeply equal
          expect(fetched!.entry_conditions).toEqual(def.entry_conditions);
          expect(fetched!.exit_conditions).toEqual(def.exit_conditions);
          expect(fetched!.stop_loss_rule).toEqual(def.stop_loss_rule);
          expect(fetched!.take_profit_rule).toEqual(def.take_profit_rule);

          // Timestamps should be set
          expect(fetched!.created_at).toBeGreaterThan(0);
          expect(fetched!.updated_at).toBeGreaterThan(0);

          // Should also appear in listStrategies
          const all = engine.listStrategies();
          expect(all.some(s => s.id === created.id)).toBe(true);
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('toggling enabled twice should restore the original state (idempotency)', () => {
    fc.assert(
      fc.property(strategyDefArb, (def) => {
        const db = createTestDb();
        try {
          const engine = new StrategyEngine(db, noopSandbox);
          const created = engine.createStrategy(def);
          const originalEnabled = created.enabled;

          // Toggle to opposite
          engine.toggleStrategy(created.id!, !originalEnabled);
          const toggled = engine.getStrategy(created.id!);
          expect(toggled!.enabled).toBe(!originalEnabled);

          // Toggle back
          engine.toggleStrategy(created.id!, originalEnabled);
          const restored = engine.getStrategy(created.id!);
          expect(restored!.enabled).toBe(originalEnabled);
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('deleting a strategy should make it unreadable', () => {
    fc.assert(
      fc.property(strategyDefArb, (def) => {
        const db = createTestDb();
        try {
          const engine = new StrategyEngine(db, noopSandbox);
          const created = engine.createStrategy(def);
          expect(engine.getStrategy(created.id!)).not.toBeNull();

          engine.deleteStrategy(created.id!);
          expect(engine.getStrategy(created.id!)).toBeNull();
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('updating a strategy should reflect the new values on read', () => {
    fc.assert(
      fc.property(strategyDefArb, strategyDefArb, (def1, def2) => {
        const db = createTestDb();
        try {
          const engine = new StrategyEngine(db, noopSandbox);
          const created = engine.createStrategy(def1);

          // Update with def2's fields (except name must be unique — use def2's name)
          const updated = engine.updateStrategy(created.id!, {
            description: def2.description,
            entry_conditions: def2.entry_conditions,
            exit_conditions: def2.exit_conditions,
            stop_loss_rule: def2.stop_loss_rule,
            take_profit_rule: def2.take_profit_rule,
            enabled: def2.enabled,
          });

          expect(updated.description).toBe(def2.description);
          expect(updated.entry_conditions).toEqual(def2.entry_conditions);
          expect(updated.exit_conditions).toEqual(def2.exit_conditions);
          expect(updated.stop_loss_rule).toEqual(def2.stop_loss_rule);
          expect(updated.take_profit_rule).toEqual(def2.take_profit_rule);
          expect(updated.enabled).toBe(def2.enabled);

          // Name should remain unchanged (we didn't update it)
          expect(updated.name).toBe(def1.name);
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });
});
