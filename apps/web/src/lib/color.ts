/**
 * Blend a colour over white at `alpha` (0 = white, 1 = the colour) and return `#RRGGBB`.
 * Used for event fills: a calendar block wants the project's hue as a quiet wash, not a solid slab,
 * and a flat hex (rather than `color-mix`) keeps the ink on it at a known contrast.
 */
export function tint(hex: string, alpha: number): string {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#FFFFFF';
  const a = Math.min(1, Math.max(0, alpha));
  const out = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16);
    const v = Math.round(255 + (c - 255) * a);
    return v.toString(16).padStart(2, '0');
  });
  return `#${out.join('').toUpperCase()}`;
}
