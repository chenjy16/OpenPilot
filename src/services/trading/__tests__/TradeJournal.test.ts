/**
 * Tests for TradeJournal
 *
 * Feature: multi-strategy-trading
 * Requirements: 12.1, 12.2, 12.3
 */

import Database from 'better-sqlite3';
import { initTradingTables } from '../tradingSchema';
import {
  TradeJournal,
  computeWeeklyStats,
  type TradeRecord,
  type AIRuntimeLike,
} from '../TradeJournal';

// ─── Helpers ───────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  initTradingTables(db);
  return db;
}

function makeTrade(overrides: Partial<Omit<TradeRecord, 'id'>> = {}): Omit<TradeRecord, 'id'> {
  return {
    symbol: 'AAPL',
    strategy_name: 'momentum_breakout',
    entry_price: 100,
    exit_price: 110,
    entry_time: 1700000000,
    exit_time: 1700100000,
    pnl: 10,
    pnl_pct: 0.1,
    hold_days: 2,
    reason: 'take_profit',
    ...overrides,
  };
}

// ─── computeWeeklyStats (pure function) ────────────────────────────────────

describe('computeWeeklyStats', () => {
  it('should return zeros for empty trades', () => {
    const stats = computeWeeklyStats([]);
    expect(stats.total_trades).toBe(0);
    expect(stats.win_rate).toBe(0);
    expect(stats.total_pnl).toBe(0);
    expect(stats.strategy_breakdown).toEqual({});
  });

  it('should compute correct stats for mixed trades', () => {
    const trades: TradeRecord[] = [
      { ...makeTrade({ pnl: 50, strategy_name: 'momentum_breakout' }), id: 1 },
      { ...makeTrade({ pnl: -20, strategy_name: 'momentum_breakout' }), id: 2 },
      { ...makeTrade({ pnl: 30, strategy_name: 'mean_reversion' }), id: 3 },
    ];

    const stats = computeWeeklyStats(trades);
    expect(stats.total_trades).toBe(3);
    expect(stats.win_rate).toBeCloseTo(2 / 3);
    expect(stats.total_pnl).toBeCloseTo(60);

    expect(stats.strategy_breakdown['momentum_breakout']).toEqual({
      trades: 2,
      win_rate: 0.5,
      pnl: 30,
    });
    expect(stats.strategy_breakdown['mean_reversion']).toEqual({
      trades: 1,
      win_rate: 1,
      pnl: 30,
    });
  });

  it('should treat pnl = 0 as not winning', () => {
    const trades: TradeRecord[] = [
      { ...makeTrade({ pnl: 0 }), id: 1 },
    ];
    const stats = computeWeeklyStats(trades);
    expect(stats.win_rate).toBe(0);
  });
});

// ─── TradeJournal.record ───────────────────────────────────────────────────

describe('TradeJournal.record', () => {
  it('should insert a trade and return it with an id', () => {
    const db = createTestDb();
    const journal = new TradeJournal(db);
    const trade = makeTrade();

    const result = journal.record(trade);
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('number');
    expect(result.symbol).toBe('AAPL');
    expect(result.pnl).toBe(10);
    db.close();
  });

  it('should assign incrementing ids', () => {
    const db = createTestDb();
    const journal = new TradeJournal(db);

    const r1 = journal.record(makeTrade());
    const r2 = journal.record(makeTrade({ symbol: 'GOOG' }));
    expect(r2.id!).toBeGreaterThan(r1.id!);
    db.close();
  });
});

// ─── TradeJournal.query ────────────────────────────────────────────────────

describe('TradeJournal.query', () => {
  let db: Database.Database;
  let journal: TradeJournal;

  beforeEach(() => {
    db = createTestDb();
    journal = new TradeJournal(db);

    // Insert test data
    journal.record(makeTrade({ symbol: 'AAPL', strategy_name: 'momentum_breakout', pnl: 50, exit_time: 1000 }));
    journal.record(makeTrade({ symbol: 'GOOG', strategy_name: 'mean_reversion', pnl: -20, exit_time: 2000 }));
    journal.record(makeTrade({ symbol: 'MSFT', strategy_name: 'momentum_breakout', pnl: 30, exit_time: 3000 }));
    journal.record(makeTrade({ symbol: 'TSLA', strategy_name: 'news_momentum', pnl: -10, exit_time: 4000 }));
  });

  afterEach(() => db.close());

  it('should return all trades when no filter is provided', () => {
    const results = journal.query();
    expect(results).toHaveLength(4);
  });

  it('should filter by strategy_name', () => {
    const results = journal.query({ strategy_name: 'momentum_breakout' });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.strategy_name).toBe('momentum_breakout');
    }
  });

  it('should filter by time range', () => {
    const results = journal.query({ start_time: 1500, end_time: 3500 });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.exit_time).toBeGreaterThanOrEqual(1500);
      expect(r.exit_time).toBeLessThanOrEqual(3500);
    }
  });

  it('should filter profitable trades', () => {
    const results = journal.query({ profitable: true });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.pnl).toBeGreaterThan(0);
    }
  });

  it('should filter non-profitable trades', () => {
    const results = journal.query({ profitable: false });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.pnl).toBeLessThanOrEqual(0);
    }
  });

  it('should combine multiple filters', () => {
    const results = journal.query({ strategy_name: 'momentum_breakout', profitable: true });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.strategy_name).toBe('momentum_breakout');
      expect(r.pnl).toBeGreaterThan(0);
    }
  });

  it('should return results ordered by exit_time descending', () => {
    const results = journal.query();
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].exit_time).toBeGreaterThanOrEqual(results[i].exit_time);
    }
  });
});

// ─── TradeJournal.generateWeeklyReview ─────────────────────────────────────

describe('TradeJournal.generateWeeklyReview', () => {
  it('should aggregate stats and include AI suggestions', async () => {
    const db = createTestDb();
    const journal = new TradeJournal(db);

    journal.record(makeTrade({ pnl: 50, exit_time: 500 }));
    journal.record(makeTrade({ pnl: -20, exit_time: 600 }));

    const mockAI: AIRuntimeLike = {
      generateText: async () => 'Reduce position sizes during high volatility.',
    };

    const review = await journal.generateWeeklyReview(
      { start_date: 0, end_date: 1000 },
      mockAI,
    );

    expect(review.total_trades).toBe(2);
    expect(review.win_rate).toBeCloseTo(0.5);
    expect(review.total_pnl).toBeCloseTo(30);
    expect(review.ai_suggestions).toBe('Reduce position sizes during high volatility.');
    expect(review.strategy_breakdown).toBeDefined();
    db.close();
  });

  it('should handle AI failure gracefully', async () => {
    const db = createTestDb();
    const journal = new TradeJournal(db);

    journal.record(makeTrade({ exit_time: 500 }));

    const failingAI: AIRuntimeLike = {
      generateText: async () => { throw new Error('API timeout'); },
    };

    const review = await journal.generateWeeklyReview(
      { start_date: 0, end_date: 1000 },
      failingAI,
    );

    expect(review.total_trades).toBe(1);
    expect(review.ai_suggestions).toContain('unavailable');
    db.close();
  });

  it('should return empty review for no trades in range', async () => {
    const db = createTestDb();
    const journal = new TradeJournal(db);

    journal.record(makeTrade({ exit_time: 5000 }));

    const mockAI: AIRuntimeLike = {
      generateText: async () => 'No trades to review.',
    };

    const review = await journal.generateWeeklyReview(
      { start_date: 0, end_date: 1000 },
      mockAI,
    );

    expect(review.total_trades).toBe(0);
    expect(review.win_rate).toBe(0);
    expect(review.total_pnl).toBe(0);
    expect(review.strategy_breakdown).toEqual({});
    db.close();
  });
});


// ─── Property-Based Tests ──────────────────────────────────────────────────

import * as fc from 'fast-check';

/**
 * Arbitrary generator for valid TradeRecord objects.
 * Uses finite numbers for all numeric fields.
 * Note: id is optional in the interface; we generate records both with and
 * without id. When id is absent we omit the key entirely so that
 * JSON.stringify round-trip is lossless (JSON.stringify drops undefined values).
 * We also avoid -0 by using noDefaultInfinity + filtering, since JSON.parse
 * converts -0 to 0.
 */
const positiveDouble = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const safeDouble = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map(v => (Object.is(v, -0) ? 0 : v));

const tradeRecordArb: fc.Arbitrary<TradeRecord> = fc.oneof(
  // With id
  fc.record({
    id: fc.nat(),
    symbol: fc.stringMatching(/^[A-Z]{1,5}$/),
    strategy_name: fc.constantFrom('momentum_breakout', 'mean_reversion', 'news_momentum'),
    entry_price: positiveDouble(0.01, 100000),
    exit_price: positiveDouble(0.01, 100000),
    entry_time: fc.nat({ max: 2000000000 }),
    exit_time: fc.nat({ max: 2000000000 }),
    pnl: safeDouble(-100000, 100000),
    pnl_pct: safeDouble(-10, 10),
    hold_days: fc.nat({ max: 365 }),
    reason: fc.constantFrom('take_profit', 'stop_loss', 'manual', 'timeout'),
  }),
  // Without id (omitted entirely)
  fc.record({
    symbol: fc.stringMatching(/^[A-Z]{1,5}$/),
    strategy_name: fc.constantFrom('momentum_breakout', 'mean_reversion', 'news_momentum'),
    entry_price: positiveDouble(0.01, 100000),
    exit_price: positiveDouble(0.01, 100000),
    entry_time: fc.nat({ max: 2000000000 }),
    exit_time: fc.nat({ max: 2000000000 }),
    pnl: safeDouble(-100000, 100000),
    pnl_pct: safeDouble(-10, 10),
    hold_days: fc.nat({ max: 365 }),
    reason: fc.constantFrom('take_profit', 'stop_loss', 'manual', 'timeout'),
  }) as fc.Arbitrary<TradeRecord>,
);

describe('TradeRecord JSON round-trip (Property 12)', () => {
  /**
   * Property 12: TradeRecord JSON 序列化 round-trip
   *
   * For any valid TradeRecord object, JSON.parse(JSON.stringify(record))
   * should deep equal the original object.
   *
   * **Validates: Requirements 12.4**
   */
  it('should survive JSON serialization round-trip for any valid TradeRecord', () => {
    fc.assert(
      fc.property(tradeRecordArb, (record: TradeRecord) => {
        const roundTripped = JSON.parse(JSON.stringify(record));
        expect(roundTripped).toEqual(record);
      }),
      { numRuns: 200 },
    );
  });
});


// ─── Property 13: 交易日志查询过滤正确性 ───────────────────────────────────

/**
 * Arbitrary generator for trade records suitable for DB insertion (no id).
 * Uses constrained values that work well with SQLite.
 */
const dbTradeRecordArb: fc.Arbitrary<Omit<TradeRecord, 'id'>> = fc.record({
  symbol: fc.stringMatching(/^[A-Z]{1,5}$/),
  strategy_name: fc.constantFrom('momentum_breakout', 'mean_reversion', 'news_momentum'),
  entry_price: fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true }),
  exit_price: fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true }),
  entry_time: fc.integer({ min: 1_000_000, max: 2_000_000_000 }),
  exit_time: fc.integer({ min: 1_000_000, max: 2_000_000_000 }),
  pnl: fc.double({ min: -10000, max: 10000, noNaN: true, noDefaultInfinity: true }),
  pnl_pct: fc.double({ min: -5, max: 5, noNaN: true, noDefaultInfinity: true }),
  hold_days: fc.integer({ min: 1, max: 60 }),
  reason: fc.constantFrom('take_profit', 'stop_loss', 'manual', 'timeout'),
});

/**
 * Arbitrary generator for query filter conditions.
 * Each field is optional — we randomly include or omit each filter dimension.
 */
const queryFilterArb = fc.record({
  strategy_name: fc.option(
    fc.constantFrom('momentum_breakout', 'mean_reversion', 'news_momentum'),
    { nil: undefined },
  ),
  start_time: fc.option(
    fc.integer({ min: 1_000_000, max: 2_000_000_000 }),
    { nil: undefined },
  ),
  end_time: fc.option(
    fc.integer({ min: 1_000_000, max: 2_000_000_000 }),
    { nil: undefined },
  ),
  profitable: fc.option(fc.boolean(), { nil: undefined }),
});

describe('Trade journal query filter correctness (Property 13)', () => {
  /**
   * Property 13: 交易日志查询过滤正确性
   *
   * For any set of trade records and any combination of filter conditions
   * (strategy_name, start_time, end_time, profitable), every record returned
   * by journal.query(filter) must satisfy ALL specified filter conditions.
   *
   * **Validates: Requirements 12.2**
   */
  it('every returned record should satisfy all specified filter conditions', () => {
    fc.assert(
      fc.property(
        fc.array(dbTradeRecordArb, { minLength: 0, maxLength: 20 }),
        queryFilterArb,
        (trades, filter) => {
          const db = createTestDb();
          const journal = new TradeJournal(db);

          // Insert all generated trades
          for (const trade of trades) {
            journal.record(trade);
          }

          // Query with the generated filter
          const results = journal.query(filter);

          // Verify every returned record satisfies ALL filter conditions
          for (const record of results) {
            if (filter.strategy_name !== undefined) {
              expect(record.strategy_name).toBe(filter.strategy_name);
            }
            if (filter.start_time !== undefined) {
              expect(record.exit_time).toBeGreaterThanOrEqual(filter.start_time);
            }
            if (filter.end_time !== undefined) {
              expect(record.exit_time).toBeLessThanOrEqual(filter.end_time);
            }
            if (filter.profitable === true) {
              expect(record.pnl).toBeGreaterThan(0);
            } else if (filter.profitable === false) {
              expect(record.pnl).toBeLessThanOrEqual(0);
            }
          }

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 14: 周度复盘统计正确性 ───────────────────────────────────────

/**
 * Arbitrary generator for TradeRecord arrays with finite pnl values.
 * Uses integer pnl to avoid floating-point summation drift.
 */
const statsTradeRecordArb: fc.Arbitrary<TradeRecord> = fc.record({
  id: fc.nat(),
  symbol: fc.stringMatching(/^[A-Z]{1,5}$/),
  strategy_name: fc.constantFrom('momentum_breakout', 'mean_reversion', 'news_momentum'),
  entry_price: fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true }),
  exit_price: fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true }),
  entry_time: fc.nat({ max: 2_000_000_000 }),
  exit_time: fc.nat({ max: 2_000_000_000 }),
  pnl: fc.integer({ min: -10000, max: 10000 }),
  pnl_pct: fc.double({ min: -5, max: 5, noNaN: true, noDefaultInfinity: true }),
  hold_days: fc.integer({ min: 0, max: 365 }),
  reason: fc.constantFrom('take_profit', 'stop_loss', 'manual', 'timeout'),
});

describe('Weekly review stats correctness (Property 14)', () => {
  /**
   * Property 14: 周度复盘统计正确性
   *
   * For any array of trade records, computeWeeklyStats should return:
   * 1. total_trades equal to the array length
   * 2. win_rate equal to (trades with pnl > 0) / total_trades
   * 3. total_pnl equal to the sum of all pnl values
   *
   * **Validates: Requirements 12.3**
   */
  it('total_trades, win_rate, and total_pnl should be correct for any trade array', () => {
    fc.assert(
      fc.property(
        fc.array(statsTradeRecordArb, { minLength: 0, maxLength: 30 }),
        (trades: TradeRecord[]) => {
          const stats = computeWeeklyStats(trades);

          // 1. total_trades equals array length
          expect(stats.total_trades).toBe(trades.length);

          // 2. win_rate equals (trades with pnl > 0) / total_trades
          const expectedWinning = trades.filter(t => t.pnl > 0).length;
          const expectedWinRate = trades.length === 0 ? 0 : expectedWinning / trades.length;
          expect(stats.win_rate).toBeCloseTo(expectedWinRate, 10);

          // 3. total_pnl equals sum of all pnl values
          const expectedTotalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
          expect(stats.total_pnl).toBeCloseTo(expectedTotalPnl, 5);
        },
      ),
      { numRuns: 200 },
    );
  });
});
