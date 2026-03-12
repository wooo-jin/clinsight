import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.tsx', 'src/cron.ts', 'src/hook.ts', 'src/setup.ts', 'src/scripts/install-cron.ts'],
  format: ['esm'],
  target: 'es2022',
  noExternal: [/(.*)/],
  esbuildOptions(options) {
    options.external = ['react-devtools-core'];
  },
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
