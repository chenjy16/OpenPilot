import { useState, useEffect, useCallback } from 'react';
import { get } from '../../../services/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArbitrageTabProps {
  onTradeOpportunity?: (opportunity: { token_id: string; price: number; side: 'BUY' | 'SELL' }) => void;
}

interface ArbitrageOpportunity {
  market_id: string;
  question: string;
  yes_price: number;
  no_price: number;
  sum: number;
  deviation: number;
  profit_pct: number;
  best_bid_yes: number;
  best_ask_yes: number;
  best_bid_no: number;
  best_ask_no: number;
  spread_yes: number;
  spread_no: number;
}

// ---------------------------------------------------------------------------
// ArbitrageTab
// ---------------------------------------------------------------------------

const ArbitrageTab: React.FC<ArbitrageTabProps> = ({ onTradeOpportunity }) => {
  const [opportunities, setOpportunities] = useState<ArbitrageOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOpportunities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<ArbitrageOpportunity[]>('/polymarket/arbitrage');
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

  const handleTradeClick = (opp: ArbitrageOpportunity) => {
    if (!onTradeOpportunity) return;

    // If sum < 1.0, buy the cheaper side; if sum > 1.0, sell the more expensive side
    if (opp.sum < 1.0) {
      // Buy the cheaper outcome
      const buyYes = opp.yes_price <= opp.no_price;
      onTradeOpportunity({
        token_id: opp.market_id + (buyYes ? '_yes' : '_no'),
        price: buyYes ? opp.yes_price : opp.no_price,
        side: 'BUY',
      });
    } else {
      // Sell the more expensive outcome
      const sellYes = opp.yes_price >= opp.no_price;
      onTradeOpportunity({
        token_id: opp.market_id + (sellYes ? '_yes' : '_no'),
        price: sellYes ? opp.yes_price : opp.no_price,
        side: 'SELL',
      });
    }
  };

  const profitColor = (pct: number): string => {
    if (pct >= 5) return 'text-green-700 bg-green-100';
    if (pct >= 2) return 'text-green-600 bg-green-50';
    return 'text-yellow-700 bg-yellow-50';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Arbitrage Opportunities ({opportunities.length})
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
        <p className="text-sm text-gray-400">Loading arbitrage opportunities...</p>
      )}

      {/* Empty state */}
      {!loading && opportunities.length === 0 && !error && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl">⚖️</div>
          <p className="text-sm text-gray-500">No arbitrage opportunities found</p>
          <p className="mt-1 text-xs text-gray-400">
            Markets are efficiently priced. Check back later or adjust the detection threshold.
          </p>
        </div>
      )}

      {/* Opportunities list */}
      {opportunities.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="pb-2 pr-4">Market</th>
                  <th className="pb-2 pr-4 text-right">Yes Price</th>
                  <th className="pb-2 pr-4 text-right">No Price</th>
                  <th className="pb-2 pr-4 text-right">Sum</th>
                  <th className="pb-2 pr-4 text-right">Deviation</th>
                  <th className="pb-2 pr-4 text-right">Profit %</th>
                  <th className="pb-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((opp, i) => (
                  <tr
                    key={`${opp.market_id}-${i}`}
                    className="group border-b border-gray-50 hover:bg-gray-50"
                  >
                    <td className="max-w-[240px] py-2 pr-4">
                      <div className="truncate text-xs font-medium text-gray-800" title={opp.question}>
                        {opp.question}
                      </div>
                      {/* Spread info as secondary row */}
                      <div className="mt-0.5 text-xs text-gray-400" title={`Yes spread: ${opp.spread_yes.toFixed(4)} | No spread: ${opp.spread_no.toFixed(4)}`}>
                        Spread: Y {opp.spread_yes.toFixed(3)} / N {opp.spread_no.toFixed(3)}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right text-xs">{opp.yes_price.toFixed(3)}</td>
                    <td className="py-2 pr-4 text-right text-xs">{opp.no_price.toFixed(3)}</td>
                    <td className={`py-2 pr-4 text-right text-xs font-medium ${
                      opp.sum < 1.0 ? 'text-blue-600' : 'text-orange-600'
                    }`}>
                      {opp.sum.toFixed(3)}
                    </td>
                    <td className="py-2 pr-4 text-right text-xs">{opp.deviation.toFixed(4)}</td>
                    <td className="py-2 pr-4 text-right">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${profitColor(opp.profit_pct)}`}>
                        {opp.profit_pct.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleTradeClick(opp)}
                        disabled={!onTradeOpportunity}
                        className="rounded-md bg-purple-500 px-2 py-1 text-xs text-white hover:bg-purple-600 disabled:opacity-50"
                        title={opp.sum < 1.0 ? 'Buy the cheaper side' : 'Sell the more expensive side'}
                      >
                        Trade
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info hint */}
      {opportunities.length > 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
          Opportunities are sorted by profit percentage (highest first). Click "Trade" to pre-fill the order form on the Trading tab.
          Sum &lt; 1.0 suggests buying the cheaper side; Sum &gt; 1.0 suggests selling the more expensive side.
        </div>
      )}
    </div>
  );
};

export default ArbitrageTab;
