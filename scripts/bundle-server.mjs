// Bundles the Express backend (server.ts + src/server/*) into api/_server.mjs
// so the Vercel serverless function (api/index.js) can load it as plain ESM.
// npm packages stay external and are resolved from node_modules at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: ['server.ts'],
  outfile: 'api/_server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});
