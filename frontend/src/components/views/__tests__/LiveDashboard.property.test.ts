import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  pnlColorClass,
  formatUSD,
  calcRunningDays,
  isMarketOpen,
  getSideLabel,
  formatPercent,
  formatDecimal,
} from '../../../utils/liveDashboardUtils';

// Feature: live-trading-dashboard, Property 5: PnL 颜色映射
describe('Property 5: PnL 颜色映射', () => {
  /**
   * Validates: Requirements 2.2, 2.3, 2.4, 2.5, 6.2, 6.3, 7.4, 7.5
   *
   * For any number n: n>0 → 'text-green-500', n<0 → 'text-red-500', n===0 → 'text-gray-400'
   */
  it('positive numbers always map to green', () => {
    fc.assert(
      fc.property(
        fc.double({ min: Number.MIN_VALUE, max: 1e15, noNaN: true }),
        (n) => {
          expect(pnlColorClass(n)).toBe('text-green-500');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('negative numbers always map to red', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e15, max: -Number.MIN_VALUE, noNaN: true }),
        (n) => {
          expect(pnlColorClass(n)).toBe('text-red-500');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('zero always maps to gray', () => {
    expect(pnlColorClass(0)).toBe('text-gray-400');
  });
});


// Feature: live-trading-dashboard, Property 6: 金额格式化
describe('Property 6: 金额格式化', () => {
  /**
   * Validates: Requirements 2.6
   *
   * For any number n, formatUSD(n) matches the pattern /^\$[\d,]+\.\d{2}$/ (or with negative sign)
   */
  it('formatUSD always produces a valid USD format string', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e12, max: 1e12, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          const result = formatUSD(n);
          // Must match $X,XXX.XX or -$X,XXX.XX pattern
          expect(result).toMatch(/^-?\$[\d,]+\.\d{2}$/);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: live-trading-dashboard, Property 7: 运行天数计算
describe('Property 7: 运行天数计算', () => {
  /**
   * Validates: Requirements 3.1
   *
   * For any two timestamps where first <= second, calcRunningDays returns a non-negative integer
   */
  it('returns a non-negative integer for any valid timestamp pair', () => {
    fc.assert(
      fc.property(
        // Generate two timestamps in a reasonable range (2020-01-01 to 2030-01-01)
        fc.integer({ min: 1577836800, max: 1893456000 }),
        fc.integer({ min: 1577836800, max: 1893456000 }),
        (a, b) => {
          const first = Math.min(a, b);
          const second = Math.max(a, b);
          const days = calcRunningDays(first, second);
          expect(days).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(days)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: live-trading-dashboard, Property 8: 交易时段判断
describe('Property 8: 交易时段判断', () => {
  /**
   * Validates: Requirements 3.3, 3.4
   *
   * For any Unix timestamp, isMarketOpen returns true iff the timestamp is Mon-Fri 9:30-16:00 ET
   */
  it('isMarketOpen agrees with independent ET time calculation', () => {
    fc.assert(
      fc.property(
        // Generate timestamps in a reasonable range (2020-2030)
        fc.integer({ min: 1577836800, max: 1893456000 }),
        (ts) => {
          const result = isMarketOpen(ts);

          // Independent calculation using Intl API
          const date = new Date(ts * 1000);
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            weekday: 'short',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false,
          });
          const parts = formatter.formatToParts(date);
          const weekday = parts.find((p) => p.type === 'weekday')?.value;
          const hour = Number(parts.find((p) => p.type === 'hour')?.value);
          const minute = Number(parts.find((p) => p.type === 'minute')?.value);

          const isWeekend = weekday === 'Sat' || weekday === 'Sun';
          const minutesSinceMidnight = hour * 60 + minute;
          const expected =
            !isWeekend &&
            minutesSinceMidnight >= 570 && // 9:30 AM
            minutesSinceMidnight < 960;     // 4:00 PM

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: live-trading-dashboard, Property 10: 买卖方向标签映射
describe('Property 10: 买卖方向标签映射', () => {
  /**
   * Validates: Requirements 5.5, 5.6
   *
   * For side='buy' returns {text:'live.buy', colorClass:'text-green-500'},
   * for side='sell' returns {text:'live.sell', colorClass:'text-red-500'}
   */
  it('buy always maps to live.buy with green, sell always maps to live.sell with red', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('buy' as const, 'sell' as const),
        (side) => {
          const result = getSideLabel(side);
          if (side === 'buy') {
            expect(result).toEqual({ text: 'live.buy', colorClass: 'text-green-500' });
          } else {
            expect(result).toEqual({ text: 'live.sell', colorClass: 'text-red-500' });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: live-trading-dashboard, Property 12: 指标格式化
describe('Property 12: 指标格式化', () => {
  /**
   * Validates: Requirements 8.3, 8.4
   *
   * formatPercent produces string ending with '%',
   * formatDecimal produces string with exactly 2 decimal places
   */
  it('formatPercent always ends with %', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          const result = formatPercent(n);
          expect(result).toMatch(/%$/);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('formatDecimal always has exactly 2 decimal places', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          const result = formatDecimal(n);
          // Must match a number with exactly 2 decimal places
          expect(result).toMatch(/^-?\d+\.\d{2}$/);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 14: Store tests — requires mocking apiClient
// ---------------------------------------------------------------------------

vi.mock('../../../services/apiClient', () => ({
  get: vi.fn(),
}));

import { get as apiGet } from '../../../services/apiClient';
import {
  useLiveDashboardStore,
  type LiveDashboardResponse,
} from '../../../stores/liveDashboardStore';

// fast-check arbitrary for LiveDashboardResponse
const arbLiveDashboardResponse: fc.Arbitrary<LiveDashboardResponse> = fc.record({
  account_summary: fc.record({
    initial_capital: fc.constant(1000),
    current_equity: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    total_return_pct: fc.double({ min: -100, max: 1e4, noNaN: true, noDefaultInfinity: true }),
    daily_pnl: fc.double({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true }),
  }),
  equity_curve: fc.array(
    fc.record({
      date: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(
        (d) => d.toISOString().slice(0, 10),
      ),
      equity: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      daily_pnl: fc.double({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true }),
      cumulative_return: fc.double({ min: -100, max: 1e4, noNaN: true, noDefaultInfinity: true }),
    }),
    { minLength: 0, maxLength: 5 },
  ),
  ai_decisions: fc.array(
    fc.record({
      timestamp: fc.integer({ min: 1577836800, max: 1893456000 }),
      symbol: fc.stringMatching(/^[A-Z]{1,5}$/),
      strategy_name: fc.string({ minLength: 1, maxLength: 20 }),
      side: fc.constantFrom('buy' as const, 'sell' as const),
      composite_score: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
      entry_price: fc.double({ min: 0.01, max: 1e4, noNaN: true, noDefaultInfinity: true }),
      stop_loss: fc.option(fc.double({ min: 0.01, max: 1e4, noNaN: true, noDefaultInfinity: true }), { nil: null }),
      take_profit: fc.option(fc.double({ min: 0.01, max: 1e4, noNaN: true, noDefaultInfinity: true }), { nil: null }),
      reason: fc.string({ minLength: 1, maxLength: 50 }),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  positions: fc.array(
    fc.record({
      symbol: fc.stringMatching(/^[A-Z]{1,5}$/),
      quantity: fc.integer({ min: 1, max: 1000 }),
      avg_cost: fc.double({ min: 0.01, max: 1e4, noNaN: true, noDefaultInfinity: true }),
      current_price: fc.double({ min: 0.01, max: 1e4, noNaN: true, noDefaultInfinity: true }),
      unrealized_pnl: fc.double({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true }),
      unrealized_pnl_pct: fc.double({ min: -100, max: 1000, noNaN: true, noDefaultInfinity: true }),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  recent_trades: fc.array(
    fc.record({
      symbol: fc.stringMatching(/^[A-Z]{1,5}$/),
      strategy_name: fc.string({ minLength: 1, maxLength: 20 }),
      entry_price: fc.double({ min: 0.01, max: 1e4, noNaN: true, noDefaultInfinity: true }),
      exit_price: fc.double({ min: 0.01, max: 1e4, noNaN: true, noDefaultInfinity: true }),
      pnl: fc.double({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true }),
      pnl_pct: fc.double({ min: -100, max: 1000, noNaN: true, noDefaultInfinity: true }),
      hold_days: fc.integer({ min: 0, max: 365 }),
      exit_time: fc.integer({ min: 1577836800, max: 1893456000 }),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  metrics: fc.record({
    win_rate: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    sharpe_ratio: fc.option(fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }), { nil: null }),
    max_drawdown_pct: fc.double({ min: -100, max: 0, noNaN: true, noDefaultInfinity: true }),
    total_trades: fc.integer({ min: 0, max: 10000 }),
    profit_factor: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  }),
  risk_summary: fc.array(
    fc.record({
      rule_name: fc.string({ minLength: 1, maxLength: 30 }),
      threshold: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
      triggered: fc.boolean(),
      description: fc.string({ minLength: 1, maxLength: 50 }),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  first_trade_date: fc.option(fc.integer({ min: 1577836800, max: 1893456000 }), { nil: null }),
  warnings: fc.array(fc.string({ minLength: 0, maxLength: 30 }), { minLength: 0, maxLength: 3 }),
  cached_at: fc.integer({ min: 1577836800, max: 1893456000 }),
});

// Feature: live-trading-dashboard, Property 14: 刷新失败数据保留
describe('Property 14: 刷新失败数据保留', () => {
  /**
   * **Validates: Requirements 11.3**
   *
   * For any liveDashboardStore state sequence, when fetchDashboard succeeds
   * and then a subsequent fetchDashboard fails, the store SHALL:
   * - Keep the previous successful data (data !== null)
   * - Set stale=true
   * - Set error to a non-null string
   */

  beforeEach(() => {
    // Reset the store to initial state between runs
    useLiveDashboardStore.setState({
      data: null,
      loading: false,
      error: null,
      lastUpdated: null,
      stale: false,
    });
    vi.mocked(apiGet).mockReset();
  });

  it('after a successful fetch followed by a failed fetch, data is retained and stale is true', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbLiveDashboardResponse,
        fc.string({ minLength: 1, maxLength: 50 }),
        async (mockResponse, errorMsg) => {
          // Reset store
          useLiveDashboardStore.setState({
            data: null,
            loading: false,
            error: null,
            lastUpdated: null,
            stale: false,
          });

          // First call succeeds
          vi.mocked(apiGet).mockResolvedValueOnce(mockResponse);
          await useLiveDashboardStore.getState().fetchDashboard();

          // Verify success state
          const afterSuccess = useLiveDashboardStore.getState();
          expect(afterSuccess.data).toEqual(mockResponse);
          expect(afterSuccess.error).toBeNull();
          expect(afterSuccess.stale).toBe(false);

          // Second call fails
          vi.mocked(apiGet).mockRejectedValueOnce(new Error(errorMsg));
          await useLiveDashboardStore.getState().fetchDashboard();

          // Verify failure state retains data
          const afterFailure = useLiveDashboardStore.getState();
          expect(afterFailure.data).toEqual(mockResponse);
          expect(afterFailure.stale).toBe(true);
          expect(afterFailure.error).toBe(errorMsg);
          expect(afterFailure.loading).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
