// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SessionItem from './SessionItem';
import type { SessionSummary } from '../../types';

const makeSession = (overrides?: Partial<SessionSummary>): SessionSummary => ({
  id: 's1',
  title: '测试会话',
  model: 'gpt-3.5-turbo',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T12:00:00Z',
  messageCount: 5,
  ...overrides,
});

describe('SessionItem', () => {
  afterEach(cleanup);

  it('renders session title and formatted time', () => {
    const session = makeSession();
    render(
      <SessionItem session={session} isActive={false} onSelect={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('测试会话')).toBeDefined();
    // updatedAt should be rendered as localized string
    expect(screen.getByText(new Date(session.updatedAt).toLocaleString())).toBeDefined();
  });

  it('shows "新会话" when title is empty', () => {
    render(
      <SessionItem session={makeSession({ title: '' })} isActive={false} onSelect={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('新会话')).toBeDefined();
  });

  it('highlights when active', () => {
    const { container } = render(
      <SessionItem session={makeSession()} isActive={true} onSelect={vi.fn()} onDelete={vi.fn()} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bg-blue-100');
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(
      <SessionItem session={makeSession()} isActive={false} onSelect={onSelect} onDelete={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('测试会话'));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  it('calls onDelete when delete button clicked without triggering onSelect', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      <SessionItem session={makeSession()} isActive={false} onSelect={onSelect} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByLabelText('删除会话 测试会话'));
    expect(onDelete).toHaveBeenCalledWith('s1');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
