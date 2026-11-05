import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHQ, isUsingVault } from '../store';
import { Button, FOCUS_RING } from '../components/ui';
import Modal from '../components/Modal';
import { formatShort, dayOfIso } from '../lib/dates';
import {
  CANT_SAVE,
  backupSummary,
  describeRestore,
  describeSave,
  parseBackup,
  restoreBackup,
  saveBackup,
  type ParsedBackup,
} from '../lib/backup';
import { migrateToVault } from '../lib/vault-migrate';
import { supportsFileSystemAccess } from '../lib/vault-fs';
import { isTauri } from '../lib/platform';
import { VAULT_PATH_KEY } from '../lib/vault-boot';
import { appVersion } from '../lib/app-version';
import { openEvernoteImport } from '../lib/evernote-open';
import { UPDATE_COPY, canUpdate, checkForUpdate } from '../lib/updater';

type Message = { tone: 'ok' | 'warn'; text: string };

/** Every control on this page is at least 44 px tall (the global Button is 40). */
const TALL = 'min-h-11';

/** A text field at Montana's 6 px corners and 44 px height. */
const FIELD = `${TALL} rounded-md border border-line-strong bg-panel px-3.5 text-sm outline-none transition-colors focus:border-accent ${FOCUS_RING}`;

/** The folder the Mac app keeps his notes in, as it recorded it. Null in a browser. */
function savedFolder(): string | null {
  try {
    return localStorage.getItem(VAULT_PATH_KEY);
  } catch {
    return null;
  }
}

function Section({ id, title, children, tone }: { id: string; title: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <section
      aria-labelledby={id}
      className={`rounded-lg border bg-panel ${tone === 'danger' ? 'border-crit/30' : 'border-line'}`}
    >
      <h2 id={id} className="px-5 pt-4 text-[17px] leading-6">
        {title}
      </h2>
      <div className="space-y-3 px-5 pb-5 pt-2">{children}</div>
    </section>
  );
}

/**
 * Settings: his name, where his notes live, bringing in Evernote, backups, and what this app is.
 * Erasing everything sits last, behind a typed confirmation. Whatever he does here, the result is
 * said in the status line at the top; nothing fails silently.
 */
export default function Settings() {
  const state = useHQ();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [moving, setMoving] = useState(false);
  const [onVault, setOnVault] = useState(isUsingVault);
  const [pending, setPending] = useState<Extract<ParsedBackup, { ok: true }> | null>(null);
  const [version, setVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const folder = savedFolder();
  const inTauri = isTauri();
  const location = useLocation();
  const navigate = useNavigate();
  const handledAsk = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void appVersion().then((v) => live && setVersion(v));
    return () => {
      live = false;
    };
  }, []);

  // ⌘K "Save a backup file" lands here so the result is shown; the request is used once and cleared.
  useEffect(() => {
    if (!(location.state as { saveBackup?: boolean } | null)?.saveBackup) return;
    if (handledAsk.current === location.key) return;
    handledAsk.current = location.key;
    navigate(location.pathname, { replace: true, state: null });
    void doSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  /* where the notes live */
  const inICloud = folder?.includes('com~apple~CloudDocs') ?? false;
  const where = inTauri || onVault ? 'in your notes folder on this Mac' : 'saved in this browser';

  const showInFinder = async () => {
    if (!folder) return;
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(folder);
    } catch {
      setMessage({ tone: 'warn', text: "Couldn't open that folder in Finder." });
    }
  };

  // Browser only: the Mac app picks its folder on first run and does not switch.
  const doMigrate = async () => {
    setMoving(true);
    setMessage(null);
    try {
      const r = await migrateToVault();
      if (r.ok) {
        setOnVault(true);
        setMessage({
          tone: 'ok',
          text: `Moved to “${r.folder}” — ${r.files} files and ${r.assets} attachments. Everything is now saved in that folder.`,
        });
      } else {
        setMessage({ tone: 'warn', text: r.error });
      }
    } catch (e) {
      setMessage({ tone: 'warn', text: e instanceof Error ? e.message : 'Could not move to that folder.' });
    } finally {
      setMoving(false);
    }
  };

  /* backup */
  async function doSave() {
    setMessage(null);
    const r = await saveBackup().catch(() => ({ kind: 'failed' as const, error: CANT_SAVE }));
    setMessage(describeSave(r));
  }

  // Restoring replaces everything, so nothing is touched until he has confirmed what will be replaced.
  const doPick = async (file: File) => {
    const parsed = parseBackup(await file.text().catch(() => ''));
    if (!parsed.ok) {
      setMessage({ tone: 'warn', text: parsed.error });
      return;
    }
    setMessage(null);
    setPending(parsed);
  };

  const confirmRestore = async () => {
    if (!pending) return;
    const raw = pending.raw;
    setPending(null);
    try {
      setMessage(describeRestore(await restoreBackup(raw)));
    } catch {
      setMessage({ tone: 'warn', text: "Couldn't restore that backup." });
    }
  };

  /* updates (the Mac app only): the answer is said in the status line; a new version is also offered */
  const doCheck = async () => {
    setChecking(true);
    setMessage(null);
    try {
      const r = await checkForUpdate();
      if (r.kind === 'available') setMessage({ tone: 'ok', text: UPDATE_COPY.found(r.version) });
      else if (r.kind === 'installed') setMessage({ tone: 'ok', text: UPDATE_COPY.installed(r.version) });
      else if (r.kind === 'none') setMessage({ tone: 'ok', text: UPDATE_COPY.upToDate(version || (await appVersion())) });
      else setMessage({ tone: 'warn', text: UPDATE_COPY.checkFailed });
    } finally {
      setChecking(false);
    }
  };

  const doClear = () => {
    state.clearAll();
    setConfirmText('');
    setMessage({ tone: 'ok', text: 'Everything has been erased.' });
  };

  const have = {
    projects: state.projects.length,
    tasks: state.tasks.length,
    notes: state.notes.length,
    events: state.events.length,
    files: state.assets.length,
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-4xl leading-10">Settings</h1>
        {/* always present, so a screen reader hears each result the moment it is set */}
        <div role="status" className="mt-4 empty:mt-0">
          {message && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                message.tone === 'ok' ? 'border-ok/40 bg-ok-bg text-ok' : 'border-warn/40 bg-warn-bg text-warn'
              }`}
            >
              {message.text}
            </div>
          )}
        </div>
      </div>

      <Section id="settings-name" title="Your name">
        <label className="block">
          <span className="mb-1.5 block text-2sm text-ink-2">The greeting on Today uses it.</span>
          <input
            className={`${FIELD} w-full max-w-xs`}
            value={state.settings.userName ?? ''}
            onChange={(e) => state.setUserName(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
          />
        </label>
      </Section>

      <Section id="settings-notes" title="Where your notes live">
        {folder ? (
          <>
            <p className="mono break-all text-2sm text-ink" data-testid="notes-folder">
              {folder}
            </p>
            <p className="text-2sm text-ink-2">
              {inICloud
                ? 'This folder is in iCloud Drive, which keeps a copy safe if this Mac is lost.'
                : "This folder isn't in iCloud Drive, so your notes are saved on this Mac only."}
            </p>
            {inTauri && (
              <Button className={TALL} onClick={() => void showInFinder()}>
                Show in Finder
              </Button>
            )}
          </>
        ) : inTauri ? (
          <p className="text-2sm text-ink-2" data-testid="notes-folder">
            Your notes folder, chosen when you first opened the app. Everything is saved there as plain files you can
            open without this app.
          </p>
        ) : onVault ? (
          <p className="text-2sm text-ink-2">
            Everything is saved in your folder as plain files you can open without this app.
          </p>
        ) : supportsFileSystemAccess() ? (
          <>
            <p className="text-2sm text-ink-2">
              Everything is currently in browser storage, so clearing site data would erase it. Move it into a folder
              you own and it becomes plain files you can open without this app.
            </p>
            <Button className={TALL} onClick={() => void doMigrate()} disabled={moving}>
              {moving ? 'Moving…' : 'Move to a folder'}
            </Button>
          </>
        ) : (
          <p className="text-2sm text-ink-2">
            Everything is saved in this browser. Save a backup file now and then; Chrome or Edge can save to a folder
            instead.
          </p>
        )}
      </Section>

      <Section id="settings-evernote" title="Evernote">
        <p className="text-2sm text-ink-2">Bring your notes across from an Evernote export. Your Evernote stays as it is.</p>
        <Button className={TALL} onClick={() => openEvernoteImport()}>
          Bring your Evernote notes
        </Button>
      </Section>

      <Section id="settings-backup" title="Backup">
        <p className="text-2sm text-ink-2">
          {state.settings.lastExportAt
            ? `Your last backup was on ${formatShort(dayOfIso(state.settings.lastExportAt))}.`
            : "You haven't saved a backup yet."}{' '}
          A backup is one file holding your projects, tasks, notes, events and attached files.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" className={TALL} onClick={() => void doSave()}>
            Save a backup file…
          </Button>
          <Button className={TALL} onClick={() => fileRef.current?.click()}>
            Restore from a backup…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Backup file to restore"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doPick(f);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section id="settings-about" title="About">
        <p className="text-2sm text-ink-2">
          <span className="font-semibold text-ink">Elmar&apos;s App</span>
          {version && (
            <>
              {' · Version '}
              <span className="mono">{version}</span>
            </>
          )}
        </p>
        {canUpdate() && (
          <Button className={TALL} onClick={() => void doCheck()} disabled={checking}>
            {checking ? UPDATE_COPY.checking : UPDATE_COPY.check}
          </Button>
        )}
      </Section>

      <Section id="settings-danger" title="Danger" tone="danger">
        <p className="text-2sm text-ink-2" data-testid="erase-warning">
          Erase everything deletes all the notes, tasks, projects, events and attached files {where}. This can&apos;t be
          undone, so save a backup first. Type <span className="mono font-semibold text-crit">ERASE</span> to unlock it.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className={`${FIELD} w-40`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="ERASE"
            aria-label="Type ERASE to confirm"
          />
          <Button variant="danger" className={TALL} onClick={doClear} disabled={confirmText !== 'ERASE'}>
            Erase everything
          </Button>
        </div>
      </Section>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        label="Restore from a backup"
        placement="center"
        className="w-[min(92vw,30rem)]"
      >
        <div className="rounded-lg border border-line bg-panel p-5 shadow-2xl">
          <h2 className="text-[17px] leading-6">Restore from this backup?</h2>
          {pending && (
            <p className="mt-2 text-sm text-ink-2" data-testid="restore-summary">
              This replaces everything {where} ({backupSummary(have)}) with what is in the backup (
              {backupSummary({
                projects: pending.incoming.projects.length,
                tasks: pending.incoming.tasks.length,
                notes: pending.incoming.notes.length,
                events: pending.incoming.events.length,
                files: pending.incoming.assets.length,
              })}
              ). Anything that isn&apos;t in the backup will be gone, and this can&apos;t be undone.
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button className={TALL} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="danger" className={TALL} onClick={() => void confirmRestore()}>
              Replace and restore
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
