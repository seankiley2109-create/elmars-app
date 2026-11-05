import { describe, expect, it } from 'vitest';
import { tint } from './color';

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('tint', () => {
  it('blends a colour over white', () => {
    const got = tint('#D64D1E', 0.14);
    expect(got).toMatch(/^#[0-9A-F]{6}$/);
    const want = channels('#F9E6E0');
    channels(got).forEach((c, i) => expect(Math.abs(c - want[i])).toBeLessThanOrEqual(1));
  });

  it('is white at 0 and the colour itself at 1', () => {
    expect(tint('#D64D1E', 0)).toBe('#FFFFFF');
    expect(tint('#D64D1E', 1)).toBe('#D64D1E');
  });

  it('accepts three-digit hex and no leading hash', () => {
    expect(tint('#000', 0.5)).toBe(tint('000000', 0.5));
  });
});
