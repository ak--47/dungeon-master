import { defineConfig } from 'vitest/config';
import alignment from './vitest.config.js';

export default defineConfig({
  ...alignment,
  test: {
    ...alignment.test,
    include: [
      'tests/alignment/lifecycle-contracts.test.js',
      'tests/integration/identity-model.test.js',
      'tests/integration/retention-curve.test.js',
      'tests/unit/engine-shape-canary.test.js',
    ],
  },
});