import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Workspace and npm dependencies are installed alongside; don't bundle them.
  external: ['@daddyapi/spec', '@daddyapi/core', '@modelcontextprotocol/sdk', 'zod'],
});
