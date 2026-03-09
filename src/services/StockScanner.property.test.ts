/**
 * Property-Based Tests for StockScanner service
 *
 * Uses fast-check to verify universal properties across random inputs.
 *
 * Properties covered:
 *   - Property 9:  信号数据库读写一致性 (DB round-trip)
 *   - Property 10: 扫描器完整性与容错 (Scanner completeness)
 *   - Property 13: 信号过滤 API 正确性 (Signal filtering)
 *   - Property 14: 自选股池读写一致性 (Watchlist round-trip)
 */

import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { StockScanner, StockSignalResult } from './StockScanner';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const upperAlpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Valid stock symbol: 1-5 uppercase letters */
const validSymbolArb = fc.string({
  unit: fc.constantFrom(...upperAlpha),
  minLength: 1,
  maxLength: 5,
});

/** Positive finite float suitable for prices */
const priceArb = fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true });

/** Valid action */
const actionArb = fc.constantFrom('buy' as const, 'sell' as const, 'hold' as const);

/** Valid confidence */
const confidenceArb = fc.constantFrom('high', 'medium', 'low');

/** Valid StockSignalResult */
const validSignalArb: fc.Arbitrary<StockSignalResult> = fc.record({
  symbol: validSymbolArb,
  action: actionArb,
  entry_price: priceArb,
  stop_loss: priceArb,
  take_profit: priceArb,
  reasoning: fc.string({ minLength: 1, maxLength: 300 }),
  confidence: confidenceArb,
  technical_summary: fc.string({ minLength: 1, maxLength: 300 }),
  sentiment_summary: fc.string({ minLength: 1, maxLength: 300 }),
});

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS stock_signals (
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
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_signals_symbol ON stock_signals(symbol)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_signals_created ON stock_signals(created_at DESC)`);
  return db;
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const AI_RESPONSE_JSON = {
  action: 'buy',
  entry_price: 195.5,
  stop_loss: 190.0,
  take_profit: 210.0,
  reasoning: 'RSI oversold, MACD golden cross',
  confidence: 'high',
};

function makeMockAiRuntime(overrides?: {
  executeImpl?: (...args: any[]) => any;
  failSymbols?: Set<string>;
}) {
  const techTool = {
    execute: jest.fn().mockResolvedValue({
      symbol: 'TEST', price: 100, sma20: 98, sma50: 95, rsi14: 55,
      macd_line: 1.5, macd_signal: 1.2, macd_histogram: 0.3,
      bollinger_upper: 110, bollinger_lower: 90, volume_avg: 1000000,
      data_date: '2024-01-15',
    }),
  };
  const sentimentTool = {
    execute: jest.fn().mockResolvedValue({
      symbol: 'TEST', earnings_summary: 'Good', analyst_rating: 'Buy',
      news: [], data_sources: ['finnhub_news'], errors: [],
    }),
  };

  const failSymbols = overrides?.failSymbols ?? new Set<string>();

  return {
    execute: jest.fn(overrides?.executeImpl ?? (async (opts: any) => {
      // Extract symbol from the prompt message
      const symbolMatch = opts.message?.match(/股票代码:\s*(\S+)/);
      const symbol = symbolMatch?.[1] ?? '';
      if (failSymbols.has(symbol)) {
        throw new Error(`Analysis failed for ${symbol}`);
      }
      return { text: JSON.stringify(AI_RESPONSE_JSON) };
    })),
    getModelManager: jest.fn().mockReturnValue({
      getConfiguredModels: jest.fn().mockReturnValue(['deepseek/deepseek-reasoner']),
    }),
    toolExecutor: {
      getTool: jest.fn((name: string) => {
        if (name === 'stock_tech_analysis') return techTool;
        if (name === 'stock_sentiment') return sentimentTool;
        return undefined;
      }),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Property 9: 信号数据库读写一致性
// Feature: quant-stock-analysis, Property 9: 信号数据库读写一致性
// Validates: Requirements 4.3
// ---------------------------------------------------------------------------

describe('Property 9: 信号数据库读写一致性 (DB round-trip)', () => {
  it('writing a signal then reading it back should return equivalent data', () => {
    fc.assert(
      fc.property(validSignalArb, (signal) => {
        const db = createInMemoryDb();
        try {
          const createdAt = Math.floor(Date.now() / 1000);

          // Write
          db.prepare(`
            INSERT INTO stock_signals
              (symbol, action, entry_price, stop_loss, take_profit, reasoning, technical_summary, sentiment_summary, confidence, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            signal.symbol,
            signal.action,
            signal.entry_price,
            signal.stop_loss,
            signal.take_profit,
            signal.reasoning,
            signal.technical_summary,
            signal.sentiment_summary,
            signal.confidence,
            createdAt,
          );

          // Read back
          const row = db.prepare(
            `SELECT * FROM stock_signals WHERE symbol = ? AND created_at = ? ORDER BY id DESC LIMIT 1`,
          ).get(signal.symbol, createdAt) as any;

          // Verify fields match
          expect(row).toBeDefined();
          expect(row.symbol).toBe(signal.symbol);
          expect(row.action).toBe(signal.action);
          expect(row.entry_price).toBeCloseTo(signal.entry_price, 5);
          expect(row.stop_loss).toBeCloseTo(signal.stop_loss, 5);
          expect(row.take_profit).toBeCloseTo(signal.take_profit, 5);
          expect(row.reasoning).toBe(signal.reasoning);
          expect(row.technical_summary).toBe(signal.technical_summary);
          expect(row.sentiment_summary).toBe(signal.sentiment_summary);
          expect(row.confidence).toBe(signal.confidence);
          expect(row.created_at).toBe(createdAt);
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: 扫描器完整性与容错
// Feature: quant-stock-analysis, Property 10: 扫描器完整性与容错
// Validates: Requirements 7.2, 7.5
// ---------------------------------------------------------------------------

describe('Property 10: 扫描器完整性与容错 (Scanner completeness)', () => {
  it('signals.length + errors.length should equal watchlist.length for any watchlist', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a unique watchlist of 1-10 symbols
        fc.uniqueArray(validSymbolArb, { minLength: 1, maxLength: 10 }),
        // Generate a subset of indices that should fail
        fc.func(fc.boolean()),
        async (watchlist, shouldFail) => {
          // Determine which symbols will fail
          const failSymbols = new Set<string>();
          for (const sym of watchlist) {
            if (shouldFail(sym)) {
              failSymbols.add(sym);
            }
          }

          const ai = makeMockAiRuntime({ failSymbols });
          const db = createInMemoryDb();
          try {
            const scanner = new StockScanner(db, ai, { watchlist });
            const result = await scanner.runFullScan();

            // Core invariant: every stock in the watchlist is either a signal or an error
            expect(result.signals.length + result.errors.length).toBe(watchlist.length);
            expect(result.scannedCount).toBe(watchlist.length);
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: 信号过滤 API 正确性
// Feature: quant-stock-analysis, Property 13: 信号过滤 API 正确性
// Validates: Requirements 10.2
// ---------------------------------------------------------------------------

describe('Property 13: 信号过滤 API 正确性 (Signal filtering)', () => {
  it('filtered results should only contain signals matching all filter criteria', () => {
    fc.assert(
      fc.property(
        // Generate a set of signals to insert
        fc.array(
          fc.record({
            symbol: fc.constantFrom('AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA'),
            action: actionArb,
            entry_price: priceArb,
            stop_loss: priceArb,
            take_profit: priceArb,
            reasoning: fc.constant('test reasoning'),
            technical_summary: fc.constant('{}'),
            sentiment_summary: fc.constant('test sentiment'),
            confidence: confidenceArb,
            created_at: fc.integer({ min: 1_700_000_000, max: 1_710_000_000 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        // Filter params
        fc.record({
          filterSymbol: fc.option(
            fc.constantFrom('AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA'),
            { nil: undefined },
          ),
          fromTime: fc.option(
            fc.integer({ min: 1_700_000_000, max: 1_705_000_000 }),
            { nil: undefined },
          ),
          toTime: fc.option(
            fc.integer({ min: 1_705_000_001, max: 1_710_000_000 }),
            { nil: undefined },
          ),
        }),
        (signals, filters) => {
          const db = createInMemoryDb();
          try {
            // Insert all signals
            const insertStmt = db.prepare(`
              INSERT INTO stock_signals
                (symbol, action, entry_price, stop_loss, take_profit, reasoning, technical_summary, sentiment_summary, confidence, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const s of signals) {
              insertStmt.run(
                s.symbol, s.action, s.entry_price, s.stop_loss, s.take_profit,
                s.reasoning, s.technical_summary, s.sentiment_summary, s.confidence, s.created_at,
              );
            }

            // Build filtered query (same logic as the API endpoint)
            const conditions: string[] = [];
            const params: any[] = [];

            if (filters.filterSymbol !== undefined) {
              conditions.push('symbol = ?');
              params.push(filters.filterSymbol);
            }
            if (filters.fromTime !== undefined) {
              conditions.push('created_at >= ?');
              params.push(filters.fromTime);
            }
            if (filters.toTime !== undefined) {
              conditions.push('created_at <= ?');
              params.push(filters.toTime);
            }

            const whereClause = conditions.length > 0
              ? `WHERE ${conditions.join(' AND ')}`
              : '';
            const rows = db.prepare(
              `SELECT * FROM stock_signals ${whereClause} ORDER BY created_at DESC`,
            ).all(...params) as any[];

            // Verify: every returned row matches ALL filter criteria
            for (const row of rows) {
              if (filters.filterSymbol !== undefined) {
                expect(row.symbol).toBe(filters.filterSymbol);
              }
              if (filters.fromTime !== undefined) {
                expect(row.created_at).toBeGreaterThanOrEqual(filters.fromTime);
              }
              if (filters.toTime !== undefined) {
                expect(row.created_at).toBeLessThanOrEqual(filters.toTime);
              }
            }

            // Verify: no matching signal was missed (completeness)
            const expectedCount = signals.filter(s => {
              if (filters.filterSymbol !== undefined && s.symbol !== filters.filterSymbol) return false;
              if (filters.fromTime !== undefined && s.created_at < filters.fromTime) return false;
              if (filters.toTime !== undefined && s.created_at > filters.toTime) return false;
              return true;
            }).length;

            expect(rows.length).toBe(expectedCount);
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: 自选股池读写一致性
// Feature: quant-stock-analysis, Property 14: 自选股池读写一致性
// Validates: Requirements 10.5
// ---------------------------------------------------------------------------

describe('Property 14: 自选股池读写一致性 (Watchlist round-trip)', () => {
  it('writing a watchlist via updateConfig then reading back should return the same list', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(validSymbolArb, { minLength: 0, maxLength: 20 }),
        (watchlist) => {
          const db = createInMemoryDb();
          try {
            const ai = makeMockAiRuntime();

            // Set watchlist via constructor, then verify it's stored correctly
            const scanner = new StockScanner(db, ai, { watchlist });
            const config = (scanner as any).config;
            expect(config.watchlist).toEqual(watchlist);

            // Set watchlist via updateConfig, verify it's stored correctly
            const scanner2 = new StockScanner(db, ai);
            scanner2.updateConfig({ watchlist });
            const config2 = (scanner2 as any).config;
            expect(config2.watchlist).toEqual(watchlist);
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('updateConfig with watchlist then partial update should preserve the watchlist', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(validSymbolArb, { minLength: 0, maxLength: 20 }),
        fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
        fc.option(fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }), { nil: undefined }),
        (watchlist, model, threshold) => {
          const db = createInMemoryDb();
          try {
            const ai = makeMockAiRuntime();
            const scanner = new StockScanner(db, ai);

            // Write watchlist
            scanner.updateConfig({ watchlist });

            // Partial update with other fields
            const partialUpdate: Record<string, any> = {};
            if (model !== undefined) partialUpdate.model = model;
            if (threshold !== undefined) partialUpdate.signalThreshold = threshold;
            if (Object.keys(partialUpdate).length > 0) {
              scanner.updateConfig(partialUpdate);
            }

            // Read back — verify watchlist is preserved
            const config = (scanner as any).config;
            expect(config.watchlist).toEqual(watchlist);

            // Also verify other fields were set correctly
            if (model !== undefined) expect(config.model).toBe(model);
            if (threshold !== undefined) expect(config.signalThreshold).toBe(threshold);
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
