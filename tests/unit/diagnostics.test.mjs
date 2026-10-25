// Unit tests for the PURE diagnostics engine (src/diagnostics.ts), Tier A.
// Runs under plain `node --test`; imports the esbuild ESM bundle
// (dist/diagnostics.mjs) and the real data/api.json. Prereq: `npm run compile`.
//
// The load-bearing test is the corpus guard at the bottom: every valid fixture
// under tests/fixtures/ must yield ZERO error-level diagnostics.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeDiagnostics } from '../../dist/diagnostics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const api = JSON.parse(readFileSync(join(here, '../../data/api.json'), 'utf8'));

const V = '(version 1)\n';
const diags = (text, level) => computeDiagnostics(text, api, level);
const codes = (text, level) => diags(text, level).map((d) => d.code);

// ---- structural (from the parser) ----

test('unclosed paren -> error', () => {
  const ds = diags(V + '(rule "x"');
  assert.ok(ds.some((d) => d.code === 'unclosed-paren' && d.severity === 'error'));
});

test('extra close paren -> error', () => {
  assert.ok(codes(V + '(rule "x" (constraint clearance (min 1mm))))').includes('extra-close-paren'));
});

test('unterminated string -> error', () => {
  assert.ok(codes(V + '(rule "x" (condition "A.Type == 1) (constraint clearance (min 1mm)))').includes('unterminated-string'));
});

test('a valid minimal file -> no diagnostics', () => {
  assert.deepEqual(diags(V + '(rule "r" (constraint clearance (min 0.2mm)))'), []);
});

test('empty file -> only missing-version', () => {
  assert.deepEqual(codes(''), ['missing-version']);
});

// ---- version header ----

test('missing version -> error at the first form', () => {
  const ds = diags('(rule "r" (constraint clearance (min 1mm)))');
  assert.equal(ds.length, 1);
  assert.equal(ds[0].code, 'missing-version');
  assert.deepEqual(ds[0].range.start, { line: 0, col: 1 });
});

test('version not first -> missing-version (no duplicate)', () => {
  assert.deepEqual(codes('(rule "r" (constraint clearance (min 1mm)))\n(version 1)'), ['missing-version']);
});

test('duplicate version -> error on the second', () => {
  const ds = diags(V + '(version 1)');
  assert.deepEqual(ds.map((d) => d.code), ['duplicate-version']);
  assert.equal(ds[0].range.start.line, 1);
});

test('non-integer / missing version value -> bad-version', () => {
  assert.deepEqual(codes('(version x)'), ['bad-version']);
  assert.deepEqual(codes('(version)'), ['bad-version']);
  assert.deepEqual(codes('(version 1.0)'), ['bad-version']);
});

// ---- top-level and rule-body keywords ----

test('unknown top-level form -> error', () => {
  const ds = diags(V + '(rules "r")');
  assert.equal(ds.length, 1);
  assert.equal(ds[0].code, 'unknown-keyword');
  assert.match(ds[0].message, /top-level/);
});

test('mis-cased top-level form gets a case hint', () => {
  const ds = diags(V + '(Rule "r")');
  assert.match(ds[0].message, /case-sensitive.*'rule'/);
});

test('unknown form keyword in rule body -> error', () => {
  const ds = diags(V + '(rule "r" (frobnicate 1) (constraint clearance (min 1mm)))');
  assert.equal(ds.length, 1);
  assert.equal(ds[0].code, 'unknown-keyword');
  assert.deepEqual(ds[0].range, { start: { line: 1, col: 11 }, end: { line: 1, col: 21 } });
});

test('known rule-body keywords -> none', () => {
  const body = '(condition "A.Type == \'Via\'") (constraint clearance (min 1mm)) (layer F.Cu) (severity error)';
  assert.deepEqual(diags(V + `(rule "r" ${body})`), []);
});

// ---- constraint types ----

test('unknown constraint type -> error', () => {
  const ds = diags(V + '(rule "r" (constraint frobnicate (min 1mm)))');
  assert.deepEqual(ds.map((d) => d.code), ['unknown-constraint']);
  assert.deepEqual(ds[0].range.start, { line: 1, col: 22 });
});

test('mis-cased constraint type -> error with case hint', () => {
  const ds = diags(V + '(rule "r" (constraint Clearance (min 1mm)))');
  assert.equal(ds[0].code, 'unknown-constraint');
  assert.match(ds[0].message, /did you mean 'clearance'/);
});

test('every catalogued constraint type is accepted', () => {
  for (const c of api.constraints) {
    assert.ok(!codes(V + `(rule "r" (constraint ${c.name}))`).includes('unknown-constraint'), c.name);
  }
});

test('unknown sub-form inside a constraint -> error; known ones pass', () => {
  assert.deepEqual(codes(V + '(rule "r" (constraint clearance (minimum 1mm)))'), ['unknown-keyword']);
  assert.deepEqual(diags(V + '(rule "r" (constraint skew (max 0.1mm) (within_diff_pairs)))'), []);
  // return_path is KiCad 11 — the only diagnostic is the master-only warning.
  assert.deepEqual(codes(V + '(rule "r" (constraint return_path (layer "B.Cu") (net "GND")))'), ['master-only-token']);
});

// ---- enum values ----

test('bad severity -> bad-enum; good severity -> none', () => {
  const ds = diags(V + '(rule "r" (severity loud) (constraint clearance (min 1mm)))');
  assert.deepEqual(ds.map((d) => d.code), ['bad-enum']);
  assert.match(ds[0].message, /Valid values: error, warning, ignore, exclusion/);
  assert.deepEqual(diags(V + '(rule "r" (severity warning) (constraint clearance (min 1mm)))'), []);
});

test('bad disallow category -> bad-enum on that atom only', () => {
  const ds = diags(V + '(rule "r" (constraint disallow via sandwich track))');
  assert.deepEqual(ds.map((d) => d.code), ['bad-enum']);
  assert.deepEqual(ds[0].range.start, { line: 1, col: 35 });
});

test('bad zone_connection -> bad-enum', () => {
  assert.deepEqual(codes(V + '(rule "r" (constraint zone_connection welded))'), ['bad-enum']);
  assert.deepEqual(diags(V + '(rule "r" (constraint zone_connection thermal_reliefs))'), []);
});

// ---- unit on unitless ----

test('unit on track_angle / via_count / min_resolved_spokes -> error', () => {
  assert.deepEqual(codes(V + '(rule "r" (constraint track_angle (min 90deg)))'), ['unit-on-unitless']);
  assert.deepEqual(codes(V + '(rule "r" (constraint via_count (max 4mm)))'), ['unit-on-unitless']);
  assert.deepEqual(codes(V + '(rule "r" (constraint min_resolved_spokes 2mm))'), ['unit-on-unitless']);
});

test('solder_paste_rel_margin is never unit-checked (KiCad parses it as a length; intent unclear)', () => {
  assert.deepEqual(diags(V + '(rule "r" (constraint solder_paste_rel_margin (opt -0.1mm)))'), []);
  assert.deepEqual(diags(V + '(rule "r" (constraint solder_paste_rel_margin (opt -0.1)))'), []);
});

test('bare numbers on unitless constraints and units on length constraints -> none', () => {
  assert.deepEqual(diags(V + '(rule "r" (constraint track_angle (min 90) (max 135)))'), []);
  assert.deepEqual(diags(V + '(rule "r" (constraint min_resolved_spokes 2))'), []);
  assert.deepEqual(diags(V + '(rule "r" (constraint clearance (min 0.2mm)))'), []);
  assert.deepEqual(diags(V + '(rule "r" (constraint length (max 150ps)))'), []);
  // expressions are left to KiCad
  assert.deepEqual(diags(V + '(rule "r" (constraint via_count (max 2 + 2mm)))'), []);
});

// ---- Tier B: expression vocabulary (warnings) ----

const cond = (expr) => V + `(rule "r" (condition "${expr}") (constraint clearance (min 1mm)))`;

test('unknown property -> warning with the right range', () => {
  const ds = diags(cond('A.Frobnicate == 1'));
  assert.equal(ds.length, 1);
  assert.equal(ds[0].severity, 'warning');
  assert.equal(ds[0].code, 'unknown-property');
  assert.deepEqual(ds[0].range, { start: { line: 1, col: 24 }, end: { line: 1, col: 34 } });
});

test('known properties (any case) and AB. receiver -> none', () => {
  assert.deepEqual(diags(cond("A.NetClass == 'HV' && B.netclass == 'HV' && AB.Width > 1mm")), []);
});

test('unknown function -> warning; known / spaced call -> none', () => {
  assert.deepEqual(codes(cond("A.frobnicate('x')")), ['unknown-function']);
  assert.deepEqual(diags(cond("A.intersectsArea('z') || B.intersectsArea ('z')")), []);
});

test('deprecated function alias -> deprecated-function warning', () => {
  const ds = diags(cond("A.insideArea('z')"));
  assert.deepEqual(ds.map((d) => [d.severity, d.code]), [['warning', 'deprecated-function']]);
  assert.match(ds[0].message, /intersectsArea/);
});

test('members inside inner literals and the L receiver are not checked', () => {
  assert.deepEqual(diags(cond("A.NetName == 'B.Frobnicate' && L.Anything == 1")), []);
});

test('assertion bodies are checked like conditions', () => {
  assert.deepEqual(codes(V + '(rule "r" (constraint assertion "A.Frobnicate == 1"))'), ['unknown-property']);
  assert.deepEqual(diags(V + '(rule "r" (constraint assertion "A.Hole == 0mm"))'), []);
});

test('master-only function and constraint -> master-only-token warnings, no errors', () => {
  const ds = diags(V + '(rule "r" (condition "A.inNetChain(\'x\')") (constraint net_chain_length (max 10mm)))');
  assert.deepEqual(ds.map((d) => [d.severity, d.code]), [
    ['warning', 'master-only-token'],
    ['warning', 'master-only-token'],
  ]);
  assert.match(ds[0].message, /not in KiCad 10\.0\.0/);
});

// ---- Tier B: layers (warnings) ----

const layer = (l) => V + `(rule "r" (layer ${l}) (constraint clearance (min 1mm)))`;

test('layer typos and mis-casing -> warning with a fix', () => {
  assert.deepEqual(codes(layer('F.Cuu')), ['unknown-layer']);
  assert.deepEqual(codes(layer('B.Mask2')), ['unknown-layer']);
  // In31.Cu is one edit from both In1.Cu and In30.Cu: ambiguous, so silent.
  assert.deepEqual(diags(layer('In31.Cu')), []);
  assert.match(diags(layer('f.cu'))[0].message, /did you mean 'F.Cu'/);
  assert.match(diags(layer('F.Silkscren'))[0].message, /Did you mean 'F.Silkscreen'/);
});

test('never flagged: canonical, ranged, standard names, outer/inner, quoted, globs, unrecognisable (maybe renamed)', () => {
  const ok = [
    'F.Cu', 'In3.Cu', 'In30.Cu', 'User.2', 'User.45', 'Edge.Cuts', 'outer', 'inner',
    'F.Silkscreen', 'B.Courtyard', 'User.Drawings', 'User.Eco2', 'Rescue',
    '"F.Zorp"', '*.Cu', 'F.*', '?.Mask',
    'F.Zorp', 'GND_Plane', 'User.46',
  ];
  for (const l of ok) assert.deepEqual(diags(layer(l)), [], l);
});

test('return_path (layer …) sub-clause is layer-checked too', () => {
  assert.deepEqual(
    codes(V + '(rule "r" (constraint return_path (layer B.Cuu) (net "GND")))'),
    ['master-only-token', 'unknown-layer'],
  );
});

// ---- verified KiCad 10.0.0 rule-structure checks ----

test('two constraints of the same type in one rule -> duplicate-constraint error on the second', () => {
  const ds = diags(V + '(rule "r"\n  (constraint clearance (min 1mm))\n  (constraint clearance (min 2mm)))');
  assert.deepEqual(ds.map((d) => [d.severity, d.code]), [['error', 'duplicate-constraint']]);
  assert.equal(ds[0].range.start.line, 3);
});

test('two (layer …) clauses -> error; second condition / severity -> overridden warning', () => {
  assert.deepEqual(codes(V + '(rule "r" (layer F.Cu) (layer B.Cu) (constraint clearance (min 1mm)))'), ['duplicate-layer']);
  const ds = diags(V + '(rule "r" (condition "A.Type == \'Via\'") (severity error) (condition "A.Type == \'Pad\'") (severity warning) (constraint clearance (min 1mm)))');
  assert.deepEqual(ds.map((d) => [d.severity, d.code]), [['warning', 'overridden-clause'], ['warning', 'overridden-clause']]);
});

test('same rule name twice is allowed (KiCad does not check names)', () => {
  assert.deepEqual(diags(V + '(rule "r" (constraint clearance (min 1mm)))\n(rule "r" (constraint track_width (min 1mm)))'), []);
});

test('within_diff_pairs outside skew -> error; inside skew -> fine', () => {
  assert.deepEqual(codes(V + '(rule "r" (constraint length (max 10mm) (within_diff_pairs)))'), ['unknown-keyword']);
  assert.deepEqual(diags(V + '(rule "r" (constraint skew (max 1mm) (within_diff_pairs)))'), []);
});

test('AB.Type / AB.NetClass / AB.NetName / AB.ComponentClass -> error; A./B. fine', () => {
  for (const p of ['Type', 'NetClass', 'NetName', 'ComponentClass']) {
    assert.deepEqual(codes(cond(`AB.${p} == 'x'`)), ['ab-unsupported'], p);
  }
  assert.deepEqual(diags(cond("A.NetClass == 'x' && B.NetName == 'y'")), []);
});

test("A.Type == 'unknown' -> warning (always false); case, globs and known values fine", () => {
  const ds = diags(cond("A.Type == 'Viaa'"));
  assert.deepEqual(ds.map((d) => [d.severity, d.code]), [['warning', 'unknown-type-value']]);
  assert.match(ds[0].message, /always false\. Did you mean 'Via'\?/);
  assert.deepEqual(ds[0].range, { start: { line: 1, col: 33 }, end: { line: 1, col: 37 } }); // the text inside the quotes
  assert.match(diags(cond("A.Type != 'Nope'"))[0].message, /always true/);
  for (const ok of ["A.Type == 'via'", "A.Type == 'Text Box'", "A.Type == 'Reference Image'", "B.Type != 'T*'", "A.Type == 'Table Cell'"]) {
    assert.deepEqual(diags(cond(ok)), [], ok);
  }
});

// ---- quick fixes + typo suggestions ----

/** Apply a diagnostic's fix to the text (single-line edits only, enough here). */
function applyFix(text, d) {
  const lines = text.split('\n');
  for (const e of [...d.fix.edits].reverse()) {
    const { start, end } = e.range;
    if (start.line === end.line) {
      const l = lines[start.line];
      lines[start.line] = l.slice(0, start.col) + e.newText + l.slice(end.col);
    }
  }
  return lines.join('\n');
}

const firstFix = (text) => diags(text).find((d) => d.fix);

test('typo in a constraint type -> suggestion + fix that clears the diagnostic', () => {
  const t = V + '(rule "r" (constraint clearence (min 1mm)))';
  const d = firstFix(t);
  assert.equal(d.code, 'unknown-constraint');
  assert.match(d.message, /Did you mean 'clearance'\?/);
  assert.equal(d.fix.title, "Change to 'clearance'");
  assert.deepEqual(diags(applyFix(t, d)), []);
});

test('case-only miss keeps the case-sensitive wording and fixes', () => {
  const t = V + '(rule "r" (constraint Clearance (min 1mm)))';
  const d = firstFix(t);
  assert.match(d.message, /case-sensitive; did you mean 'clearance'/);
  assert.deepEqual(diags(applyFix(t, d)), []);
});

test('typos in keywords, enums, sub-forms, layers, properties, functions all fix cleanly', () => {
  const cases = [
    V + '(rule "r" (condtion "A.Type == \'Via\'") (constraint clearance (min 1mm)))',
    V + '(rul "r" (constraint clearance (min 1mm)))',
    V + '(rule "r" (severity warnign) (constraint clearance (min 1mm)))',
    V + '(rule "r" (constraint disallow trak))',
    V + '(rule "r" (constraint zone_connection soild))',
    V + '(rule "r" (constraint clearance (mni 1mm)))',
    V + '(rule "r" (layer F.Cuu) (constraint clearance (min 1mm)))',
    cond('A.NetClas == 1'),
    cond("A.intersectArea('z')"),
  ];
  for (const t of cases) {
    const d = firstFix(t);
    assert.ok(d, `a fix is offered for:\n${t}`);
    assert.deepEqual(diags(applyFix(t, d)), [], `fix clears everything for:\n${t}`);
  }
});

test('no suggestion when nothing is close or when it is ambiguous', () => {
  const d = diags(V + '(rule "r" (constraint frobnicate (min 1mm)))')[0];
  assert.equal(d.fix, undefined);
  assert.doesNotMatch(d.message, /did you mean/i);
  // 'via' is 1 edit from both 'vias'? not a candidate; 'pod' is 1 edit from 'pad' only -> fix
  // two equally close candidates -> no fix: 'tex' is 1 from 'text' only, so use 'trac' (track) vs none
  const amb = diags(V + '(rule "r" (constraint disallow hol))')[0]; // hole only
  assert.ok(amb.fix);
});

test('unit-on-unitless offers to strip the unit', () => {
  const t = V + '(rule "r" (constraint track_angle (min 90deg)))';
  const d = firstFix(t);
  assert.equal(d.fix.title, "Change to '90'");
  assert.deepEqual(diags(applyFix(t, d)), []);
});

test('deprecated alias offers its replacement', () => {
  const t = cond("A.insideCourtyard('U1')");
  const d = firstFix(t);
  assert.equal(d.fix.title, "Change to 'intersectsCourtyard'");
  assert.deepEqual(diags(applyFix(t, d)), []);
});

test('missing version offers to insert it before the first form, after leading comments', () => {
  const t = '# header\n(rule "r" (constraint clearance (min 1mm)))';
  const d = diags(t).find((x) => x.code === 'missing-version');
  assert.deepEqual(d.fix.edits[0].range, { start: { line: 1, col: 0 }, end: { line: 1, col: 0 } });
  const fixed = '# header\n' + d.fix.edits[0].newText + '(rule "r" (constraint clearance (min 1mm)))';
  assert.deepEqual(diags(fixed), []);
});

// ---- level gating ----

test('level=off -> nothing; level=errors drops warnings; all keeps both', () => {
  const bad = '(rule "r" (condition "A.Frobnicate == 1") (constraint frobnicate (min 1mm)))';
  assert.equal(diags(bad, 'off').length, 0);
  assert.deepEqual(diags(bad, 'errors').map((d) => d.code), ['missing-version', 'unknown-constraint']);
  assert.deepEqual(diags(bad, 'all').map((d) => d.code), ['missing-version', 'unknown-property', 'unknown-constraint']);
});

test('a missing ) does not cascade into unknown-keyword on the following rules', () => {
  const ds = diags(V + '(rule "a"\n  (constraint clearance (min 1mm))\n(rule "b"\n  (constraint clearance (min 1mm)))');
  assert.deepEqual(ds.map((d) => d.code), ['unclosed-paren']);
  assert.deepEqual(ds[0].range.start, { line: 1, col: 0 });
});

test('diagnostics are sorted by position', () => {
  const ds = diags('(rule "r" (severity loud) (constraint frobnicate))\n(version 1)\n(version 1)');
  const pos = ds.map((d) => d.range.start.line * 1000 + d.range.start.col);
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b));
});

// ---- anti-false-positive corpus guard (load-bearing) ----

const fixturesDir = join(here, '../fixtures');
const KICAD11_FIXTURE = 'kicad11-master-netchain.kicad_dru';
for (const f of readdirSync(fixturesDir).filter((n) => n.endsWith('.kicad_dru') && n !== KICAD11_FIXTURE)) {
  test(`valid fixture ${f} produces no diagnostics at all`, () => {
    assert.deepEqual(diags(readFileSync(join(fixturesDir, f), 'utf8'), 'all'), []);
  });
}

test(`${KICAD11_FIXTURE} yields only master-only-token warnings`, () => {
  const ds = diags(readFileSync(join(fixturesDir, KICAD11_FIXTURE), 'utf8'), 'all');
  assert.ok(ds.length >= 4, 'net_chain_length x2, stub_length, return_path, and the three functions');
  assert.ok(ds.every((d) => d.severity === 'warning' && d.code === 'master-only-token'), JSON.stringify(ds));
});

test('every snippet body is diagnostic-free once placeholders are filled', () => {
  const snippets = JSON.parse(readFileSync(join(here, '../../snippets/kicad-dru.json'), 'utf8'));
  for (const [name, s] of Object.entries(snippets)) {
    const body = (Array.isArray(s.body) ? s.body.join('\n') : s.body)
      .replace(/\$\{\d+:([^}]*)\}/g, '$1') // ${1:default} -> default
      .replace(/\$\{\d+\|([^|,]+)[^}]*\}/g, '$1') // ${1|a,b|} -> a
      .replace(/\$\d+/g, '');
    // Whole-rule snippets stand alone; fragment snippets get a rule wrapper.
    const text = /^\s*\(version\b/.test(body)
      ? body
      : /^\s*\(rule\b/.test(body)
        ? V + body
        : V + `(rule "snippet" ${body})`;
    assert.deepEqual(diags(text, 'all'), [], `${name}:\n${text}`);
  }
});
