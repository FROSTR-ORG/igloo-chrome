import path from 'node:path';
import { defineConfig } from 'vitest/config';

import { createVitestBaseConfig } from 'igloo-shared/testing/vitest-base';

export default defineConfig({
  resolve: {
    // Mirror the app build: collapse nostr-tools to a single instance so
    // igloo-shared (consumed from source) and chrome share one SimplePool /
    // useWebSocketImplementation singleton under test.
    dedupe: ['nostr-tools'],
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  test: createVitestBaseConfig({
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts']
  })
});
