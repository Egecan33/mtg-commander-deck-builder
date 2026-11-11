// Bundles the ingest CLI (src/ingest/sync.ts) into one file, dist/sync.mjs, for the portable bundles.
// better-sqlite3 stays external: it carries a native module and is resolved from node_modules at run time.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/ingest/sync.ts'],
  outfile: 'dist/sync.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['better-sqlite3'],
  tsconfig: 'tsconfig.json',
  // Bundled CommonJS dependencies may call require(); give ESM output one.
  banner: { js: "import { createRequire as __cfRequire } from 'node:module'; const require = __cfRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.log('built dist/sync.mjs');
