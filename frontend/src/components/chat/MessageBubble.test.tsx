// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MessageBubble from './MessageBubble';
import type { Message } from '../../types';

describe('MessageBubble', () => {
  afterEach(() => {
    cleanup();
  });

  const baseMessage: Message = {
    id: 'msg-1',
    role: 'user',
    content: 'Hello world',
    timestamp: new Date().toISOString(),
  };

  it('renders user message with right alignment and blue background', () => {
    const { container } = render(<MessageBubble message={baseMessage} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('justify-end');
    const bubble = wrapper.firstElementChild as HTMLElement;
    expect(bubble.className).toContain('bg-blue-500');
    expect(bubble.className).toContain('text-white');
  });

  it('renders assistant message with left alignment and gray background', () => {
    const msg: Message = { ...baseMessage, role: 'assistant' };
    const { container } = render(<MessageBubble message={msg} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('justify-start');
    const bubble = wrapper.firstElementChild as HTMLElement;
    expect(bubble.className).toContain('bg-gray-100');
    expect(bubble.className).toContain('text-gray-900');
  });

  it('renders message content as markdown', () => {
    const msg: Message = { ...baseMessage, content: '**bold text**' };
    render(<MessageBubble message={msg} />);
    const strong = screen.getByText('bold text');
    expect(strong.tagName).toBe('STRONG');
  });

  it('shows blinking cursor when message is streaming', () => {
    const msg: Message = { ...baseMessage, role: 'assistant', isStreaming: true };
    render(<MessageBubble message={msg} />);
    const cursor = screen.getByTestId('streaming-cursor');
    expect(cursor.textContent).toBe('▊');
    expect(cursor.className).toContain('animate-pulse');
  });

  it('does not show cursor when message is not streaming', () => {
    const msg: Message = { ...baseMessage, role: 'assistant', isStreaming: false };
    render(<MessageBubble message={msg} />);
    expect(screen.queryByTestId('streaming-cursor')).toBeNull();
  });

  it('renders inline code', () => {
    const msg: Message = { ...baseMessage, content: 'Use `console.log`' };
    render(<MessageBubble message={msg} />);
    const code = screen.getByText('console.log');
    expect(code.tagName).toBe('CODE');
  });
});
