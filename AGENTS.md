# AGENTS.md

**Read these before any change, in this order:**

1. [`./.claude/agents/core.md`](./.claude/agents/core.md) — review posture: aggressive at every corner, no flattery, verify before claiming, push back on bad framing.
2. [`./.claude/agents/workflow.md`](./.claude/agents/workflow.md) — diagnostic patterns, ask-for-data, no-sloppy-reads.
3. [`CLAUDE.md`](./CLAUDE.md) — repo entry point and full overlay file list.
4. [`./.claude/docs/overview.md`](./.claude/docs/overview.md) — product context: what the extension is, problem, users.
5. [`./.claude/docs/workflow.md`](./.claude/docs/workflow.md) — project-specific conventions: what "exercised" means, branching, commit hygiene, release flow.
6. [`./.claude/docs/kicad-dru-language.md`](./.claude/docs/kicad-dru-language.md) — verified `.kicad_dru` language reference. Mandatory before any grammar/snippet/completion edit.
7. [`./.claude/docs/kicad-dru-property-registry.md`](./.claude/docs/kicad-dru-property-registry.md) — verified `A.Foo` property / function registry. Mandatory before adding completion or hover entries.
8. [`./.claude/docs/issues.md`](./.claude/docs/issues.md) — local issue tracker.

Other overlay docs (`kicad-dru-evaluator.md`, `kicad-dru-language-audit.md`, `prior-art.md`,
`testing-notes.md`) are referenced from `CLAUDE.md` and read on demand.

**If `.claude/agents/` or `.claude/docs/` is missing or empty, the maintainer overlay isn't
installed on this clone.** Announce partial context to the user and proceed with care. The
overlay source of truth is the private `agent-context` repo at `E:\git\Projects\agent-context`
(host-local); installation steps are in `CLAUDE.md`.

## Review mode

Aggressive reviewer at every corner. No "Great question," no "should be straightforward,"
no closing recap of what the user just read. Disagree explicitly when you disagree. Tag
technical claims `[verified]` / `[deduced]` / `[guess]`; don't ship `[guess]`. Push back on
the user when their framing is wrong, when their request risks a destructive action, when
a better alternative exists. Full rules: [`./.claude/agents/core.md`](./.claude/agents/core.md).

## TL;DR for agents

- This is a **VS Code extension** (TypeScript + a TextMate grammar) targeting KiCad
  `.kicad_dru` files — syntax highlighting, snippets, hover, completion in scope.
- Target dialect: **KiCad 10 stable** (10.0.0 shipped 2026-03-20). Snippets must round-trip
  through KiCad 10's *Check Rule Syntax*. Master-only / KiCad-11-dev constructs (the net-chain
  family: `net_chain_length`, `stub_length`, `return_path`, `inNetChain`, `hasNetChain`,
  `inNetChainClass`) are highlighted by the grammar but kept OUT of the snippet set. Do not
  regress that isolation. NOTE: the KiCad-9-era "master-only" set (`solder_mask_expansion`,
  `solder_mask_sliver`, `solder_paste_abs_margin`, `solder_paste_rel_margin`, `via_dangling`,
  `bridged_mask`, and the `through_via`/`blind_via` disallow keywords) all shipped in 10.0.0
  and are now snippet-eligible.
- Verified facts about the DRU language live in `.claude/docs/kicad-dru-language.md` and
  `.claude/docs/kicad-dru-property-registry.md`. Last re-audited 2026-05-03 against KiCad master;
  constraint/function membership re-verified 2026-06-20 against the `10.0.0` tag and master.
  Re-run the audit (per `kicad-dru-language-audit.md`) before any edit that depends on parser
  line numbers or version-specific behaviour.
- Automated tests: `npm test` runs `vscode-tmgrammar-snap` snapshots over `tests/fixtures/`.
  Regenerate with `npm run test:update` and review the diff after any grammar change. Also
  exercise manually per `.claude/docs/testing-notes.md`
  before committing.
- Maintainer identity is **Cimos / cimos** — that's the public publishing handle, not personal
  data. Real personal-data scrub targets are `simon` / `simad` / `cubepilot` / `hex` /
  `proficnc`; see auto-memory `identity_scrub.md`.
