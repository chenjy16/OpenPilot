// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ErrorBanner from './ErrorBanner';

describe('ErrorBanner', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the error message', () => {
    render(<ErrorBanner message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('renders dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="Error" onDismiss={onDismiss} />);
    const btn = screen.getByLabelText('关闭错误提示');
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render dismiss button when onDismiss is omitted', () => {
    render(<ErrorBanner message="Error" />);
    expect(screen.queryByLabelText('关闭错误提示')).toBeNull();
  });

  it('has alert role for accessibility', () => {
    render(<ErrorBanner message="Error" />);
    expect(screen.getByRole('alert')).toBeDefined();
  });
});
