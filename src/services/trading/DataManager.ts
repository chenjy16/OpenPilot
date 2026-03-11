/**
 * DataManager — Local OHLCV data cache.
 *
 * Stores daily OHLCV data in SQLite (ohlcv_daily table).
 * Fetches from yfinance via Python script, caches locally.
 * Subsequent reads hit the DB instead of network.
 */

import type Database from 'better-sqlite3';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface OHLCVBar {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class DataManager {
  private db: Database.Database;
  private pythonPath: string;

  constructor(db: Database.Database, pythonPath?: string) {
    this.db = db;
    const venvPy = path.join(__dirname, '..', '..', '..', 'scripts', '.venv', 'bin', 'python3');
    this.pythonPath = pythonPath ?? (fs.existsSync(venvPy) ? venvPy : 'python3');
  }

  /**
   * Get OHLCV data for a symbol. Returns cached data if available,
   * otherwise fetches from yfinance and caches.
   */
  async getOHLCV(symbol: string, days: number = 365): Promise<OHLCVBar[]> {
    // Check cache freshness
    const cached = this.getCachedData(symbol, days);
    const today = new Date().toISOString().slice(0, 10);
    const latestCached = cached.length > 0 ? cached[cached.length - 1].date : null;

    // If we have recent data (within 1 day), return cache
    if (latestCached && this.daysDiff(latestCached, today) <= 1 && cached.length >= days * 0.7) {
      return cached;
    }

    // Fetch fresh data and update cache
    try {
      const fresh = await this.fetchFromYfinance(symbol, days);
      if (fresh.length > 0) {
        this.upsertBatch(symbol, fresh);
      }
      return this.getCachedData(symbol, days);
    } catch (err: any) {
      console.error(`[DataManager] Fetch failed for ${symbol}: ${err.message}`);
      // Return whatever cache we have
      return cached;
    }
  }

  /**
   * Sync data for multiple symbols (used by cron job).
   */
  async syncSymbols(symbols: string[], days: number = 365): Promise<{ synced: number; errors: string[] }> {
    let synced = 0;
    const errors: string[] = [];

    for (const symbol of symbols) {
      try {
        const fresh = await this.fetchFromYfinance(symbol, days);
        if (fresh.length > 0) {
          this.upsertBatch(symbol, fresh);
          synced++;
        }
      } catch (err: any) {
        errors.push(`${symbol}: ${err.message}`);
      }
    }

    return { synced, errors };
  }

  /**
   * Get cached data from DB.
   */
  getCachedData(symbol: string, days: number = 365): OHLCVBar[] {
    const rows = this.db.prepare(`
      SELECT symbol, date, open, high, low, close, volume
      FROM ohlcv_daily
      WHERE symbol = ?
      ORDER BY date DESC
      LIMIT ?
    `).all(symbol.toUpperCase(), days) as OHLCVBar[];

    return rows.reverse(); // oldest first
  }

  /**
   * Get the latest cached date for a symbol.
   */
  getLatestDate(symbol: string): string | null {
    const row = this.db.prepare(
      `SELECT date FROM ohlcv_daily WHERE symbol = ? ORDER BY date DESC LIMIT 1`
    ).get(symbol.toUpperCase()) as { date: string } | undefined;
    return row?.date ?? null;
  }

  /**
   * Get cache stats.
   */
  getStats(): { symbols: number; total_bars: number } {
    const row = this.db.prepare(
      `SELECT COUNT(DISTINCT symbol) as symbols, COUNT(*) as total_bars FROM ohlcv_daily`
    ).get() as { symbols: number; total_bars: number };
    return row;
  }

  private async fetchFromYfinance(symbol: string, days: number): Promise<OHLCVBar[]> {
    const period = days <= 30 ? '1mo' : days <= 90 ? '3mo' : days <= 365 ? '1y' : '2y';
    const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'stock_analysis.py');

    const cmd = `"${this.pythonPath}" "${scriptPath}" ${symbol.toUpperCase()} --history --period ${period}`;
    const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });

    const data = JSON.parse(output.trim());
    if (data.error) {
      throw new Error(data.message || data.error);
    }

    if (!Array.isArray(data)) {
      throw new Error('Unexpected response format');
    }

    return data.map((bar: any) => ({
      symbol: symbol.toUpperCase(),
      date: bar.date,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  }

  private upsertBatch(symbol: string, bars: OHLCVBar[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO ohlcv_daily (symbol, date, open, high, low, close, volume)
      VALUES (@symbol, @date, @open, @high, @low, @close, @volume)
      ON CONFLICT(symbol, date) DO UPDATE SET
        open = @open, high = @high, low = @low, close = @close, volume = @volume
    `);

    const txn = this.db.transaction((rows: OHLCVBar[]) => {
      for (const row of rows) {
        stmt.run({
          symbol: row.symbol.toUpperCase(),
          date: row.date,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
        });
      }
    });

    txn(bars);
  }

  private daysDiff(dateA: string, dateB: string): number {
    const a = new Date(dateA).getTime();
    const b = new Date(dateB).getTime();
    return Math.abs(Math.round((b - a) / 86400000));
  }
}
