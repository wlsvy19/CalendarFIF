import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'], exclude: ['src/web/**'] } },
      { test: { name: 'dom', environment: 'happy-dom', include: ['src/web/**/*.test.ts'] } },
      { test: { name: 'emulator', environment: 'node', include: ['tests/emulator/**/*.test.ts'], testTimeout: 20000, fileParallelism: false } },
    ],
  },
});
