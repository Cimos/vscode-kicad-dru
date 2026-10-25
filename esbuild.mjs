import esbuild from 'esbuild';

const prod = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// The shipped extension bundle: CommonJS, `vscode` external, `main` target.
// data/api.json is inlined by the import in src/extension.ts.
const extensionOpts = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: !prod,
  minify: prod,
  logLevel: 'info',
};

// The same source built for the web extension host (vscode.dev, github.dev):
// package.json `browser` points here. No Node built-ins may be used.
const webOpts = {
  ...extensionOpts,
  outfile: 'dist/web/extension.js',
  platform: 'browser',
  target: 'es2020',
};

// A pure-logic ESM build of the completion engine so `node --test` can import
// it without the vscode extension host (and without a TS loader). Not shipped
// in the .vsix — it lives in dist/, which the unit tests import.
const pureOpts = {
  entryPoints: ['src/completion.ts'],
  bundle: true,
  outfile: 'dist/completion.mjs',
  platform: 'node',
  format: 'esm',
  target: 'node18',
  sourcemap: !prod,
  minify: false,
  logLevel: 'info',
};

// Pure-logic ESM build of the hover engine, same rationale as `pureOpts`: it
// lets `node --test` import `dist/hover.mjs` without the vscode extension host.
// esbuild bundles src/completion.ts transitively (hover.ts imports its helpers).
const hoverOpts = {
  ...pureOpts,
  entryPoints: ['src/hover.ts'],
  outfile: 'dist/hover.mjs',
};

// Pure-logic ESM build of the folding engine, same rationale as `pureOpts`.
const foldingOpts = {
  ...pureOpts,
  entryPoints: ['src/folding.ts'],
  outfile: 'dist/folding.mjs',
};

// Pure-logic ESM builds of the s-expression parser and the diagnostics engine
// (diagnostics bundles parser transitively), same rationale as `pureOpts`.
const parserOpts = {
  ...pureOpts,
  entryPoints: ['src/parser.ts'],
  outfile: 'dist/parser.mjs',
};
const diagnosticsOpts = {
  ...pureOpts,
  entryPoints: ['src/diagnostics.ts'],
  outfile: 'dist/diagnostics.mjs',
};

const ratingOpts = {
  ...pureOpts,
  entryPoints: ['src/rating.ts'],
  outfile: 'dist/rating.mjs',
};

const symbolsOpts = { ...pureOpts, entryPoints: ['src/symbols.ts'], outfile: 'dist/symbols.mjs' };
const formatOpts = { ...pureOpts, entryPoints: ['src/format.ts'], outfile: 'dist/format.mjs' };

const allOpts = [
  extensionOpts,
  webOpts,
  pureOpts,
  hoverOpts,
  foldingOpts,
  parserOpts,
  diagnosticsOpts,
  ratingOpts,
  symbolsOpts,
  formatOpts,
];

if (watch) {
  const contexts = await Promise.all(allOpts.map((o) => esbuild.context(o)));
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(allOpts.map((o) => esbuild.build(o)));
}
