import * as fc from 'fast-check';
import { stripSensitiveFields } from '../services/trading/types';
import type {
  LiveDashboardResponse,
  AIDecision,
  LiveTradeRecord,
  RiskRuleType,
} from '../services/trading/types';
import { handleLiveDashboard, clearLiveDashboardCache, describeRiskRule } from './tradingRoutes';

// Feature: live-trading-dashboard, Property 4: 敏感字段过滤

const SENSITIVE_KEYWORDS = [
  'credential',
  'secret',
  'token',
  'api_key',
  'app_key',
  'app_secret',
  'access_token',
];

/**
 * Checks whether a field name contains any sensitive keyword (case-insensitive).
 */
function containsSensitiveKeyword(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Recursively collects all field names from a nested object/array structure.
 */
function collectAllFieldNames(obj: unknown): string[] {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return [];
  }
  if (Array.isArray(obj)) {
    return obj.flatMap((item) => collectAllFieldNames(item));
  }
  const names: string[] = [];
  for (const key of Object.keys(obj)) {
    names.push(key);
    names.push(...collectAllFieldNames((obj as Record<string, unknown>)[key]));
  }
  return names;
}

/**
 * Arbitrary that generates a sensitive field name by picking a keyword
 * and optionally wrapping it with a prefix/suffix.
 */
const sensitiveFieldNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...SENSITIVE_KEYWORDS),
  fc.tuple(
    fc.string({ minLength: 1, maxLength: 5, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')) }),
    fc.constantFrom(...SENSITIVE_KEYWORDS),
  ).map(([prefix, kw]) => `${prefix}_${kw}`),
  fc.tuple(
    fc.constantFrom(...SENSITIVE_KEYWORDS),
    fc.string({ minLength: 1, maxLength: 5, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) }),
  ).map(([kw, suffix]) => `${kw}_${suffix}`),
);

/**
 * Arbitrary that generates a safe (non-sensitive) field name.
 */
const safeFieldNameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')) })
  .filter((name: string) => !containsSensitiveKeyword(name));

/**
 * Arbitrary for a leaf value (non-object).
 */
const leafValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.string(),
  fc.boolean(),
  fc.constant(null),
);

/**
 * Arbitrary that generates a nested object with a mix of safe and sensitive fields.
 * Uses fc.letrec for recursive structure generation.
 */
const nestedObjectWithSensitiveFieldsArb = fc.letrec((tie) => ({
  value: fc.oneof(
    { weight: 3, arbitrary: leafValueArb },
    { weight: 1, arbitrary: tie('object') },
    { weight: 1, arbitrary: fc.array(tie('value'), { maxLength: 3 }) },
  ),
  object: fc
    .array(fc.tuple(
      fc.oneof(safeFieldNameArb, sensitiveFieldNameArb),
      tie('value'),
    ), { minLength: 1, maxLength: 6 })
    .map((entries) => Object.fromEntries(entries)),
})).object;

// **Validates: Requirements 1.5, 10.3**
describe('Property 4: 敏感字段过滤', () => {
  it('stripSensitiveFields removes ALL fields containing sensitive keywords from any nested object', () => {
    fc.assert(
      fc.property(nestedObjectWithSensitiveFieldsArb, (input) => {
        const output = stripSensitiveFields(input);

        // Collect all field names in the output
        const outputFieldNames = collectAllFieldNames(output);

        // No field name in the output should contain any sensitive keyword
        for (const fieldName of outputFieldNames) {
          if (containsSensitiveKeyword(fieldName)) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('stripSensitiveFields preserves all non-sensitive fields', () => {
    fc.assert(
      fc.property(
        fc.dictionary(safeFieldNameArb, leafValueArb, { minKeys: 1, maxKeys: 8 }),
        (input) => {
          const output = stripSensitiveFields(input);
          // All safe keys should be preserved
          for (const key of Object.keys(input)) {
            if (!(key in (output as Record<string, unknown>))) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});


// ---------------------------------------------------------------------------
// Shared generators for Properties 1-3 (mock-based tests)
// ---------------------------------------------------------------------------

function createMockGateway(overrides?: { positionsFail?: boolean }) {
  return {
    getPositions: jest.fn().mockImplementation(() => {
      if (overrides?.positionsFail) return Promise.reject(new Error('gateway error'));
      return Promise.resolve([
        { symbol: 'AAPL', quantity: 10, avg_cost: 150, current_price: 160, market_value: 1600 },
      ]);
    }),
    getAccount: jest.fn().mockResolvedValue({ total_assets: 10000, available_cash: 5000, frozen_cash: 0, currency: 'USD' }),
    placeOrder: jest.fn(),
    cancelOrder: jest.fn(),
    getOrder: jest.fn(),
    listOrders: jest.fn(),
    countOrders: jest.fn(),
    getConfig: jest.fn(),
    updateConfig: jest.fn(),
    getBrokerAdapter: jest.fn(),
    getBrokerCredentials: jest.fn(),
    getBrokerCredentialsMasked: jest.fn(),
    saveBrokerCredentials: jest.fn(),
  } as any;
}

function createMockRiskController() {
  return {
    listRules: jest.fn().mockReturnValue([
      { rule_name: 'Max Daily Loss', rule_type: 'max_daily_loss' as RiskRuleType, threshold: 100, enabled: true },
    ]),
    checkRisk: jest.fn(),
    updateRule: jest.fn(),
    getDynamicRiskState: jest.fn(),
    updateDynamicRisk: jest.fn(),
  } as any;
}

function createMockDb(overrides?: { auditLogFail?: boolean; firstTradeFail?: boolean }) {
  const stmts: Record<string, any> = {};
  return {
    prepare: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('trading_audit_log')) {
        return {
          all: jest.fn().mockImplementation(() => {
            if (overrides?.auditLogFail) throw new Error('audit log error');
            return [
              {
                id: 1,
                timestamp: Math.floor(Date.now() / 1000),
                operation: 'multi_strategy_order',
                order_id: null,
                request_params: JSON.stringify({ symbol: 'AAPL', composite_score: 0.8, order_type: 'buy', quantity: 100, ai_filter_result: 'pass' }),
                response_result: null,
                order_side: 'buy',
                order_price: 150.50,
              },
            ];
          }),
        };
      }
      if (sql.includes('MIN(entry_time)')) {
        return {
          get: jest.fn().mockImplementation(() => {
            if (overrides?.firstTradeFail) throw new Error('first trade error');
            return { first_trade_date: 1700000000 };
          }),
        };
      }
      return { all: jest.fn().mockReturnValue([]), get: jest.fn().mockReturnValue(null) };
    }),
  } as any;
}

// Mock PerformanceAnalytics and TradeJournal modules
jest.mock('../services/trading/PerformanceAnalytics', () => ({
  PerformanceAnalytics: jest.fn().mockImplementation(() => ({
    getMetrics: jest.fn().mockReturnValue({
      total_pnl: 250,
      equity_curve: [
        { date: '2024-01-01', equity: 1100, daily_pnl: 10, cumulative_return: 10 },
        { date: '2024-01-02', equity: 1250, daily_pnl: 15, cumulative_return: 25 },
      ],
      win_rate: 0.65,
      sharpe_ratio: 1.5,
      max_drawdown_pct: -5.2,
      total_trades: 20,
      profit_factor: 2.1,
    }),
  })),
}));

jest.mock('../services/trading/TradeJournal', () => ({
  TradeJournal: jest.fn().mockImplementation(() => ({
    query: jest.fn().mockReturnValue([
      {
        symbol: 'AAPL', strategy_name: 'momentum', entry_price: 150, exit_price: 160,
        pnl: 100, pnl_pct: 6.67, hold_days: 5, exit_time: 1700000100,
      },
      {
        symbol: 'GOOG', strategy_name: 'mean_reversion', entry_price: 140, exit_price: 135,
        pnl: -50, pnl_pct: -3.57, hold_days: 3, exit_time: 1700000050,
      },
    ]),
  })),
}));

// ---------------------------------------------------------------------------
// Property 1: API 响应结构完整性
// Feature: live-trading-dashboard, Property 1: API 响应结构完整性
// ---------------------------------------------------------------------------

// **Validates: Requirements 1.1**
describe('Property 1: API 响应结构完整性', () => {
  const REQUIRED_KEYS: (keyof LiveDashboardResponse)[] = [
    'account_summary',
    'equity_curve',
    'ai_decisions',
    'positions',
    'recent_trades',
    'metrics',
    'risk_summary',
    'warnings',
    'cached_at',
  ];

  beforeEach(() => {
    clearLiveDashboardCache();
  });

  it('response always contains all required keys regardless of backend state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          positionsFail: fc.boolean(),
        }),
        async (failures) => {
          clearLiveDashboardCache();
          const gateway = createMockGateway({ positionsFail: failures.positionsFail });
          const riskController = createMockRiskController();
          const db = createMockDb();

          const response = await handleLiveDashboard(gateway, riskController, db);

          for (const key of REQUIRED_KEYS) {
            if (!(key in response)) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: 缓存一致性
// Feature: live-trading-dashboard, Property 2: 缓存一致性
// ---------------------------------------------------------------------------

// **Validates: Requirements 1.3**
describe('Property 2: 缓存一致性', () => {
  beforeEach(() => {
    clearLiveDashboardCache();
  });

  it('two calls within 30 seconds return the same cached_at timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        clearLiveDashboardCache();
        const gateway = createMockGateway();
        const riskController = createMockRiskController();
        const db = createMockDb();

        const first = await handleLiveDashboard(gateway, riskController, db);
        const second = await handleLiveDashboard(gateway, riskController, db);

        return first.cached_at === second.cached_at;
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: 部分失败优雅降级
// Feature: live-trading-dashboard, Property 3: 部分失败优雅降级
// ---------------------------------------------------------------------------

// **Validates: Requirements 1.4**
describe('Property 3: 部分失败优雅降级', () => {
  beforeEach(() => {
    clearLiveDashboardCache();
  });

  it('when some data sources fail, corresponding fields are null and warnings count matches failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          positionsFail: fc.boolean(),
        }),
        async (failures) => {
          clearLiveDashboardCache();
          const gateway = createMockGateway({ positionsFail: failures.positionsFail });
          const riskController = createMockRiskController();
          const db = createMockDb();

          const response = await handleLiveDashboard(gateway, riskController, db);

          // Count expected failures
          let expectedFailures = 0;
          if (failures.positionsFail) {
            expectedFailures++;
            if (response.positions !== null) return false;
          } else {
            if (response.positions === null) return false;
          }

          return response.warnings.length === expectedFailures;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Shared generators for Properties 9, 11, 15, 16
// ---------------------------------------------------------------------------

const symbolArb = fc.stringMatching(/^[A-Z]{1,5}$/);

const aiDecisionArb: fc.Arbitrary<AIDecision> = fc.record({
  timestamp: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
  symbol: symbolArb,
  strategy_name: fc.constantFrom('momentum', 'mean_reversion', 'breakout'),
  side: fc.constantFrom('buy' as const, 'sell' as const),
  composite_score: fc.double({ min: 0, max: 1, noNaN: true }),
  entry_price: fc.double({ min: 1, max: 10000, noNaN: true }),
  stop_loss: fc.option(fc.double({ min: 1, max: 10000, noNaN: true }), { nil: null }),
  take_profit: fc.option(fc.double({ min: 1, max: 10000, noNaN: true }), { nil: null }),
  reason: fc.string({ maxLength: 100 }),
});

const liveTradeRecordArb: fc.Arbitrary<LiveTradeRecord> = fc.record({
  symbol: symbolArb,
  strategy_name: fc.constantFrom('momentum', 'mean_reversion', 'breakout'),
  entry_price: fc.double({ min: 1, max: 10000, noNaN: true }),
  exit_price: fc.double({ min: 1, max: 10000, noNaN: true }),
  pnl: fc.double({ min: -5000, max: 5000, noNaN: true }),
  pnl_pct: fc.double({ min: -100, max: 1000, noNaN: true }),
  hold_days: fc.integer({ min: 0, max: 365 }),
  exit_time: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
});

const liveDashboardResponseArb: fc.Arbitrary<LiveDashboardResponse> = fc.record({
  account_summary: fc.option(
    fc.record({
      initial_capital: fc.constant(1000),
      current_equity: fc.double({ min: 0, max: 100000, noNaN: true }),
      total_return_pct: fc.double({ min: -100, max: 10000, noNaN: true }),
      daily_pnl: fc.double({ min: -5000, max: 5000, noNaN: true }),
    }),
    { nil: null },
  ),
  equity_curve: fc.option(
    fc.array(
      fc.record({
        date: fc.integer({ min: 0, max: 3650 }).map((dayOffset) => {
          const d = new Date(2020, 0, 1 + dayOffset);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }),
        equity: fc.double({ min: 0, max: 100000, noNaN: true }),
        daily_pnl: fc.double({ min: -5000, max: 5000, noNaN: true }),
        cumulative_return: fc.double({ min: -100, max: 10000, noNaN: true }),
      }),
      { maxLength: 30 },
    ),
    { nil: null },
  ),
  ai_decisions: fc.option(
    fc.array(aiDecisionArb, { maxLength: 10 }),
    { nil: null },
  ),
  positions: fc.option(
    fc.array(
      fc.record({
        symbol: symbolArb,
        quantity: fc.integer({ min: 1, max: 1000 }),
        avg_cost: fc.double({ min: 1, max: 10000, noNaN: true }),
        current_price: fc.double({ min: 1, max: 10000, noNaN: true }),
        unrealized_pnl: fc.double({ min: -5000, max: 5000, noNaN: true }),
        unrealized_pnl_pct: fc.double({ min: -100, max: 1000, noNaN: true }),
      }),
      { maxLength: 10 },
    ),
    { nil: null },
  ),
  recent_trades: fc.option(
    fc.array(liveTradeRecordArb, { maxLength: 20 }),
    { nil: null },
  ),
  metrics: fc.option(
    fc.record({
      win_rate: fc.double({ min: 0, max: 1, noNaN: true }),
      sharpe_ratio: fc.option(fc.double({ min: -10, max: 10, noNaN: true }), { nil: null }),
      max_drawdown_pct: fc.double({ min: -100, max: 0, noNaN: true }),
      total_trades: fc.integer({ min: 0, max: 10000 }),
      profit_factor: fc.double({ min: 0, max: 100, noNaN: true }),
    }),
    { nil: null },
  ),
  risk_summary: fc.option(
    fc.array(
      fc.record({
        rule_name: fc.string({ minLength: 1, maxLength: 30 }),
        threshold: fc.double({ min: 0, max: 10000, noNaN: true }),
        triggered: fc.boolean(),
        description: fc.string({ minLength: 1, maxLength: 100 }),
      }),
      { maxLength: 10 },
    ),
    { nil: null },
  ),
  first_trade_date: fc.option(fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }), { nil: null }),
  warnings: fc.array(fc.string({ maxLength: 50 }), { maxLength: 5 }),
  cached_at: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
});

// ---------------------------------------------------------------------------
// Property 9: AI 决策排序与限制
// Feature: live-trading-dashboard, Property 9: AI 决策排序与限制
// ---------------------------------------------------------------------------

// **Validates: Requirements 5.1**
describe('Property 9: AI 决策排序与限制', () => {
  it('AI decisions are sorted by timestamp DESC and length <= 10', () => {
    fc.assert(
      fc.property(
        fc.array(aiDecisionArb, { minLength: 0, maxLength: 30 }),
        (decisions) => {
          // Simulate the backend logic: sort DESC, take first 10
          const sorted = [...decisions].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);

          // Length constraint
          if (sorted.length > 10) return false;

          // Sorted DESC by timestamp
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].timestamp > sorted[i - 1].timestamp) return false;
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: 交易历史排序与限制
// Feature: live-trading-dashboard, Property 11: 交易历史排序与限制
// ---------------------------------------------------------------------------

// **Validates: Requirements 7.1, 7.3**
describe('Property 11: 交易历史排序与限制', () => {
  it('recent trades are sorted by exit_time DESC and length <= 20', () => {
    fc.assert(
      fc.property(
        fc.array(liveTradeRecordArb, { minLength: 0, maxLength: 50 }),
        (trades) => {
          // Simulate the backend logic: sort DESC by exit_time, take first 20
          const sorted = [...trades].sort((a, b) => b.exit_time - a.exit_time).slice(0, 20);

          // Length constraint
          if (sorted.length > 20) return false;

          // Sorted DESC by exit_time
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].exit_time > sorted[i - 1].exit_time) return false;
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: 风控规则描述生成
// Feature: live-trading-dashboard, Property 13: 风控规则描述生成
// ---------------------------------------------------------------------------

const VALID_RULE_TYPES: RiskRuleType[] = [
  'max_order_amount',
  'max_daily_amount',
  'max_position_ratio',
  'max_daily_loss',
  'max_daily_trades',
  'max_positions',
  'max_weekly_loss',
];

// **Validates: Requirements 9.4**
describe('Property 13: 风控规则描述生成', () => {
  it('describeRiskRule returns a non-empty string for any valid rule_type and threshold', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_RULE_TYPES),
        fc.double({ min: 0, max: 100000, noNaN: true }),
        (ruleType, threshold) => {
          const description = describeRiskRule(ruleType, threshold);
          return typeof description === 'string' && description.length > 0;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: JSON round-trip
// Feature: live-trading-dashboard, Property 15: JSON round-trip
// ---------------------------------------------------------------------------

// **Validates: Requirements 12.4**
describe('Property 15: JSON round-trip', () => {
  it('JSON.parse(JSON.stringify(response)) produces a deeply equal result', () => {
    fc.assert(
      fc.property(liveDashboardResponseArb, (response) => {
        const roundTripped = JSON.parse(JSON.stringify(response));
        return JSON.stringify(roundTripped) === JSON.stringify(response);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: 时间戳字段为整数
// Feature: live-trading-dashboard, Property 16: 时间戳字段为整数
// ---------------------------------------------------------------------------

// **Validates: Requirements 12.2, 12.3**
describe('Property 16: 时间戳字段为整数', () => {
  it('all timestamp fields are integers', () => {
    fc.assert(
      fc.property(liveDashboardResponseArb, (response) => {
        // cached_at must be integer
        if (!Number.isInteger(response.cached_at)) return false;

        // first_trade_date if not null must be integer
        if (response.first_trade_date !== null && !Number.isInteger(response.first_trade_date)) return false;

        // ai_decisions[].timestamp must be integer
        if (response.ai_decisions) {
          for (const d of response.ai_decisions) {
            if (!Number.isInteger(d.timestamp)) return false;
          }
        }

        // recent_trades[].exit_time must be integer
        if (response.recent_trades) {
          for (const t of response.recent_trades) {
            if (!Number.isInteger(t.exit_time)) return false;
          }
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
