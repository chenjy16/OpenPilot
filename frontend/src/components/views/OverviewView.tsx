import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { get } from '../../services/apiClient';
import { useChatStore } from '../../stores/chatStore';
import StatusBadge from '../common/StatusBadge';

interface SystemStatus {
  status: string;
  uptime: number;
  version: string;
  models?: string[];
  activeSessions?: number;
  totalMessages?: number;
  channels?: ChannelStatus[];
}

interface ChannelStatus {
  name: string;
  type: string;
  configured: boolean;
  running: boolean;
  connected: boolean;
}

const POLL_INTERVAL = 10000;

const OverviewView: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsStatus = useChatStore((s) => s.wsStatus);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const data = await get<SystemStatus>('/status');
      setStatus(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    pollRef.current = setInterval(loadStatus, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadStatus]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    return `${h}h ${m}m`;
  };

  const channels = status?.channels ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h2 className="text-xl font-semibold text-gray-800">{t('overview.title')}</h2>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Connection & system status */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatusCard
          title={t('overview.gatewayConnection')}
          value={wsStatus === 'connected' ? 'OK' : wsStatus === 'reconnecting' ? t('overview.reconnecting') : t('overview.offline')}
          badge={wsStatus === 'connected' ? 'success' : wsStatus === 'reconnecting' ? 'warning' : 'error'}
        />
        <StatusCard title={t('overview.uptime')} value={status ? formatUptime(status.uptime) : '—'} />
        <StatusCard title={t('overview.version')} value={status?.version ?? '—'} />
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title={t('overview.activeSessions')} value={status?.activeSessions ?? 0} icon="📄" />
        <StatCard title={t('overview.availableModels')} value={status?.models?.length ?? 0} icon="🧠" />
        <StatCard title={t('overview.channelCount')} value={channels.length} icon="🔗" />
      </div>

      {/* Channels status */}
      {channels.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-medium text-gray-600">{t('overview.channelStatus')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map((ch) => (
              <div key={ch.name} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800">{ch.name}</span>
                  <StatusBadge
                    status={ch.connected ? 'success' : ch.running ? 'warning' : 'idle'}
                    label={ch.connected ? t('overview.connected') : ch.running ? t('common.running') : t('overview.offline')}
                  />
                </div>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span>{t('overview.configLabel')}: {ch.configured ? '✓' : '✗'}</span>
                  <span>{t('overview.runLabel')}: {ch.running ? '✓' : '✗'}</span>
                  <span>{t('overview.connectLabel')}: {ch.connected ? '✓' : '✗'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Models list */}
      {status?.models && status.models.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-600">{t('overview.availableModels')}</h3>
          <div className="flex flex-wrap gap-2">
            {status.models.map((m) => (
              <span key={m} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function StatusCard({ title, value, badge }: { title: string; value: string; badge?: 'success' | 'warning' | 'error' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 text-xs text-gray-500">{title}</div>
      <div className="flex items-center gap-2">
        {badge && <StatusBadge status={badge} label="" />}
        <span className="text-lg font-semibold text-gray-800">{value}</span>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: number; icon: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-1 text-xs text-gray-500">
        <span>{icon}</span> {title}
      </div>
      <div className="text-2xl font-bold text-gray-800">{value}</div>
    </div>
  );
}

export default OverviewView;
