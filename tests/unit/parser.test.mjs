// Unit tests for the PURE s-expression parser (src/parser.ts).
// Runs under plain `node --test`; imports the esbuild ESM bundle
// (dist/parser.mjs). Prereq: `npm run compile`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parse } from '../../dist/parser.mjs';

test('parses a flat form into a list node with head', () => {
  const { ast, errors } = parse('(version 1)');
  assert.deepEqual(errors, []);
  assert.equal(ast.length, 1);
  assert.equal(ast[0].kind, 'list');
  assert.equal(ast[0].head, 'version');
  assert.equal(ast[0].children[0].kind, 'atom');
  assert.equal(ast[0].children[1].value, '1');
});

test('nests child lists', () => {
  const { ast } = parse('(rule "x" (constraint clearance (min 0.2mm)))');
  const rule = ast[0];
  assert.equal(rule.head, 'rule');
  assert.equal(rule.children[1].kind, 'string');
  assert.equal(rule.children[1].value, 'x');
  const constraint = rule.children.find((c) => c.kind === 'list');
  assert.equal(constraint.head, 'constraint');
  assert.equal(constraint.children[2].head, 'min');
});

test('flags an unclosed paren at its opening paren', () => {
  const { errors } = parse('(rule "x"\n  (constraint clearance (min 1mm))');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'unclosed-paren');
  assert.deepEqual(errors[0].range.start, { line: 0, col: 0 });
});

test('flags an extra close paren', () => {
  const { errors } = parse('(version 1))');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'extra-close-paren');
  assert.deepEqual(errors[0].range.start, { line: 0, col: 11 });
});

test('unterminated string: error, string ends at line end, next line parses', () => {
  const { errors, ast } = parse('(condition "A.Type == \'Via\'\n(rule "y"))');
  assert.ok(errors.some((e) => e.code === 'unterminated-string'));
  const cond = ast[0];
  assert.equal(cond.children[1].kind, 'string');
  assert.equal(cond.children[1].terminated, false);
  // line 2's (rule …) closed the condition's list; one extra ')' remains
  assert.ok(cond.children.some((n) => n.kind === 'list' && n.head === 'rule'));
});

test("single-quoted structural strings and nested quotes are handled", () => {
  const { ast, errors } = parse(`(rule 'it"s' (condition "A.Name == 'x(y)'"))`);
  assert.deepEqual(errors, []);
  assert.equal(ast[0].children[1].value, 'it"s');
  const cond = ast[0].children[2];
  assert.equal(cond.children[1].value, "A.Name == 'x(y)'");
  assert.equal(cond.close.start.col, 42);
  assert.equal(ast[0].close.start.col, 43);
});

test('backslash escapes a quote inside a string', () => {
  const { ast, errors } = parse('(rule "a\\"b")');
  assert.deepEqual(errors, []);
  assert.equal(ast[0].children[1].value, 'a\\"b');
  assert.equal(ast[0].children[1].terminated, true);
});

test('strips line-start # comments only (indented too)', () => {
  const { ast, errors } = parse('# (constraint hole_size (min 0.3mm))\n   # also (\n(version 1)');
  assert.deepEqual(errors, []);
  assert.equal(ast.length, 1);
  assert.equal(ast[0].head, 'version');
});

test('a mid-line # is an atom, not a comment', () => {
  const { ast, errors } = parse('(rule "x" # (constraint clearance (min 1mm)))');
  assert.deepEqual(errors, []);
  assert.ok(ast[0].children.some((n) => n.kind === 'atom' && n.value === '#'));
  assert.equal(ast[0].close.start.col, 44);
});

test('records 0-based line/col ranges and tolerates CRLF', () => {
  const { ast } = parse('(version 1)\r\n(rule "x"\r\n  (constraint clearance (min 1mm)))\r\n');
  assert.deepEqual(ast[0].open.start, { line: 0, col: 0 });
  assert.deepEqual(ast[0].close.start, { line: 0, col: 10 });
  assert.deepEqual(ast[1].range.start, { line: 1, col: 0 });
  assert.deepEqual(ast[1].range.end, { line: 2, col: 35 });
  assert.deepEqual(ast[1].children[2].children[1].range, { start: { line: 2, col: 14 }, end: { line: 2, col: 23 } });
});

test('text variables and tabs are plain atoms', () => {
  const { ast, errors } = parse('(rule\t"x"\t(layer\t${LAYER}))');
  assert.deepEqual(errors, []);
  assert.equal(ast[0].children[2].children[1].value, '${LAYER}');
});

test('never throws on garbage', () => {
  for (const s of [')))', '"', "'", '(', '', '\n\n', '((("', '# only a comment', '(rule "a" (constraint ) ) ) (']) {
    assert.doesNotThrow(() => parse(s), s);
  }
});
