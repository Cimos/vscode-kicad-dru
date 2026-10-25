/**
 * PURE diagnostics for `.kicad_dru` files — Tier A (structural) checks.
 *
 * Governing principle (docs/v0.2-diagnostics-design.md): only flag what is
 * DEFINITELY wrong; when unsure, stay silent. KiCad's own *Check Rule Syntax*
 * remains the authority. Every check below is backed by a `[verified]` line in
 * `.claude/docs/kicad-dru-language.md`:
 *  - the file must begin with `(version <int>)` and hold only `(rule …)` after
 *    it (§1, drc_rule_parser.cpp `Parse()`);
 *  - a rule body accepts only `constraint` / `condition` / `layer` / `severity`
 *    children (§2, parser `default:` → "Unrecognized item");
 *  - constraint types, disallow categories, severities and zone-connection
 *    values are case-sensitive DSN tokens (§11 item 2);
 *  - `track_angle`, `via_count`, `min_resolved_spokes`, `solder_paste_rel_margin`
 *    take bare numbers — a unit suffix is a parse error (§6, §9).
 *
 * Vocabulary comes from the injected `data/api.json` (`ApiData`); nothing is
 * duplicated here. No dependency on `vscode`. Exercised by `node --test` via
 * `dist/diagnostics.mjs`; the adapter in `src/extension.ts` maps `Diag` onto
 * `vscode.Diagnostic`.
 */

import { parse, type ListNode, type Node, type Range } from './parser';
import type { ApiData, ApiVocab } from './completion';

export type Severity = 'error' | 'warning';
export type Level = 'off' | 'errors' | 'all';

export interface Diag {
  range: Range;
  severity: Severity;
  /** Stable kebab-case code, e.g. `unknown-constraint`. */
  code: string;
  message: string;
}

// ---- vocabulary derived once per ApiData -----------------------------------

interface Vocab {
  constraints: Map<string, ApiVocab>; // exact-case name -> entry
  disallow: Set<string>;
  severities: Set<string>;
  zoneConnections: Set<string>;
  /** Constraint types whose `args` carry no `<len>` (bare numbers only). */
  unitless: Set<string>;
  /** Sub-form heads legal inside `(constraint <type> …)`, from `args`. */
  constraintSubForms: Set<string>;
  unitSuffix: RegExp;
}

const names = (list: ApiVocab[] | undefined): Set<string> => new Set((list ?? []).map((v) => v.name));

function buildVocab(api: ApiData): Vocab {
  const constraints = new Map<string, ApiVocab>();
  const unitless = new Set<string>();
  const constraintSubForms = new Set(['min', 'opt', 'max']);
  // `disallow` lives under `keywords` in api.json (it takes bare categories,
  // not bounds) but is a constraint type to the parser.
  const disallowKw = (api.keywords ?? []).filter((k) => k.name === 'disallow');
  for (const c of [...(api.constraints ?? []), ...disallowKw]) {
    constraints.set(c.name, c);
    const args = c.args ?? '';
    // "<none>" and "<enum …>" shapes have nothing to unit-check; `assertion`
    // takes a string. Only shapes that name a bare numeric value are unitless.
    if (/<(num|int|ratio)\b/.test(args) && !/<len>/.test(args)) unitless.add(c.name);
    for (const m of args.matchAll(/\((\w+)/g)) constraintSubForms.add(m[1]);
  }
  const units = (api as unknown as { units?: string[] }).units ?? ['mil', 'mm', 'in', 'deg', 'fs', 'ps'];
  return {
    constraints,
    disallow: names(api.disallowCategories),
    severities: names(api.severities),
    zoneConnections: names(api.zoneConnections),
    unitless,
    constraintSubForms,
    unitSuffix: new RegExp(`^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:${units.join('|')})$`),
  };
}

const vocabCache = new WeakMap<ApiData, Vocab>();
function vocabFor(api: ApiData): Vocab {
  let v = vocabCache.get(api);
  if (!v) {
    v = buildVocab(api);
    vocabCache.set(api, v);
  }
  return v;
}

// ---- helpers ----------------------------------------------------------------

const TOP_LEVEL = new Set(['version', 'rule']);
const RULE_BODY = new Set(['constraint', 'condition', 'layer', 'severity']);

const err = (range: Range, code: string, message: string): Diag => ({ range, severity: 'error', code, message });

/** Head-atom range of a list (falls back to the open paren). */
const headRange = (n: ListNode): Range => (n.children[0]?.kind === 'atom' ? n.children[0].range : n.open);

const lists = (n: ListNode): ListNode[] => n.children.filter((c): c is ListNode => c.kind === 'list');

/** Case-insensitive lookup that reports whether an exact-case match exists. */
function lookup(set: Iterable<string>, value: string): { exact: boolean; nearest?: string } {
  let nearest: string | undefined;
  for (const s of set) {
    if (s === value) return { exact: true };
    if (!nearest && s.toLowerCase() === value.toLowerCase()) nearest = s;
  }
  return { exact: false, nearest };
}

function checkEnum(atom: Node, set: Set<string>, what: string, code: string, out: Diag[]): void {
  if (atom.kind !== 'atom') return; // strings / lists: not our call
  const r = lookup(set, atom.value);
  if (r.exact) return;
  const valid = `Valid values: ${[...set].join(', ')}.`;
  out.push(
    r.nearest
      ? err(atom.range, code, `Unknown ${what} '${atom.value}' — ${what}s are case-sensitive; did you mean '${r.nearest}'?`)
      : err(atom.range, code, `Unknown ${what} '${atom.value}'. ${valid}`),
  );
}

// ---- checks -----------------------------------------------------------------

function checkVersion(ast: Node[], out: Diag[]): void {
  const forms = ast.filter((n): n is ListNode => n.kind === 'list');
  const first = forms[0];
  if (!first || first.head !== 'version') {
    const at: Range = first ? headRange(first) : { start: { line: 0, col: 0 }, end: { line: 0, col: 0 } };
    out.push(err(at, 'missing-version', 'The first form must be the version header, e.g. (version 1).'));
  }
  forms.forEach((f, i) => {
    if (f.head !== 'version') return;
    if (i > 0 && forms[0].head === 'version') {
      out.push(err(headRange(f), 'duplicate-version', 'Duplicate (version …) header; only one is allowed, as the first form.'));
      return;
    }
    const v = f.children[1];
    if (!v || v.kind !== 'atom' || !/^\d+$/.test(v.value)) {
      out.push(err(v?.range ?? f.range, 'bad-version', 'Version must be an integer, e.g. (version 1).'));
    }
  });
}

function checkConstraint(c: ListNode, vocab: Vocab, out: Diag[]): void {
  const type = c.children[1];
  if (!type || type.kind !== 'atom') return; // nothing / string: leave to KiCad
  const r = lookup(vocab.constraints.keys(), type.value);
  if (!r.exact) {
    out.push(
      r.nearest
        ? err(type.range, 'unknown-constraint', `Unknown constraint type '${type.value}' — constraint types are case-sensitive; did you mean '${r.nearest}'?`)
        : err(type.range, 'unknown-constraint', `Unknown constraint type '${type.value}'.`),
    );
    return;
  }
  const rest = c.children.slice(2);
  if (type.value === 'disallow') {
    for (const a of rest) checkEnum(a, vocab.disallow, 'disallow category', 'bad-enum', out);
    return;
  }
  if (type.value === 'zone_connection') {
    if (rest[0]) checkEnum(rest[0], vocab.zoneConnections, 'zone_connection value', 'bad-enum', out);
    return;
  }
  const unitless = vocab.unitless.has(type.value);
  const flagUnit = (a: Node): void => {
    if (a.kind === 'atom' && vocab.unitSuffix.test(a.value)) {
      out.push(err(a.range, 'unit-on-unitless', `'${type.value}' takes a bare number; remove the unit suffix.`));
    }
  };
  for (const child of rest) {
    if (child.kind === 'list') {
      if (child.head !== null && !vocab.constraintSubForms.has(child.head)) {
        out.push(err(headRange(child), 'unknown-keyword', `Unknown '${child.head}' inside (constraint ${type.value} …).`));
      } else if (unitless && child.head !== null && ['min', 'opt', 'max'].includes(child.head)) {
        // Only a lone value atom is checked; expressions are left to KiCad.
        if (child.children.length === 2) flagUnit(child.children[1]);
      }
    } else if (unitless) {
      flagUnit(child); // e.g. (constraint min_resolved_spokes 2mm)
    }
  }
}

function checkRule(rule: ListNode, vocab: Vocab, out: Diag[]): void {
  for (const child of lists(rule)) {
    const head = child.head;
    if (head === null) continue;
    // A `(rule …)` / `(version …)` nested inside a rule is always the fallout
    // of a missing `)` above it, which `unclosed-paren` already reports at the
    // right place. Don't pile cascade errors on top.
    if (TOP_LEVEL.has(head)) continue;
    if (!RULE_BODY.has(head)) {
      const r = lookup(RULE_BODY, head);
      out.push(
        err(
          headRange(child),
          'unknown-keyword',
          r.nearest
            ? `Unknown '${head}' in rule body — keywords are case-sensitive; did you mean '${r.nearest}'?`
            : `Unknown '${head}' in rule body. Expected constraint, condition, layer, or severity.`,
        ),
      );
      continue;
    }
    if (head === 'constraint') checkConstraint(child, vocab, out);
    else if (head === 'severity' && child.children[1]) {
      checkEnum(child.children[1], vocab.severities, 'severity', 'bad-enum', out);
    }
  }
}

// ---- entry point ------------------------------------------------------------

export function computeDiagnostics(text: string, api: ApiData, level: Level = 'all'): Diag[] {
  if (level === 'off') return [];
  const vocab = vocabFor(api);
  const { ast, errors } = parse(text);
  const out: Diag[] = errors.map((e) => err(e.range, e.code, e.message));

  checkVersion(ast, out);
  for (const form of ast) {
    if (form.kind !== 'list' || form.head === null) continue;
    if (!TOP_LEVEL.has(form.head)) {
      const r = lookup(TOP_LEVEL, form.head);
      out.push(
        err(
          headRange(form),
          'unknown-keyword',
          r.nearest
            ? `Unknown top-level form '${form.head}' — keywords are case-sensitive; did you mean '${r.nearest}'?`
            : `Unknown top-level form '${form.head}'. Only (version …) and (rule …) are allowed here.`,
        ),
      );
      continue;
    }
    if (form.head === 'rule') checkRule(form, vocab, out);
  }

  out.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.col - b.range.start.col);
  return level === 'errors' ? out.filter((d) => d.severity === 'error') : out;
}
