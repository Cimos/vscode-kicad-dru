/**
 * PURE document-symbol extraction for `.kicad_dru` files (Outline panel,
 * breadcrumbs, Go to Symbol). No dependency on `vscode`; exercised by
 * `node --test` via `dist/symbols.mjs`.
 *
 * One symbol per `(rule …)` named after the rule, with one child per
 * `constraint` / `condition` / `layer` / `severity` clause, plus the
 * `(version …)` header. Unbalanced input still yields symbols for every form
 * the parser could build.
 */

import { parse, type ListNode, type Node, type Range } from './parser';

export type SymbolKind = 'version' | 'rule' | 'constraint' | 'condition' | 'layer' | 'severity';

export interface DruSymbol {
  name: string;
  /** Short secondary text shown next to the name (e.g. the constraint args). */
  detail: string;
  kind: SymbolKind;
  /** Whole form, parens included. */
  range: Range;
  /** The part that is highlighted / revealed when the symbol is picked. */
  selectionRange: Range;
  children: DruSymbol[];
}

const CLAUSES = new Set<string>(['constraint', 'condition', 'layer', 'severity']);

/** Source-ish text of a node, for `detail` strings. */
function show(n: Node): string {
  if (n.kind === 'atom') return n.value;
  if (n.kind === 'string') return n.quote + n.value + (n.terminated ? n.quote : '');
  return '(' + n.children.map(show).join(' ') + ')';
}

function clauseSymbol(c: ListNode): DruSymbol {
  const head = c.head as SymbolKind;
  const args = c.children.slice(1);
  // `(constraint clearance (min 1mm))` reads best as "clearance" + "(min 1mm)".
  const named = head === 'constraint' && args[0]?.kind === 'atom';
  const name = named ? (args[0] as { value: string }).value : head;
  const detail = (named ? args.slice(1) : args).map(show).join(' ');
  const sel = named ? args[0].range : c.children[0].range;
  return { name, detail, kind: head, range: c.range, selectionRange: sel, children: [] };
}

export function computeSymbols(text: string): DruSymbol[] {
  const out: DruSymbol[] = [];
  for (const form of parse(text).ast) {
    if (form.kind !== 'list' || form.head === null) continue;
    if (form.head === 'version') {
      const v = form.children[1];
      out.push({
        name: 'version',
        detail: v ? show(v) : '',
        kind: 'version',
        range: form.range,
        selectionRange: form.children[0].range,
        children: [],
      });
      continue;
    }
    if (form.head !== 'rule') continue;
    const nameNode = form.children[1];
    const hasName = nameNode && nameNode.kind !== 'list';
    out.push({
      name: hasName ? (nameNode as { value: string }).value || '(unnamed rule)' : '(unnamed rule)',
      detail: '',
      kind: 'rule',
      range: form.range,
      selectionRange: hasName ? nameNode.range : form.children[0].range,
      children: form.children
        .filter((c): c is ListNode => c.kind === 'list' && c.head !== null && CLAUSES.has(c.head))
        .map(clauseSymbol),
    });
  }
  return out;
}
