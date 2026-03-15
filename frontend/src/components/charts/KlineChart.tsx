import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  type SeriesType,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';
import { useTranslation } from 'react-i18next';
import { get } from '../../services/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KlineChartProps {
  symbol: string;
  timeframe: 'daily' | 'weekly' | 'monthly';
  indicators?: string[]; // overlay indicators: ['sma20', 'sma50', 'bollinger']
}

interface OHLCVData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20?: number | null;
  sma50?: number | null;
  bollinger_upper?: number | null;
  bollinger_lower?: number | null;
}



// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const KlineChart: React.FC<KlineChartProps> = ({ symbol, timeframe, indicators = [] }) => {
  const { t } = useTranslation();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const indicatorSeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTimeframe, setActiveTimeframe] = useState(timeframe);
  const [retryCount, setRetryCount] = useState(0);

  const fetchData = useCallback(async (tf: string): Promise<OHLCVData[]> => {
    try {
      return await get<OHLCVData[]>(`/stocks/history/${symbol}?timeframe=${tf}&period=3mo`);
    } catch {
      return [];
    }
  }, [symbol]);

  // Create chart once
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#333',
      },
      width: chartContainerRef.current.clientWidth,
      height: 420,
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#e0e0e0' },
      timeScale: { borderColor: '#e0e0e0', timeVisible: false },
    });

    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      indicatorSeriesRef.current = [];
    };
  }, []);

  // Load data when symbol/timeframe/indicators change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      const rawData = await fetchData(activeTimeframe);
      if (cancelled) return;

      if (rawData.length === 0) {
        setError(t('kline.noData'));
        setLoading(false);
        return;
      }

      // Remove old series
      if (candleSeriesRef.current) {
        chart.removeSeries(candleSeriesRef.current);
        candleSeriesRef.current = null;
      }
      if (volumeSeriesRef.current) {
        chart.removeSeries(volumeSeriesRef.current);
        volumeSeriesRef.current = null;
      }
      for (const s of indicatorSeriesRef.current) {
        chart.removeSeries(s);
      }
      indicatorSeriesRef.current = [];

      // Candlestick series (OHLC)
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderDownColor: '#ef5350',
        borderUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        wickUpColor: '#26a69a',
      });
      const candleData: CandlestickData<Time>[] = rawData.map(d => ({
        time: d.date as Time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));
      candleSeries.setData(candleData);
      candleSeriesRef.current = candleSeries;

      // Volume histogram
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      const volumeData: HistogramData<Time>[] = rawData.map(d => ({
        time: d.date as Time,
        value: d.volume,
        color: d.close >= d.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      }));
      volumeSeries.setData(volumeData);
      volumeSeriesRef.current = volumeSeries;

      // SMA20 overlay
      if (indicators.includes('sma20')) {
        const series = chart.addSeries(LineSeries, {
          color: '#2196F3',
          lineWidth: 1,
          title: 'SMA20',
        });
        const data: LineData<Time>[] = rawData
          .filter(d => d.sma20 != null)
          .map(d => ({ time: d.date as Time, value: d.sma20! }));
        series.setData(data);
        indicatorSeriesRef.current.push(series);
      }

      // SMA50 overlay
      if (indicators.includes('sma50')) {
        const series = chart.addSeries(LineSeries, {
          color: '#FF9800',
          lineWidth: 1,
          title: 'SMA50',
        });
        const data: LineData<Time>[] = rawData
          .filter(d => d.sma50 != null)
          .map(d => ({ time: d.date as Time, value: d.sma50! }));
        series.setData(data);
        indicatorSeriesRef.current.push(series);
      }

      // Bollinger Bands overlay
      if (indicators.includes('bollinger')) {
        const upper = chart.addSeries(LineSeries, {
          color: '#9E9E9E',
          lineWidth: 1,
          lineStyle: 2,
          title: 'BB Upper',
        });
        upper.setData(
          rawData
            .filter(d => d.bollinger_upper != null)
            .map(d => ({ time: d.date as Time, value: d.bollinger_upper! }))
        );
        indicatorSeriesRef.current.push(upper);

        const lower = chart.addSeries(LineSeries, {
          color: '#9E9E9E',
          lineWidth: 1,
          lineStyle: 2,
          title: 'BB Lower',
        });
        lower.setData(
          rawData
            .filter(d => d.bollinger_lower != null)
            .map(d => ({ time: d.date as Time, value: d.bollinger_lower! }))
        );
        indicatorSeriesRef.current.push(lower);
      }

      chart.timeScale().fitContent();
      setLoading(false);
    };

    loadData();
    return () => { cancelled = true; };
  }, [symbol, activeTimeframe, indicators, fetchData, retryCount]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          📈 {t('kline.title')} — {symbol}
        </h3>
        <div className="flex gap-1">
          {(['daily', 'weekly', 'monthly'] as const).map(tf => (
            <button
              key={tf}
              onClick={() => setActiveTimeframe(tf)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                activeTimeframe === tf
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t(`kline.timeframe.${tf}`)}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex h-[420px] items-center justify-center text-sm text-gray-400">
          {t('kline.loading')}
        </div>
      )}

      {error && !loading && (
        <div className="flex h-[420px] flex-col items-center justify-center gap-2">
          <p className="text-sm text-gray-400">{error}</p>
          <button
            onClick={() => setRetryCount(c => c + 1)}
            className="rounded bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200"
          >
            🔄 {t('kline.retry')}
          </button>
        </div>
      )}

      <div
        ref={chartContainerRef}
        style={{ display: loading || error ? 'none' : 'block' }}
      />
    </div>
  );
};

export default KlineChart;
