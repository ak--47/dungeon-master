import { defineConfig, mergeConfig } from 'vitest/config';
import regressionConfig from './tests/alignment/regression-vitest.config.js';

export default mergeConfig(regressionConfig, defineConfig({
  test: {
    include: ['tests/{unit,integration,e2e,alignment}/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/*.sweep.test.js'],
  },
}));