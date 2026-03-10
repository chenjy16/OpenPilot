/**
 * Stock Analysis Tools — Quant Stock Analysis Module
 *
 * Three core tools for quantitative stock analysis:
 *   - stock_tech_analysis: Technical analysis via Python script (yfinance + pandas_ta)
 *   - stock_sentiment: Market sentiment via Finnhub News API
 *   - stock_deliver_alert: Signal card delivery to Telegram/Discord
 *
 * Tools are created via factory functions that accept runtime dependencies
 * (sandbox, db, channelManager) through closures.
 */

import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';
import type { ExecutionSandbox } from '../runtime/sandbox';
import type Database from 'better-sqlite3';
import type { ChannelManager } from '../channels/ChannelManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TechAnalysisResult {
  symbol: string;
  price: number;
  sma20: number;
  sma50: number;
  rsi14: number;
  macd_line: number;
  macd_signal: number;
  macd_histogram: number;
  bollinger_upper: number;
  bollinger_lower: number;
  volume_avg: number;
  data_date: string;
  atr14: number | null;
  obv: number | null;
  vwap: number | null;
  kdj_k: number | null;
  kdj_d: number | null;
  kdj_j: number | null;
  williams_r: number | null;
}

export interface SentimentResult {
  symbol: string;
  earnings_summary: string | null;
  analyst_rating: string | null;
  news: Array<{
    title: string;
    summary: string;
    published_at: string;
  }>;
  data_sources: string[];
  errors: string[];
}

export interface DeliverAlertParams {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
  technical_summary?: string;
  sentiment_summary?: string;
}

export interface DeliverAlertResult {
  delivered: boolean;
  channels: string[];
  signal_id: number;
  deduplicated: boolean;
  message?: string;
}

export interface ToolError {
  error: string;
  message: string;
  source?: string;
}

export interface StockToolsDeps {
  sandbox: ExecutionSandbox;
  db: Database.Database;
  channelManager?: ChannelManager;
  notifyConfig?: {
    enabled?: boolean;
    telegram?: { chatId: string };
    discord?: { channelId: string };
    dedupHours?: number;
  };
}

// ---------------------------------------------------------------------------
// Sensitive info filtering (Task 2.5)
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  /(?:api[_-]?key|password|passwd|token|secret|credential|auth[_-]?key|private[_-]?key)[=:]\s*\S+/gi,
  /(?:FINNHUB_API_KEY|OPENAI_API_KEY|TELEGRAM_BOT_TOKEN|DISCORD_TOKEN)[=:]\s*\S+/gi,
  /\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|xox[bpas]-[a-zA-Z0-9-]+)\b/g,
];

/**
 * Strip sensitive information (API keys, passwords, tokens) from text.
 * Ensures no credentials leak into push notifications.
 */
export function filterSensitiveInfo(text: string): string {
  let filtered = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    filtered = filtered.replace(pattern, '[REDACTED]');
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Helper: truncate text
// ---------------------------------------------------------------------------

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

// ---------------------------------------------------------------------------
// Tool 1: stock_tech_analysis (Task 2.1)
// ---------------------------------------------------------------------------

const TECH_ANALYSIS_REQUIRED_FIELDS = [
  'symbol', 'price', 'sma20', 'sma50', 'rsi14',
  'macd_line', 'macd_signal', 'macd_histogram',
  'bollinger_upper', 'bollinger_lower', 'volume_avg', 'data_date',
] as const;

export function createStockTechAnalysisTool(sandbox: ExecutionSandbox): Tool {
  return {
    name: 'stock_tech_analysis',
    description:
      'Analyze stock technical indicators using Python (yfinance + pandas_ta). ' +
      'Returns SMA, RSI, MACD, Bollinger Bands, and volume data.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g. "AAPL", "GOOGL")',
        },
        period: {
          type: 'string',
          description: 'Data period for analysis (default: "3mo")',
        },
        timeframe: {
          type: 'string',
          description: 'Analysis timeframe: "daily", "weekly", or "monthly" (default: "daily"). Use "multi" for multi-timeframe analysis.',
          enum: ['daily', 'weekly', 'monthly', 'multi'],
        },
      },
      required: ['symbol'],
    },
    execute: async (params: Record<string, unknown>) => {
      const symbol = (params.symbol as string).toUpperCase().trim();
      const period = (params.period as string) || '3mo';
      const timeframe = (params.timeframe as string) || 'daily';

      if (!symbol || !/^[A-Z]{1,10}$/.test(symbol)) {
        return {
          error: 'INVALID_SYMBOL',
          message: `Invalid stock symbol: "${symbol}". Must be 1-10 uppercase letters.`,
        } satisfies ToolError;
      }

      // Validate timeframe parameter
      const validTimeframes = ['daily', 'weekly', 'monthly', 'multi'];
      if (!validTimeframes.includes(timeframe)) {
        return {
          error: 'INVALID_PARAMS',
          message: `Invalid timeframe: "${timeframe}". Must be one of: ${validTimeframes.join(', ')}`,
        } satisfies ToolError;
      }

      try {
        // Use venv Python if available, fallback to system python
        const venvPython = 'scripts/.venv/bin/python3';
        const pythonCmd = require('fs').existsSync(venvPython) ? venvPython : 'python3';

        // Build command with timeframe arguments
        let cmd = `${pythonCmd} scripts/stock_analysis.py ${symbol}`;
        if (timeframe === 'multi') {
          cmd += ' --multi-timeframe';
        } else if (timeframe !== 'daily') {
          cmd += ` --timeframe ${timeframe}`;
        }

        const result = await sandbox.exec(
          cmd,
          { timeoutMs: 30_000 },
        );

        // Parse stdout as JSON
        const stdout = result.stdout.trim();

        if (!stdout) {
          return {
            error: 'SCRIPT_ERROR',
            message: 'Python script returned empty output',
            source: 'stock_analysis.py',
          } satisfies ToolError;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          return {
            error: 'SCRIPT_ERROR',
            message: `Failed to parse Python script output as JSON: ${stdout.slice(0, 200)}`,
            source: 'stock_analysis.py',
          } satisfies ToolError;
        }

        // Check if the script returned an error
        if (parsed.error) {
          return {
            error: parsed.error,
            message: parsed.message || 'Unknown error from Python script',
            source: 'stock_analysis.py',
          } satisfies ToolError;
        }

        // Non-zero exit code
        if (result.exitCode !== 0) {
          return {
            error: 'SCRIPT_ERROR',
            message: parsed.message || result.stderr || `Script exited with code ${result.exitCode}`,
            source: 'stock_analysis.py',
          } satisfies ToolError;
        }

        // Validate required fields
        for (const field of TECH_ANALYSIS_REQUIRED_FIELDS) {
          if (parsed[field] === undefined || parsed[field] === null) {
            return {
              error: 'INCOMPLETE_DATA',
              message: `Missing required field: ${field}`,
              source: 'stock_analysis.py',
            } satisfies ToolError;
          }
        }

        return parsed as TechAnalysisResult;
      } catch (err: any) {
        // Timeout or sandbox error
        if (err.message?.includes('aborted') || err.message?.includes('timeout') || err.message?.includes('TIMEOUT')) {
          return {
            error: 'SCRIPT_TIMEOUT',
            message: 'Python script execution timed out (30s limit)',
            source: 'stock_analysis.py',
          } satisfies ToolError;
        }
        return {
          error: 'SCRIPT_ERROR',
          message: err.message || 'Unknown execution error',
          source: 'stock_analysis.py',
        } satisfies ToolError;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool 2: stock_sentiment (Task 2.2)
// ---------------------------------------------------------------------------

const MAX_SINGLE_NEWS_LENGTH = 500;
const MAX_TOTAL_CONTENT_LENGTH = 5000;

export function createStockSentimentTool(): Tool {
  return {
    name: 'stock_sentiment',
    description:
      'Get market sentiment data for a stock including recent news, earnings summaries, ' +
      'and analyst ratings from Finnhub API.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g. "AAPL", "GOOGL")',
        },
      },
      required: ['symbol'],
    },
    execute: async (params: Record<string, unknown>) => {
      const symbol = (params.symbol as string).toUpperCase().trim();

      if (!symbol || !/^[A-Z]{1,10}$/.test(symbol)) {
        return {
          error: 'INVALID_SYMBOL',
          message: `Invalid stock symbol: "${symbol}". Must be 1-10 uppercase letters.`,
        } satisfies ToolError;
      }

      const apiKey = process.env.FINNHUB_API_KEY;
      if (!apiKey) {
        return {
          error: 'API_KEY_MISSING',
          message: 'FINNHUB_API_KEY environment variable is not configured',
          source: 'finnhub',
        } satisfies ToolError;
      }

      const result: SentimentResult = {
        symbol,
        earnings_summary: null,
        analyst_rating: null,
        news: [],
        data_sources: [],
        errors: [],
      };

      // Fetch company news from Finnhub (last 24 hours)
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const fromDate = yesterday.toISOString().split('T')[0];
      const toDate = now.toISOString().split('T')[0];

      try {
        const newsUrl = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);

        try {
          const res = await fetch(newsUrl, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
          });

          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              return {
                error: 'API_KEY_INVALID',
                message: 'FINNHUB_API_KEY is invalid or expired',
                source: 'finnhub',
              } satisfies ToolError;
            }
            throw new Error(`Finnhub API ${res.status}: ${res.statusText}`);
          }

          const newsData = await res.json() as any[];

          if (Array.isArray(newsData) && newsData.length > 0) {
            result.data_sources.push('finnhub_news');

            let totalLength = 0;

            for (const item of newsData) {
              if (totalLength >= MAX_TOTAL_CONTENT_LENGTH) break;

              const title = truncateText(String(item.headline || ''), MAX_SINGLE_NEWS_LENGTH);
              const summary = truncateText(String(item.summary || ''), MAX_SINGLE_NEWS_LENGTH);
              const publishedAt = item.datetime
                ? new Date(item.datetime * 1000).toISOString()
                : new Date().toISOString();

              const entryLength = title.length + summary.length;
              if (totalLength + entryLength > MAX_TOTAL_CONTENT_LENGTH) {
                // Truncate this entry to fit within total limit
                const remaining = MAX_TOTAL_CONTENT_LENGTH - totalLength;
                if (remaining > 50) {
                  result.news.push({
                    title: truncateText(title, remaining),
                    summary: '',
                    published_at: publishedAt,
                  });
                }
                break;
              }

              result.news.push({ title, summary, published_at: publishedAt });
              totalLength += entryLength;
            }
          } else {
            result.errors.push('finnhub_news: no news data available');
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (err: any) {
        result.errors.push(`finnhub_news: ${err.message || 'fetch failed'}`);
      }

      // Fetch recommendation trends (analyst ratings)
      try {
        const recUrl = `https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);

        try {
          const res = await fetch(recUrl, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
          });

          if (res.ok) {
            const recData = await res.json() as any[];
            if (Array.isArray(recData) && recData.length > 0) {
              const latest = recData[0];
              result.analyst_rating = `Buy: ${latest.buy || 0}, Hold: ${latest.hold || 0}, Sell: ${latest.sell || 0}, Strong Buy: ${latest.strongBuy || 0}, Strong Sell: ${latest.strongSell || 0} (Period: ${latest.period || 'N/A'})`;
              result.data_sources.push('finnhub_recommendation');
            }
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (err: any) {
        result.errors.push(`finnhub_recommendation: ${err.message || 'fetch failed'}`);
      }

      // Fetch basic financials for earnings summary
      try {
        const finUrl = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);

        try {
          const res = await fetch(finUrl, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
          });

          if (res.ok) {
            const finData = await res.json() as any;
            if (finData?.metric) {
              const m = finData.metric;
              const parts: string[] = [];
              if (m['epsAnnual'] != null) parts.push(`EPS(Annual): ${m['epsAnnual']}`);
              if (m['revenuePerShareAnnual'] != null) parts.push(`Revenue/Share: ${m['revenuePerShareAnnual']}`);
              if (m['peAnnual'] != null) parts.push(`P/E: ${m['peAnnual']}`);
              if (m['marketCapitalization'] != null) parts.push(`Market Cap: ${m['marketCapitalization']}M`);
              if (parts.length > 0) {
                result.earnings_summary = truncateText(parts.join(', '), MAX_SINGLE_NEWS_LENGTH);
                result.data_sources.push('finnhub_metrics');
              }
            }
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (err: any) {
        result.errors.push(`finnhub_metrics: ${err.message || 'fetch failed'}`);
      }

      // If no data sources succeeded at all, return error
      if (result.data_sources.length === 0) {
        return {
          error: 'API_FETCH_ERROR',
          message: `All data sources failed for ${symbol}: ${result.errors.join('; ')}`,
          source: 'finnhub',
        } satisfies ToolError;
      }

      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Tool 3: stock_deliver_alert (Task 2.3 + Task 2.5 sensitive filtering)
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  buy: '买入',
  sell: '卖出',
  hold: '观望',
};

function formatSignalCard(params: DeliverAlertParams): string {
  const actionLabel = ACTION_LABELS[params.action] || params.action;
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const card = [
    '📈 量化分析信号',
    '',
    `🏷️ ${params.symbol}`,
    `📊 操作建议: ${actionLabel}`,
    `💰 建议入场: $${params.entry_price.toFixed(2)}`,
    `🛑 止损位: $${params.stop_loss.toFixed(2)}`,
    `🎯 止盈位: $${params.take_profit.toFixed(2)}`,
    `🔒 置信度: ${params.confidence}`,
    '',
    '💡 逻辑支撑:',
    params.reasoning,
    '',
    `⏰ ${timestamp} UTC`,
  ].join('\n');

  // Apply sensitive info filtering (Task 2.5)
  return filterSensitiveInfo(card);
}

export function createStockDeliverAlertTool(
  db: Database.Database,
  channelManager?: ChannelManager,
  notifyConfig?: StockToolsDeps['notifyConfig'],
): Tool {
  return {
    name: 'stock_deliver_alert',
    description:
      'Deliver a stock analysis signal as a formatted Signal Card. ' +
      'Saves to database and pushes to Telegram/Discord with 24h dedup.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol',
        },
        action: {
          type: 'string',
          description: 'Trading action: "buy", "sell", or "hold"',
        },
        entry_price: {
          type: 'number',
          description: 'Suggested entry price',
        },
        stop_loss: {
          type: 'number',
          description: 'Stop loss price',
        },
        take_profit: {
          type: 'number',
          description: 'Take profit price',
        },
        reasoning: {
          type: 'string',
          description: 'Analysis reasoning and logic support',
        },
        confidence: {
          type: 'string',
          description: 'Signal confidence: "high", "medium", or "low"',
        },
        technical_summary: {
          type: 'string',
          description: 'Technical analysis summary JSON (optional)',
        },
        sentiment_summary: {
          type: 'string',
          description: 'Sentiment analysis summary (optional)',
        },
      },
      required: ['symbol', 'action', 'entry_price', 'stop_loss', 'take_profit', 'reasoning', 'confidence'],
    },
    execute: async (params: Record<string, unknown>) => {
      const alertParams: DeliverAlertParams = {
        symbol: (params.symbol as string).toUpperCase().trim(),
        action: params.action as 'buy' | 'sell' | 'hold',
        entry_price: Number(params.entry_price),
        stop_loss: Number(params.stop_loss),
        take_profit: Number(params.take_profit),
        reasoning: String(params.reasoning || ''),
        confidence: params.confidence as 'high' | 'medium' | 'low',
        technical_summary: params.technical_summary as string | undefined,
        sentiment_summary: params.sentiment_summary as string | undefined,
      };

      // Validate action
      if (!['buy', 'sell', 'hold'].includes(alertParams.action)) {
        return {
          error: 'INVALID_PARAMS',
          message: `Invalid action: "${alertParams.action}". Must be "buy", "sell", or "hold".`,
        } satisfies ToolError;
      }

      const result: DeliverAlertResult = {
        delivered: false,
        channels: [],
        signal_id: 0,
        deduplicated: false,
      };

      // 24h dedup check: same symbol + same action within 24 hours
      const dedupHours = notifyConfig?.dedupHours ?? 24;
      const cutoff = Math.floor(Date.now() / 1000) - dedupHours * 3600;

      try {
        const existing = db.prepare(`
          SELECT id FROM stock_signals
          WHERE symbol = ? AND action = ? AND created_at > ?
          LIMIT 1
        `).get(alertParams.symbol, alertParams.action, cutoff) as any;

        if (existing) {
          result.deduplicated = true;
          result.signal_id = existing.id;
          result.message = `Signal deduplicated: ${alertParams.symbol} ${alertParams.action} was already signaled within ${dedupHours}h`;
          return result;
        }
      } catch (err: any) {
        console.warn(`[stockDeliverAlert] Dedup check failed: ${err.message}`);
      }

      // Save signal to stock_signals table
      try {
        const now = Math.floor(Date.now() / 1000);
        const insertResult = db.prepare(`
          INSERT INTO stock_signals (symbol, action, entry_price, stop_loss, take_profit, reasoning, technical_summary, sentiment_summary, confidence, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          alertParams.symbol,
          alertParams.action,
          alertParams.entry_price,
          alertParams.stop_loss,
          alertParams.take_profit,
          filterSensitiveInfo(alertParams.reasoning),
          alertParams.technical_summary ? filterSensitiveInfo(alertParams.technical_summary) : null,
          alertParams.sentiment_summary ? filterSensitiveInfo(alertParams.sentiment_summary) : null,
          alertParams.confidence,
          now,
        );
        result.signal_id = Number(insertResult.lastInsertRowid);
      } catch (err: any) {
        console.error(`[stockDeliverAlert] DB insert failed: ${err.message}`);
        return {
          error: 'DB_ERROR',
          message: `Failed to save signal: ${err.message}`,
        } satisfies ToolError;
      }

      // Format Signal_Card (with sensitive info filtering applied)
      const signalCardText = formatSignalCard(alertParams);

      // Push via ChannelManager if configured
      if (!channelManager || !notifyConfig?.enabled) {
        result.message = '无推送渠道已配置，信号已保存到本地';
        return result;
      }

      // Send to Telegram
      if (notifyConfig.telegram?.chatId) {
        try {
          await channelManager.sendMessage('telegram', {
            chatId: notifyConfig.telegram.chatId,
            text: signalCardText,
          });
          result.channels.push('telegram');
          result.delivered = true;
        } catch (err: any) {
          console.warn(`[stockDeliverAlert] Telegram push failed: ${err.message}`);
        }
      }

      // Send to Discord
      if (notifyConfig.discord?.channelId) {
        try {
          await channelManager.sendMessage('discord', {
            chatId: notifyConfig.discord.channelId,
            text: signalCardText,
          });
          result.channels.push('discord');
          result.delivered = true;
        } catch (err: any) {
          console.warn(`[stockDeliverAlert] Discord push failed: ${err.message}`);
        }
      }

      // Update notified_at if delivered
      if (result.delivered) {
        try {
          const now = Math.floor(Date.now() / 1000);
          db.prepare(`UPDATE stock_signals SET notified_at = ? WHERE id = ?`).run(now, result.signal_id);
        } catch (err: any) {
          console.warn(`[stockDeliverAlert] Failed to update notified_at: ${err.message}`);
        }
      }

      // If no channels succeeded but signal is saved
      if (!result.delivered && result.signal_id > 0) {
        result.message = '推送失败，信号已保存到本地数据库';
      }

      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory & Registration (Task 2.4)
// ---------------------------------------------------------------------------

/**
 * Create all stock analysis tools with the given dependencies.
 */
export function createStockTools(deps: StockToolsDeps): {
  tools: Tool[];
  register: (executor: ToolExecutor) => void;
} {
  const techTool = createStockTechAnalysisTool(deps.sandbox);
  const sentimentTool = createStockSentimentTool();
  const alertTool = createStockDeliverAlertTool(deps.db, deps.channelManager, deps.notifyConfig);

  const tools = [techTool, sentimentTool, alertTool];

  return {
    tools,
    register: (executor: ToolExecutor) => {
      for (const tool of tools) {
        executor.register(tool);
      }
    },
  };
}

/**
 * Register all stock tools with the given ToolExecutor.
 * Convenience function matching the pattern of registerPolymarketTools.
 */
export function registerStockTools(
  executor: ToolExecutor,
  deps: StockToolsDeps,
): void {
  const { register } = createStockTools(deps);
  register(executor);
}
