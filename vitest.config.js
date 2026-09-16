import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Components rely on the automatic JSX runtime (no `import React`), exactly as the Vite build
  // compiles them. Without this, Vitest falls back to React.createElement and every component
  // that omits the import fails with "React is not defined".
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    // Playwright specs have their own runner and must not be collected by Vitest.
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
