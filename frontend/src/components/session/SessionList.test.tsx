// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import SessionList from './SessionList';
import { useSessionStore } from '../../stores/sessionStore';
import { useChatStore } from '../../stores/chatStore';
import type { SessionSummary } from '../../types';

// Mock apiClient so SessionList's direct get() call doesn't hit the network
vi.mock('../../services/apiClient', () => ({
  get: vi.fn().mockResolvedValue({ messages: [] }),
  post: vi.fn(),
  del: vi.fn(),
}));

const makeSessions = (count: number): SessionSummary[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    title: `会话 ${i + 1}`,
    model: 'gpt-3.5-turbo',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    messageCount: i,
  }));

describe('SessionList', () => {
  beforeEach(() => {
    // Reset stores to a known state before each test
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      loading: false,
      error: null,
    });
    useChatStore.setState({ messages: [] });
  });

  afterEach(cleanup);

  it('calls fetchSessions on mount', () => {
    const fetchSessions = vi.fn();
    useSessionStore.setState({ fetchSessions });
    render(<SessionList />);
    expect(fetchSessions).toHaveBeenCalled();
  });

  it('renders "新建会话" button', () => {
    render(<SessionList />);
    expect(screen.getByText('+ 新建会话')).toBeDefined();
  });

  it('shows empty state when no sessions', () => {
    useSessionStore.setState({ sessions: [], loading: false });
    render(<SessionList />);
    expect(screen.getByText(/暂无会话/)).toBeDefined();
  });

  it('renders session items', () => {
    useSessionStore.setState({ sessions: makeSessions(3), loading: false });
    render(<SessionList />);
    expect(screen.getByText('会话 1')).toBeDefined();
    expect(screen.getByText('会话 2')).toBeDefined();
    expect(screen.getByText('会话 3')).toBeDefined();
  });

  it('shows ErrorBanner when error exists', () => {
    useSessionStore.setState({ error: '加载失败' });
    render(<SessionList />);
    expect(screen.getByText('加载失败')).toBeDefined();
  });

  it('dismisses error when ErrorBanner dismiss is clicked', () => {
    useSessionStore.setState({ error: '加载失败' });
    render(<SessionList />);
    fireEvent.click(screen.getByLabelText('关闭错误提示'));
    expect(useSessionStore.getState().error).toBeNull();
  });

  it('calls createSession when "新建会话" button is clicked', () => {
    const createSession = vi.fn();
    useSessionStore.setState({ createSession });
    render(<SessionList />);
    fireEvent.click(screen.getByText('+ 新建会话'));
    expect(createSession).toHaveBeenCalled();
  });

  it('calls setActiveSession when a session item is clicked', async () => {
    const setActiveSession = vi.fn().mockResolvedValue(undefined);
    useSessionStore.setState({
      sessions: makeSessions(2),
      activeSessionId: 's1',
      setActiveSession,
    });
    render(<SessionList />);
    fireEvent.click(screen.getByText('会话 2'));
    await waitFor(() => {
      expect(setActiveSession).toHaveBeenCalledWith('s2');
    });
  });

  it('does not call setActiveSession when clicking the already active session', () => {
    const setActiveSession = vi.fn();
    useSessionStore.setState({
      sessions: makeSessions(1),
      activeSessionId: 's1',
      setActiveSession,
    });
    render(<SessionList />);
    fireEvent.click(screen.getByText('会话 1'));
    expect(setActiveSession).not.toHaveBeenCalled();
  });

  it('calls deleteSession when delete button is clicked', () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    useSessionStore.setState({
      sessions: makeSessions(1),
      deleteSession,
    });
    render(<SessionList />);
    fireEvent.click(screen.getByLabelText('删除会话 会话 1'));
    expect(deleteSession).toHaveBeenCalledWith('s1');
  });
});
