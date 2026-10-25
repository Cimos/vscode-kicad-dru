// Unit tests for paren-based folding (src/folding.ts).
// Runs under plain `node --test`; imports the esbuild ESM bundle
// (dist/folding.mjs). Prereq: `npm run compile`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeFoldingRanges } from '../../dist/folding.mjs';

const fold = (lines) => computeFoldingRanges(lines.join('\n'));

test('one range per multi-line rule', () => {
  const r = fold([
    '(version 1)',
    '(rule "Via Size"',
    '  (constraint via_diameter (min 0.5mm))',
    '  (condition "A.Type == \'Via\'"))',
  ]);
  assert.deepEqual(r, [{ start: 1, end: 3 }]);
});

test('single-line pairs produce no ranges', () => {
  assert.deepEqual(fold(['(version 1)', '(rule "x" (constraint clearance (min 1mm)))']), []);
});

test('nested multi-line pairs fold independently', () => {
  const r = fold([
    '(rule "x"',
    '  (constraint clearance',
    '    (min 1mm))',
    '  (condition "A.Type == \'Pad\'"))',
  ]);
  assert.deepEqual(r, [
    { start: 1, end: 2 },
    { start: 0, end: 3 },
  ]);
});

test('parens inside double-quoted strings are ignored', () => {
  const r = fold([
    '(rule "a (b"',
    '  (condition "A.intersectsArea(\'Z\') && (B.Type == \'Pad\'"))',
  ]);
  assert.deepEqual(r, [{ start: 0, end: 1 }]);
});

test('parens on line-start # comment lines are ignored (indented too)', () => {
  const r = fold([
    '# see (https://example.com',
    '(rule "x"',
    '  # (commented-out constraint',
    '  (constraint clearance (min 1mm)))',
  ]);
  assert.deepEqual(r, [{ start: 1, end: 3 }]);
});

test('a mid-line # is not a comment: parens after it still count', () => {
  // KiCad only treats # as a comment when it is the first non-blank char.
  const r = fold(['(rule "x" # note', '  (constraint clearance (min 1mm)))']);
  assert.deepEqual(r, [{ start: 0, end: 1 }]);
});

test('# inside a string is not a comment', () => {
  const r = fold(['(rule "#1"', '  (constraint clearance (min 1mm)))']);
  assert.deepEqual(r, [{ start: 0, end: 1 }]);
});

test('unbalanced input does not throw', () => {
  assert.deepEqual(fold(['(rule "x"', '  (constraint clearance']), []);
  assert.deepEqual(fold([')))', '(rule "x"', ')']), [{ start: 1, end: 2 }]);
});

test('# region / # endregion fold as a region (nested, #region spelling, unmatched ignored)', () => {
  const r = fold([
    '# region Clearances',
    '#region inner',
    '(rule "a" (constraint clearance (min 1mm)))',
    '#endregion',
    '  # endregion',
    '# endregion stray',
    '# region never closed',
  ]);
  assert.deepEqual(r, [
    { start: 1, end: 3, kind: 'region' },
    { start: 0, end: 4, kind: 'region' },
  ]);
});

test('"region" as a word inside a comment or rule name is not a marker', () => {
  const r = fold(['# the region below', '(rule "region"', '  (constraint clearance (min 1mm)))', '# endregions']);
  assert.deepEqual(r, [{ start: 1, end: 2 }]);
});

test('language-configuration markers match REGION_START / REGION_END', async () => {
  const { readFileSync } = await import('node:fs');
  const { REGION_START, REGION_END } = await import('../../dist/folding.mjs');
  const raw = readFileSync(new URL('../../language-configuration.json', import.meta.url), 'utf8');
  // strip // comments and trailing commas (the file is JSONC)
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
  assert.equal(cfg.folding.markers.start, REGION_START.source);
  assert.equal(cfg.folding.markers.end, REGION_END.source);
  // and they never match an ordinary rule line (the original minimap bug)
  for (const l of ['(rule "x"', '  (constraint clearance (min 1mm))', '(version 1)']) {
    assert.ok(!new RegExp(cfg.folding.markers.start).test(l), l);
  }
});

test('CRLF line endings count lines correctly', () => {
  const r = computeFoldingRanges('(version 1)\r\n(rule "x"\r\n  (constraint clearance (min 1mm)))\r\n');
  assert.deepEqual(r, [{ start: 1, end: 2 }]);
});
