import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePersistentState } from './use-persistent-state';

afterEach(() => localStorage.clear());

describe('usePersistentState', () => {
  it('falls back to the initial value when nothing is stored', () => {
    const { result } = renderHook(() => usePersistentState('t.a', 'today'));
    expect(result.current[0]).toBe('today');
  });

  it('writes through to localStorage under the hq.view. namespace', () => {
    const { result } = renderHook(() => usePersistentState('t.b', 0));
    act(() => result.current[1](5));
    expect(result.current[0]).toBe(5);
    expect(localStorage.getItem('hq.view.t.b')).toBe('5');
  });

  it('restores a previously stored value on mount', () => {
    localStorage.setItem('hq.view.t.c', JSON.stringify({ status: 'ready' }));
    const { result } = renderHook(() => usePersistentState('t.c', { status: '' }));
    expect(result.current[0]).toEqual({ status: 'ready' });
  });

  it('supports functional updates', () => {
    const { result } = renderHook(() => usePersistentState('t.d', 1));
    act(() => result.current[1]((n) => n + 1));
    expect(result.current[0]).toBe(2);
    expect(localStorage.getItem('hq.view.t.d')).toBe('2');
  });

  it('degrades to the initial value when the stored JSON is corrupt', () => {
    localStorage.setItem('hq.view.t.e', '{not json');
    const { result } = renderHook(() => usePersistentState('t.e', 'safe'));
    expect(result.current[0]).toBe('safe');
  });
});
