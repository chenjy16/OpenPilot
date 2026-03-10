/**
 * Unit tests for StockScanner service
 *
 * Covers:
 *   - runFullScan: empty watchlist, valid watchlist, error tolerance
 *   - analyzeSingle: normal flow, no AI model error
 *   - Signal saving: db.prepare().run() called with correct params
 *   - updateConfig: config merging
 */

import { StockScanner, StockScanConfig } from './StockScanner';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockDb() {
  const stmtMock = {
    run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
    get: jest.fn().mockReturnValue(null),
    all: jest.fn().mockReturnValue([]),
  };
  return {
    prepare: jest.fn().mockReturnValue(stmtMock),
    _stmt: stmtMock,
  } as any;
}

const AI_RESPONSE_JSON = {
  action: 'buy',
  entry_price: 195.5,
  stop_loss: 190.0,
  take_profit: 210.0,
  reasoning: 'RSI oversold, MACD golden cross',
  confidence: 'high',
};

function makeMockAiRuntime(overrides?: Partial<{
  executeImpl: (...args: any[]) => any;
  configuredModels: string[];
  techResult: any;
  sentimentResult: any;
}>) {
  const techResult = overrides?.techResult ?? {
    symbol: 'AAPL',
    price: 195.5,
    sma20: 192.3,
    sma50: 188.1,
    rsi14: 55.2,
    macd_line: 1.5,
    macd_signal: 1.2,
    macd_histogram: 0.3,
    bollinger_upper: 200.0,
    bollinger_lower: 185.0,
    volume_avg: 50000000,
    data_date: '2024-01-15',
  };

  const sentimentResult = overrides?.sentimentResult ?? {
    symbol: 'AAPL',
    earnings_summary: 'EPS beat estimates',
    analyst_rating: 'Buy consensus',
    news: [{ title: 'Apple beats earnings', summary: 'Great quarter', published_at: '2024-01-15' }],
    data_sources: ['finnhub_news'],
    errors: [],
  };

  const techTool = { execute: jest.fn().mockResolvedValue(techResult) };
  const sentimentTool = { execute: jest.fn().mockResolvedValue(sentimentResult) };

  return {
    execute: jest.fn(overrides?.executeImpl ?? (async () => ({
      text: JSON.stringify(AI_RESPONSE_JSON),
    }))),
    getModelManager: jest.fn().mockReturnValue({
      getConfiguredModels: jest.fn().mockReturnValue(
        overrides?.configuredModels ?? ['deepseek/deepseek-reasoner'],
      ),
    }),
    toolExecutor: {
      getTool: jest.fn((name: string) => {
        if (name === 'stock_tech_analysis') return techTool;
        if (name === 'stock_sentiment') return sentimentTool;
        return undefined;
      }),
    },
    _techTool: techTool,
    _sentimentTool: sentimentTool,
  } as any;
}

// ---------------------------------------------------------------------------
// 1. runFullScan — empty watchlist
// ---------------------------------------------------------------------------

describe('StockScanner', () => {
  describe('runFullScan', () => {
    it('should return empty results for empty watchlist', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime();
      const scanner = new StockScanner(db, ai, { watchlist: [] });

      const result = await scanner.runFullScan();

      expect(result.signals).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.scannedCount).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(ai.execute).not.toHaveBeenCalled();
    });

    it('should process all stocks in watchlist and return signals', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime();
      const scanner = new StockScanner(db, ai, { watchlist: ['AAPL', 'GOOGL'] });

      const result = await scanner.runFullScan();

      expect(result.signals).toHaveLength(2);
      expect(result.errors).toEqual([]);
      expect(result.scannedCount).toBe(2);
      expect(result.signals[0].symbol).toBe('AAPL');
      expect(result.signals[1].symbol).toBe('GOOGL');
      expect(ai.execute).toHaveBeenCalledTimes(2);
    });

    it('should tolerate single stock failure and continue processing others', async () => {
      const db = makeMockDb();
      let callCount = 0;
      const ai = makeMockAiRuntime({
        executeImpl: async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('AI service unavailable');
          }
          return { text: JSON.stringify(AI_RESPONSE_JSON) };
        },
      });
      const scanner = new StockScanner(db, ai, { watchlist: ['FAIL_STOCK', 'GOOGL', 'MSFT'] });

      const result = await scanner.runFullScan();

      // First stock fails, other two succeed
      expect(result.signals).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('FAIL_STOCK');
      expect(result.errors[0]).toContain('AI service unavailable');
      expect(result.scannedCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // 2. analyzeSingle
  // -------------------------------------------------------------------------

  describe('analyzeSingle', () => {
    it('should call tech tool, sentiment tool, AI, and save to DB', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime();
      const scanner = new StockScanner(db, ai, { watchlist: ['AAPL'] });

      const signal = await scanner.analyzeSingle('AAPL');

      // Verify tech tool was called
      expect(ai._techTool.execute).toHaveBeenCalledWith({ symbol: 'AAPL' });
      // Verify sentiment tool was called
      expect(ai._sentimentTool.execute).toHaveBeenCalledWith({ symbol: 'AAPL' });
      // Verify AI was called
      expect(ai.execute).toHaveBeenCalledTimes(1);
      expect(ai.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('AAPL'),
          model: 'deepseek/deepseek-reasoner',
        }),
      );
      // Verify signal structure
      expect(signal.symbol).toBe('AAPL');
      expect(signal.action).toBe('buy');
      expect(signal.entry_price).toBe(195.5);
      expect(signal.stop_loss).toBe(190.0);
      expect(signal.take_profit).toBe(210.0);
      expect(signal.confidence).toBe('high');
      // Verify DB save
      expect(db.prepare).toHaveBeenCalled();
      expect(db._stmt.run).toHaveBeenCalledWith(
        'AAPL',
        'buy',
        195.5,
        190.0,
        210.0,
        expect.any(String),   // reasoning
        expect.any(String),   // technical_summary
        expect.any(String),   // sentiment_summary
        'high',               // confidence
        'pending',            // outcome
        null,                 // technical_score
        null,                 // sentiment_score
        null,                 // overall_score
        expect.any(Number),   // created_at
      );
    });

    it('should throw error when no AI model is configured', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime({ configuredModels: [] });
      const scanner = new StockScanner(db, ai, { watchlist: ['AAPL'] });

      await expect(scanner.analyzeSingle('AAPL')).rejects.toThrow('No AI model configured');
    });

    it('should uppercase and trim the symbol', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime();
      const scanner = new StockScanner(db, ai, { watchlist: [] });

      const signal = await scanner.analyzeSingle('  aapl  ');

      expect(signal.symbol).toBe('AAPL');
      expect(ai._techTool.execute).toHaveBeenCalledWith({ symbol: 'AAPL' });
    });

    it('should default to hold/low when AI returns unparseable response', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime({
        executeImpl: async () => ({ text: 'This is not JSON at all' }),
      });
      const scanner = new StockScanner(db, ai, { watchlist: ['AAPL'] });

      const signal = await scanner.analyzeSingle('AAPL');

      expect(signal.action).toBe('hold');
      expect(signal.confidence).toBe('low');
      expect(signal.entry_price).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Signal saving
  // -------------------------------------------------------------------------

  describe('signal saving', () => {
    it('should call db.prepare with INSERT statement and run with signal values', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime();
      const scanner = new StockScanner(db, ai, { watchlist: ['AAPL'] });

      await scanner.analyzeSingle('AAPL');

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO stock_signals'),
      );
      const runCall = db._stmt.run.mock.calls[0];
      expect(runCall[0]).toBe('AAPL');       // symbol
      expect(runCall[1]).toBe('buy');         // action
      expect(runCall[2]).toBe(195.5);         // entry_price
      expect(runCall[3]).toBe(190.0);         // stop_loss
      expect(runCall[4]).toBe(210.0);         // take_profit
      expect(typeof runCall[5]).toBe('string'); // reasoning
      expect(typeof runCall[6]).toBe('string'); // technical_summary
      expect(typeof runCall[7]).toBe('string'); // sentiment_summary
      expect(runCall[8]).toBe('high');         // confidence
      expect(typeof runCall[9]).toBe('string'); // outcome
      // runCall[10..12] = technical_score, sentiment_score, overall_score
      expect(typeof runCall[13]).toBe('number'); // created_at (unix timestamp)
    });

    it('should not throw when db save fails (error is logged)', async () => {
      const db = makeMockDb();
      db._stmt.run.mockImplementation(() => { throw new Error('DB write error'); });
      const ai = makeMockAiRuntime();
      const scanner = new StockScanner(db, ai, { watchlist: ['AAPL'] });

      // Should not throw — saveSignal catches errors internally
      const signal = await scanner.analyzeSingle('AAPL');
      expect(signal.symbol).toBe('AAPL');
    });
  });

  // -------------------------------------------------------------------------
  // 4. updateConfig
  // -------------------------------------------------------------------------

  describe('updateConfig', () => {
    it('should merge partial config into existing config', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime();
      const scanner = new StockScanner(db, ai, { watchlist: ['AAPL'] });

      scanner.updateConfig({ watchlist: ['GOOGL', 'MSFT'] });

      const result = await scanner.runFullScan();
      expect(result.scannedCount).toBe(2);
      expect(result.signals[0].symbol).toBe('GOOGL');
      expect(result.signals[1].symbol).toBe('MSFT');
    });

    it('should preserve existing config fields when updating partially', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime();
      const scanner = new StockScanner(db, ai, {
        watchlist: ['AAPL'],
        model: 'custom-model',
      });

      scanner.updateConfig({ watchlist: ['GOOGL'] });

      // model should still be 'custom-model' — verify by checking AI call uses it
      await scanner.analyzeSingle('GOOGL');
      expect(ai.execute).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'custom-model' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5. Default config
  // -------------------------------------------------------------------------

  describe('constructor defaults', () => {
    it('should default to empty watchlist when no config provided', async () => {
      const db = makeMockDb();
      const ai = makeMockAiRuntime();
      const scanner = new StockScanner(db, ai);

      const result = await scanner.runFullScan();
      expect(result.signals).toEqual([]);
      expect(result.scannedCount).toBe(0);
    });
  });
});
