/**
 * RiskController - Pre-trade Risk Management
 *
 * Validates orders against configurable risk rules before submission.
 * Pure function design: checkOrder takes order + current state, returns result.
 * Supports 5 built-in rules:
 *   - max_order_amount: single order value cap
 *   - max_daily_amount: daily cumulative trading amount cap
 *   - max_position_ratio: single symbol position ratio cap
 *   - max_daily_loss: daily loss limit
 *   - max_daily_trades: daily trade count limit
 */

import type Database from 'better-sqlite3';
import type {
  TradingOrder,
  BrokerAccount,
  BrokerPosition,
  OrderStats,
  RiskRule,
  RiskRuleType,
  RiskCheckResult,
} from './types';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function rowToRule(row: any): RiskRule {
  return {
    id: row.id,
    rule_type: row.rule_type,
    rule_name: row.rule_name,
    threshold: row.threshold,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// RiskController class
// ---------------------------------------------------------------------------

export class RiskController {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Execute all enabled risk rules against the given order.
   * Pure function: takes order + current state, returns check result.
   */
  checkOrder(
    order: TradingOrder,
    account: BrokerAccount,
    positions: BrokerPosition[],
    todayStats: OrderStats,
  ): RiskCheckResult {
    const rules = this.listRules().filter((r) => r.enabled);
    const violations: RiskCheckResult['violations'] = [];

    const orderAmount = order.quantity * (order.price || 0);

    for (const rule of rules) {
      switch (rule.rule_type) {
        case 'max_order_amount': {
          if (orderAmount > rule.threshold) {
            violations.push({
              rule_type: rule.rule_type,
              rule_name: rule.rule_name,
              threshold: rule.threshold,
              current_value: orderAmount,
              message: `Order amount ${orderAmount} exceeds limit ${rule.threshold}`,
            });
          }
          break;
        }

        case 'max_daily_amount': {
          const dailyTotal = todayStats.total_filled_amount + orderAmount;
          if (dailyTotal > rule.threshold) {
            violations.push({
              rule_type: rule.rule_type,
              rule_name: rule.rule_name,
              threshold: rule.threshold,
              current_value: dailyTotal,
              message: `Daily amount ${dailyTotal} exceeds limit ${rule.threshold}`,
            });
          }
          break;
        }

        case 'max_position_ratio': {
          if (account.total_assets > 0) {
            const position = positions.find((p) => p.symbol === order.symbol);
            const positionValue = position ? position.market_value : 0;
            const ratio = positionValue / account.total_assets;
            if (ratio > rule.threshold) {
              violations.push({
                rule_type: rule.rule_type,
                rule_name: rule.rule_name,
                threshold: rule.threshold,
                current_value: ratio,
                message: `Position ratio ${(ratio * 100).toFixed(1)}% exceeds limit ${(rule.threshold * 100).toFixed(1)}%`,
              });
            }
          }
          break;
        }

        case 'max_daily_loss': {
          // Daily loss = initial assets at start of day - current total assets
          // We approximate using available_cash + positions market value vs total_assets
          // If total_assets dropped, that's a loss
          const dailyLoss = account.total_assets > 0
            ? Math.max(0, account.frozen_cash + account.available_cash - account.total_assets + (account.total_assets - account.available_cash - account.frozen_cash))
            : 0;
          // Simpler approach: use the difference between total_assets and (available_cash + all position market values)
          // But we don't have start-of-day snapshot. Use a practical approach:
          // daily_loss is tracked externally; here we check if current unrealized loss exceeds threshold
          const totalPositionValue = positions.reduce((sum, p) => sum + p.market_value, 0);
          const totalPositionCost = positions.reduce((sum, p) => sum + p.avg_cost * p.quantity, 0);
          const unrealizedLoss = Math.max(0, totalPositionCost - totalPositionValue);
          if (unrealizedLoss > rule.threshold) {
            violations.push({
              rule_type: rule.rule_type,
              rule_name: rule.rule_name,
              threshold: rule.threshold,
              current_value: unrealizedLoss,
              message: `Daily loss ${unrealizedLoss} exceeds limit ${rule.threshold}`,
            });
          }
          break;
        }

        case 'max_daily_trades': {
          if (todayStats.total_orders >= rule.threshold) {
            violations.push({
              rule_type: rule.rule_type,
              rule_name: rule.rule_name,
              threshold: rule.threshold,
              current_value: todayStats.total_orders,
              message: `Daily trades ${todayStats.total_orders} reached limit ${rule.threshold}`,
            });
          }
          break;
        }
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }

  /**
   * Return all risk rules from the risk_rules table.
   */
  listRules(): RiskRule[] {
    const rows = this.db.prepare('SELECT * FROM risk_rules ORDER BY id').all() as any[];
    return rows.map(rowToRule);
  }

  /**
   * Update a risk rule's fields. Sets updated_at automatically.
   * Returns the updated rule.
   */
  updateRule(id: number, updates: Partial<RiskRule>): RiskRule {
    const fields: string[] = ['updated_at = @updated_at'];
    const params: Record<string, any> = {
      id,
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (updates.rule_name !== undefined) {
      fields.push('rule_name = @rule_name');
      params.rule_name = updates.rule_name;
    }
    if (updates.threshold !== undefined) {
      fields.push('threshold = @threshold');
      params.threshold = updates.threshold;
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = @enabled');
      params.enabled = updates.enabled ? 1 : 0;
    }

    this.db.prepare(
      `UPDATE risk_rules SET ${fields.join(', ')} WHERE id = @id`,
    ).run(params);

    const row = this.db.prepare('SELECT * FROM risk_rules WHERE id = ?').get(id) as any;
    if (!row) {
      throw new Error(`Risk rule ${id} not found`);
    }
    return rowToRule(row);
  }

  /**
   * Enable or disable a single risk rule.
   */
  toggleRule(id: number, enabled: boolean): void {
    this.db.prepare(
      'UPDATE risk_rules SET enabled = @enabled, updated_at = @updated_at WHERE id = @id',
    ).run({
      id,
      enabled: enabled ? 1 : 0,
      updated_at: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Insert default risk rules if they don't already exist.
   * Uses INSERT OR IGNORE to avoid duplicates on rule_type UNIQUE constraint.
   */
  initDefaultRules(): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO risk_rules (rule_type, rule_name, threshold, enabled)
      VALUES (@rule_type, @rule_name, @threshold, 1)
    `);

    const defaults: Array<{ rule_type: RiskRuleType; rule_name: string; threshold: number }> = [
      { rule_type: 'max_order_amount', rule_name: '单笔订单金额上限', threshold: 100000 },
      { rule_type: 'max_daily_amount', rule_name: '单日交易总金额上限', threshold: 500000 },
      { rule_type: 'max_position_ratio', rule_name: '单只股票持仓占比上限', threshold: 0.3 },
      { rule_type: 'max_daily_loss', rule_name: '单日最大亏损限额', threshold: 50000 },
      { rule_type: 'max_daily_trades', rule_name: '单日最大交易笔数', threshold: 50 },
    ];

    const insertAll = this.db.transaction(() => {
      for (const rule of defaults) {
        stmt.run(rule);
      }
    });

    insertAll();
  }
}
