import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post } from '../../services/apiClient';

type NodesTab = 'approvals' | 'bindings' | 'devices' | 'nodes';

const TAB_IDS: NodesTab[] = ['approvals', 'bindings', 'devices', 'nodes'];
const TAB_ICONS: Record<NodesTab, string> = {
  approvals: '✅',
  bindings: '🔗',
  devices: '📱',
  nodes: '🖥️',
};

const NodesView: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<NodesTab>('nodes');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
        <span className="text-2xl">🖥️</span>
        <h1 className="text-lg font-semibold text-gray-800">{t('nodes.title')}</h1>
      </div>
      <div className="flex border-b border-gray-200 px-6">
        {TAB_IDS.map(id => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2.5 text-sm transition-colors ${
              activeTab === id
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_ICONS[id]} {t(`nodes.tab${id.charAt(0).toUpperCase() + id.slice(1)}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'approvals' && <ApprovalsPanel />}
        {activeTab === 'bindings' && <BindingsPanel />}
        {activeTab === 'devices' && <DevicesPanel />}
        {activeTab === 'nodes' && <NodeListPanel />}
      </div>
    </div>
  );
};

const ApprovalsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApprovals = useCallback(async () => {
    try {
      const data = await get<any[]>('/exec-approvals');
      setApprovals(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchApprovals();
    const timer = setInterval(fetchApprovals, 3000);
    return () => clearInterval(timer);
  }, [fetchApprovals]);

  const handleResolve = async (id: string, decision: string) => {
    try {
      await post(`/exec-approvals/${id}/resolve`, { decision });
      fetchApprovals();
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">{t('nodes.pendingApprovals')}</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t('nodes.itemCount', { count: approvals.length })}</span>
        </div>
        {loading ? (
          <p className="text-xs text-gray-400">{t('nodes.loading')}</p>
        ) : approvals.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-sm text-gray-400">
            {t('nodes.noPendingApprovals')}
          </div>
        ) : (
          <div className="space-y-3">
            {approvals.map((a: any) => (
              <div key={a.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">ID: {a.id}</span>
                  <span className="text-xs text-amber-600">{t('nodes.awaitingApproval')}</span>
                </div>
                <pre className="mb-3 rounded bg-gray-800 p-2 text-xs text-green-400 font-mono overflow-x-auto">
                  {a.command || a.toolName || '(unknown)'}
                </pre>
                <div className="flex gap-2">
                  <button onClick={() => handleResolve(a.id, 'allow-once')}
                    className="rounded bg-green-500 px-3 py-1 text-xs text-white hover:bg-green-600">{t('nodes.allowOnce')}</button>
                  <button onClick={() => handleResolve(a.id, 'allow-always')}
                    className="rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600">{t('nodes.allowAlways')}</button>
                  <button onClick={() => handleResolve(a.id, 'deny')}
                    className="rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600">{t('nodes.deny')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400">
        {t('nodes.approvalHint')}
      </p>
    </div>
  );
};

const BindingsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<any>(null);
  const [nodes, setNodes] = useState<any[]>([]);

  useEffect(() => {
    get<any>('/config').then(setConfig).catch(() => {});
    get<any[]>('/nodes').then(setNodes).catch(() => {});
  }, []);

  const defaultNode = config?.agents?.defaults?.execNode || t('nodes.notBound');

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('nodes.defaultExecNode')}</h3>
        <div className="flex items-center gap-3">
          <span className="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-700 font-mono">{defaultNode}</span>
          <span className="text-xs text-gray-400">{t('nodes.defaultNodeHint')}</span>
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('nodes.bindByAgent')}</h3>
        <p className="text-xs text-gray-400 mb-3">{t('nodes.bindByAgentHint')}</p>
        {nodes.length === 0 ? (
          <div className="rounded border border-dashed border-gray-300 p-4 text-center text-xs text-gray-400">
            {t('nodes.noAvailableNodes')}
          </div>
        ) : (
          <div className="space-y-2">
            {nodes.map((n: any) => (
              <div key={n.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm">
                <span className="text-gray-700">{n.label || n.id}</span>
                <span className="text-xs text-gray-400">{n.platform}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const DevicesPanel: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<{ paired: any[]; pending: any[] }>({ paired: [], pending: [] });
  const [loading, setLoading] = useState(true);

  const fetchDevices = useCallback(async () => {
    try {
      const d = await get<{ paired: any[]; pending: any[] }>('/devices');
      setData(d);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDevices();
    const timer = setInterval(fetchDevices, 5000);
    return () => clearInterval(timer);
  }, [fetchDevices]);

  const handleApprove = async (id: string) => {
    await post(`/devices/${id}/approve`).catch(() => {});
    fetchDevices();
  };

  const handleReject = async (id: string) => {
    await post(`/devices/${id}/reject`).catch(() => {});
    fetchDevices();
  };

  const handleRevoke = async (id: string) => {
    await post(`/devices/${id}/revoke`).catch(() => {});
    fetchDevices();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('nodes.pairedDevices')}</h3>
        {loading ? (
          <p className="text-xs text-gray-400">{t('nodes.loading')}</p>
        ) : data.paired.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-sm text-gray-400">{t('nodes.noPairedDevices')}</div>
        ) : (
          <div className="space-y-2">
            {data.paired.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
                <div>
                  <span className="text-sm text-gray-700">{d.name || d.id}</span>
                  <span className="ml-2 text-xs text-gray-400">{d.platform}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{t('nodes.paired')}</span>
                  <button onClick={() => handleRevoke(d.id)} className="text-xs text-red-500 hover:text-red-700">{t('nodes.revoke')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.pending.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-amber-700">{t('nodes.pendingPairing')}</h3>
          <div className="space-y-2">
            {data.pending.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between rounded border border-amber-200 bg-white px-3 py-2">
                <span className="text-sm text-gray-700">{d.name || d.id}</span>
                <div className="flex gap-2">
                  <button onClick={() => handleApprove(d.id)} className="rounded bg-green-500 px-2 py-1 text-xs text-white">{t('nodes.approve')}</button>
                  <button onClick={() => handleReject(d.id)} className="rounded bg-red-500 px-2 py-1 text-xs text-white">{t('nodes.reject')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400">
        {t('nodes.deviceAuthHint')}
      </p>
    </div>
  );
};

const NodeListPanel: React.FC = () => {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<any[]>('/nodes')
      .then(data => { setNodes(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('nodes.registeredNodes')}</h3>
      {loading ? (
        <p className="text-xs text-gray-400">{t('nodes.loading')}</p>
      ) : nodes.length === 0 ? (
        <div className="flex h-20 items-center justify-center text-sm text-gray-400">
          {t('nodes.noRegisteredNodes')}
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.map((n: any) => (
            <div key={n.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${n.status === 'online' ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span className="text-sm text-gray-700">{n.label || n.id}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>{n.platform}</span>
                {n.capabilities && <span>{t('nodes.capabilityCount', { count: n.capabilities.length })}</span>}
                {n.lastSeenAt && <span>{t('nodes.lastActive')}: {new Date(n.lastSeenAt).toLocaleString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-gray-400">
        {t('nodes.nodeGatewayHint')}
      </p>
    </div>
  );
};

export default NodesView;
