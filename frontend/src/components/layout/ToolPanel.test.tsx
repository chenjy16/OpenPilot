// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ToolPanel from './ToolPanel';
import { useUIStore } from '../../stores/uiStore';

describe('ToolPanel', () => {
  beforeEach(() => {
    useUIStore.setState({ activeToolTab: 'system-monitor' });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a tab bar with all tool tabs', () => {
    render(<ToolPanel />);
    const tablist = screen.getByRole('tablist', { name: '工具面板标签页' });
    expect(tablist).toBeDefined();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(17);
  });

  it('highlights the active tab', () => {
    render(<ToolPanel />);
    const activeTab = screen.getByRole('tab', { name: '系统监控' });
    expect(activeTab.getAttribute('aria-selected')).toBe('true');
    expect(activeTab.className).toContain('bg-blue-100');
  });

  it('renders placeholder content for the active tab', () => {
    render(<ToolPanel />);
    expect(screen.getByText('系统监控（system-monitor）')).toBeDefined();
  });

  it('switches tab on click and updates store', () => {
    render(<ToolPanel />);

    const fileTab = screen.getByRole('tab', { name: '文件浏览器' });
    fireEvent.click(fileTab);

    expect(useUIStore.getState().activeToolTab).toBe('file-browser');
    expect(screen.getByText('文件浏览器（file-browser）')).toBeDefined();
  });

  it('renders the correct tab IDs', () => {
    const expectedIds = [
      'system-monitor', 'file-browser', 'browser-control', 'web-automation',
      'operation-recorder', 'process-manager', 'script-executor', 'audit-log',
      'network-client', 'email-client', 'task-scheduler', 'crypto-manager',
      'code-toolkit', 'media-processor', 'db-manager', 'cloud-service', 'system-config',
    ];

    for (const id of expectedIds) {
      useUIStore.setState({ activeToolTab: id });
      const { unmount } = render(<ToolPanel />);
      const panel = screen.getByRole('tabpanel');
      expect(panel.textContent).toContain(id);
      unmount();
    }
  });

  it('tab bar has overflow-x-auto for horizontal scrolling', () => {
    render(<ToolPanel />);
    const tablist = screen.getByRole('tablist', { name: '工具面板标签页' });
    expect(tablist.className).toContain('overflow-x-auto');
  });

  it('inactive tabs do not have active styling', () => {
    render(<ToolPanel />);
    const inactiveTab = screen.getByRole('tab', { name: '审计日志' });
    expect(inactiveTab.getAttribute('aria-selected')).toBe('false');
    expect(inactiveTab.className).not.toContain('bg-blue-100');
  });
});
