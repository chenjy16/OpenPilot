// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigStore } from './configStore';

describe('ConfigStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useConfigStore.setState({ selectedModel: 'gpt-3.5-turbo' });
    localStorage.clear();
  });

  it('should have gpt-3.5-turbo as default model', () => {
    expect(useConfigStore.getState().selectedModel).toBe('gpt-3.5-turbo');
  });

  it('should update selectedModel when setModel is called', () => {
    useConfigStore.getState().setModel('gpt-4');
    expect(useConfigStore.getState().selectedModel).toBe('gpt-4');
  });

  it('should persist selectedModel to localStorage', () => {
    useConfigStore.getState().setModel('claude-3-sonnet');

    const stored = JSON.parse(localStorage.getItem('ai-assistant-config') || '{}');
    expect(stored.state.selectedModel).toBe('claude-3-sonnet');
  });

  it('should restore selectedModel from localStorage on rehydration', () => {
    localStorage.setItem(
      'ai-assistant-config',
      JSON.stringify({ state: { selectedModel: 'gpt-4' }, version: 0 })
    );

    // Trigger rehydration
    useConfigStore.persist.rehydrate();

    expect(useConfigStore.getState().selectedModel).toBe('gpt-4');
  });
});
