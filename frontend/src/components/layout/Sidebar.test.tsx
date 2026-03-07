// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Sidebar from './Sidebar';

describe('Sidebar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the app title', () => {
    render(<Sidebar />);
    expect(screen.getByText('AI 助手')).toBeDefined();
  });

  it('renders session list placeholder when no sessionList prop', () => {
    render(<Sidebar />);
    expect(screen.getByText('会话列表将在此处展示')).toBeDefined();
  });

  it('renders model selector placeholder when no modelSelector prop', () => {
    render(<Sidebar />);
    expect(screen.getByText('模型选择器')).toBeDefined();
  });

  it('renders custom sessionList when provided', () => {
    render(<Sidebar sessionList={<div>Custom Sessions</div>} />);
    expect(screen.getByText('Custom Sessions')).toBeDefined();
    expect(screen.queryByText('会话列表将在此处展示')).toBeNull();
  });

  it('renders custom modelSelector when provided', () => {
    render(<Sidebar modelSelector={<div>Custom Model</div>} />);
    expect(screen.getByText('Custom Model')).toBeDefined();
    expect(screen.queryByText('模型选择器')).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(<Sidebar className="test-class" />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('test-class');
  });

  it('has a scrollable session list area', () => {
    render(<Sidebar />);
    const scrollArea = screen.getByText('会话列表将在此处展示').closest('div');
    expect(scrollArea?.className).toContain('overflow-y-auto');
    expect(scrollArea?.className).toContain('flex-1');
  });

  it('has a bottom border on the model selector area', () => {
    render(<Sidebar />);
    const modelArea = screen.getByText('模型选择器').closest('div');
    expect(modelArea?.className).toContain('border-t');
  });
});
