// Unit tests for the PURE completion engine — runs under plain `node --test`,
// no vscode extension host. Imports the esbuild-produced ESM bundle of
// src/completion.ts (dist/completion.mjs) and the real data/api.json.
//
// Prereq: `npm run compile` (produces dist/completion.mjs). The `test:unit`
// script runs compile first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildApi, computeCompletions } from '../../dist/completion.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const apiData = JSON.parse(readFileSync(join(here, '../../data/api.json'), 'utf8'));
const api = buildApi(apiData);

// Helper: put the cursor at the `|` marker in a line and run the engine.
function complete(lineWithCursor) {
  const col = lineWithCursor.indexOf('|');
  assert.notEqual(col, -1, 'test line must contain a | cursor marker');
  const line = lineWithCursor.replace('|', '');
  return computeCompletions(line, col, api);
}

const labels = (entries) => entries.map((e) => e.label);

test('after "A." returns properties (reachable ones)', () => {
  const entries = complete('(condition "A.|");');
  const ls = labels(entries);
  assert.ok(ls.includes('Net_Class'), 'expected Net_Class property');
  assert.ok(ls.includes('Layer'), 'expected Layer property');
  assert.ok(ls.includes('Type'), 'expected Type property');
  // every property entry is kind=property
  const props = entries.filter((e) => e.kind === 'property');
  assert.ok(props.length > 50, 'expected many properties after A.');
});

test('after "A." a known function like intersectsArea is present', () => {
  const entries = complete('(condition "A.|");');
  const fn = entries.find((e) => e.label === 'intersectsArea');
  assert.ok(fn, 'intersectsArea must be offered');
  assert.equal(fn.kind, 'function');
  assert.equal(fn.insertText, "intersectsArea('$1')");
  assert.match(fn.detail, /-> bool$/);
});

test('unreachable properties are excluded after "A."', () => {
  const ls = labels(complete('(condition "A.|");'));
  assert.ok(!ls.includes('Single-sided'), 'Single-sided is unreachable');
  assert.ok(!ls.includes('Corner_Radius_%'), 'Corner_Radius_% is unreachable');
  assert.ok(!ls.includes('Top_Post-machining'), 'hyphenated names unreachable');
});

test('"AB." offers the same member set as "A." (functions included)', () => {
  const a = new Set(labels(complete('(condition "A.|");')));
  const ab = new Set(labels(complete('(condition "AB.|");')));
  assert.deepEqual([...ab].sort(), [...a].sort());
  assert.ok(ab.has('isCoupledDiffPair'), 'AB.isCoupledDiffPair offered');
});

test('"L." offers nothing (layer receiver has no members)', () => {
  assert.deepEqual(complete('(condition "L.|");'), []);
});

test('bare identifier boundary returns receivers + null', () => {
  const entries = complete('(condition "|");');
  const ls = labels(entries);
  for (const r of ['A', 'B', 'AB', 'L']) {
    assert.ok(ls.includes(r), `receiver ${r} offered`);
  }
  assert.ok(ls.includes('null'), 'null keyword offered');
  // no properties/functions at top level
  assert.ok(!ls.includes('intersectsArea'), 'no bare functions at top level');
  assert.ok(!ls.includes('Layer'), 'no bare properties at top level');
});

test('partial bare identifier still offers receivers and sets replace range', () => {
  const entries = complete('(condition "A|");');
  const a = entries.find((e) => e.label === 'A');
  assert.ok(a, 'A offered for partial "A"');
  // "A" is 1 char; cursor at col after it -> replace start = end - 1
  assert.equal(a.replace.end - a.replace.start, 1);
});

test('partial property after "A." sets replace range over the partial', () => {
  const entries = complete('(condition "A.Net|");');
  const e = entries.find((x) => x.label === 'Net_Class');
  assert.ok(e, 'Net_Class offered for partial "Net"');
  assert.equal(e.replace.end - e.replace.start, 3, 'replaces the 3-char "Net" partial');
});

test('outside any expression body returns []', () => {
  assert.deepEqual(complete('(rule my_rule|'), []);
  assert.deepEqual(complete('|'), []);
  assert.deepEqual(complete('(constraint clearance|'), []);
});

test('inside an inner \'...\' literal returns []', () => {
  // cursor inside the single-quoted layer-name literal
  assert.deepEqual(complete("(condition \"A.Layer == 'F|'\");"), []);
});

test('constraint assertion body is also a completion context', () => {
  const ls = labels(complete('(constraint assertion "A.|");'));
  assert.ok(ls.includes('Layer'), 'assertion body offers properties');
});

test('after a non-receiver "Foo." returns [] (no nested members)', () => {
  assert.deepEqual(complete('(condition "Foo.|");'), []);
});

test('deprecated functions are offered but flagged in doc and sorted last', () => {
  const entries = complete('(condition "A.|");');
  const dep = entries.find((e) => e.label === 'insideArea');
  assert.ok(dep, 'deprecated alias insideArea still offered');
  assert.match(dep.doc, /Deprecated/i);
  const live = entries.find((e) => e.label === 'intersectsArea');
  assert.ok(dep.sortText > live.sortText, 'deprecated sorts after live functions');
});

test('since-tagged property carries a since note in its doc', () => {
  const entries = complete('(condition "A.|");');
  const e = entries.find((x) => x.label === 'Pad_To_Die_Delay');
  assert.ok(e, 'Pad_To_Die_Delay offered');
  assert.match(e.doc, /Since KiCad 9/i);
});
