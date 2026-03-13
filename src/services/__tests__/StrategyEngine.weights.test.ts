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

// ─── Property 15: 策略权重不变量 ──────────────────────────────────────────

describe('StrategyEngine — Property 15: 策略权重不变量', () => {
  /**
   * **Validates: Requirements 13.1, 13.2**
   *
   * For any strategy weight configuration where each weight ∈ [0, 1],
   * if the enabled strategy weights sum to 1.0 (±0.01), validateWeights()
   * should return valid = true. Otherwise, it should return valid = false.
   */
  it('each registered weight should be in [0, 1] and validateWeights reflects sum correctness', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            weight: fc.double({ min: 0, max: 1, noNaN: true }),
            enabled: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (configs) => {
          const db = createTestDb();
          try {
            const engine = new StrategyEngine(db, mockSandbox);

            configs.forEach((cfg, i) => {
              engine.registerStrategy({
                strategy: createMockStrategy(`strategy_${i}`),
                weight: cfg.weight,
                enabled: cfg.enabled,
              });
            });

            // Verify each weight is in [0, 1]
            const weights = engine.getStrategyWeights();
            for (const [, w] of weights) {
              expect(w).toBeGreaterThanOrEqual(0);
              expect(w).toBeLessThanOrEqual(1);
            }

            // Compute expected sum of enabled strategy weights
            const enabledWeights = configs
              .filter((c) => c.enabled)
              .map((c) => c.weight);
            const enabledSum = enabledWeights.reduce((acc, w) => acc + w, 0);

            const result = engine.validateWeights();

            if (enabledWeights.length === 0) {
              expect(result.valid).toBe(true);
              expect(result.sum).toBe(0);
            } else {
              const roundedSum = Math.round(enabledSum * 1000) / 1000;
              const withinTolerance = Math.abs(roundedSum - 1.0) <= 0.01;
              expect(result.valid).toBe(withinTolerance);
            }
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 13.2**
   *
   * When weight update causes the enabled sum to deviate from 1.0 by more
   * than 0.01, validateWeights() should return valid = false.
   */
  it('weight update causing sum deviation > 0.01 from 1.0 should fail validation', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }).filter(
          (w) => Math.abs(w - 0.6) > 0.01,
        ),
        (newWeight) => {
          const db = createTestDb();
          try {
            const engine = new StrategyEngine(db, mockSandbox);

            engine.registerStrategy({
              strategy: createMockStrategy('alpha'),
              weight: 0.6,
              enabled: true,
            });
            engine.registerStrategy({
              strategy: createMockStrategy('beta'),
              weight: 0.4,
              enabled: true,
            });

            // Initially valid
            expect(engine.validateWeights().valid).toBe(true);

            // Update alpha's weight
            engine.setStrategyWeight('alpha', newWeight);

            const newSum = Math.round((newWeight + 0.4) * 1000) / 1000;
            const shouldBeValid = Math.abs(newSum - 1.0) <= 0.01;

            const result = engine.validateWeights();
            expect(result.valid).toBe(shouldBeValid);

            if (!shouldBeValid) {
              expect(result.message).toBeDefined();
              expect(result.message).toContain('redistribute weights');
            }
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 13.1**
   *
   * For any set of enabled strategies whose weights are normalized to sum
   * to 1.0, validateWeights() should always return valid = true.
   */
  it('enabled strategies with weights summing to 1.0 should always validate', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: 1, noNaN: true }), {
          minLength: 2,
          maxLength: 4,
        }),
        (rawWeights) => {
          const db = createTestDb();
          try {
            const engine = new StrategyEngine(db, mockSandbox);

            // Normalize weights to sum to 1.0
            const total = rawWeights.reduce((a, b) => a + b, 0);
            const normalized = rawWeights.map(
              (w) => Math.round((w / total) * 1000) / 1000,
            );

            // Adjust last weight to ensure exact sum = 1.0
            const partialSum = normalized
              .slice(0, -1)
              .reduce((a, b) => a + b, 0);
            normalized[normalized.length - 1] =
              Math.round((1.0 - partialSum) * 1000) / 1000;

            // Skip if any normalized weight falls outside [0, 1]
            if (normalized.some((w) => w < 0 || w > 1)) return;

            normalized.forEach((w, i) => {
              engine.registerStrategy({
                strategy: createMockStrategy(`strat_${i}`),
                weight: w,
                enabled: true,
              });
            });

            const result = engine.validateWeights();
            expect(result.valid).toBe(true);
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
