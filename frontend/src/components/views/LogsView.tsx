import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { get } from '../../services/apiClient';

interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  subsystem?: string;
  message: string;
}

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
const LEVEL_COLORS: Record<string, string> = {
  trace: 'text-gray-400',
  debug: 'text-gray-500',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  fatal: 'text-red-300 font-bold',
};
const POLL_INTERVAL = 2000; // §4.3: logs 2s
const LOG_BUFFER_LIMIT = 2000; // §5.12.1
const NEAR_BOTTOM_PX = 80; // §7.2

const LogsView: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [enabledLevels, setEnabledLevels] = useState<Set<string>>(new Set(LEVELS));
  const [autoFollow, setAutoFollow] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await get<LogEntry[]>('/logs');
      if (Array.isArray(data)) {
        setLogs((prev) => {
          // Merge: append new entries, keep buffer limit
          const existingIds = new Set(prev.map((e) => e.id));
          const newEntries = data.filter((e) => !existingIds.has(e.id));
          if (newEntries.length === 0) return prev;
          return [...prev, ...newEntries].slice(-LOG_BUFFER_LIMIT);
        });
      }
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    pollRef.current = setInterval(fetchLogs, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchLogs]);

  // Auto-scroll (§7.2)
  useEffect(() => {
    if (autoFollow && atBottom && containerRef.current) {
      containerRef.current.scrollTo(0, containerRef.current.scrollHeight);
    }
  }, [logs, autoFollow, atBottom]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAtBottom(scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_PX);
  };

  const toggleLevel = (level: string) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const filtered = logs.filter((l) => {
    if (!enabledLevels.has(l.level)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!l.message.toLowerCase().includes(q) && !(l.subsystem?.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  // Export (§7.3)
  const handleExport = () => {
    const lines = filtered.map((e) =>
      `${e.timestamp ?? ''} ${e.level.toUpperCase().padEnd(5)} ${e.subsystem ? `[${e.subsystem}] ` : ''}${e.message}`
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `openpilot-logs-${filtered.length === logs.length ? 'all' : 'filtered'}-${ts}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">{t('logs.title')}</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={autoFollow}
              onChange={(e) => setAutoFollow(e.target.checked)}
              className="rounded"
            />
            {t('logs.autoFollow')}
          </label>
          <button
            onClick={handleExport}
            className="rounded bg-gray-200 px-3 py-1 text-xs text-gray-700 hover:bg-gray-300"
          >
            {t('logs.export')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder={t('logs.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        <div className="flex gap-1">
          {LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                enabledLevels.has(level)
                  ? 'bg-gray-200 text-gray-800'
                  : 'bg-gray-50 text-gray-400'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400">
          {t('logs.entryCount', { filtered: filtered.length, total: logs.length })}
        </span>
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-gray-900 p-3 font-mono text-xs leading-5"
      >
        {filtered.length === 0 && (
          <div className="text-gray-500">{t('logs.noLogs')}</div>
        )}
        {filtered.map((entry) => (
          <div key={entry.id}>
            <span className="text-gray-500">{entry.timestamp?.slice(11, 23) ?? ''}</span>{' '}
            <span className={`inline-block w-12 ${LEVEL_COLORS[entry.level] ?? 'text-gray-400'}`}>
              {entry.level.toUpperCase().padEnd(5)}
            </span>{' '}
            {entry.subsystem && (
              <span className="text-purple-400">[{entry.subsystem}]</span>
            )}{' '}
            <span className="text-gray-300">{entry.message}</span>
          </div>
        ))}
      </div>

      {/* Truncation warning */}
      {logs.length >= LOG_BUFFER_LIMIT && (
        <div className="mt-1 text-center text-xs text-gray-400">
          {t('logs.truncated', { limit: LOG_BUFFER_LIMIT })}
        </div>
      )}
    </div>
  );
};

export default LogsView;
