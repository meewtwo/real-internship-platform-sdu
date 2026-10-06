import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/test/**/*.test.ts', 'backend/test/**/*.test.ts', 'scripts/**/*.test.ts', 'frontend/test/**/*.test.{ts,tsx}'],
    globalSetup: ['backend/test/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
