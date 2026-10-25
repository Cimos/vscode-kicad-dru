/**
 * PURE folding logic for `.kicad_dru` files.
 *
 * Replaces the old `folding.markers` regex pair (`\(` / `\)`) in
 * language-configuration.json. Marker folding is meant for `#region`-style
 * comment lines: VS Code renders every marker-start line as a minimap section
 * header (`editor.minimap.showRegionSectionHeaders`), so a `\(` marker turned
 * nearly every line of a DRU file into a large minimap label. It also folded
 * per line, not per balanced s-expression.
 *
 * Instead, match parentheses properly: skip `"..."` strings (condition and
 * assertion bodies carry their own parens) and `#` line comments, and emit one
 * range per multi-line `( ... )` pair. No dependency on `vscode`; exercised by
 * `tests/unit/folding.test.mjs` via `dist/folding.mjs`.
 */

export interface FoldRange {
  /** 0-based line of the opening paren. */
  start: number;
  /** 0-based line of the closing paren. */
  end: number;
}

export function computeFoldingRanges(text: string): FoldRange[] {
  const ranges: FoldRange[] = [];
  const open: number[] = []; // line numbers of unmatched '('
  let line = 0;
  let inString = false;
  let inComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      line++;
      inComment = false;
      continue;
    }
    if (inComment) continue;
    if (inString) {
      if (ch === '\\') i++; // skip escaped char (never a newline in practice)
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '#') inComment = true;
    else if (ch === '(') open.push(line);
    else if (ch === ')') {
      const start = open.pop();
      // A pair closing on the same line it opened has nothing to fold.
      if (start !== undefined && line > start) ranges.push({ start, end: line });
    }
  }

  return ranges;
}
