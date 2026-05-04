# CLAUDE.md

A focused VS Code extension for KiCad **Custom Design Rules** (`.kicad_dru`)
files. Public on GitHub at `Cimos/vscode-kicad-dru`; published to the VS Code
Marketplace as `cimos.kicad-dru`.

**Before any change, load the maintainer overlay if installed:**

- [`./.claude/agents/core.md`](./.claude/agents/core.md) — universal review posture: aggressive at every corner, no flattery, verify before claiming, push back on bad framing.
- [`./.claude/agents/workflow.md`](./.claude/agents/workflow.md) — diagnostic patterns, ask-for-data, no-sloppy-reads.
- [`./.claude/docs/overview.md`](./.claude/docs/overview.md) — what this extension is, the problem it solves, users, scope.
- [`./.claude/docs/workflow.md`](./.claude/docs/workflow.md) — project-specific conventions: what "exercised" means here, branching, commit hygiene, release flow.
- [`./.claude/docs/kicad-dru-language.md`](./.claude/docs/kicad-dru-language.md) — `.kicad_dru` language reference, verified against KiCad master sources.
- [`./.claude/docs/kicad-dru-language-audit.md`](./.claude/docs/kicad-dru-language-audit.md) — audit refreshing every parser-line citation in the language reference (last run 2026-05-03).
- [`./.claude/docs/kicad-dru-evaluator.md`](./.claude/docs/kicad-dru-evaluator.md) — DRU expression interpreter architecture & lifecycle (the engine behind `condition "..."` / `constraint assertion "..."`).
- [`./.claude/docs/kicad-dru-property-registry.md`](./.claude/docs/kicad-dru-property-registry.md) — exhaustive `A.Foo` property / function registry. Read before adding completion or hover entries.
- [`./.claude/docs/prior-art.md`](./.claude/docs/prior-art.md) — catalogue of existing KiCad/EDA editor extensions and what they do (or don't) cover.
- [`./.claude/docs/testing-notes.md`](./.claude/docs/testing-notes.md) — manual exercise procedure (no automated tests in v0.0.x).
- [`./.claude/docs/issues.md`](./.claude/docs/issues.md) — local issue tracker (maintainer to-do; GitHub Issues is for external bug reports).

**If `.claude/agents/` or `.claude/docs/` is missing or empty, the maintainer overlay isn't
installed on this clone.** Announce partial context to the user and proceed with care — this
public CLAUDE.md is upstream-worthy guidance only; agent rules and project-specific context
live in the overlay. Source of truth is the private `agent-context` repo at
`E:\git\Projects\agent-context` (host-local). To install the overlay on a fresh clone:

```powershell
cd E:\git\Projects\agent-context\bootstrap
.\bootstrap.ps1 -Project KiCAD-DRU-Highlighter
```

After bootstrap, both `.claude/agents/` and `.claude/docs/` are populated (and gitignored
in this repo). Source of truth stays in `agent-context`; edit there and re-run bootstrap
to refresh.

## Memory

If anything comes up in conversation that seems important — user preferences,
project decisions, blockers, references to external systems, surprising
context that won't be obvious from the code or git log — save it to the
auto-memory system following the conventions in the system prompt (typed
memory file in the project's memory directory + one-line entry in
`MEMORY.md`).

Err on the side of saving. A near-duplicate of an existing memory should
update that memory rather than create a new one. Anything derivable from
the current code, git history, or already-documented in this file does
**not** belong in memory.
