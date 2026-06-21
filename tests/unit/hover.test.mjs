// Unit tests for the PURE hover engine — runs under plain `node --test`, no
// vscode extension host. Imports the esbuild-produced ESM bundle of
// src/hover.ts (dist/hover.mjs) and the real data/api.json.
//
// Prereq: `npm run compile` (produces dist/hover.mjs). The `test:unit` script
// runs compile first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeHover } from '../../dist/hover.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '../../data/api.json'), 'utf8'));

// Put the cursor at the `|` marker and run the engine. Optional preceding text
// (prior document lines) feeds rule-depth disambiguation.
function hover(lineWithCursor, preceding = '') {
  const col = lineWithCursor.indexOf('|');
  assert.notEqual(col, -1, 'test line must contain a | cursor marker');
  const line = lineWithCursor.replace('|', '');
  return computeHover(line, col, data, preceding);
}

// ---- constraint keyword (structural) ----

test('hovering a constraint type returns doc + arg shape', () => {
  const r = hover('  (constraint cl|earance (min 0.2mm))');
  assert.ok(r, 'hover result for clearance');
  assert.match(r.contents, /clearance/);
  assert.match(r.contents, /clearance between copper/i, 'carries the constraint doc');
  assert.match(r.contents, /\(min <len>\)/, 'carries the arg-shape detail');
});

test('a since-tagged constraint type carries the since note', () => {
  const r = hover('  (constraint cr|eepage (min 0.5mm))');
  assert.ok(r, 'hover result for creepage');
  assert.match(r.contents, /Since KiCad 9/i);
});

// ---- property inside a condition string ----

test('hovering a property inside a condition returns detail + doc', () => {
  const r = hover('(condition "A.Net_Cl|ass == \'HV\'")');
  assert.ok(r, 'hover result for A.Net_Class');
  assert.match(r.contents, /Net_Class/);
  assert.match(r.contents, /netclass/i, 'carries the property doc');
  assert.match(r.contents, /string/, 'carries the type detail');
});

test('a since/units property inside a condition carries its notes', () => {
  const r = hover('(condition "A.Pad_To_Die_D|elay > 0")');
  assert.ok(r, 'hover result for Pad_To_Die_Delay');
  assert.match(r.contents, /Since KiCad 9/i);
  assert.match(r.contents, /ps/, 'units appear in the detail');
});

// ---- function inside a condition string ----

test('hovering a function inside a condition returns its signature + doc', () => {
  const r = hover('(condition "A.intersects|Area(\'zone1\')")');
  assert.ok(r, 'hover result for intersectsArea');
  assert.match(r.contents, /intersectsArea\('name'\) -> bool/);
  assert.match(r.contents, /intersects the named rule area/i);
});

test('a deprecated function carries the Deprecated note', () => {
  const r = hover('(condition "A.inside|Area(\'zone1\')")');
  assert.ok(r, 'hover result for insideArea');
  assert.match(r.contents, /Deprecated/i);
});

// ---- layer (structural) ----

test('hovering a layer token returns the layer doc', () => {
  const r = hover('  (layer F.|Cu)');
  assert.ok(r, 'hover result for F.Cu');
  assert.match(r.contents, /F\.Cu/);
  assert.match(r.contents, /front copper/i);
});

// ---- severity (structural) ----

test('hovering a severity value returns the severity doc', () => {
  const r = hover('  (severity warn|ing)');
  assert.ok(r, 'hover result for warning');
  assert.match(r.contents, /warning/);
});

// ---- bare receiver inside a condition ----

test('hovering a bare receiver inside a condition returns the receiver doc', () => {
  const r = hover('(condition "A| == B")');
  assert.ok(r, 'hover result for receiver A');
  assert.match(r.contents, /receiver/i);
});

// ---- units (glued to a numeric literal) ----

test('hovering a unit suffix returns the unit doc', () => {
  const r = hover('  (constraint clearance (min 0.2m|m))');
  assert.ok(r, 'hover result for mm');
  assert.match(r.contents, /millimetre/i);
  assert.match(r.contents, /unit/, 'detail line says unit');
});

test('hovering a deg unit inside a condition', () => {
  const r = hover('(condition "A.Orientation > 90de|g")');
  assert.ok(r, 'hover result for deg');
  assert.match(r.contents, /degree/i);
});

test('a bare in/ps word not after a digit is not a unit', () => {
  // `in` inside a '...' literal: the inner-literal suppression still wins.
  const r = hover('(condition "A.Type == \'P|in\'")');
  assert.equal(r, null, 'identifier-like word in a literal is not a unit hover');
});

// ---- operators (inside an expression body) ----

test('hovering == operator returns the operator name', () => {
  const r = hover('(condition "A.Layer =|= \'F.Cu\'")');
  assert.ok(r, 'hover result for ==');
  assert.match(r.contents, /equal to/i);
});

test('hovering && operator returns logical AND', () => {
  const r = hover('(condition "A.Locked &|& B.Locked")');
  assert.ok(r, 'hover result for &&');
  assert.match(r.contents, /logical AND/i);
});

test('hovering + outside a condition returns null', () => {
  const r = hover('  (constraint clearance (min 0.2mm)) +|');
  assert.equal(r, null, 'operators only document inside expression bodies');
});

// ---- bound keywords min/opt/max (structural, inside a constraint body) ----

test('hovering min bound returns bound doc', () => {
  const r = hover('  (constraint clearance (mi|n 0.2mm))');
  assert.ok(r, 'hover result for min');
  assert.match(r.contents, /bound/i);
  assert.match(r.contents, /clearance/);
});

test('hovering opt bound returns bound doc', () => {
  const r = hover('  (constraint track_width (op|t 0.2mm))');
  assert.ok(r, 'hover result for opt');
  assert.match(r.contents, /bound/i);
});

// ---- misses (null) ----

test('hovering inside an inner \'...\' literal returns null', () => {
  const r = hover('(condition "A.Layer == \'F.|Cu\'")');
  assert.equal(r, null, 'layer-name string literal has no hover');
});

test('hovering an unknown bare word returns null', () => {
  const r = hover('  (rule "my_rule") wibb|le');
  assert.equal(r, null, 'unknown token has no hover');
});

test('hovering an unknown member after a receiver returns null', () => {
  const r = hover('(condition "A.NotARealProp|erty == 1")');
  assert.equal(r, null, 'unknown property member has no hover');
});

// ---- keyword (structural) ----

test('hovering the rule keyword returns the keyword doc', () => {
  const r = hover('(ru|le "x"', '');
  assert.ok(r, 'hover result for rule keyword');
  assert.match(r.contents, /rule/);
  assert.match(r.contents, /rule block/i);
});
