# Changelog

All notable changes to the **KiCad Custom Design Rules** extension are
documented here. Format follows [Keep a Changelog](https://keepachangelog.com/);
this extension adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
