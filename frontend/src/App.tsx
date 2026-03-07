import { useEffect } from 'react';
import AppLayout from './components/layout/AppLayout';
import ConfirmDialog from './components/common/ConfirmDialog';
import { wsClient } from './services/wsClient';
import type { WSMessage } from './services/wsClient';
import { useChatStore } from './stores/chatStore';
import { useSessionStore } from './stores/sessionStore';
import { useConfirmStore } from './stores/confirmStore';
import { get } from './services/apiClient';

function App() {
  useEffect(() => {
    wsClient.connect();

    const onStreamStart = (msg: WSMessage) => {
      if (msg.sessionId) {
        useChatStore.getState().startStreaming(msg.sessionId);
      }
    };

    const onStreamChunk = (msg: WSMessage) => {
      const data = msg.data as { text?: string } | undefined;
      if (data?.text) {
        useChatStore.getState().appendChunk(data.text);
      }
    };

    const onStreamEnd = (msg: WSMessage) => {
      const data = msg.data as { usage?: unknown } | undefined;
      useChatStore.getState().endStreaming(data?.usage);
    };

    const onError = (msg: WSMessage) => {
      const data = msg.data as { message?: string } | undefined;
      useChatStore.setState({ error: data?.message ?? 'Unknown WebSocket error' });
    };

    // Pi-compatible: tool_call_start events — add to current streaming message
    const onToolCallStart = (msg: WSMessage) => {
      const data = msg.data as { toolName?: string; args?: unknown; id?: string } | undefined;
      if (!data?.toolName) return;
      const store = useChatStore.getState();
      const messages = [...store.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        const tc = { id: data.id ?? `tc-${Date.now()}`, name: data.toolName, arguments: (data.args ?? {}) as Record<string, unknown> };
        messages[messages.length - 1] = { ...last, toolCalls: [...(last.toolCalls ?? []), tc] };
        useChatStore.setState({ messages });
      }
    };

    const onToolCallResult = (msg: WSMessage) => {
      const data = msg.data as { id?: string; result?: unknown; error?: string } | undefined;
      if (!data?.id) return;
      const store = useChatStore.getState();
      const messages = [...store.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        const tr = { id: data.id, result: data.result, error: data.error };
        messages[messages.length - 1] = { ...last, toolResults: [...(last.toolResults ?? []), tr] };
        useChatStore.setState({ messages });
      }
    };

    const onStatusChange = (msg: WSMessage) => {
      const data = msg.data as { status?: string } | undefined;
      if (data?.status) {
        useChatStore.getState().setWsStatus(data.status as 'connected' | 'disconnected' | 'reconnecting');
      }
    };

    wsClient.on('stream_start', onStreamStart);
    wsClient.on('stream_chunk', onStreamChunk);
    wsClient.on('stream_end', onStreamEnd);
    wsClient.on('error', onError);
    wsClient.on('tool_call_start', onToolCallStart);
    wsClient.on('tool_call_result', onToolCallResult);
    wsClient.on('status_change', onStatusChange);

    // Session compaction notification — reload messages
    const onResourceUpdate = (msg: WSMessage) => {
      const data = msg.data as { event?: string } | undefined;
      if (data?.event === 'session_compacted' && msg.sessionId) {
        const activeId = useSessionStore.getState().activeSessionId;
        if (msg.sessionId === activeId) {
          get<{ messages: Array<{ role: string; content: string; timestamp: string }> }>(`/sessions/${msg.sessionId}`).then((session) => {
            useChatStore.getState().setMessages(
              (session.messages ?? []).map((m: any) => ({
                id: `msg-${Date.now()}-${Math.random()}`,
                role: m.role,
                content: m.content,
                timestamp: m.timestamp ?? new Date().toISOString(),
              }))
            );
          }).catch(() => {});
        }
      }
    };
    wsClient.on('resource_update', onResourceUpdate);

    return () => {
      wsClient.off('stream_start', onStreamStart);
      wsClient.off('stream_chunk', onStreamChunk);
      wsClient.off('stream_end', onStreamEnd);
      wsClient.off('error', onError);
      wsClient.off('tool_call_start', onToolCallStart);
      wsClient.off('tool_call_result', onToolCallResult);
      wsClient.off('status_change', onStatusChange);
      wsClient.off('resource_update', onResourceUpdate);
      wsClient.disconnect();
    };
  }, []);

  return (
    <>
      <AppLayout />
      <GlobalConfirmDialog />
    </>
  );
}

function GlobalConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const close = useConfirmStore((s) => s.close);

  if (!request) return null;

  return (
    <ConfirmDialog
      open
      title={request.title}
      message={request.message}
      onConfirm={() => {
        close();
        request.onConfirm();
      }}
      onCancel={() => {
        close();
        request.onCancel();
      }}
    />
  );
}

export default App;
