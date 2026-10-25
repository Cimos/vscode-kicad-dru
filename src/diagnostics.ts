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

export interface TextEdit {
  range: Range;
  newText: string;
}

/** A one-click repair offered as a Quick Fix (lightbulb) for a diagnostic. */
export interface Fix {
  title: string;
  edits: TextEdit[];
}

export interface Diag {
  range: Range;
  severity: Severity;
  /** Stable kebab-case code, e.g. `unknown-constraint`. */
  code: string;
  message: string;
  /** Present only when the repair is unambiguous. */
  fix?: Fix;
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
  /** Canonical-case names, for typo suggestions (deprecated aliases and unreachable names excluded). */
  propertyNames: string[];
  functionNames: string[];
  /** Canonical layer names plus the `outer` / `inner` shortcuts. */
  layers: Set<string>;
  /** Valid `A.Type` strings, lower-cased -> canonical (comparison is case-insensitive). */
  typeValues: Map<string, string>;
  /** The audited KiCad version string, for master-only messages. */
  kicadVersion: string;
  /** True when an entry's `since` is newer than the audited KiCad major. */
  masterOnly(entry: { since?: string }): boolean;
}

const names = (list: ApiVocab[] | undefined): Set<string> => new Set((list ?? []).map((v) => v.name));

/** `In1.Cu` … `In30.Cu` and `User.1` … `User.45` — same ranges as the grammar. */
const LAYER_RANGE = /^(?:In(?:[1-9]|[12]\d|30)\.Cu|User\.(?:[1-9]|[1-3]\d|4[0-5]))$/;

/**
 * Layer names KiCad 10.0.0 accepts that are deliberately NOT in `api.layers`
 * (so completion doesn't offer them): the `Rescue` sentinel (lset.cpp:223).
 * The standard names (`F.Silkscreen`, `User.Drawings`, …) live in api.json.
 */
const LAYER_ALIASES = new Set(['Rescue']);

/** Properties KiCad special-cases for `A`/`B` only; on `AB` they are "Unrecognized item" (pcbexpr_evaluator.cpp:559-596). */
const AB_UNSUPPORTED = new Set(['type', 'netclass', 'netname', 'componentclass']);

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
    // takes a string. Only shapes that name a bare number are unitless.
    // `<ratio>` (solder_paste_rel_margin) is deliberately NOT here: KiCad
    // 10.0.0 parses it with the length resolver (drc_rule_parser.cpp:565-569),
    // so what users should write is unclear — stay silent rather than guess.
    if (/<(num|int)\b/.test(args) && !/<len>/.test(args)) unitless.add(c.name);
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
    propertyNames: api.properties.filter((p) => p.reachable && !p.deprecated).map((p) => p.name),
    functionNames: api.functions.filter((f) => !f.deprecated).map((f) => f.name),
    layers: names(api.layers),
    typeValues: new Map((api.typeValues ?? []).map((t) => [t.name.toLowerCase(), t.name])),
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

/** Optimal-string-alignment distance (Levenshtein + adjacent transposition). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

interface Lookup {
  exact: boolean;
  /** The single best correction, when there is exactly one. */
  nearest?: string;
  /** True when `nearest` differs from the value only by letter case. */
  caseOnly?: boolean;
}

/**
 * Exact lookup with a conservative suggestion: a case-insensitive match wins;
 * otherwise a typo correction is offered only when exactly one candidate is
 * within edit distance 1 (values up to 5 chars) or 2 (longer), compared
 * case-insensitively. Ambiguity means no suggestion.
 */
function lookup(set: Iterable<string>, value: string): Lookup {
  const v = value.toLowerCase();
  const max = v.length <= 5 ? 1 : 2;
  let caseHit: string | undefined;
  let best: string | undefined;
  let bestD = Infinity;
  let tie = false;
  for (const s of set) {
    if (s === value) return { exact: true };
    const l = s.toLowerCase();
    if (l === v) {
      caseHit ??= s;
      continue;
    }
    if (Math.abs(l.length - v.length) > max) continue;
    const d = editDistance(l, v);
    if (d > max) continue;
    if (d < bestD) {
      best = s;
      bestD = d;
      tie = false;
    } else if (d === bestD) tie = true;
  }
  if (caseHit) return { exact: false, nearest: caseHit, caseOnly: true };
  return tie || !best ? { exact: false } : { exact: false, nearest: best, caseOnly: false };
}

/**
 * Sentence tail after "Unknown <what> 'x'": " — <what> are case-sensitive;
 * did you mean 'Y'?", ". Did you mean 'Y'?", or just "." when there's no
 * suggestion.
 */
function hint(r: Lookup, what: string): string {
  if (!r.nearest) return '.';
  return r.caseOnly ? ` — ${what} are case-sensitive; did you mean '${r.nearest}'?` : `. Did you mean '${r.nearest}'?`;
}

/** Attach a "Change to 'Y'" quick fix when the lookup has a suggestion. */
function withReplace(d: Diag, r: Lookup, at: Range): Diag {
  if (r.nearest) d.fix = { title: `Change to '${r.nearest}'`, edits: [{ range: at, newText: r.nearest }] };
  return d;
}

function checkEnum(atom: Node, set: Set<string>, what: string, code: string, out: Diag[]): void {
  if (atom.kind !== 'atom') return; // strings / lists: not our call
  const r = lookup(set, atom.value);
  if (r.exact) return;
  const tail = r.nearest ? hint(r, `${what}s`) : `. Valid values: ${[...set].join(', ')}.`;
  out.push(withReplace(err(atom.range, code, `Unknown ${what} '${atom.value}'${tail}`), r, atom.range));
}

// ---- checks -----------------------------------------------------------------

function checkVersion(ast: Node[], out: Diag[]): void {
  const forms = ast.filter((n): n is ListNode => n.kind === 'list');
  const first = forms[0];
  if (!first || first.head !== 'version') {
    const at: Range = first ? headRange(first) : { start: { line: 0, col: 0 }, end: { line: 0, col: 0 } };
    const d = err(at, 'missing-version', 'The first form must be the version header, e.g. (version 1).');
    // Insert right before the first form (after any leading comments).
    const pos = first ? first.open.start : { line: 0, col: 0 };
    d.fix = { title: 'Add (version 1)', edits: [{ range: { start: pos, end: pos }, newText: '(version 1)\n\n' }] };
    out.push(d);
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
    const d = err(type.range, 'unknown-constraint', `Unknown constraint type '${type.value}'${hint(r, 'constraint types')}`);
    out.push(withReplace(d, r, type.range));
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
      const d = err(a.range, 'unit-on-unitless', `'${type.value}' takes a bare number; remove the unit suffix.`);
      const bare = a.value.replace(/[a-z]+$/i, '');
      d.fix = { title: `Change to '${bare}'`, edits: [{ range: a.range, newText: bare }] };
      out.push(d);
    }
  };
  for (const child of rest) {
    if (child.kind === 'list') {
      if (child.head !== null && !vocab.constraintSubForms.has(child.head)) {
        const sr = lookup(vocab.constraintSubForms, child.head);
        const d = err(headRange(child), 'unknown-keyword', `Unknown '${child.head}' inside (constraint ${type.value} …)${hint(sr, 'keywords')}`);
        out.push(withReplace(d, sr, headRange(child)));
      } else if (child.head === 'within_diff_pairs' && type.value !== 'skew') {
        // drc_rule_parser.cpp:449-456 — only the skew constraint accepts it.
        out.push(err(headRange(child), 'unknown-keyword', `'within_diff_pairs' is only valid inside (constraint skew …).`));
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
  const seenConstraint = new Set<string>();
  const seenClause = new Map<string, ListNode>();
  for (const child of lists(rule)) {
    const head = child.head;
    if (head === null) continue;
    // Duplicates, per drc_rule_parser.cpp at 10.0.0:
    //  - a second constraint of the same type: "Rule already has a '%s'
    //    constraint." (559-563) — error;
    //  - a second (layer …): error (346-347);
    //  - a second (condition …) / (severity …) silently replaces the first
    //    (330, 353) — legal, but almost certainly not what was meant: warning.
    if (head === 'constraint' && child.children[1]?.kind === 'atom') {
      const t = (child.children[1] as { value: string }).value;
      if (seenConstraint.has(t)) {
        out.push(err(child.children[1].range, 'duplicate-constraint', `Rule already has a '${t}' constraint; KiCad rejects a second one in the same rule.`));
      }
      seenConstraint.add(t);
    } else if (head === 'layer' || head === 'condition' || head === 'severity') {
      if (seenClause.has(head)) {
        out.push(
          head === 'layer'
            ? err(headRange(child), 'duplicate-layer', 'A rule may have only one (layer …) clause; KiCad rejects the second.')
            : warn(headRange(child), 'overridden-clause', `A second (${head} …) silently replaces the first one in this rule.`),
        );
      }
      seenClause.set(head, child);
    }
    // A `(rule …)` / `(version …)` nested inside a rule is always the fallout
    // of a missing `)` above it, which `unclosed-paren` already reports at the
    // right place. Don't pile cascade errors on top.
    if (TOP_LEVEL.has(head)) continue;
    if (!RULE_BODY.has(head)) {
      const r = lookup(RULE_BODY, head);
      const tail = r.nearest ? hint(r, 'keywords') : '. Expected constraint, condition, layer, or severity.';
      out.push(withReplace(err(headRange(child), 'unknown-keyword', `Unknown '${head}' in rule body${tail}`), r, headRange(child)));
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

/**
 * Bare atoms in `(layer …)`. KiCad also accepts the board's own (possibly
 * user-renamed) layer names, which we can't see, so an unrecognised name is
 * only flagged when it looks like a typo of a known one (a suggestion exists).
 * Quoted names and glob patterns (`*`, `?`) are never flagged.
 */
function checkLayer(l: ListNode, vocab: Vocab, out: Diag[]): void {
  for (const a of l.children.slice(1)) {
    if (a.kind !== 'atom') continue;
    if (vocab.layers.has(a.value) || LAYER_ALIASES.has(a.value) || LAYER_RANGE.test(a.value) || /[*?]/.test(a.value)) continue;
    const r = lookup([...vocab.layers, ...LAYER_ALIASES], a.value);
    if (!r.nearest) continue;
    out.push(withReplace(warn(a.range, 'unknown-layer', `Unknown layer '${a.value}'${hint(r, 'layer names')}`), r, a.range));
  }
}

const TYPE_CMP_RE = /^\s*(==|!=)\s*'([^']*)'/;

/** `A.Type == 'Viaa'` — RHS literal not a known type (case-insensitive; globs skipped). Always silently false in KiCad. */
function checkTypeValue(s: StringNode, after: number, vocab: Vocab, line: number, base: number, out: Diag[]): void {
  const m = TYPE_CMP_RE.exec(s.value.slice(after));
  if (!m || /[*?]/.test(m[2]) || vocab.typeValues.has(m[2].toLowerCase())) return;
  const col = base + after + m[0].length - m[2].length - 1;
  const range: Range = { start: { line, col }, end: { line, col: col + m[2].length } };
  const r = lookup(vocab.typeValues.values(), m[2]);
  const msg = `Unknown item type '${m[2]}'; this comparison is always ${m[1] === '==' ? 'false' : 'true'}${r.nearest && !r.caseOnly ? `. Did you mean '${r.nearest}'?` : '.'}`;
  out.push(r.caseOnly ? warn(range, 'unknown-type-value', msg) : withReplace(warn(range, 'unknown-type-value', msg), r, range));
}

/** `insideArea` -> `intersectsArea` etc., read from the alias's own doc string. */
function replacementFor(fn: ApiFunction): string | undefined {
  return /alias for (\w+)/i.exec(fn.doc)?.[1];
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
        const r = lookup(vocab.functionNames, name);
        out.push(withReplace(warn(range, 'unknown-function', `Unknown function '${name}()'${hint(r, 'function names')}`), r, range));
      } else if (fn.deprecated) {
        const d = warn(range, 'deprecated-function', `'${fn.name}()' is deprecated. ${fn.doc}`);
        const to = replacementFor(fn);
        if (to) d.fix = { title: `Change to '${to}'`, edits: [{ range, newText: to }] };
        out.push(d);
      } else if (vocab.masterOnly(fn)) {
        out.push(warn(range, 'master-only-token', masterOnlyMessage(`Function '${fn.name}()'`, fn, vocab)));
      }
    } else {
      if (receiver === 'AB' && AB_UNSUPPORTED.has(key)) {
        out.push(err(range, 'ab-unsupported', `'${name}' works only on A or B; KiCad reports 'AB.${name}' as an unrecognized item.`));
        continue;
      }
      if (key === 'type') checkTypeValue(s, m.index + m[0].length, vocab, line, base, out);
      const prop = vocab.properties.get(key);
      if (!prop) {
        // A known function written without parens is still a vocabulary hit —
        // KiCad reports the missing call differently; don't double up.
        if (vocab.functions.has(key)) continue;
        const r = lookup(vocab.propertyNames, name);
        out.push(withReplace(warn(range, 'unknown-property', `Unknown property '${name}'${hint(r, 'property names')}`), r, range));
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
      const tail = r.nearest ? hint(r, 'keywords') : '. Only (version …) and (rule …) are allowed here.';
      out.push(
        withReplace(
          err(headRange(form), 'unknown-keyword', `Unknown top-level form '${form.head}'${tail}`),
          r,
          headRange(form),
        ),
      );
      continue;
    }
    if (form.head === 'rule') checkRule(form, vocab, out);
  }

  out.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.col - b.range.start.col);
  return level === 'errors' ? out.filter((d) => d.severity === 'error') : out;
}
