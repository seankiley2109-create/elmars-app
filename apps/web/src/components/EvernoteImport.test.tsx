import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('../lib/vault-boot', () => ({ useVaultBoot: () => [{ kind: 'ready' }, () => {}] }));

// The app's own blob store, with a gate a test can close to hold an import partway.
const blobs = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
vi.mock('../lib/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/assets')>()),
  putAssetBlob: async () => {
    if (blobs.gate) await blobs.gate;
  },
  delAssetBlob: async () => {},
}));

// The real converter, except that a body saying EXPLODE breaks it.
vi.mock('../lib/evernote/enml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/evernote/enml')>();
  return {
    ...actual,
    enmlToMarkdown: (enml: string, assets: Parameters<typeof actual.enmlToMarkdown>[1]) => {
      if (enml.includes('EXPLODE')) throw new TypeError('x is undefined');
      return actual.enmlToMarkdown(enml, assets);
    },
  };
});

import sample from '../lib/evernote/__fixtures__/sample.enex?raw';
import EvernoteImport from './EvernoteImport';
import App from '../App';
import { useHQ } from '../store';

const S = () => useHQ.getState();
/** An import is quick alone but can take seconds while the whole suite runs in parallel. */
const SLOW = { timeout: 10_000 };

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderSheet(props: Partial<Parameters<typeof EvernoteImport>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
      <EvernoteImport open onClose={onClose} {...props} />
    </MemoryRouter>,
  );
  return onClose;
}

const enex = (name: string, text: string) => new File([text], name, { type: '' });
const choose = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText('Evernote files'), { target: { files } });

/** Holds every attachment write until `release()`. */
function closeGate(): () => void {
  let release!: () => void;
  blobs.gate = new Promise<void>((r) => (release = r));
  return () => {
    blobs.gate = null;
    release();
  };
}

beforeEach(() => {
  S().clearAll();
  blobs.gate = null;
  useHQ.setState({ settings: { userName: 'Elmar', onboarded: true }, hydrated: true });
});
afterEach(cleanup);

describe('EvernoteImport', { timeout: 30_000 }, () => {
  it('opens with the two steps and a file picker for several .enex files', () => {
    renderSheet();
    expect(screen.getByRole('heading', { name: 'Bring your Evernote notes' })).toBeDefined();
    expect(screen.getByText('Export each notebook from Evernote')).toBeDefined();
    expect(screen.getByText('Choose the files')).toBeDefined();
    const input = screen.getByLabelText('Evernote files') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('.enex');
  });

  it('gives its buttons room to hit: 44px', () => {
    renderSheet();
    for (const name of ['Not now', 'Choose files…', 'Close']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/\bh-11\b/);
    }
  });

  it('brings the notes in and reports in plain words, linking to the notes worth a look', async () => {
    const onClose = renderSheet();
    choose(enex('sample.enex', sample));
    await screen.findByText('Your notes are here', {}, SLOW);
    expect(S().notes).toHaveLength(8);
    expect(screen.getByText('Brought in 8 notes, 2 attachments and 3 tasks from the notebook “sample”.')).toBeDefined();
    expect(screen.getByText('You can keep Evernote until you’re happy everything is here.')).toBeDefined();
    // the sample's dates are from 2023, long gone by the time this runs
    expect(
      screen.getByText(
        '1 old reminder and 1 old task came in without a date, so they don’t crowd Today. Each keeps its old date in its notes.',
      ),
    ).toBeDefined();
    expect(screen.getByText(/This note has encrypted text, which stays in Evernote\. Its original is kept with it/)).toBeDefined();
    for (const name of ['Bring more notes', 'Done']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/\bh-11\b/);
    }

    const budget = S().notes.find((n) => n.title === 'Budget table')!;
    const locked = S().notes.find((n) => n.title === 'Locked note')!;
    expect(screen.getByRole('link', { name: 'Budget table' }).getAttribute('href')).toBe(`/notes/${budget.id}`);
    expect(screen.getByRole('link', { name: 'Locked note' }).getAttribute('href')).toBe(`/notes/${locked.id}`);
    expect(screen.getByRole('link', { name: 'Budget table' }).className).toMatch(/\bmin-h-11\b/);

    fireEvent.click(screen.getByRole('link', { name: 'Budget table' }));
    expect(screen.getByTestId('where').textContent).toBe(`/notes/${budget.id}`);
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when everything was already here, and that later changes in Evernote did not come', async () => {
    renderSheet();
    choose(enex('sample.enex', sample));
    await screen.findByText('Your notes are here', {}, SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Bring more notes' }));
    choose(enex('sample.enex', sample));
    await screen.findByText('These notes were already here', {}, SLOW);
    expect(screen.getByText('Nothing new came across from the notebook “sample”.')).toBeDefined();
    expect(
      screen.getByText(
        '8 notes were already here, so they were left as they were. Changes made to them in Evernote since they were first brought in weren’t brought in.',
      ),
    ).toBeDefined();
    expect(S().notes).toHaveLength(8);
  });

  it('shows progress note by note, and cannot be closed halfway', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const onClose = renderSheet({ putAssetBlob: () => gate });
    choose(enex('sample.enex', sample));
    // Receipts is the second note; its first attachment waits at the gate
    await screen.findByText('Bringing in your notes: 1 of 8 notes', {}, SLOW);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    release();
    await screen.findByText('Your notes are here', {}, SLOW);
  });

  it('asks before the window closes while the import runs, and not after', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    renderSheet({ putAssetBlob: () => gate });
    choose(enex('sample.enex', sample));
    await screen.findByText('Bringing in your notes: 1 of 8 notes', {}, SLOW);
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    release();
    await screen.findByText('Your notes are here', {}, SLOW);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('lists each kind of trouble under its own heading, in plain words, and still imports the rest', async () => {
    renderSheet({
      putAssetBlob: async (_id, _blob, name) => {
        if (name === 'dot.png') throw new Error('EIO: i/o error, write');
      },
    });
    const odd =
      '<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>Odd one</title>' +
      '<created>20240101T080000Z</created><updated>20240101T080000Z</updated>' +
      '<content><![CDATA[<en-note><div>EXPLODE</div></en-note>]]></content></note></en-export>';
    choose(
      enex('notes.enex', '<html>nope</html>'),
      { name: 'locked.enex' } as unknown as File, // not a file the browser can read
      enex('sample.enex', sample),
      enex('Work.enex', odd),
    );
    await screen.findByText('Your notes are here', {}, SLOW);

    expect(screen.getByText('Files that aren’t Evernote exports')).toBeDefined();
    expect(screen.getByText('notes.enex')).toBeDefined();

    expect(screen.getByText('Files that couldn’t be opened')).toBeDefined();
    expect(screen.getByText('locked.enex')).toBeDefined();

    expect(screen.getByText('Files that couldn’t be saved')).toBeDefined();
    expect(screen.getByText('dot.png')).toBeDefined();
    expect(screen.getByText(/Something went wrong saving this file\./)).toBeDefined();
    expect(
      screen.getByText(
        'They’re still in Evernote. To bring one in, delete its note here, then bring that notebook in again.',
      ),
    ).toBeDefined();
    expect(document.body.textContent).not.toMatch(/EIO|i\/o error/);

    expect(screen.getByText('Notes that couldn’t be brought in')).toBeDefined();
    expect(screen.getByText('Odd one')).toBeDefined();
    expect(document.body.textContent).not.toMatch(/x is undefined/);

    expect(S().notes).toHaveLength(8);
    expect(S().assets.some((a) => a.name === 'dot.png')).toBe(false);
  });
});

describe('where the import opens', { timeout: 30_000 }, () => {
  it('first launch: the name is kept, onboarding completes, the import opens, and closing it lands on the page', async () => {
    useHQ.setState({ settings: { userName: '', onboarded: false } });
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('What should we call you?'), { target: { value: 'Elmar' } });
    fireEvent.click(screen.getByRole('button', { name: /Bring your Evernote notes/ }));
    expect(S().settings).toMatchObject({ userName: 'Elmar', onboarded: true });
    expect(await screen.findByRole('dialog', { name: 'Bring your Evernote notes' }, SLOW)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog', { name: 'Bring your Evernote notes' })).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('Settings has an entry, 44px tall, that opens it', async () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog', { name: 'Bring your Evernote notes' })).toBeNull();
    const entry = screen.getByRole('button', { name: /Bring your Evernote notes/ });
    expect(entry.className).toMatch(/\bmin-h-11\b/);
    fireEvent.click(entry);
    expect(await screen.findByRole('dialog', { name: 'Bring your Evernote notes' }, SLOW)).toBeDefined();
  });

  it('keeps going, and keeps its report, when he goes Back or presses a shortcut mid-import', async () => {
    let navigate!: NavigateFunction;
    function Handles() {
      navigate = useNavigate();
      return <Where />;
    }
    render(
      <MemoryRouter initialEntries={['/', '/settings']} initialIndex={1}>
        <App />
        <Handles />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Bring your Evernote notes/ }));
    const release = closeGate();
    choose(enex('sample.enex', sample));
    await screen.findByText('Bringing in your notes: 1 of 8 notes', {}, SLOW);

    // g then n would go to Notes; while the import runs, shortcuts wait
    act(() => {
      fireEvent.keyDown(window, { key: 'g' });
      fireEvent.keyDown(window, { key: 'n' });
    });
    expect(screen.getByTestId('where').textContent).toBe('/settings');

    // the browser's Back button: Settings goes, the sheet stays
    act(() => navigate(-1));
    expect(screen.getByTestId('where').textContent).toBe('/');
    expect(screen.getByText('Bringing in your notes: 1 of 8 notes')).toBeDefined();

    release();
    await screen.findByText('Your notes are here', {}, SLOW);
    expect(S().notes).toHaveLength(8);
  });
});
