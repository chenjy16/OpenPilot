import { calculateKellyFraction, calculateOrderQuantity } from './QuantityCalculator';
import type { QuantityParams } from './types';

// ─── calculateKellyFraction ─────────────────────────────────────────────────

describe('calculateKellyFraction', () => {
  it('returns 0 when entryPrice <= stopLoss', () => {
    expect(calculateKellyFraction(100, 120, 100)).toBe(0);
    expect(calculateKellyFraction(100, 120, 110)).toBe(0);
  });

  it('returns 0 when takeProfit <= entryPrice', () => {
    expect(calculateKellyFraction(100, 100, 90)).toBe(0);
    expect(calculateKellyFraction(100, 80, 90)).toBe(0);
  });

  it('returns 0 when win/loss ratio b <= 1 (reward <= risk)', () => {
    // reward = 10, risk = 20 → b = 0.5 → kelly = 0.5*(1-2) = -0.5 → clamped to 0
    expect(calculateKellyFraction(100, 110, 80)).toBe(0);
  });

  it('calculates correct kelly fraction for b = 2', () => {
    // reward = 20, risk = 10 → b = 2 → kelly = 0.5*(1-0.5) = 0.25
    expect(calculateKellyFraction(100, 120, 90)).toBe(0.25);
  });

  it('calculates correct kelly fraction for b = 3', () => {
    // reward = 30, risk = 10 → b = 3 → kelly = 0.5*(1-1/3) ≈ 0.333
    expect(calculateKellyFraction(100, 130, 90)).toBeCloseTo(1 / 3, 10);
  });

  it('clamps result to max 1', () => {
    // Even with very high b, kelly = 0.5*(1-1/b) approaches 0.5, never exceeds 1
    expect(calculateKellyFraction(100, 10000, 99)).toBeLessThanOrEqual(1);
  });

  it('result is always in [0, 1] range', () => {
    const result = calculateKellyFraction(100, 200, 50);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ─── calculateOrderQuantity ─────────────────────────────────────────────────

describe('calculateOrderQuantity', () => {
  describe('fixed_quantity mode', () => {
    it('returns the configured fixed quantity', () => {
      const params: QuantityParams = {
        mode: 'fixed_quantity',
        fixed_quantity_value: 100,
        entry_price: 50,
      };
      expect(calculateOrderQuantity(params)).toBe(100);
    });

    it('returns 0 when fixed_quantity_value is undefined', () => {
      const params: QuantityParams = {
        mode: 'fixed_quantity',
        entry_price: 50,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });

    it('returns 0 when fixed_quantity_value is 0', () => {
      const params: QuantityParams = {
        mode: 'fixed_quantity',
        fixed_quantity_value: 0,
        entry_price: 50,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });
  });

  describe('fixed_amount mode', () => {
    it('returns floor(amount / entryPrice)', () => {
      const params: QuantityParams = {
        mode: 'fixed_amount',
        fixed_amount_value: 10000,
        entry_price: 350,
      };
      expect(calculateOrderQuantity(params)).toBe(Math.floor(10000 / 350)); // 28
    });

    it('returns 0 when entry_price is 0', () => {
      const params: QuantityParams = {
        mode: 'fixed_amount',
        fixed_amount_value: 10000,
        entry_price: 0,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });

    it('returns 0 when amount < entry_price (result < 1)', () => {
      const params: QuantityParams = {
        mode: 'fixed_amount',
        fixed_amount_value: 5,
        entry_price: 350,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });

    it('returns 0 when fixed_amount_value is undefined', () => {
      const params: QuantityParams = {
        mode: 'fixed_amount',
        entry_price: 50,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });
  });

  describe('kelly_formula mode', () => {
    it('calculates quantity using kelly fraction', () => {
      // kelly = 0.25 (b=2), totalAssets=100000, entryPrice=100
      // quantity = floor(0.25 * 100000 / 100) = 250
      const params: QuantityParams = {
        mode: 'kelly_formula',
        entry_price: 100,
        stop_loss: 90,
        take_profit: 120,
        total_assets: 100000,
      };
      expect(calculateOrderQuantity(params)).toBe(250);
    });

    it('returns 0 when kelly fraction is 0 (bad risk/reward)', () => {
      const params: QuantityParams = {
        mode: 'kelly_formula',
        entry_price: 100,
        stop_loss: 80,
        take_profit: 110, // reward=10, risk=20, b=0.5 → kelly=0
        total_assets: 100000,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });

    it('returns 0 when stop_loss is missing', () => {
      const params: QuantityParams = {
        mode: 'kelly_formula',
        entry_price: 100,
        take_profit: 120,
        total_assets: 100000,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });

    it('returns 0 when take_profit is missing', () => {
      const params: QuantityParams = {
        mode: 'kelly_formula',
        entry_price: 100,
        stop_loss: 90,
        total_assets: 100000,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });

    it('returns 0 when total_assets is missing', () => {
      const params: QuantityParams = {
        mode: 'kelly_formula',
        entry_price: 100,
        stop_loss: 90,
        take_profit: 120,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });

    it('returns 0 when entry_price is 0', () => {
      const params: QuantityParams = {
        mode: 'kelly_formula',
        entry_price: 0,
        stop_loss: 90,
        take_profit: 120,
        total_assets: 100000,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });
  });

  describe('result < 1 returns 0', () => {
    it('fixed_amount with tiny amount returns 0', () => {
      const params: QuantityParams = {
        mode: 'fixed_amount',
        fixed_amount_value: 0.5,
        entry_price: 100,
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });

    it('kelly with small assets returns 0', () => {
      const params: QuantityParams = {
        mode: 'kelly_formula',
        entry_price: 100,
        stop_loss: 90,
        take_profit: 120,
        total_assets: 100, // kelly=0.25, qty = floor(0.25*100/100) = 0
      };
      expect(calculateOrderQuantity(params)).toBe(0);
    });
  });
});
