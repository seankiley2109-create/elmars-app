import { describe, expect, it, vi } from 'vitest';
import { MemFsPort } from './fs-port';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => '/Users/elmar',
  join: async (...parts: string[]) => parts.join('/'),
}));

import { defaultVaultPath } from './vault-boot';
import { isTauri } from './platform';

const ICLOUD = '/Users/elmar/Library/Mobile Documents/com~apple~CloudDocs';

describe('defaultVaultPath', () => {
  it('is in iCloud Drive when the Mac has it', async () => {
    const fs = new MemFsPort();
    await fs.mkdir(ICLOUD);
    expect(await defaultVaultPath(fs)).toBe(`${ICLOUD}/Elmar's App`);
  });

  it('is in the home folder otherwise', async () => {
    expect(await defaultVaultPath(new MemFsPort())).toBe("/Users/elmar/Elmar's App");
  });
});

describe('the saved-folder key', () => {
  it('is the one the sidebar footer reads, so "Saved on this Mac · iCloud Drive" tells the truth', async () => {
    const { VAULT_PATH_KEY } = await import('./vault-boot');
    const sidebar = await import('../components/Sidebar');
    expect(VAULT_PATH_KEY).toBe('elmar.vaultPath');
    expect(sidebar.VAULT_PATH_KEY).toBe(VAULT_PATH_KEY);
  });
});

describe('isTauri', () => {
  it('is false outside the Tauri web view, so tests and Chrome never touch Tauri APIs', () => {
    expect(isTauri()).toBe(false);
  });
});
