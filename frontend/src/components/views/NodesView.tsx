import { useState, useEffect, useCallback } from 'react';
import { get, post } from '../../services/apiClient';

type NodesTab = 'approvals' | 'bindings' | 'devices' | 'nodes';

const TABS: { id: NodesTab; label: string; icon: string }[] = [
  { id: 'approvals', label: '执行审批', icon: '✅' },
  { id: 'bindings', label: '节点绑定', icon: '🔗' },
  { id: 'devices', label: '设备', icon: '📱' },
  { id: 'nodes', label: '节点列表', icon: '🖥️' },
];

const NodesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NodesTab>('nodes');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
        <span className="text-2xl">🖥️</span>
        <h1 className="text-lg font-semibold text-gray-800">节点管理</h1>
      </div>
      <div className="flex border-b border-gray-200 px-6">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon} {tab.label}
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
          <h3 className="text-sm font-semibold text-gray-700">待审批的执行请求</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{approvals.length} 个</span>
        </div>
        {loading ? (
          <p className="text-xs text-gray-400">加载中...</p>
        ) : approvals.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-sm text-gray-400">
            暂无待审批请求
          </div>
        ) : (
          <div className="space-y-3">
            {approvals.map((a: any) => (
              <div key={a.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">ID: {a.id}</span>
                  <span className="text-xs text-amber-600">等待审批</span>
                </div>
                <pre className="mb-3 rounded bg-gray-800 p-2 text-xs text-green-400 font-mono overflow-x-auto">
                  {a.command || a.toolName || '(unknown)'}
                </pre>
                <div className="flex gap-2">
                  <button onClick={() => handleResolve(a.id, 'allow-once')}
                    className="rounded bg-green-500 px-3 py-1 text-xs text-white hover:bg-green-600">允许一次</button>
                  <button onClick={() => handleResolve(a.id, 'allow-always')}
                    className="rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600">始终允许</button>
                  <button onClick={() => handleResolve(a.id, 'deny')}
                    className="rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600">拒绝</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400">
        当智能体执行需要审批的命令时，请求会显示在这里。支持 allow-once / allow-always / deny 三种审批结果。
      </p>
    </div>
  );
};

const BindingsPanel: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [nodes, setNodes] = useState<any[]>([]);

  useEffect(() => {
    get<any>('/config').then(setConfig).catch(() => {});
    get<any[]>('/nodes').then(setNodes).catch(() => {});
  }, []);

  const defaultNode = config?.agents?.defaults?.execNode || '(未绑定)';

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">默认执行节点</h3>
        <div className="flex items-center gap-3">
          <span className="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-700 font-mono">{defaultNode}</span>
          <span className="text-xs text-gray-400">所有智能体默认使用此节点执行命令</span>
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">按智能体绑定</h3>
        <p className="text-xs text-gray-400 mb-3">将特定智能体绑定到指定节点</p>
        {nodes.length === 0 ? (
          <div className="rounded border border-dashed border-gray-300 p-4 text-center text-xs text-gray-400">
            暂无可用节点。节点上线后可在此配置绑定关系。
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
        <h3 className="mb-3 text-sm font-semibold text-gray-700">已配对设备</h3>
        {loading ? (
          <p className="text-xs text-gray-400">加载中...</p>
        ) : data.paired.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-sm text-gray-400">暂无已配对设备</div>
        ) : (
          <div className="space-y-2">
            {data.paired.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
                <div>
                  <span className="text-sm text-gray-700">{d.name || d.id}</span>
                  <span className="ml-2 text-xs text-gray-400">{d.platform}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">已配对</span>
                  <button onClick={() => handleRevoke(d.id)} className="text-xs text-red-500 hover:text-red-700">撤销</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.pending.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-amber-700">待配对请求</h3>
          <div className="space-y-2">
            {data.pending.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between rounded border border-amber-200 bg-white px-3 py-2">
                <span className="text-sm text-gray-700">{d.name || d.id}</span>
                <div className="flex gap-2">
                  <button onClick={() => handleApprove(d.id)} className="rounded bg-green-500 px-2 py-1 text-xs text-white">批准</button>
                  <button onClick={() => handleReject(d.id)} className="rounded bg-red-500 px-2 py-1 text-xs text-white">拒绝</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400">
        设备通过 ECDSA 密钥对进行身份验证，令牌存储在 IndexedDB 中。支持令牌轮换和撤销操作。
      </p>
    </div>
  );
};

const NodeListPanel: React.FC = () => {
  const [nodes, setNodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<any[]>('/nodes')
      .then(data => { setNodes(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">已注册节点</h3>
      {loading ? (
        <p className="text-xs text-gray-400">加载中...</p>
      ) : nodes.length === 0 ? (
        <div className="flex h-20 items-center justify-center text-sm text-gray-400">
          暂无已注册节点
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
                {n.capabilities && <span>{n.capabilities.length} 能力</span>}
                {n.lastSeenAt && <span>最后活跃: {new Date(n.lastSeenAt).toLocaleString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-gray-400">
        节点通过网关通信，支持设备发现、配对管理、命令执行等操作。
      </p>
    </div>
  );
};

export default NodesView;
