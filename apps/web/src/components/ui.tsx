import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { ProjectStatus } from '../types';
import { STATUS_LABEL } from '../types';
// Tones live in one table (tone.ts) so the four toned surfaces can't drift; re-exported here because
// this is where callers have always reached for them.
import { TONE_STYLE, type ChipTone } from './tone';

export { TONE_STYLE };
export type { ChipTone };

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-surface ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="label mb-3">{children}</div>;
}

/*
 * Z-scale, app-wide (enforce by convention — there is no token):
 *   z-30  floating chips (search hint, VaultToast)
 *   z-40  mobile nav + overlay backdrops (Overlay.tsx)
 *   z-50  overlay panels (SlideOver, CommandPalette, CaptureBar)
 *   z-[60] undo toasts — must sit above a slide-over that just fired a delete
 */

/**
 * The one pill shape: dot + label, toned. `toneClass` is the escape hatch for a rare off-palette
 * variant — everything else picks a tone.
 */
export function Chip({
  tone = 'dim',
  toneClass,
  title,
  className = '',
  children,
}: {
  tone?: ChipTone;
  toneClass?: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-semibold tracking-wide ${toneClass ?? TONE_STYLE[tone]} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

const STATUS_TONE: Record<ProjectStatus, ChipTone> = {
  active: 'warn',
  blocked: 'danger',
  later: 'dim',
  shipped: 'ok',
};

export function StatusChip({ status }: { status: ProjectStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-8 py-16 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted">{hint}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Task completion bar. Hidden until the project has tasks — 0% of nothing is noise, not progress. */
export function ProgressBar({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="mt-3 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface2">
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
      <span className="tnum text-2xs text-muted">
        {done}/{total} · {pct}%
      </span>
    </div>
  );
}

/**
 * The keyboard focus ring as utilities: 2px of `--mt-focus`, offset 2. For anything that turns the
 * outline off (`outline-none`) and so would otherwise lose the global ring. `outline-solid` is needed
 * because `outline-none` also sets the outline style to none.
 */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus';

/** The same ring on a whole bar (search, capture) whose bare input inside has keyboard focus. */
export const BAR_FOCUS_RING =
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus';

export const fieldCls = `rounded-xl border border-line bg-surface2 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent ${FOCUS_RING}`;

export const inputCls = `w-full ${fieldCls}`;

/** A full-width <select> that matches text inputs. (The on-system chevron is applied globally in
 *  index.css to every <select>, so bare native selects elsewhere pick it up too.) */
export const selectCls = inputCls;

type SegmentedOption<T extends string> = { value: T; label: ReactNode };

/**
 * The one segmented toggle: a pill row where the active segment washes accent. Replaces the
 * per-view re-implementations (Week/Month, Today/Calendar/Board, list/board/timeline) so they can't
 * drift apart.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex items-center gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          onClick={() => onChange(o.value)}
          aria-selected={value === o.value}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            value === o.value ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The button class. Callers that need an active or danger state pass a `tone`/`active` instead of
 * bolting `!important` overrides onto the base string — the base never sets a colour that a tone
 * then has to fight, so plain concatenation always wins.
 */
export function btn(
  o: { variant?: 'ghost' | 'primary'; tone?: 'default' | 'accent' | 'danger'; active?: boolean } = {},
): string {
  const { variant = 'ghost', tone = 'default', active = false } = o;
  if (variant === 'primary') {
    return 'inline-flex items-center gap-2 rounded-xl bg-action px-4 py-2 text-sm font-semibold text-on-action transition-colors hover:bg-action-hover disabled:opacity-40';
  }
  const base = 'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors';
  const color =
    tone === 'danger'
      ? 'border-line text-warn hover:border-warn'
      : tone === 'accent' || active
        ? 'border-accent text-accent'
        : 'border-line text-muted hover:border-accent hover:text-ink';
  return `${base} ${color}`;
}

// Kept as the common string forms so the many neutral call sites don't churn; variants use btn().
export const btnPrimary = btn({ variant: 'primary' });
export const btnGhost = btn();

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const BUTTON_BASE =
  'inline-flex h-10 items-center gap-2 rounded-md px-4 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // the one action on a screen: Montana's magenta
  primary: 'border border-action bg-action text-on-action hover:border-action-hover hover:bg-action-hover',
  secondary: 'border border-line-strong bg-panel text-ink hover:bg-raised',
  quiet: 'border border-transparent bg-transparent text-ink-2 hover:bg-raised hover:text-ink',
  // a destructive action: Montana's critical red (#B42B2B) on white, 6.7:1
  danger: 'border border-crit bg-panel text-crit hover:bg-crit-bg',
};

/** The Montana button class, for a link or anything else that should look like a `Button`. */
export function buttonCls(variant: ButtonVariant = 'secondary'): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANT[variant]}`;
}

/** The Montana button: 40px tall, 6px corners. Primary uses `--mt-action`; secondary is outlined. */
export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`${buttonCls(variant)} ${className}`} {...rest} />;
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
