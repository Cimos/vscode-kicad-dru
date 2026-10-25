import esbuild from 'esbuild';

const prod = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// The shipped extension bundle: CommonJS, `vscode` external, `main` target.
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

const allOpts = [extensionOpts, pureOpts, hoverOpts, foldingOpts, parserOpts, diagnosticsOpts, ratingOpts];

if (watch) {
  const contexts = await Promise.all(allOpts.map((o) => esbuild.context(o)));
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(allOpts.map((o) => esbuild.build(o)));
}
