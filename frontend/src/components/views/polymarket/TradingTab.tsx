import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post, del } from '../../../services/apiClient';
import { ApiError } from '../../../services/apiClient';
import { useUIStore } from '../../../stores/uiStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TradingTabProps {
  onNavigateToArbitrage?: () => void;
  prefillOrder?: { token_id: string; price: number; side: 'BUY' | 'SELL' } | null;
}

interface Position {
  market_question: string;
  token_id: string;
  outcome: 'Yes' | 'No';
  size: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pnl: number;
}

interface Trade {
  timestamp: number;
  market_question: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  fee: number;
}

interface OpenOrder {
  order_id: string;
  token_id: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  status: string;
  created_at: number;
}

// ---------------------------------------------------------------------------
// TradingTab
// ---------------------------------------------------------------------------

const TradingTab: React.FC<TradingTabProps> = ({ prefillOrder }) => {
  const { t: _t } = useTranslation();

  // Trading status
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Positions
  const [positions, setPositions] = useState<Position[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(false);

  // Open orders
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [loadingOrders] = useState(false);

  // Trade history
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradeOffset, setTradeOffset] = useState(0);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const TRADE_PAGE_SIZE = 50;

  // Order form
  const [tokenId, setTokenId] = useState('');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState(0.5);
  const [size, setSize] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<string | null>(null);

  // Cancellation loading
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelingAll, setCancelingAll] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Check trading status ───────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    try {
      const data = await get<{ configured: boolean }>('/polymarket/trading-status');
      setConfigured(data.configured);
    } catch {
      setConfigured(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // ── Data fetchers ──────────────────────────────────────────────────

  const fetchPositions = useCallback(async () => {
    setLoadingPositions(true);
    try {
      const data = await get<Position[]>('/polymarket/positions');
      setPositions(data);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 503)) {
        setError((err as Error).message);
      }
    } finally {
      setLoadingPositions(false);
    }
  }, []);



  const fetchTrades = useCallback(async (offset: number) => {
    setLoadingTrades(true);
    try {
      const data = await get<Trade[]>(`/polymarket/trades?limit=${TRADE_PAGE_SIZE}&offset=${offset}`);
      setTrades(data);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 503)) {
        setError((err as Error).message);
      }
    } finally {
      setLoadingTrades(false);
    }
  }, []);

  // ── Initial load & auto-refresh ────────────────────────────────────

  useEffect(() => {
    if (configured !== true) return;

    fetchPositions();
    fetchTrades(0);

    intervalRef.current = setInterval(() => {
      fetchPositions();
    }, 30_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [configured, fetchPositions, fetchTrades]);

  // ── Prefill from arbitrage ─────────────────────────────────────────

  useEffect(() => {
    if (prefillOrder) {
      setTokenId(prefillOrder.token_id);
      setPrice(prefillOrder.price);
      setSide(prefillOrder.side);
    }
  }, [prefillOrder]);

  // ── Order submission ───────────────────────────────────────────────

  const handleSubmitOrder = async () => {
    setError(null);
    setOrderResult(null);

    const sizeNum = parseFloat(size);
    if (!tokenId.trim()) {
      setError('Token ID is required');
      return;
    }
    if (isNaN(sizeNum) || sizeNum <= 0) {
      setError('Size must be a positive number');
      return;
    }

    setSubmitting(true);
    try {
      const result = await post<{ order_id: string; status: string }>('/polymarket/order', {
        token_id: tokenId.trim(),
        side,
        price,
        size: sizeNum,
      });
      setOrderResult(`Order placed: ${result.order_id} (${result.status})`);
      // Add to local open orders list
      setOpenOrders(prev => [
        {
          order_id: result.order_id,
          token_id: tokenId.trim(),
          side,
          price,
          size: sizeNum,
          status: result.status,
          created_at: Date.now(),
        },
        ...prev,
      ]);
      // Refresh positions after order
      setTimeout(() => fetchPositions(), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Cancel order ───────────────────────────────────────────────────

  const handleCancelOrder = async (orderId: string) => {
    setCancelingId(orderId);
    try {
      await del(`/polymarket/order/${orderId}`);
      setOpenOrders(prev => prev.filter(o => o.order_id !== orderId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancelingId(null);
    }
  };

  const handleCancelAll = async () => {
    setCancelingAll(true);
    try {
      await del('/polymarket/orders');
      setOpenOrders([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancelingAll(false);
    }
  };

  // ── Pagination ─────────────────────────────────────────────────────

  const handlePrevPage = () => {
    const newOffset = Math.max(0, tradeOffset - TRADE_PAGE_SIZE);
    setTradeOffset(newOffset);
    fetchTrades(newOffset);
  };

  const handleNextPage = () => {
    const newOffset = tradeOffset + TRADE_PAGE_SIZE;
    setTradeOffset(newOffset);
    fetchTrades(newOffset);
  };

  // ── Not configured → setup guide ──────────────────────────────────

  if (configured === null) {
    return <div className="flex items-center justify-center py-12 text-gray-400">Loading...</div>;
  }

  if (!configured) {
    return <SetupGuide onRetry={checkStatus} />;
  }

  // ── Main trading UI ────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {orderResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {orderResult}
          <button onClick={() => setOrderResult(null)} className="ml-2 text-green-400 hover:text-green-600">✕</button>
        </div>
      )}

      {/* Order Form */}
      <OrderForm
        tokenId={tokenId}
        side={side}
        price={price}
        size={size}
        submitting={submitting}
        onTokenIdChange={setTokenId}
        onSideChange={setSide}
        onPriceChange={setPrice}
        onSizeChange={setSize}
        onSubmit={handleSubmitOrder}
      />

      {/* Open Orders */}
      <OpenOrdersSection
        orders={openOrders}
        loading={loadingOrders}
        cancelingId={cancelingId}
        cancelingAll={cancelingAll}
        onCancel={handleCancelOrder}
        onCancelAll={handleCancelAll}
      />

      {/* Positions */}
      <PositionsSection positions={positions} loading={loadingPositions} onRefresh={fetchPositions} />

      {/* Trade History */}
      <TradeHistorySection
        trades={trades}
        loading={loadingTrades}
        offset={tradeOffset}
        pageSize={TRADE_PAGE_SIZE}
        onPrev={handlePrevPage}
        onNext={handleNextPage}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Setup Guide (shown when POLYMARKET_PRIVATE_KEY is not configured)
// ---------------------------------------------------------------------------

const SetupGuide: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { t: _t } = useTranslation();
  const { setActiveTab } = useUIStore();

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
      <div className="mb-3 text-3xl">🔑</div>
      <h3 className="mb-2 text-lg font-semibold text-amber-800">Trading Not Configured</h3>
      <p className="mb-4 text-sm text-amber-700">
        To enable Polymarket trading, set the <code className="rounded bg-amber-100 px-1 py-0.5 text-xs font-mono">POLYMARKET_PRIVATE_KEY</code> with your EOA wallet private key.
      </p>
      <div className="mb-4 flex justify-center gap-2">
        <button
          onClick={() => setActiveTab('config')}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 transition-colors"
        >
          ⚙️ 前往配置页面设置
        </button>
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            🔄 重新检测
          </button>
        )}
      </div>
      <div className="rounded-md bg-white p-4 text-left text-xs">
        <p className="mb-2 font-medium text-gray-700">或手动配置：</p>
        <ol className="list-inside list-decimal space-y-1 text-gray-600">
          <li>Export your wallet private key from MetaMask or another wallet</li>
          <li>Add to your <code className="rounded bg-gray-100 px-1">.env</code> file:</li>
        </ol>
        <pre className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-700">POLYMARKET_PRIVATE_KEY=0xYourPrivateKeyHere</pre>
        <p className="mt-2 text-gray-500">MetaMask 导出的私钥不带 0x 前缀，系统会自动补全。</p>
        <p className="mt-2 text-gray-500">You will need POL for gas fees and USDC for trading collateral on Polygon mainnet.</p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Order Form
// ---------------------------------------------------------------------------

interface OrderFormProps {
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: string;
  submitting: boolean;
  onTokenIdChange: (v: string) => void;
  onSideChange: (v: 'BUY' | 'SELL') => void;
  onPriceChange: (v: number) => void;
  onSizeChange: (v: string) => void;
  onSubmit: () => void;
}

const OrderForm: React.FC<OrderFormProps> = ({
  tokenId, side, price, size, submitting,
  onTokenIdChange, onSideChange, onPriceChange, onSizeChange, onSubmit,
}) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4">
    <h3 className="mb-3 text-sm font-semibold text-gray-700">Place Order</h3>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {/* Token ID */}
      <div className="lg:col-span-2">
        <label className="mb-1 block text-xs text-gray-500">Token ID</label>
        <input
          type="text"
          value={tokenId}
          onChange={e => onTokenIdChange(e.target.value)}
          placeholder="Enter token ID"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
        />
      </div>

      {/* Side toggle */}
      <div>
        <label className="mb-1 block text-xs text-gray-500">Side</label>
        <div className="flex rounded-md border border-gray-300">
          <button
            onClick={() => onSideChange('BUY')}
            className={`flex-1 rounded-l-md px-3 py-1.5 text-sm font-medium transition-colors ${
              side === 'BUY' ? 'bg-green-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => onSideChange('SELL')}
            className={`flex-1 rounded-r-md px-3 py-1.5 text-sm font-medium transition-colors ${
              side === 'SELL' ? 'bg-red-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Sell
          </button>
        </div>
      </div>

      {/* Price slider */}
      <div>
        <label className="mb-1 block text-xs text-gray-500">Price: {price.toFixed(2)}</label>
        <input
          type="range"
          min="0.01"
          max="0.99"
          step="0.01"
          value={price}
          onChange={e => onPriceChange(parseFloat(e.target.value))}
          className="w-full accent-purple-500"
        />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>0.01</span>
          <span>0.99</span>
        </div>
      </div>

      {/* Size */}
      <div>
        <label className="mb-1 block text-xs text-gray-500">Size</label>
        <div className="flex gap-2">
          <input
            type="number"
            value={size}
            onChange={e => onSizeChange(e.target.value)}
            placeholder="0"
            min="0"
            step="1"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="whitespace-nowrap rounded-md bg-purple-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-50"
          >
            {submitting ? '...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Open Orders Section
// ---------------------------------------------------------------------------

interface OpenOrdersSectionProps {
  orders: OpenOrder[];
  loading: boolean;
  cancelingId: string | null;
  cancelingAll: boolean;
  onCancel: (orderId: string) => void;
  onCancelAll: () => void;
}

const OpenOrdersSection: React.FC<OpenOrdersSectionProps> = ({
  orders, loading, cancelingId, cancelingAll, onCancel, onCancelAll,
}) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4">
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-gray-700">Open Orders ({orders.length})</h3>
      {orders.length > 0 && (
        <button
          onClick={onCancelAll}
          disabled={cancelingAll}
          className="rounded-md bg-red-50 px-3 py-1 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
        >
          {cancelingAll ? 'Canceling...' : 'Cancel All'}
        </button>
      )}
    </div>
    {loading ? (
      <p className="text-sm text-gray-400">Loading...</p>
    ) : orders.length === 0 ? (
      <p className="text-sm text-gray-400">No open orders</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="pb-2 pr-4">Token ID</th>
              <th className="pb-2 pr-4">Side</th>
              <th className="pb-2 pr-4">Price</th>
              <th className="pb-2 pr-4">Size</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr key={order.order_id} className="border-b border-gray-50">
                <td className="py-2 pr-4 font-mono text-xs">{order.token_id.slice(0, 12)}...</td>
                <td className={`py-2 pr-4 font-medium ${order.side === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>
                  {order.side}
                </td>
                <td className="py-2 pr-4">{order.price.toFixed(2)}</td>
                <td className="py-2 pr-4">{order.size}</td>
                <td className="py-2 pr-4 text-xs text-gray-500">{order.status}</td>
                <td className="py-2">
                  <button
                    onClick={() => onCancel(order.order_id)}
                    disabled={cancelingId === order.order_id}
                    className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                  >
                    {cancelingId === order.order_id ? '...' : 'Cancel'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Positions Section
// ---------------------------------------------------------------------------

interface PositionsSectionProps {
  positions: Position[];
  loading: boolean;
  onRefresh: () => void;
}

const PositionsSection: React.FC<PositionsSectionProps> = ({ positions, loading, onRefresh }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4">
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-gray-700">Positions ({positions.length})</h3>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="rounded-md bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50"
      >
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>
    {loading && positions.length === 0 ? (
      <p className="text-sm text-gray-400">Loading positions...</p>
    ) : positions.length === 0 ? (
      <p className="text-sm text-gray-400">No open positions</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="pb-2 pr-4">Market</th>
              <th className="pb-2 pr-4">Outcome</th>
              <th className="pb-2 pr-4 text-right">Size</th>
              <th className="pb-2 pr-4 text-right">Entry Price</th>
              <th className="pb-2 pr-4 text-right">Current Price</th>
              <th className="pb-2 text-right">Unrealized PnL</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, i) => (
              <tr key={`${pos.token_id}-${i}`} className="border-b border-gray-50">
                <td className="max-w-[200px] truncate py-2 pr-4 text-xs" title={pos.market_question}>
                  {pos.market_question}
                </td>
                <td className="py-2 pr-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    pos.outcome === 'Yes' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {pos.outcome}
                  </span>
                </td>
                <td className="py-2 pr-4 text-right">{pos.size}</td>
                <td className="py-2 pr-4 text-right">{pos.avg_entry_price.toFixed(2)}</td>
                <td className="py-2 pr-4 text-right">{pos.current_price.toFixed(2)}</td>
                <td className={`py-2 text-right font-medium ${
                  pos.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {pos.unrealized_pnl >= 0 ? '+' : ''}{pos.unrealized_pnl.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Trade History Section
// ---------------------------------------------------------------------------

interface TradeHistorySectionProps {
  trades: Trade[];
  loading: boolean;
  offset: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
}

const TradeHistorySection: React.FC<TradeHistorySectionProps> = ({
  trades, loading, offset, pageSize, onPrev, onNext,
}) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4">
    <h3 className="mb-3 text-sm font-semibold text-gray-700">Trade History</h3>
    {loading ? (
      <p className="text-sm text-gray-400">Loading trades...</p>
    ) : trades.length === 0 ? (
      <p className="text-sm text-gray-400">No trades found</p>
    ) : (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Market</th>
                <th className="pb-2 pr-4">Side</th>
                <th className="pb-2 pr-4 text-right">Price</th>
                <th className="pb-2 pr-4 text-right">Size</th>
                <th className="pb-2 text-right">Fee</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, i) => (
                <tr key={`${trade.timestamp}-${i}`} className="border-b border-gray-50">
                  <td className="py-2 pr-4 text-xs text-gray-500">
                    {new Date(trade.timestamp * 1000).toLocaleString()}
                  </td>
                  <td className="max-w-[200px] truncate py-2 pr-4 text-xs" title={trade.market_question}>
                    {trade.market_question}
                  </td>
                  <td className={`py-2 pr-4 text-xs font-medium ${
                    trade.side === 'BUY' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {trade.side}
                  </td>
                  <td className="py-2 pr-4 text-right">{trade.price.toFixed(2)}</td>
                  <td className="py-2 pr-4 text-right">{trade.size}</td>
                  <td className="py-2 text-right text-xs text-gray-500">{trade.fee.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={onPrev}
            disabled={offset === 0}
            className="rounded-md bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          >
            ← Previous
          </button>
          <span className="text-xs text-gray-400">
            Showing {offset + 1}–{offset + trades.length}
          </span>
          <button
            onClick={onNext}
            disabled={trades.length < pageSize}
            className="rounded-md bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      </>
    )}
  </div>
);

export default TradingTab;
