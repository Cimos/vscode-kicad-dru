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
      constraintTypesCache = vocabEntries(
        data.constraints,
        'constraintType',
        '0',
        (v) => v.args ?? 'constraint type',
      );
    }
    return constraintTypesCache;
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

  // C7/C8: form-start, just after `(` (possibly with a bare partial keyword
  // being retyped). Top-level vs rule-body decided by net open `(rule ...)`
  // depth across the preceding document text + this line's head.
  if (/\(\s*$/.test(head)) {
    const depth = openRuleDepth(precedingText + head);
    return place(depth > 0 ? api.ruleBodyKeywords() : api.topKeywords());
  }

  return [];
}
