// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmAction } from './useConfirmAction';
import { useConfirmStore } from '../stores/confirmStore';
import { useSecurityStore } from '../stores/securityStore';
import * as auditService from '../services/auditService';

vi.mock('../services/auditService', () => ({
  logCancelled: vi.fn(),
}));

// Stub apiClient so securityStore doesn't make real requests
vi.mock('../services/apiClient', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

describe('useConfirmAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmStore.setState({ request: null });
    useSecurityStore.setState({ userPermissionLevel: 'admin' });
  });

  it('executes normal-permission actions immediately without dialog', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useConfirmAction('file.read'));

    act(() => {
      result.current.execute(fn);
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it('shows confirm dialog for elevated-permission actions', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useConfirmAction('script.execute'));

    act(() => {
      result.current.execute(fn);
    });

    // Action should NOT have been called yet
    expect(fn).not.toHaveBeenCalled();
    // Dialog should be open
    expect(useConfirmStore.getState().request).not.toBeNull();
  });

  it('runs the action when user confirms the dialog', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useConfirmAction('script.execute'));

    act(() => {
      result.current.execute(fn);
    });

    const request = useConfirmStore.getState().request!;
    act(() => {
      request.onConfirm();
    });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('logs cancellation to audit when user cancels the dialog', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useConfirmAction('process.stop'));

    act(() => {
      result.current.execute(fn, { pid: 123 });
    });

    const request = useConfirmStore.getState().request!;
    act(() => {
      request.onCancel();
    });

    expect(fn).not.toHaveBeenCalled();
    expect(auditService.logCancelled).toHaveBeenCalledWith(
      'process.stop',
      { pid: 123 },
    );
  });

  it('does not execute when user lacks permission', () => {
    useSecurityStore.setState({ userPermissionLevel: 'normal' });
    const fn = vi.fn();
    const { result } = renderHook(() => useConfirmAction('process.stop'));

    expect(result.current.allowed).toBe(false);

    act(() => {
      result.current.execute(fn);
    });

    expect(fn).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it('uses custom title and message when provided', () => {
    const { result } = renderHook(() =>
      useConfirmAction('crypto.encrypt', {
        title: '加密确认',
        message: '确定要加密此文件？',
      }),
    );

    act(() => {
      result.current.execute(vi.fn());
    });

    const request = useConfirmStore.getState().request!;
    expect(request.title).toBe('加密确认');
    expect(request.message).toBe('确定要加密此文件？');
  });
});
