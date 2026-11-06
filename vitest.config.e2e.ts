import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./global-setup.ts'],
    setupFiles: ['./setup.ts'],
    pool: 'forks',
    isolate: true,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/datn261_test',
      JWT_ACCESS_SECRET: 'test-access-secret',
    },
  },
});
