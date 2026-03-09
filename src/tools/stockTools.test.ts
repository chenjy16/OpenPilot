/**
 * Unit tests for Stock Analysis Tools
 *
 * Covers:
 *   - stockTechAnalysisTool: normal flow, invalid symbol, timeout, script error, JSON parse error, missing fields
 *   - stockSentimentTool: normal flow, API key missing/invalid, news truncation, partial failure
 *   - stockDeliverAlertTool: normal flow, dedup, no channels, push failure, invalid action
 *   - filterSensitiveInfo: API keys, passwords, normal text
 *   - registerStockTools: registration with ToolExecutor
 */

import {
  createStockTechAnalysisTool,
  createStockSentimentTool,
  createStockDeliverAlertTool,
  filterSensitiveInfo,
  registerStockTools,
  createStockTools,
} from './stockTools';
import { ToolExecutor } from './ToolExecutor';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockSandbox(execImpl?: (...args: any[]) => any) {
  return {
    exec: jest.fn(execImpl ?? (() => ({ stdout: '{}', stderr: '', exitCode: 0 }))),
  } as any;
}

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

function makeMockChannelManager() {
  return {
    sendMessage: jest.fn().mockResolvedValue(undefined),
  } as any;
}

const VALID_TECH_OUTPUT = JSON.stringify({
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
});

// ---------------------------------------------------------------------------
// 1. stockTechAnalysisTool
// ---------------------------------------------------------------------------

describe('stockTechAnalysisTool', () => {
  it('should parse valid JSON stdout and return result', async () => {
    const sandbox = makeMockSandbox(() => ({
      stdout: VALID_TECH_OUTPUT,
      stderr: '',
      exitCode: 0,
    }));
    const tool = createStockTechAnalysisTool(sandbox);
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.symbol).toBe('AAPL');
    expect(result.price).toBe(195.5);
    expect(result.rsi14).toBe(55.2);
    expect(result.data_date).toBe('2024-01-15');
    expect(sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining('AAPL'),
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
  });

  it('should return error for invalid symbol', async () => {
    const sandbox = makeMockSandbox();
    const tool = createStockTechAnalysisTool(sandbox);
    const result = await tool.execute({ symbol: '123' });

    expect(result.error).toBe('INVALID_SYMBOL');
    expect(sandbox.exec).not.toHaveBeenCalled();
  });

  it('should return SCRIPT_TIMEOUT on timeout error', async () => {
    const sandbox = makeMockSandbox(() => {
      throw new Error('Operation timed out / timeout exceeded');
    });
    const tool = createStockTechAnalysisTool(sandbox);
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.error).toBe('SCRIPT_TIMEOUT');
    expect(result.source).toBe('stock_analysis.py');
  });

  it('should return SCRIPT_ERROR on non-zero exit code', async () => {
    const sandbox = makeMockSandbox(() => ({
      stdout: JSON.stringify({ message: 'Something went wrong' }),
      stderr: 'error output',
      exitCode: 1,
    }));
    const tool = createStockTechAnalysisTool(sandbox);
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.error).toBe('SCRIPT_ERROR');
    expect(result.message).toContain('Something went wrong');
  });

  it('should return SCRIPT_ERROR on non-JSON stdout', async () => {
    const sandbox = makeMockSandbox(() => ({
      stdout: 'this is not json',
      stderr: '',
      exitCode: 0,
    }));
    const tool = createStockTechAnalysisTool(sandbox);
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.error).toBe('SCRIPT_ERROR');
    expect(result.message).toContain('Failed to parse');
  });

  it('should return INCOMPLETE_DATA when required fields are missing', async () => {
    const sandbox = makeMockSandbox(() => ({
      stdout: JSON.stringify({ symbol: 'AAPL', price: 195.5 }),
      stderr: '',
      exitCode: 0,
    }));
    const tool = createStockTechAnalysisTool(sandbox);
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.error).toBe('INCOMPLETE_DATA');
    expect(result.message).toContain('Missing required field');
  });

  it('should return SCRIPT_ERROR when stdout is empty', async () => {
    const sandbox = makeMockSandbox(() => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
    }));
    const tool = createStockTechAnalysisTool(sandbox);
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.error).toBe('SCRIPT_ERROR');
    expect(result.message).toContain('empty output');
  });

  it('should forward script-reported error JSON', async () => {
    const sandbox = makeMockSandbox(() => ({
      stdout: JSON.stringify({ error: 'INVALID_SYMBOL', message: 'No data for XYZ' }),
      stderr: '',
      exitCode: 0,
    }));
    const tool = createStockTechAnalysisTool(sandbox);
    const result = await tool.execute({ symbol: 'XYZ' });

    expect(result.error).toBe('INVALID_SYMBOL');
    expect(result.message).toBe('No data for XYZ');
  });
});

// ---------------------------------------------------------------------------
// 2. stockSentimentTool
// ---------------------------------------------------------------------------

describe('stockSentimentTool', () => {
  const originalEnv = process.env;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, FINNHUB_API_KEY: 'test-key-123' };
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it('should return parsed sentiment data on success', async () => {
    const newsResponse = [
      { headline: 'Apple beats earnings', summary: 'Great quarter', datetime: 1705300000 },
    ];
    const recResponse = [
      { buy: 10, hold: 5, sell: 2, strongBuy: 3, strongSell: 0, period: '2024-01' },
    ];
    const metricResponse = {
      metric: { epsAnnual: 6.5, peAnnual: 30.1, marketCapitalization: 3000000 },
    };

    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => newsResponse } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => recResponse } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => metricResponse } as any);

    const tool = createStockSentimentTool();
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.symbol).toBe('AAPL');
    expect(result.news).toHaveLength(1);
    expect(result.news[0].title).toBe('Apple beats earnings');
    expect(result.data_sources).toContain('finnhub_news');
    expect(result.data_sources).toContain('finnhub_recommendation');
    expect(result.data_sources).toContain('finnhub_metrics');
    expect(result.analyst_rating).toContain('Buy: 10');
    expect(result.earnings_summary).toContain('EPS(Annual): 6.5');
  });

  it('should return error when API key is missing', async () => {
    delete process.env.FINNHUB_API_KEY;

    const tool = createStockSentimentTool();
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.error).toBe('API_KEY_MISSING');
  });

  it('should return error when API key is invalid (401)', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as any);

    const tool = createStockSentimentTool();
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.error).toBe('API_KEY_INVALID');
  });

  it('should truncate long news items to 500 chars and total to 5000', async () => {
    const longText = 'A'.repeat(1000);
    const manyNews = Array.from({ length: 20 }, (_, i) => ({
      headline: `News ${i} ${longText}`,
      summary: `Summary ${i} ${longText}`,
      datetime: 1705300000 + i,
    }));

    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manyNews } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any);

    const tool = createStockSentimentTool();
    const result = await tool.execute({ symbol: 'AAPL' });

    // Each individual news item should be truncated to 500 chars
    for (const item of result.news) {
      expect(item.title.length).toBeLessThanOrEqual(500);
      expect(item.summary.length).toBeLessThanOrEqual(500);
    }

    // Total content should not exceed 5000 chars
    const totalLength = result.news.reduce(
      (sum: number, n: any) => sum + n.title.length + n.summary.length,
      0,
    );
    expect(totalLength).toBeLessThanOrEqual(5000);
  });

  it('should handle partial API failures gracefully', async () => {
    const newsResponse = [
      { headline: 'Some news', summary: 'Details', datetime: 1705300000 },
    ];

    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => newsResponse } as any)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Timeout'));

    const tool = createStockSentimentTool();
    const result = await tool.execute({ symbol: 'AAPL' });

    // Should still return partial data
    expect(result.symbol).toBe('AAPL');
    expect(result.data_sources).toContain('finnhub_news');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e: string) => e.includes('finnhub_recommendation'))).toBe(true);
  });

  it('should return INVALID_SYMBOL for bad symbol', async () => {
    const tool = createStockSentimentTool();
    const result = await tool.execute({ symbol: '123' });

    expect(result.error).toBe('INVALID_SYMBOL');
  });

  it('should return API_FETCH_ERROR when all sources fail', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network down'));

    const tool = createStockSentimentTool();
    const result = await tool.execute({ symbol: 'AAPL' });

    expect(result.error).toBe('API_FETCH_ERROR');
    expect(result.message).toContain('All data sources failed');
  });
});

// ---------------------------------------------------------------------------
// 3. stockDeliverAlertTool
// ---------------------------------------------------------------------------

describe('stockDeliverAlertTool', () => {
  const baseParams = {
    symbol: 'AAPL',
    action: 'buy',
    entry_price: 195.5,
    stop_loss: 190.0,
    take_profit: 210.0,
    reasoning: 'RSI oversold, MACD golden cross',
    confidence: 'high',
  };

  it('should save signal and push to channels on normal flow', async () => {
    const db = makeMockDb();
    const cm = makeMockChannelManager();
    const config = {
      enabled: true,
      telegram: { chatId: 'chat123' },
      discord: { channelId: 'chan456' },
    };

    const tool = createStockDeliverAlertTool(db, cm, config);
    const result = await tool.execute(baseParams);

    expect(result.signal_id).toBe(1);
    expect(result.delivered).toBe(true);
    expect(result.channels).toContain('telegram');
    expect(result.channels).toContain('discord');
    expect(result.deduplicated).toBe(false);
    expect(db.prepare).toHaveBeenCalled();
    expect(cm.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('should return deduplicated result when signal exists within 24h', async () => {
    const db = makeMockDb();
    // Make the dedup query return an existing signal
    db._stmt.get.mockReturnValueOnce({ id: 42 });

    const tool = createStockDeliverAlertTool(db);
    const result = await tool.execute(baseParams);

    expect(result.deduplicated).toBe(true);
    expect(result.signal_id).toBe(42);
    expect(result.message).toContain('deduplicated');
  });

  it('should save signal with "无推送渠道已配置" when no channels configured', async () => {
    const db = makeMockDb();
    // No channelManager, no notifyConfig
    const tool = createStockDeliverAlertTool(db);
    const result = await tool.execute(baseParams);

    expect(result.signal_id).toBe(1);
    expect(result.delivered).toBe(false);
    expect(result.message).toContain('无推送渠道已配置');
  });

  it('should still save signal when push fails', async () => {
    const db = makeMockDb();
    const cm = makeMockChannelManager();
    cm.sendMessage.mockRejectedValue(new Error('Push failed'));
    const config = {
      enabled: true,
      telegram: { chatId: 'chat123' },
    };

    const tool = createStockDeliverAlertTool(db, cm, config);
    const result = await tool.execute(baseParams);

    // Signal should be saved (signal_id > 0)
    expect(result.signal_id).toBe(1);
    // But delivery failed
    expect(result.delivered).toBe(false);
    expect(result.message).toContain('推送失败');
  });

  it('should return error for invalid action', async () => {
    const db = makeMockDb();
    const tool = createStockDeliverAlertTool(db);
    const result = await tool.execute({ ...baseParams, action: 'invalid' });

    expect(result.error).toBe('INVALID_PARAMS');
    expect(result.message).toContain('Invalid action');
  });

  it('should return DB_ERROR when insert fails', async () => {
    const db = makeMockDb();
    // First call is dedup check (returns null = no dup), second call is insert (throws)
    let callCount = 0;
    db.prepare.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        return { get: jest.fn().mockReturnValue(null), run: jest.fn(), all: jest.fn() };
      }
      return {
        run: jest.fn(() => { throw new Error('DB write error'); }),
        get: jest.fn(),
        all: jest.fn(),
      };
    });

    const tool = createStockDeliverAlertTool(db);
    const result = await tool.execute(baseParams);

    expect(result.error).toBe('DB_ERROR');
  });
});

// ---------------------------------------------------------------------------
// 4. filterSensitiveInfo
// ---------------------------------------------------------------------------

describe('filterSensitiveInfo', () => {
  it('should strip API key patterns', () => {
    const text = 'Config: api_key= sk-abc123xyz FINNHUB_API_KEY= mykey456';
    const filtered = filterSensitiveInfo(text);

    expect(filtered).not.toContain('sk-abc123xyz');
    expect(filtered).not.toContain('mykey456');
    expect(filtered).toContain('[REDACTED]');
  });

  it('should strip password patterns', () => {
    const text = 'password= secret123 and token= tok_abc';
    const filtered = filterSensitiveInfo(text);

    expect(filtered).not.toContain('secret123');
    expect(filtered).not.toContain('tok_abc');
  });

  it('should leave normal text unchanged', () => {
    const text = 'AAPL is trading at $195.50 with RSI at 55.2';
    const filtered = filterSensitiveInfo(text);

    expect(filtered).toBe(text);
  });

  it('should strip GitHub personal access tokens', () => {
    const text = 'Use ghp_abcdefghijklmnopqrstuvwxyz1234567890 for auth';
    const filtered = filterSensitiveInfo(text);

    expect(filtered).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    expect(filtered).toContain('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// 5. registerStockTools
// ---------------------------------------------------------------------------

describe('registerStockTools', () => {
  it('should register all three tools with ToolExecutor', () => {
    const executor = new ToolExecutor();
    const deps = {
      sandbox: makeMockSandbox(),
      db: makeMockDb(),
    };

    registerStockTools(executor, deps);

    expect(executor.hasTool('stock_tech_analysis')).toBe(true);
    expect(executor.hasTool('stock_sentiment')).toBe(true);
    expect(executor.hasTool('stock_deliver_alert')).toBe(true);
  });

  it('createStockTools should return tools array and register function', () => {
    const deps = {
      sandbox: makeMockSandbox(),
      db: makeMockDb(),
    };

    const { tools, register } = createStockTools(deps);

    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).toEqual([
      'stock_tech_analysis',
      'stock_sentiment',
      'stock_deliver_alert',
    ]);

    const executor = new ToolExecutor();
    register(executor);
    expect(executor.getRegisteredToolNames()).toEqual(
      expect.arrayContaining(['stock_tech_analysis', 'stock_sentiment', 'stock_deliver_alert']),
    );
  });
});
