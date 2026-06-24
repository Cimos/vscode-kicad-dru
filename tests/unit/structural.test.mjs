// Unit tests for STRUCTURAL completion — the vocabulary offered OUTSIDE
// `(condition "...")` / `(constraint assertion "...")` expression bodies.
// Runs under plain `node --test`; imports the esbuild ESM bundle of
// src/completion.ts (dist/completion.mjs) and the real data/api.json.
//
// Prereq: `npm run compile` (produces dist/completion.mjs). `test:unit` runs
// compile first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildApi,
  computeCompletions,
  constraintInsertText,
  enclosingConstraintAtParen,
} from '../../dist/completion.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const apiData = JSON.parse(readFileSync(join(here, '../../data/api.json'), 'utf8'));
const api = buildApi(apiData);

// Put the cursor at the `|` marker and run the engine. Optional preceding text
// (prior document lines) feeds rule-depth disambiguation.
function complete(lineWithCursor, preceding = '') {
  const col = lineWithCursor.indexOf('|');
  assert.notEqual(col, -1, 'test line must contain a | cursor marker');
  const line = lineWithCursor.replace('|', '');
  return computeCompletions(line, col, api, preceding);
}

const labels = (entries) => entries.map((e) => e.label);

// C3 — constraint type slot.
test('after "(constraint " offers constraint types', () => {
  const ls = labels(complete('  (constraint |'));
  assert.ok(ls.includes('clearance'), 'clearance offered');
  assert.ok(ls.includes('track_width'), 'track_width offered');
  assert.ok(ls.includes('assertion'), 'assertion offered');
  assert.ok(ls.includes('zone_connection'), 'zone_connection offered');
  // all entries are constraintType kind
  assert.ok(
    complete('  (constraint |').every((e) => e.kind === 'constraintType'),
    'every entry is constraintType',
  );
});

test('constraint types carry their arg-shape detail and since notes', () => {
  const entries = complete('  (constraint |');
  const creep = entries.find((e) => e.label === 'creepage');
  assert.ok(creep, 'creepage offered');
  assert.match(creep.doc, /Since KiCad 9/i, 'creepage carries since note');
  const clr = entries.find((e) => e.label === 'clearance');
  assert.ok(clr.detail.length > 0, 'clearance has a detail/arg-shape line');
});

test('deprecated constraint types are offered but sorted last', () => {
  const entries = complete('  (constraint |');
  const dep = entries.find((e) => e.label === 'mechanical_clearance');
  assert.ok(dep, 'a deprecated constraint type (mechanical_clearance) is offered');
  if (dep) {
    assert.match(dep.doc, /Deprecated/i);
    const live = entries.find((e) => e.label === 'clearance');
    assert.ok(dep.sortText > live.sortText, 'deprecated sorts after live');
  }
});

// C1 — disallow categories.
test('after "(constraint disallow " offers disallow categories', () => {
  const ls = labels(complete('  (constraint disallow |'));
  assert.ok(ls.includes('track'), 'track offered');
  assert.ok(ls.includes('via'), 'via offered');
  assert.ok(ls.includes('pad'), 'pad offered');
  assert.ok(
    complete('  (constraint disallow |').every((e) => e.kind === 'disallowCategory'),
    'every entry is disallowCategory',
  );
});

test('disallow categories are repeatable (offered again after one token)', () => {
  const ls = labels(complete('  (constraint disallow track |'));
  assert.ok(ls.includes('via'), 'via still offered after first category');
});

// C2 — zone connection enum.
test('after "(constraint zone_connection " offers zone connections', () => {
  const ls = labels(complete('  (constraint zone_connection |'));
  assert.ok(ls.includes('solid'), 'solid offered');
  assert.ok(ls.includes('thermal_reliefs'), 'thermal_reliefs offered');
  assert.ok(ls.includes('none'), 'none offered');
});

// C4 — layer tokens.
test('after "(layer " offers layer tokens including F.Cu', () => {
  const ls = labels(complete('  (layer |'));
  assert.ok(ls.includes('F.Cu'), 'F.Cu offered');
  assert.ok(ls.includes('B.Cu'), 'B.Cu offered');
  assert.ok(ls.includes('Edge.Cuts'), 'Edge.Cuts offered');
  assert.ok(
    complete('  (layer |').every((e) => e.kind === 'layerToken'),
    'every entry is layerToken',
  );
});

test('layer tokens are repeatable for layer-set lists', () => {
  const ls = labels(complete('  (layer F.Cu |'));
  assert.ok(ls.includes('B.Cu'), 'B.Cu still offered after first layer');
});

test('partial dotted layer token replaces over the whole partial', () => {
  const entries = complete('  (layer F.C|');
  const e = entries.find((x) => x.label === 'F.Cu');
  assert.ok(e, 'F.Cu offered for partial "F.C"');
  assert.equal(e.replace.end - e.replace.start, 3, 'replaces the 3-char "F.C"');
});

// C5 — severities.
test('after "(severity " offers severities including error', () => {
  const ls = labels(complete('  (severity |'));
  assert.ok(ls.includes('error'), 'error offered');
  assert.ok(ls.includes('warning'), 'warning offered');
  assert.ok(ls.includes('ignore'), 'ignore offered');
});

// C6 — bound slots are freehand.
test('after "(min " (and opt/max) offers nothing structural', () => {
  assert.deepEqual(complete('  (constraint clearance (min |'), []);
  assert.deepEqual(complete('  (opt |'), []);
  assert.deepEqual(complete('  (max |'), []);
});

// C7/C8 — keywords by rule depth.
test('top-level "(" offers top keywords (rule, version)', () => {
  const ls = labels(complete('(|'));
  assert.ok(ls.includes('rule'), 'rule offered at top level');
  assert.ok(ls.includes('version'), 'version offered at top level');
  assert.ok(!ls.includes('constraint'), 'constraint NOT offered at top level');
});

test('inside a rule body "(" offers rule-body keywords', () => {
  const ls = labels(complete('  (|', '(rule "x"\n'));
  assert.ok(ls.includes('constraint'), 'constraint offered in rule body');
  assert.ok(ls.includes('condition'), 'condition offered in rule body');
  assert.ok(ls.includes('layer'), 'layer offered in rule body');
  assert.ok(ls.includes('severity'), 'severity offered in rule body');
  assert.ok(!ls.includes('rule'), 'rule NOT offered inside a rule body');
});

// Regression: comment bodies must not corrupt rule-depth (found via F5 test).
test('rule body with a comment containing an unbalanced ")" still offers rule-body keywords', () => {
  const ls = labels(complete('    (|', '(rule ""\n    # drop to 0.3mm) for HDI\n'));
  assert.ok(ls.includes('constraint'), 'constraint still offered');
  assert.ok(!ls.includes('rule'), 'rule NOT offered (comment paren must not break depth)');
});

test('rule body with an inch-mark (stray ") in a comment still offers rule-body keywords', () => {
  const ls = labels(complete('    (|', '# board is 5" wide\n(rule ""\n'));
  assert.ok(ls.includes('condition'), 'condition still offered');
  assert.ok(!ls.includes('version'), 'version NOT offered (comment quote must not break depth)');
});

// Gate — structural defers to expression completion inside strings.
test('GATE: inside (condition "A. structural returns nothing, member completion wins', () => {
  // computeCompletions routes into member completion here; assert it is NOT
  // structural (it returns properties, not keywords/constraint types).
  const ls = labels(complete('  (condition "A.|"'));
  assert.ok(ls.includes('Layer'), 'member completion still active inside condition');
  assert.ok(!ls.includes('clearance'), 'no constraint types inside a condition string');
  assert.ok(!ls.includes('rule'), 'no keywords inside a condition string');
});

test('GATE: inside (constraint assertion "A. is member completion, not structural', () => {
  const ls = labels(complete('  (constraint assertion "A.|"'));
  assert.ok(ls.includes('Layer'), 'assertion body offers properties');
  assert.ok(!ls.includes('clearance'), 'no constraint types inside assertion string');
});

test('mid-token / non-slot positions offer nothing structural', () => {
  // bare text not right after ( or a known slot
  assert.deepEqual(complete('  foo|'), []);
  // after a closing paren, no open slot
  assert.deepEqual(complete('  (rule "x") |'), []);
});

// ---------------------------------------------------------------------------
// 2a — value skeletons on constraint-type acceptance.
// ---------------------------------------------------------------------------

test('clearance constraint seeds a (min $1) skeleton', () => {
  const e = complete('  (constraint |').find((x) => x.label === 'clearance');
  assert.equal(e.insertText, 'clearance (min ${1})');
});
test('track_width seeds only the first (min $1) bound', () => {
  const e = complete('  (constraint |').find((x) => x.label === 'track_width');
  assert.equal(e.insertText, 'track_width (min ${1})');
});
test('via_dangling (<none>) has no snippet override', () => {
  const e = complete('  (constraint |').find((x) => x.label === 'via_dangling');
  assert.equal(e.insertText, undefined);
});
test('min_resolved_spokes (bare int) seeds one slot', () => {
  const e = complete('  (constraint |').find((x) => x.label === 'min_resolved_spokes');
  assert.equal(e.insertText, 'min_resolved_spokes ${1}');
});
test('solder_paste_rel_margin seeds (opt $1)', () => {
  const e = complete('  (constraint |').find((x) => x.label === 'solder_paste_rel_margin');
  assert.equal(e.insertText, 'solder_paste_rel_margin (opt ${1})');
});
test('zone_connection (enum) seeds one slot, no parens', () => {
  const e = complete('  (constraint |').find((x) => x.label === 'zone_connection');
  assert.equal(e.insertText, 'zone_connection ${1}');
});
test('assertion seeds a quoted "$1" slot (its value is a quoted expression)', () => {
  const e = complete('  (constraint |').find((x) => x.label === 'assertion');
  assert.equal(e.insertText, 'assertion "${1}"');
});

// ---------------------------------------------------------------------------
// 2b — bound keywords at an inner `(` inside a constraint body.
// ---------------------------------------------------------------------------

test('inner ( inside clearance body offers only min', () => {
  const ls = labels(complete('  (constraint clearance (|'));
  assert.deepEqual(ls.sort(), ['min']);
});
test('inner ( inside track_width body offers min/opt/max', () => {
  const ls = labels(complete('  (constraint track_width (|')).sort();
  assert.deepEqual(ls, ['max', 'min', 'opt']);
});
test('inner ( inside via_dangling body offers no bounds', () => {
  assert.deepEqual(complete('  (constraint via_dangling (|'), []);
});
test('inner ( inside zone_connection body offers no bounds (enum, not bounds)', () => {
  assert.deepEqual(complete('  (constraint zone_connection (|'), []);
});
test('after a fully typed bound word, nothing structural (C6 unchanged)', () => {
  assert.deepEqual(complete('  (constraint clearance (min |'), []);
});
test('bound entries are keyword kind', () => {
  assert.ok(complete('  (constraint track_width (|').every((e) => e.kind === 'keyword'));
});
test('partial bound word inside a constraint body still resolves bounds', () => {
  // partial "mi" — head ends at the `(`, enclosingConstraintAtParen matches.
  const ls = labels(complete('  (constraint track_width (mi|')).sort();
  assert.deepEqual(ls, ['max', 'min', 'opt']);
});

// REGRESSION: bound keywords are NEVER offered inside a condition / assertion
// expression string — that region belongs to member completion.
test('GATE: inner ( inside a condition string offers no bound keywords', () => {
  const ls = labels(complete('  (condition "A.foo(|"'));
  assert.ok(!ls.includes('min'), 'min not offered inside a condition string');
  assert.ok(!ls.includes('opt'), 'opt not offered inside a condition string');
  assert.ok(!ls.includes('max'), 'max not offered inside a condition string');
});

// ---------------------------------------------------------------------------
// Direct unit tests of the two new pure helpers.
// ---------------------------------------------------------------------------

test('constraintInsertText parses arg shapes', () => {
  assert.equal(constraintInsertText('clearance', '(min <len>)'), 'clearance (min ${1})');
  assert.equal(constraintInsertText('via_dangling', '<none>'), 'via_dangling');
  assert.equal(
    constraintInsertText('min_resolved_spokes', '<int 0-4>'),
    'min_resolved_spokes ${1}',
  );
  assert.equal(
    constraintInsertText('skew', '(min <len>) (opt <len>) (max <len>) (within_diff_pairs)?'),
    'skew (min ${1})',
  );
  assert.equal(
    constraintInsertText('solder_paste_rel_margin', '(opt <ratio>)'),
    'solder_paste_rel_margin (opt ${1})',
  );
  // no args -> bare name
  assert.equal(constraintInsertText('bridged_mask', undefined), 'bridged_mask');
});

test('enclosingConstraintAtParen finds the type at an inner (', () => {
  assert.equal(enclosingConstraintAtParen('  (constraint clearance ('), 'clearance');
  assert.equal(enclosingConstraintAtParen('  (constraint clearance (min '), null); // word typed
  assert.equal(enclosingConstraintAtParen('  (rule "x" ('), null);
  // last constraint on the line wins
  assert.equal(
    enclosingConstraintAtParen('  (constraint clearance (min 1) (constraint track_width ('),
    'track_width',
  );
});
