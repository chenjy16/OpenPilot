import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

describe('UIStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      activeTab: 'chat',
      sidebarCollapsed: false,
      toolPanelCollapsed: true,
      activeToolTab: 'system-monitor',
      focusMode: false,
    });
  });

  it('should have correct default values', () => {
    const state = useUIStore.getState();
    expect(state.activeTab).toBe('chat');
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.toolPanelCollapsed).toBe(true);
    expect(state.activeToolTab).toBe('system-monitor');
  });

  it('setActiveTab should update activeTab', () => {
    useUIStore.getState().setActiveTab('sessions');
    expect(useUIStore.getState().activeTab).toBe('sessions');

    useUIStore.getState().setActiveTab('debug');
    expect(useUIStore.getState().activeTab).toBe('debug');
  });

  it('toggleSidebar should toggle sidebarCollapsed', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it('toggleToolPanel should toggle toolPanelCollapsed', () => {
    useUIStore.getState().toggleToolPanel();
    expect(useUIStore.getState().toolPanelCollapsed).toBe(false);

    useUIStore.getState().toggleToolPanel();
    expect(useUIStore.getState().toolPanelCollapsed).toBe(true);
  });

  it('setActiveToolTab should update activeToolTab', () => {
    useUIStore.getState().setActiveToolTab('file-browser');
    expect(useUIStore.getState().activeToolTab).toBe('file-browser');

    useUIStore.getState().setActiveToolTab('audit-log');
    expect(useUIStore.getState().activeToolTab).toBe('audit-log');
  });

  it('toggling sidebar should not affect other state', () => {
    useUIStore.getState().setActiveToolTab('file-browser');
    useUIStore.getState().toggleSidebar();

    const state = useUIStore.getState();
    expect(state.sidebarCollapsed).toBe(true);
    expect(state.toolPanelCollapsed).toBe(true);
    expect(state.activeToolTab).toBe('file-browser');
  });

  it('setFocusMode should update focusMode', () => {
    useUIStore.getState().setFocusMode(true);
    expect(useUIStore.getState().focusMode).toBe(true);

    useUIStore.getState().setFocusMode(false);
    expect(useUIStore.getState().focusMode).toBe(false);
  });
});
