// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ChatArea from './ChatArea';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

// Mock wsClient with all methods used by ChatArea
vi.mock('../../services/wsClient', () => ({
  wsClient: {
    manualReconnect: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

import { wsClient } from '../../services/wsClient';

describe('ChatArea', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      wsStatus: 'connected',
      error: null,
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: 'session-1',
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders toolbar with status badge, compact button, and chat components', () => {
    render(<ChatArea />);
    expect(screen.getByText('已连接')).toBeDefined();
    expect(screen.getByText('压缩会话')).toBeDefined();
    expect(screen.getByPlaceholderText('输入消息...')).toBeDefined();
  });

  it('shows success status badge when connected', () => {
    render(<ChatArea />);
    const badge = screen.getByText('已连接');
    expect(badge.className).toContain('bg-green-100');
  });

  it('shows error status badge when disconnected', () => {
    useChatStore.setState({ wsStatus: 'disconnected' });
    render(<ChatArea />);
    const badge = screen.getByText('已断开');
    expect(badge.className).toContain('bg-red-100');
  });

  it('shows warning status badge when reconnecting', () => {
    useChatStore.setState({ wsStatus: 'reconnecting' });
    render(<ChatArea />);
    const badge = screen.getByText('重连中');
    expect(badge.className).toContain('bg-yellow-100');
  });

  it('shows reconnect button only when disconnected', () => {
    useChatStore.setState({ wsStatus: 'connected' });
    render(<ChatArea />);
    expect(screen.queryByText('重新连接')).toBeNull();

    cleanup();
    useChatStore.setState({ wsStatus: 'disconnected' });
    render(<ChatArea />);
    expect(screen.getByText('重新连接')).toBeDefined();
  });

  it('calls wsClient.manualReconnect when reconnect button clicked', () => {
    useChatStore.setState({ wsStatus: 'disconnected' });
    render(<ChatArea />);
    fireEvent.click(screen.getByText('重新连接'));
    expect(wsClient.manualReconnect).toHaveBeenCalledOnce();
  });

  it('disables compact button when no active session', () => {
    useSessionStore.setState({ activeSessionId: null });
    render(<ChatArea />);
    const btn = screen.getByText('压缩会话') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('calls compactSession when compact button clicked', async () => {
    const compactMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ compactSession: compactMock } as any);
    render(<ChatArea />);

    fireEvent.click(screen.getByText('压缩会话'));
    await waitFor(() => {
      expect(compactMock).toHaveBeenCalledWith('session-1');
    });
  });

  it('shows ErrorBanner when error is set', () => {
    useChatStore.setState({ error: '压缩失败' });
    render(<ChatArea />);
    expect(screen.getByText('压缩失败')).toBeDefined();
  });

  it('does not show ErrorBanner when error is null', () => {
    useChatStore.setState({ error: null });
    render(<ChatArea />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows streaming indicator when isStreaming', () => {
    useChatStore.setState({ isStreaming: true });
    render(<ChatArea />);
    expect(screen.getByText('生成中')).toBeDefined();
  });

  it('registers and cleans up tool stream listeners', () => {
    const { unmount } = render(<ChatArea />);
    expect(wsClient.on).toHaveBeenCalledWith('tool_call_start', expect.any(Function));
    expect(wsClient.on).toHaveBeenCalledWith('tool_call_result', expect.any(Function));
    unmount();
    expect(wsClient.off).toHaveBeenCalledWith('tool_call_start', expect.any(Function));
    expect(wsClient.off).toHaveBeenCalledWith('tool_call_result', expect.any(Function));
  });
});
