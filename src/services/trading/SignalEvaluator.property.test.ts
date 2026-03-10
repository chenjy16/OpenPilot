// Feature: auto-quant-trading, Property 1: 置信度过滤确定性
/**
 * Property-based tests for SignalEvaluator — confidence filtering determinism.
 *
 * Property 1: For any Signal_Card and any confidence_threshold (0–1),
 * when confidenceToNumber(signal.confidence) >= threshold the evaluator
 * returns pass=true; when < threshold it returns pass=false with
 * reason='confidence_below_threshold'.
 *
 * **Validates: Requirements 2.1, 2.3**
 */

import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { confidenceToNumber, meetsConfidenceThreshold, SignalEvaluator } from './SignalEvaluator';
import { initTradingTables } from './tradingSchema';
import type { SignalCard, EvaluationConfig } from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)`);
  db.exec(`CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)`);
  initTradingTables(db);
  return db;
}

/** Arbitrary that picks one of the four valid confidence values. */
const arbConfidence = fc.constantFrom<string | null>('high', 'medium', 'low', null);

/** Arbitrary threshold in [0, 1]. */
const arbThreshold = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Build a minimal valid SignalCard (action != 'hold', entry_price present)
 * so that the evaluator reaches the confidence check step.
 */
function makeSignal(confidence: string | null): SignalCard {
  return {
    id: 1,
    symbol: 'TEST.HK',
    action: 'buy',
    entry_price: 100,
    stop_loss: 90,
    take_profit: 120,
    confidence,
    created_at: Math.floor(Date.now() / 1000),
  };
}

// ─── Property 1: 置信度过滤确定性 ──────────────────────────────────────────

describe('SignalEvaluator Property Tests', () => {
  let db: Database.Database;
  let evaluator: SignalEvaluator;

  beforeEach(() => {
    db = createTestDb();
    evaluator = new SignalEvaluator(db);
  });

  afterEach(() => {
    db.close();
  });

  // **Validates: Requirements 2.1, 2.3**
  it('Property 1: confidence filtering is deterministic — pass when >= threshold, reject otherwise', () => {
    fc.assert(
      fc.property(arbConfidence, arbThreshold, (confidence, threshold) => {
        const numericConfidence = confidenceToNumber(confidence);
        const signal = makeSignal(confidence);
        const config: EvaluationConfig = {
          confidence_threshold: threshold,
          dedup_window_hours: 24,
        };

        const result = evaluator.evaluate(signal, config);

        if (numericConfidence >= threshold) {
          // Should pass (no dedup entries in a fresh DB)
          expect(result.pass).toBe(true);
          expect(result.reason).toBeUndefined();
        } else {
          // Should fail with confidence_below_threshold
          expect(result.pass).toBe(false);
          expect(result.reason).toBe('confidence_below_threshold');
        }
      }),
      { numRuns: 10 },
    );
  });

  // Supplementary: pure function confidenceToNumber always returns a known value
  it('confidenceToNumber maps to one of {0, 0.3, 0.6, 0.9}', () => {
    fc.assert(
      fc.property(arbConfidence, (confidence) => {
        const value = confidenceToNumber(confidence);
        expect([0, 0.3, 0.6, 0.9]).toContain(value);
      }),
      { numRuns: 10 },
    );
  });

  // Supplementary: meetsConfidenceThreshold agrees with manual comparison
  it('meetsConfidenceThreshold is equivalent to confidenceToNumber >= threshold', () => {
    fc.assert(
      fc.property(arbConfidence, arbThreshold, (confidence, threshold) => {
        const expected = confidenceToNumber(confidence) >= threshold;
        expect(meetsConfidenceThreshold(confidence, threshold)).toBe(expected);
      }),
      { numRuns: 10 },
    );
  });

  // ─── Property 2: 信号去重正确性 ──────────────────────────────────────────
  // Feature: auto-quant-trading, Property 2: 信号去重正确性
  /**
   * Property 2: For any signal sequence (same symbol and action), within
   * dedup_window_hours only the first signal's evaluation returns pass=true;
   * subsequent signals with the same symbol+action should return pass=false
   * with reason='duplicate_signal'. Signals outside the window should be
   * treated as new and pass evaluation.
   *
   * **Validates: Requirements 2.4, 2.5**
   */

  describe('Property 2: 信号去重正确性', () => {
    /** Arbitrary symbol generator — random HK stock codes */
    const arbSymbol: fc.Arbitrary<string> = fc.array(
      fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
      { minLength: 1, maxLength: 4 },
    ).map((chars: string[]) => `${chars.join('')}.HK`);

    /** Arbitrary action (buy or sell only — hold is filtered before dedup) */
    const arbAction: fc.Arbitrary<'buy' | 'sell'> = fc.constantFrom<'buy' | 'sell'>('buy', 'sell');

    /** Arbitrary dedup window in hours (1–168, i.e. up to 1 week) */
    const arbDedupWindowHours: fc.Arbitrary<number> = fc.integer({ min: 1, max: 168 });

    /**
     * Helper: insert a stub row into stock_signals for FK constraint,
     * returns the inserted id.
     */
    function insertStubSignal(db: Database.Database, id: number, symbol: string): void {
      db.prepare(`INSERT OR IGNORE INTO stock_signals (id) VALUES (?)`).run(id);
    }

    /**
     * Helper: insert a pipeline_signal_log entry to simulate a previous
     * order_created event.
     */
    function insertLogEntry(
      db: Database.Database,
      signalId: number,
      symbol: string,
      action: string,
      createdAt: number,
    ): void {
      db.prepare(
        `INSERT INTO pipeline_signal_log (signal_id, signal_source, symbol, action, result, created_at)
         VALUES (?, 'quant_analyst', ?, ?, 'order_created', ?)`,
      ).run(signalId, symbol, action, createdAt);
    }

    // **Validates: Requirements 2.4, 2.5**
    it('signals within dedup window are rejected as duplicate_signal', () => {
      fc.assert(
        fc.property(arbSymbol, arbAction, arbDedupWindowHours, (symbol, action, dedupWindowHours) => {
          // Fresh DB for each iteration to avoid cross-contamination
          const iterDb = createTestDb();
          const iterEvaluator = new SignalEvaluator(iterDb);

          const now = Math.floor(Date.now() / 1000);

          // Insert a stub signal for FK
          insertStubSignal(iterDb, 1, symbol);

          // Insert a previous order_created log entry WITHIN the window
          // Place it at half the window duration ago
          const withinWindowTime = now - Math.floor((dedupWindowHours * 3600) / 2);
          insertLogEntry(iterDb, 1, symbol, action, withinWindowTime);

          // Build a signal with high confidence and low threshold so only dedup matters
          const signal: SignalCard = {
            id: 2,
            symbol,
            action,
            entry_price: 100,
            stop_loss: 90,
            take_profit: 120,
            confidence: 'high',
            created_at: now,
          };

          const config: EvaluationConfig = {
            confidence_threshold: 0.1,
            dedup_window_hours: dedupWindowHours,
          };

          const result = iterEvaluator.evaluate(signal, config);

          expect(result.pass).toBe(false);
          expect(result.reason).toBe('duplicate_signal');

          iterDb.close();
        }),
        { numRuns: 10 },
      );
    });

    // **Validates: Requirements 2.4, 2.5**
    it('signals outside dedup window are treated as new and pass evaluation', () => {
      fc.assert(
        fc.property(arbSymbol, arbAction, arbDedupWindowHours, (symbol, action, dedupWindowHours) => {
          const iterDb = createTestDb();
          const iterEvaluator = new SignalEvaluator(iterDb);

          const now = Math.floor(Date.now() / 1000);

          // Insert a stub signal for FK
          insertStubSignal(iterDb, 1, symbol);

          // Insert a previous order_created log entry OUTSIDE the window
          // Place it at window + 1 hour ago (safely beyond the window)
          const outsideWindowTime = now - (dedupWindowHours * 3600) - 3600;
          insertLogEntry(iterDb, 1, symbol, action, outsideWindowTime);

          const signal: SignalCard = {
            id: 2,
            symbol,
            action,
            entry_price: 100,
            stop_loss: 90,
            take_profit: 120,
            confidence: 'high',
            created_at: now,
          };

          const config: EvaluationConfig = {
            confidence_threshold: 0.1,
            dedup_window_hours: dedupWindowHours,
          };

          const result = iterEvaluator.evaluate(signal, config);

          expect(result.pass).toBe(true);
          expect(result.reason).toBeUndefined();

          iterDb.close();
        }),
        { numRuns: 10 },
      );
    });

    // **Validates: Requirements 2.4, 2.5**
    it('first signal with no prior log entries always passes (no dedup)', () => {
      fc.assert(
        fc.property(arbSymbol, arbAction, arbDedupWindowHours, (symbol, action, dedupWindowHours) => {
          const iterDb = createTestDb();
          const iterEvaluator = new SignalEvaluator(iterDb);

          const now = Math.floor(Date.now() / 1000);

          // No prior log entries — first signal should always pass
          const signal: SignalCard = {
            id: 1,
            symbol,
            action,
            entry_price: 100,
            stop_loss: 90,
            take_profit: 120,
            confidence: 'high',
            created_at: now,
          };

          const config: EvaluationConfig = {
            confidence_threshold: 0.1,
            dedup_window_hours: dedupWindowHours,
          };

          const result = iterEvaluator.evaluate(signal, config);

          expect(result.pass).toBe(true);
          expect(result.reason).toBeUndefined();

          iterDb.close();
        }),
        { numRuns: 10 },
      );
    });

    // **Validates: Requirements 2.4, 2.5**
    it('different symbol or action is not considered duplicate', () => {
      fc.assert(
        fc.property(
          arbSymbol,
          arbSymbol,
          arbAction,
          arbAction,
          arbDedupWindowHours,
          (symbol1, symbol2, action1, action2, dedupWindowHours) => {
            // Only test when symbol or action differs
            fc.pre(symbol1 !== symbol2 || action1 !== action2);

            const iterDb = createTestDb();
            const iterEvaluator = new SignalEvaluator(iterDb);

            const now = Math.floor(Date.now() / 1000);

            // Insert stub signal for FK
            insertStubSignal(iterDb, 1, symbol1);

            // Insert a log entry for symbol1+action1 within the window
            const withinWindowTime = now - Math.floor((dedupWindowHours * 3600) / 2);
            insertLogEntry(iterDb, 1, symbol1, action1, withinWindowTime);

            // Evaluate a signal with symbol2+action2 — should NOT be deduped
            const signal: SignalCard = {
              id: 2,
              symbol: symbol2,
              action: action2,
              entry_price: 100,
              stop_loss: 90,
              take_profit: 120,
              confidence: 'high',
              created_at: now,
            };

            const config: EvaluationConfig = {
              confidence_threshold: 0.1,
              dedup_window_hours: dedupWindowHours,
            };

            const result = iterEvaluator.evaluate(signal, config);

            expect(result.pass).toBe(true);
            expect(result.reason).toBeUndefined();

            iterDb.close();
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
