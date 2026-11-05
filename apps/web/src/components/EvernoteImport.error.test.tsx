import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
// An import that breaks partway for a reason nobody planned for.
vi.mock('../lib/evernote/import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/evernote/import')>()),
  importEnexFiles: async () => {
    throw new Error('Out of memory.');
  },
}));

import EvernoteImport from './EvernoteImport';

afterEach(cleanup);

describe('EvernoteImport when the import breaks', () => {
  it('says what happened, that what came across is kept, and can be closed', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <EvernoteImport open onClose={onClose} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Evernote files'), {
      target: { files: [new File(['<en-export/>'], 'sample.enex')] },
    });
    expect(await screen.findByText('The import stopped partway', {}, { timeout: 10_000 })).toBeDefined();
    // in plain words, never the raw error
    expect(screen.getByText('Something unexpected went wrong.')).toBeDefined();
    expect(document.body.textContent).not.toMatch(/Out of memory/);
    expect(screen.getByText(/Notes that came across are kept/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
