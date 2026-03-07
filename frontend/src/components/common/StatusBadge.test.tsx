// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders default label for each status', () => {
    const cases = [
      { status: 'running' as const, label: '运行中' },
      { status: 'idle' as const, label: '空闲' },
      { status: 'error' as const, label: '错误' },
      { status: 'success' as const, label: '成功' },
      { status: 'warning' as const, label: '警告' },
      { status: 'info' as const, label: '信息' },
    ];

    for (const { status, label } of cases) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeDefined();
      unmount();
    }
  });

  it('renders custom label when provided', () => {
    render(<StatusBadge status="running" label="Active" />);
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('applies correct color classes for error status', () => {
    render(<StatusBadge status="error" />);
    const badge = screen.getByText('错误');
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-700');
  });

  it('applies correct color classes for success status', () => {
    render(<StatusBadge status="success" />);
    const badge = screen.getByText('成功');
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-700');
  });
});
