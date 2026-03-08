/**
 * Polymarket Tools — PolyOracle MVP
 *
 * Three read-only tools for scanning and analyzing prediction markets:
 *   - polymarket_trending: Get trending markets from Gamma API
 *   - polymarket_market_detail: Get market price/probability details
 *   - polymarket_analyze: (internal) Trigger AI analysis pipeline
 *
 * No trading functionality — MVP is analysis-only.
 */

import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';

const GAMMA_API = 'https://gamma-api.polymarket.com';

// ---------------------------------------------------------------------------
// Helper: fetch with timeout
// ---------------------------------------------------------------------------

async function gammaFetch(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(path, GAMMA_API);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Gamma API ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Tool 1: polymarket_trending
// ---------------------------------------------------------------------------

export const polymarketTrendingTool: Tool = {
  name: 'polymarket_trending',
  description:
    'Get trending prediction markets from Polymarket, sorted by volume. ' +
    'Returns market questions, current probabilities, volume, and liquidity.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of markets to return (default: 10, max: 50)',
      },
      tag: {
        type: 'string',
        description: 'Filter by tag/category (e.g. "politics", "crypto", "sports")',
      },
      active: {
        type: 'boolean',
        description: 'Only return active (not resolved) markets. Default: true',
      },
    },
  },
  execute: async (params: Record<string, unknown>) => {
    const limit = Math.min(Number(params.limit) || 10, 50);
    const active = params.active !== false;

    const queryParams: Record<string, string> = {
      limit: String(limit),
      order: 'volume24hr',
      ascending: 'false',
      closed: 'false',
    };

    if (active) {
      queryParams.active = 'true';
    }
    if (params.tag) {
      queryParams.tag = String(params.tag);
    }

    const data = await gammaFetch('/markets', queryParams);

    // Normalize response
    const markets = (Array.isArray(data) ? data : []).map((m: any) => ({
      id: m.id ?? m.conditionId,
      conditionId: m.conditionId,
      question: m.question,
      slug: m.slug,
      volume: m.volume ?? m.volumeNum ?? 0,
      volume24hr: m.volume24hr ?? 0,
      liquidity: m.liquidity ?? m.liquidityNum ?? 0,
      endDate: m.endDate ?? m.endDateIso,
      active: m.active ?? !m.closed,
      outcomes: m.outcomes ?? ['Yes', 'No'],
      outcomePrices: m.outcomePrices
        ? (typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices)
        : null,
      tags: m.tags ?? [],
    }));

    return {
      count: markets.length,
      markets,
    };
  },
};

// ---------------------------------------------------------------------------
// Tool 2: polymarket_market_detail
// ---------------------------------------------------------------------------

export const polymarketMarketDetailTool: Tool = {
  name: 'polymarket_market_detail',
  description:
    'Get detailed information about a specific Polymarket prediction market, ' +
    'including current YES/NO prices, volume, liquidity, and resolution criteria.',
  parameters: {
    type: 'object',
    properties: {
      conditionId: {
        type: 'string',
        description: 'The market condition ID (from polymarket_trending results)',
      },
      slug: {
        type: 'string',
        description: 'The market slug (alternative to conditionId)',
      },
    },
  },
  execute: async (params: Record<string, unknown>) => {
    const conditionId = params.conditionId as string | undefined;
    const slug = params.slug as string | undefined;

    if (!conditionId && !slug) {
      throw new Error('Either conditionId or slug is required');
    }

    let market: any;
    if (slug) {
      const data = await gammaFetch(`/markets/${slug}`);
      market = data;
    } else {
      // Search by conditionId
      const data = await gammaFetch('/markets', { id: conditionId! });
      market = Array.isArray(data) ? data[0] : data;
    }

    if (!market) {
      throw new Error(`Market not found: ${conditionId || slug}`);
    }

    // Parse outcome prices
    let yesPrice = 0;
    let noPrice = 0;
    if (market.outcomePrices) {
      const prices = typeof market.outcomePrices === 'string'
        ? JSON.parse(market.outcomePrices)
        : market.outcomePrices;
      yesPrice = Number(prices[0]) || 0;
      noPrice = Number(prices[1]) || 0;
    }

    return {
      id: market.id ?? market.conditionId,
      conditionId: market.conditionId,
      question: market.question,
      description: market.description,
      slug: market.slug,
      yesPrice,
      noPrice,
      probability: yesPrice, // YES price = implied probability
      volume: market.volume ?? market.volumeNum ?? 0,
      volume24hr: market.volume24hr ?? 0,
      liquidity: market.liquidity ?? market.liquidityNum ?? 0,
      startDate: market.startDate ?? market.startDateIso,
      endDate: market.endDate ?? market.endDateIso,
      active: market.active ?? !market.closed,
      resolved: market.resolved ?? false,
      outcomes: market.outcomes ?? ['Yes', 'No'],
      tags: market.tags ?? [],
      resolutionSource: market.resolutionSource,
    };
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPolymarketTools(executor: ToolExecutor): void {
  executor.register(polymarketTrendingTool);
  executor.register(polymarketMarketDetailTool);
}
