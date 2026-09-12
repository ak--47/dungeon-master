import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  cacheDir: fileURLToPath(new URL('./.cache', import.meta.url)),
  test: {
    include: process.env.ALIGNMENT_SWEEP === '1'
      ? ['tests/alignment/**/*.sweep.test.js']
      : ['tests/alignment/**/*.test.js'],
    exclude: process.env.ALIGNMENT_SWEEP === '1' ? [] : ['tests/alignment/**/*.sweep.test.js'],
    globalSetup: [],
    setupFiles: [],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 1 } },
    fileParallelism: false,
    sequence: { concurrent: false },
    maxConcurrency: 1,
    testTimeout: 10000,
    hookTimeout: 10000,
    watch: false,
    cache: false,
  },
});