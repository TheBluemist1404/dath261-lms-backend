import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts', './setup.ts'],
    env: {
      NODE_ENV: 'test',
    },
    globalSetup: ['./global-setup.ts'],
    pool: 'forks',
    isolate: true,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
