import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  retryLoad: vi.fn(),
  chooseFolder: vi.fn(async (): Promise<string | null> => '/Users/elmar/Documents/Notes'),
  openFolderAt: vi.fn(async (_p: string) => ({ kind: 'ready' as const })),
  openVault: vi.fn(async () => ({ kind: 'ready' as const })),
}));
vi.mock('../lib/vault-boot', () => m);
vi.mock('../lib/platform', () => ({ isTauri: () => true }));

import LoadError from './LoadError';

const FORBIDDEN = /\b(vault|jobs?|runs?|backlog|shipped|signals?|inbox)\b/i;

describe('LoadError', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('says plainly that nothing was changed, and shows the folder', () => {
    render(<LoadError path="/Users/elmar/Elmar's App" onChange={() => {}} />);
    const shown = document.body.textContent ?? '';
    expect(shown).toContain("Your notes couldn't be opened.");
    expect(shown).toContain('Nothing has been changed.');
    expect(shown).toContain("/Users/elmar/Elmar's App");
    expect(shown).not.toMatch(FORBIDDEN);
  });

  it('"Try again" starts over; "Choose another folder…" opens the one he picks', async () => {
    const onChange = vi.fn();
    render(<LoadError path="/x" onChange={onChange} />);
    fireEvent.click(screen.getByText('Try again'));
    expect(m.retryLoad).toHaveBeenCalledTimes(1);

    await act(async () => fireEvent.click(screen.getByText('Choose another folder…')));
    expect(m.openFolderAt).toHaveBeenCalledWith('/Users/elmar/Documents/Notes');
    expect(onChange).toHaveBeenCalledWith({ kind: 'ready' });
  });
});
