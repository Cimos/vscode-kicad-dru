/**
 * PURE completion logic for `.kicad_dru` condition / assertion expressions.
 *
 * This module has NO dependency on `vscode`. It is exercised directly by
 * `node --test` (see `test/completion.test.mjs`). The real extension
 * (`src/extension.ts`) is the only `vscode`-coupled file; it feeds this
 * function the physical line text + cursor column and maps the returned
 * entries onto `vscode.CompletionItem`s.
 *
 * Data is INJECTED, not duplicated: callers pass the parsed `data/api.json`
 * payload (see {@link ApiData}) and this module derives the offered member
 * sets from it. Tests can pass a tiny fake instead of the real catalogue.
 */

// ---- shape of the parsed data/api.json payload -----------------------------

export interface ApiProperty {
  name: string;
  receivers: string[];
  type: string;
  units?: string;
  since?: string;
  deprecated?: boolean;
  reachable: boolean;
  doc: string;
}

export interface ApiFunction {
  name: string;
  args: string;
  returns: string;
  since?: string;
  deprecated?: boolean;
  doc: string;
}

/**
 * A structural-vocabulary list element from `data/api.json` (the flat
 * `keywords` / `constraints` / `disallowCategories` / `severities` /
 * `zoneConnections` / `layers` arrays). Each carries `name` + `doc`;
 * constraints additionally carry an `args` shape and `since`, and any element
 * may be flagged `deprecated`.
 */
export interface ApiVocab {
  name: string;
  doc: string;
  args?: string;
  since?: string;
  deprecated?: boolean;
}

export interface ApiData {
  receivers: string[];
  properties: ApiProperty[];
  functions: ApiFunction[];
  // STRUCTURAL vocab (outside condition/assertion strings). Optional so a
  // legacy/minimal payload still builds — missing lists degrade to no
  // structural suggestions, never a crash.
  keywords?: ApiVocab[];
  constraints?: ApiVocab[];
  disallowCategories?: ApiVocab[];
  severities?: ApiVocab[];
  zoneConnections?: ApiVocab[];
  layers?: ApiVocab[];
}

// ---- public completion-entry types (no vscode dependency) ------------------

export type EntryKind =
  | 'receiver'
  | 'property'
  | 'function'
  | 'keyword'
  | 'constraintType'
  | 'disallowCategory'
  | 'zoneConnection'
  | 'severity'
  | 'layerToken';

export interface CompletionEntry {
  /** Text shown + matched against (canonical casing). */
  label: string;
  /** Mapped to vscode.CompletionItemKind by the adapter. */
  kind: EntryKind;
  /** Type/units one-liner, e.g. "int (IU)" or "fn(area:'name') -> bool". */
  detail: string;
  /** Markdown documentation body (doc + since/deprecated note). */
  doc: string;
  /** Optional snippet (functions seed `name('$1')`); plain label if absent. */
  insertText?: string;
  /** Orders receivers/keywords above properties above functions. */
  sortText: string;
  /** [start, end) char offsets on the line that the accepted item replaces. */
  replace: { start: number; end: number };
}

/**
 * The data surface the pure function consults. Built from {@link ApiData} via
 * {@link buildApi}, or hand-rolled by tests.
 */
export interface CompletionApi {
  /** Receiver labels (A, B, AB, L) as top-level identifier suggestions. */
  receivers: string[];
  /** Members offered after `<receiver>.` — `A` table reused for `AB`; `L` -> []. */
  membersFor(receiver: string): Omit<CompletionEntry, 'replace'>[];
  /** Identifiers valid at expression top level (receivers + `null`). */
  topLevel(): Omit<CompletionEntry, 'replace'>[];

  // ---- STRUCTURAL vocab (outside condition/assertion strings) ----
  /** Top-of-file forms: `version`, `rule`. */
  topKeywords(): Omit<CompletionEntry, 'replace'>[];
  /** Forms valid inside a rule body: `constraint`, `condition`, `layer`, `severity`. */
  ruleBodyKeywords(): Omit<CompletionEntry, 'replace'>[];
  /** Constraint types offered after `(constraint `. */
  constraintTypes(): Omit<CompletionEntry, 'replace'>[];
  /** Bound keywords (min/opt/max) valid inside the given constraint type's body. */
  boundsFor(constraintType: string): Omit<CompletionEntry, 'replace'>[];
  /** Categories offered after `(constraint disallow `. */
  disallowCategories(): Omit<CompletionEntry, 'replace'>[];
  /** Enum values offered after `(constraint zone_connection `. */
  zoneConnections(): Omit<CompletionEntry, 'replace'>[];
  /** Values offered after `(severity `. */
  severities(): Omit<CompletionEntry, 'replace'>[];
  /** Layer tokens offered after `(layer `. */
  layerTokens(): Omit<CompletionEntry, 'replace'>[];
}

// ---- detail / doc formatting -----------------------------------------------

export function propertyDetail(p: ApiProperty): string {
  return p.units ? `${p.type} (${p.units})` : p.type;
}

export function functionDetail(f: ApiFunction): string {
  // e.g. "intersectsArea('name') -> bool"
  return `${f.args} -> ${f.returns}`;
}

export function withNotes(doc: string, opts: { since?: string; deprecated?: boolean }): string {
  const notes: string[] = [];
  if (opts.deprecated) notes.push('**Deprecated.**');
  if (opts.since) notes.push(`_Since KiCad ${opts.since}._`);
  return notes.length ? `${doc}\n\n${notes.join(' ')}` : doc;
}

// ---- constraint value-skeleton derivation ---------------------------------

/**
 * Derive a snippet body for a constraint type from its `constraints[].args`
 * shape. Pure + table-free: parse the arg-string grammar used in data/api.json.
 *
 *   "(min <len>)"                          -> "clearance (min $1)"
 *   "(min <len>) (opt <len>) (max <len>)"  -> "track_width (min $1)"  (only the
 *                                             first bound is seeded; opt/max are
 *                                             optional and offered later by 2b)
 *   "(opt <ratio>)"                        -> "solder_paste_rel_margin (opt $1)"
 *   "<none>"                               -> "via_dangling"           (bare)
 *   "<int 0-4>" / "<enum ...>" / "<expr>"  -> "min_resolved_spokes $1" (one slot)
 *
 * The leading token of the FIRST `(<bound> ...)` group, if present, seeds a
 * single `(<bound> $1)`. A bare value spec (int/enum/expr) seeds one `$1` slot.
 * `<none>` seeds nothing (returns the bare name). `disallow`'s category slot is
 * not reached here (disallow lives in `keywords`, not `constraints`); were it
 * added, its `<categories...>` args fall through to the `${name} ${1}` branch,
 * leaving a single category slot.
 */
export function constraintInsertText(name: string, args?: string): string {
  if (!args) return name;
  // First parenthesised bound group, e.g. "(min <len>)".
  const m = /\(\s*(min|opt|max)\b/.exec(args);
  if (m) return `${name} (${m[1]} \${1})`;
  // No bound group. "<none>" -> bare. Anything else (bare int/enum/expr) -> one slot.
  if (/^\s*<none>\s*$/.test(args)) return name;
  return `${name} \${1}`;
}

// ---- build the default CompletionApi from parsed api.json ------------------

/**
 * Derive a {@link CompletionApi} from the parsed `data/api.json`. Pure:
 * filters unreachable properties, dedupes, and pre-sorts member sets so the
 * adapter can hand entries to vscode unchanged.
 */
export function buildApi(data: ApiData): CompletionApi {
  // Members for the A/B/AB receivers: every reachable property whose receiver
  // list includes that receiver, plus every (receiver-bound) function.
  function memberEntries(receiver: string): Omit<CompletionEntry, 'replace'>[] {
    if (receiver === 'L') return []; // layer receiver has no members
    const props = data.properties
      .filter((p) => p.reachable)
      .filter((p) => p.receivers.includes('A') || p.receivers.includes(receiver))
      .map<Omit<CompletionEntry, 'replace'>>((p) => ({
        label: p.name,
        kind: 'property',
        detail: propertyDetail(p),
        doc: withNotes(p.doc, p),
        // properties sort before functions; '1' bucket
        sortText: `1_${p.name}`,
      }));
    const fns = data.functions.map<Omit<CompletionEntry, 'replace'>>((f) => ({
      label: f.name,
      kind: 'function',
      detail: functionDetail(f),
      doc: withNotes(f.doc, f),
      // seed the first '...' arg if the function takes one; bare () otherwise
      insertText: f.args.includes("'") ? `${f.name}('$1')` : `${f.name}()`,
      // functions sort after properties; '2' bucket. Deprecated last.
      sortText: `2_${f.deprecated ? 'z' : 'a'}_${f.name}`,
    }));
    return [...props, ...fns];
  }

  // Pre-compute the A member set; AB reuses it (construction-identical per
  // the evaluator), B gets its own (its receiver-list filter is the same here
  // because every property lists both A and B, but compute honestly).
  const memberCache = new Map<string, Omit<CompletionEntry, 'replace'>[]>();
  function membersFor(receiver: string): Omit<CompletionEntry, 'replace'>[] {
    const key = receiver === 'AB' ? 'A' : receiver;
    let cached = memberCache.get(key);
    if (!cached) {
      cached = memberEntries(key);
      memberCache.set(key, cached);
    }
    return cached;
  }

  function topLevel(): Omit<CompletionEntry, 'replace'>[] {
    const receivers = data.receivers.map<Omit<CompletionEntry, 'replace'>>((r) => ({
      label: r,
      kind: 'receiver',
      detail: r === 'L' ? 'layer receiver' : 'item receiver',
      doc:
        r === 'L'
          ? 'Layer receiver — used in `(layer ...)` style comparisons; has no members.'
          : r === 'AB'
            ? 'Both items A and B (e.g. `AB.isCoupledDiffPair()`); same member set as `A`.'
            : `Receiver for item ${r} in the current rule context.`,
      // receivers/keywords sort first; '0' bucket
      sortText: `0_${r}`,
    }));
    const nullKw: Omit<CompletionEntry, 'replace'> = {
      label: 'null',
      kind: 'keyword',
      detail: 'null literal',
      doc: 'The `null` literal — compare against optional (`int?`/`double?`) properties that may be unset.',
      sortText: '0_null',
    };
    return [...receivers, nullKw];
  }

  // ---- STRUCTURAL vocab builders ----
  //
  // Each consumes a flat `ApiVocab[]` from data/api.json and produces
  // replace-less CompletionEntries. `name` is the canonical label; `doc` runs
  // through withNotes so since/deprecated flags surface identically to the
  // expression members. Missing lists degrade to `[]`.

  function vocabEntries(
    list: ApiVocab[] | undefined,
    kind: EntryKind,
    bucket: string,
    detailFn: (v: ApiVocab) => string,
  ): Omit<CompletionEntry, 'replace'>[] {
    return (list ?? []).map<Omit<CompletionEntry, 'replace'>>((v) => ({
      label: v.name,
      kind,
      detail: detailFn(v),
      doc: withNotes(v.doc, v),
      // deprecated entries sort last within their bucket
      sortText: `${bucket}_${v.deprecated ? 'z' : 'a'}_${v.name}`,
    }));
  }

  // The flat `keywords` list mixes top-of-file forms and rule-body forms;
  // partition by name. `disallow` is a constraint type, not a standalone
  // body keyword, so it is excluded from both keyword sets.
  const TOP_KEYWORDS = new Set(['version', 'rule']);
  const BODY_KEYWORDS = new Set(['constraint', 'condition', 'layer', 'severity']);

  let topKeywordsCache: Omit<CompletionEntry, 'replace'>[] | null = null;
  function topKeywords(): Omit<CompletionEntry, 'replace'>[] {
    if (!topKeywordsCache) {
      topKeywordsCache = vocabEntries(
        (data.keywords ?? []).filter((k) => TOP_KEYWORDS.has(k.name)),
        'keyword',
        '0',
        () => 'keyword',
      );
    }
    return topKeywordsCache;
  }

  let ruleBodyKeywordsCache: Omit<CompletionEntry, 'replace'>[] | null = null;
  function ruleBodyKeywords(): Omit<CompletionEntry, 'replace'>[] {
    if (!ruleBodyKeywordsCache) {
      ruleBodyKeywordsCache = vocabEntries(
        (data.keywords ?? []).filter((k) => BODY_KEYWORDS.has(k.name)),
        'keyword',
        '0',
        () => 'keyword',
      );
    }
    return ruleBodyKeywordsCache;
  }

  let constraintTypesCache: Omit<CompletionEntry, 'replace'>[] | null = null;
  function constraintTypes(): Omit<CompletionEntry, 'replace'>[] {
    if (!constraintTypesCache) {
      // Attach a value skeleton derived from each type's `args` shape. Set
      // `insertText` to `undefined` when it equals the label (e.g. via_dangling
      // `<none>`) so we don't force a pointless SnippetString.
      constraintTypesCache = (data.constraints ?? []).map<Omit<CompletionEntry, 'replace'>>((v) => {
        const ins = constraintInsertText(v.name, v.args);
        return {
          label: v.name,
          kind: 'constraintType',
          detail: v.args ?? 'constraint type',
          doc: withNotes(v.doc, v),
          insertText: ins === v.name ? undefined : ins,
          // deprecated entries sort last within their bucket
          sortText: `0_${v.deprecated ? 'z' : 'a'}_${v.name}`,
        };
      });
    }
    return constraintTypesCache;
  }

  // Bound keywords (min/opt/max) usable inside a constraint body, parsed once
  // per type from its `args`. Constraints with no `(min|opt|max)` group yield
  // `[]` (e.g. via_dangling `<none>`, zone_connection `<enum …>`).
  const boundsCache = new Map<string, Omit<CompletionEntry, 'replace'>[]>();
  function boundsFor(constraintType: string): Omit<CompletionEntry, 'replace'>[] {
    let cached = boundsCache.get(constraintType);
    if (!cached) {
      const c = (data.constraints ?? []).find((v) => v.name === constraintType);
      const args = c?.args ?? '';
      const bounds = ['min', 'opt', 'max'].filter((b) =>
        new RegExp(`\\(\\s*${b}\\b`).test(args),
      );
      cached = bounds.map<Omit<CompletionEntry, 'replace'>>((b) => ({
        label: b,
        kind: 'keyword',
        detail: 'bound',
        doc: `\`${b}\` bound for the \`${constraintType}\` constraint.`,
        sortText: `0_${b === 'min' ? '0' : b === 'opt' ? '1' : '2'}_${b}`,
      }));
      boundsCache.set(constraintType, cached);
    }
    return cached;
  }

  let disallowCache: Omit<CompletionEntry, 'replace'>[] | null = null;
  function disallowCategories(): Omit<CompletionEntry, 'replace'>[] {
    if (!disallowCache) {
      disallowCache = vocabEntries(
        data.disallowCategories,
        'disallowCategory',
        '1',
        () => 'disallow category',
      );
    }
    return disallowCache;
  }

  let zoneConnCache: Omit<CompletionEntry, 'replace'>[] | null = null;
  function zoneConnections(): Omit<CompletionEntry, 'replace'>[] {
    if (!zoneConnCache) {
      zoneConnCache = vocabEntries(
        data.zoneConnections,
        'zoneConnection',
        '1',
        () => 'zone connection',
      );
    }
    return zoneConnCache;
  }

  let severitiesCache: Omit<CompletionEntry, 'replace'>[] | null = null;
  function severities(): Omit<CompletionEntry, 'replace'>[] {
    if (!severitiesCache) {
      severitiesCache = vocabEntries(data.severities, 'severity', '1', () => 'severity');
    }
    return severitiesCache;
  }

  let layersCache: Omit<CompletionEntry, 'replace'>[] | null = null;
  function layerTokens(): Omit<CompletionEntry, 'replace'>[] {
    if (!layersCache) {
      layersCache = vocabEntries(data.layers, 'layerToken', '1', () => 'layer');
    }
    return layersCache;
  }

  return {
    receivers: data.receivers.slice(),
    membersFor,
    topLevel,
    topKeywords,
    ruleBodyKeywords,
    constraintTypes,
    boundsFor,
    disallowCategories,
    zoneConnections,
    severities,
    layerTokens,
  };
}

// ---- gating helpers --------------------------------------------------------

/**
 * Is `pos` inside the inner expression body of a `(condition "...")` or
 * `(constraint assertion "...")` on this single physical line? DRU conditions
 * are always single-line, so a one-line window is sufficient.
 *
 * Returns the char offset of the opening `"` of the expression body if so,
 * else `-1`.
 */
export function expressionBodyOpenQuote(lineText: string, pos: number): number {
  // Walk the text left of the cursor, tracking double-quoted strings. We want
  // the nearest UNCLOSED `"` to the left of `pos` (the open expression body).
  let openQuote = -1;
  let i = 0;
  while (i < pos) {
    const ch = lineText[i];
    if (ch === '"') {
      if (openQuote === -1) {
        openQuote = i; // entering a string
      } else {
        openQuote = -1; // closing a string
      }
    }
    i++;
  }
  if (openQuote === -1) return -1; // not inside any double-quoted string

  // The text from line start up to (not including) the open quote must end in
  // `(condition` or `(constraint assertion` (allowing intervening whitespace).
  const head = lineText.slice(0, openQuote);
  if (/\(\s*condition\s*$/.test(head)) return openQuote;
  if (/\(\s*constraint\s+assertion\s*$/.test(head)) return openQuote;
  return -1;
}

/**
 * Inside the expression body (open quote at `bodyOpen`), is `pos` inside an
 * inner single-quoted `'...'` string literal? Count unescaped `'` between the
 * body-open quote and the cursor; odd ⇒ inside a literal.
 */
export function insideInnerLiteral(lineText: string, bodyOpen: number, pos: number): boolean {
  let count = 0;
  for (let i = bodyOpen + 1; i < pos; i++) {
    if (lineText[i] === "'" && lineText[i - 1] !== '\\') count++;
  }
  return count % 2 === 1;
}

/**
 * Net open-paren depth of `(rule ...)` blocks across `text`. Used only to
 * decide top-level keywords (`rule`/`version`) vs rule-body keywords
 * (`constraint`/`condition`/...). We count every `(` and `)` for depth, and
 * remember whether the form opened at depth 0 was a `rule`. If we are still
 * nested inside that rule form, we are in a body.
 *
 * This is a deliberately small heuristic: it ignores parens that appear inside
 * string literals, which is acceptable because structural completion never
 * fires inside an expression body (gated out before this is consulted) and the
 * surrounding `(rule "name" ...)` wrapper does not contain stray parens in
 * well-formed DRU files.
 */
export function openRuleDepth(text: string): number {
  let depth = 0;
  let inString = false;
  // Stack of booleans: was the form opened at this paren a `rule`?
  const ruleStack: boolean[] = [];
  let ruleOpen = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '(') {
      // Peek the keyword right after `(` (skipping whitespace).
      const rest = text.slice(i + 1);
      const m = /^\s*([A-Za-z_]+)/.exec(rest);
      const isRule = !!m && m[1] === 'rule';
      ruleStack.push(isRule);
      if (isRule) ruleOpen++;
      depth++;
    } else if (ch === ')') {
      depth--;
      const popped = ruleStack.pop();
      if (popped) ruleOpen--;
    }
  }
  return ruleOpen;
}

/**
 * If `head` ends inside a `(constraint <type> ... (` boundary — i.e. the cursor
 * sits right after a freshly opened inner `(` whose enclosing form is a
 * constraint — return `<type>`; else null. Single-line: DRU constraints and
 * their bound groups live on one physical line in practice.
 *
 * The negative lookahead `(?![\s\S]*\(\s*constraint\b)` picks the LAST
 * `(constraint <type>` on the line (no later constraint follows), matching the
 * single-line heuristic the rest of this module uses.
 */
export function enclosingConstraintAtParen(head: string): string | null {
  // head must end at an open inner paren boundary: "... ("  (optionally ws)
  if (!/\(\s*$/.test(head)) return null;
  // The text up to that just-opened paren must contain `(constraint <type>`,
  // and we take the last such constraint on the line.
  const m = /\(\s*constraint\s+([a-z_]+)\b(?![\s\S]*\(\s*constraint\b)/.exec(head);
  if (!m) return null;
  return m[1];
}

// ---- the pure entry point --------------------------------------------------

/**
 * Given a single physical line, the cursor's char offset into it, and the data
 * API, decide what to offer.
 *
 * Returns `[]` when the cursor is not inside a `(condition "...")` /
 * `(constraint assertion "...")` expression body, inside an inner `'...'`
 * literal, or after `L.` (the layer receiver has no members).
 */
export function computeCompletions(
  lineText: string,
  charPositionInString: number,
  api: CompletionApi,
  precedingText = '',
): CompletionEntry[] {
  const pos = Math.max(0, Math.min(charPositionInString, lineText.length));

  // Gate (a): inside an expression body -> existing member/receiver behaviour.
  // OUTSIDE -> STRUCTURAL completion (keywords / constraint types / categories
  // / enums / layers), which can never fire inside an expression body.
  const bodyOpen = expressionBodyOpenQuote(lineText, pos);
  if (bodyOpen === -1) {
    return computeStructuralCompletions(lineText, pos, api, precedingText);
  }

  // Gate (b): bail inside an inner '...' string literal.
  if (insideInnerLiteral(lineText, bodyOpen, pos)) return [];

  const left = lineText.slice(0, pos);

  // Gate (c1): receiver-dot context — `A.`, `B.`, `AB.`, `L.` + partial member.
  const dotMatch = /(\bAB|\b[ABL])\.([A-Za-z0-9_]*)$/.exec(left);
  if (dotMatch) {
    const receiver = dotMatch[1];
    const partial = dotMatch[2];
    const start = pos - partial.length;
    const members = api.membersFor(receiver);
    return members.map((m) => ({ ...m, replace: { start, end: pos } }));
  }

  // Guard: if the char immediately left is a `.` but it did not match a known
  // receiver, we are after some `Foo.` — offer nothing (no nested members).
  const afterDot = /\.([A-Za-z0-9_]*)$/.test(left);
  if (afterDot) return [];

  // Gate (c2): identifier-boundary context — optional bare partial identifier,
  // not preceded by a dot. Offer receivers + `null`.
  const idMatch = /([A-Za-z_][A-Za-z0-9_]*)?$/.exec(left);
  const partial = (idMatch && idMatch[1]) || '';
  const start = pos - partial.length;
  return api.topLevel().map((e) => ({ ...e, replace: { start, end: pos } }));
}

// ---- STRUCTURAL completion (outside condition/assertion strings) -----------

/**
 * Decide what structural vocabulary to offer when the cursor is NOT inside a
 * `(condition "...")` / `(constraint assertion "...")` expression body. The
 * single-line caller is responsible for that gate; this function assumes it.
 *
 * The innermost context is matched by the text strictly left of the partial
 * word under the cursor (`head`). Most-specific first; first match wins:
 *
 *   - after `(constraint disallow ` -> disallow categories (repeatable)
 *   - after `(constraint zone_connection ` -> zone connections
 *   - directly after `(constraint ` -> constraint types
 *   - after `(layer ` -> layer tokens (repeatable, layer-set lists)
 *   - after `(severity ` -> severities
 *   - after `(min|opt|max ` -> nothing (numbers/units are freehand)
 *   - form-start `(` in a rule body -> rule-body keywords
 *   - form-start `(` at top level -> top keywords
 *
 * `precedingText` is document text on prior lines, consulted only by
 * `openRuleDepth` to decide rule-body vs top-level keywords. Lone-line callers
 * pass `''`.
 */
export function computeStructuralCompletions(
  lineText: string,
  charPositionInString: number,
  api: CompletionApi,
  precedingText = '',
): CompletionEntry[] {
  const pos = Math.max(0, Math.min(charPositionInString, lineText.length));

  // Never fire inside an expression body — that region belongs to the member
  // completion above. (Defensive: computeCompletions already gates this.)
  if (expressionBodyOpenQuote(lineText, pos) !== -1) return [];

  const left = lineText.slice(0, pos);

  // Bare partial word under the cursor (`.` and `-` included so layer tokens
  // like `F.C|` / `Edge.Cuts` replace cleanly).
  const partialMatch = /([A-Za-z_][A-Za-z0-9_.\-]*)?$/.exec(left);
  const partial = (partialMatch && partialMatch[1]) || '';
  const start = pos - partial.length;
  const head = left.slice(0, start);

  const place = (
    entries: Omit<CompletionEntry, 'replace'>[],
  ): CompletionEntry[] => entries.map((e) => ({ ...e, replace: { start, end: pos } }));

  // C1: after `(constraint disallow ` (repeatable — head may carry already
  // typed categories before the trailing space).
  if (/\(\s*constraint\s+disallow\b[\sA-Za-z_]*\s$/.test(head)) {
    return place(api.disallowCategories());
  }

  // C2: after `(constraint zone_connection `.
  if (/\(\s*constraint\s+zone_connection\s+$/.test(head)) {
    return place(api.zoneConnections());
  }

  // C3: directly after `(constraint ` (the type slot).
  if (/\(\s*constraint\s+$/.test(head)) {
    return place(api.constraintTypes());
  }

  // C4: after `(layer ` (repeatable for layer-set lists).
  if (/\(\s*layer\s+(?:\S+\s+)*$/.test(head)) {
    return place(api.layerTokens());
  }

  // C5: after `(severity `.
  if (/\(\s*severity\s+$/.test(head)) {
    return place(api.severities());
  }

  // C6: after `(min|opt|max ` — numbers/units are freehand, nothing structural.
  if (/\(\s*(?:min|opt|max)\s+$/.test(head)) {
    return [];
  }

  // C6b: a fresh inner `(` inside a `(constraint <type> ...)` body -> bound
  // keywords (min/opt/max) supported by that type. Placed before C7/C8 so an
  // inner `(` is read as a bound slot, not a rule-body form-start. C6 above
  // already won for `(min `/`(opt `/`(max ` (a bound word + space); C6b fires
  // one level out, when head ends in `(` with no bound word yet.
  const ct = enclosingConstraintAtParen(head);
  if (ct) {
    return place(api.boundsFor(ct));
  }

  // C7/C8: form-start, just after `(` (possibly with a bare partial keyword
  // being retyped). Top-level vs rule-body decided by net open `(rule ...)`
  // depth across the preceding document text + this line's head.
  if (/\(\s*$/.test(head)) {
    const depth = openRuleDepth(precedingText + head);
    return place(depth > 0 ? api.ruleBodyKeywords() : api.topKeywords());
  }

  return [];
}
