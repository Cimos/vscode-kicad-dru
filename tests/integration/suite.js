// Runs INSIDE the real VS Code launched by run.js. Opens smoke.kicad_dru and
// drives every feature through VS Code's own command layer, so a provider that
// fails to register (or an activation error) fails CI. Throwing from run()
// makes @vscode/test-electron exit non-zero.

const assert = require('assert');
const path = require('path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let doc;

test('opens as kicad-dru and the extension activates', async () => {
  doc = await vscode.workspace.openTextDocument(path.join(__dirname, 'smoke.kicad_dru'));
  await vscode.window.showTextDocument(doc);
  assert.strictEqual(doc.languageId, 'kicad-dru');
  const ext = vscode.extensions.getExtension('cimos.kicad-dru');
  assert.ok(ext, 'extension present');
  await waitFor(() => ext.isActive, 'activation');
});

test('diagnostics: exactly the expected codes, nothing on the clean rule', async () => {
  const diags = await waitFor(() => {
    const d = vscode.languages.getDiagnostics(doc.uri);
    return d.length ? d : null;
  }, 'diagnostics');
  const codes = diags.map((d) => `${d.range.start.line + 1}:${d.code}`).sort();
  assert.deepStrictEqual(codes, ['4:unknown-constraint', '6:unknown-property', '9:unit-on-unitless']);
  assert.ok(diags.every((d) => d.source === 'kicad-dru'));
});

test('quick fixes are offered for each diagnostic', async () => {
  const titles = [];
  for (const d of vscode.languages.getDiagnostics(doc.uri)) {
    const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', doc.uri, d.range, 'quickfix');
    titles.push(...actions.filter((a) => a.title.startsWith('Change to')).map((a) => a.title));
  }
  assert.deepStrictEqual(titles.sort(), ["Change to '90'", "Change to 'Width'", "Change to 'clearance'"]);
});

test('document symbols list every rule', async () => {
  const syms = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri);
  assert.deepStrictEqual(syms.map((s) => s.name), ['version', 'typo constraint', 'typo property', 'unit on unitless', 'clean']);
});

test('folding: multi-line rule and the # region block', async () => {
  const folds = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', doc.uri);
  const spans = folds.map((f) => `${f.start + 1}-${f.end + 1}${f.kind === vscode.FoldingRangeKind.Region ? 'R' : ''}`).sort();
  assert.ok(spans.includes('3-7R'), `region fold present: ${spans}`);
  assert.ok(spans.includes('11-14'), `rule fold present: ${spans}`);
});

test('completion after A. offers properties', async () => {
  const pos = new vscode.Position(5, doc.lineAt(5).text.indexOf('A.') + 2);
  const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, pos);
  const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
  assert.ok(labels.includes('Width') && labels.includes('NetClass'));
});

test('hover on a constraint type', async () => {
  const line = doc.getText().split(/\r?\n/).findIndex((l) => l.includes('solder_paste_rel_margin'));
  const pos = new vscode.Position(line, doc.lineAt(line).text.indexOf('solder_paste') + 3);
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos);
  const text = hovers.map((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value)).join('\n')).join('\n');
  assert.match(text, /solder_paste_rel_margin/);
});

test('format document re-flows rules and keeps the file diagnostic-equivalent', async () => {
  const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', doc.uri, { tabSize: 4, insertSpaces: true });
  assert.ok(edits && edits.length > 0, 'formatter produced edits');
  const we = new vscode.WorkspaceEdit();
  for (const e of edits) we.replace(doc.uri, e.range, e.newText);
  assert.ok(await vscode.workspace.applyEdit(we));
  assert.match(doc.getText(), /\(rule "typo constraint"\r?\n {4}\(constraint clearence \(min 0\.2mm\)\)\)/);
  await sleep(600); // diagnostics debounce
  assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 3);
});

exports.run = async function run() {
  const failures = [];
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ok   ${t.name}`);
    } catch (e) {
      console.log(`  FAIL ${t.name}\n       ${e && e.message}`);
      failures.push(t.name);
    }
  }
  console.log(`${tests.length - failures.length}/${tests.length} integration tests passed`);
  if (failures.length) throw new Error(`${failures.length} integration test(s) failed`);
};
