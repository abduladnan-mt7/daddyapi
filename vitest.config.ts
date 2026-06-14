import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source so tests run without a
// prior build step. Vitest compiles the TS on the fly.
export default defineConfig({
  resolve: {
    alias: {
      '@daddyapi/spec': fileURLToPath(new URL('./packages/spec/src/index.ts', import.meta.url)),
      '@daddyapi/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
  },
});
