import type Database from 'better-sqlite3';
import type { TradingGateway } from './TradingGateway';
import type { TradeNotifier } from './TradeNotifier';
import type { StopLossRecord, StopLossTriggerEvent } from './types';

// ─── Pure Function ──────────────────────────────────────────────────────────

/**
 * 纯函数：判断是否触发止盈止损
 * currentPrice <= stopLoss → 'stop_loss'
 * currentPrice >= takeProfit → 'take_profit'
 * otherwise → null
 */
export function checkStopLossTrigger(
  currentPrice: number,
  stopLoss: number,
  takeProfit: number,
): 'stop_loss' | 'take_profit' | null {
  if (currentPrice <= stopLoss) return 'stop_loss';
  if (currentPrice >= takeProfit) return 'take_profit';
  return null;
}

// ─── StopLossManager Class ──────────────────────────────────────────────────

export class StopLossManager {
  private db: Database.Database;
  private tradingGateway: TradingGateway;
  private tradeNotifier: TradeNotifier;
  private activeRecords: Map<number, StopLossRecord> = new Map();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    db: Database.Database,
    tradingGateway: TradingGateway,
    tradeNotifier: TradeNotifier,
  ) {
    this.db = db;
    this.tradingGateway = tradingGateway;
    this.tradeNotifier = tradeNotifier;
  }

  /** 注册止盈止损监控，写入 stop_loss_records 表 */
  register(record: Omit<StopLossRecord, 'id' | 'status' | 'created_at'>): StopLossRecord {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(`
      INSERT INTO stop_loss_records (order_id, symbol, side, entry_price, stop_loss, take_profit, status, created_at)
      VALUES (@order_id, @symbol, @side, @entry_price, @stop_loss, @take_profit, 'active', @created_at)
    `).run({
      order_id: record.order_id,
      symbol: record.symbol,
      side: record.side,
      entry_price: record.entry_price,
      stop_loss: record.stop_loss,
      take_profit: record.take_profit,
      created_at: now,
    });

    const saved: StopLossRecord = {
      id: Number(result.lastInsertRowid),
      ...record,
      status: 'active',
      created_at: now,
    };

    this.activeRecords.set(saved.id!, saved);
    return saved;
  }

  /** Price provider callback — set by QuoteService integration */
  private priceProvider: ((symbol: string) => Promise<number>) | null = null;

  /** Set the price provider (called from index.ts after QuoteService is ready) */
  setPriceProvider(provider: (symbol: string) => Promise<number>): void {
    this.priceProvider = provider;
  }

  /** 启动定时检查，默认 30 秒间隔 */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(() => {
      if (this.priceProvider && this.activeRecords.size > 0) {
        this.checkAll(this.priceProvider).catch(err => {
          console.error(`[StopLossManager] checkAll error: ${err.message}`);
        });
      }
    }, intervalMs);
  }

  /** 停止定时检查 */
  stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  /** 检查所有活跃记录，触发止盈止损时生成市价卖出订单 */
  async checkAll(
    getCurrentPrice: (symbol: string) => Promise<number>,
  ): Promise<StopLossTriggerEvent[]> {
    const events: StopLossTriggerEvent[] = [];
    const records = Array.from(this.activeRecords.values());

    for (const record of records) {
      let currentPrice: number;
      try {
        currentPrice = await getCurrentPrice(record.symbol);
      } catch {
        // 获取价格失败，跳过本轮，下轮重试
        continue;
      }

      const triggerType = checkStopLossTrigger(currentPrice, record.stop_loss, record.take_profit);
      if (!triggerType) continue;

      // Estimate quantity from the original order
      const originalOrder = this.tradingGateway.getOrder(record.order_id);
      const quantity = originalOrder?.filled_quantity || originalOrder?.quantity || 1;
      const pnlAmount = (currentPrice - record.entry_price) * quantity;

      const event: StopLossTriggerEvent = {
        record,
        trigger_type: triggerType,
        current_price: currentPrice,
        pnl_amount: pnlAmount,
      };

      try {
        // 1. Generate market sell order
        const sellOrder = await this.tradingGateway.placeOrder({
          symbol: record.symbol,
          side: 'sell',
          order_type: 'market',
          quantity,
        });

        // Check if order was rejected by risk control
        if (sellOrder.status === 'failed' || sellOrder.status === 'rejected') {
          const reason = sellOrder.reject_reason || 'Order rejected';
          await this.tradeNotifier.notifyUrgentAlert(
            `止盈止损订单被拒绝: ${record.symbol} ${triggerType} @ ${currentPrice}, reason: ${reason}`,
          );
          // Keep record active for retry
          continue;
        }

        // 2. Update record status in DB
        const newStatus = triggerType === 'stop_loss' ? 'triggered_sl' : 'triggered_tp';
        const now = Math.floor(Date.now() / 1000);
        this.db.prepare(`
          UPDATE stop_loss_records
          SET status = @status, triggered_at = @triggered_at, triggered_price = @triggered_price
          WHERE id = @id
        `).run({
          status: newStatus,
          triggered_at: now,
          triggered_price: currentPrice,
          id: record.id,
        });

        // 3. Remove from active records in memory
        this.activeRecords.delete(record.id!);

        // 4. Log to trading_audit_log
        const operation = triggerType === 'stop_loss' ? 'stop_loss_triggered' : 'take_profit_triggered';
        this.logAudit(operation, sellOrder.id, {
          record_id: record.id,
          symbol: record.symbol,
          entry_price: record.entry_price,
          trigger_price: currentPrice,
          pnl_amount: pnlAmount,
        });

        // 5. Notify via TradeNotifier
        await this.tradeNotifier.notifyStopLossTriggered(event);

        events.push(event);
      } catch (err: any) {
        // placeOrder threw — send urgent alert, keep record active for retry
        await this.tradeNotifier.notifyUrgentAlert(
          `止盈止损订单执行失败: ${record.symbol} ${triggerType} @ ${currentPrice}, error: ${err.message}`,
        );
      }
    }

    return events;
  }

  /** 从数据库加载 status='active' 的记录恢复监控 */
  restoreFromDb(): StopLossRecord[] {
    const rows = this.db.prepare(`
      SELECT id, order_id, symbol, side, entry_price, stop_loss, take_profit,
             status, triggered_at, triggered_price, created_at
      FROM stop_loss_records
      WHERE status = 'active'
    `).all() as StopLossRecord[];

    this.activeRecords.clear();
    for (const row of rows) {
      this.activeRecords.set(row.id!, row);
    }

    return rows;
  }

  /** 返回内存中活跃记录列表 */
  getActiveRecords(): StopLossRecord[] {
    return Array.from(this.activeRecords.values());
  }

  /** 取消监控，更新记录状态为 cancelled */
  cancel(recordId: number): void {
    this.db.prepare(`
      UPDATE stop_loss_records SET status = 'cancelled' WHERE id = @id AND status = 'active'
    `).run({ id: recordId });

    this.activeRecords.delete(recordId);
  }

  /** 写入审计日志 */
  private logAudit(operation: string, orderId?: number, details?: any): void {
    this.db.prepare(`
      INSERT INTO trading_audit_log (timestamp, operation, order_id, request_params, response_result)
      VALUES (@timestamp, @operation, @order_id, @request_params, NULL)
    `).run({
      timestamp: Math.floor(Date.now() / 1000),
      operation,
      order_id: orderId ?? null,
      request_params: details ? JSON.stringify(details) : null,
    });
  }
}
