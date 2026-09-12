import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  test: {
    include: [
      'tests/alignment/contracts.test.js',
      'tests/unit/funnel-engine.test.js',
      'tests/unit/any-order-funnel.test.js',
      'tests/unit/session-metrics.test.js',
      'tests/unit/step0-anchored-trends.test.js',
      'tests/unit/funnel-frequency-modes.test.js',
      'tests/unit/ttc-details.test.js',
      'tests/unit/apply-funnel-defaults.test.js',
      'tests/unit/funnel-session-window.test.js',
    ],
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