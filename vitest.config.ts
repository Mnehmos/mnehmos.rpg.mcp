import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        isolate: true,
      }
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    // Memory management
    maxConcurrency: 4,
    fileParallelism: true,
    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/api/**'] // Excluded from build anyway
    }
  }
});
