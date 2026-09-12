import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    globals: true,
    globalSetup: [],
    setupFiles: [],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true, minForks: 1, maxForks: 1 } },
    fileParallelism: false,
    sequence: { concurrent: false },
    maxConcurrency: 1,
    testTimeout: 60000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    watch: false,
    cache: false,
  },
});