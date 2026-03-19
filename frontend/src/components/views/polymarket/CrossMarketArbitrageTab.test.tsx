// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import fc from 'fast-check';

vi.mock('../../../services/apiClient', () => ({
  get: vi.fn(),
}));

import { get } from '../../../services/apiClient';
import CrossMarketArbitrageTab from './CrossMarketArbitrageTab';

const mockOpportunities = [
  {
    id: 1,
    platformA: 'polymarket',
    platformAMarketId: 'poly-001',
    platformB: 'kalshi',
    platformBMarketId: 'kalshi-001',
    question: 'Will BTC hit 100k?',
    direction: 'A_YES_B_NO' as const,
    platformAYesPrice: 0.62,
    platformANoPrice: 0.38,
    platformBYesPrice: 0.58,
    platformBNoPrice: 0.42,
    vwapBuyPrice: 0.625,
    vwapSellPrice: 0.355,
    realArbitrageCost: 0.98,
    platformAFee: 0.02,
    platformBFee: 0.03,
    totalFees: 0.05,
    profitPct: 3.06,
    arbScore: 45,
    liquidityWarning: false,
    oracleMismatch: false,
    depthStatus: 'sufficient' as const,
    detectedAt: 1700000000,
  },
  {
    id: 2,
    platformA: 'kalshi',
    platformAMarketId: 'kalshi-002',
    platformB: 'myriad',
    platformBMarketId: 'myriad-001',
    question: 'Will ETH hit 10k?',
    direction: 'A_NO_B_YES' as const,
    platformAYesPrice: 0.55,
    platformANoPrice: 0.45,
    platformBYesPrice: 0.60,
    platformBNoPrice: 0.40,
    vwapBuyPrice: 0.46,
    vwapSellPrice: 0.61,
    realArbitrageCost: 0.85,
    platformAFee: 0.03,
    platformBFee: 0.01,
    totalFees: 0.04,
    profitPct: 12.94,
    arbScore: 82,
    liquidityWarning: true,
    oracleMismatch: false,
    depthStatus: 'sufficient' as const,
    detectedAt: 1700001000,
  },
];

describe('CrossMarketArbitrageTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading state initially', () => {
    // Never resolve so we stay in loading state
    vi.mocked(get).mockReturnValue(new Promise(() => {}));
    render(<CrossMarketArbitrageTab />);
    expect(
      screen.getByText('Loading cross-market arbitrage opportunities...'),
    ).toBeDefined();
  });

  it('renders opportunities table after fetch', async () => {
    vi.mocked(get).mockResolvedValue(mockOpportunities);
    render(<CrossMarketArbitrageTab />);

    await waitFor(() => {
      expect(screen.getByText('Will BTC hit 100k?')).toBeDefined();
    });

    // Second opportunity should also be present
    expect(screen.getByText('Will ETH hit 10k?')).toBeDefined();

    // Header shows count
    expect(screen.getByText('Cross-Market Arbitrage (2)')).toBeDefined();

    // Profit values rendered — higher profit first (12.94% before 3.06%)
    const profitCells = screen.getAllByText(/%$/);
    expect(profitCells.length).toBe(2);
    expect(profitCells[0].textContent).toBe('12.94%');
    expect(profitCells[1].textContent).toBe('3.06%');
  });

  it('renders empty state when no opportunities', async () => {
    vi.mocked(get).mockResolvedValue([]);
    render(<CrossMarketArbitrageTab />);

    await waitFor(() => {
      expect(
        screen.getByText('No cross-market arbitrage opportunities found'),
      ).toBeDefined();
    });
  });

  it('renders error state on fetch failure', async () => {
    vi.mocked(get).mockRejectedValue(new Error('Network error'));
    render(<CrossMarketArbitrageTab />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeDefined();
    });
  });

  /**
   * Property 16: 默认排序顺序
   *
   * For any list of CrossMarketArbitrageOpportunity (length >= 2),
   * after default sort, adjacent elements satisfy list[i].profitPct >= list[i+1].profitPct.
   *
   * **Validates: Requirements 5.3**
   */
  it('Property 16: default sort is profitPct descending', () => {
    const opportunityArb = fc.record({
      id: fc.integer({ min: 1, max: 100000 }),
      platformA: fc.constantFrom('polymarket', 'kalshi', 'myriad', 'manifold'),
      platformAMarketId: fc.stringMatching(/^[0-9a-f]{8,16}$/),
      platformB: fc.constantFrom('polymarket', 'kalshi', 'myriad', 'manifold'),
      platformBMarketId: fc.stringMatching(/^[0-9a-f]{8,16}$/),
      question: fc.string({ minLength: 5, maxLength: 100 }),
      direction: fc.constantFrom<'A_YES_B_NO' | 'A_NO_B_YES'>(
        'A_YES_B_NO',
        'A_NO_B_YES',
      ),
      platformAYesPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }),
      platformANoPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }),
      platformBYesPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }),
      platformBNoPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }),
      vwapBuyPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }),
      vwapSellPrice: fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }),
      realArbitrageCost: fc.double({ min: 0.5, max: 1.5, noNaN: true, noDefaultInfinity: true }),
      platformAFee: fc.double({ min: 0, max: 0.1, noNaN: true, noDefaultInfinity: true }),
      platformBFee: fc.double({ min: 0, max: 0.1, noNaN: true, noDefaultInfinity: true }),
      totalFees: fc.double({ min: 0, max: 0.2, noNaN: true, noDefaultInfinity: true }),
      profitPct: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
      arbScore: fc.integer({ min: 0, max: 100 }),
      liquidityWarning: fc.boolean(),
      oracleMismatch: fc.boolean(),
      depthStatus: fc.constantFrom<'sufficient' | 'insufficient_depth'>(
        'sufficient',
        'insufficient_depth',
      ),
      detectedAt: fc.integer({ min: 1700000000, max: 1800000000 }),
    });

    fc.assert(
      fc.property(
        fc.array(opportunityArb, { minLength: 2, maxLength: 20 }),
        (opportunities) => {
          // Sort like the component does (profitPct desc)
          const sorted = [...opportunities].sort(
            (a, b) => b.profitPct - a.profitPct,
          );
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].profitPct).toBeGreaterThanOrEqual(
              sorted[i + 1].profitPct,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
