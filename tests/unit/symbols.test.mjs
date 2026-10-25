// Unit tests for document symbols (src/symbols.ts) — Outline / breadcrumbs /
// Go to Symbol. Runs under plain `node --test`; imports dist/symbols.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeSymbols } from '../../dist/symbols.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const DOC = [
  '(version 1)',
  '# a comment',
  '(rule "HV clearance"',
  '    (layer outer)',
  '    (condition "A.NetClass == \'HV\'")',
  '    (constraint clearance (min 1.5mm)))',
  '(rule \'single\' (constraint disallow via))',
].join('\n');

test('version + one symbol per rule, named after the rule', () => {
  const s = computeSymbols(DOC);
  assert.deepEqual(s.map((x) => [x.kind, x.name]), [
    ['version', 'version'],
    ['rule', 'HV clearance'],
    ['rule', 'single'],
  ]);
  assert.equal(s[0].detail, '1');
});

test('rule children are its clauses; constraints are named by type', () => {
  const rule = computeSymbols(DOC)[1];
  assert.deepEqual(rule.children.map((c) => [c.kind, c.name, c.detail]), [
    ['layer', 'layer', 'outer'],
    ['condition', 'condition', '"A.NetClass == \'HV\'"'],
    ['constraint', 'clearance', '(min 1.5mm)'],
  ]);
});

test('ranges: rule spans its lines; selection is the name string', () => {
  const rule = computeSymbols(DOC)[1];
  assert.deepEqual(rule.range.start, { line: 2, col: 0 });
  assert.deepEqual(rule.range.end, { line: 5, col: 39 });
  assert.deepEqual(rule.selectionRange, { start: { line: 2, col: 6 }, end: { line: 2, col: 20 } });
  const c = rule.children[2];
  assert.deepEqual(c.selectionRange.start, { line: 5, col: 16 });
});

test('unnamed and unclosed rules still produce symbols', () => {
  const s = computeSymbols('(version 1)\n(rule (constraint clearance (min 1mm)))\n(rule "open"\n  (constraint clearance');
  assert.deepEqual(s.map((x) => x.name), ['version', '(unnamed rule)', 'open']);
});

test('every fixture yields one rule symbol per (rule …) and never throws', () => {
  const dir = join(here, '../fixtures');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.kicad_dru'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    const rules = computeSymbols(text).filter((x) => x.kind === 'rule');
    const expected = (text.match(/^\s*\(rule\b/gm) || []).length;
    assert.equal(rules.length, expected, f);
  }
});
