import { useEffect, useState } from 'react';
import { useSecurityStore } from '../../stores/securityStore';
import type { AuditLogEntry } from '../../types';
import StatusBadge from '../common/StatusBadge';

const STATUS_MAP = {
  executed: 'success',
  cancelled: 'warning',
  failed: 'error',
} as const;

const STATUS_LABELS: Record<AuditLogEntry['status'], string> = {
  executed: '已执行',
  cancelled: '已取消',
  failed: '失败',
};

const AuditLog: React.FC = () => {
  const { auditLogs, loading, error, fetchAuditLogs } = useSecurityStore();

  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 30;

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const handleFilter = () => {
    setPage(0);
    fetchAuditLogs({
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      action: actionFilter || undefined,
    });
  };

  const handleReset = () => {
    setStartTime('');
    setEndTime('');
    setActionFilter('');
    setPage(0);
    fetchAuditLogs();
  };

  // Derive unique action types for the dropdown
  const actionTypes = Array.from(new Set(auditLogs.map((l) => l.action)));

  const totalPages = Math.ceil(auditLogs.length / pageSize);
  const paged = auditLogs.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h3 className="text-sm font-semibold text-gray-700">审计日志</h3>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-500">开始时间</span>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded border border-gray-300 px-1.5 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-500">结束时间</span>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="rounded border border-gray-300 px-1.5 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-500">操作类型</span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded border border-gray-300 px-1.5 py-1 text-xs"
          >
            <option value="">全部</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1">
          <button
            onClick={handleFilter}
            className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
          >
            筛选
          </button>
          <button
            onClick={handleReset}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            重置
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">{error}</div>
      )}

      {/* Log list */}
      <div className="flex-1 overflow-y-auto">
        {loading && auditLogs.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-400">加载中…</p>
        ) : auditLogs.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-400">暂无日志记录</p>
        ) : (
          <>
          <ul className="flex flex-col gap-2">
            {paged.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-gray-200 bg-white p-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">{entry.action}</span>
                  <StatusBadge
                    status={STATUS_MAP[entry.status]}
                    label={STATUS_LABELS[entry.status]}
                  />
                </div>
                <div className="mt-1 flex gap-3 text-gray-500">
                  <span>操作者: {entry.operator}</span>
                  <span>{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                {Object.keys(entry.details).length > 0 && (
                  <pre className="mt-1 max-h-20 overflow-auto rounded bg-gray-50 p-1 text-[10px] text-gray-600">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span>第 {page + 1} / {totalPages} 页 (共 {auditLogs.length} 条)</span>
              <div className="flex gap-1">
                <button onClick={() => setPage(page - 1)} disabled={page === 0} className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-40">上一页</button>
                <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1} className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-40">下一页</button>
              </div>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
};

export default AuditLog;
