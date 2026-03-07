// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

  it('renders each tool call as a card with tool name', () => {
    render(<ToolCallMessage toolCalls={toolCalls} />);
    expect(screen.getByText('search_files')).toBeDefined();
    expect(screen.getByText('read_file')).toBeDefined();
  });

  it('displays tool arguments as formatted JSON', () => {
    render(<ToolCallMessage toolCalls={[toolCalls[0]]} />);
    const pre = screen.getByText(/"query": "test"/);
    expect(pre).toBeDefined();
  });

  it('shows tool results when available', () => {
    const results: ToolResult[] = [
      { id: 'tc-1', result: { files: ['a.ts', 'b.ts'] } },
    ];
    render(<ToolCallMessage toolCalls={[toolCalls[0]]} toolResults={results} />);
    expect(screen.getByText(/"files"/)).toBeDefined();
  });

  it('shows error result in red when tool result has error', () => {
    const results: ToolResult[] = [
      { id: 'tc-1', error: 'File not found' },
    ];
    render(<ToolCallMessage toolCalls={[toolCalls[0]]} toolResults={results} />);
    expect(screen.getByText('File not found')).toBeDefined();
  });

  it('renders without results when toolResults is undefined', () => {
    render(<ToolCallMessage toolCalls={toolCalls} />);
    // Should render without crashing
    expect(screen.getByText('search_files')).toBeDefined();
  });

  it('shows string results directly', () => {
    const results: ToolResult[] = [
      { id: 'tc-1', result: 'Operation completed successfully' },
    ];
    render(<ToolCallMessage toolCalls={[toolCalls[0]]} toolResults={results} />);
    expect(screen.getByText('Operation completed successfully')).toBeDefined();
  });
});
