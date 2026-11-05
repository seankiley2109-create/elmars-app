import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { fullFixture } from '@hq/store-fs';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));

// The test is about the words on screen, not about choosing a folder: boot is stubbed as ready.
// The boot screen's own actions are stubs too — OpenVault is rendered directly below.
vi.mock('./lib/vault-boot', () => ({
  VAULT_PATH_KEY: 'elmar.vaultPath',
  useVaultBoot: () => [{ kind: 'ready' }, () => {}],
  grantVault: vi.fn(),
  openVault: vi.fn(),
  skipVault: vi.fn(),
  // the Mac app's folder screens (FirstRun, LoadError, IcloudPending), rendered directly below
  openFolderAt: vi.fn(),
  chooseFolder: vi.fn(),
  retryLoad: vi.fn(),
  retryIcloud: vi.fn(),
}));

// Settings' "Move to a folder" runs the real migrateToVault; only the browser's folder picker and
// the folder read are faked, so its real messages reach the screen.
const pickVaultDirectory = vi.fn();
vi.mock('./lib/vault-handle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/vault-handle')>()),
  pickVaultDirectory: () => pickVaultDirectory(),
}));
vi.mock('./lib/vault-fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/vault-fs')>()),
  supportsFileSystemAccess: () => true,
  readManagedFiles: async () => new Map([['projects/someone-elses.md', 'x']]),
}));

// The Evernote converter for real, except that a note saying EXPLODE breaks it, so the report's
// "couldn't be brought in" section can be read too.
vi.mock('./lib/evernote/enml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/evernote/enml')>();
  return {
    ...actual,
    enmlToMarkdown: (enml: string, assets: Parameters<typeof actual.enmlToMarkdown>[1]) => {
      if (enml.includes('EXPLODE')) throw new TypeError('x is undefined');
      return actual.enmlToMarkdown(enml, assets);
    },
  };
});

import App from './App';
import Onboarding from './components/Onboarding';
import EvernoteImport from './components/EvernoteImport';
import sampleEnex from './lib/evernote/__fixtures__/sample.enex?raw';
import OpenVault from './components/OpenVault';
import FirstRun from './components/FirstRun';
import LoadError from './components/LoadError';
import IcloudPending from './components/IcloudPending';
import { MemFsPort } from './lib/fs-port';
import { createTauriRoot } from './lib/tauri-root';
import SaveErrorToast from './components/SaveErrorToast';
import { notifySaveFailed } from './lib/vault-events';
import { UNSAVED_QUIT_MESSAGE } from './lib/vault-storage';
import { useHQ } from './store';

/**
 * Elmar's app speaks plainly. HQ's builder and operator vocabulary must never reach the screen,
 * on any of the places he can go, in any state he can open there, even with every kind of data
 * present.
 */
const FORBIDDEN = /\b(vault|jobs?|runs?|backlog|shipped|signals?|inbox)\b/i;
/** The app this was forked from, by name. Case-sensitive: "hq" inside a word is not it. */
const OLD_NAME = /\bHQ\b/;

/** Everything on screen: text, plus the words he reads that are not text nodes. */
function screenWords(): string {
  const shown = document.body.textContent ?? '';
  const attrs = [...document.body.querySelectorAll('*')].flatMap((el) =>
    ['placeholder', 'title', 'aria-label', 'alt'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [shown, ...attrs].join(' | ');
}

/** Fails listing each hit with a little of the text around it, so the culprit is easy to find. */
function expectPlainWords(): void {
  const text = screenWords();
  // the page really rendered: not the error fallback, and not a blank screen
  expect(text).not.toMatch(/Something broke/);
  expect((document.body.textContent ?? '').length).toBeGreaterThan(0);
  const hits = [...text.matchAll(new RegExp(FORBIDDEN.source, 'gi')), ...text.matchAll(new RegExp(OLD_NAME.source, 'g'))].map(
    (m) => `"${m[0]}" in …${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}…`,
  );
  expect(hits).toEqual([]);
}

/** A button by its visible text or aria-label — exact string, or a pattern. Fails if none or several match. */
function button(name: string | RegExp): HTMLButtonElement {
  const matches = (v: string | null) => v !== null && (typeof name === 'string' ? v.trim() === name : name.test(v));
  const found = [...document.querySelectorAll('button')].filter(
    (b) => matches(b.getAttribute('aria-label')) || matches(b.textContent),
  );
  if (found.length !== 1) throw new Error(`expected one button "${name}", found ${found.length}`);
  return found[0];
}

/** The Settings message line. */
const statusText = () => document.querySelector('main [role="status"]')?.textContent ?? '';

function loadFixture(): void {
  const doc = fullFixture();
  useHQ.setState({ ...doc, settings: { ...doc.settings, onboarded: true }, hydrated: true });
}

function renderApp(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

const ROUTES = [
  '/',
  '/projects',
  '/projects/prj_a',
  '/notes',
  '/notes/nte_braai',
  '/calendar',
  '/map',
  '/settings',
];

beforeAll(() => {
  // jsdom's Blob has no text(); Settings reads a picked backup with it
  Blob.prototype.text ??= function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
  // jsdom has neither of these; the command palette's list (cmdk) uses both
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  localStorage.clear(); // view choices (grid/board, filters) are remembered per browser
  loadFixture();
});
afterEach(cleanup); // globals: false means no automatic cleanup between tests

describe('no builder words on screen', () => {
  for (const route of ROUTES) {
    it(`${route} shows none of them`, () => {
      renderApp(route);
      expectPlainWords();
    });
  }
});

describe('no builder words in the states he can open', () => {
  it('the Projects board, with its add form open, and its timeline', () => {
    renderApp('/projects');
    fireEvent.click(button('Board'));
    // the four columns are the on-screen status names; Done is always open
    for (const title of ['On the go', 'On hold', 'Someday', 'Done']) expect(document.body.textContent).toContain(title);
    fireEvent.click(button('Add a project to Someday'));
    expectPlainWords();
    fireEvent.click(button('Timeline'));
    expectPlainWords();
  });

  it("a project's workspace with its subprojects on the board, and its timeline", () => {
    renderApp('/projects/prj_a');
    fireEvent.click(button('Board'));
    expect(screen.getAllByText('On the go').length).toBeGreaterThan(0);
    expectPlainWords();
    fireEvent.click(button('Timeline'));
    fireEvent.click(button('Show done'));
    expectPlainWords();
  });

  it('the command palette, empty and with search results', () => {
    renderApp('/');
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    const input = screen.getByPlaceholderText('Search everything…');
    expectPlainWords();
    fireEvent.change(input, { target: { value: 'Planning' } });
    expect(document.querySelectorAll('[cmdk-item]').length).toBeGreaterThan(0);
    expectPlainWords();
  });

  it('the keyboard shortcut help', () => {
    renderApp('/');
    act(() => {
      fireEvent.keyDown(window, { key: '?' });
    });
    expect(screen.getByText('Keyboard shortcuts')).toBeDefined();
    expectPlainWords();
  });

  it('quick add from anywhere', () => {
    renderApp('/map');
    act(() => {
      fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    });
    expect(screen.getByPlaceholderText('Capture a task. Type @ to put it in a project.')).toBeDefined();
    expectPlainWords();
  });

  it('an open task, open and done', () => {
    renderApp('/?task=tsk_a');
    expect(screen.getByLabelText('Task title')).toBeDefined();
    expectPlainWords();
    fireEvent.click(button('Done'));
    expectPlainWords();
  });

  it('the undo toast after a delete', () => {
    renderApp('/?task=tsk_a');
    fireEvent.click(button(/Delete task/));
    expect(screen.getByText(/Deleted "Book the plumber"/)).toBeDefined();
    expectPlainWords();
  });

  it('first launch, with the Evernote import offered', () => {
    useHQ.setState({ settings: { userName: '', onboarded: false } });
    render(<Onboarding onImport={() => {}} />);
    expect(screen.getByText('Bring your Evernote notes')).toBeDefined();
    expect(screen.getByText('Start empty')).toBeDefined();
    expectPlainWords();
  });

  it('the Evernote import from Settings: its start, its progress and its report', async () => {
    const SLOW = { timeout: 10_000 }; // quick alone, slower while the whole suite runs
    renderApp('/settings');
    fireEvent.click(button(/Bring your Evernote notes/));
    expect(screen.getByText('Export each notebook from Evernote')).toBeDefined();
    expectPlainWords();

    // the sheet on its own, so its progress can be held still: the first attachment waits
    cleanup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    render(
      <MemoryRouter>
        <EvernoteImport
          open
          onClose={() => {}}
          putAssetBlob={async (_id, _blob, name) => {
            await gate;
            if (name === 'boarding_pass.pdf') throw new Error('The disk is full.');
          }}
        />
      </MemoryRouter>,
    );
    // every section of the report: a file that is not an export, a file that could not be opened, an
    // attachment Evernote's file could not hand over, a note that broke, a file that could not be saved,
    // notes worth a look and encrypted notes
    const broken =
      '<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>Scan</title>' +
      '<created>20261101T080000Z</created><updated>20261101T080000Z</updated>' +
      '<content><![CDATA[<en-note><div>See the scan.</div></en-note>]]></content>' +
      '<resource><data encoding="base64">@@@@</data><mime>application/pdf</mime>' +
      '<resource-attributes><file-name>scan.pdf</file-name></resource-attributes></resource></note>' +
      '<note><title>Odd one</title><created>20261101T090000Z</created><updated>20261101T090000Z</updated>' +
      '<content><![CDATA[<en-note><div>EXPLODE</div></en-note>]]></content></note></en-export>';
    fireEvent.change(screen.getByLabelText('Evernote files'), {
      target: {
        files: [
          new File(['<html>nope</html>'], 'shopping.enex'),
          { name: 'locked.enex' } as unknown as File, // the browser can't read it
          new File([sampleEnex], 'sample.enex'),
          new File([broken], 'Work.enex'),
        ],
      },
    });
    await screen.findByText(/of 10 notes/, {}, SLOW);
    expectPlainWords();
    release();
    await screen.findByText('Your notes are here', {}, SLOW);
    for (const section of [
      'Worth a look',
      'Encrypted text',
      'Files that couldn’t be saved',
      'Attachments Evernote couldn’t hand over',
      'Files that aren’t Evernote exports',
      'Files that couldn’t be opened',
      'Notes that couldn’t be brought in',
    ]) {
      expect(screen.getByText(section)).toBeDefined();
    }
    expect(screen.getByText(/came in without a date, so they don’t crowd Today/)).toBeDefined();
    expectPlainWords();

    // and the same notebook again: everything already here
    fireEvent.click(button('Bring more notes'));
    fireEvent.change(screen.getByLabelText('Evernote files'), { target: { files: [new File([sampleEnex], 'sample.enex')] } });
    await screen.findByText('These notes were already here', {}, SLOW);
    expectPlainWords();
  }, 30_000);

  it('the folder screen, choosing and reopening', () => {
    render(<OpenVault state={{ kind: 'needs-folder' }} onChange={() => {}} />);
    expectPlainWords();
    cleanup();
    render(<OpenVault state={{ kind: 'needs-permission', dir: {} as FileSystemDirectoryHandle }} onChange={() => {}} />);
    expectPlainWords();
  });

  it("the Mac app's folder screens: first run, every refusal, the load error, the iCloud wait, the save notice and the quit question", async () => {
    const boot = await import('./lib/vault-boot');
    const real = await vi.importActual<typeof import('./lib/vault-boot')>('./lib/vault-boot');

    for (const suggested of ["/Users/elmar/Library/Mobile Documents/com~apple~CloudDocs/Elmar's App", "/Users/elmar/Elmar's App"]) {
      render(<FirstRun suggested={suggested} onChange={() => {}} />);
      expectPlainWords();
      cleanup();
    }
    expect(real.FOLDER_REFUSALS.length).toBeGreaterThan(0);
    for (const reason of real.FOLDER_REFUSALS) {
      vi.mocked(boot.openFolderAt).mockRejectedValueOnce(new Error(reason));
      render(<FirstRun suggested="/Users/elmar/.hidden" onChange={() => {}} />);
      await act(async () => fireEvent.click(screen.getByText('Use this folder')));
      expect(document.body.textContent).toContain(reason);
      expectPlainWords();
      cleanup();
    }

    render(<LoadError path="/Users/elmar/Elmar's App" onChange={() => {}} />);
    expectPlainWords();
    cleanup();

    // notes still in iCloud: the screen, then the same screen while a download is under way
    render(<IcloudPending count={12} onChange={() => {}} />);
    expect(document.body.textContent).toContain('still downloading from iCloud (12)');
    expectPlainWords();
    const port = new MemFsPort();
    await port.mkdir('/v/notes');
    await port.writeFile('/v/notes/.a.md.icloud', new Uint8Array([1]));
    let arrive: (ok: boolean) => void = () => {};
    port.ensureDownloaded = () => new Promise<boolean>((r) => (arrive = r));
    const notes = await createTauriRoot('/v', port).getDirectoryHandle('notes');
    const listing = (async () => {
      for await (const _ of notes.entries()) void _;
    })().catch(() => {});
    await waitFor(() => expect(document.body.textContent).toContain('Downloading from iCloud: 0 of 1'));
    expectPlainWords();
    arrive(false);
    await act(async () => listing);
    cleanup();

    render(<SaveErrorToast />);
    act(() => notifySaveFailed());
    expect(screen.getByRole('alert')).toBeDefined();
    expectPlainWords();

    // the native dialog's words are not in the DOM; hold them to the same rule
    expect(UNSAVED_QUIT_MESSAGE).not.toMatch(FORBIDDEN);
    expect(UNSAVED_QUIT_MESSAGE).not.toMatch(OLD_NAME);
  });

  it("Settings' messages when moving to a folder", async () => {
    renderApp('/settings');
    const move = () => fireEvent.click(button(/Move to a folder/));

    pickVaultDirectory.mockResolvedValueOnce(undefined); // he closed the picker
    move();
    await waitFor(() => expect(statusText()).toBe('No folder chosen.'));
    expectPlainWords();

    pickVaultDirectory.mockResolvedValueOnce({ name: 'Documents' }); // a folder with data in it
    move();
    await waitFor(() => expect(statusText()).toMatch(/already has app data/));
    expectPlainWords();

    pickVaultDirectory.mockRejectedValueOnce('denied'); // something went wrong without an Error
    move();
    await waitFor(() => expect(statusText()).toBe('Could not move to that folder.'));
    expectPlainWords();
  });

  it("Settings' messages when restoring a backup, and the question before it replaces everything", async () => {
    // a fresh page per file: React does not re-fire change on a file input whose value it saw reset
    const pick = (content: string) => {
      cleanup();
      renderApp('/settings');
      fireEvent.change(screen.getByLabelText('Backup file to restore'), {
        target: { files: [new File([content], 'backup.json', { type: 'application/json' })] },
      });
    };

    pick('not json at all');
    await waitFor(() => expect(statusText()).toMatch(/couldn't be read/));
    expectPlainWords();

    pick(JSON.stringify({ hello: 'world' }));
    await waitFor(() => expect(statusText()).toBe("This isn't a backup from Elmar's App."));
    expectPlainWords();

    pick(JSON.stringify({ ...useHQ.getState().exportData(), version: 6 }));
    await waitFor(() => expect(statusText()).toBe("This isn't a backup from Elmar's App."));
    expectPlainWords();

    pick(JSON.stringify(useHQ.getState().exportData()));
    await waitFor(() => expect(screen.getByText('Restore from this backup?')).toBeDefined());
    const summary = screen.getByTestId('restore-summary').textContent ?? '';
    expect(summary).toMatch(/\d+ projects?, \d+ tasks?, \d+ notes?, \d+ events? and \d+ attached files?/);
    expect(summary).toMatch(/replaces everything in your notes folder|replaces everything saved in this browser/);
    expectPlainWords();
    fireEvent.click(button('Replace and restore'));
    await waitFor(() => expect(statusText()).toMatch(/Backup restored/));
    expectPlainWords();
  }, 20_000); // four full renders of the app; slow when the whole suite runs at once

  it("Settings' other sections: the folder in iCloud and not, the backup message, Evernote and About", async () => {
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => {};
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); // jsdom cannot navigate
    try {
      localStorage.setItem('elmar.vaultPath', '/Users/elmar/Library/Mobile Documents/com~apple~CloudDocs/Elmar');
      renderApp('/settings');
      expect(screen.getByTestId('notes-folder').textContent).toContain('CloudDocs');
      expect(document.body.textContent).toContain('iCloud Drive');
      expect(document.body.textContent).toContain("Elmar's App");
      expect(document.body.textContent).toContain('Bring your Evernote notes');
      expectPlainWords();
      cleanup();

      localStorage.setItem('elmar.vaultPath', "/Users/elmar/Elmar's App");
      renderApp('/settings');
      expect(document.body.textContent).toContain("isn't in iCloud Drive");
      expectPlainWords();

      fireEvent.click(button('Save a backup file…'));
      await waitFor(() => expect(statusText()).toMatch(/Backup downloaded/));
      expectPlainWords();
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      clickSpy.mockRestore();
    }
  });

  it('Settings: a status region is always there, every control is 44 px, and Erase says what it deletes', () => {
    renderApp('/settings');
    const region = document.querySelector('main [role="status"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');

    const controls = [...document.querySelectorAll('main button, main input[type="text"], main input:not([type])')].filter(
      (el) => !el.classList.contains('hidden') && (el as HTMLInputElement).type !== 'file',
    );
    // Show in Finder / Move to a folder only appear where they apply; the rest are always there
    expect(controls.length).toBeGreaterThanOrEqual(5);
    for (const el of controls) expect(el.className, el.textContent || el.getAttribute('aria-label') || '').toContain('min-h-11');

    const warning = screen.getByTestId('erase-warning').textContent ?? '';
    expect(warning).toMatch(/deletes all the notes, tasks, projects, events and attached files/);
    expect(warning).toMatch(/can't be undone/);
    expectPlainWords();
  });

  it('⌘K "Save a backup file" opens Settings and the result shows there', async () => {
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => {};
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); // jsdom cannot navigate
    try {
      renderApp('/');
      act(() => {
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      });
      fireEvent.click(screen.getByText('Save a backup file'));
      await waitFor(() => expect(statusText()).toMatch(/Backup downloaded/));
      expect(screen.getByText('Restore from a backup…')).toBeDefined();
      expect(clickSpy).toHaveBeenCalledTimes(1); // saved once, not twice
      expectPlainWords();
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      clickSpy.mockRestore();
    }
  });

  it('erasing everything goes back to the first-launch screen', () => {
    renderApp('/settings');
    fireEvent.change(screen.getByLabelText('Type ERASE to confirm'), { target: { value: 'ERASE' } });
    fireEvent.click(button(/Erase everything/));
    expect(useHQ.getState().projects).toEqual([]);
    expect(screen.getByText('Start empty')).toBeDefined();
    expectPlainWords();
  });
});
