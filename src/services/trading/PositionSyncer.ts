/**
 * PositionSyncer - Synchronizes broker/simulated positions with local PortfolioManager
 *
 * Periodically fetches positions from TradingGateway (routes by mode: paper/live),
 * compares with PortfolioManager data, and updates local positions using broker data
 * as the source of truth. Also syncs account-level info.
 */

import type { PortfolioManager } from '../PortfolioManager';
import type { TradingGateway } from './TradingGateway';
import type { BrokerPosition } from './types';

export interface SyncDiff {
  symbol: string;
  local_quantity: number;
  broker_quantity: number;
  action: 'add' | 'update' | 'remove';
}

export interface AccountSyncInfo {
  available_cash: number;
  total_assets: number;
  frozen_cash: number;
}

export class PositionSyncer {
  private portfolioManager: PortfolioManager;
  private tradingGateway: TradingGateway;
  private syncIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAccountSync: AccountSyncInfo | null = null;
  private priceProvider: ((symbol: string) => Promise<number>) | null = null;

  constructor(
    portfolioManager: PortfolioManager,
    tradingGateway: TradingGateway,
    syncIntervalMs: number = 60_000,
  ) {
    this.portfolioManager = portfolioManager;
    this.tradingGateway = tradingGateway;
    this.syncIntervalMs = syncIntervalMs;
  }

  /**
   * Set a real-time price provider (e.g. QuoteService.getPriceNumber).
   * When set, sync() will use it to fill current_price instead of broker's cost_price fallback.
   */
  setPriceProvider(provider: (symbol: string) => Promise<number>): void {
    this.priceProvider = provider;
  }

  /**
   * Execute a single sync cycle.
   * 1. Sync order statuses with broker (submitted → filled/failed)
   * 2. Fetch broker positions via TradingGateway (routes by mode)
   * 3. Fetch local positions from PortfolioManager
   * 4. Compare and reconcile: broker data is source of truth
   * 5. Sync account-level info
   * Returns array of SyncDiff describing changes made.
   */
  async sync(): Promise<SyncDiff[]> {
    // Sync order statuses first (submitted orders may have been filled)
    try {
      const changed = await this.tradingGateway.syncOrderStatuses();
      if (changed > 0) {
        console.log(`[PositionSyncer] Order status sync: ${changed} orders updated`);
      }
    } catch (error) {
      console.error('[PositionSyncer] Order status sync failed:', error);
    }

    let brokerPositions: BrokerPosition[];
    try {
      brokerPositions = await this.tradingGateway.getPositions();
    } catch (error) {
      console.error('[PositionSyncer] Failed to fetch broker positions, keeping local data unchanged:', error);
      return [];
    }

    // Enrich broker positions with real-time prices from QuoteService
    // Longport stockPositions() doesn't return real-time prices, so current_price == avg_cost
    if (this.priceProvider) {
      for (const pos of brokerPositions) {
        try {
          const realPrice = await this.priceProvider(pos.symbol);
          if (realPrice > 0) {
            pos.current_price = realPrice;
            pos.market_value = pos.quantity * realPrice;
          }
        } catch {
          // Keep broker's fallback (cost_price) if quote unavailable
        }
      }
    }

    // Sync account-level info
    try {
      const account = await this.tradingGateway.getAccount();
      this.lastAccountSync = {
        available_cash: account.available_cash,
        total_assets: account.total_assets,
        frozen_cash: account.frozen_cash,
      };
    } catch (error) {
      console.error('[PositionSyncer] Failed to fetch account info:', error);
    }

    const localPositions = this.portfolioManager.listPositions();
    const diffs: SyncDiff[] = [];

    // Build lookup maps
    const localBySymbol = new Map<string, typeof localPositions[0]>();
    for (const pos of localPositions) {
      localBySymbol.set(pos.symbol, pos);
    }

    const brokerBySymbol = new Map<string, BrokerPosition>();
    for (const pos of brokerPositions) {
      brokerBySymbol.set(pos.symbol, pos);
    }

    // Process broker positions: add or update local
    for (const brokerPos of brokerPositions) {
      const localPos = localBySymbol.get(brokerPos.symbol);

      if (localPos) {
        // Update existing local position if different
        const needsUpdate =
          localPos.quantity !== brokerPos.quantity ||
          localPos.cost_price !== brokerPos.avg_cost ||
          localPos.current_price !== brokerPos.current_price;

        if (needsUpdate) {
          const diff: SyncDiff = {
            symbol: brokerPos.symbol,
            local_quantity: localPos.quantity,
            broker_quantity: brokerPos.quantity,
            action: 'update',
          };
          diffs.push(diff);
          console.log(
            `[PositionSyncer] Update: symbol=${diff.symbol}, local_qty=${diff.local_quantity}, broker_qty=${diff.broker_quantity}, action=update`,
          );

          this.portfolioManager.updatePosition(localPos.id!, {
            quantity: brokerPos.quantity,
            cost_price: brokerPos.avg_cost,
            current_price: brokerPos.current_price,
          });
        }
      } else {
        // Add new position from broker
        const diff: SyncDiff = {
          symbol: brokerPos.symbol,
          local_quantity: 0,
          broker_quantity: brokerPos.quantity,
          action: 'add',
        };
        diffs.push(diff);
        console.log(
          `[PositionSyncer] Add: symbol=${diff.symbol}, local_qty=0, broker_qty=${diff.broker_quantity}, action=add`,
        );

        this.portfolioManager.addPosition({
          symbol: brokerPos.symbol,
          quantity: brokerPos.quantity,
          cost_price: brokerPos.avg_cost,
          current_price: brokerPos.current_price,
        });
      }
    }

    // Remove local positions not in broker
    for (const localPos of localPositions) {
      if (!brokerBySymbol.has(localPos.symbol)) {
        const diff: SyncDiff = {
          symbol: localPos.symbol,
          local_quantity: localPos.quantity,
          broker_quantity: 0,
          action: 'remove',
        };
        diffs.push(diff);
        console.log(
          `[PositionSyncer] Remove: symbol=${diff.symbol}, local_qty=${diff.local_quantity}, broker_qty=0, action=remove`,
        );

        this.portfolioManager.deletePosition(localPos.id!);
      }
    }

    return diffs;
  }

  /** Start periodic sync at configured interval */
  start(): void {
    if (this.timer) {
      return; // Already running
    }
    this.timer = setInterval(() => {
      this.sync().catch((error) => {
        console.error('[PositionSyncer] Periodic sync failed:', error);
      });
    }, this.syncIntervalMs);
  }

  /** Stop periodic sync */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Get the last synced account info */
  getLastAccountSync(): AccountSyncInfo | null {
    return this.lastAccountSync;
  }
}
