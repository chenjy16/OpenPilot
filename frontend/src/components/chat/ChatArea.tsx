import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { wsClient } from '../../services/wsClient';
import type { WSMessage } from '../../services/wsClient';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import ErrorBanner from '../common/ErrorBanner';
import StatusBadge from '../common/StatusBadge';

const WS_STATUS_MAP = {
  connected: 'success',
  disconnected: 'error',
  reconnecting: 'warning',
} as const;

const WS_STATUS_LABELS: Record<string, string> = {
  connected: 'chat.connected',
  disconnected: 'chat.disconnected',
  reconnecting: 'chat.reconnecting',
};

export interface ToolStreamEntry {
  id: string;
  name: string;
  args?: unknown;
  output?: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
}

const ChatArea: React.FC = () => {
  const { t } = useTranslation();
  const { wsStatus, error, isStreaming, compactSession } = useChatStore();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const [compacting, setCompacting] = useState(false);
  const [compactionToast, setCompactionToast] = useState<string | null>(null);
  const [fallbackToast] = useState<string | null>(null);
  const [toolStream, setToolStream] = useState<ToolStreamEntry[]>([]);

  // Listen for tool_call events and compaction/fallback events
  useEffect(() => {
    const onToolStart = (msg: WSMessage) => {
      const d = msg.data as { toolName?: string; args?: unknown; id?: string } | undefined;
      if (!d?.toolName) return;
      setToolStream((prev) => [
        ...prev.slice(-49), // keep max 50
        { id: d.id ?? `tc-${Date.now()}`, name: d.toolName!, args: d.args, status: 'running', startedAt: Date.now() },
      ]);
    };

    const onToolResult = (msg: WSMessage) => {
      const d = msg.data as { id?: string; result?: unknown; error?: string } | undefined;
      if (!d?.id) return;
      setToolStream((prev) =>
        prev.map((e) =>
          e.id === d.id
            ? { ...e, status: d.error ? 'error' : 'done', output: d.error ?? (typeof d.result === 'string' ? d.result : JSON.stringify(d.result)) }
            : e
        )
      );
    };

    wsClient.on('tool_call_start', onToolStart);
    wsClient.on('tool_call_result', onToolResult);
    return () => {
      wsClient.off('tool_call_start', onToolStart);
      wsClient.off('tool_call_result', onToolResult);
    };
  }, []);

  // Clear tool stream when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      const timer = setTimeout(() => setToolStream([]), 2000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming]);

  const handleCompact = useCallback(async () => {
    if (!activeSessionId || compacting) return;
    setCompacting(true);
    setCompactionToast(t('chat.compactingContext'));
    try {
      await compactSession(activeSessionId);
      setCompactionToast(t('chat.compactDone'));
      setTimeout(() => setCompactionToast(null), 5000);
    } catch {
      setCompactionToast(null);
    } finally {
      setCompacting(false);
    }
  }, [activeSessionId, compacting, compactSession]);

  const handleReconnect = useCallback(() => {
    wsClient.manualReconnect();
  }, []);

  // Active tool calls (running ones)
  const activeTools = toolStream.filter((t) => t.status === 'running');

  return (
    <div className="flex flex-1 flex-col min-w-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2">
        <StatusBadge
          status={WS_STATUS_MAP[wsStatus]}
          label={t(WS_STATUS_LABELS[wsStatus])}
        />

        {wsStatus === 'disconnected' && (
          <button
            onClick={handleReconnect}
            className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300"
          >
            {t('chat.reconnect')}
          </button>
        )}

        <div className="flex-1" />

        {/* Streaming indicator */}
        {isStreaming && (
          <span className="flex items-center gap-1 text-xs text-blue-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            {t('chat.streaming')}
          </span>
        )}

        <button
          onClick={handleCompact}
          disabled={!activeSessionId || compacting}
          className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {compacting ? t('chat.compacting') : t('chat.compactSession')}
        </button>
      </div>

      {/* Compaction toast */}
      {compactionToast && (
        <div className="mx-4 mt-2 rounded-md bg-blue-50 px-3 py-1.5 text-xs text-blue-700">
          {compactionToast}
        </div>
      )}

      {/* Fallback toast */}
      {fallbackToast && (
        <div className="mx-4 mt-2 rounded-md bg-yellow-50 px-3 py-1.5 text-xs text-yellow-700">
          {fallbackToast}
        </div>
      )}

      {/* Error banner */}
      {error && <div className="px-4 pt-2"><ErrorBanner message={error} /></div>}

      {/* Tool stream indicator */}
      {activeTools.length > 0 && (
        <div className="mx-4 mt-2 space-y-1">
          {activeTools.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded bg-gray-50 px-3 py-1.5 text-xs">
              <span className="h-1.5 w-1.5 animate-spin rounded-full border border-gray-400 border-t-transparent" />
              <span className="font-medium text-gray-700">🔧 {t.name}</span>
              {t.args != null && (
                <span className="max-w-[200px] truncate text-gray-400">
                  {typeof t.args === 'string' ? t.args : JSON.stringify(t.args)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Message list */}
      <MessageList />

      {/* Chat input */}
      <ChatInput />
    </div>
  );
};

export default ChatArea;
