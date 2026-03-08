/**
 * PolymarketScanner — scans Gamma API, runs AI analysis, saves signals.
 *
 * Decoupled from CronScheduler and API routes — can be called from either.
 * Uses a single Analyst prompt (no multi-agent for MVP).
 */

import type Database from 'better-sqlite3';
import type { AIRuntime } from '../runtime/AIRuntime';

const GAMMA_API = 'https://gamma-api.polymarket.com';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanConfig {
  gammaApiUrl?: string;
  scanLimit?: number;
  minVolume?: number;
  signalThreshold?: number;
  /** Override model for AI analysis (e.g. 'qwen/qwen3.5-flash') */
  model?: string;
}

export interface MarketSnapshot {
  id: string;
  conditionId: string;
  question: string;
  slug: string;
  yesPrice: number;
  noPrice: number;
  probability: number;
  volume: number;
  volume24hr: number;
  liquidity: number;
  endDate: string | null;
  tags: string[];
  active: boolean;
}

export interface SignalResult {
  marketId: string;
  question: string;
  marketProbability: number;
  aiProbability: number;
  edge: number;
  confidence: string;
  reasoning: string;
  isOpportunity: boolean;
}

export interface ScanResult {
  markets: MarketSnapshot[];
  signals: SignalResult[];
  opportunities: SignalResult[];
  errors: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

export class PolymarketScanner {
  private db: Database.Database;
  private aiRuntime: AIRuntime;
  private config: ScanConfig;

  constructor(db: Database.Database, aiRuntime: AIRuntime, config?: ScanConfig) {
    this.db = db;
    this.aiRuntime = aiRuntime;
    this.config = config ?? {};
  }

  updateConfig(config: Partial<ScanConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Full scan: fetch markets → AI analyze each → save signals → return results.
   */
  async runFullScan(): Promise<ScanResult> {
    const start = Date.now();
    const errors: string[] = [];

    // 1. Fetch trending markets
    let markets: MarketSnapshot[];
    try {
      markets = await this.fetchTrendingMarkets();
    } catch (err: any) {
      return { markets: [], signals: [], opportunities: [], errors: [`Gamma API: ${err.message}`], durationMs: Date.now() - start };
    }

    if (markets.length === 0) {
      return { markets, signals: [], opportunities: [], errors: [], durationMs: Date.now() - start };
    }

    // 2. Analyze each market with AI
    const signals: SignalResult[] = [];
    const threshold = this.config.signalThreshold ?? 0.05;

    for (const market of markets) {
      try {
        const signal = await this.analyzeMarket(market);
        signals.push(signal);

        // 3. Save to database
        this.saveSignal(signal);
      } catch (err: any) {
        errors.push(`Analyze ${market.question.slice(0, 50)}: ${err.message}`);
      }
    }

    const opportunities = signals.filter(s => Math.abs(s.edge) >= threshold);

    console.log(
      `[PolymarketScanner] Scan complete: ${markets.length} markets, ${signals.length} signals, ${opportunities.length} opportunities (${Date.now() - start}ms)`,
    );

    return {
      markets,
      signals,
      opportunities,
      errors,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Fetch trending markets from Gamma API.
   */
  async fetchTrendingMarkets(): Promise<MarketSnapshot[]> {
    const gammaUrl = this.config.gammaApiUrl ?? GAMMA_API;
    const limit = this.config.scanLimit ?? 10;
    const minVolume = this.config.minVolume ?? 50000;

    const url = new URL('/markets', gammaUrl);
    url.searchParams.set('limit', String(Math.min(limit * 3, 100)));
    url.searchParams.set('order', 'volume24hr');
    url.searchParams.set('ascending', 'false');
    url.searchParams.set('active', 'true');
    url.searchParams.set('closed', 'false');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const resp = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`Gamma API ${resp.status}`);
      const data = await resp.json();

      return (Array.isArray(data) ? data : [])
        .filter((m: any) => Number(m.volumeNum ?? m.volume ?? 0) >= minVolume)
        .slice(0, limit)
        .map((m: any) => this.parseMarket(m));
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Analyze a single market using AI.
   */
  async analyzeMarket(market: MarketSnapshot): Promise<SignalResult> {
    // Use configured model override, or auto-detect
    let model = this.config.model;
    if (!model) {
      const modelManager = this.aiRuntime.getModelManager();
      const configured = modelManager.getConfiguredModels();
      // Prefer qwen (user's working model), then gemini (working key), then reasoning models
      model =
        configured.find(m => m.includes('qwen')) ||
        configured.find(m => m.includes('gemini-2.0-flash') || m.includes('gemini-2.5-flash')) ||
        configured.find(m => m.includes('deepseek-reasoner') || m.includes('o3')) ||
        configured[0];
    }

    if (!model) {
      throw new Error('No AI model configured');
    }

    const prompt = [
      'You are a quantitative analyst evaluating a prediction market.',
      'Analyze the following market and provide your probability estimate.',
      'Use your knowledge of current events to assess the true probability.',
      '',
      `Market Question: ${market.question}`,
      `Current Market Probability (YES): ${(market.probability * 100).toFixed(1)}%`,
      `Trading Volume: $${market.volume.toLocaleString()}`,
      `24h Volume: $${market.volume24hr.toLocaleString()}`,
      market.endDate ? `End Date: ${market.endDate}` : '',
      '',
      'Respond in this exact JSON format only, no other text:',
      '{',
      '  "aiProbability": <your estimated probability 0-1>,',
      '  "confidence": "high" | "medium" | "low",',
      '  "reasoning": "<your analysis in 2-3 sentences>"',
      '}',
    ].filter(Boolean).join('\n');

    const result = await this.aiRuntime.execute({
      sessionId: `polyoracle-scan-${Date.now()}-${market.id}`,
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
    } catch { /* parse failure */ }

    const aiProb = Number(analysis.aiProbability) || 0;
    const edge = aiProb - market.probability;
    const threshold = this.config.signalThreshold ?? 0.05;

    return {
      marketId: market.id,
      question: market.question,
      marketProbability: market.probability,
      aiProbability: aiProb,
      edge,
      confidence: analysis.confidence || 'unknown',
      reasoning: analysis.reasoning || result.text.slice(0, 500),
      isOpportunity: Math.abs(edge) >= threshold,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private parseMarket(m: any): MarketSnapshot {
    let yesPrice = 0;
    let noPrice = 0;
    if (m.outcomePrices) {
      const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
      yesPrice = Number(prices[0]) || 0;
      noPrice = Number(prices[1]) || 0;
    }
    return {
      id: m.id ?? m.conditionId,
      conditionId: m.conditionId,
      question: m.question,
      slug: m.slug,
      yesPrice,
      noPrice,
      probability: yesPrice,
      volume: Number(m.volumeNum ?? m.volume ?? 0),
      volume24hr: Number(m.volume24hr ?? 0),
      liquidity: Number(m.liquidityNum ?? m.liquidity ?? 0),
      endDate: m.endDate ?? m.endDateIso ?? null,
      tags: m.tags ?? [],
      active: m.active ?? !m.closed,
    };
  }

  private saveSignal(signal: SignalResult): void {
    try {
      this.db.prepare(`
        INSERT INTO market_signals (market_id, question, market_probability, ai_probability, edge, confidence, reasoning, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        signal.marketId,
        signal.question,
        signal.marketProbability,
        signal.aiProbability,
        signal.edge,
        signal.confidence,
        signal.reasoning,
        Math.floor(Date.now() / 1000),
      );
    } catch (err: any) {
      console.warn(`[PolymarketScanner] Failed to save signal: ${err.message}`);
    }
  }
}
