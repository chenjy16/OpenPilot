/**
 * StockScanner — scans watchlist stocks, runs AI analysis, saves signals.
 *
 * Follows the PolymarketScanner pattern: decoupled from CronScheduler and
 * API routes — can be called from either.
 *
 * Flow per stock:
 *   1. Call Tech_Analysis_Tool → structured technical indicators
 *   2. Call Market_Sentiment_Tool → structured sentiment data
 *   3. Send both to AIRuntime for comprehensive analysis
 *   4. Parse AI response → StockSignalResult
 *   5. Save to stock_signals table
 */

import type Database from 'better-sqlite3';
import type { AIRuntime } from '../runtime/AIRuntime';
import type { AgentManager } from '../agents/AgentManager';
import { filterSensitiveInfo } from '../tools/stockTools';
import type { TechAnalysisResult, SentimentResult } from '../tools/stockTools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StockScanConfig {
  watchlist: string[];
  model?: string;
  signalThreshold?: number;
}

export interface StockSignalResult {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  reasoning: string;
  confidence: string;
  technical_summary: string;
  sentiment_summary: string;
  outcome: 'pending' | 'hit_tp' | 'hit_sl' | 'expired';
  outcome_at: number | null;
  scores: {
    technical_score: number | null;
    sentiment_score: number | null;
    overall_score: number | null;
  };
}

export interface StockScanResult {
  signals: StockSignalResult[];
  errors: string[];
  durationMs: number;
  scannedCount: number;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

export class StockScanner {
  private db: Database.Database;
  private aiRuntime: AIRuntime;
  private config: StockScanConfig;
  private agentManager?: AgentManager;

  constructor(db: Database.Database, aiRuntime: AIRuntime, config?: StockScanConfig, agentManager?: AgentManager) {
    this.db = db;
    this.aiRuntime = aiRuntime;
    this.config = config ?? { watchlist: [] };
    this.agentManager = agentManager;
  }

  updateConfig(config: Partial<StockScanConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Full scan: iterate watchlist → analyze each stock → save signals → return results.
   * Single-stock failures are caught and recorded; scanning continues.
   */
  async runFullScan(): Promise<StockScanResult> {
    const start = Date.now();
    const errors: string[] = [];
    const signals: StockSignalResult[] = [];

    const watchlist = this.config.watchlist;
    if (watchlist.length === 0) {
      return { signals: [], errors: [], durationMs: Date.now() - start, scannedCount: 0 };
    }

    for (const symbol of watchlist) {
      try {
        const signal = await this.analyzeSingle(symbol);
        signals.push(signal);
      } catch (err: any) {
        errors.push(`${symbol}: ${err.message}`);
      }
    }

    console.log(
      `[StockScanner] Scan complete: ${watchlist.length} stocks, ${signals.length} signals, ${errors.length} errors (${Date.now() - start}ms)`,
    );

    return {
      signals,
      errors,
      durationMs: Date.now() - start,
      scannedCount: watchlist.length,
    };
  }

  /**
   * Analyze a single stock: tech analysis → sentiment → AI judgment → save signal.
   * @param modelOverride — if provided, use this model instead of config/auto-detect
   */
  async analyzeSingle(symbol: string, modelOverride?: string): Promise<StockSignalResult> {
    const upperSymbol = symbol.toUpperCase().trim();

    // 1. Fetch technical analysis data
    const techData = await this.fetchTechAnalysis(upperSymbol);

    // 2. Fetch sentiment data
    const sentimentData = await this.fetchSentiment(upperSymbol);

    // 3. AI comprehensive analysis
    const signal = await this.aiAnalyze(upperSymbol, techData, sentimentData, modelOverride);

    // 4. Save to database
    this.saveSignal(signal);

    return signal;
  }

  // -------------------------------------------------------------------------
  // Data fetching helpers
  // -------------------------------------------------------------------------

  private async fetchTechAnalysis(symbol: string): Promise<TechAnalysisResult | null> {
    try {
      const toolExecutor = (this.aiRuntime as any).toolExecutor;
      if (toolExecutor) {
        const tool = toolExecutor.getTool('stock_tech_analysis');
        if (tool) {
          const result = await tool.execute({ symbol });
          if (result && !result.error) {
            return result as TechAnalysisResult;
          }
          console.warn(`[StockScanner] Tech analysis error for ${symbol}: ${result?.message || 'unknown'}`);
          return null;
        }
      }
    } catch (err: any) {
      console.warn(`[StockScanner] Tech analysis failed for ${symbol}: ${err.message}`);
    }
    return null;
  }

  private async fetchSentiment(symbol: string): Promise<SentimentResult | null> {
    try {
      const toolExecutor = (this.aiRuntime as any).toolExecutor;
      if (toolExecutor) {
        const tool = toolExecutor.getTool('stock_sentiment');
        if (tool) {
          const result = await tool.execute({ symbol });
          if (result && !result.error) {
            return result as SentimentResult;
          }
          console.warn(`[StockScanner] Sentiment error for ${symbol}: ${result?.message || 'unknown'}`);
          return null;
        }
      }
    } catch (err: any) {
      console.warn(`[StockScanner] Sentiment failed for ${symbol}: ${err.message}`);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // AI analysis
  // -------------------------------------------------------------------------

  private async aiAnalyze(
    symbol: string,
    techData: TechAnalysisResult | null,
    sentimentData: SentimentResult | null,
    modelOverride?: string,
  ): Promise<StockSignalResult> {
    // Select model: explicit override > agent config > scanner config > auto-detect
    let model = modelOverride || this.config.model;
    if (!model && this.agentManager) {
      try {
        const quantAgent = await this.agentManager.getAgent('quant-analyst');
        if (quantAgent?.model?.primary) {
          model = quantAgent.model.primary;
        }
      } catch { /* ignore */ }
    }
    if (!model) {
      const modelManager = this.aiRuntime.getModelManager();
      const configured = modelManager.getConfiguredModels();
      model =
        configured.find(m => m.includes('deepseek-reasoner') || m.includes('o1')) ||
        configured.find(m => m.includes('qwen')) ||
        configured.find(m => m.includes('gemini')) ||
        configured[0];
    }

    if (!model) {
      throw new Error('No AI model configured');
    }

    const techSummary = techData ? JSON.stringify(techData) : 'Technical data unavailable';
    const sentimentSummary = sentimentData
      ? JSON.stringify({
          earnings: sentimentData.earnings_summary,
          rating: sentimentData.analyst_rating,
          news: sentimentData.news,
        })
      : 'Sentiment data unavailable';

    const prompt = [
      '你是一位专业的量化分析师。请基于以下 Tool 返回的数据进行综合研判。',
      '必须基于 Tool 返回的数据进行分析，严禁捏造数字。',
      '',
      `股票代码: ${symbol}`,
      '',
      '=== 技术面数据 (Tech_Analysis_Tool) ===',
      techSummary,
      '',
      '=== 消息面数据 (Market_Sentiment_Tool) ===',
      sentimentSummary,
      '',
      '=== 多因子评分框架 ===',
      '请对以下因子进行独立评分（0-100）:',
      '1. technical_score (技术面评分): 基于 RSI、MACD、SMA、布林带、ATR、KDJ 等技术指标综合评估。',
      '   - 趋势方向、动量强度、超买超卖状态、波动率水平等。',
      '2. sentiment_score (消息面评分): 基于新闻情绪、分析师评级、财报数据等综合评估。',
      '   - 市场情绪偏向、分析师共识、近期事件影响等。',
      '3. overall_score (综合评分): 技术面与消息面的加权综合评分。',
      '   - 建议权重: 技术面 60%、消息面 40%，可根据数据可用性调整。',
      '',
      '请分析以上数据，给出交易建议。仅返回以下 JSON 格式，不要包含其他文本:',
      '{',
      '  "action": "buy" | "sell" | "hold",',
      '  "entry_price": <建议入场价>,',
      '  "stop_loss": <止损位>,',
      '  "take_profit": <止盈位>,',
      '  "reasoning": "<分析逻辑，2-3句话>",',
      '  "confidence": "high" | "medium" | "low",',
      '  "scores": {',
      '    "technical_score": <0-100>,',
      '    "sentiment_score": <0-100>,',
      '    "overall_score": <0-100>',
      '  }',
      '}',
    ].join('\n');

    const result = await this.aiRuntime.execute({
      sessionId: `stock-scan-${Date.now()}-${symbol}`,
      message: prompt,
      model,
    });

    // Parse AI response
    let analysis: any = {};
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      }
    } catch { /* parse failure — handled below via defaults */ }

    const action = ['buy', 'sell', 'hold'].includes(analysis.action) ? analysis.action : 'hold';
    const confidence = ['high', 'medium', 'low'].includes(analysis.confidence) ? analysis.confidence : 'low';

    // Extract multi-factor scores from AI response (default to null if not present)
    const rawScores = analysis.scores || {};
    const parseScore = (val: unknown): number | null => {
      const n = Number(val);
      if (val == null || isNaN(n)) return null;
      return Math.max(0, Math.min(100, n));
    };

    return {
      symbol,
      action,
      entry_price: Number(analysis.entry_price) || 0,
      stop_loss: Number(analysis.stop_loss) || 0,
      take_profit: Number(analysis.take_profit) || 0,
      reasoning: filterSensitiveInfo(analysis.reasoning || result.text.slice(0, 500)),
      confidence,
      technical_summary: filterSensitiveInfo(techSummary),
      sentiment_summary: filterSensitiveInfo(sentimentSummary),
      outcome: 'pending',
      outcome_at: null,
      scores: {
        technical_score: parseScore(rawScores.technical_score ?? analysis.technical_score),
        sentiment_score: parseScore(rawScores.sentiment_score ?? analysis.sentiment_score),
        overall_score: parseScore(rawScores.overall_score ?? analysis.overall_score),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Signal persistence
  // -------------------------------------------------------------------------

  private saveSignal(signal: StockSignalResult): void {
      try {
        this.db.prepare(`
          INSERT INTO stock_signals (symbol, action, entry_price, stop_loss, take_profit, reasoning, technical_summary, sentiment_summary, confidence, outcome, technical_score, sentiment_score, overall_score, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          signal.symbol,
          signal.action,
          signal.entry_price,
          signal.stop_loss,
          signal.take_profit,
          signal.reasoning,
          signal.technical_summary,
          signal.sentiment_summary,
          signal.confidence,
          signal.outcome,
          signal.scores.technical_score,
          signal.scores.sentiment_score,
          signal.scores.overall_score,
          Math.floor(Date.now() / 1000),
        );
      } catch (err: any) {
        console.warn(`[StockScanner] Failed to save signal for ${signal.symbol}: ${err.message}`);
      }
    }
}
