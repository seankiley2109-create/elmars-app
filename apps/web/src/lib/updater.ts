import { create } from 'zustand';
import { isTauri } from './platform';

/**
 * In-app updates for the Mac app.
 *
 * The app looks quietly for a new version on GitHub Releases (the address and the signing key are
 * fixed in tauri.conf.json; Rust checks the update's signature, not this page). When one is there it
 * offers it (UpdateBar). "Update and restart" saves first, exactly as quitting does
 * (`saveBeforeRestart`, which is `readyToQuit`), then downloads and installs, then restarts.
 *
 * Nothing here ever runs in a browser: there is no updater port there, so no check is made and no
 * button is shown. Every failure is quiet (logged) unless he asked: Settings' "Check for updates".
 */

/** How often, at most, the app looks on its own. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** The first look, this long after the app is ready, so it never competes with opening his notes. */
export const FIRST_CHECK_MS = 30 * 1000;
/** How often the timer asks whether a look is due (focus asks too). */
export const TICK_MS = 30 * 60 * 1000;

/** Progress while downloading, as the updater reports it. */
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

/** An update that is there to install. */
export interface FoundUpdate {
  version: string;
  /** The release's notes, when it has any. */
  notes?: string;
  downloadAndInstall(onEvent: (e: DownloadEvent) => void): Promise<void>;
  /** Let go of it without installing (it holds a handle in Rust). */
  close?(): Promise<void>;
}

/** What the app needs from Tauri's updater and process plugins. Tests pass a fake. */
export interface UpdaterPort {
  /** The update, or null when this is the newest version. Throws when it cannot look (offline). */
  check(): Promise<FoundUpdate | null>;
  relaunch(): Promise<void>;
}

/** The words he reads. Exported for the copy test. */
export const UPDATE_COPY = {
  ready: "A new version of Elmar's App is ready.",
  update: 'Update and restart',
  later: 'Later',
  saving: 'Saving your notes…',
  downloading: 'Getting the new version…',
  restarting: 'Restarting…',
  failed: "The update couldn't be installed. Your notes are safe. Try again later.",
  check: 'Check for updates',
  checking: 'Checking…',
  upToDate: (version: string) => `You're up to date (${version}).`,
  found: (version: string) => `Version ${version} is ready. Choose “Update and restart” to install it.`,
  checkFailed: "Couldn't check for updates. Check the internet connection and try again later.",
  installed: (version: string) => `Version ${version} is installed. It starts the next time you open the app.`,
} as const;

/** The one short line under the offer: the version, and the first line of its notes if it has any. */
export function offerLine(update: Pick<FoundUpdate, 'version' | 'notes'>): string {
  const first = (update.notes ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[#*\-\s]+/, '').trim())
    .find((l) => l.length > 0);
  if (!first) return `Version ${update.version}`;
  const short = first.length > 90 ? `${first.slice(0, 89).trimEnd()}…` : first;
  return `Version ${update.version} · ${short}`;
}

/** Whether a quiet look is due: never looked, or the last look was at least `CHECK_EVERY_MS` ago. */
export function isCheckDue(lastCheckedAt: number | null, now: number): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= CHECK_EVERY_MS;
}

export type UpdatePhase = 'offer' | 'saving' | 'downloading' | 'restarting' | 'failed';

interface UpdateState {
  /** The update on offer, if one was found. */
  offer: FoundUpdate | null;
  /** Whether the bar is up. "Later" puts it away until the next look finds the update again. */
  shown: boolean;
  phase: UpdatePhase;
  /** Bytes downloaded so far, and of how many (when the server says). */
  progress: { done: number; total?: number };
  lastCheckedAt: number | null;
  /**
   * A version already installed but not yet running: he chose "Keep open" at the last save before the
   * restart. It is not offered again; it starts the next time he opens the app.
   */
  installedVersion: string | null;
}

const initial: UpdateState = {
  offer: null,
  shown: false,
  phase: 'offer',
  progress: { done: 0 },
  lastCheckedAt: null,
  installedVersion: null,
};

export const useUpdates = create<UpdateState>(() => ({ ...initial }));

/** Save everything before the app goes away: true to go ahead. In the app this is `readyToQuit`. */
type SaveFirst = () => Promise<boolean>;

const tauriPort: UpdaterPort = {
  async check() {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 30_000 });
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body,
      downloadAndInstall: (onEvent) => update.downloadAndInstall(onEvent),
      close: () => update.close(),
    };
  },
  async relaunch() {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  },
};

/** The same save-and-decide as quitting, through vault-boot's current storage. Imported lazily. */
const saveViaQuitPath: SaveFirst = async () => {
  const { saveBeforeRestart } = await import('./vault-boot');
  return saveBeforeRestart();
};

let port: UpdaterPort | null | undefined;
let saveFirst: SaveFirst = saveViaQuitPath;

function currentPort(): UpdaterPort | null {
  if (port === undefined) port = isTauri() ? tauriPort : null;
  return port;
}

/** Tests: use these fakes instead of Tauri. `port: null` is "a browser" (no updates). */
export function configureUpdater(opts: { port?: UpdaterPort | null; save?: SaveFirst }): void {
  if ('port' in opts) port = opts.port;
  if (opts.save) saveFirst = opts.save;
}

/** Tests: back to the start, with the real ports. */
export function resetUpdater(): void {
  port = undefined;
  saveFirst = saveViaQuitPath;
  looking = null;
  useUpdates.setState({ ...initial });
}

/** Whether this copy of the app can update itself: only the Mac app. */
export function canUpdate(): boolean {
  return currentPort() !== null;
}

export type CheckResult =
  | { kind: 'none' }
  | { kind: 'available'; version: string }
  /** The newest version is already installed and starts next time (see `installedVersion`). */
  | { kind: 'installed'; version: string }
  | { kind: 'error' };

let looking: Promise<CheckResult> | null = null;

/**
 * Look for an update now. Found: it is offered (the bar comes up). Nothing found or it could not look:
 * nothing changes on screen; the caller decides whether to say so (only Settings does). One look at a
 * time: a second caller meanwhile gets the same answer.
 */
export function checkForUpdate(now: number = Date.now()): Promise<CheckResult> {
  const p = currentPort();
  if (!p) return Promise.resolve({ kind: 'none' });
  looking ??= (async (): Promise<CheckResult> => {
    useUpdates.setState({ lastCheckedAt: now });
    try {
      const found = await p.check();
      if (!found) return { kind: 'none' };
      const { phase, offer: previous, installedVersion } = useUpdates.getState();
      if (found.version === installedVersion) {
        void found.close?.().catch(() => {});
        return { kind: 'installed', version: found.version };
      }
      // an install already under way keeps its own update
      if (phase === 'saving' || phase === 'downloading' || phase === 'restarting') {
        void found.close?.().catch(() => {});
        return { kind: 'available', version: previous?.version ?? found.version };
      }
      if (previous && previous !== found) void previous.close?.().catch(() => {});
      useUpdates.setState({ offer: found, shown: true, phase: 'offer', progress: { done: 0 } });
      return { kind: 'available', version: found.version };
    } catch (err) {
      console.warn('Could not check for an update', err);
      return { kind: 'error' };
    }
  })().finally(() => {
    looking = null;
  });
  return looking;
}

/** The app's own looks (after start, on focus, on the timer): only when due, and never a word on screen. */
export async function checkQuietly(now: number = Date.now()): Promise<void> {
  if (!canUpdate() || !isCheckDue(useUpdates.getState().lastCheckedAt, now)) return;
  await checkForUpdate(now);
}

/** "Later": put the offer away. The next look brings it back. */
export function dismissUpdate(): void {
  const { phase } = useUpdates.getState();
  if (phase === 'saving' || phase === 'downloading' || phase === 'restarting') return;
  useUpdates.setState({ shown: false, phase: 'offer' });
}

/**
 * "Update and restart": save first (the same decision as quitting; if the last change could not be
 * saved he is asked, and "Keep open" stops here with nothing installed), then download and install,
 * save once more (anything typed while it downloaded), then restart into the new version. Any failure
 * leaves the app running, says so plainly, and his notes untouched.
 */
export async function installUpdate(): Promise<void> {
  const p = currentPort();
  const { offer, phase } = useUpdates.getState();
  if (!p || !offer || phase === 'saving' || phase === 'downloading' || phase === 'restarting') return;

  useUpdates.setState({ phase: 'saving', progress: { done: 0 } });
  if (!(await saveFirst().catch(() => false))) {
    useUpdates.setState({ phase: 'offer' });
    return;
  }

  useUpdates.setState({ phase: 'downloading' });
  try {
    await offer.downloadAndInstall((e) => {
      if (e.event === 'Started') useUpdates.setState({ progress: { done: 0, total: e.data.contentLength } });
      else if (e.event === 'Progress') {
        const { progress } = useUpdates.getState();
        useUpdates.setState({ progress: { ...progress, done: progress.done + e.data.chunkLength } });
      }
    });
  } catch (err) {
    console.error('The update could not be installed', err);
    useUpdates.setState({ phase: 'failed' });
    return;
  }

  // Typing while it downloaded is saved too. The new version is already in place, so "Keep open" here
  // only puts off the restart: it starts the next time he opens the app, and is not offered again.
  useUpdates.setState({ phase: 'saving' });
  if (!(await saveFirst().catch(() => false))) {
    void offer.close?.().catch(() => {});
    useUpdates.setState({ offer: null, shown: false, phase: 'offer', installedVersion: offer.version });
    return;
  }

  useUpdates.setState({ phase: 'restarting' });
  try {
    await p.relaunch();
  } catch (err) {
    console.error('The app could not restart after the update', err);
    useUpdates.setState({ phase: 'failed' });
  }
}

/** The progress line while downloading: "Getting the new version… 40%" when the size is known. */
export function progressLine(progress: { done: number; total?: number }): string {
  if (!progress.total) return UPDATE_COPY.downloading;
  const pct = Math.min(100, Math.round((progress.done / progress.total) * 100));
  return `${UPDATE_COPY.downloading} ${pct}%`;
}
