import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToday } from './use-today';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useToday', () => {
  it('rolls over at midnight on focus', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 23, 59, 30));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-11-03');

    vi.setSystemTime(new Date(2026, 10, 4, 0, 0, 30)); // the Mac slept through midnight
    expect(result.current).toBe('2026-11-03');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe('2026-11-04');
  });

  it('rolls over when the window becomes visible again', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 23, 59, 30));
    const { result } = renderHook(() => useToday());
    vi.setSystemTime(new Date(2026, 10, 4, 0, 0, 30));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-11-04');
  });

  it('rolls over on its own within a minute', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 23, 59, 30));
    const { result } = renderHook(() => useToday());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-11-04');
  });
});
