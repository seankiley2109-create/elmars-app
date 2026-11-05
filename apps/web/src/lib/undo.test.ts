import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

import { useHQ, type DeleteSnapshot } from '../store';
import { useUndo, deleteWithUndo, undoable, UNDO_MS } from './undo';

const snap = (label: string): DeleteSnapshot => ({ label, removed: {} });
const pushSnap = (label: string) => useUndo.getState().push({ label, snap: snap(label) });

const restoreSpy = vi.fn();
const commitSpy = vi.fn();
let original: { restoreDelete: typeof restoreSpy; commitDelete: typeof commitSpy };

beforeEach(() => {
  vi.useFakeTimers();
  restoreSpy.mockClear();
  commitSpy.mockClear();
  const s = useHQ.getState();
  original = { restoreDelete: s.restoreDelete as never, commitDelete: s.commitDelete as never };
  useHQ.setState({ restoreDelete: restoreSpy, commitDelete: commitSpy });
});

afterEach(() => {
  useUndo.getState().flushAll();
  useHQ.setState(original);
  vi.useRealTimers();
});

describe('the undo window', () => {
  it('commits when the window expires, untouched', () => {
    pushSnap('Deleted "a"');
    expect(useUndo.getState().entries.length).toBe(1);
    vi.advanceTimersByTime(UNDO_MS);
    expect(useUndo.getState().entries.length).toBe(0);
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('undo restores, and the expired timer must not double-fire', () => {
    pushSnap('Deleted "a"');
    const id = useUndo.getState().entries[0].id;
    useUndo.getState().undo(id);
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(commitSpy).not.toHaveBeenCalled();
    expect(useUndo.getState().entries.length).toBe(0);
  });

  it('a fourth toast evicts the oldest by committing it early', () => {
    ['a', 'b', 'c', 'd'].forEach((l) => pushSnap(`Deleted "${l}"`));
    const labels = useUndo.getState().entries.map((e) => e.label);
    expect(labels).toEqual(['Deleted "b"', 'Deleted "c"', 'Deleted "d"']);
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy.mock.calls[0][0].label).toBe('Deleted "a"');
  });

  it('flushAll commits every open window at once (the pagehide path)', () => {
    pushSnap('Deleted "a"');
    pushSnap('Deleted "b"');
    useUndo.getState().flushAll();
    expect(commitSpy).toHaveBeenCalledTimes(2);
    expect(useUndo.getState().entries.length).toBe(0);
    vi.advanceTimersByTime(UNDO_MS * 2); // cleared timers must not re-commit
    expect(commitSpy).toHaveBeenCalledTimes(2);
  });

  it('deleteWithUndo only toasts when the delete actually removed something', () => {
    deleteWithUndo(() => undefined);
    expect(useUndo.getState().entries.length).toBe(0);
    deleteWithUndo(() => snap('Deleted "real"'));
    expect(useUndo.getState().entries.length).toBe(1);
  });
});

describe('undoable (reversible actions, not deletes)', () => {
  it('runs onUndo on undo — never the store delete path', () => {
    const onUndo = vi.fn();
    const onCommit = vi.fn();
    undoable('Archived X', onUndo, onCommit);
    const id = useUndo.getState().entries[0].id;
    useUndo.getState().undo(id);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(restoreSpy).not.toHaveBeenCalled(); // a reversible action never touches DeleteSnapshot
  });

  it('runs onCommit (if given) when the window expires', () => {
    const onUndo = vi.fn();
    const onCommit = vi.fn();
    undoable('Archived X', onUndo, onCommit);
    vi.advanceTimersByTime(UNDO_MS);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('an undoable with no onCommit expires cleanly', () => {
    undoable('Archived X', vi.fn());
    vi.advanceTimersByTime(UNDO_MS);
    expect(useUndo.getState().entries.length).toBe(0);
  });
});
