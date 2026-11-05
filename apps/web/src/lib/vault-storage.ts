import type { StateStorage } from 'zustand/middleware';
import { deserialize, serialize, type VaultDoc } from '@hq/store-fs';
import { isTauri } from './platform';
import { readManagedFiles, removeFile, writeFile } from './vault-fs';
import { flushOpenEditors } from './editor-flush';

/** Must match the persist `version` in store.ts — getItem rebuilds zustand's envelope by hand. */
const DOC_VERSION = 1;

const DEBOUNCE_MS = 500;

/** What changed on disk while HQ wasn't looking. */
export interface SyncResult {
  doc: VaultDoc;
  changed: string[];
}

export type VaultStorage = StateStorage & {
  flush(): Promise<void>;
  /** Re-read the vault. `null` when nothing changed outside HQ — the common case. */
  syncFromDisk(): Promise<SyncResult | null>;
  /**
   * Seed the differ from disk without touching state.
   *
   * Only the migration needs this: it writes the vault itself rather than through `setItem`, so
   * `lastWritten` would still be empty and the very first save would see all ~60 paths as new and
   * rewrite the whole vault. Every other path seeds via `getItem`.
   */
  prime(): Promise<void>;
  /**
   * True while an edit is not yet safely on disk: one is waiting out the debounce, is being written,
   * or the last save failed. `syncFromDisk` never reloads in this state, because the reload would
   * replace the edit; quitting asks first.
   */
  hasUnsaved(): boolean;
  /**
   * True once loading the folder has failed. From then on this storage never writes or removes
   * anything: the store still hydrates (to its empty default) and saves that, and that save must never
   * land on his folder. Boot shows the load-error screen instead.
   */
  loadFailed(): boolean;
  /** Why loading failed (zustand swallows it), so boot can tell "still in iCloud" from "unreadable". */
  loadError(): unknown;
};

export interface VaultStorageOptions {
  /**
   * Called once for a save that could not put everything on disk, including one that threw before
   * writing anything (a document the serializer rejects). The failed paths stay out of `lastWritten`
   * and the document stays pending, so the next save (a later edit, a flush, a refocus, quitting, or
   * the retry timer) writes them again. Without this a failure is only logged.
   */
  onSaveError?: (err: unknown) => void;
  /**
   * Where `syncFromDisk` reads, when not `root` itself. The Mac app passes a view of the same folder
   * that never waits for iCloud (`failFastRoot`): the refocus read shares the save queue, so waiting
   * there would hold saves for as long as iCloud takes.
   */
  syncRoot?: FileSystemDirectoryHandle;
}

const RETRY_MS = 5000;

/**
 * A zustand `StateStorage` backed by a folder of markdown and jsonl.
 *
 * Zustand hands `setItem` the *entire* document on every state change. Writing all ~60 files each
 * time would destroy git history, churn every mtime, and make "what actually changed?" unanswerable.
 * So writes are content-diffed against what we last wrote — ticking one checkbox writes one file.
 *
 * Three things make that work, and all three are load-bearing:
 *  1. `lastWritten` is seeded from disk during `getItem`. Starting from an empty map means every path
 *     looks new on the first save of the session and the diff does nothing at all.
 *  2. Every disk touch goes through one promise chain. Two edits either side of the debounce window
 *     would otherwise race on both `lastWritten` and the files themselves.
 *  3. Only paths we wrote are ever deleted, and `writeFile`/`removeFile` refuse unmanaged paths.
 *
 * `syncFromDisk` is the read direction of the same diff: it is how HQ notices that Claude edited the
 * vault behind its back. It never runs over an unsaved edit (`hasUnsaved`).
 */
export function createVaultStorage(root: FileSystemDirectoryHandle, opts: VaultStorageOptions = {}): VaultStorage {
  const lastWritten = new Map<string, string>();
  let queue: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  /** The last save did not fully reach the disk. Cleared by the next save that does. */
  let failed = false;
  /** Saves handed to the queue and not yet finished. */
  let writing = 0;
  /** Loading failed: nothing is ever written through this storage. */
  let loadFailed = false;
  let loadError: unknown = null;
  /** The refocus read in flight, if any. */
  let syncing: Promise<SyncResult | null> | null = null;

  const hasUnsaved = (): boolean => pending !== null || failed || writing > 0;

  /** Serialise every disk touch through one chain. A rejection must not poison later work. */
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(() => fn());
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  /** `lastWritten` must always mirror what is actually on disk right now. */
  const seed = (files: Map<string, string>): void => {
    lastWritten.clear();
    for (const [path, content] of files) lastWritten.set(path, content);
  };

  /** Keep the document for a retry, say so once, and never throw: a save runs from a timer. */
  const fail = (value: string, err: unknown): void => {
    failed = true;
    // Retry this document, unless a newer edit has already replaced it.
    pending ??= value;
    timer ??= setTimeout(() => void flush(), RETRY_MS);
    if (opts.onSaveError) opts.onSaveError(err);
    else console.error('Could not save to the notes folder', err);
  };

  const commit = (value: string): Promise<void> => {
    writing++;
    return run(async () => {
      try {
        await write(value);
      } finally {
        writing--;
      }
    });
  };

  /** One save of one document. Never throws: every failure goes through `fail`. */
  const write = async (value: string): Promise<void> => {
    if (loadFailed) return; // belt and braces: setItem and flush already refuse
    let next: Map<string, string>;
    try {
      next = serialize(JSON.parse(value).state as VaultDoc);
    } catch (err) {
      // Nothing was written. The edit stays in memory and pending.
      fail(value, err);
      return;
    }
    let failure: { err: unknown } | null = null;

    for (const [path, content] of next) {
      if (lastWritten.get(path) === content) continue; // the whole trick
      try {
        await writeFile(root, path, content);
        lastWritten.set(path, content);
      } catch (err) {
        // Not in lastWritten, so the next pass sees it as changed and writes it again.
        lastWritten.delete(path);
        failure ??= { err };
      }
    }
    for (const path of [...lastWritten.keys()]) {
      if (!next.has(path)) {
        try {
          await removeFile(root, path);
          lastWritten.delete(path);
        } catch (err) {
          failure ??= { err };
        }
      }
    }

    if (failure) fail(value, failure.err);
    else failed = false;
  };

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (loadFailed) pending = null;
    if (pending === null) return queue.then(() => undefined);
    const value = pending;
    pending = null;
    return commit(value);
  };

  return {
    getItem: async () => {
      let doc: string | null;
      try {
        const files = await run(() => readManagedFiles(root));
        // an empty folder is "nothing stored yet", not an empty document
        doc = files.size === 0 ? null : JSON.stringify({ state: deserialize(files), version: DOC_VERSION });
        seed(files);
      } catch (err) {
        // A folder we could not read is not an empty folder. Saving now would put the empty default
        // document over his notes, so this storage stops writing for good.
        // That includes notes still in iCloud: a document without them would delete them on save.
        loadFailed = true;
        loadError = err;
        throw err;
      }
      return doc;
    },

    setItem: (_name, value) => {
      if (loadFailed) return;
      pending = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), DEBOUNCE_MS);
    },

    removeItem: async () => {
      if (loadFailed) return;
      await flush();
      await run(async () => {
        for (const path of [...lastWritten.keys()]) await removeFile(root, path);
        lastWritten.clear();
      });
    },

    flush,

    hasUnsaved,

    loadFailed: () => loadFailed,

    loadError: () => loadError,

    prime: async () => {
      seed(await run(() => readManagedFiles(root)));
    },

    syncFromDisk: async () => {
      // Flush first, always. Reading before writing a pending edit would silently revert whatever
      // you were mid-way through typing.
      //
      // The cost, accepted deliberately: if you and Claude both edited the same file, your version
      // wins and theirs is lost. That is last-writer-wins, and it is what the vault plan asks for —
      // "Do not build CRDTs. Do not build a merge UI. One user, one machine, sequential work."
      // Reading first would invert it and lose your live typing instead, which is worse.
      // That flush is also the retry of a failed save. If it failed again, or an edit is still
      // waiting, a reload would replace that edit with the older disk copy: skip it. The next
      // refocus after a good save picks up whatever changed outside.
      if (loadFailed) return null; // the load-error screen owns this folder now
      // One at a time: focus can come back several times while a read is under way, and each extra
      // read would queue ahead of later saves. The one in flight already answers the question.
      if (syncing) return null;
      syncing = sync().finally(() => {
        syncing = null;
      });
      return syncing;
    },
  };

  async function sync(): Promise<SyncResult | null> {
    await flush();

    return run(async () => {
      if (hasUnsaved()) return null;
      const disk = await readManagedFiles(opts.syncRoot ?? root);
      // an edit can land while the read is in flight; the same rule applies
      if (hasUnsaved()) return null;

      const changed: string[] = [];
      for (const [path, content] of disk) if (lastWritten.get(path) !== content) changed.push(path);
      for (const path of lastWritten.keys()) if (!disk.has(path)) changed.push(path);
      if (changed.length === 0) return null;

      // Reseed, or the next save sees every file Claude touched as "changed" and rewrites the vault
      // just because you looked at the tab.
      seed(disk);
      return { doc: deserialize(disk), changed: changed.sort() };
    });
  }
}

/** The part of a Tauri window `flushOnQuit` uses; tests pass a fake. */
export interface QuitWindow {
  onCloseRequested(handler: (event: { preventDefault(): void }) => unknown): Promise<() => void>;
  destroy(): Promise<void>;
}

/** How quitting is decided, for both the window's close and the app's exit. Tests pass their own. */
export interface QuitOptions {
  /** How long to wait for the last save before deciding without it. */
  timeoutMs?: number;
  /** Asked only when the last change did not reach the disk. True to quit anyway. */
  confirmQuit?: () => Promise<boolean>;
}

const QUIT_TIMEOUT_MS = 5000;

/** The words he sees when quitting would lose his last change. */
export const UNSAVED_QUIT_MESSAGE = "Your last change hasn't been saved. Quit anyway?";

/** The native dialog: "Quit anyway" or "Keep open". Only in Tauri; elsewhere quitting is not ours to stop. */
async function askToQuit(): Promise<boolean> {
  if (!isTauri()) return true;
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(UNSAVED_QUIT_MESSAGE, { title: "Elmar's App", kind: 'warning', okLabel: 'Quit anyway', cancelLabel: 'Keep open' });
}

/** What quitting needs from a storage. */
type Quittable = Pick<VaultStorage, 'flush' | 'hasUnsaved'>;

/** The decision in progress, if any: closing the window and Cmd+Q at once must not ask twice. */
let deciding: Promise<boolean> | null = null;

/**
 * Save, then say whether to quit. Waits for the save at most `timeoutMs`, so a disk that never answers
 * cannot hold the app open by itself. If the change still is not on disk (the save failed, or is still
 * stuck), he decides. One decision at a time: a second caller while one is in progress gets the same
 * answer, so "Quit anyway?" never shows twice.
 */
function readyToQuit(storage: Quittable | null, opts: QuitOptions): Promise<boolean> {
  deciding ??= decideQuit(storage, opts).finally(() => {
    deciding = null;
  });
  return deciding;
}

async function decideQuit(
  storage: Quittable | null,
  { timeoutMs = QUIT_TIMEOUT_MS, confirmQuit = askToQuit }: QuitOptions,
): Promise<boolean> {
  // Both the window's close and Cmd+Q come through here. Open editors hand over first: typing still
  // in their debounce, and the set-aside text of an unanswered "changed outside" banner (kept as a
  // conflicted copy), must be in the store before the store is written for the last time.
  // Nothing an editor does may stop the folder's save or the decision: the window must still close.
  try {
    flushOpenEditors('unload');
  } catch (err) {
    console.error('The open editors could not hand over their last change', err);
  }
  if (!storage) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([storage.flush().catch(() => {}), waited]);
  clearTimeout(timer);
  if (!storage.hasUnsaved()) return true;
  return confirmQuit().catch(() => true); // a dialog that cannot show must not trap him
}

/**
 * Write any debounced edit before the window closes, so the last 500ms of typing is not lost.
 *
 * In Tauri: hold the close (`preventDefault`), save, then `destroy` the window. If the change could
 * not be saved, he is asked first and "Keep open" leaves the window as it was. In a browser this falls
 * back to `flushOnUnload`. Register it once per window (vault-boot passes a stand-in for whichever
 * storage is current): a second handler would destroy the window on its own schedule. Resolves to an
 * unsubscribe.
 */
export async function flushOnQuit(storage: Quittable, win?: QuitWindow, opts: QuitOptions = {}): Promise<() => void> {
  if (!win) {
    if (!isTauri()) return flushOnUnload(storage);
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    win = getCurrentWindow();
  }
  const target = win;
  return target.onCloseRequested(async (event) => {
    event.preventDefault();
    if (await readyToQuit(storage, opts)) await target.destroy();
  });
}

/** Rust's side of quitting the whole app (Cmd+Q, the Quit menu): tests pass a fake. */
export interface ExitSource {
  /** Rust held the exit and asks the page to save first. */
  onExitRequested(cb: () => void): Promise<() => void>;
  /** Tell Rust the page is alive and answering, so its no-answer fallback stands down. */
  hold(): Promise<void>;
  /** Tell Rust the page is done; it lets the exit through. */
  exit(): Promise<void>;
  /** He chose to keep the app open: Rust forgets this request and holds the next one again. */
  cancel(): Promise<void>;
}

/** Emitted by src-tauri/src/lib.rs when it holds an exit, and the commands that answer it. Keep in step. */
export const EXIT_EVENT = 'elmar://flush-and-exit';
export const EXIT_COMMANDS = { hold: 'hold_exit', exit: 'allow_exit', cancel: 'cancel_exit' } as const;

async function tauriExitSource(): Promise<ExitSource> {
  const [{ listen }, { invoke }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core')]);
  return {
    onExitRequested: (cb) => listen(EXIT_EVENT, () => cb()),
    hold: () => invoke(EXIT_COMMANDS.hold),
    exit: () => invoke(EXIT_COMMANDS.exit),
    cancel: () => invoke(EXIT_COMMANDS.cancel),
  };
}

/**
 * Write any pending edit before the app quits outright.
 *
 * Quitting (Cmd+Q) does not close the window first, so `flushOnQuit` never hears about it. Rust holds
 * the exit and emits `EXIT_EVENT`. This answers at once (`hold`, so Rust's fallback for a dead page
 * stands down), saves with the same timeout and the same question as closing the window, then lets the
 * exit through or, on "Keep open", cancels it. `storage` is a function so that the current storage is
 * used, or none before a folder is open. Repeated requests while one is in hand are ignored.
 * Resolves to an unsubscribe.
 */
export async function flushOnExit(
  storage: () => Quittable | null,
  source?: ExitSource,
  opts: QuitOptions = {},
): Promise<() => void> {
  const src = source ?? (isTauri() ? await tauriExitSource() : undefined);
  if (!src) return () => {};
  let inHand = false;
  return src.onExitRequested(() => {
    if (inHand) return;
    inHand = true;
    void (async () => {
      try {
        await src.hold().catch(() => {});
        if (await readyToQuit(storage(), opts)) await src.exit();
        else await src.cancel();
      } finally {
        inHand = false;
      }
    })();
  });
}

/** Write any debounced edit before the tab goes away, so the last 500ms of work is not lost. */
export function flushOnUnload(storage: Pick<VaultStorage, 'flush'>): () => void {
  // open editors first: their pending text must be in the store before the store is written.
  // Leaving settles what waits on him; merely hiding the window (switching apps) does not.
  const onPageHide = () => {
    flushOpenEditors('unload');
    void storage.flush();
  };
  const onHidden = () => {
    if (document.visibilityState !== 'hidden') return;
    flushOpenEditors('hide');
    void storage.flush();
  };
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onHidden);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onHidden);
  };
}
