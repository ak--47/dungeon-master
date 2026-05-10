import { defineConfig } from 'vitest/config';

const isDebugMode = process.env.NODE_OPTIONS?.includes('--inspect') || process.env.NODE_OPTIONS?.includes('--inspect-brk');

export default defineConfig({
  test: {
    // Global test settings
    globals: true,
    environment: 'node',
    
    // Test file patterns
    include: ['tests/**/*.test.js'],
    // sanity hangs after Module Integration block (dynamic-import file-path tests
    // hit the same isStrictEvent mutation bug). Run in isolation: `npx vitest run tests/e2e/sanity.test.js`
    exclude: ['tests/e2e/sanity.test.js', 'node_modules/**'],
    
    // Coverage settings
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './tests/coverage',
      clean: true,
      exclude: [
        'research/**',
        'scripts/**',
        'dungeons/**',
        'tests/**',
        'node_modules/**',
        'plans/**',
        'verification/**',
        'tmp/**',
        'types/**',
        '**/.dungeon-tmp/**',
        '**/*.d.ts',
        'scratch.mjs',
        'vitest.config.js',
        '*.config.*',
      ],
    },
    
    // Test execution settings	
    testTimeout: 60000, // one min
    hookTimeout: 30000,
    teardownTimeout: 10000,
    
    // Use forks for true process isolation (globals like chanceInitialized don't leak between test files)
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
        minForks: 1
      }
    },
    
    // Reporter settings
	reporters: isDebugMode ? ['verbose'] : ['default'],

    // reporters: isDebugMode ? 'verbose' : 'default',
    
    // Don't watch in CI/test environments
    watch: false,
    
    sequence: {
      concurrent: true
    },
    fileParallelism: true
  }
});