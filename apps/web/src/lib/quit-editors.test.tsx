import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import './jsdom-blob';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

import { fullFixture } from '@hq/store-fs';
import { MemFsPort } from './fs-port';
import { createTauriRoot } from './tauri-root';
import { createVaultStorage, flushOnExit, flushOnQuit, type ExitSource, type QuitWindow, type VaultStorage } from './vault-storage';
import { useHQ, useVaultBackend } from '../store';
import Notes from '../views/Notes';

/**
 * Quitting the app (Cmd+Q) or closing its window must carry what only the note editor holds: typing
 * still inside its debounce, and the set-aside text of an unanswered "changed outside the app" banner
 * (kept as a conflicted copy). Both must be on disk before the window is destroyed or the app exits.
 */

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const onDisk = (port: MemFsPort, needle: string) => [...port.files.values()].some((b) => text(b).includes(needle));

let port: MemFsPort;
let storage: VaultStorage;
let noteId: string;

beforeEach(async () => {
  port = new MemFsPort();
  const seed = createVaultStorage(createTauriRoot('/v', port));
  const doc = fullFixture();
  seed.setItem('elmar-data', JSON.stringify({ state: { ...doc, settings: { ...doc.settings, onboarded: true } }, version: 1 }));
  await seed.flush();

  storage = createVaultStorage(createTauriRoot('/v', port));
  useVaultBackend(storage);
  await useHQ.persist.rehydrate();
  noteId = useHQ.getState().notes[0].id;
  useHQ.getState().updateNote(noteId, { body: 'Shared start' });
  await storage.flush();
});

afterEach(() => cleanup());

function openNote(): Editor {
  const view = render(
    <MemoryRouter initialEntries={[`/notes/${noteId}`]}>
      <Routes>
        <Route path="/notes/:id" element={<Notes />} />
      </Routes>
    </MemoryRouter>,
  );
  return (view.container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
}

function type(editor: Editor, words: string) {
  act(() => {
    editor.commands.focus('end');
    editor.commands.insertContent(words);
  });
}

function fakeWindow() {
  let onClose: ((e: { preventDefault(): void }) => unknown) | undefined;
  const seenAtDestroy: { typed: boolean; copy: boolean }[] = [];
  const win: QuitWindow = {
    onCloseRequested: async (h) => {
      onClose = h;
      return () => {};
    },
    destroy: vi.fn(async () => {
      seenAtDestroy.push({ typed: onDisk(port, 'QUITWORDS'), copy: onDisk(port, '(conflicted copy)') });
    }),
  };
  return { win, seenAtDestroy, close: () => onClose!({ preventDefault: () => {} }) };
}

function fakeExit() {
  let fire: (() => void) | undefined;
  const seenAtExit: boolean[] = [];
  const source: ExitSource = {
    onExitRequested: async (cb) => {
      fire = cb;
      return () => {};
    },
    hold: vi.fn(async () => {}),
    exit: vi.fn(async () => {
      seenAtExit.push(onDisk(port, 'QUITWORDS'));
    }),
    cancel: vi.fn(async () => {}),
  };
  return { source, seenAtExit, request: () => fire?.() };
}

describe('quitting carries the note editor with it', () => {
  it('closing the window: typing still in the editor debounce is on disk before the window is destroyed', async () => {
    const editor = openNote();
    type(editor, ' QUITWORDS');
    expect(onDisk(port, 'QUITWORDS')).toBe(false); // only in the editor so far

    const { win, seenAtDestroy, close } = fakeWindow();
    await flushOnQuit(storage, win, { confirmQuit: async () => false });
    await act(async () => {
      await close();
    });
    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(seenAtDestroy).toEqual([{ typed: true, copy: false }]);
  });

  it('Cmd+Q: typing still in the editor debounce is on disk before the app exits', async () => {
    const editor = openNote();
    type(editor, ' QUITWORDS');
    const { source, seenAtExit, request } = fakeExit();
    await flushOnExit(() => storage, source, { confirmQuit: async () => false });
    await act(async () => {
      request();
      await vi.waitFor(() => expect(source.exit).toHaveBeenCalledTimes(1));
    });
    expect(seenAtExit).toEqual([true]);
  });

  it('closing with the "changed outside" banner open: the conflicted copy is on disk before the window is destroyed', async () => {
    const editor = openNote();
    type(editor, ' and QUITWORDS of mine');
    act(() => {
      useHQ.getState().updateNote(noteId, { body: 'Changed on the other Mac' }); // the folder reloaded
    });
    expect(screen.getByRole('alert').textContent).toMatch(/changed outside the app/);

    const { win, seenAtDestroy, close } = fakeWindow();
    await flushOnQuit(storage, win, { confirmQuit: async () => false });
    await act(async () => {
      await close();
    });
    expect(seenAtDestroy).toEqual([{ typed: true, copy: true }]);
    const copy = useHQ.getState().notes.find((n) => n.title.endsWith('(conflicted copy)'));
    expect(copy?.body).toBe('Shared start and QUITWORDS of mine');
  });
});
