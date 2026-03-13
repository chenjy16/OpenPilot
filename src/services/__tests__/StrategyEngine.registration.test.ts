/**
 * Tests for StrategyEngine — Strategy Registration & Weight Management
 *
 * Feature: multi-strategy-trading
 * Requirements: 4.2, 4.3, 13.1, 13.2, 13.3, 13.4
 */

import Database from 'better-sqlite3';
import { initTradingTables } from '../trading/tradingSchema';
import { StrategyEngine } from '../StrategyEngine';
import type { Strategy, StrategyRegistration, StrategySignal } from '../trading/types';

// ─── Helpers ───────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  // Create the strategies table needed by StrategyEngine constructor
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      entry_conditions TEXT NOT NULL,
      exit_conditions TEXT NOT NULL,
      stop_loss_rule TEXT NOT NULL,
      take_profit_rule TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  initTradingTables(db);
  return db;
}

/** Minimal mock sandbox — not used by registration methods */
const mockSandbox = { exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }) } as any;

/** Create a valid mock strategy */
function createMockStrategy(name: string): Strategy {
  return {
    name,
    generateSignal(_symbol: string, _indicators: Record<string, number | null>): StrategySignal | null {
      return null;
    },
  };
}

// ─── registerStrategy ──────────────────────────────────────────────────────

describe('StrategyEngine.registerStrategy', () => {
  it('should register a valid strategy', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);
    const strategy = createMockStrategy('momentum_breakout');

    engine.registerStrategy({ strategy, weight: 0.4, enabled: true });

    const registered = engine.getRegisteredStrategies();
    expect(registered.has('momentum_breakout')).toBe(true);
    expect(registered.get('momentum_breakout')!.weight).toBe(0.4);
    expect(registered.get('momentum_breakout')!.enabled).toBe(true);
    db.close();
  });

  it('should persist weight to trading_config table', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);
    const strategy = createMockStrategy('momentum_breakout');

    engine.registerStrategy({ strategy, weight: 0.4, enabled: true });

    const row = db.prepare('SELECT value FROM trading_config WHERE key = ?').get('strategy_weight_momentum_breakout') as any;
    expect(row).toBeDefined();
    expect(parseFloat(row.value)).toBe(0.4);
    db.close();
  });

  it('should reject strategy without name', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    expect(() => {
      engine.registerStrategy({
        strategy: { name: '', generateSignal: () => null } as any,
        weight: 0.5,
        enabled: true,
      });
    }).toThrow('Strategy must implement the Strategy interface');
    db.close();
  });

  it('should reject strategy without generateSignal method', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    expect(() => {
      engine.registerStrategy({
        strategy: { name: 'bad_strategy' } as any,
        weight: 0.5,
        enabled: true,
      });
    }).toThrow('Strategy must implement the Strategy interface');
    db.close();
  });

  it('should reject weight outside [0, 1]', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);
    const strategy = createMockStrategy('test');

    expect(() => {
      engine.registerStrategy({ strategy, weight: 1.5, enabled: true });
    }).toThrow('Weight must be between 0 and 1');

    expect(() => {
      engine.registerStrategy({ strategy, weight: -0.1, enabled: true });
    }).toThrow('Weight must be between 0 and 1');
    db.close();
  });

  it('should register multiple strategies', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.registerStrategy({ strategy: createMockStrategy('momentum_breakout'), weight: 0.4, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('mean_reversion'), weight: 0.3, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('news_momentum'), weight: 0.3, enabled: true });

    const registered = engine.getRegisteredStrategies();
    expect(registered.size).toBe(3);
    db.close();
  });
});

// ─── setStrategyWeight ─────────────────────────────────────────────────────

describe('StrategyEngine.setStrategyWeight', () => {
  it('should update weight for a registered strategy', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);
    engine.registerStrategy({ strategy: createMockStrategy('momentum_breakout'), weight: 0.4, enabled: true });

    engine.setStrategyWeight('momentum_breakout', 0.6);

    const weights = engine.getStrategyWeights();
    expect(weights.get('momentum_breakout')).toBe(0.6);
    db.close();
  });

  it('should persist updated weight to trading_config', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);
    engine.registerStrategy({ strategy: createMockStrategy('momentum_breakout'), weight: 0.4, enabled: true });

    engine.setStrategyWeight('momentum_breakout', 0.55);

    const row = db.prepare('SELECT value FROM trading_config WHERE key = ?').get('strategy_weight_momentum_breakout') as any;
    expect(parseFloat(row.value)).toBe(0.55);
    db.close();
  });

  it('should throw for unregistered strategy', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    expect(() => {
      engine.setStrategyWeight('nonexistent', 0.5);
    }).toThrow("Strategy 'nonexistent' is not registered");
    db.close();
  });

  it('should reject weight outside [0, 1]', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);
    engine.registerStrategy({ strategy: createMockStrategy('test'), weight: 0.5, enabled: true });

    expect(() => engine.setStrategyWeight('test', -0.1)).toThrow('Weight must be between 0 and 1');
    expect(() => engine.setStrategyWeight('test', 1.1)).toThrow('Weight must be between 0 and 1');
    db.close();
  });
});

// ─── getStrategyWeights ────────────────────────────────────────────────────

describe('StrategyEngine.getStrategyWeights', () => {
  it('should return empty map when no strategies registered', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    const weights = engine.getStrategyWeights();
    expect(weights.size).toBe(0);
    db.close();
  });

  it('should return all registered strategy weights', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.registerStrategy({ strategy: createMockStrategy('momentum_breakout'), weight: 0.4, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('mean_reversion'), weight: 0.3, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('news_momentum'), weight: 0.3, enabled: true });

    const weights = engine.getStrategyWeights();
    expect(weights.get('momentum_breakout')).toBe(0.4);
    expect(weights.get('mean_reversion')).toBe(0.3);
    expect(weights.get('news_momentum')).toBe(0.3);
    db.close();
  });
});

// ─── validateWeights ───────────────────────────────────────────────────────

describe('StrategyEngine.validateWeights', () => {
  it('should validate default weights (0.4 + 0.3 + 0.3 = 1.0)', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.registerStrategy({ strategy: createMockStrategy('momentum_breakout'), weight: 0.4, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('mean_reversion'), weight: 0.3, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('news_momentum'), weight: 0.3, enabled: true });

    const result = engine.validateWeights();
    expect(result.valid).toBe(true);
    expect(result.sum).toBeCloseTo(1.0);
    expect(result.message).toBeUndefined();
    db.close();
  });

  it('should accept weights within ±0.01 tolerance', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.registerStrategy({ strategy: createMockStrategy('a'), weight: 0.504, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('b'), weight: 0.504, enabled: true });

    const result = engine.validateWeights();
    // sum ≈ 1.008, within tolerance
    expect(result.valid).toBe(true);
    db.close();
  });

  it('should reject weights that deviate more than 0.01', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.registerStrategy({ strategy: createMockStrategy('a'), weight: 0.5, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('b'), weight: 0.3, enabled: true });

    const result = engine.validateWeights();
    expect(result.valid).toBe(false);
    expect(result.sum).toBeCloseTo(0.8);
    expect(result.message).toContain('redistribute weights');
    db.close();
  });

  it('should only consider enabled strategies', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.registerStrategy({ strategy: createMockStrategy('a'), weight: 0.5, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('b'), weight: 0.5, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('c'), weight: 0.3, enabled: false });

    const result = engine.validateWeights();
    expect(result.valid).toBe(true);
    expect(result.sum).toBeCloseTo(1.0);
    db.close();
  });

  it('should return valid for no enabled strategies', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.registerStrategy({ strategy: createMockStrategy('a'), weight: 0.5, enabled: false });

    const result = engine.validateWeights();
    expect(result.valid).toBe(true);
    expect(result.sum).toBe(0);
    expect(result.message).toBe('No enabled strategies');
    db.close();
  });
});

// ─── disableStrategy ───────────────────────────────────────────────────────

describe('StrategyEngine.disableStrategy', () => {
  it('should disable a strategy and return redistribution prompt', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.registerStrategy({ strategy: createMockStrategy('momentum_breakout'), weight: 0.4, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('mean_reversion'), weight: 0.3, enabled: true });
    engine.registerStrategy({ strategy: createMockStrategy('news_momentum'), weight: 0.3, enabled: true });

    const result = engine.disableStrategy('momentum_breakout');

    expect(result.disabled).toBe(true);
    expect(result.message).toContain('momentum_breakout');
    expect(result.message).toContain('0.4');
    expect(result.message).toContain('redistribute');
    expect(result.remainingStrategies).toEqual(['mean_reversion', 'news_momentum']);

    // Verify strategy is now disabled
    const reg = engine.getRegisteredStrategies().get('momentum_breakout');
    expect(reg!.enabled).toBe(false);
    db.close();
  });

  it('should throw for unregistered strategy', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    expect(() => engine.disableStrategy('nonexistent')).toThrow("Strategy 'nonexistent' is not registered");
    db.close();
  });
});

// ─── enableStrategy ────────────────────────────────────────────────────────

describe('StrategyEngine.enableStrategy', () => {
  it('should enable a disabled strategy', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.registerStrategy({ strategy: createMockStrategy('test'), weight: 0.5, enabled: false });
    engine.enableStrategy('test');

    const reg = engine.getRegisteredStrategies().get('test');
    expect(reg!.enabled).toBe(true);
    db.close();
  });
});

// ─── initDefaultWeights & loadWeightsFromConfig ────────────────────────────

describe('StrategyEngine.initDefaultWeights', () => {
  it('should insert default weights into trading_config', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    engine.initDefaultWeights();

    const rows = db.prepare('SELECT key, value FROM trading_config WHERE key LIKE ?').all('strategy_weight_%') as any[];
    const weightMap = new Map(rows.map((r: any) => [r.key, parseFloat(r.value)]));

    expect(weightMap.get('strategy_weight_momentum_breakout')).toBe(0.4);
    expect(weightMap.get('strategy_weight_mean_reversion')).toBe(0.3);
    expect(weightMap.get('strategy_weight_news_momentum')).toBe(0.3);
    db.close();
  });

  it('should not overwrite existing weights', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    // Pre-set a custom weight
    db.prepare('INSERT INTO trading_config (key, value) VALUES (?, ?)').run('strategy_weight_momentum_breakout', '0.6');

    engine.initDefaultWeights();

    const row = db.prepare('SELECT value FROM trading_config WHERE key = ?').get('strategy_weight_momentum_breakout') as any;
    expect(parseFloat(row.value)).toBe(0.6); // Should NOT be overwritten
    db.close();
  });
});

describe('StrategyEngine.loadWeightsFromConfig', () => {
  it('should load weights from trading_config into registered strategies', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    // Register with initial weights
    engine.registerStrategy({ strategy: createMockStrategy('momentum_breakout'), weight: 0.1, enabled: true });

    // Set a different weight in the DB
    db.prepare('INSERT OR REPLACE INTO trading_config (key, value) VALUES (?, ?)').run('strategy_weight_momentum_breakout', '0.7');

    engine.loadWeightsFromConfig();

    const weights = engine.getStrategyWeights();
    expect(weights.get('momentum_breakout')).toBe(0.7);
    db.close();
  });

  it('should fall back to default weights when config is missing', () => {
    const db = createTestDb();
    const engine = new StrategyEngine(db, mockSandbox);

    // Register with a non-default weight, but no config in DB
    engine.registerStrategy({ strategy: createMockStrategy('momentum_breakout'), weight: 0.1, enabled: true });

    // Clear any config
    db.prepare('DELETE FROM trading_config WHERE key LIKE ?').run('strategy_weight_%');

    engine.loadWeightsFromConfig();

    const weights = engine.getStrategyWeights();
    expect(weights.get('momentum_breakout')).toBe(0.4); // default
    db.close();
  });
});
