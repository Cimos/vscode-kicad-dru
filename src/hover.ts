/**
 * PURE hover logic for `.kicad_dru` files.
 *
 * Like {@link computeCompletions}, this module has NO dependency on `vscode`.
 * It is exercised directly by `node --test` (see `tests/unit/hover.test.mjs`)
 * via the esbuild ESM bundle (`dist/hover.mjs`). The extension adapter
 * (`src/extension.ts`) feeds it the physical line text + cursor column and the
 * already-parsed `data/api.json`, then maps the returned markdown + range onto
 * a `vscode.Hover`.
 *
 * Data is INJECTED, never duplicated. Detail/doc formatting and the
 * string-vs-structural gate are reused verbatim from `completion.ts` so hover
 * help reads identically to completion help and the two can never disagree.
 */

import {
  type ApiData,
  type ApiProperty,
  type ApiFunction,
  type ApiVocab,
  propertyDetail,
  functionDetail,
  withNotes,
  expressionBodyOpenQuote,
  insideInnerLiteral,
  openRuleDepth,
  enclosingConstraintAtParen,
} from './completion';

// ---- operator name table (language-fixed; no data dependency) ---------------

const OPERATOR_NAMES: Record<string, [string, string]> = {
  '==': ['equal to', 'Comparison: true when both sides are equal.'],
  '!=': ['not equal to', 'Comparison: true when the sides differ.'],
  '<': ['less than', 'Comparison.'],
  '>': ['greater than', 'Comparison.'],
  '<=': ['less than or equal to', 'Comparison.'],
  '>=': ['greater than or equal to', 'Comparison.'],
  '&&': ['logical AND', 'True when both operands are true.'],
  '||': ['logical OR', 'True when either operand is true.'],
  '!': ['logical NOT', 'Negates the following boolean.'],
  '+': ['addition', 'Arithmetic.'],
  '-': ['subtraction', 'Arithmetic (or unary negation).'],
  '*': ['multiplication', 'Arithmetic.'],
  '/': ['division', 'Arithmetic.'],
};

// ---- public types ----------------------------------------------------------

export interface HoverResult {
  /** Markdown body for the hover popup. */
  contents: string;
  /** [start, end) char offsets on the line of the resolved token. */
  range: { start: number; end: number };
}

// ---- markdown rendering -----------------------------------------------------

/**
 * Shared hover body: a fenced `kicad-dru` title line, an optional detail line,
 * then the documentation (which already carries since/deprecated notes from
 * {@link withNotes}). Empty sections are dropped so a bare keyword still reads
 * cleanly.
 */
function renderHover(title: string, detail: string, doc: string): string {
  const parts: string[] = ['```kicad-dru\n' + title + '\n```'];
  if (detail) parts.push(detail);
  if (doc) parts.push(doc);
  return parts.join('\n\n');
}

// ---- the pure entry point ---------------------------------------------------

/**
 * Resolve the token under the cursor on `lineText` to hover help, or `null`.
 *
 * Mirrors the completion gate: when the cursor is inside a
 * `(condition "...")` / `(constraint assertion "...")` expression body the
 * token is resolved against properties / functions / receivers / `null`; when
 * it is outside, the token is resolved against the structural vocabulary
 * (keywords, constraint types, disallow categories, zone connections,
 * severities, layer tokens), keyed by the same context regexes that drive
 * structural completion.
 *
 * `precedingText` is document text on prior lines, consulted only by
 * {@link openRuleDepth} to disambiguate top-of-file keywords (`rule`,
 * `version`) from rule-body keywords (`constraint`, `condition`, ...). Lone-
 * line callers pass `''`.
 */
export function computeHover(
  lineText: string,
  charPositionInString: number,
  data: ApiData,
  precedingText = '',
): HoverResult | null {
  const pos = Math.max(0, Math.min(charPositionInString, lineText.length));

  // KiCad `#` comments are line-start-only, so a comment line is entirely a
  // comment — nothing on it is hoverable. (A mid-line `#` is NOT a comment.)
  if (/^\s*#/.test(lineText)) return null;

  // ---- token resolution: find the word span containing the cursor ----
  // Tokens are identifier-like runs (dotted accessors and layer names keep
  // their `.`; property names may carry `%`/`-`). Operators are recognised so
  // we can deliberately return null on them. The span that contains `pos`
  // wins; a cursor exactly at a token's right edge counts as inside it.
  // Property-name class intentionally excludes '-': a glued "A.X-2" must not
  // absorb the '-' (it would shadow operator hover, and a hyphenated property
  // is lexer-unreachable anyway). The '-' is still recognised as an operator.
  const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_.%]*|==|!=|<=|>=|&&|\|\||[<>!+\-*/]/g;
  let token: string | null = null;
  let start = -1;
  let end = -1;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(lineText)) !== null) {
    const s = m.index;
    const e = m.index + m[0].length;
    if (pos >= s && pos <= e) {
      token = m[0];
      start = s;
      end = e;
      break;
    }
    if (s > pos) break; // tokens are left-to-right; nothing further can contain pos
  }
  if (token === null) return null;

  const range = { start, end };

  // Unit suffix glued to a numeric literal: `0.2mm`, `5deg`, `100ps`. These
  // appear both in constraint bodies (`(min 0.2mm)`) and inside expression
  // bodies (`A.Width > 0.2mm`); resolve context-free. The left-of-`start` char
  // being a digit/`.` is the discriminator that stops a bare identifier reading
  // `in`/`ps`/`fs` from shadowing.
  const leftCh = start > 0 ? lineText[start - 1] : '';
  if (/[0-9.]/.test(leftCh) && (data.unitDocs ?? []).some((u) => u.name === token)) {
    const u = (data.unitDocs ?? []).find((u) => u.name === token)!;
    return { contents: renderHover(token, 'unit', u.doc), range };
  }

  const inExpr = expressionBodyOpenQuote(lineText, pos) !== -1;

  if (inExpr) {
    return hoverInExpression(lineText, pos, token, start, range, data);
  }
  return hoverStructural(lineText, token, start, range, data);
}

// ---- in-string (expression body) resolution --------------------------------

function hoverInExpression(
  lineText: string,
  pos: number,
  token: string,
  tokenStart: number,
  range: { start: number; end: number },
  data: ApiData,
): HoverResult | null {
  // Never document the contents of an inner '...' literal (layer/net/zone
  // names) — symmetric with the completion gate.
  const bodyOpen = expressionBodyOpenQuote(lineText, pos);
  if (bodyOpen !== -1 && insideInnerLiteral(lineText, bodyOpen, pos)) return null;

  // Operators are meaningful only inside an expression body (conditions /
  // assertions); document them from the static table.
  if (OPERATOR_NAMES[token]) {
    const [name, doc] = OPERATOR_NAMES[token];
    return { contents: renderHover(token, name, doc), range };
  }

  // A dotted accessor member `<recv>.<name>`: if the cursor is over the member
  // part, resolve it as a property or function. The token regex captured the
  // whole `A.Net_Class`; split on the last `.`.
  const dot = token.lastIndexOf('.');
  if (dot > 0) {
    const recv = token.slice(0, dot);
    const member = token.slice(dot + 1);
    const memberStart = tokenStart + dot + 1;
    if (pos >= memberStart) {
      // member side: property first (receiver-aware), else function.
      const prop = findProperty(data, member, recv);
      if (prop) {
        return {
          contents: renderHover(
            `${recv}.${prop.name}`,
            propertyDetail(prop),
            withNotes(prop.doc, prop),
          ),
          range: { start: memberStart, end: range.end },
        };
      }
      const fn = findFunction(data, member);
      if (fn) {
        return {
          contents: renderHover(
            functionDetail(fn),
            '',
            withNotes(fn.doc, fn),
          ),
          range: { start: memberStart, end: range.end },
        };
      }
      return null;
    }
    // cursor on the receiver side of the dotted token: fall through to the
    // bare-receiver handling using just the receiver run.
    const recvResult = receiverHover(data, recv);
    if (recvResult) {
      return { contents: recvResult, range: { start: tokenStart, end: tokenStart + recv.length } };
    }
    return null;
  }

  // Bare token. Receiver / null keyword.
  const recvResult = receiverHover(data, token);
  if (recvResult) return { contents: recvResult, range };

  if (token === 'null') {
    return {
      contents: renderHover(
        'null',
        'null literal',
        'The `null` literal — compare against optional (`int?` / `double?`) properties that may be unset.',
      ),
      range,
    };
  }

  // A bare function call (no receiver), e.g. `intersectsArea('a')`.
  const fn = findFunction(data, token);
  if (fn) {
    return {
      contents: renderHover(functionDetail(fn), '', withNotes(fn.doc, fn)),
      range,
    };
  }

  return null;
}

function receiverHover(data: ApiData, token: string): string | null {
  if (!data.receivers.includes(token)) return null;
  const doc =
    token === 'L'
      ? 'Layer receiver — used in `(layer ...)` style comparisons; has no members.'
      : token === 'AB'
        ? 'Both items A and B (e.g. `AB.isCoupledDiffPair()`); same member set as `A`.'
        : token === 'B'
          ? 'The second item in a two-item rule context (e.g. the other side of a `clearance` check); same member set as `A`.'
          : `Receiver for item ${token} in the current rule context.`;
  return renderHover(token, token === 'L' ? 'layer receiver' : 'item receiver', doc);
}

function findProperty(
  data: ApiData,
  name: string,
  receiver: string,
): ApiProperty | undefined {
  // AB shares A's member set; L has no members.
  const eff = receiver === 'AB' ? 'A' : receiver;
  const matches = data.properties.filter((p) => p.name === name);
  if (matches.length === 0) return undefined;
  // Prefer a receiver-matching, reachable entry; fall back to first match so
  // hover still documents a known-but-unreachable property name.
  const reachableForRecv = matches.find(
    (p) => p.reachable && (p.receivers.includes('A') || p.receivers.includes(eff)),
  );
  return reachableForRecv ?? matches.find((p) => p.reachable) ?? matches[0];
}

function findFunction(data: ApiData, name: string): ApiFunction | undefined {
  return data.functions.find((f) => f.name === name);
}

// ---- structural (outside expression body) resolution -----------------------

function hoverStructural(
  lineText: string,
  token: string,
  tokenStart: number,
  range: { start: number; end: number },
  data: ApiData,
): HoverResult | null {
  const head = lineText.slice(0, tokenStart);

  // Context-keyed resolution mirrors the structural-completion regexes. A token
  // sitting in a known slot is documented from that slot's list; failing a slot
  // match we fall back to membership lookups so a keyword/type/enum is still
  // documented wherever it physically appears.

  // disallow categories: after `(constraint disallow ...`.
  if (/\(\s*constraint\s+disallow\b/.test(head)) {
    const hit = findVocab(data.disallowCategories, token);
    if (hit) return vocabResult(hit, 'disallow category', range);
  }

  // zone connection enum: after `(constraint zone_connection `.
  if (/\(\s*constraint\s+zone_connection\b/.test(head)) {
    const hit = findVocab(data.zoneConnections, token);
    if (hit) return vocabResult(hit, 'zone connection', range);
  }

  // constraint type slot: directly after `(constraint `.
  if (/\(\s*constraint\s+$/.test(head)) {
    const hit = findVocab(data.constraints, token);
    if (hit) return constraintResult(hit, range);
  }

  // severity value: after `(severity `.
  if (/\(\s*severity\s+/.test(head)) {
    const hit = findVocab(data.severities, token);
    if (hit) return vocabResult(hit, 'severity', range);
  }

  // layer tokens: after `(layer ...`.
  if (/\(\s*layer\b/.test(head)) {
    const hit = findVocab(data.layers, token);
    if (hit) return vocabResult(hit, 'layer', range);
  }

  // bound keywords min/opt/max: a bound word sitting right after an inner `(`
  // whose enclosing form is a constraint, e.g. `(constraint clearance (min| ...`.
  if (
    (token === 'min' || token === 'opt' || token === 'max') &&
    /\(\s*$/.test(head)
  ) {
    const ct = enclosingConstraintAtParen(head);
    if (ct) {
      const which =
        token === 'min'
          ? 'minimum'
          : token === 'max'
            ? 'maximum'
            : 'optimal/interactive-router default';
      return {
        contents: renderHover(
          token,
          'bound',
          `\`${token}\` bound for the \`${ct}\` constraint — ${which} value.`,
        ),
        range,
      };
    }
  }

  // Context-free membership fallbacks (token documented wherever it appears).
  let hit = findVocab(data.constraints, token);
  if (hit) return constraintResult(hit, range);

  hit = findVocab(data.keywords, token);
  if (hit) {
    const top = isTopKeyword(token);
    return vocabResult(hit, top ? 'keyword' : 'rule-body keyword', range);
  }

  hit = findVocab(data.severities, token);
  if (hit) return vocabResult(hit, 'severity', range);

  hit = findVocab(data.disallowCategories, token);
  if (hit) return vocabResult(hit, 'disallow category', range);

  hit = findVocab(data.zoneConnections, token);
  if (hit) return vocabResult(hit, 'zone connection', range);

  hit = findVocab(data.layers, token);
  if (hit) return vocabResult(hit, 'layer', range);

  // bound keywords are documented under `keywords` if present; otherwise no
  // hover for min/opt/max (they are freehand bound slots).
  return null;
}

function isTopKeyword(name: string): boolean {
  return name === 'version' || name === 'rule';
}

function findVocab(list: ApiVocab[] | undefined, name: string): ApiVocab | undefined {
  return (list ?? []).find((v) => v.name === name);
}

function vocabResult(
  v: ApiVocab,
  detail: string,
  range: { start: number; end: number },
): HoverResult {
  return {
    contents: renderHover(v.name, detail, withNotes(v.doc, v)),
    range,
  };
}

function constraintResult(
  v: ApiVocab,
  range: { start: number; end: number },
): HoverResult {
  // Constraint types carry an arg-shape `args` line, e.g. "(min <len>)".
  const detail = v.args ? `${v.args}` : 'constraint type';
  return {
    contents: renderHover(v.name, detail, withNotes(v.doc, v)),
    range,
  };
}
