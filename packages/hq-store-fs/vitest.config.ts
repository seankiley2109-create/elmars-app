/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // the package is pure — state <-> Map<path, string>. No DOM, no FileSystemDirectoryHandle.
    environment: 'node',
    globals: false,
  },
});
