// Integration test runner: downloads (once, cached in .vscode-test/) and
// launches a REAL VS Code with only this extension loaded, then runs
// tests/integration/suite.js inside it. Catches what the pure unit tests
// can't: providers failing to register, activation errors, manifest mistakes.
//
// Prereq: `npm run compile` (dist/extension.js). `npm run test:integration`
// does both. On Linux CI it needs a display: `xvfb-run -a npm run test:integration`.
//
// VSCODE_TEST_CACHE overrides the download/cache directory (default .vscode-test).

const path = require('path');
const { runTests } = require('@vscode/test-electron');

// A VS Code-hosted terminal exports this; it makes Code.exe behave as plain
// Node and reject its own flags ("bad option: --disable-extensions").
delete process.env.ELECTRON_RUN_AS_NODE;

const root = path.resolve(__dirname, '../..');
const cache = process.env.VSCODE_TEST_CACHE || path.join(root, '.vscode-test');

runTests({
  version: 'stable',
  cachePath: cache,
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(__dirname, 'suite.js'),
  launchArgs: [
    '--disable-extensions', // only the extension under test
    '--disable-workspace-trust',
    '--user-data-dir',
    path.join(cache, 'user-data'),
  ],
}).catch((err) => {
  console.error('Integration tests failed:', err);
  process.exit(1);
});
