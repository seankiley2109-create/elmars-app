/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // pure selectors and constants — no DOM
    environment: 'node',
    globals: false,
  },
});
