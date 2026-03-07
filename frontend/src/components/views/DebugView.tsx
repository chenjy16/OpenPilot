import React, { useEffect, useState, useRef, useCallback } from 'react';
import { get, post } from '../../services/apiClient';
import { wsClient } from '../../services/wsClient';
import type { WSMessage } from '../../services/wsClient';

interface EventEntry {
  id: number;
  type: string;
  time: string;
  data: unknown;
}

let eventId = 0;

const POLL_INTERVAL = 3000;
const EVENT_LOG_LIMIT = 250;

const DebugView: React.FC = () => {
  const [statusJson, setStatusJson] = useState('');
  const [healthJson, setHealthJson] = useState('');
  const [modelsJson, setModelsJson] = useState('');
  const [heartbeatJson] = useState('');
  const [rpcMethod, setRpcMethod] = useState('system.status');
  const [rpcParams, setRpcParams] = useState('{}');
  const [rpcResult, setRpcResult] = useState('');
  const [rpcError, setRpcError] = useState('');
  const [events, setEvents] = useState<EventEntry[]>([]);
  const eventsRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parallel data load (§5.11.1)
  const loadSnapshots = useCallback(async () => {
    const [statusRes, healthRes, modelsRes] = await Promise.allSettled([
      get<unknown>('/status'),
      get<unknown>('/health'),
      get<unknown>('/status'), // models come from status endpoint
    ]);
    if (statusRes.status === 'fulfilled') setStatusJson(JSON.stringify(statusRes.value, null, 2));
    if (healthRes.status === 'fulfilled') setHealthJson(JSON.stringify(healthRes.value, null, 2));
    if (modelsRes.status === 'fulfilled') {
      const s = modelsRes.value as Record<string, unknown>;
      if (s?.models) setModelsJson(JSON.stringify(s.models, null, 2));
    }
  }, []);

  // Initial load + polling (§4.3: debug 3s interval)
  useEffect(() => {
    loadSnapshots();
    pollRef.current = setInterval(loadSnapshots, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadSnapshots]);

  // Capture WS events for event log (§5.11.3: max 250)
  useEffect(() => {
    const handler = (msg: WSMessage) => {
      setEvents((prev) => {
        const next = [...prev, { id: ++eventId, type: msg.type, time: new Date().toISOString(), data: msg.data }];
        return next.slice(-EVENT_LOG_LIMIT);
      });
    };
    const types = ['stream_start', 'stream_chunk', 'stream_end', 'error',
      'tool_call_start', 'tool_call_result', 'status_change'];
    types.forEach((t) => wsClient.on(t, handler));
    return () => { types.forEach((t) => wsClient.off(t, handler)); };
  }, []);

  useEffect(() => {
    eventsRef.current?.scrollTo(0, eventsRef.current.scrollHeight);
  }, [events]);

  const handleRpc = async () => {
    setRpcResult('');
    setRpcError('');
    try {
      const params = JSON.parse(rpcParams);
      const result = await post<unknown>(`/rpc/${rpcMethod}`, params);
      setRpcResult(JSON.stringify(result, null, 2));
    } catch (e) {
      setRpcError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h2 className="text-xl font-semibold text-gray-800">调试面板</h2>

      {/* Snapshots grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SnapshotCard title="系统状态 (Status)" content={statusJson} />
        <SnapshotCard title="健康检查 (Health)" content={healthJson} />
        <SnapshotCard title="模型目录 (Models)" content={modelsJson} />
        <SnapshotCard title="心跳 (Heartbeat)" content={heartbeatJson || '(暂无数据)'} />
      </div>

      {/* Manual RPC (§5.11.2) */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-700">Manual RPC</h3>
        <div className="flex gap-2">
          <input
            value={rpcMethod}
            onChange={(e) => setRpcMethod(e.target.value)}
            placeholder="方法名 (如 system.status)"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleRpc}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            Call
          </button>
        </div>
        <textarea
          value={rpcParams}
          onChange={(e) => setRpcParams(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none"
          placeholder='{"key": "value"}'
        />
        {rpcResult && (
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-green-50 p-3 font-mono text-xs text-green-800">{rpcResult}</pre>
        )}
        {rpcError && (
          <pre className="mt-2 rounded bg-red-50 p-3 font-mono text-xs text-red-700">{rpcError}</pre>
        )}
      </div>

      {/* Event Log (§5.11.3) */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">
            事件日志 ({events.length}/{EVENT_LOG_LIMIT})
          </h3>
          <button onClick={() => setEvents([])} className="text-xs text-gray-500 hover:text-gray-700">
            清空
          </button>
        </div>
        <div ref={eventsRef} className="max-h-64 overflow-auto rounded bg-gray-50 p-2 font-mono text-xs">
          {events.length === 0 && <div className="text-gray-400">等待事件...</div>}
          {events.map((e) => (
            <div key={e.id} className="mb-1 border-b border-gray-100 pb-1">
              <span className="text-gray-400">{e.time.slice(11, 23)}</span>{' '}
              <span className="font-semibold text-blue-600">{e.type}</span>{' '}
              <span className="text-gray-600">{JSON.stringify(e.data)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

function SnapshotCard({ title, content }: { title: string; content: string }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex cursor-pointer items-center justify-between" onClick={() => setCollapsed(!collapsed)}>
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        <span className="text-xs text-gray-400">{collapsed ? '展开' : '收起'}</span>
      </div>
      {!collapsed && (
        <pre className="max-h-48 overflow-auto rounded bg-gray-50 p-3 font-mono text-xs text-gray-700">
          {content || '加载中...'}
        </pre>
      )}
    </div>
  );
}

export default DebugView;
