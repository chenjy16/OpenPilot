import Database from 'better-sqlite3';
import { confidenceToNumber, meetsConfidenceThreshold, SignalEvaluator } from './SignalEvaluator';
import { initTradingTables } from './tradingSchema';
import type { SignalCard, EvaluationConfig } from './types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS strategies (id INTEGER PRIMARY KEY)`);
  db.exec(`CREATE TABLE IF NOT EXISTS stock_signals (id INTEGER PRIMARY KEY)`);
  initTradingTables(db);
  // Insert stub FK rows used by pipeline_signal_log inserts
  db.exec(`INSERT INTO stock_signals (id) VALUES (99)`);
  return db;
}

function makeSignal(overrides?: Partial<SignalCard>): SignalCard {
  return {
    id: 1,
    symbol: '700.HK',
    action: 'buy',
    entry_price: 350,
    stop_loss: 330,
    take_profit: 380,
    confidence: 'high',
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

const defaultConfig: EvaluationConfig = {
  confidence_threshold: 0.6,
  dedup_window_hours: 24,
};

// ─── Pure function tests ────────────────────────────────────────────────────

describe('confidenceToNumber', () => {
  it('maps high to 0.9', () => expect(confidenceToNumber('high')).toBe(0.9));
  it('maps medium to 0.6', () => expect(confidenceToNumber('medium')).toBe(0.6));
  it('maps low to 0.3', () => expect(confidenceToNumber('low')).toBe(0.3));
  it('maps null to 0', () => expect(confidenceToNumber(null)).toBe(0));
  it('maps unknown string to 0', () => expect(confidenceToNumber('unknown')).toBe(0));
  it('maps empty string to 0', () => expect(confidenceToNumber('')).toBe(0));
});

describe('meetsConfidenceThreshold', () => {
  it('high meets 0.6 threshold', () => expect(meetsConfidenceThreshold('high', 0.6)).toBe(true));
  it('medium meets 0.6 threshold', () => expect(meetsConfidenceThreshold('medium', 0.6)).toBe(true));
  it('low does not meet 0.6 threshold', () => expect(meetsConfidenceThreshold('low', 0.6)).toBe(false));
  it('null does not meet any positive threshold', () => expect(meetsConfidenceThreshold(null, 0.1)).toBe(false));
  it('high meets 0.9 threshold exactly', () => expect(meetsConfidenceThreshold('high', 0.9)).toBe(true));
  it('medium does not meet 0.7 threshold', () => expect(meetsConfidenceThreshold('medium', 0.7)).toBe(false));
  it('any confidence meets 0 threshold', () => expect(meetsConfidenceThreshold(null, 0)).toBe(true));
});

// ─── SignalEvaluator class tests ────────────────────────────────────────────

describe('SignalEvaluator', () => {
  let db: Database.Database;
  let evaluator: SignalEvaluator;

  beforeEach(() => {
    db = createTestDb();
    evaluator = new SignalEvaluator(db);
  });

  afterEach(() => {
    db.close();
  });

  it('skips hold signals', () => {
    const result = evaluator.evaluate(makeSignal({ action: 'hold' }), defaultConfig);
    expect(result).toEqual({ pass: false, reason: 'action_hold' });
  });

  it('skips signals with null entry_price', () => {
    const result = evaluator.evaluate(makeSignal({ entry_price: null }), defaultConfig);
    expect(result).toEqual({ pass: false, reason: 'missing_price' });
  });

  it('skips signals with undefined entry_price', () => {
    const result = evaluator.evaluate(
      makeSignal({ entry_price: undefined as unknown as null }),
      defaultConfig,
    );
    expect(result).toEqual({ pass: false, reason: 'missing_price' });
  });

  it('skips signals below confidence threshold', () => {
    const result = evaluator.evaluate(
      makeSignal({ confidence: 'low' }),
      { ...defaultConfig, confidence_threshold: 0.6 },
    );
    expect(result).toEqual({ pass: false, reason: 'confidence_below_threshold' });
  });

  it('passes signals meeting confidence threshold', () => {
    const result = evaluator.evaluate(
      makeSignal({ confidence: 'medium' }),
      { ...defaultConfig, confidence_threshold: 0.6 },
    );
    expect(result).toEqual({ pass: true });
  });

  it('detects duplicate signals within dedup window', () => {
    // Insert a previous order_created log for the same symbol+action
    db.prepare(
      `INSERT INTO pipeline_signal_log (signal_id, signal_source, symbol, action, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(99, 'quant_analyst', '700.HK', 'buy', 'order_created', Math.floor(Date.now() / 1000) - 3600);

    const result = evaluator.evaluate(makeSignal(), defaultConfig);
    expect(result).toEqual({ pass: false, reason: 'duplicate_signal' });
  });

  it('allows signals outside dedup window', () => {
    // Insert a log entry outside the 24h window
    db.prepare(
      `INSERT INTO pipeline_signal_log (signal_id, signal_source, symbol, action, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(99, 'quant_analyst', '700.HK', 'buy', 'order_created', Math.floor(Date.now() / 1000) - 25 * 3600);

    const result = evaluator.evaluate(makeSignal(), defaultConfig);
    expect(result).toEqual({ pass: true });
  });

  it('does not treat skipped results as duplicates', () => {
    // Insert a skipped_confidence log — should NOT count as duplicate
    db.prepare(
      `INSERT INTO pipeline_signal_log (signal_id, signal_source, symbol, action, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(99, 'quant_analyst', '700.HK', 'buy', 'skipped_confidence', Math.floor(Date.now() / 1000) - 3600);

    const result = evaluator.evaluate(makeSignal(), defaultConfig);
    expect(result).toEqual({ pass: true });
  });

  it('does not treat different symbol as duplicate', () => {
    db.prepare(
      `INSERT INTO pipeline_signal_log (signal_id, signal_source, symbol, action, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(99, 'quant_analyst', '9988.HK', 'buy', 'order_created', Math.floor(Date.now() / 1000) - 3600);

    const result = evaluator.evaluate(makeSignal(), defaultConfig);
    expect(result).toEqual({ pass: true });
  });

  it('does not treat different action as duplicate', () => {
    db.prepare(
      `INSERT INTO pipeline_signal_log (signal_id, signal_source, symbol, action, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(99, 'quant_analyst', '700.HK', 'sell', 'order_created', Math.floor(Date.now() / 1000) - 3600);

    const result = evaluator.evaluate(makeSignal(), defaultConfig);
    expect(result).toEqual({ pass: true });
  });

  it('respects evaluation order: hold checked before missing_price', () => {
    const result = evaluator.evaluate(
      makeSignal({ action: 'hold', entry_price: null }),
      defaultConfig,
    );
    expect(result.reason).toBe('action_hold');
  });

  it('respects evaluation order: missing_price checked before confidence', () => {
    const result = evaluator.evaluate(
      makeSignal({ entry_price: null, confidence: 'low' }),
      defaultConfig,
    );
    expect(result.reason).toBe('missing_price');
  });
});
