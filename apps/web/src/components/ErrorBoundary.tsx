import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { btnGhost, btnPrimary } from './ui';

/**
 * The shell must survive a view. Before this, any throw inside a routed view (a malformed date
 * from a hand-edited vault, a selector that spun up) unmounted the whole tree — the user got a
 * blank page, no sidebar, no way back. This catches the view and keeps the nav alive.
 *
 * `resetKey` (the current pathname) clears a caught error the moment the route changes, so
 * navigating away from a broken view recovers without a reload.
 */
export default class ErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('View crashed:', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border border-warn/30 bg-surface p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warn/10 text-warn">
            <AlertTriangle size={22} />
          </div>
          <h2 className="text-lg font-bold">Something broke on this page</h2>
          <p className="mt-1 text-sm text-muted">
            The rest of the app is fine — your data is untouched. Reload to recover, or switch to
            another page from the sidebar.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button onClick={() => window.location.reload()} className={btnPrimary}>
              Reload
            </button>
            <button onClick={() => this.setState({ error: null })} className={btnGhost}>
              Try again
            </button>
          </div>
          <details className="mt-5 text-left">
            <summary className="cursor-pointer text-xs text-dim hover:text-muted">
              Technical details
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface2 p-3 text-2xs text-dim">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
