/// <reference types="vitest/config" />
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Tauri's devUrl is this exact port: fail loudly rather than drift to another one
    strictPort: true,
    // the Rust build lives in src-tauri; watching its locked .dll files crashes Vite on Windows
    watch: { ignored: ['**/src-tauri/**'] },
    fs: {
      // allow serving packages/hq-core, which lives outside this app's root
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
