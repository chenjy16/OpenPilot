/**
 * DailyScanCron — Scheduled daily scan that orchestrates the full multi-strategy pipeline.
 *
 * Flow:
 *   1. Get stock universe from dynamic_watchlist
 *   2. Get technical indicators for all symbols
 *   3. Run all registered enabled strategies' generateSignal for each symbol
 *   4. Pass signals to AutoTradingPipeline.processMultiStrategySignals()
 *   5. Send notification summary
 *   6. Return DailyScanResult
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */

import type Database from 'better-sqlite3';
import { schedule as cronSchedule, type ScheduledTask } from 'node-cron';
import type { StrategyEngine } from '../StrategyEngine';
import type { SignalAggregator } from './SignalAggregator';
import type { AutoTradingPipeline } from './AutoTradingPipeline';
import type { StrategySignal } from './types';
import { createLogger } from '../../logger';

const logger = createLogger('DailyScanCron');

/** Minimal notification service interface */
export interface NotificationServiceLike {
  sendNotification(message: string): Promise<void>;
}

/** Result of a daily scan run */
export interface DailyScanResult {
  scanned_symbols: number;
  signals_generated: number;
  orders_created: number;
  scan_time_ms: number;
}

/** Row shape from dynamic_watchlist */
interface WatchlistRow {
  symbol: string;
  price: number | null;
  avg_volume: number | null;
  avg_dollar_volume: number | null;
  market_cap: number | null;
  atr_pct: number | null;
  returns_20d: number | null;
  rsi: number | null;
  above_sma20: number | null;
}

export class DailyScanCron {
  private db: Database.Database;
  private strategyEngine: StrategyEngine;
  private signalAggregator: SignalAggregator;
  private autoTradingPipeline: AutoTradingPipeline;
  private notificationService: NotificationServiceLike;
  private cronTask: ScheduledTask | null = null;

  constructor(
    db: Database.Database,
    strategyEngine: StrategyEngine,
    signalAggregator: SignalAggregator,
    autoTradingPipeline: AutoTradingPipeline,
    notificationService: NotificationServiceLike,
  ) {
    this.db = db;
    this.strategyEngine = strategyEngine;
    this.signalAggregator = signalAggregator;
    this.autoTradingPipeline = autoTradingPipeline;
    this.notificationService = notificationService;
  }

  /**
   * Run the full daily scan pipeline.
   * Can be called manually or by the cron scheduler.
   */
  async runDailyScan(): Promise<DailyScanResult> {
    const startTime = Date.now();
    logger.info('Starting daily scan');

    // 1. Get stock universe from dynamic_watchlist
    const watchlistRows = this.getWatchlistSymbols();
    const scannedSymbols = watchlistRows.length;
    logger.info(`Scanning ${scannedSymbols} symbols from dynamic_watchlist`);

    if (scannedSymbols === 0) {
      logger.info('No symbols in watchlist, skipping scan');
      const result: DailyScanResult = {
        scanned_symbols: 0,
        signals_generated: 0,
        orders_created: 0,
        scan_time_ms: Date.now() - startTime,
      };
      await this.sendSummaryNotification(result);
      return result;
    }

    // 2. Run all registered enabled strategies for each symbol
    const strategySignals = this.runStrategies(watchlistRows);

    // Count total signals generated
    let signalsGenerated = 0;
    for (const signals of strategySignals.values()) {
      signalsGenerated += signals.length;
    }
    logger.info(`Generated ${signalsGenerated} signals from strategies`);

    // 3. Pass signals through the full pipeline (aggregate → AI filter → risk → sizing → MOO order)
    let ordersCreated = 0;
    if (signalsGenerated > 0) {
      const pipelineResults = await this.autoTradingPipeline.processMultiStrategySignals(strategySignals);
      ordersCreated = pipelineResults.filter((r) => r.action === 'order_created').length;
      logger.info(`Pipeline created ${ordersCreated} orders from ${pipelineResults.length} processed signals`);
    }

    const scanTimeMs = Date.now() - startTime;

    const result: DailyScanResult = {
      scanned_symbols: scannedSymbols,
      signals_generated: signalsGenerated,
      orders_created: ordersCreated,
      scan_time_ms: scanTimeMs,
    };

    // 4. Send notification summary
    await this.sendSummaryNotification(result);

    logger.info('Daily scan completed', {
      scanned_symbols: scannedSymbols,
      signals_generated: signalsGenerated,
      orders_created: ordersCreated,
      scan_time_ms: scanTimeMs,
    });

    return result;
  }

  /**
   * Start the cron scheduler.
   * @param cronExpression - cron expression, defaults to '0 16 * * 1-5' (4 PM EST weekdays)
   */
  start(cronExpression: string = '0 16 * * 1-5'): void {
    if (this.cronTask) {
      logger.warn('Cron task already running, stopping previous task');
      this.stop();
    }

    this.cronTask = cronSchedule(cronExpression, () => {
      this.runDailyScan().catch((err) => {
        logger.error('Daily scan cron job failed', { error: (err as Error).message });
      });
    });

    logger.info(`Daily scan cron started with expression: ${cronExpression}`);
  }

  /**
   * Stop the cron scheduler.
   */
  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      logger.info('Daily scan cron stopped');
    }
  }

  /**
   * Query dynamic_watchlist for all symbols and their indicator data.
   */
  private getWatchlistSymbols(): WatchlistRow[] {
    try {
      return this.db
        .prepare('SELECT symbol, price, avg_volume, avg_dollar_volume, market_cap, atr_pct, returns_20d, rsi, above_sma20 FROM dynamic_watchlist ORDER BY avg_dollar_volume DESC')
        .all() as WatchlistRow[];
    } catch {
      logger.warn('Failed to query dynamic_watchlist, returning empty list');
      return [];
    }
  }

  /**
   * Run all registered enabled strategies against each symbol.
   * Returns a Map of strategyName → StrategySignal[].
   */
  private runStrategies(watchlistRows: WatchlistRow[]): Map<string, StrategySignal[]> {
    const strategySignals = new Map<string, StrategySignal[]>();
    const registeredStrategies = this.strategyEngine.getRegisteredStrategies();

    for (const [name, registration] of registeredStrategies) {
      if (!registration.enabled) {
        logger.debug(`Skipping disabled strategy: ${name}`);
        continue;
      }

      const signals: StrategySignal[] = [];

      for (const row of watchlistRows) {
        const indicators = this.buildIndicators(row);

        try {
          const signal = registration.strategy.generateSignal(row.symbol, indicators);
          if (signal) {
            signals.push(signal);
          }
        } catch (err) {
          logger.warn(`Strategy ${name} failed for ${row.symbol}`, {
            error: (err as Error).message,
          });
        }
      }

      if (signals.length > 0) {
        strategySignals.set(name, signals);
      }
    }

    return strategySignals;
  }

  /**
   * Build an indicators record from a watchlist row.
   * Maps dynamic_watchlist columns to the indicator keys expected by strategies.
   */
  private buildIndicators(row: WatchlistRow): Record<string, number | null> {
    return {
      price: row.price,
      rsi_14: row.rsi,
      returns_20d: row.returns_20d,
      atr_pct: row.atr_pct,
      above_sma20: row.above_sma20,
      avg_volume: row.avg_volume,
      market_cap: row.market_cap,
      // Strategies may need additional indicators not in dynamic_watchlist;
      // those will be null and strategies handle missing data gracefully.
      high_20d: null,
      volume_ratio_20d: null,
      momentum_20d: null,
      bb_lower: null,
      ma_20: null,
      sentiment_score: null,
    };
  }

  /**
   * Send a notification summary after scan completion.
   */
  private async sendSummaryNotification(result: DailyScanResult): Promise<void> {
    const message = [
      `📊 Daily Scan Complete`,
      `Scanned symbols: ${result.scanned_symbols}`,
      `Signals generated: ${result.signals_generated}`,
      `Orders created: ${result.orders_created}`,
      `Scan time: ${result.scan_time_ms}ms`,
    ].join('\n');

    try {
      await this.notificationService.sendNotification(message);
    } catch (err) {
      logger.warn('Failed to send scan notification', { error: (err as Error).message });
    }
  }
}
