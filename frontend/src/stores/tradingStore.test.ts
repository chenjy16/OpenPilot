import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTradingStore } from './tradingStore';

// Mock the apiClient module
vi.mock('../services/apiClient', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

import { get } from '../services/apiClient';

const mockGet = vi.mocked(get);

describe('tradingStore - auto trading extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useTradingStore.setState({
      pipelineStatus: null,
      stopLossRecords: [],
      pipelineSignals: [],
      error: null,
    });
  });

  describe('initial state', () => {
    it('should have null pipelineStatus', () => {
      expect(useTradingStore.getState().pipelineStatus).toBeNull();
    });

    it('should have empty stopLossRecords', () => {
      expect(useTradingStore.getState().stopLossRecords).toEqual([]);
    });

    it('should have empty pipelineSignals', () => {
      expect(useTradingStore.getState().pipelineSignals).toEqual([]);
    });
  });

  describe('fetchPipelineStatus', () => {
    it('should fetch and set pipeline status', async () => {
      const mockStatus = {
        enabled: true,
        last_signal_processed_at: 1700000000,
        recent_signals: [{ signal_id: 1, action: 'order_created' as const, order_id: 10 }],
        active_stop_loss_count: 3,
      };
      mockGet.mockResolvedValueOnce(mockStatus);

      await useTradingStore.getState().fetchPipelineStatus();

      expect(mockGet).toHaveBeenCalledWith('/trading/pipeline/status');
      expect(useTradingStore.getState().pipelineStatus).toEqual(mockStatus);
    });

    it('should set error on failure', async () => {
      mockGet.mockRejectedValueOnce(new Error('Network error'));

      await useTradingStore.getState().fetchPipelineStatus();

      expect(useTradingStore.getState().error).toBe('Network error');
    });
  });

  describe('fetchStopLossRecords', () => {
    it('should fetch and set stop loss records', async () => {
      const mockRecords = [
        {
          id: 1,
          order_id: 100,
          symbol: '0700.HK',
          side: 'buy' as const,
          entry_price: 350,
          stop_loss: 330,
          take_profit: 380,
          status: 'active' as const,
          created_at: 1700000000,
        },
      ];
      mockGet.mockResolvedValueOnce(mockRecords);

      await useTradingStore.getState().fetchStopLossRecords();

      expect(mockGet).toHaveBeenCalledWith('/trading/stop-loss');
      expect(useTradingStore.getState().stopLossRecords).toEqual(mockRecords);
    });

    it('should set error on failure', async () => {
      mockGet.mockRejectedValueOnce(new Error('Server error'));

      await useTradingStore.getState().fetchStopLossRecords();

      expect(useTradingStore.getState().error).toBe('Server error');
    });
  });

  describe('fetchPipelineSignals', () => {
    it('should fetch and set pipeline signals', async () => {
      const mockSignals = [
        { signal_id: 1, action: 'order_created' as const, order_id: 10 },
        { signal_id: 2, action: 'skipped' as const, reason: 'confidence_below_threshold' },
      ];
      mockGet.mockResolvedValueOnce(mockSignals);

      await useTradingStore.getState().fetchPipelineSignals();

      expect(mockGet).toHaveBeenCalledWith('/trading/pipeline/signals');
      expect(useTradingStore.getState().pipelineSignals).toEqual(mockSignals);
    });

    it('should set error on failure', async () => {
      mockGet.mockRejectedValueOnce(new Error('Timeout'));

      await useTradingStore.getState().fetchPipelineSignals();

      expect(useTradingStore.getState().error).toBe('Timeout');
    });
  });
});
