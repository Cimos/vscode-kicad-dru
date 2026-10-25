/**
 * PURE diagnostics for `.kicad_dru` files.
 *
 * Governing principle (docs/v0.2-diagnostics-design.md): only flag what is
 * DEFINITELY wrong; when unsure, stay silent. KiCad's own *Check Rule Syntax*
 * remains the authority.
 *
 * Tier A — structural, severity `error`. Every check is backed by a
 * `[verified]` line in `.claude/docs/kicad-dru-language.md`:
 *  - the file must begin with `(version <int>)` and hold only `(rule …)` after
 *    it (§1, drc_rule_parser.cpp `Parse()`);
 *  - a rule body accepts only `constraint` / `condition` / `layer` / `severity`
 *    children (§2, parser `default:` → "Unrecognized item");
 *  - constraint types, disallow categories, severities and zone-connection
 *    values are case-sensitive DSN tokens (§11 item 2);
 *  - `track_angle`, `via_count`, `min_resolved_spokes`, `solder_paste_rel_margin`
 *    take bare numbers — a unit suffix is a parse error (§6, §9).
 *
 * Tier B — vocabulary, severity `warning` because the catalogue can lag a
 * KiCad release ("I don't recognise this", not "KiCad will reject this"):
 *  - `A.`/`B.`/`AB.` member not in the property / function catalogue inside a
 *    `(condition "…")` / `(constraint assertion "…")` body (inner `'…'`
 *    literals and the `L` receiver are skipped — `L`'s members aren't
 *    catalogued);
 *  - deprecated function aliases (`inside*`, `memberOf`);
 *  - a bare `(layer …)` token that is neither a canonical layer name
 *    (§5 layer-name catalog) nor `outer` / `inner`;
 *  - a constraint type or function whose `since` is newer than the audited
 *    KiCad version (`kicadVersion`), i.e. master-only.
 *
 * Vocabulary comes from the injected `data/api.json` (`ApiData`); nothing is
 * duplicated here. No dependency on `vscode`. Exercised by `node --test` via
 * `dist/diagnostics.mjs`; the adapter in `src/extension.ts` maps `Diag` onto
 * `vscode.Diagnostic`.
 */

import { parse, type ListNode, type Node, type Range, type StringNode } from './parser';
import type { ApiData, ApiFunction, ApiProperty, ApiVocab } from './completion';

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
  // ---- Tier B ----
  /** Lower-cased property name -> entry (property lookup is case-insensitive). */
  properties: Map<string, ApiProperty>;
  /** Lower-cased function name -> entry (function lookup is case-insensitive). */
  functions: Map<string, ApiFunction>;
  /** Canonical layer names plus the `outer` / `inner` shortcuts. */
  layers: Set<string>;
  /** The audited KiCad version string, for master-only messages. */
  kicadVersion: string;
  /** True when an entry's `since` is newer than the audited KiCad major. */
  masterOnly(entry: { since?: string }): boolean;
}

const names = (list: ApiVocab[] | undefined): Set<string> => new Set((list ?? []).map((v) => v.name));

/** `In1.Cu` … `In30.Cu` and `User.1` … `User.45` — same ranges as the grammar. */
const LAYER_RANGE = /^(?:In(?:[1-9]|[12]\d|30)\.Cu|User\.(?:[1-9]|[1-3]\d|4[0-5]))$/;

function buildVocab(api: ApiData): Vocab {
  const constraints = new Map<string, ApiVocab>();
  const unitless = new Set<string>();
  const constraintSubForms = new Set(['min', 'opt', 'max']);
  const kicadVersion = (api as unknown as { kicadVersion?: string }).kicadVersion ?? '';
  const major = parseInt(kicadVersion, 10);
  const masterOnly = (entry: { since?: string }): boolean =>
    Number.isFinite(major) && entry.since !== undefined && parseInt(entry.since, 10) > major;
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
    properties: new Map(api.properties.map((p) => [p.name.toLowerCase(), p])),
    functions: new Map(api.functions.map((f) => [f.name.toLowerCase(), f])),
    layers: names(api.layers),
    kicadVersion,
    masterOnly,
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
const warn = (range: Range, code: string, message: string): Diag => ({ range, severity: 'warning', code, message });

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
  const entry = vocab.constraints.get(type.value)!;
  if (vocab.masterOnly(entry)) {
    out.push(warn(type.range, 'master-only-token', masterOnlyMessage(`Constraint '${type.value}'`, entry, vocab)));
  }
  const rest = c.children.slice(2);
  if (type.value === 'assertion' && rest[0]?.kind === 'string') {
    checkExpression(rest[0], vocab, out);
    return;
  }
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
      } else if (child.head === 'layer') {
        checkLayer(child, vocab, out); // (constraint return_path (layer …))
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
    } else if (head === 'layer') checkLayer(child, vocab, out);
    else if (head === 'condition' && child.children[1]?.kind === 'string') {
      checkExpression(child.children[1], vocab, out);
    }
  }
}

// ---- Tier B (warnings) -----------------------------------------------------

function masterOnlyMessage(what: string, entry: { since?: string }, vocab: Vocab): string {
  return `${what} is not in KiCad ${vocab.kicadVersion} (added in KiCad ${entry.since} / master); Check Rule Syntax on KiCad ${vocab.kicadVersion} will reject it.`;
}

/** Bare atoms in `(layer …)` must be canonical layer names or `outer` / `inner`. Quoted names are left alone. */
function checkLayer(l: ListNode, vocab: Vocab, out: Diag[]): void {
  for (const a of l.children.slice(1)) {
    if (a.kind !== 'atom') continue;
    if (vocab.layers.has(a.value) || LAYER_RANGE.test(a.value)) continue;
    const r = lookup(vocab.layers, a.value);
    out.push(
      warn(
        a.range,
        'unknown-layer',
        r.nearest
          ? `Unknown layer '${a.value}' — layer names are case-sensitive; did you mean '${r.nearest}'?`
          : `Unknown layer '${a.value}'. Expected a canonical KiCad layer name (F.Cu, In1.Cu, B.Mask, …) or outer / inner.`,
      ),
    );
  }
}

const MEMBER_RE = /\b(AB|[ABL])\.([A-Za-z0-9_]+)(\s*\()?/g;

/**
 * Scan a `(condition "…")` / `(constraint assertion "…")` body for
 * `<receiver>.<member>` and check each against the catalogue. Members inside
 * an inner `'…'` literal (net names, refdes, …) are skipped, as is the `L`
 * receiver. Strings never span lines, so ranges are single-line offsets from
 * the string's opening quote.
 */
function checkExpression(s: StringNode, vocab: Vocab, out: Diag[]): void {
  const inner = s.quote === '"' ? "'" : '"';
  const line = s.range.start.line;
  const base = s.range.start.col + 1; // first char after the opening quote
  let m: RegExpExecArray | null;
  MEMBER_RE.lastIndex = 0;
  while ((m = MEMBER_RE.exec(s.value)) !== null) {
    const [, receiver, name, call] = m;
    if (receiver === 'L') continue;
    // Inside an inner literal? Count unescaped inner quotes before the match.
    let quotes = 0;
    for (let i = 0; i < m.index; i++) {
      if (s.value[i] === inner && s.value[i - 1] !== '\\') quotes++;
    }
    if (quotes % 2 === 1) continue;

    const start = base + m.index + receiver.length + 1;
    const range: Range = { start: { line, col: start }, end: { line, col: start + name.length } };
    const key = name.toLowerCase();
    if (call) {
      const fn = vocab.functions.get(key);
      if (!fn) {
        out.push(warn(range, 'unknown-function', `Unknown function '${name}()'.`));
      } else if (fn.deprecated) {
        out.push(warn(range, 'deprecated-function', `'${fn.name}()' is deprecated. ${fn.doc}`));
      } else if (vocab.masterOnly(fn)) {
        out.push(warn(range, 'master-only-token', masterOnlyMessage(`Function '${fn.name}()'`, fn, vocab)));
      }
    } else {
      const prop = vocab.properties.get(key);
      if (!prop) {
        // A known function written without parens is still a vocabulary hit —
        // KiCad reports the missing call differently; don't double up.
        if (vocab.functions.has(key)) continue;
        out.push(warn(range, 'unknown-property', `Unknown property '${name}'.`));
      } else if (vocab.masterOnly(prop)) {
        out.push(warn(range, 'master-only-token', masterOnlyMessage(`Property '${prop.name}'`, prop, vocab)));
      }
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
