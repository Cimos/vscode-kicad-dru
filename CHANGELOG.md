# Changelog

All notable changes to the **KiCad Custom Design Rules** extension are
documented here. Format follows [Keep a Changelog](https://keepachangelog.com/);
this extension adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Diagnostics (structural tier). Red squiggles + Problems entries for
  definite mistakes only: unbalanced parentheses, unterminated strings,
  missing / duplicate / non-integer `(version …)` header, unknown top-level
  or rule-body keywords, unknown constraint types (with a case hint),
  unknown sub-forms inside a constraint, invalid `severity` / `disallow` /
  `zone_connection` values, and a unit suffix on a unitless constraint
  (`track_angle`, `via_count`, `min_resolved_spokes`,
  `solder_paste_rel_margin`). New setting `kicad-dru.diagnostics`
  (`all` | `errors` | `off`, default `all`). Every shipped fixture and
  snippet is asserted diagnostic-free in CI.
- Data: `bridged_mask`, `solder_mask_expansion`, `solder_mask_sliver`,
  `solder_paste_abs_margin`, `solder_paste_rel_margin`, `via_dangling` now
  carry `since: 10` (they ship in KiCad 10.0.0; were mislabelled 11).
  `return_path` added to the constraint catalogue (KiCad 11 / master) so
  completion and hover know it.

## [0.1.1] - 2026-10-25

- Fix: the minimap no longer shows a large text label for nearly every line.
  The language configuration's `(`/`)` folding markers were being rendered
  as minimap region headers. Folding now matches balanced parentheses
  (ignoring strings and `#` comments), one fold per multi-line s-expression.
- Fix: folding treats `#` as a comment only when it starts the line (after
  optional whitespace), matching KiCad's lexer and the grammar.

## [0.1.0] - 2026-06-24

- IntelliSense completion. Inside `(condition "…")` / `(constraint
  assertion "…")` strings: receiver members after `A.`/`B.`/`AB.`, and
  receivers + functions at an identifier boundary. While writing rule
  structure: constraint types after `(constraint `, layer names after
  `(layer `, severities after `(severity `, categories after `(constraint
  disallow `, and the structural keywords. Each item carries type/units or
  argument shape and a short doc.
- Hover help: hover a constraint type, property, function, layer, severity,
  or disallow category for its description and argument/type.
- The extension is now activated (`onLanguage:kicad-dru`) and esbuild-bundled.
  Completion and hover read a single `data/api.json` stamped with the KiCad
  version and audit date. The completion/hover logic lives in pure,
  vscode-free modules covered by unit tests (`npm run test:unit`, part of
  `npm test`).
- Distinct function highlighting and the publish-workflow PAT-guard fix (from
  the prior review) ship together with the above.

## [0.0.2] - 2026-06-21

- CI: a Test workflow runs the grammar snapshot tests (`npm test`) on every
  push and pull request, so grammar regressions are caught before merge.
- **Retargeted to KiCad 10 stable** (10.0.0 shipped 2026-03-20; the 9.0 line
  ended at 9.0.9). Constraint/function membership re-verified against the
  `10.0.0` source tag.
- Grammar test harness: `vscode-tmgrammar-snap` snapshots lock the
  tokenisation of every fixture under `tests/fixtures/` (`npm test`), so
  grammar edits can't silently regress colouring.
- Snippets added for the constraints that were master-only on KiCad 9 and
  shipped in KiCad 10 stable: `solder_mask_expansion`, `solder_mask_sliver`,
  `solder_paste_abs_margin`, `solder_paste_rel_margin`, `via_dangling`
  (no value), `bridged_mask` (no value). The `through_via` / `blind_via`
  disallow keywords are likewise stable in KiCad 10 (already offered by the
  `disallow` snippet).
- Grammar recognition of the **KiCad 11 / master** net-chain family —
  constraints `net_chain_length`, `stub_length`, `return_path` (the latter
  with its `(layer "…")` / `(net "…")` sub-clauses), and functions
  `inNetChain`, `hasNetChain`, `inNetChainClass`. These are **not** in
  KiCad 10.0.0 stable (a 10.0.0 DRC parser rejects them), so they are
  highlighted by the grammar but deliberately kept OUT of the snippet set —
  the current grammar-vs-snippet isolation boundary.
- Initial syntax highlighting for `.kicad_dru` files: rule blocks,
  constraints, conditions with `A.`/`B.` accessors and operators, layers,
  severities, disallow categories, comments, strings, numbers with units.
- Snippets for the common rule patterns (clearance, disallow, length,
  via and track sizing, hole-to-hole, assertion).
- Language configuration: `#` line comments, paren matching, paren-based
  folding, auto-closing pairs.
