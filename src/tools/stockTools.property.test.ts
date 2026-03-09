/**
 * Property-Based Tests for Stock Analysis Tools
 *
 * Uses fast-check to verify universal properties across random inputs.
 *
 * Properties covered:
 *   - Property 1: 技术面分析输出结构完整性
 *   - Property 2: 技术面分析错误响应结构化
 *   - Property 5: 新闻内容截断约束
 *   - Property 6: Signal_Card 字段完整性
 *   - Property 7: 信号去重机制
 *   - Property 15: API 输入验证
 *   - Property 16: 推送内容无敏感信息
 */

import * as fc from 'fast-check';
import {
  createStockTechAnalysisTool,
  createStockSentimentTool,
  createStockDeliverAlertTool,
  filterSensitiveInfo,
  TechAnalysisResult,
  DeliverAlertParams,
} from './stockTools';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const upperAlpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Valid stock symbol: 1-5 uppercase letters */
const validSymbolArb = fc.string({ unit: fc.constantFrom(...upperAlpha), minLength: 1, maxLength: 5 });

/** Positive finite float suitable for prices */
const priceArb = fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true });

/** Valid TechAnalysisResult object */
const validTechResultArb = fc.record({
  symbol: validSymbolArb,
  price: priceArb,
  sma20: priceArb,
  sma50: priceArb,
  rsi14: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  macd_line: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  macd_signal: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  macd_histogram: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  bollinger_upper: priceArb,
  bollinger_lower: priceArb,
  volume_avg: fc.integer({ min: 1, max: 1_000_000_000 }),
  data_date: fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
    .map(d => d.toISOString().split('T')[0]),
});

/** Valid DeliverAlertParams */
const validAlertParamsArb = fc.record({
  symbol: validSymbolArb,
  action: fc.constantFrom('buy' as const, 'sell' as const, 'hold' as const),
  entry_price: priceArb,
  stop_loss: priceArb,
  take_profit: priceArb,
  reasoning: fc.string({ minLength: 1, maxLength: 500 }),
  confidence: fc.constantFrom('high' as const, 'medium' as const, 'low' as const),
  technical_summary: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  sentiment_summary: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
});

/** Error type arbitrary */
const errorTypeArb = fc.constantFrom(
  'INVALID_SYMBOL', 'SCRIPT_ERROR', 'SCRIPT_TIMEOUT',
  'NETWORK_ERROR', 'DATA_ERROR', 'PARSE_ERROR',
);

/** Error message arbitrary */
const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 });

/** News item with variable-length content */
const newsItemArb = fc.record({
  headline: fc.string({ minLength: 0, maxLength: 2000 }),
  summary: fc.string({ minLength: 0, maxLength: 2000 }),
  datetime: fc.integer({ min: 1_600_000_000, max: 1_800_000_000 }),
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockSandbox(execImpl?: (...args: any[]) => any) {
  return {
    exec: jest.fn(execImpl ?? (() => ({ stdout: '{}', stderr: '', exitCode: 0 }))),
  } as any;
}

function makeMockDb(dedupResult: any = null) {
  const stmtMock = {
    run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
    get: jest.fn().mockReturnValue(dedupResult),
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

// ---------------------------------------------------------------------------
// Property 1: 技术面分析输出结构完整性
// Feature: quant-stock-analysis, Property 1: 技术面分析输出结构完整性
// Validates: Requirements 1.1, 1.2, 11.1, 11.3
// ---------------------------------------------------------------------------

describe('Property 1: 技术面分析输出结构完整性', () => {
  const REQUIRED_FIELDS = [
    'symbol', 'price', 'sma20', 'sma50', 'rsi14',
    'macd_line', 'macd_signal', 'macd_histogram',
    'bollinger_upper', 'bollinger_lower', 'volume_avg', 'data_date',
  ];

  it('parsed result should contain all required fields for any valid Python output', async () => {
    await fc.assert(
      fc.asyncProperty(validTechResultArb, async (techResult) => {
        const sandbox = makeMockSandbox(() => ({
          stdout: JSON.stringify(techResult),
          stderr: '',
          exitCode: 0,
        }));
        const tool = createStockTechAnalysisTool(sandbox);
        const result = await tool.execute({ symbol: techResult.symbol });

        // Should not be an error
        expect(result.error).toBeUndefined();

        // All required fields must be present and defined
        for (const field of REQUIRED_FIELDS) {
          expect(result).toHaveProperty(field);
          expect((result as any)[field]).not.toBeNull();
          expect((result as any)[field]).not.toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 2: 技术面分析错误响应结构化
// Feature: quant-stock-analysis, Property 2: 技术面分析错误响应结构化
// Validates: Requirements 1.4, 11.4
// ---------------------------------------------------------------------------

describe('Property 2: 技术面分析错误响应结构化', () => {
  it('should return structured error with error type and message for any script failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        validSymbolArb,
        errorTypeArb,
        errorMessageArb,
        fc.boolean(),
        async (symbol, errorType, errorMsg, useNonZeroExit) => {
          let sandbox: any;

          if (useNonZeroExit) {
            // Non-zero exit code with error JSON in stdout
            sandbox = makeMockSandbox(() => ({
              stdout: JSON.stringify({ error: errorType, message: errorMsg }),
              stderr: 'script failed',
              exitCode: 1,
            }));
          } else {
            // Zero exit code but error JSON in stdout
            sandbox = makeMockSandbox(() => ({
              stdout: JSON.stringify({ error: errorType, message: errorMsg }),
              stderr: '',
              exitCode: 0,
            }));
          }

          const tool = createStockTechAnalysisTool(sandbox);
          const result = await tool.execute({ symbol });

          // Must have error and message fields
          expect(result).toHaveProperty('error');
          expect(typeof result.error).toBe('string');
          expect(result.error.length).toBeGreaterThan(0);

          expect(result).toHaveProperty('message');
          expect(typeof result.message).toBe('string');
          expect(result.message.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 5: 新闻内容截断约束
// Feature: quant-stock-analysis, Property 5: 新闻内容截断约束
// Validates: Requirements 2.5
// ---------------------------------------------------------------------------

describe('Property 5: 新闻内容截断约束', () => {
  const originalEnv = process.env;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, FINNHUB_API_KEY: 'test-key-for-pbt' };
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it('each summary ≤ 500 chars and total ≤ 5000 chars for any news content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(newsItemArb, { minLength: 1, maxLength: 30 }),
        async (newsItems) => {
          // Mock fetch: news endpoint returns our generated items, others return empty
          globalThis.fetch = jest.fn()
            .mockResolvedValueOnce({
              ok: true,
              json: async () => newsItems,
            } as any)
            .mockResolvedValueOnce({
              ok: true,
              json: async () => [],
            } as any)
            .mockResolvedValueOnce({
              ok: true,
              json: async () => ({}),
            } as any);

          const tool = createStockSentimentTool();
          const result = await tool.execute({ symbol: 'AAPL' });

          // If it's an error response (all sources failed), skip validation
          if (result.error) return;

          // Each individual news item fields must be ≤ 500 chars
          for (const item of result.news) {
            expect(item.title.length).toBeLessThanOrEqual(500);
            expect(item.summary.length).toBeLessThanOrEqual(500);
          }

          // Total content must be ≤ 5000 chars
          const totalLength = result.news.reduce(
            (sum: number, n: any) => sum + n.title.length + n.summary.length,
            0,
          );
          expect(totalLength).toBeLessThanOrEqual(5000);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 6: Signal_Card 字段完整性
// Feature: quant-stock-analysis, Property 6: Signal_Card 字段完整性
// Validates: Requirements 3.1, 3.2
// ---------------------------------------------------------------------------

describe('Property 6: Signal_Card 字段完整性', () => {
  it('formatted Signal_Card should contain all required fields for any valid params', async () => {
    await fc.assert(
      fc.asyncProperty(validAlertParamsArb, async (params) => {
        const db = makeMockDb();
        const cm = makeMockChannelManager();
        const config = {
          enabled: true,
          telegram: { chatId: 'test-chat' },
        };

        const tool = createStockDeliverAlertTool(db, cm, config);
        const result = await tool.execute(params as any);

        // Should not be an error or deduplicated
        expect(result.error).toBeUndefined();
        expect(result.deduplicated).toBe(false);

        // Capture the Signal_Card text sent to channelManager
        expect(cm.sendMessage).toHaveBeenCalled();
        const sentText: string = cm.sendMessage.mock.calls[0][1].text;

        // Signal_Card must contain all required fields
        // symbol
        expect(sentText).toContain(params.symbol);
        // action (Chinese label)
        const actionLabels: Record<string, string> = { buy: '买入', sell: '卖出', hold: '观望' };
        expect(sentText).toContain(actionLabels[params.action]);
        // entry_price
        expect(sentText).toContain(params.entry_price.toFixed(2));
        // stop_loss
        expect(sentText).toContain(params.stop_loss.toFixed(2));
        // take_profit
        expect(sentText).toContain(params.take_profit.toFixed(2));
        // reasoning (may be filtered for sensitive info, but core text should be present)
        // We check the filtered version is present
        const filteredReasoning = filterSensitiveInfo(params.reasoning);
        expect(sentText).toContain(filteredReasoning);
        // timestamp (UTC format)
        expect(sentText).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 7: 信号去重机制
// Feature: quant-stock-analysis, Property 7: 信号去重机制
// Validates: Requirements 3.4
// ---------------------------------------------------------------------------

describe('Property 7: 信号去重机制', () => {
  it('same symbol + same action within 24h should be deduplicated', async () => {
    await fc.assert(
      fc.asyncProperty(
        validAlertParamsArb,
        fc.integer({ min: 1, max: 999 }),
        async (params, existingId) => {
          // Mock DB to return an existing signal for the dedup check
          const db = makeMockDb({ id: existingId });

          const tool = createStockDeliverAlertTool(db);
          const result = await tool.execute(params as any);

          // Should be deduplicated
          expect(result.deduplicated).toBe(true);
          expect(result.signal_id).toBe(existingId);
          expect(result.message).toContain('deduplicated');

          // DB insert should NOT have been called (only the dedup SELECT)
          // The prepare mock is called once for the SELECT, not for INSERT
          const prepareCalls = db.prepare.mock.calls;
          const insertCalls = prepareCalls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT'),
          );
          expect(insertCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 15: API 输入验证
// Feature: quant-stock-analysis, Property 15: API 输入验证
// Validates: Requirements 10.6
// ---------------------------------------------------------------------------

describe('Property 15: API 输入验证', () => {
  /** Generate invalid symbols: contains digits, special chars, empty, or too long */
  const invalidSymbolArb = fc.oneof(
    // Empty string
    fc.constant(''),
    // Contains digits
    fc.string({ unit: fc.constantFrom(...'0123456789'.split('')), minLength: 1, maxLength: 5 }),
    // Contains special characters
    fc.string({ unit: fc.constantFrom(...'!@#$%^&*()'.split('')), minLength: 1, maxLength: 5 }),
    // Mixed alpha + digits
    fc.tuple(
      fc.string({ unit: fc.constantFrom(...upperAlpha), minLength: 1, maxLength: 3 }),
      fc.string({ unit: fc.constantFrom(...'0123456789'.split('')), minLength: 1, maxLength: 3 }),
    ).map(([a, b]) => a + b),
    // Too long (> 10 chars)
    fc.string({ unit: fc.constantFrom(...upperAlpha), minLength: 11, maxLength: 20 }),
    // Lowercase digits/special (still invalid after uppercase)
    fc.string({ unit: fc.constantFrom(...'0123456789!@#'.split('')), minLength: 1, maxLength: 5 }),
  );

  it('Tech_Analysis_Tool should return error for any invalid symbol without executing', async () => {
    await fc.assert(
      fc.asyncProperty(invalidSymbolArb, async (symbol) => {
        const sandbox = makeMockSandbox();
        const tool = createStockTechAnalysisTool(sandbox);
        const result = await tool.execute({ symbol });

        expect(result).toHaveProperty('error');
        expect(result.error).toBe('INVALID_SYMBOL');
        // Sandbox should NOT have been called
        expect(sandbox.exec).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('Sentiment_Tool should return error for any invalid symbol without executing', async () => {
    await fc.assert(
      fc.asyncProperty(invalidSymbolArb, async (symbol) => {
        const tool = createStockSentimentTool();
        const result = await tool.execute({ symbol });

        // Should be INVALID_SYMBOL (checked before API key check)
        expect(result).toHaveProperty('error');
        expect(result.error).toBe('INVALID_SYMBOL');
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 16: 推送内容无敏感信息
// Feature: quant-stock-analysis, Property 16: 推送内容无敏感信息
// Validates: Requirements 12.4
// ---------------------------------------------------------------------------

describe('Property 16: 推送内容无敏感信息', () => {
  const alphanumChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

  /** Generate strings with embedded sensitive patterns */
  const sensitivePatternArb = fc.oneof(
    // API key pattern: api_key=<value>
    fc.string({ minLength: 5, maxLength: 30 }).map((v: string) => `api_key=${v.replace(/\s/g, 'x')}`),
    // Password pattern: password=<value>
    fc.string({ minLength: 5, maxLength: 30 }).map((v: string) => `password=${v.replace(/\s/g, 'x')}`),
    // Token pattern: token=<value>
    fc.string({ minLength: 5, maxLength: 30 }).map((v: string) => `token=${v.replace(/\s/g, 'x')}`),
    // FINNHUB_API_KEY=<value>
    fc.string({ minLength: 5, maxLength: 30 }).map((v: string) => `FINNHUB_API_KEY=${v.replace(/\s/g, 'x')}`),
    // OpenAI key pattern: sk-<20+ chars>
    fc.string({ unit: fc.constantFrom(...alphanumChars), minLength: 20, maxLength: 40 })
      .map((v: string) => `sk-${v}`),
    // GitHub PAT: ghp_<36+ chars>
    fc.string({ unit: fc.constantFrom(...alphanumChars), minLength: 36, maxLength: 50 })
      .map((v: string) => `ghp_${v}`),
    // Secret pattern: secret=<value>
    fc.string({ minLength: 5, maxLength: 30 }).map((v: string) => `secret=${v.replace(/\s/g, 'x')}`),
  );

  it('filterSensitiveInfo should strip sensitive patterns from any input', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        sensitivePatternArb,
        fc.string({ minLength: 0, maxLength: 100 }),
        (prefix, sensitive, suffix) => {
          const input = `${prefix} ${sensitive} ${suffix}`;
          const filtered = filterSensitiveInfo(input);

          // The sensitive pattern should be replaced with [REDACTED]
          // We verify the original sensitive value is not present
          // (the key=value pair should be redacted)
          expect(filtered).not.toContain(sensitive);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Signal_Card should not contain sensitive info even if reasoning contains it', async () => {
    await fc.assert(
      fc.asyncProperty(
        validAlertParamsArb,
        sensitivePatternArb,
        async (params, sensitiveText) => {
          // Inject sensitive text into reasoning
          const paramsWithSensitive = {
            ...params,
            reasoning: `Analysis: ${sensitiveText} shows bullish trend`,
          };

          const db = makeMockDb();
          const cm = makeMockChannelManager();
          const config = {
            enabled: true,
            telegram: { chatId: 'test-chat' },
          };

          const tool = createStockDeliverAlertTool(db, cm, config);
          const result = await tool.execute(paramsWithSensitive as any);

          if (result.error || result.deduplicated) return;

          // Capture the Signal_Card text
          expect(cm.sendMessage).toHaveBeenCalled();
          const sentText: string = cm.sendMessage.mock.calls[0][1].text;

          // The sensitive pattern should NOT appear in the card
          expect(sentText).not.toContain(sensitiveText);
        },
      ),
      { numRuns: 100 },
    );
  });
});
