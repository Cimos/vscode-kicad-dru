# Changelog

All notable changes to the **KiCad Custom Design Rules** extension are
documented here. Format follows [Keep a Changelog](https://keepachangelog.com/);
this extension adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Grammar test harness: `vscode-tmgrammar-snap` snapshots lock the
  tokenisation of every fixture under `tests/fixtures/` (`npm test`), so
  grammar edits can't silently regress colouring.
- KiCad 10 net-chain / high-speed support in the **grammar**: constraints
  `net_chain_length`, `stub_length`, and `return_path` (the latter with its
  `(layer "…")` / `(net "…")` sub-clauses), plus functions `inNetChain`,
  `hasNetChain`, `inNetChainClass`. These are highlighted but not yet added
  to the snippet set, pending confirmation against the exact KiCad 10.0.0
  tag (the same conservative isolation already applied to master-only
  constraints). NOTE: KiCad 10.0.0 shipped 2026-03-20 — the snippet set and
  docs still describe "KiCad 9 stable" and should be retargeted to KiCad 10
  in a follow-up.
- Initial syntax highlighting for `.kicad_dru` files: rule blocks,
  constraints, conditions with `A.`/`B.` accessors and operators, layers,
  severities, disallow categories, comments, strings, numbers with units.
- Snippets for the common rule patterns (clearance, disallow, length,
  via and track sizing, hole-to-hole, assertion).
- Language configuration: `#` line comments, paren matching, paren-based
  folding, auto-closing pairs.
- Snippets target KiCad 9 stable. Master-only constraints
  (`solder_mask_expansion`, `solder_mask_sliver`,
  `solder_paste_abs_margin`, `solder_paste_rel_margin`, `via_dangling`,
  `bridged_mask`) are still highlighted by the grammar but are not in the
  snippet set — they would be rejected by KiCad 9's *Check Rule Syntax*.
  The `through_via` and `blind_via` disallow keywords are likewise
  master-only.
