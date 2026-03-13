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
    const dynamicState = this.getDynamicRiskState();

    const orderAmount = order.quantity * (order.price || 0);

    for (const rule of rules) {
      // Apply dynamic risk multiplier to threshold
      const threshold = rule.threshold * dynamicState.risk_multiplier;
      switch (rule.rule_type) {
        case 'max_order_amount': {
          if (orderAmount > threshold) {
            violations.push({
              rule_type: rule.rule_type,
              rule_name: rule.rule_name,
              threshold,
              current_value: orderAmount,
              message: `Order amount ${orderAmount} exceeds limit ${threshold}`,
            });
          }
          break;
        }

        case 'max_daily_amount': {
          const dailyTotal = todayStats.total_filled_amount + orderAmount;
          if (dailyTotal > threshold) {
            violations.push({
              rule_type: rule.rule_type,
              rule_name: rule.rule_name,
              threshold,
              current_value: dailyTotal,
              message: `Daily amount ${dailyTotal} exceeds limit ${threshold}`,
            });
          }
          break;
        }

        case 'max_position_ratio': {
          if (account.total_assets > 0) {
            const position = positions.find((p) => p.symbol === order.symbol);
            const positionValue = position ? position.market_value : 0;
            const ratio = positionValue / account.total_assets;
            if (ratio > threshold) {
              violations.push({
                rule_type: rule.rule_type,
                rule_name: rule.rule_name,
                threshold,
                current_value: ratio,
                message: `Position ratio ${(ratio * 100).toFixed(1)}% exceeds limit ${(threshold * 100).toFixed(1)}%`,
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
          if (unrealizedLoss > threshold) {
            violations.push({
              rule_type: rule.rule_type,
              rule_name: rule.rule_name,
              threshold,
              current_value: unrealizedLoss,
              message: `Daily loss ${unrealizedLoss} exceeds limit ${threshold}`,
            });
          }
          break;
        }

        case 'max_daily_trades': {
          if (todayStats.total_orders >= threshold) {
            violations.push({
              rule_type: rule.rule_type,
              rule_name: rule.rule_name,
              threshold,
              current_value: todayStats.total_orders,
              message: `Daily trades ${todayStats.total_orders} reached limit ${threshold}`,
            });
          }
          break;
        }

        case 'max_positions': {
          // Only restrict buy orders; sell orders bypass this rule
          if (order.side === 'buy') {
            const currentPositionCount = positions.filter((p) => p.quantity > 0).length;
            // In crisis mode the dynamic multiplier is already applied to threshold above,
            // but max_positions needs floor() since it's a discrete count.
            const effectiveThreshold = Math.floor(threshold);
            if (currentPositionCount >= effectiveThreshold) {
              violations.push({
                rule_type: rule.rule_type,
                rule_name: rule.rule_name,
                threshold: effectiveThreshold,
                current_value: currentPositionCount,
                message: `Current positions ${currentPositionCount} reached limit ${effectiveThreshold}`,
              });
            }
          }
          break;
        }

        case 'max_weekly_loss': {
          // Only restrict buy orders; sell orders bypass this rule
          if (order.side === 'buy') {
            // Determine this Monday's start (00:00 UTC)
            const now = new Date();
            const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
            const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
            const mondayEpoch = Math.floor(monday.getTime() / 1000);

            // Query weekly_loss_tracker
            const tracker = this.db.prepare('SELECT * FROM weekly_loss_tracker WHERE id = 1').get() as any;

            let cumulativeLoss = 0;
            if (tracker) {
              if (tracker.week_start !== mondayEpoch) {
                // New week — reset the counter
                this.db.prepare(
                  'UPDATE weekly_loss_tracker SET week_start = @week_start, cumulative_loss = 0, updated_at = @updated_at WHERE id = 1'
                ).run({ week_start: mondayEpoch, updated_at: Math.floor(Date.now() / 1000) });
                cumulativeLoss = 0;
              } else {
                cumulativeLoss = tracker.cumulative_loss;
              }
            }

            // threshold is stored as percentage (e.g. 10 for 10%), already multiplied by risk_multiplier
            const maxLoss = account.total_assets * (threshold / 100);

            if (cumulativeLoss > maxLoss) {
              // Log audit entry when triggered
              this.db.prepare(`
                INSERT INTO trading_audit_log (timestamp, operation, request_params, response_result, trading_mode)
                VALUES (@timestamp, @operation, @request_params, @response_result, @trading_mode)
              `).run({
                timestamp: Math.floor(Date.now() / 1000),
                operation: 'max_weekly_loss_triggered',
                request_params: JSON.stringify({
                  cumulative_loss: cumulativeLoss,
                  threshold_pct: threshold,
                  max_loss: maxLoss,
                  total_assets: account.total_assets,
                }),
                response_result: JSON.stringify({
                  action: 'reject_buy',
                  symbol: order.symbol,
                }),
                trading_mode: order.trading_mode,
              });

              violations.push({
                rule_type: rule.rule_type,
                rule_name: rule.rule_name,
                threshold: maxLoss,
                current_value: cumulativeLoss,
                message: `Weekly cumulative loss ${cumulativeLoss.toFixed(2)} exceeds limit ${maxLoss.toFixed(2)} (${threshold}% of total assets)`,
              });
            }
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
      { rule_type: 'max_positions', rule_name: '最大同时持仓数', threshold: 3 },
      { rule_type: 'max_weekly_loss', rule_name: '周度最大亏损比例', threshold: 10 },
    ];

    const insertAll = this.db.transaction(() => {
      for (const rule of defaults) {
        stmt.run(rule);
      }
    });

    insertAll();
  }

  // ─── Sector Exposure Check ──────────────────────────────────────────────

  /**
   * Check if adding a position in the given symbol would exceed sector concentration limits.
   * Returns violation message or null if OK.
   * Default max sector exposure: 40% of total assets.
   */
  checkSectorExposure(
    symbol: string,
    orderAmount: number,
    positions: BrokerPosition[],
    totalAssets: number,
    maxSectorPct: number = 0.4,
  ): string | null {
    if (totalAssets <= 0) return null;

    const sectorRow = this.db.prepare(
      `SELECT sector FROM symbol_sectors WHERE symbol = ?`
    ).get(symbol) as { sector: string } | undefined;

    if (!sectorRow) return null; // No sector data, skip check

    const sector = sectorRow.sector;

    // Get all symbols in the same sector
    const sectorSymbols = this.db.prepare(
      `SELECT symbol FROM symbol_sectors WHERE sector = ?`
    ).all(sector) as Array<{ symbol: string }>;
    const sectorSymbolSet = new Set(sectorSymbols.map(s => s.symbol));

    // Sum current exposure in this sector
    let sectorExposure = 0;
    for (const pos of positions) {
      if (sectorSymbolSet.has(pos.symbol)) {
        sectorExposure += pos.market_value;
      }
    }

    const newExposure = sectorExposure + orderAmount;
    const ratio = newExposure / totalAssets;

    if (ratio > maxSectorPct) {
      return `Sector ${sector} exposure ${(ratio * 100).toFixed(1)}% would exceed limit ${(maxSectorPct * 100).toFixed(0)}% (current: $${sectorExposure.toFixed(0)}, order: $${orderAmount.toFixed(0)})`;
    }

    return null;
  }

  /**
   * Update sector mapping for a symbol.
   */
  setSectorMapping(symbol: string, sector: string): void {
    this.db.prepare(`
      INSERT INTO symbol_sectors (symbol, sector, updated_at)
      VALUES (@symbol, @sector, unixepoch())
      ON CONFLICT(symbol) DO UPDATE SET sector = @sector, updated_at = unixepoch()
    `).run({ symbol, sector });
  }

  /**
   * Bulk update sector mappings.
   */
  setSectorMappings(mappings: Array<{ symbol: string; sector: string }>): void {
    const stmt = this.db.prepare(`
      INSERT INTO symbol_sectors (symbol, sector, updated_at)
      VALUES (@symbol, @sector, unixepoch())
      ON CONFLICT(symbol) DO UPDATE SET sector = @sector, updated_at = unixepoch()
    `);
    const txn = this.db.transaction((rows: typeof mappings) => {
      for (const row of rows) stmt.run(row);
    });
    txn(mappings);
  }

  // ─── Dynamic Risk Adjustment ────────────────────────────────────────────

  /**
   * Get the current dynamic risk state (market regime + risk multiplier).
   */
  getDynamicRiskState(): { regime: string; vix_level: number | null; portfolio_drawdown: number; risk_multiplier: number } {
    const row = this.db.prepare('SELECT * FROM dynamic_risk_state WHERE id = 1').get() as any;
    if (!row) {
      return { regime: 'normal', vix_level: null, portfolio_drawdown: 0, risk_multiplier: 1.0 };
    }
    return {
      regime: row.regime,
      vix_level: row.vix_level,
      portfolio_drawdown: row.portfolio_drawdown,
      risk_multiplier: row.risk_multiplier,
    };
  }

  /**
   * Update dynamic risk state based on market conditions.
   * Adjusts risk_multiplier: crisis=0.25, high_vol=0.5, normal=1.0, low_vol=1.5
   *
   * @param portfolioDrawdown - current portfolio drawdown as fraction (0-1)
   * @param vixLevel - optional VIX level for volatility regime detection
   */
  updateDynamicRisk(portfolioDrawdown: number, vixLevel?: number): { regime: string; risk_multiplier: number } {
    let regime: string;
    let multiplier: number;

    // Determine regime from drawdown and VIX
    if (portfolioDrawdown > 0.15 || (vixLevel != null && vixLevel > 35)) {
      regime = 'crisis';
      multiplier = 0.25;
    } else if (portfolioDrawdown > 0.08 || (vixLevel != null && vixLevel > 25)) {
      regime = 'high_vol';
      multiplier = 0.5;
    } else if (portfolioDrawdown < 0.02 && (vixLevel == null || vixLevel < 15)) {
      regime = 'low_vol';
      multiplier = 1.5;
    } else {
      regime = 'normal';
      multiplier = 1.0;
    }

    this.db.prepare(`
      INSERT INTO dynamic_risk_state (id, regime, vix_level, portfolio_drawdown, risk_multiplier, updated_at)
      VALUES (1, @regime, @vix, @dd, @mult, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        regime = @regime, vix_level = @vix, portfolio_drawdown = @dd,
        risk_multiplier = @mult, updated_at = unixepoch()
    `).run({ regime, vix: vixLevel ?? null, dd: portfolioDrawdown, mult: multiplier });

    return { regime, risk_multiplier: multiplier };
  }

  /**
   * Get the effective threshold for a risk rule, adjusted by the dynamic risk multiplier.
   * For loss/amount limits: threshold * multiplier (lower in crisis = tighter limits)
   * For trade count: threshold * multiplier (fewer trades in crisis)
   */
  getAdjustedThreshold(ruleType: string, baseThreshold: number): number {
    const state = this.getDynamicRiskState();
    // In crisis mode, reduce thresholds (tighter risk). In low_vol, relax them.
    return baseThreshold * state.risk_multiplier;
  }
}
