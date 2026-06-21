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

export interface ApiData {
  receivers: string[];
  properties: ApiProperty[];
  functions: ApiFunction[];
}

// ---- public completion-entry types (no vscode dependency) ------------------

export type EntryKind = 'receiver' | 'property' | 'function' | 'keyword';

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
}

// ---- detail / doc formatting -----------------------------------------------

function propertyDetail(p: ApiProperty): string {
  return p.units ? `${p.type} (${p.units})` : p.type;
}

function functionDetail(f: ApiFunction): string {
  // e.g. "intersectsArea('name') -> bool"
  return `${f.args} -> ${f.returns}`;
}

function withNotes(doc: string, opts: { since?: string; deprecated?: boolean }): string {
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

  return { receivers: data.receivers.slice(), membersFor, topLevel };
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
function expressionBodyOpenQuote(lineText: string, pos: number): number {
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
function insideInnerLiteral(lineText: string, bodyOpen: number, pos: number): boolean {
  let count = 0;
  for (let i = bodyOpen + 1; i < pos; i++) {
    if (lineText[i] === "'" && lineText[i - 1] !== '\\') count++;
  }
  return count % 2 === 1;
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
): CompletionEntry[] {
  const pos = Math.max(0, Math.min(charPositionInString, lineText.length));

  // Gate (a): must be inside an expression body.
  const bodyOpen = expressionBodyOpenQuote(lineText, pos);
  if (bodyOpen === -1) return [];

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
