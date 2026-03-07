// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ChatInput from './ChatInput';
import { useChatStore } from '../../stores/chatStore';

describe('ChatInput', () => {
  beforeEach(() => {
    useChatStore.setState({
      isStreaming: false,
      error: null,
      messages: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders textarea with correct placeholder', () => {
    render(<ChatInput />);
    const textarea = screen.getByPlaceholderText('输入消息...');
    expect(textarea).toBeDefined();
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('renders send button', () => {
    render(<ChatInput />);
    const button = screen.getByRole('button', { name: '发送' });
    expect(button).toBeDefined();
  });

  it('disables send button when input is empty', () => {
    render(<ChatInput />);
    const button = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('enables send button when input has text', () => {
    render(<ChatInput />);
    const textarea = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    const button = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('shows stop button and queue placeholder when isStreaming is true', () => {
    useChatStore.setState({ isStreaming: true });
    render(<ChatInput />);
    const textarea = screen.getByPlaceholderText('输入消息排队，或输入 /stop 中止...') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false); // textarea stays enabled for queuing
    const stopButton = screen.getByRole('button', { name: '停止' });
    expect(stopButton).toBeDefined();
  });

  it('calls sendMessage and clears input on send button click', async () => {
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: sendMessageMock });

    render(<ChatInput />);
    const textarea = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    const button = screen.getByRole('button', { name: '发送' });
    fireEvent.click(button);

    expect(sendMessageMock).toHaveBeenCalledWith('Hello');
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('sends message on Enter key press', () => {
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: sendMessageMock });

    render(<ChatInput />);
    const textarea = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(sendMessageMock).toHaveBeenCalledWith('Test message');
  });

  it('does not send on Shift+Enter (allows newline)', () => {
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: sendMessageMock });

    render(<ChatInput />);
    const textarea = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(textarea, { target: { value: 'Line 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('does not send when input is only whitespace', () => {
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: sendMessageMock });

    render(<ChatInput />);
    const textarea = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
