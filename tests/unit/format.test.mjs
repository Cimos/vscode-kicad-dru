// Unit tests for the document formatter (src/format.ts).
// Runs under plain `node --test`; imports dist/format.mjs and dist/parser.mjs.
//
// The load-bearing tests are at the bottom: for every fixture and snippet the
// formatter must (a) preserve the parse tree exactly, (b) keep every comment,
// and (c) be idempotent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { formatDocument } from '../../dist/format.mjs';
import { parse } from '../../dist/parser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OPTS = { tabSize: 4, insertSpaces: true };
const fmt = (lines, opts = OPTS) => formatDocument(lines.join('\n'), opts);

test('lays out a rule: name on the rule line, one clause per indented line', () => {
  const out = fmt(['(version 1)', '(rule "r" (condition "A.Type == \'Via\'") (constraint via_diameter (min 0.5mm)))']);
  assert.equal(
    out,
    [
      '(version 1)',
      '(rule "r"',
      '    (condition "A.Type == \'Via\'")',
      '    (constraint via_diameter (min 0.5mm)))',
      '',
    ].join('\n'),
  );
});

test('joins a clause split across lines and normalises whitespace', () => {
  const out = fmt(['(version   1)', '', '(rule\t"split"', '    (constraint', '        track_width', '        (min 0.2mm)', '        (opt 0.25mm)))']);
  assert.equal(out, ['(version 1)', '', '(rule "split"', '    (constraint track_width (min 0.2mm) (opt 0.25mm)))', ''].join('\n'));
});

test('comments keep their place and are re-indented; blank runs collapse to one', () => {
  const out = fmt([
    '   # header',
    '(version 1)',
    '',
    '',
    '',
    '# about r',
    '(rule "r"',
    '        # inside',
    '  (constraint clearance (min 1mm))',
    '  # trailing inside',
    ')',
  ]);
  assert.equal(
    out,
    [
      '# header',
      '(version 1)',
      '',
      '# about r',
      '(rule "r"',
      '    # inside',
      '    (constraint clearance (min 1mm)))',
      '    # trailing inside',
      '',
    ].join('\n'),
  );
});

test('tabs option and CRLF are honoured', () => {
  const out = formatDocument('(version 1)\r\n(rule "r" (constraint clearance (min 1mm)))\r\n', { tabSize: 4, insertSpaces: false });
  assert.equal(out, '(version 1)\r\n(rule "r"\r\n\t(constraint clearance (min 1mm)))\r\n');
});

test('string bodies and single-quoted names are untouched', () => {
  const src = ['(version 1)', "(rule 'x y' (condition \"A.Name  ==   'a  b'\") (constraint clearance (min 1mm)))"];
  const out = fmt(src);
  assert.ok(out.includes("(rule 'x y'"));
  assert.ok(out.includes("(condition \"A.Name  ==   'a  b'\")"));
});

test('documents with parse errors are returned unchanged', () => {
  const src = '(version 1)\n(rule "r"\n  (constraint clearance (min 1mm))\n';
  assert.equal(formatDocument(src, OPTS), src);
  const src2 = '(version 1)\n(rule "r" (condition "unterminated))\n';
  assert.equal(formatDocument(src2, OPTS), src2);
});

test('a comment inside a clause forces that form verbatim (comment preserved)', () => {
  const src = ['(version 1)', '(rule "r"', '  (constraint clearance', '  # why', '    (min 1mm)))'];
  const out = fmt(src);
  assert.equal(out, src.join('\n') + '\n');
});

test('two forms on one line are left verbatim', () => {
  const src = '(version 1) (rule "r" (constraint clearance (min 1mm)))';
  assert.equal(formatDocument(src, OPTS), src + '\n');
});

// ---- semantic-preservation corpus guard (load-bearing) ----

/** Parse tree without positions — what the formatter must preserve. */
function shape(n) {
  if (n.kind === 'list') return ['(', ...n.children.map(shape), ')'];
  if (n.kind === 'string') return n.quote + n.value + n.quote;
  return n.value;
}
const tree = (text) => parse(text).ast.map(shape);
const commentTexts = (text) => parse(text).comments.map((c) => c.text);

function corpus() {
  const out = [];
  const dir = join(here, '../fixtures');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.kicad_dru'))) out.push([f, readFileSync(join(dir, f), 'utf8')]);
  const snippets = JSON.parse(readFileSync(join(here, '../../snippets/kicad-dru.json'), 'utf8'));
  for (const [name, s] of Object.entries(snippets)) {
    const body = (Array.isArray(s.body) ? s.body.join('\n') : s.body)
      .replace(/\$\{\d+:([^}]*)\}/g, '$1')
      .replace(/\$\{\d+\|([^|,]+)[^}]*\}/g, '$1')
      .replace(/\$\d+/g, '');
    out.push([`snippet:${name}`, body]);
  }
  return out;
}

for (const [name, text] of corpus()) {
  test(`format preserves tree + comments and is idempotent: ${name}`, () => {
    const once = formatDocument(text, OPTS);
    assert.deepEqual(tree(once), tree(text), 'parse tree changed');
    assert.deepEqual(commentTexts(once), commentTexts(text), 'comments changed');
    assert.equal(formatDocument(once, OPTS), once, 'not idempotent');
  });
}
