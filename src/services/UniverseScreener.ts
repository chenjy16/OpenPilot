/**
 * UniverseScreener — Automatically screen US stocks suitable for quant trading.
 *
 * Wraps the Python universe_screener.py script and manages a dynamic_watchlist
 * table in SQLite. The StockScanner reads from this table instead of a static list.
 *
 * Designed to run as a daily cron job (e.g. after market close).
 */

import { execFile } from 'child_process';
import * as path from 'path';
import type Database from 'better-sqlite3';

export interface ScreenedStock {
  symbol: string;
  price: number;
  avg_volume: number;
  avg_dollar_volume: number;
  market_cap: number;
  atr_pct: number;
  returns_20d: number;
  rsi: number;
  above_sma20: boolean;
}

export interface ScreenerConfig {
  pool: 'sp500' | 'nasdaq100' | 'momentum' | 'all';
  minVolume: number;
  minPrice: number;
  maxPrice: number;
  minAtr: number;
  maxAtr: number;
  top: number;
}

const DEFAULT_CONFIG: ScreenerConfig = {
  pool: 'all',
  minVolume: 1_000_000,
  minPrice: 5,
  maxPrice: 500,
  minAtr: 1.5,
  maxAtr: 8.0,
  top: 100,
};

export class UniverseScreener {
  private db: Database.Database;
  private pythonPath: string;
  private scriptPath: string;

  constructor(db: Database.Database, pythonPath?: string) {
    this.db = db;
    this.pythonPath = pythonPath || 'python3';
    this.scriptPath = path.resolve(__dirname, '../../scripts/universe_screener.py');
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dynamic_watchlist (
        symbol TEXT PRIMARY KEY,
        price REAL,
        avg_volume INTEGER,
        avg_dollar_volume REAL,
        market_cap INTEGER,
        atr_pct REAL,
        returns_20d REAL,
        rsi REAL,
        above_sma20 INTEGER,
        screened_at INTEGER,
        pool TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_watchlist_screened ON dynamic_watchlist(screened_at);
      CREATE INDEX IF NOT EXISTS idx_watchlist_atr ON dynamic_watchlist(atr_pct);
    `);
  }

  /**
   * Run the screening process. Calls the Python script and updates the DB.
   */
  async runScreen(config?: Partial<ScreenerConfig>): Promise<ScreenedStock[]> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const args = [
      this.scriptPath,
      '--pool', cfg.pool,
      '--min-volume', String(cfg.minVolume),
      '--min-price', String(cfg.minPrice),
      '--max-price', String(cfg.maxPrice),
      '--min-atr', String(cfg.minAtr),
      '--max-atr', String(cfg.maxAtr),
      '--top', String(cfg.top),
    ];

    return new Promise((resolve, reject) => {
      execFile(this.pythonPath, args, {
        timeout: 300_000, // 5 minutes max
        maxBuffer: 10 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[UniverseScreener] Python error: ${error.message}`);
          if (stderr) console.error(`[UniverseScreener] stderr: ${stderr}`);
          reject(error);
          return;
        }

        try {
          const results: ScreenedStock[] = JSON.parse(stdout);
          this.saveResults(results, cfg.pool);
          console.log(`[UniverseScreener] Screened ${results.length} stocks (pool=${cfg.pool})`);
          resolve(results);
        } catch (parseErr: any) {
          console.error(`[UniverseScreener] Parse error: ${parseErr.message}`);
          reject(parseErr);
        }
      });
    });
  }

  /**
   * Save screening results to dynamic_watchlist table.
   * Replaces all existing entries for the given pool.
   */
  private saveResults(results: ScreenedStock[], pool: string): void {
    const now = Math.floor(Date.now() / 1000);

    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO dynamic_watchlist
        (symbol, price, avg_volume, avg_dollar_volume, market_cap, atr_pct, returns_20d, rsi, above_sma20, screened_at, pool)
      VALUES
        (@symbol, @price, @avg_volume, @avg_dollar_volume, @market_cap, @atr_pct, @returns_20d, @rsi, @above_sma20, @screened_at, @pool)
    `);

    const transaction = this.db.transaction(() => {
      // Remove stale entries from this pool
      this.db.prepare('DELETE FROM dynamic_watchlist WHERE pool = ?').run(pool);

      for (const stock of results) {
        insertStmt.run({
          symbol: stock.symbol,
          price: stock.price,
          avg_volume: stock.avg_volume,
          avg_dollar_volume: stock.avg_dollar_volume,
          market_cap: stock.market_cap,
          atr_pct: stock.atr_pct,
          returns_20d: stock.returns_20d,
          rsi: stock.rsi,
          above_sma20: stock.above_sma20 ? 1 : 0,
          screened_at: now,
          pool,
        });
      }
    });

    transaction();
  }

  /**
   * Get the current dynamic watchlist from DB.
   */
  getWatchlist(): ScreenedStock[] {
    const rows = this.db.prepare(
      'SELECT * FROM dynamic_watchlist ORDER BY avg_dollar_volume DESC'
    ).all() as any[];

    return rows.map(r => ({
      symbol: r.symbol,
      price: r.price,
      avg_volume: r.avg_volume,
      avg_dollar_volume: r.avg_dollar_volume,
      market_cap: r.market_cap,
      atr_pct: r.atr_pct,
      returns_20d: r.returns_20d,
      rsi: r.rsi,
      above_sma20: !!r.above_sma20,
    }));
  }

  /**
   * Get just the symbol list (for StockScanner integration).
   */
  getWatchlistSymbols(): string[] {
    const rows = this.db.prepare(
      'SELECT symbol FROM dynamic_watchlist ORDER BY avg_dollar_volume DESC'
    ).all() as any[];
    return rows.map(r => r.symbol);
  }

  /**
   * Get screening stats.
   */
  getStats(): { total: number; lastScreenedAt: number | null; pools: string[] } {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM dynamic_watchlist').get() as any;
    const lastRow = this.db.prepare('SELECT MAX(screened_at) as last_at FROM dynamic_watchlist').get() as any;
    const poolRows = this.db.prepare('SELECT DISTINCT pool FROM dynamic_watchlist').all() as any[];

    return {
      total: countRow?.cnt || 0,
      lastScreenedAt: lastRow?.last_at || null,
      pools: poolRows.map(r => r.pool),
    };
  }
}
