import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { get } from '../../services/apiClient';

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  sessions: number;
}

const UsageView: React.FC = () => {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    try {
      const data = await get<UsageTotals>('/usage');
      setUsage(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    const timer = setInterval(fetchUsage, 15000);
    return () => clearInterval(timer);
  }, [fetchUsage]);

  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📈</span>
          <h1 className="text-lg font-semibold text-gray-800">{t('usage.title')}</h1>
        </div>
        <button
          onClick={fetchUsage}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          {t('usage.refresh')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-gray-400">{t('usage.loading')}</div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
        ) : usage ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label={t('usage.totalTokens')} value={formatNumber(usage.totalTokens)} icon="🔢" color="blue" />
              <StatCard label={t('usage.inputTokens')} value={formatNumber(usage.inputTokens)} icon="📥" color="green" />
              <StatCard label={t('usage.outputTokens')} value={formatNumber(usage.outputTokens)} icon="📤" color="purple" />
              <StatCard label={t('usage.sessionCount')} value={formatNumber(usage.sessions)} icon="💬" color="amber" />
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-700">{t('usage.costEstimate')}</h3>
              <div className="text-3xl font-bold text-gray-800">
                ${usage.cost.toFixed(4)}
              </div>
              <p className="mt-1 text-xs text-gray-400">{t('usage.costEstimateDesc')}</p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-700">{t('usage.usageTrend')}</h3>
              <div className="flex h-32 items-center justify-center text-sm text-gray-400">
                {t('usage.timeSeriesPlaceholder')}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; icon: string; color: string }> = ({
  label, value, icon, color,
}) => {
  void color; // used by Tailwind dynamic classes
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-bold text-gray-800`}>{value}</div>
    </div>
  );
};

export default UsageView;
