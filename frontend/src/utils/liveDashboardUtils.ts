/**
 * Live Trading Dashboard utility functions.
 * Pure formatting and calculation helpers for the LiveDashboardView.
 */

/**
 * Format a number as USD currency string: $X,XXX.XX
 * Uses Intl.NumberFormat for proper locale-aware formatting.
 */
export function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Return a Tailwind CSS color class based on PnL value.
 * Positive → green, negative → red, zero → gray (default).
 */
export function pnlColorClass(n: number): string {
  if (n > 0) return 'text-green-500';
  if (n < 0) return 'text-red-500';
  return 'text-gray-400';
}

/**
 * Calculate the number of calendar days between two Unix timestamps (seconds).
 * Uses UTC date comparison to get natural day difference.
 */
export function calcRunningDays(firstTradeDate: number, now: number): number {
  const startDate = new Date(firstTradeDate * 1000);
  const endDate = new Date(now * 1000);

  // Zero out time components to compare calendar dates only
  const startDay = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const endDay = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());

  return Math.round((endDay - startDay) / 86_400_000);
}

/**
 * Check if a Unix timestamp (seconds) falls within US stock market hours:
 * Monday–Friday, 9:30 AM – 4:00 PM Eastern Time (America/New_York).
 * Properly handles DST transitions.
 */
export function isMarketOpen(timestamp: number): boolean {
  const date = new Date(timestamp * 1000);

  // Use Intl to get the Eastern Time components (handles DST automatically)
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

  // Weekend check
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  // Convert to minutes since midnight for easy range comparison
  const minutesSinceMidnight = hour * 60 + minute;
  const marketOpen = 9 * 60 + 30; // 9:30 AM = 570 minutes
  const marketClose = 16 * 60;     // 4:00 PM = 960 minutes

  return minutesSinceMidnight >= marketOpen && minutesSinceMidnight < marketClose;
}

/**
 * Format a number as a percentage string, e.g. "65.2%".
 */
export function formatPercent(n: number): string {
  return `${Number(n.toFixed(1))}%`;
}

/**
 * Format a number to exactly two decimal places, e.g. "1.85".
 */
export function formatDecimal(n: number): string {
  return n.toFixed(2);
}

/**
 * Map a trade side to a Chinese label and color class.
 * buy → green "买入", sell → red "卖出"
 */
export function getSideLabel(side: 'buy' | 'sell'): { text: string; colorClass: string } {
  if (side === 'buy') {
    return { text: '买入', colorClass: 'text-green-500' };
  }
  return { text: '卖出', colorClass: 'text-red-500' };
}
