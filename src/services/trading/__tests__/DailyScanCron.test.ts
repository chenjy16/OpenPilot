import Database from 'better-sqlite3';
import { DailyScanCron } from '../DailyScanCron';
import type { NotificationServiceLike, DailyScanResult } from '../DailyScanCron';
import type { StrategySignal, StrategyRegistration } from '../types';
import type { MultiStrategyResult } from '../AutoTradingPipeline';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS dynamic_watchlist (
      symbol TEXT PRIMARY KEY,
      price REAL,
      avg_volume INTEGER,
      avg_dollar_volume REAL,
      market_cap INTEGER,
      atr_pct REAL,
      returns_20d REAL,
      rsi REAL,
      above_sma20 INTEGER,
      screened_at INTEGER,
      pool TEXT
    );
  `);
  return db;
}

function insertWatchlistRow(
  db: Database.Database,
  symbol: string,
  overrides: Record<string, any> = {},
): void {
  db.prepare(`
    INSERT OR REPLACE INTO dynamic_watchlist (symbol, price, avg_volume, avg_dollar_volume, market_cap, atr_pct, returns_20d, rsi, above_sma20, screened_at, pool)
    VALUES (@symbol, @price, @avg_volume, @avg_dollar_volume, @market_cap, @atr_pct, @returns_20d, @rsi, @above_sma20, @screened_at, @pool)
  `).run({
    symbol,
    price: 150,
    avg_volume: 1000000,
    avg_dollar_volume: 150000000,
    market_cap: 2000000000,
    atr_pct: 2.5,
    returns_20d: 0.08,
    rsi: 55,
    above_sma20: 1,
    screened_at: Math.floor(Date.now() / 1000),
    pool: 'default',
    ...overrides,
  });
}

function makeSignal(symbol: string): StrategySignal {
  return {
    symbol,
    action: 'buy',
    entry_price: 150,
    stop_loss: 142.5,
    take_profit: 168,
    scores: { momentum_score: 0.9, volume_score: 0.8 },
    metadata: {},
  };
}

function makeMockStrategyEngine(registrations: Map<string, StrategyRegistration>): any {
  return {
    getRegisteredStrategies: jest.fn().mockReturnValue(registrations),
  };
}

function makeMockSignalAggregator(): any {
  return {
    aggregate: jest.fn(),
  };
}

function makeMockPipeline(results: MultiStrategyResult[] = []): any {
  return {
    processMultiStrategySignals: jest.fn().mockResolvedValue(results),
  };
}

function makeMockNotificationService(): NotificationServiceLike & { sendNotification: jest.Mock } {
  return {
    sendNotification: jest.fn().mockResolvedValue(undefined),
  };
}

function makeStrategy(name: string, signalFn?: (symbol: string, indicators: Record<string, number | null>) => StrategySignal | null): any {
  return {
    name,
    generateSignal: signalFn ?? jest.fn().mockReturnValue(null),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DailyScanCron', () => {
  describe('runDailyScan', () => {
    it('returns zero counts when watchlist is empty', async () => {
      const db = createTestDb();
      const registrations = new Map<string, StrategyRegistration>();
      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);
      const result = await cron.runDailyScan();

      expect(result.scanned_symbols).toBe(0);
      expect(result.signals_generated).toBe(0);
      expect(result.orders_created).toBe(0);
      expect(result.scan_time_ms).toBeGreaterThanOrEqual(0);
      expect(ns.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('scans symbols and runs enabled strategies', async () => {
      const db = createTestDb();
      insertWatchlistRow(db, 'AAPL');
      insertWatchlistRow(db, 'GOOGL');

      const strategy = makeStrategy('momentum_breakout', (symbol) => makeSignal(symbol));
      const registrations = new Map<string, StrategyRegistration>([
        ['momentum_breakout', { strategy, weight: 0.4, enabled: true }],
      ]);

      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline([
        { symbol: 'AAPL', action: 'order_created', order_id: 1 },
      ]);
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);
      const result = await cron.runDailyScan();

      expect(result.scanned_symbols).toBe(2);
      expect(result.signals_generated).toBe(2);
      expect(result.orders_created).toBe(1);
      expect(pipeline.processMultiStrategySignals).toHaveBeenCalledTimes(1);

      // Verify the signal map passed to pipeline
      const signalMap = pipeline.processMultiStrategySignals.mock.calls[0][0] as Map<string, StrategySignal[]>;
      expect(signalMap.get('momentum_breakout')).toHaveLength(2);
    });

    it('skips disabled strategies', async () => {
      const db = createTestDb();
      insertWatchlistRow(db, 'AAPL');

      const enabledStrategy = makeStrategy('momentum_breakout', (symbol) => makeSignal(symbol));
      const disabledStrategy = makeStrategy('mean_reversion', (symbol) => makeSignal(symbol));

      const registrations = new Map<string, StrategyRegistration>([
        ['momentum_breakout', { strategy: enabledStrategy, weight: 0.4, enabled: true }],
        ['mean_reversion', { strategy: disabledStrategy, weight: 0.3, enabled: false }],
      ]);

      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);
      const result = await cron.runDailyScan();

      expect(result.signals_generated).toBe(1);
      const signalMap = pipeline.processMultiStrategySignals.mock.calls[0][0] as Map<string, StrategySignal[]>;
      expect(signalMap.has('momentum_breakout')).toBe(true);
      expect(signalMap.has('mean_reversion')).toBe(false);
    });

    it('handles strategy errors gracefully and continues', async () => {
      const db = createTestDb();
      insertWatchlistRow(db, 'AAPL');
      insertWatchlistRow(db, 'GOOGL');

      const failingStrategy = makeStrategy('momentum_breakout', (symbol) => {
        if (symbol === 'AAPL') throw new Error('Strategy error');
        return makeSignal(symbol);
      });

      const registrations = new Map<string, StrategyRegistration>([
        ['momentum_breakout', { strategy: failingStrategy, weight: 0.4, enabled: true }],
      ]);

      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);
      const result = await cron.runDailyScan();

      // AAPL failed, GOOGL succeeded
      expect(result.scanned_symbols).toBe(2);
      expect(result.signals_generated).toBe(1);
    });

    it('does not call pipeline when no signals generated', async () => {
      const db = createTestDb();
      insertWatchlistRow(db, 'AAPL');

      const strategy = makeStrategy('momentum_breakout', () => null);
      const registrations = new Map<string, StrategyRegistration>([
        ['momentum_breakout', { strategy, weight: 0.4, enabled: true }],
      ]);

      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);
      const result = await cron.runDailyScan();

      expect(result.signals_generated).toBe(0);
      expect(result.orders_created).toBe(0);
      expect(pipeline.processMultiStrategySignals).not.toHaveBeenCalled();
    });

    it('sends notification summary with correct data', async () => {
      const db = createTestDb();
      insertWatchlistRow(db, 'AAPL');

      const strategy = makeStrategy('momentum_breakout', (symbol) => makeSignal(symbol));
      const registrations = new Map<string, StrategyRegistration>([
        ['momentum_breakout', { strategy, weight: 0.4, enabled: true }],
      ]);

      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline([
        { symbol: 'AAPL', action: 'order_created', order_id: 1 },
      ]);
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);
      await cron.runDailyScan();

      expect(ns.sendNotification).toHaveBeenCalledTimes(1);
      const message = ns.sendNotification.mock.calls[0][0] as string;
      expect(message).toContain('Scanned symbols: 1');
      expect(message).toContain('Signals generated: 1');
      expect(message).toContain('Orders created: 1');
    });

    it('handles notification failure gracefully', async () => {
      const db = createTestDb();
      const registrations = new Map<string, StrategyRegistration>();
      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();
      ns.sendNotification.mockRejectedValue(new Error('Notification failed'));

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);

      // Should not throw
      const result = await cron.runDailyScan();
      expect(result.scanned_symbols).toBe(0);
    });

    it('returns DailyScanResult with scan_time_ms', async () => {
      const db = createTestDb();
      const registrations = new Map<string, StrategyRegistration>();
      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);
      const result = await cron.runDailyScan();

      expect(typeof result.scan_time_ms).toBe('number');
      expect(result.scan_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('runs multiple strategies and aggregates signals correctly', async () => {
      const db = createTestDb();
      insertWatchlistRow(db, 'AAPL');

      const strategy1 = makeStrategy('momentum_breakout', (symbol) => makeSignal(symbol));
      const strategy2 = makeStrategy('mean_reversion', (symbol) => ({
        ...makeSignal(symbol),
        scores: { momentum_score: 0.5, volume_score: 0.6 },
      }));

      const registrations = new Map<string, StrategyRegistration>([
        ['momentum_breakout', { strategy: strategy1, weight: 0.4, enabled: true }],
        ['mean_reversion', { strategy: strategy2, weight: 0.3, enabled: true }],
      ]);

      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline([
        { symbol: 'AAPL', action: 'order_created', order_id: 1 },
      ]);
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);
      const result = await cron.runDailyScan();

      expect(result.signals_generated).toBe(2);
      const signalMap = pipeline.processMultiStrategySignals.mock.calls[0][0] as Map<string, StrategySignal[]>;
      expect(signalMap.size).toBe(2);
      expect(signalMap.get('momentum_breakout')).toHaveLength(1);
      expect(signalMap.get('mean_reversion')).toHaveLength(1);
    });
  });

  describe('start / stop', () => {
    it('start and stop do not throw', () => {
      const db = createTestDb();
      const registrations = new Map<string, StrategyRegistration>();
      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);

      expect(() => cron.start('0 16 * * 1-5')).not.toThrow();
      expect(() => cron.stop()).not.toThrow();
    });

    it('stop is idempotent', () => {
      const db = createTestDb();
      const registrations = new Map<string, StrategyRegistration>();
      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);

      // Stop without start should not throw
      expect(() => cron.stop()).not.toThrow();
      expect(() => cron.stop()).not.toThrow();
    });

    it('start replaces previous cron task', () => {
      const db = createTestDb();
      const registrations = new Map<string, StrategyRegistration>();
      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);

      cron.start('0 16 * * 1-5');
      // Starting again should stop previous and start new
      expect(() => cron.start('0 17 * * 1-5')).not.toThrow();
      cron.stop();
    });
  });

  describe('buildIndicators (via runDailyScan)', () => {
    it('passes watchlist data as indicators to strategies', async () => {
      const db = createTestDb();
      insertWatchlistRow(db, 'AAPL', { price: 155, rsi: 28, returns_20d: 0.1 });

      const generateSignal = jest.fn().mockReturnValue(null);
      const strategy = { name: 'test_strategy', generateSignal };
      const registrations = new Map<string, StrategyRegistration>([
        ['test_strategy', { strategy, weight: 1.0, enabled: true }],
      ]);

      const se = makeMockStrategyEngine(registrations);
      const sa = makeMockSignalAggregator();
      const pipeline = makeMockPipeline();
      const ns = makeMockNotificationService();

      const cron = new DailyScanCron(db, se, sa, pipeline, ns);
      await cron.runDailyScan();

      expect(generateSignal).toHaveBeenCalledTimes(1);
      const [symbol, indicators] = generateSignal.mock.calls[0];
      expect(symbol).toBe('AAPL');
      expect(indicators.price).toBe(155);
      expect(indicators.rsi_14).toBe(28);
      expect(indicators.returns_20d).toBe(0.1);
      // Missing indicators should be null
      expect(indicators.high_20d).toBeNull();
      expect(indicators.sentiment_score).toBeNull();
    });
  });
});
