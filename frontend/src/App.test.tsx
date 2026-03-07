// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useChatStore } from './stores/chatStore';
import { useSessionStore } from './stores/sessionStore';
import type { WSMessage } from './services/wsClient';

// Capture registered listeners so we can simulate events
const listeners = new Map<string, Set<(msg: WSMessage) => void>>();

vi.mock('./services/wsClient', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((type: string, cb: (msg: WSMessage) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    }),
    off: vi.fn((type: string, cb: (msg: WSMessage) => void) => {
      listeners.get(type)?.delete(cb);
    }),
  },
}));

// Mock AppLayout to avoid pulling in the full component tree
vi.mock('./components/layout/AppLayout', () => ({
  default: () => <div data-testid="app-layout" />,
}));

import { wsClient } from './services/wsClient';
import App from './App';

function emit(type: string, msg: WSMessage) {
  listeners.get(type)?.forEach((cb) => cb(msg));
}

describe('App – WebSocket event wiring', () => {
  beforeEach(() => {
    listeners.clear();
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      wsStatus: 'disconnected',
      error: null,
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('connects wsClient on mount and registers all event listeners', () => {
    render(<App />);
    expect(wsClient.connect).toHaveBeenCalledOnce();
    expect(wsClient.on).toHaveBeenCalledWith('stream_start', expect.any(Function));
    expect(wsClient.on).toHaveBeenCalledWith('stream_chunk', expect.any(Function));
    expect(wsClient.on).toHaveBeenCalledWith('stream_end', expect.any(Function));
    expect(wsClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(wsClient.on).toHaveBeenCalledWith('status_change', expect.any(Function));
  });

  it('removes listeners and disconnects on unmount', () => {
    const { unmount } = render(<App />);
    unmount();
    expect(wsClient.off).toHaveBeenCalledWith('stream_start', expect.any(Function));
    expect(wsClient.off).toHaveBeenCalledWith('stream_chunk', expect.any(Function));
    expect(wsClient.off).toHaveBeenCalledWith('stream_end', expect.any(Function));
    expect(wsClient.off).toHaveBeenCalledWith('error', expect.any(Function));
    expect(wsClient.off).toHaveBeenCalledWith('status_change', expect.any(Function));
    expect(wsClient.disconnect).toHaveBeenCalledOnce();
  });

  it('dispatches stream_start to ChatStore.startStreaming', () => {
    useSessionStore.setState({ activeSessionId: 'sess-1' });

    render(<App />);
    emit('stream_start', { type: 'stream_start', sessionId: 'sess-1' });

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(true);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('assistant');
    expect(state.messages[0].isStreaming).toBe(true);
  });

  it('dispatches stream_chunk to ChatStore.appendChunk', () => {
    useSessionStore.setState({ activeSessionId: 'sess-1' });

    render(<App />);

    // Start streaming first to create the assistant message
    emit('stream_start', { type: 'stream_start', sessionId: 'sess-1' });
    emit('stream_chunk', { type: 'stream_chunk', data: { text: 'Hello' } });
    emit('stream_chunk', { type: 'stream_chunk', data: { text: ' world' } });

    const state = useChatStore.getState();
    expect(state.messages[0].content).toBe('Hello world');
  });

  it('dispatches stream_end to ChatStore.endStreaming', () => {
    useSessionStore.setState({ activeSessionId: 'sess-1' });

    render(<App />);

    emit('stream_start', { type: 'stream_start', sessionId: 'sess-1' });
    emit('stream_chunk', { type: 'stream_chunk', data: { text: 'Done' } });
    emit('stream_end', { type: 'stream_end', data: { usage: { tokens: 42 } } });

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.messages[0].isStreaming).toBe(false);
    expect(state.messages[0].content).toBe('Done');
  });

  it('dispatches error to ChatStore error state', () => {
    render(<App />);
    emit('error', { type: 'error', data: { message: 'Something went wrong' } });

    expect(useChatStore.getState().error).toBe('Something went wrong');
  });

  it('dispatches status_change to ChatStore.setWsStatus', () => {
    render(<App />);
    emit('status_change', { type: 'status_change' as any, data: { status: 'connected' } });

    expect(useChatStore.getState().wsStatus).toBe('connected');
  });
});
