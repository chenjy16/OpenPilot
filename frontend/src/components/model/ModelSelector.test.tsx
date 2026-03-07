// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ModelSelector from './ModelSelector';
import { useConfigStore } from '../../stores/configStore';

// Mock the API client
vi.mock('../../services/apiClient', () => ({
  get: vi.fn().mockRejectedValue(new Error('no api')),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

describe('ModelSelector', () => {
  beforeEach(() => {
    useConfigStore.setState({ selectedModel: 'openai/gpt-4o' });
  });

  afterEach(cleanup);

  it('renders a label "模型"', () => {
    render(<ModelSelector />);
    expect(screen.getByText('模型')).toBeDefined();
  });

  it('renders fallback models when API is unavailable', async () => {
    render(<ModelSelector />);
    // Wait for the API call to fail and fallback to render
    await waitFor(() => {
      const select = screen.getByLabelText('模型') as HTMLSelectElement;
      const options = select.querySelectorAll('option');
      expect(options.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('reflects the current selectedModel from the store', () => {
    render(<ModelSelector />);
    const select = screen.getByLabelText('模型') as HTMLSelectElement;
    expect(select.value).toBe('openai/gpt-4o');
  });

  it('calls setModel on change', async () => {
    render(<ModelSelector />);
    await waitFor(() => {
      const select = screen.getByLabelText('模型') as HTMLSelectElement;
      expect(select.querySelectorAll('option').length).toBeGreaterThan(0);
    });
    const select = screen.getByLabelText('模型') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'anthropic/claude-sonnet-4-20250514' } });
    expect(useConfigStore.getState().selectedModel).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('groups models by provider', async () => {
    render(<ModelSelector />);
    await waitFor(() => {
      const optgroups = screen.getByLabelText('模型').querySelectorAll('optgroup');
      expect(optgroups.length).toBeGreaterThan(0);
    });
  });
});
