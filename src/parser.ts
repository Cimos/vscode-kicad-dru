/**
 * PURE s-expression parser for `.kicad_dru` files.
 *
 * No dependency on `vscode`. Exercised by `node --test` via the esbuild ESM
 * bundle (`dist/parser.mjs`) and consumed by `src/diagnostics.ts`.
 *
 * Lexical rules mirror KiCad's DSN lexer as documented in
 * `.claude/docs/kicad-dru-language.md` §1:
 *  - `#` starts a comment only as the first non-whitespace character of a line.
 *  - Strings are delimited by `"` or `'` and cannot span lines; a string still
 *    open at end of line is recorded as `terminated: false` plus an
 *    `unterminated-string` error, and the line's remainder is consumed by it.
 *  - Everything else between whitespace / parens / quotes is an atom
 *    (`${...}` text variables included).
 *
 * The parser never throws: unbalanced input yields a best-effort tree plus
 * `unclosed-paren` / `extra-close-paren` errors.
 */

export interface Pos {
  /** 0-based line. */
  line: number;
  /** 0-based column (UTF-16 code units, matching VS Code positions). */
  col: number;
}
export interface Range {
  start: Pos;
  end: Pos;
}

export interface ListNode {
  kind: 'list';
  /** Value of the first child when it is an atom; `null` otherwise. */
  head: string | null;
  children: Node[];
  /** From the opening paren to the closing paren (or last child if unclosed). */
  range: Range;
  open: Range;
  close: Range | null;
}
export interface AtomNode {
  kind: 'atom';
  value: string;
  range: Range;
}
export interface StringNode {
  kind: 'string';
  /** Body without the delimiting quotes; escapes are left as written. */
  value: string;
  quote: '"' | "'";
  terminated: boolean;
  range: Range;
}
export type Node = ListNode | AtomNode | StringNode;

export interface ParseError {
  code: 'unclosed-paren' | 'extra-close-paren' | 'unterminated-string';
  message: string;
  range: Range;
}
export interface Comment {
  /** 0-based line of the comment. */
  line: number;
  /** The comment text from `#` to end of line, trailing whitespace trimmed. */
  text: string;
}
export interface ParseResult {
  ast: Node[];
  errors: ParseError[];
  /** Line-start `#` comments, in document order (consumed by the formatter). */
  comments: Comment[];
}

const span = (line: number, start: number, end: number): Range => ({
  start: { line, col: start },
  end: { line, col: end },
});

export function parse(text: string): ParseResult {
  const errors: ParseError[] = [];
  const ast: Node[] = [];
  const comments: Comment[] = [];
  const stack: ListNode[] = [];
  const push = (n: Node): void => {
    if (stack.length) stack[stack.length - 1].children.push(n);
    else ast.push(n);
  };

  const lines = text.split('\n');
  for (let line = 0; line < lines.length; line++) {
    let s = lines[line];
    if (s.endsWith('\r')) s = s.slice(0, -1);
    if (/^\s*#/.test(s)) {
      comments.push({ line, text: s.trim() }); // line-start-only comment
      continue;
    }

    let col = 0;
    while (col < s.length) {
      const ch = s[col];
      if (ch === ' ' || ch === '\t') {
        col++;
        continue;
      }
      if (ch === '(') {
        const open = span(line, col, col + 1);
        const node: ListNode = { kind: 'list', head: null, children: [], range: { ...open }, open, close: null };
        push(node);
        stack.push(node);
        col++;
        continue;
      }
      if (ch === ')') {
        const range = span(line, col, col + 1);
        const top = stack.pop();
        if (!top) {
          errors.push({ code: 'extra-close-paren', message: 'Unmatched closing parenthesis.', range });
        } else {
          top.close = range;
          top.range = { start: top.open.start, end: range.end };
        }
        col++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const startCol = col;
        col++;
        let terminated = false;
        while (col < s.length) {
          if (s[col] === '\\' && col + 1 < s.length) {
            col += 2;
            continue;
          }
          if (s[col] === ch) {
            terminated = true;
            col++;
            break;
          }
          col++;
        }
        const range = span(line, startCol, col);
        const value = s.slice(startCol + 1, terminated ? col - 1 : col);
        if (!terminated) {
          errors.push({ code: 'unterminated-string', message: 'Unterminated string literal.', range });
        }
        push({ kind: 'string', value, quote: ch, terminated, range });
        continue;
      }
      const startCol = col;
      while (col < s.length && !' \t()"\''.includes(s[col])) col++;
      push({ kind: 'atom', value: s.slice(startCol, col), range: span(line, startCol, col) });
    }
  }

  // Fix up heads and ranges of lists; report any still open at EOF.
  const finish = (n: Node): void => {
    if (n.kind !== 'list') return;
    const first = n.children[0];
    n.head = first && first.kind === 'atom' ? first.value : null;
    if (!n.close && n.children.length) {
      n.range = { start: n.open.start, end: n.children[n.children.length - 1].range.end };
    }
    n.children.forEach(finish);
  };
  ast.forEach(finish);
  for (const open of stack) {
    errors.push({ code: 'unclosed-paren', message: 'Unclosed parenthesis.', range: open.open });
  }

  return { ast, errors, comments };
}
