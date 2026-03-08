// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ToolCallMessage from './ToolCallMessage';
import type { ToolCall, ToolResult } from '../../types';

describe('ToolCallMessage', () => {
  afterEach(() => {
    cleanup();
  });

  const toolCalls: ToolCall[] = [
    { id: 'tc-1', name: 'search_files', arguments: { query: 'test', path: '/src' } },
    { id: 'tc-2', name: 'read_file', arguments: { path: '/src/index.ts' } },
  ];

  it('renders each tool call with tool name visible in collapsed state', () => {
    render(<ToolCallMessage toolCalls={toolCalls} />);
    expect(screen.getByText('search_files')).toBeDefined();
    expect(screen.getByText('read_file')).toBeDefined();
  });

  it('displays tool arguments after expanding', () => {
    render(<ToolCallMessage toolCalls={[toolCalls[0]]} />);
    // Click to expand
    fireEvent.click(screen.getByText('search_files'));
    const pre = screen.getByText(/"query": "test"/);
    expect(pre).toBeDefined();
  });

  it('shows tool results after expanding', () => {
    const results: ToolResult[] = [
      { id: 'tc-1', result: { files: ['a.ts', 'b.ts'] } },
    ];
    render(<ToolCallMessage toolCalls={[toolCalls[0]]} toolResults={results} />);
    fireEvent.click(screen.getByText('search_files'));
    expect(screen.getByText(/"files"/)).toBeDefined();
  });

  it('shows error result after expanding', () => {
    const results: ToolResult[] = [
      { id: 'tc-1', error: 'File not found' },
    ];
    render(<ToolCallMessage toolCalls={[toolCalls[0]]} toolResults={results} />);
    // Error status badge visible in collapsed state
    expect(screen.getByText('失败')).toBeDefined();
    // Expand to see error detail
    fireEvent.click(screen.getByText('search_files'));
    expect(screen.getByText('File not found')).toBeDefined();
  });

  it('renders without results when toolResults is undefined', () => {
    render(<ToolCallMessage toolCalls={toolCalls} />);
    expect(screen.getByText('search_files')).toBeDefined();
  });

  it('shows string results after expanding', () => {
    const results: ToolResult[] = [
      { id: 'tc-1', result: 'Operation completed successfully' },
    ];
    render(<ToolCallMessage toolCalls={[toolCalls[0]]} toolResults={results} />);
    // Shows "完成" badge in collapsed state
    expect(screen.getByText('完成')).toBeDefined();
    // Expand to see result
    fireEvent.click(screen.getByText('search_files'));
    expect(screen.getByText('Operation completed successfully')).toBeDefined();
  });
});
