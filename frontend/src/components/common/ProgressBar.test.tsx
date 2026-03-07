// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ProgressBar from './ProgressBar';

describe('ProgressBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders with correct fill width', () => {
    render(<ProgressBar value={60} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.style.width).toBe('60%');
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
  });

  it('clamps value below 0 to 0%', () => {
    render(<ProgressBar value={-10} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.style.width).toBe('0%');
  });

  it('clamps value above 100 to 100%', () => {
    render(<ProgressBar value={150} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.style.width).toBe('100%');
  });

  it('renders label and percentage when label is provided', () => {
    render(<ProgressBar value={75} label="CPU" />);
    expect(screen.getByText('CPU')).toBeDefined();
    expect(screen.getByText('75%')).toBeDefined();
  });

  it('does not render label row when label is omitted', () => {
    const { container } = render(<ProgressBar value={50} />);
    expect(container.querySelectorAll('.text-sm').length).toBe(0);
  });
});
