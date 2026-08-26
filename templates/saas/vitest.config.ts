import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Workspace root config: vitest only auto-picks up configs in CWD. The
// per-package config lives in _shared/vitest.config.ts (so a single
// source of truth for the whole 2-package pnpm workspace). Mirror the
// test settings here so `pnpm test` at the project root uses jsdom +
// runs setupFiles + applies the React plugin.
export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./_shared/tests/setup.ts'],
    include: ['_shared/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
  },
});
