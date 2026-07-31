import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The schema suite boots Postgres-in-WASM; running suites in separate
    // forks keeps that memory out of the pure unit tests and stops the two
    // competing for the same worker.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
