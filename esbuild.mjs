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

if (watch) {
  const c1 = await esbuild.context(extensionOpts);
  const c2 = await esbuild.context(pureOpts);
  await Promise.all([c1.watch(), c2.watch()]);
} else {
  await Promise.all([esbuild.build(extensionOpts), esbuild.build(pureOpts)]);
}
