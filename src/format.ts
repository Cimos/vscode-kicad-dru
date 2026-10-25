/**
 * PURE document formatter for `.kicad_dru` files. No dependency on `vscode`;
 * exercised by `node --test` via `dist/format.mjs`.
 *
 * Layout (the shape the KiCad docs and most hand-written rule files use):
 *
 *     (version 1)
 *
 *     # comment
 *     (rule "name"
 *         (constraint clearance (min 0.2mm))
 *         (condition "A.NetClass == 'HV'"))
 *
 *  - every top-level form starts in column 0; `(version …)` and other
 *    non-rule forms stay on one line;
 *  - a rule's name stays on the `(rule` line, each clause goes on its own line
 *    one indent deeper, and the rule's `)` closes on the last clause line;
 *  - clauses print on one line with single spaces between items;
 *  - comments keep their position relative to the forms around them and are
 *    re-indented to the depth they sit at; runs of blank lines collapse to one.
 *
 * Safety — the formatter must never change meaning:
 *  - strings and atoms are emitted verbatim (string bodies are never touched);
 *  - a document with any parse error is returned unchanged;
 *  - a top-level form whose clause contains a comment (which can't survive
 *    being joined onto one line) is emitted verbatim, as are forms that share a
 *    line with another form. Tests assert format(x) parses to the same tree as x.
 */

import { parse, type Comment, type ListNode, type Node } from './parser';

export interface FormatOptions {
  tabSize: number;
  insertSpaces: boolean;
}

/** Re-serialise a node on one line. Strings keep their original quote. */
function inline(n: Node): string {
  if (n.kind === 'atom') return n.value;
  if (n.kind === 'string') return n.quote + n.value + n.quote;
  return '(' + n.children.map(inline).join(' ') + ')';
}

export function formatDocument(text: string, opts: FormatOptions): string {
  const { ast, errors, comments } = parse(text);
  if (errors.length) return text;

  const indent = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t';
  const srcLines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  // Forms that share a physical line with a neighbour can't be laid out
  // independently; emit them verbatim.
  const sharesLine = (i: number): boolean => {
    const n = ast[i];
    const prev = ast[i - 1];
    const next = ast[i + 1];
    return (!!prev && prev.range.end.line === n.range.start.line) || (!!next && next.range.start.line === n.range.end.line);
  };

  const out: string[] = [];
  let ci = 0; // next unconsumed comment
  let lastLine = -1; // last source line already accounted for

  /** Emit a blank line if the source had one (or more) since `lastLine`. */
  const blankBefore = (line: number): void => {
    if (out.length === 0) return;
    for (let l = lastLine + 1; l < line; l++) {
      if (srcLines[l].trim() === '' && !comments.some((c) => c.line === l)) {
        if (out[out.length - 1] !== '') out.push('');
        return;
      }
    }
  };

  const flushComments = (beforeLine: number, depth: number): void => {
    while (ci < comments.length && comments[ci].line < beforeLine) {
      const c: Comment = comments[ci++];
      blankBefore(c.line);
      out.push(indent.repeat(depth) + c.text);
      lastLine = c.line;
    }
  };

  const commentsWithin = (from: number, to: number): boolean =>
    comments.some((c) => c.line > from && c.line < to);

  for (let i = 0; i < ast.length; i++) {
    const form = ast[i];
    flushComments(form.range.start.line, 0);
    blankBefore(form.range.start.line);

    const isRule = form.kind === 'list' && form.head === 'rule';
    const clauses = isRule ? (form as ListNode).children.slice(2) : [];
    const clauseHasComment = clauses.some(
      (c) => c.range.start.line !== c.range.end.line && commentsWithin(c.range.start.line, c.range.end.line),
    );
    const nonRuleHasComment = !isRule && commentsWithin(form.range.start.line, form.range.end.line);

    if (sharesLine(i) || clauseHasComment || nonRuleHasComment || (isRule && (form as ListNode).children[1]?.kind === 'list')) {
      // Verbatim fallback: copy the form's source lines untouched (right-trimmed),
      // skipping any line a neighbour sharing it already copied.
      for (let l = Math.max(form.range.start.line, lastLine + 1); l <= form.range.end.line; l++) {
        out.push(srcLines[l].trimEnd());
      }
      while (ci < comments.length && comments[ci].line <= form.range.end.line) ci++;
      lastLine = form.range.end.line;
      continue;
    }

    if (!isRule) {
      out.push(inline(form));
      lastLine = form.range.end.line;
      continue;
    }

    const rule = form as ListNode;
    const head = rule.children.slice(0, 2).map(inline).join(' ');
    if (clauses.length === 0) {
      out.push('(' + head + (rule.close ? ')' : ''));
      lastLine = rule.range.end.line;
      continue;
    }
    out.push('(' + head);
    lastLine = rule.children[1]?.range.end.line ?? rule.open.start.line;
    clauses.forEach((c, k) => {
      flushComments(c.range.start.line, 1);
      blankBefore(c.range.start.line);
      out.push(indent + inline(c) + (k === clauses.length - 1 ? ')' : ''));
      lastLine = c.range.end.line;
    });
    // Comments between the last clause and the rule's `)` stay inside the rule.
    flushComments(rule.range.end.line + 1, 1);
    lastLine = rule.range.end.line;
  }
  flushComments(Number.MAX_SAFE_INTEGER, 0);

  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join(eol) + eol;
}
