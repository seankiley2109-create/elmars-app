import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
const getAssetBlob = vi.fn(async (_id: string, _mime?: string): Promise<Blob | undefined> => new Blob(['x'], { type: 'image/png' }));
vi.mock('../lib/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/assets')>()),
  getAssetBlob: (id: string, mime?: string) => getAssetBlob(id, mime),
  putAssetBlob: async () => {},
  delAssetBlob: async () => {},
}));

import type { Editor } from '@tiptap/core';
import Notes from './Notes';
import NoticeToastHost from '../components/NoticeToastHost';
import { useHQ } from '../store';
import { useUndo } from '../lib/undo';
import { useNotices } from '../lib/notice';
import { flushOpenEditors } from '../lib/editor-flush';
import { flushOnUnload, type VaultStorage } from '../lib/vault-storage';

const S = () => useHQ.getState();

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  S().clearAll();
  useUndo.setState({ entries: [] });
  useNotices.setState({ notices: [] });
});
afterEach(() => cleanup());

function open(noteId: string) {
  return render(
    <MemoryRouter initialEntries={[`/notes/${noteId}`]}>
      <Routes>
        <Route path="/notes/:id" element={<Notes />} />
        <Route path="/notes" element={<Notes />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Notes: every file attached to a note stays reachable', () => {
  it('lists attached files the body does not show, each downloadable and removable with undo', () => {
    const n = S().addNote({ title: 'Kitchen' });
    const shown = S().addAsset({ name: 'tiles.png', mime: 'image/png', size: 2048 }, { type: 'note', id: n });
    const hidden = S().addAsset({ name: 'Original from Evernote.html', mime: 'text/html', size: 900 }, { type: 'note', id: n });
    const removedFromText = S().addAsset({ name: 'quote.pdf', mime: 'application/pdf', size: 3 * 1024 * 1024 }, { type: 'note', id: n });
    S().updateNote(n, { body: `![tiles.png](asset:${shown})\n\nThe quote was here once.` });
    open(n);

    const list = screen.getByRole('region', { name: 'Attachments' });
    expect(within(list).queryByText('tiles.png')).toBeNull(); // in the body already
    expect(within(list).getByText('Original from Evernote.html')).toBeDefined();
    expect(within(list).getByText('quote.pdf')).toBeDefined();
    expect(within(list).getByText('3.0 MB')).toBeDefined();
    expect(within(list).getByRole('button', { name: 'Open quote.pdf' })).toBeDefined();
    expect(within(list).getByRole('button', { name: 'Save a copy of quote.pdf…' })).toBeDefined();

    act(() => within(list).getByRole('button', { name: 'Remove quote.pdf' }).click());
    expect(S().assets.map((a) => a.id)).not.toContain(removedFromText);
    // the way back
    act(() => useUndo.getState().undo(useUndo.getState().entries[0].id));
    expect(S().assets.map((a) => a.id)).toContain(removedFromText);
    expect(S().assets.map((a) => a.id)).toContain(hidden);
  });

  it('opening a file that is missing says so', async () => {
    const n = S().addNote({ title: 'Kitchen' });
    S().addAsset({ name: 'quote.pdf', mime: 'application/pdf', size: 10 }, { type: 'note', id: n });
    getAssetBlob.mockResolvedValueOnce(undefined);
    render(
      <MemoryRouter initialEntries={[`/notes/${n}`]}>
        <Routes>
          <Route path="/notes/:id" element={<Notes />} />
        </Routes>
        <NoticeToastHost />
      </MemoryRouter>,
    );
    await act(async () => {
      screen.getByRole('button', { name: 'Open quote.pdf' }).click();
    });
    expect(await screen.findByText("That file couldn't be found.")).toBeDefined();
  });

  it('shows no attachments area when every file is in the body', () => {
    const n = S().addNote({ title: 'Kitchen' });
    const a = S().addAsset({ name: 'tiles.png', mime: 'image/png', size: 10 }, { type: 'note', id: n });
    S().updateNote(n, { body: `![tiles.png](asset:${a})` });
    open(n);
    expect(screen.queryByRole('region', { name: 'Attachments' })).toBeNull();
  });
});

describe('Notes: an unanswered conflict becomes a conflicted copy', () => {
  function openWithConflict() {
    const p = S().addProject({ name: 'Kitchen renovation' });
    const other = S().addNote({ title: 'Braai marinade', body: 'Olive oil.' });
    const n = S().addNote({ title: 'Kitchen', body: 'Shared start', folder: 'Home/Plans', projectId: p, tags: ['home'] });
    const view = render(
      <MemoryRouter initialEntries={[`/notes/${n}`]}>
        <Routes>
          <Route path="/notes/:id" element={<Notes />} />
        </Routes>
        <NoticeToastHost />
      </MemoryRouter>,
    );
    const editor = (view.container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent(' and my words');
    });
    // the folder reloads with a different body before his edit is saved
    act(() => {
      S().updateNote(n, { body: 'Changed on the other Mac' });
    });
    expect(screen.getByRole('alert').textContent).toMatch(/changed outside the app/);
    return { ...view, n, p, other };
  }

  const copies = () => S().notes.filter((x) => x.title.endsWith('(conflicted copy)'));

  it('switching to another note keeps his text as "<title> (conflicted copy)" beside the original', () => {
    const { n, p, other } = openWithConflict();
    act(() => {
      [...document.querySelectorAll('section[aria-labelledby=notes-h] button')]
        .find((b) => b.querySelector('span')?.textContent?.startsWith('Braai marinade'))!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(copies()).toHaveLength(1);
    expect(copies()[0]).toMatchObject({
      title: 'Kitchen (conflicted copy)',
      body: 'Shared start and my words',
      folder: 'Home/Plans',
      projectId: p,
      tags: ['home'],
    });
    // the original keeps the outside version; the other note is untouched
    expect(S().notes.find((x) => x.id === n)!.body).toBe('Changed on the other Mac');
    expect(S().notes.find((x) => x.id === other)!.body).toBe('Olive oil.');
    // he is told, with a way to open it
    const toast = screen.getByText('Kept your other version as "Kitchen (conflicted copy)".');
    expect(within(toast.parentElement!).getByRole('button', { name: 'Open' })).toBeDefined();
  });

  it('leaving Notes altogether (the editor unmounts) keeps it the same way', () => {
    const { unmount } = openWithConflict();
    unmount();
    expect(copies().map((c) => c.body)).toEqual(['Shared start and my words']);
  });

  it('closing the tab or quitting with the banner open keeps it too', () => {
    openWithConflict();
    act(() => flushOpenEditors());
    expect(copies().map((c) => c.body)).toEqual(['Shared start and my words']);
  });

  it('switching apps makes no copy and leaves the banner up; closing the tab then does', () => {
    openWithConflict();
    const stop = flushOnUnload({ flush: vi.fn(async () => {}) } as unknown as VaultStorage);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(copies()).toEqual([]);
    expect(screen.getByRole('alert').textContent).toMatch(/changed outside the app/);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    stop();
    expect(copies().map((c) => c.body)).toEqual(['Shared start and my words']);
  });

  it('on tab close the copy exists before the folder is written', () => {
    openWithConflict();
    const seenAtWrite: string[][] = [];
    const storage = {
      flush: vi.fn(async () => {
        seenAtWrite.push(copies().map((c) => c.body));
      }),
    } as unknown as VaultStorage;
    const stop = flushOnUnload(storage);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    stop();
    expect(seenAtWrite).toEqual([['Shared start and my words']]);
  });

  it('an explicit "Keep mine" or "Use the new version" makes no copy', () => {
    for (const choice of ['Keep mine', 'Use the new version']) {
      S().clearAll();
      const { unmount } = openWithConflict();
      act(() => screen.getByRole('button', { name: choice }).click());
      unmount();
      expect(copies()).toEqual([]);
    }
  });
});

describe('Notes: controls are big enough to hit', () => {
  it('pin, delete and tag removal are 44px targets, and tag removal is visible without hover', () => {
    const n = S().addNote({ title: 'Kitchen', tags: ['home'] });
    open(n);
    for (const name of ['Pin note', 'Delete note']) {
      const cls = screen.getByRole('button', { name }).className;
      expect(cls).toMatch(/\bh-11\b/);
      expect(cls).toMatch(/\bw-11\b/);
    }
    const remove = screen.getByRole('button', { name: 'Remove tag home' });
    expect(remove.className).toMatch(/before:h-11/);
    expect(remove.className).toMatch(/before:w-11/);
    expect(remove.className).not.toMatch(/opacity-0/);
  });
});
