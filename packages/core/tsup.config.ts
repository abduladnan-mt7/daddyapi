import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  // @daddyapi/spec is a workspace dependency resolved at runtime; don't bundle it.
  external: ['@daddyapi/spec'],
});
