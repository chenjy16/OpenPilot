/**
 * StrategyEngine — programmable quantitative strategy framework.
 *
 * Provides CRUD for user-defined trading strategies, built-in templates,
 * backtest execution (via backtest_engine.py), and strategy-based stock scanning.
 *
 * Feature: quant-copilot-enhancement (REQ-4)
 */

import type Database from 'better-sqlite3';
import type { ExecutionSandbox } from '../runtime/sandbox';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Condition {
  indicator: string;
  comparator: '>' | '<' | '>=' | '<=' | 'crosses_above' | 'crosses_below';
  value: number | string;
}

export interface ConditionGroup {
  operator: 'AND' | 'OR';
  conditions: Condition[];
}

export interface StopLossRule {
  type: 'percentage' | 'fixed' | 'atr';
  value: number;
}

export interface TakeProfitRule {
  type: 'percentage' | 'fixed' | 'risk_reward';
  value: number;
}

export interface StrategyDefinition {
  id?: number;
  name: string;
  description: string;
  entry_conditions: ConditionGroup;
  exit_conditions: ConditionGroup;
  stop_loss_rule: StopLossRule;
  take_profit_rule: TakeProfitRule;
  enabled: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface BacktestParams {
  strategy_id?: number;
  strategy?: StrategyDefinition;
  symbol: string;
  start: string;
  end: string;
  capital?: number;
  commission?: number;
  slippage?: number;
}

export interface BacktestTrade {
  open_time: string;
  close_time: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
}

export interface BacktestResult {
  symbol: string;
  strategy: string;
  total_return: number;
  annual_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  win_rate: number;
  profit_loss_ratio: number;
  total_trades: number;
  trades: BacktestTrade[];
}

export interface StrategyScanMatch {
  symbol: string;
  matched: boolean;
  entry_signal: boolean;
  exit_signal: boolean;
  indicator_values: Record<string, number | null>;
}

export interface StrategyScanResult {
  strategy_id: number;
  strategy_name: string;
  scanned_count: number;
  matches: StrategyScanMatch[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Built-in strategy templates
// ---------------------------------------------------------------------------

function getBuiltinTemplateList(): StrategyDefinition[] {
  return [
    {
      name: '金叉/死叉 (Golden Cross/Death Cross)',
      description: 'SMA20 crosses above SMA50 for entry, crosses below for exit',
      entry_conditions: {
        operator: 'AND',
        conditions: [
          { indicator: 'sma20', comparator: 'crosses_above', value: 'sma50' },
        ],
      },
      exit_conditions: {
        operator: 'AND',
        conditions: [
          { indicator: 'sma20', comparator: 'crosses_below', value: 'sma50' },
        ],
      },
      stop_loss_rule: { type: 'percentage', value: 5 },
      take_profit_rule: { type: 'percentage', value: 10 },
      enabled: true,
    },
    {
      name: 'RSI 超卖反弹',
      description: 'RSI14 < 30 for entry (oversold bounce), RSI14 > 70 for exit (overbought)',
      entry_conditions: {
        operator: 'AND',
        conditions: [
          { indicator: 'rsi14', comparator: '<', value: 30 },
        ],
      },
      exit_conditions: {
        operator: 'AND',
        conditions: [
          { indicator: 'rsi14', comparator: '>', value: 70 },
        ],
      },
      stop_loss_rule: { type: 'percentage', value: 3 },
      take_profit_rule: { type: 'risk_reward', value: 2 },
      enabled: true,
    },
    {
      name: 'MACD 背离',
      description: 'MACD histogram crosses above 0 for entry, crosses below 0 for exit',
      entry_conditions: {
        operator: 'AND',
        conditions: [
          { indicator: 'macd_histogram', comparator: 'crosses_above', value: 0 },
        ],
      },
      exit_conditions: {
        operator: 'AND',
        conditions: [
          { indicator: 'macd_histogram', comparator: 'crosses_below', value: 0 },
        ],
      },
      stop_loss_rule: { type: 'percentage', value: 4 },
      take_profit_rule: { type: 'percentage', value: 8 },
      enabled: true,
    },
    {
      name: '布林带突破',
      description: 'Close > bollinger_upper for entry, Close < bollinger_lower for exit',
      entry_conditions: {
        operator: 'AND',
        conditions: [
          { indicator: 'price', comparator: '>', value: 'bollinger_upper' },
        ],
      },
      exit_conditions: {
        operator: 'AND',
        conditions: [
          { indicator: 'price', comparator: '<', value: 'bollinger_lower' },
        ],
      },
      stop_loss_rule: { type: 'percentage', value: 3 },
      take_profit_rule: { type: 'percentage', value: 6 },
      enabled: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helper: convert DB row to StrategyDefinition
// ---------------------------------------------------------------------------

function rowToStrategy(row: any): StrategyDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    entry_conditions: JSON.parse(row.entry_conditions),
    exit_conditions: JSON.parse(row.exit_conditions),
    stop_loss_rule: JSON.parse(row.stop_loss_rule),
    take_profit_rule: JSON.parse(row.take_profit_rule),
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Helper: evaluate strategy conditions against indicator values
// ---------------------------------------------------------------------------

function evaluateCondition(
  cond: Condition,
  indicators: Record<string, number | null>,
): boolean {
  const left = indicators[cond.indicator];
  if (left == null) return false;

  let right: number;
  if (typeof cond.value === 'string') {
    const resolved = indicators[cond.value];
    if (resolved == null) return false;
    right = resolved;
  } else {
    right = cond.value;
  }

  switch (cond.comparator) {
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    // For crosses_above/crosses_below in a single snapshot, approximate as > / <
    case 'crosses_above': return left > right;
    case 'crosses_below': return left < right;
    default: return false;
  }
}

function evaluateConditionGroup(
  group: ConditionGroup,
  indicators: Record<string, number | null>,
): boolean {
  if (!group.conditions || group.conditions.length === 0) return false;
  if (group.operator === 'AND') {
    return group.conditions.every(c => evaluateCondition(c, indicators));
  }
  return group.conditions.some(c => evaluateCondition(c, indicators));
}

// ---------------------------------------------------------------------------
// StrategyEngine
// ---------------------------------------------------------------------------

export class StrategyEngine {
  private db: Database.Database;
  private sandbox: ExecutionSandbox;

  constructor(db: Database.Database, sandbox: ExecutionSandbox) {
    this.db = db;
    this.sandbox = sandbox;
  }

  // -----------------------------------------------------------------------
  // CRUD (4.2.1)
  // -----------------------------------------------------------------------

  createStrategy(def: StrategyDefinition): StrategyDefinition {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(`
      INSERT INTO strategies (name, description, entry_conditions, exit_conditions, stop_loss_rule, take_profit_rule, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      def.name,
      def.description ?? '',
      JSON.stringify(def.entry_conditions),
      JSON.stringify(def.exit_conditions),
      JSON.stringify(def.stop_loss_rule),
      JSON.stringify(def.take_profit_rule),
      def.enabled ? 1 : 0,
      now,
      now,
    );

    return this.getStrategy(Number(result.lastInsertRowid))!;
  }

  getStrategy(id: number): StrategyDefinition | null {
    const row = this.db.prepare('SELECT * FROM strategies WHERE id = ?').get(id) as any;
    return row ? rowToStrategy(row) : null;
  }

  listStrategies(): StrategyDefinition[] {
    const rows = this.db.prepare('SELECT * FROM strategies ORDER BY id').all() as any[];
    return rows.map(rowToStrategy);
  }

  updateStrategy(id: number, def: Partial<StrategyDefinition>): StrategyDefinition {
    const existing = this.getStrategy(id);
    if (!existing) {
      throw new Error(`Strategy with id ${id} not found`);
    }

    const merged = { ...existing, ...def };
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(`
      UPDATE strategies
      SET name = ?, description = ?, entry_conditions = ?, exit_conditions = ?,
          stop_loss_rule = ?, take_profit_rule = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      merged.name,
      merged.description ?? '',
      JSON.stringify(merged.entry_conditions),
      JSON.stringify(merged.exit_conditions),
      JSON.stringify(merged.stop_loss_rule),
      JSON.stringify(merged.take_profit_rule),
      merged.enabled ? 1 : 0,
      now,
      id,
    );

    return this.getStrategy(id)!;
  }

  deleteStrategy(id: number): void {
    const result = this.db.prepare('DELETE FROM strategies WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new Error(`Strategy with id ${id} not found`);
    }
  }

  // -----------------------------------------------------------------------
  // Toggle (4.2.2)
  // -----------------------------------------------------------------------

  toggleStrategy(id: number, enabled: boolean): void {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(
      'UPDATE strategies SET enabled = ?, updated_at = ? WHERE id = ?',
    ).run(enabled ? 1 : 0, now, id);
    if (result.changes === 0) {
      throw new Error(`Strategy with id ${id} not found`);
    }
  }

  // -----------------------------------------------------------------------
  // Built-in templates (4.2.3)
  // -----------------------------------------------------------------------

  getBuiltinTemplates(): StrategyDefinition[] {
    return getBuiltinTemplateList();
  }

  // -----------------------------------------------------------------------
  // Backtest (4.3)
  // -----------------------------------------------------------------------

  async runBacktest(params: BacktestParams): Promise<BacktestResult> {
    let strategy: StrategyDefinition | undefined = params.strategy;

    if (!strategy && params.strategy_id) {
      const found = this.getStrategy(params.strategy_id);
      if (!found) {
        throw new Error(`Strategy with id ${params.strategy_id} not found`);
      }
      strategy = found;
    }

    if (!strategy) {
      throw new Error('Either strategy or strategy_id must be provided');
    }

    // Build strategy JSON for the Python script (single stringify only)
    const strategyJson = JSON.stringify({
      name: strategy.name,
      entry_conditions: strategy.entry_conditions,
      exit_conditions: strategy.exit_conditions,
      stop_loss_rule: strategy.stop_loss_rule,
      take_profit_rule: strategy.take_profit_rule,
    });

    const capital = params.capital ?? 100000;
    const commission = params.commission ?? 0.001;
    const slippage = params.slippage ?? 0.001;

    // Resolve venv Python path (prefer project venv over system python3)
    const fs = require('fs');
    const venvPy = 'scripts/.venv/bin/python3';
    const backtestPython = fs.existsSync(venvPy) ? venvPy : 'python3';

    const command = [
      backtestPython, 'scripts/backtest_engine.py',
      '--strategy', `'${strategyJson}'`,
      '--symbol', params.symbol,
      '--start', params.start,
      '--end', params.end,
      '--capital', String(capital),
      '--commission', String(commission),
      '--slippage', String(slippage),
    ].join(' ');

    const result = await this.sandbox.exec(command, { timeoutMs: 60_000 });

    if (result.exitCode !== 0) {
      let errorMsg = result.stderr || result.stdout;
      try {
        const parsed = JSON.parse(result.stdout);
        if (parsed.error) errorMsg = `${parsed.error}: ${parsed.message}`;
      } catch { /* use raw stderr */ }
      throw new Error(`Backtest failed: ${errorMsg}`);
    }

    const backtestResult: BacktestResult = JSON.parse(result.stdout);

    // Save result to backtest_results table
    this.db.prepare(`
      INSERT INTO backtest_results
        (strategy_id, symbol, start_date, end_date, total_return, annual_return,
         max_drawdown, sharpe_ratio, win_rate, profit_loss_ratio, total_trades, trades_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      strategy.id ?? null,
      params.symbol,
      params.start,
      params.end,
      backtestResult.total_return,
      backtestResult.annual_return,
      backtestResult.max_drawdown,
      backtestResult.sharpe_ratio,
      backtestResult.win_rate,
      backtestResult.profit_loss_ratio,
      backtestResult.total_trades,
      JSON.stringify(backtestResult.trades),
    );

    return backtestResult;
  }

  // -----------------------------------------------------------------------
  // Scan with strategy (4.4)
  // -----------------------------------------------------------------------

  async scanWithStrategy(strategyId: number, symbols: string[]): Promise<StrategyScanResult> {
    const strategy = this.getStrategy(strategyId);
    if (!strategy) {
      throw new Error(`Strategy with id ${strategyId} not found`);
    }

    const matches: StrategyScanMatch[] = [];
    const errors: string[] = [];

    for (const symbol of symbols) {
      try {
        const command = `python3 scripts/stock_analysis.py ${symbol.toUpperCase().trim()}`;
        const result = await this.sandbox.exec(command, { timeoutMs: 30_000 });

        if (result.exitCode !== 0) {
          errors.push(`${symbol}: script exited with code ${result.exitCode}`);
          continue;
        }

        const data = JSON.parse(result.stdout);
        if (data.error) {
          errors.push(`${symbol}: ${data.error} - ${data.message}`);
          continue;
        }

        // Build indicator map from analysis result
        const indicators: Record<string, number | null> = {
          price: data.price ?? null,
          sma20: data.sma20 ?? null,
          sma50: data.sma50 ?? null,
          rsi14: data.rsi14 ?? null,
          macd_line: data.macd_line ?? null,
          macd_signal: data.macd_signal ?? null,
          macd_histogram: data.macd_histogram ?? null,
          bollinger_upper: data.bollinger_upper ?? null,
          bollinger_lower: data.bollinger_lower ?? null,
          atr14: data.atr14 ?? null,
          obv: data.obv ?? null,
          vwap: data.vwap ?? null,
          kdj_k: data.kdj_k ?? null,
          kdj_d: data.kdj_d ?? null,
          kdj_j: data.kdj_j ?? null,
          williams_r: data.williams_r ?? null,
        };

        const entrySignal = evaluateConditionGroup(strategy.entry_conditions, indicators);
        const exitSignal = evaluateConditionGroup(strategy.exit_conditions, indicators);

        matches.push({
          symbol: symbol.toUpperCase().trim(),
          matched: entrySignal || exitSignal,
          entry_signal: entrySignal,
          exit_signal: exitSignal,
          indicator_values: indicators,
        });
      } catch (err: any) {
        errors.push(`${symbol}: ${err.message}`);
      }
    }

    return {
      strategy_id: strategyId,
      strategy_name: strategy.name,
      scanned_count: symbols.length,
      matches,
      errors,
    };
  }
}
