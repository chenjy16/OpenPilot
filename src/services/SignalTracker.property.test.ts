/**
 * Property-Based Tests for SignalTracker
 *
 * Feature: quant-copilot-enhancement, Property 6: 信号绩效追踪准确性
 *
 * For any completed signal and its corresponding price history:
 * - If price hits take_profit first → outcome = 'hit_tp'
 * - If price hits stop_loss first → outcome = 'hit_sl'
 * - win_rate = hit_tp_count / (hit_tp_count + hit_sl_count)
 *
 * **Validates: Requirements 6.2, 6.3**
 *
 * Test framework: jest + fast-check
 * Minimum 100 iterations.
 */

import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import {
  determineOutcome,
  computeWinRate,
  computeAvgPnlRatio,
  SignalTracker,
  type SignalOutcome,
} from './SignalTracker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
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
      notified_at INTEGER,
      outcome TEXT DEFAULT 'pending'
        CHECK(outcome IN ('pending', 'hit_tp', 'hit_sl', 'expired')),
      outcome_at INTEGER,
      technical_score REAL,
      sentiment_score REAL,
      overall_score REAL
    )
  `);
  return db;
}

function insertSignal(
  db: Database.Database,
  opts: {
    symbol: string;
    action: 'buy' | 'sell';
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    confidence: string;
    outcome?: SignalOutcome;
    created_at?: number;
  },
): number {
  const stmt = db.prepare(`
    INSERT INTO stock_signals
      (symbol, action, entry_price, stop_loss, take_profit, confidence, outcome, created_at)
    VALUES
      (@symbol, @action, @entry_price, @stop_loss, @take_profit, @confidence, @outcome, @created_at)
  `);
  const info = stmt.run({
    symbol: opts.symbol,
    action: opts.action,
    entry_price: opts.entry_price,
    stop_loss: opts.stop_loss,
    take_profit: opts.take_profit,
    confidence: opts.confidence,
    outcome: opts.outcome ?? 'pending',
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  });
  return Number(info.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a buy signal with entry between SL and TP (SL < entry < TP). */
const buySignalArb = fc.record({
  entry: fc.double({ min: 1, max: 9999, noNaN: true, noDefaultInfinity: true }),
  slDelta: fc.double({ min: 0.01, max: 500, noNaN: true, noDefaultInfinity: true }),
  tpDelta: fc.double({ min: 0.01, max: 500, noNaN: true, noDefaultInfinity: true }),
}).map(({ entry, slDelta, tpDelta }) => ({
  action: 'buy' as const,
  entry_price: entry,
  stop_loss: entry - slDelta,
  take_profit: entry + tpDelta,
}));

/** Generate a sell signal with entry between TP and SL (TP < entry < SL). */
const sellSignalArb = fc.record({
  entry: fc.double({ min: 1, max: 9999, noNaN: true, noDefaultInfinity: true }),
  slDelta: fc.double({ min: 0.01, max: 500, noNaN: true, noDefaultInfinity: true }),
  tpDelta: fc.double({ min: 0.01, max: 500, noNaN: true, noDefaultInfinity: true }),
}).map(({ entry, slDelta, tpDelta }) => ({
  action: 'sell' as const,
  entry_price: entry,
  stop_loss: entry + slDelta,
  take_profit: entry - tpDelta,
}));

const signalArb = fc.oneof(buySignalArb, sellSignalArb);

const confidenceArb = fc.constantFrom('high', 'medium', 'low');

/** Price series that stays strictly between SL and TP (no hit). */
function neutralPricesArb(sl: number, tp: number) {
  const lo = Math.min(sl, tp);
  const hi = Math.max(sl, tp);
  // Prices strictly inside the range
  return fc.array(
    fc.double({ min: lo + 0.001, max: hi - 0.001, noNaN: true, noDefaultInfinity: true }),
    { minLength: 1, maxLength: 50 },
  );
}

// ---------------------------------------------------------------------------
// Property 6: 信号绩效追踪准确性
// Feature: quant-copilot-enhancement, Property 6: 信号绩效追踪准确性
// **Validates: Requirements 6.2, 6.3**
// ---------------------------------------------------------------------------

describe('Property 6: 信号绩效追踪准确性', () => {
  describe('determineOutcome', () => {
    it('returns hit_tp when price reaches take_profit before stop_loss', () => {
      fc.assert(
        fc.property(signalArb, (sig) => {
          // Build a price series that hits TP but never SL
          const prices = [sig.take_profit];
          const result = determineOutcome(
            sig.action, sig.entry_price, sig.take_profit, sig.stop_loss, prices,
          );
          expect(result).toBe('hit_tp');
        }),
        { numRuns: 100 },
      );
    });

    it('returns hit_sl when price reaches stop_loss before take_profit', () => {
      fc.assert(
        fc.property(signalArb, (sig) => {
          // Build a price series that hits SL but never TP
          const prices = [sig.stop_loss];
          const result = determineOutcome(
            sig.action, sig.entry_price, sig.take_profit, sig.stop_loss, prices,
          );
          expect(result).toBe('hit_sl');
        }),
        { numRuns: 100 },
      );
    });

    it('returns pending when price never reaches TP or SL', () => {
      fc.assert(
        fc.property(
          signalArb,
          fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }),
          (sig, frac) => {
            // Price stays between SL and TP
            const lo = Math.min(sig.stop_loss, sig.take_profit);
            const hi = Math.max(sig.stop_loss, sig.take_profit);
            const midPrice = lo + (hi - lo) * frac;
            // Ensure midPrice is strictly between SL and TP
            if (midPrice <= lo + 0.001 || midPrice >= hi - 0.001) return; // skip edge
            const prices = [midPrice];
            const result = determineOutcome(
              sig.action, sig.entry_price, sig.take_profit, sig.stop_loss, prices,
            );
            expect(result).toBe('pending');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('first-hit-wins: TP before SL in sequence → hit_tp', () => {
      fc.assert(
        fc.property(signalArb, (sig) => {
          // TP price first, then SL price
          const prices = [sig.take_profit, sig.stop_loss];
          const result = determineOutcome(
            sig.action, sig.entry_price, sig.take_profit, sig.stop_loss, prices,
          );
          expect(result).toBe('hit_tp');
        }),
        { numRuns: 100 },
      );
    });

    it('first-hit-wins: SL before TP in sequence → hit_sl', () => {
      fc.assert(
        fc.property(signalArb, (sig) => {
          // SL price first, then TP price
          const prices = [sig.stop_loss, sig.take_profit];
          const result = determineOutcome(
            sig.action, sig.entry_price, sig.take_profit, sig.stop_loss, prices,
          );
          expect(result).toBe('hit_sl');
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('win_rate = hit_tp_count / (hit_tp_count + hit_sl_count)', () => {
    it('computeWinRate matches the formula for any non-negative counts', () => {
      const countArb = fc.nat({ max: 1000 });
      fc.assert(
        fc.property(countArb, countArb, (hitTp, hitSl) => {
          const result = computeWinRate(hitTp, hitSl);
          const completed = hitTp + hitSl;
          if (completed === 0) {
            expect(result).toBe(0);
          } else {
            expect(result).toBeCloseTo(hitTp / completed, 10);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('getStats win_rate matches hit_tp / (hit_tp + hit_sl) from DB signals', () => {
      const outcomeArb = fc.constantFrom<SignalOutcome>('hit_tp', 'hit_sl', 'expired', 'pending');
      const signalListArb = fc.array(
        fc.record({
          signal: signalArb,
          confidence: confidenceArb,
          outcome: outcomeArb,
        }),
        { minLength: 1, maxLength: 30 },
      );

      fc.assert(
        fc.property(signalListArb, (signals) => {
          const db = createTestDb();
          try {
            const tracker = new SignalTracker(db);

            for (const s of signals) {
              insertSignal(db, {
                symbol: 'TEST',
                action: s.signal.action,
                entry_price: s.signal.entry_price,
                stop_loss: s.signal.stop_loss,
                take_profit: s.signal.take_profit,
                confidence: s.confidence,
                outcome: s.outcome,
              });
            }

            const stats = tracker.getStats();

            // Verify counts
            const expectedTp = signals.filter((s) => s.outcome === 'hit_tp').length;
            const expectedSl = signals.filter((s) => s.outcome === 'hit_sl').length;
            const expectedExpired = signals.filter((s) => s.outcome === 'expired').length;
            const expectedPending = signals.filter((s) => s.outcome === 'pending').length;

            expect(stats.total_signals).toBe(signals.length);
            expect(stats.hit_tp_count).toBe(expectedTp);
            expect(stats.hit_sl_count).toBe(expectedSl);
            expect(stats.expired_count).toBe(expectedExpired);
            expect(stats.pending_count).toBe(expectedPending);

            // Verify win_rate
            const completed = expectedTp + expectedSl;
            const expectedWinRate = completed > 0 ? expectedTp / completed : 0;
            expect(stats.win_rate).toBeCloseTo(expectedWinRate, 10);
          } finally {
            db.close();
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
