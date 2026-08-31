import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    // Playwright specs have their own runner and must not be collected by Vitest.
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
