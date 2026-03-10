import type { QuantityParams } from './types';

/**
 * 纯函数：计算 Kelly 分数
 *
 * Kelly criterion for a simple win/loss bet: f* = (p*b - q) / b
 * where b = win/loss ratio = (takeProfit - entryPrice) / (entryPrice - stopLoss)
 *       p = win probability = 0.5 (default)
 *       q = 1 - p = 0.5
 * Simplified: f* = 0.5 * (1 - 1/b)
 * Result clamped to [0, 1].
 */
export function calculateKellyFraction(
  entryPrice: number,
  takeProfit: number,
  stopLoss: number,
): number {
  const risk = entryPrice - stopLoss;
  if (risk <= 0) return 0; // invalid: entryPrice <= stopLoss

  const reward = takeProfit - entryPrice;
  const b = reward / risk; // win/loss ratio
  if (b <= 0) return 0; // invalid: takeProfit <= entryPrice

  const kelly = 0.5 * (1 - 1 / b);
  return Math.max(0, Math.min(1, kelly));
}

/**
 * 纯函数：计算下单数量，返回 0 表示跳过
 */
export function calculateOrderQuantity(params: QuantityParams): number {
  const { mode, entry_price } = params;

  let result: number;

  switch (mode) {
    case 'fixed_quantity': {
      result = params.fixed_quantity_value ?? 0;
      break;
    }
    case 'fixed_amount': {
      const amount = params.fixed_amount_value ?? 0;
      if (entry_price <= 0) return 0;
      result = Math.floor(amount / entry_price);
      break;
    }
    case 'kelly_formula': {
      const { stop_loss, take_profit, total_assets } = params;
      if (
        stop_loss == null ||
        take_profit == null ||
        total_assets == null ||
        entry_price <= 0
      ) {
        return 0;
      }
      const kellyFraction = calculateKellyFraction(entry_price, take_profit, stop_loss);
      result = Math.floor(kellyFraction * total_assets / entry_price);
      break;
    }
    default:
      return 0;
  }

  return result < 1 ? 0 : result;
}
