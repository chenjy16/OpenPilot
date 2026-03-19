import { useState, useEffect, useCallback } from 'react';
import { get } from '../../../services/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrossMarketArbitrageOpportunity {
  id?: number;
  platformA: string;
  platformAMarketId: string;
  platformB: string;
  platformBMarketId: string;
  question: string;
  direction: 'A_YES_B_NO' | 'A_NO_B_YES';
  platformAYesPrice: number;
  platformANoPrice: number;
  platformBYesPrice: number;
  platformBNoPrice: number;
  vwapBuyPrice: number;
  vwapSellPrice: number;
  realArbitrageCost: number;
  platformAFee: number;
  platformBFee: number;
  totalFees: number;
  profitPct: number;
  arbScore: number;
  liquidityWarning: boolean;
  oracleMismatch: boolean;
  depthStatus: 'sufficient' | 'insufficient_depth';
  detectedAt: number;
}

type SortKey = keyof Pick<
  CrossMarketArbitrageOpportunity,
  | 'platformA'
  | 'platformB'
  | 'question'
  | 'vwapBuyPrice'
  | 'vwapSellPrice'
  | 'realArbitrageCost'
  | 'profitPct'
  | 'arbScore'
  | 'liquidityWarning'
>;

type SortDirection = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function directionLabel(d: 'A_YES_B_NO' | 'A_NO_B_YES'): string {
  return d === 'A_YES_B_NO' ? 'A→Yes / B→No' : 'A→No / B→Yes';
}

function profitColor(pct: number): string {
  if (pct >= 5) return 'text-green-700 bg-green-100';
  if (pct >= 2) return 'text-green-600 bg-green-50';
  return 'text-yellow-700 bg-yellow-50';
}

function arbScoreColor(score: number): string {
  if (score >= 70) return 'text-green-700';
  if (score >= 40) return 'text-yellow-700';
  return 'text-red-600';
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'platformA', label: 'Platform A', align: 'left' },
  { key: 'platformB', label: 'Platform B', align: 'left' },
  { key: 'question', label: 'Question', align: 'left' },
  { key: 'vwapBuyPrice', label: 'A Yes Price (VWAP)', align: 'right' },
  { key: 'vwapSellPrice', label: 'B No Price (VWAP)', align: 'right' },
  { key: 'realArbitrageCost', label: 'Arbitrage Cost', align: 'right' },
  { key: 'profitPct', label: 'Profit %', align: 'right' },
  { key: 'arbScore', label: 'Arb Score', align: 'right' },
  { key: 'liquidityWarning', label: 'Liquidity Status', align: 'left' },
];

// ---------------------------------------------------------------------------
// CrossMarketArbitrageTab
// ---------------------------------------------------------------------------

const CrossMarketArbitrageTab: React.FC = () => {
  const [opportunities, setOpportunities] = useState<CrossMarketArbitrageOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('profitPct');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const fetchOpportunities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<CrossMarketArbitrageOpportunity[]>('/cross-market/arbitrage');
      setOpportunities(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  // Sorting
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const sorted = [...opportunities].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    let cmp = 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      cmp = aVal.localeCompare(bVal);
    } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
      cmp = Number(aVal) - Number(bVal);
    } else {
      cmp = (aVal as number) - (bVal as number);
    }
    return sortDirection === 'asc' ? cmp : -cmp;
  });

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Cross-Market Arbitrage ({opportunities.length})
        </h2>
        <button
          onClick={fetchOpportunities}
          disabled={loading}
          className="rounded-md bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && opportunities.length === 0 && (
        <p className="text-sm text-gray-400">Loading cross-market arbitrage opportunities...</p>
      )}

      {/* Empty state */}
      {!loading && opportunities.length === 0 && !error && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl">🌐</div>
          <p className="text-sm text-gray-500">No cross-market arbitrage opportunities found</p>
          <p className="mt-1 text-xs text-gray-400">
            Prices across platforms are aligned. Check back later or adjust detection thresholds.
          </p>
        </div>
      )}

      {/* Opportunities table */}
      {sorted.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`cursor-pointer select-none pb-2 pr-4 ${
                        col.align === 'right' ? 'text-right' : ''
                      }`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}{sortIndicator(col.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((opp, i) => (
                  <tr
                    key={`${opp.platformA}-${opp.platformAMarketId}-${opp.platformB}-${opp.platformBMarketId}-${i}`}
                    className="group border-b border-gray-50 hover:bg-gray-50"
                  >
                    <td className="py-2 pr-4 text-xs font-medium text-gray-800">
                      {capitalize(opp.platformA)}
                    </td>
                    <td className="py-2 pr-4 text-xs font-medium text-gray-800">
                      {capitalize(opp.platformB)}
                    </td>
                    <td className="max-w-[240px] py-2 pr-4">
                      <div className="truncate text-xs font-medium text-gray-800" title={opp.question}>
                        {opp.question}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {directionLabel(opp.direction)}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right text-xs">
                      {opp.platformAYesPrice.toFixed(3)}
                      <span className="ml-1 text-gray-400">({opp.vwapBuyPrice.toFixed(3)})</span>
                    </td>
                    <td className="py-2 pr-4 text-right text-xs">
                      {opp.platformBNoPrice.toFixed(3)}
                      <span className="ml-1 text-gray-400">({opp.vwapSellPrice.toFixed(3)})</span>
                    </td>
                    <td className="py-2 pr-4 text-right text-xs font-medium">
                      {opp.realArbitrageCost.toFixed(4)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${profitColor(opp.profitPct)}`}>
                        {opp.profitPct.toFixed(2)}%
                      </span>
                    </td>
                    <td className={`py-2 pr-4 text-right text-xs font-medium ${arbScoreColor(opp.arbScore)}`}>
                      {opp.arbScore}
                    </td>
                    <td className="py-2 text-xs">
                      {opp.liquidityWarning ? (
                        <span className="text-yellow-600" title="Low liquidity warning">⚠️ Warning</span>
                      ) : (
                        <span className="text-green-600">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info hint */}
      {sorted.length > 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
          Cross-market opportunities compare prices across Polymarket, Kalshi, and Myriad.
          Default sort is by profit percentage (highest first). Click column headers to change sort order.
        </div>
      )}
    </div>
  );
};

export default CrossMarketArbitrageTab;
