import path from 'node:path';
import { defineConfig } from 'vitest/config';

import { createVitestBaseConfig } from 'igloo-shared/testing/vitest-base';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  test: createVitestBaseConfig({
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts']
  })
});
