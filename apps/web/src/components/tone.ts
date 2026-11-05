/**
 * The one place the semantic tones map to concrete classes.
 *
 * There are three surfaces that draw a toned thing — the pill (Chip, and now every calendar chip
 * too — Month and Week share the same pill treatment), the solid dot (priority dot), and
 * the calendar bar segment — and each needs a *different* class shape (a dot is a solid fill; a
 * bar is a translucent fill). They used to live as four parallel maps that overlapped but didn't
 * match, which is exactly how they drift. Here every tone's variants sit together, so a palette
 * change is one edit and the variants can never disagree about what "warn" is.
 *
 * The strings must stay *literal* — Tailwind's JIT scans source for whole class names, so a computed
 * `bg-${tone}` would generate no CSS. That's why this is a table of literals, not a formula.
 */
export type ChipTone = 'ok' | 'warn' | 'dim' | 'accent' | 'danger';

interface ToneVariants {
  /** Chip pill: text + translucent fill + border. Used by every calendar chip now too. */
  pill: string;
  /** Solid dot (priority dot). */
  dot: string;
  /** Calendar bar segment: border + translucent fill. */
  segment: string;
}

export const TONES: Record<ChipTone, ToneVariants> = {
  accent: {
    pill: 'text-accent bg-accent/10 border-accent/30',
    dot: 'bg-accent',
    segment: 'border-accent/60 bg-accent/20',
  },
  warn: {
    pill: 'text-warn bg-warn/10 border-warn/30',
    dot: 'bg-warn',
    segment: 'border-warn/60 bg-warn/20',
  },
  ok: {
    pill: 'text-ok bg-ok/10 border-ok/30',
    dot: 'bg-ok',
    segment: 'border-ok/50 bg-ok/15',
  },
  dim: {
    pill: 'text-dim bg-dim/10 border-dim/30',
    dot: 'bg-dim',
    segment: 'border-dim/40 bg-dim/15 text-muted',
  },
  danger: {
    pill: 'text-danger bg-danger/10 border-danger/30',
    dot: 'bg-danger',
    segment: 'border-danger/60 bg-danger/20',
  },
};

/** Projections — each surface reads its own column. */
export const TONE_STYLE: Record<ChipTone, string> = {
  accent: TONES.accent.pill,
  warn: TONES.warn.pill,
  ok: TONES.ok.pill,
  dim: TONES.dim.pill,
  danger: TONES.danger.pill,
};

export const MARKER_TONE: Record<ChipTone, string> = {
  accent: TONES.accent.dot,
  warn: TONES.warn.dot,
  ok: TONES.ok.dot,
  dim: TONES.dim.dot,
  danger: TONES.danger.dot,
};

export const SEGMENT_TONE: Record<ChipTone, string> = {
  accent: TONES.accent.segment,
  warn: TONES.warn.segment,
  ok: TONES.ok.segment,
  dim: TONES.dim.segment,
  danger: TONES.danger.segment,
};

/** The raw CSS variable for a tone — for SVG `fill`/`stroke` (the map), where Tailwind classes can't
 *  reach. Keeps the map's status colours reading from the same source as every pill and chip. */
export const TONE_VAR: Record<ChipTone, string> = {
  accent: 'var(--accent)',
  warn: 'var(--warn)',
  ok: 'var(--ok)',
  dim: 'var(--dim)',
  danger: 'var(--danger)',
};
