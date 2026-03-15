// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AppLayout from './AppLayout';
import { useUIStore } from '../../stores/uiStore';

// Mock fetch for SessionList's fetchSessions call
vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
));

// Mock scrollIntoView for jsdom (used by MessageList inside ChatArea)
Element.prototype.scrollIntoView = vi.fn();

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

describe('AppLayout', () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    useUIStore.setState({
      activeTab: 'chat',
      sidebarCollapsed: false,
      toolPanelCollapsed: true,
      activeToolTab: 'system-monitor',
      focusMode: false,
    });
    // Default to desktop viewport
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1280,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders navigation sidebar with OpenPilot branding', () => {
    render(<AppLayout />);
    expect(screen.getAllByText('OpenPilot').length).toBeGreaterThan(0);
  });

  it('renders chat view by default with session list and chat area', () => {
    render(<AppLayout />);
    // Chat view includes SessionList with "新建会话" button
    expect(screen.getByText('+ 新建会话')).toBeDefined();
    // Chat view includes ChatArea with status badge and compact button
    expect(screen.getByText('压缩会话')).toBeDefined();
  });

  it('renders navigation tabs from all groups', () => {
    render(<AppLayout />);
    // Check nav items exist (use getAllByText for items that appear in multiple places)
    expect(screen.getByText('对话')).toBeDefined();
    expect(screen.getByText('总览')).toBeDefined();
    // '会话' appears in both nav and chat panel, so use getAllByText
    expect(screen.getAllByText('会话').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('渠道')).toBeDefined();
    // '模型' appears in both nav and model selector, so use getAllByText
    expect(screen.getAllByText('模型').length).toBeGreaterThanOrEqual(1);
  });

  it('switches view when nav tab is clicked', () => {
    render(<AppLayout />);
    // Click on "总览" (overview) tab — unambiguous
    fireEvent.click(screen.getByText('总览'));
    // Overview view should show "系统总览" heading
    expect(screen.getByText('系统总览')).toBeDefined();
  });

  it('sidebar collapses on mobile viewport', () => {
    setViewportWidth(768);
    render(<AppLayout />);
    const state = useUIStore.getState();
    expect(state.sidebarCollapsed).toBe(true);
  });

  it('shows overlay backdrop when sidebar is open on mobile', () => {
    useUIStore.setState({ sidebarCollapsed: false });
    render(<AppLayout />);
    const overlay = document.querySelector('[aria-hidden="true"]');
    expect(overlay).not.toBeNull();
  });

  it('clicking overlay closes sidebar', () => {
    useUIStore.setState({ sidebarCollapsed: false });
    render(<AppLayout />);
    const overlay = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it('sidebar applies -translate-x-full when collapsed', () => {
    useUIStore.setState({ sidebarCollapsed: true });
    render(<AppLayout />);
    const sidebar = screen.getAllByText('OpenPilot')[0].closest('aside');
    expect(sidebar?.className).toContain('-translate-x-full');
  });

  it('uses flex and h-screen on root container', () => {
    const { container } = render(<AppLayout />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('flex');
    expect(root?.className).toContain('h-screen');
  });

  it('renders stub views for unimplemented tabs', () => {
    render(<AppLayout />);
    fireEvent.click(screen.getByText('渠道'));
    expect(screen.getByText('渠道管理')).toBeDefined();
  });
});
