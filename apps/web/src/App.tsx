import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Sidebar, { NAV_ITEMS } from './components/Sidebar';
import Onboarding from './components/Onboarding';
import OpenVault from './components/OpenVault';
import FirstRun from './components/FirstRun';
import LoadError from './components/LoadError';
import IcloudPending, { DownloadProgress } from './components/IcloudPending';
import SaveErrorToast from './components/SaveErrorToast';
import { useVaultBoot } from './lib/vault-boot';
import CommandPalette from './components/CommandPalette';
import CaptureBar from './components/CaptureBar';
import ShortcutHelp from './components/ShortcutHelp';
import VaultToast from './components/VaultToast';
import UndoToastHost from './components/UndoToastHost';
import NoticeToastHost from './components/NoticeToastHost';
import TaskDetailHost from './components/TaskDetailHost';
import ErrorBoundary from './components/ErrorBoundary';
import EvernoteImport from './components/EvernoteImport';
import { onOpenEvernoteImport } from './lib/evernote-open';
import { useHQ } from './store';
import Home from './views/Home';
import Projects from './views/Projects';
import ProjectWorkspace from './views/ProjectWorkspace';
import CalendarPage from './views/CalendarPage';
import MapView from './views/MapView';
import Notes from './views/Notes';
import Settings from './views/Settings';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export default function App() {
  const hydrated = useHQ((s) => s.hydrated);
  const onboarded = useHQ((s) => s.settings.onboarded);
  const [vault, setVault] = useVaultBoot();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // The one Evernote import sheet. It lives here, not on a page, so an import and its report outlive
  // the page that started it. First launch opens it after onboarding completes with his name; anywhere
  // else opens it with `openEvernoteImport()`.
  const [importOpen, setImportOpen] = useState(false);
  const importRunning = useRef(false);
  const focusMainAfterImport = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const completeOnboarding = useHQ((s) => s.completeOnboarding);
  const pendingG = useRef<number | null>(null);

  useEffect(() => onOpenEvernoteImport(() => setImportOpen(true)), []);
  const onImportRunning = useCallback((running: boolean) => {
    importRunning.current = running;
  }, []);
  // Opened from first launch, the sheet had nothing to hand focus back to: land on the page instead.
  useEffect(() => {
    if (importOpen || !focusMainAfterImport.current) return;
    focusMainAfterImport.current = false;
    mainRef.current?.focus();
  }, [importOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While notes are coming in from Evernote, shortcuts wait: nothing may pull the sheet away.
      if (importRunning.current) return;
      // ⌘K / Ctrl+K — search, always available
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCaptureOpen(false);
        setPaletteOpen((v) => !v);
        return;
      }
      // ⌘N / Ctrl+N — capture a task, always available
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setPaletteOpen(false);
        setCaptureOpen(true);
        return;
      }
      if (paletteOpen || captureOpen || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      // g + letter navigation
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const item = NAV_ITEMS.find((n) => n.key === e.key.toLowerCase());
        if (item) {
          e.preventDefault();
          navigate(item.to);
        }
        return;
      }
      if (e.key === 'g') {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, 900);
        return;
      }
      // ? — the shortcut map itself
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      // n — jump to the current view's primary input
      if (e.key === 'n') {
        const input = document.querySelector<HTMLElement>(
          'main input[type="text"], main input:not([type]), main textarea',
        );
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, paletteOpen, captureOpen]);

  // The vault gate sits above the `hydrated` gate on purpose: with skipHydration nothing sets
  // `hydrated` until a backend is chosen, so the spinner below would never resolve on its own.
  if (vault.kind === 'load-error') {
    return <LoadError path={vault.path} onChange={setVault} />;
  }
  if (vault.kind === 'icloud-pending') {
    return <IcloudPending count={vault.count} onChange={setVault} />;
  }
  if (vault.kind === 'needs-folder' && 'suggested' in vault) {
    return <FirstRun suggested={vault.suggested} missing={vault.missing} onChange={setVault} />;
  }
  if (vault.kind === 'needs-folder' || vault.kind === 'needs-permission') {
    return <OpenVault state={vault} onChange={setVault} />;
  }

  if (!hydrated) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <span className="glow h-3 w-3 animate-pulse rounded-full bg-accent" aria-label="Loading" />
        <DownloadProgress />
      </div>
    );
  }

  if (!onboarded) {
    return (
      <Onboarding
        onImport={(name) => {
          completeOnboarding(name);
          focusMainAfterImport.current = true;
          setImportOpen(true);
        }}
      />
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar onSearch={() => setPaletteOpen(true)} />
      {/* Notes is three panes edge to edge, each scrolling on its own (Task 10) */}
      <main
        ref={mainRef}
        tabIndex={-1}
        className={`flex-1 outline-none ${pathname.startsWith('/notes') ? 'min-w-0 overflow-hidden max-md:pb-16' : 'overflow-y-auto px-6 py-8 pb-24 md:px-10 md:pb-8'}`}
      >
        {/* Today and Calendar earn extra width; the Map takes it all; Notes is full-bleed. */}
        <div
          className={`h-full ${
            pathname.startsWith('/notes')
              ? ''
              : `mx-auto ${pathname === '/' || pathname === '/calendar' ? 'max-w-6xl' : pathname === '/map' ? 'max-w-none' : 'max-w-5xl'}`
          }`}
        >
          <ErrorBoundary resetKey={pathname}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectWorkspace />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/notes/:id" element={<Notes />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/map" element={<MapView />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onCapture={() => setCaptureOpen(true)}
      />
      <CaptureBar open={captureOpen} onClose={() => setCaptureOpen(false)} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <VaultToast />
      <SaveErrorToast />
      <UndoToastHost />
      <NoticeToastHost />
      <TaskDetailHost />
      <EvernoteImport open={importOpen} onClose={() => setImportOpen(false)} onRunningChange={onImportRunning} />

      {/* Search on a narrow window, where the rail (and its search button) is hidden */}
      <button
        onClick={() => setPaletteOpen(true)}
        className="fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full border border-line-strong bg-panel px-3.5 py-2 text-xs text-ink-2 shadow-lg transition-colors hover:text-ink md:hidden"
        aria-label="Search"
      >
        <span>Search</span>
      </button>
    </div>
  );
}
