import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { openFolderAt, chooseFolder, lookAgain } = vi.hoisted(() => ({
  openFolderAt: vi.fn(async (_path: string) => ({ kind: 'ready' as const })),
  chooseFolder: vi.fn(async (): Promise<string | null> => null),
  lookAgain: vi.fn(async (_path: string): Promise<import('../lib/vault-boot').VaultState> => ({ kind: 'ready' })),
}));
vi.mock('../lib/vault-boot', () => ({ openFolderAt, chooseFolder, lookAgain }));

import FirstRun from './FirstRun';

const ICLOUD = "/Users/elmar/Library/Mobile Documents/com~apple~CloudDocs/Elmar's App";
const FORBIDDEN = /\b(vault|jobs?|runs?|backlog|shipped|signals?|inbox)\b/i;

describe('FirstRun', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('asks where the notes live, shows the path, and says why iCloud', () => {
    render(<FirstRun suggested={ICLOUD} onChange={() => {}} />);
    const shown = document.body.textContent ?? '';
    expect(shown).toContain('Where should your notes live?');
    expect(shown).toContain(ICLOUD);
    expect(shown).toMatch(/iCloud Drive.*keeps a copy safe if the laptop is lost/);
    expect(shown).not.toMatch(FORBIDDEN);
  });

  it('"Use this folder" opens the suggested folder', async () => {
    const onChange = vi.fn();
    render(<FirstRun suggested={ICLOUD} onChange={onChange} />);
    await act(async () => fireEvent.click(screen.getByText('Use this folder')));
    expect(openFolderAt).toHaveBeenCalledWith(ICLOUD);
    expect(onChange).toHaveBeenCalledWith({ kind: 'ready' });
  });

  describe('when the folder he uses is not where it was', () => {
    const SAVED = '/Users/elmar/Documents/Notes';

    it('says so, shows the path, and leads with "Look again", never with making it again', () => {
      render(<FirstRun suggested={SAVED} missing onChange={() => {}} />);
      const shown = document.body.textContent ?? '';
      expect(shown).toContain("Your notes folder isn't where it was");
      expect(shown).not.toContain('Where should your notes live?');
      expect(shown).toContain(SAVED);
      expect(shown).not.toMatch(FORBIDDEN);
      const buttons = screen.getAllByRole('button').map((b) => b.textContent);
      expect(buttons).toEqual(['Look again', 'Choose another folder…']);
      expect(screen.queryByText('Use this folder')).toBeNull();
    });

    it('"Look again" opens it once it is back', async () => {
      lookAgain.mockResolvedValueOnce({ kind: 'ready' });
      const onChange = vi.fn();
      render(<FirstRun suggested={SAVED} missing onChange={onChange} />);
      await act(async () => fireEvent.click(screen.getByText('Look again')));
      expect(lookAgain).toHaveBeenCalledWith(SAVED);
      expect(openFolderAt).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledWith({ kind: 'ready' });
    });

    it('"Look again" says plainly when it is still not there, and changes nothing', async () => {
      lookAgain.mockResolvedValueOnce({ kind: 'needs-folder', suggested: SAVED, missing: true });
      const onChange = vi.fn();
      render(<FirstRun suggested={SAVED} missing onChange={onChange} />);
      await act(async () => fireEvent.click(screen.getByText('Look again')));
      expect(onChange).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("It's still not there.");
      expect(openFolderAt).not.toHaveBeenCalled();
    });
  });

  it('"Choose another folder…" opens what he picks, and nothing if he cancels', async () => {
    const onChange = vi.fn();
    render(<FirstRun suggested={ICLOUD} onChange={onChange} />);

    await act(async () => fireEvent.click(screen.getByText('Choose another folder…')));
    expect(openFolderAt).not.toHaveBeenCalled();

    chooseFolder.mockResolvedValueOnce('/Users/elmar/Documents/Notes');
    await act(async () => fireEvent.click(screen.getByText('Choose another folder…')));
    expect(openFolderAt).toHaveBeenCalledWith('/Users/elmar/Documents/Notes');
    expect(onChange).toHaveBeenCalledWith({ kind: 'ready' });
  });
});
