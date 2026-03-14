import { describe, it, expect } from 'vitest';
import {
  formatUSD,
  pnlColorClass,
  calcRunningDays,
  isMarketOpen,
  formatPercent,
  formatDecimal,
  getSideLabel,
} from './liveDashboardUtils';

describe('formatUSD', () => {
  it('formats positive numbers with dollar sign and commas', () => {
    expect(formatUSD(1234.56)).toBe('$1,234.56');
  });

  it('formats zero', () => {
    expect(formatUSD(0)).toBe('$0.00');
  });

  it('formats negative numbers', () => {
    expect(formatUSD(-500.1)).toBe('-$500.10');
  });

  it('formats large numbers with comma separators', () => {
    expect(formatUSD(1000000)).toBe('$1,000,000.00');
  });

  it('rounds to two decimal places', () => {
    expect(formatUSD(1.999)).toBe('$2.00');
  });
});

describe('pnlColorClass', () => {
  it('returns green for positive values', () => {
    expect(pnlColorClass(100)).toBe('text-green-500');
    expect(pnlColorClass(0.01)).toBe('text-green-500');
  });

  it('returns red for negative values', () => {
    expect(pnlColorClass(-50)).toBe('text-red-500');
    expect(pnlColorClass(-0.01)).toBe('text-red-500');
  });

  it('returns gray for zero', () => {
    expect(pnlColorClass(0)).toBe('text-gray-400');
  });
});

describe('calcRunningDays', () => {
  it('returns 0 for same day', () => {
    const ts = 1700000000; // some timestamp
    expect(calcRunningDays(ts, ts)).toBe(0);
  });

  it('calculates days between two dates', () => {
    // 2024-01-01 00:00:00 UTC = 1704067200
    // 2024-01-11 00:00:00 UTC = 1704931200
    expect(calcRunningDays(1704067200, 1704931200)).toBe(10);
  });

  it('handles partial days correctly (calendar day difference)', () => {
    // 2024-01-01 23:59:00 UTC = 1704153540
    // 2024-01-02 00:01:00 UTC = 1704153660
    // These are different calendar days even though only 2 minutes apart
    expect(calcRunningDays(1704153540, 1704153660)).toBe(1);
  });
});

describe('isMarketOpen', () => {
  // Helper: create a timestamp for a specific ET date/time
  // We use known timestamps to avoid timezone ambiguity

  it('returns true during market hours on a weekday', () => {
    // 2024-01-08 (Monday) 10:00 AM ET = 15:00 UTC = 1704726000
    // Jan is EST (UTC-5), so 10:00 ET = 15:00 UTC
    const mondayMorningET = Date.UTC(2024, 0, 8, 15, 0, 0) / 1000;
    expect(isMarketOpen(mondayMorningET)).toBe(true);
  });

  it('returns false before market open on a weekday', () => {
    // 2024-01-08 (Monday) 9:00 AM ET = 14:00 UTC
    const beforeOpen = Date.UTC(2024, 0, 8, 14, 0, 0) / 1000;
    expect(isMarketOpen(beforeOpen)).toBe(false);
  });

  it('returns false at exactly 4:00 PM ET (market close)', () => {
    // 2024-01-08 (Monday) 16:00 ET = 21:00 UTC
    const atClose = Date.UTC(2024, 0, 8, 21, 0, 0) / 1000;
    expect(isMarketOpen(atClose)).toBe(false);
  });

  it('returns true at exactly 9:30 AM ET (market open)', () => {
    // 2024-01-08 (Monday) 9:30 AM ET = 14:30 UTC
    const atOpen = Date.UTC(2024, 0, 8, 14, 30, 0) / 1000;
    expect(isMarketOpen(atOpen)).toBe(true);
  });

  it('returns false on Saturday', () => {
    // 2024-01-06 (Saturday) 12:00 PM ET = 17:00 UTC
    const saturday = Date.UTC(2024, 0, 6, 17, 0, 0) / 1000;
    expect(isMarketOpen(saturday)).toBe(false);
  });

  it('returns false on Sunday', () => {
    // 2024-01-07 (Sunday) 12:00 PM ET = 17:00 UTC
    const sunday = Date.UTC(2024, 0, 7, 17, 0, 0) / 1000;
    expect(isMarketOpen(sunday)).toBe(false);
  });

  it('handles DST correctly (summer time EDT = UTC-4)', () => {
    // 2024-07-08 (Monday) 10:00 AM EDT = 14:00 UTC (summer, UTC-4)
    const summerMorning = Date.UTC(2024, 6, 8, 14, 0, 0) / 1000;
    expect(isMarketOpen(summerMorning)).toBe(true);

    // 2024-07-08 (Monday) 9:00 AM EDT = 13:00 UTC
    const summerBeforeOpen = Date.UTC(2024, 6, 8, 13, 0, 0) / 1000;
    expect(isMarketOpen(summerBeforeOpen)).toBe(false);
  });
});

describe('formatPercent', () => {
  it('formats a percentage value', () => {
    expect(formatPercent(65.2)).toBe('65.2%');
  });

  it('formats negative percentage', () => {
    expect(formatPercent(-12.3)).toBe('-12.3%');
  });

  it('formats zero', () => {
    expect(formatPercent(0)).toBe('0%');
  });

  it('rounds to one decimal place', () => {
    expect(formatPercent(65.25)).toBe('65.3%');
  });
});

describe('formatDecimal', () => {
  it('formats to two decimal places', () => {
    expect(formatDecimal(1.85)).toBe('1.85');
  });

  it('pads with zeros', () => {
    expect(formatDecimal(2)).toBe('2.00');
  });

  it('rounds correctly', () => {
    expect(formatDecimal(1.999)).toBe('2.00');
  });

  it('handles negative numbers', () => {
    expect(formatDecimal(-3.1)).toBe('-3.10');
  });
});

describe('getSideLabel', () => {
  it('maps buy to green 买入', () => {
    const result = getSideLabel('buy');
    expect(result.text).toBe('买入');
    expect(result.colorClass).toBe('text-green-500');
  });

  it('maps sell to red 卖出', () => {
    const result = getSideLabel('sell');
    expect(result.text).toBe('卖出');
    expect(result.colorClass).toBe('text-red-500');
  });
});
