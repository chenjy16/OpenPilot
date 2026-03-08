// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MessageList from './MessageList';
import { useChatStore } from '../../stores/chatStore';
import type { Message } from '../../types';

// Mock scrollIntoView
const scrollIntoViewMock = vi.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

describe('MessageList', () => {
  beforeEach(() => {
    useChatStore.setState({ messages: [] });
    scrollIntoViewMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  const userMessage: Message = {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    timestamp: new Date().toISOString(),
  };

  const assistantMessage: Message = {
    id: 'msg-2',
    role: 'assistant',
    content: 'Hi there',
    timestamp: new Date().toISOString(),
  };

  const messageWithToolCalls: Message = {
    id: 'msg-3',
    role: 'assistant',
    content: 'Let me search for that.',
    timestamp: new Date().toISOString(),
    toolCalls: [
      { id: 'tc-1', name: 'search_files', arguments: { query: 'test' } },
    ],
    toolResults: [
      { id: 'tc-1', result: 'Found 3 files' },
    ],
  };

  it('renders an empty list when there are no messages', () => {
    render(<MessageList />);
    const list = screen.getByTestId('message-list');
    // Empty state message + bottom sentinel div
    expect(list.textContent).toContain('发送消息开始对话');
  });

  it('renders user and assistant messages', () => {
    useChatStore.setState({ messages: [userMessage, assistantMessage] });
    render(<MessageList />);
    expect(screen.getByText('Hello')).toBeDefined();
    expect(screen.getByText('Hi there')).toBeDefined();
  });

  it('renders ToolCallMessage when message has toolCalls', () => {
    useChatStore.setState({ messages: [messageWithToolCalls] });
    render(<MessageList />);
    // Tool name visible in collapsed state
    expect(screen.getByText('search_files')).toBeDefined();
    // Result badge visible in collapsed state
    expect(screen.getByText('完成')).toBeDefined();
  });

  it('does not render ToolCallMessage when message has no toolCalls', () => {
    useChatStore.setState({ messages: [userMessage] });
    render(<MessageList />);
    expect(screen.queryByText('🔧')).toBeNull();
  });

  it('calls scrollIntoView when messages change', () => {
    const { rerender } = render(<MessageList />);
    scrollIntoViewMock.mockClear();

    useChatStore.setState({ messages: [userMessage] });
    rerender(<MessageList />);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('renders messages in order', () => {
    useChatStore.setState({ messages: [userMessage, assistantMessage] });
    const { container } = render(<MessageList />);
    const list = container.querySelector('[data-testid="message-list"]')!;
    const textContents = Array.from(list.children)
      .map((el) => el.textContent)
      .filter(Boolean);
    expect(textContents[0]).toContain('Hello');
    expect(textContents[1]).toContain('Hi there');
  });
});
