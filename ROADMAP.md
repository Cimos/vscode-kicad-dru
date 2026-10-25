# Roadmap

Status as of 2026-10-25: **v0.2.0 shipped** via GitHub Releases. The extension
highlights `.kicad_dru` files for KiCad 10 stable (grammar also covers KiCad 11
/ master tokens), ships 47 snippets, offers completion + hover from a single
audited `data/api.json`, flags definite mistakes as diagnostics, and has a
CI-gated grammar snapshot + unit test suite.

Legend: ✅ done · 🔜 next · 📋 later · ♻ ongoing

| Version | Milestone | Status |
|---|---|---|
| v0.0.1 | TextMate grammar, 47 snippets, language configuration | ✅ |
| v0.0.2 | Snapshot test harness; CI test-gate; publish-CI hardening; KiCad 10 retarget; icon-only package; shipped via GitHub Releases | ✅ |
| v0.1.0 | IntelliSense completion (expression + structural + bound + value-literal) and hover help; activated esbuild extension — GitHub issue #1 | ✅ |
| v0.1.1 | Minimap/folding fix: paren-matching FoldingRangeProvider replaces the `(`/`)` folding markers that rendered as minimap section headers | ✅ |
| v0.2.0 | Diagnostics: structural errors (parens, version header, unknown keywords / constraint types, bad enums, units on unitless) + vocabulary warnings (unknown properties / functions, deprecated aliases, non-canonical layers, master-only tokens); `kicad-dru.diagnostics` setting | ✅ |
| v0.2.x | Wider hover / completion coverage; quick-fixes for case-hint diagnostics; `# region` minimap headers; polish | 📋 |
| — | Marketplace + Open VSX distribution (blocked on Azure DevOps PAT) | 📋 |
| — | Re-audit the language/property reference against the KiCad 10.0.0 source | 📋 |
| — | Minor grammar polish; tag deprecated `inside*` / `memberOf` functions | 📋 |
| — | Re-audit the DRU language on each KiCad release (KiCad 11 in dev) | ♻ |

## Where we are

v0.2.0 — diagnostics — is shipped. Completion, hover and diagnostics are all
pure, unit-tested modules driven by `data/api.json`; `src/extension.ts` is the
only `vscode`-coupled file; the grammar stays locked by CI snapshot + assertion
tests, and a corpus guard asserts every fixture and snippet is diagnostic-free.
Next is v0.2.x polish and the Marketplace / Open VSX unblock.

## v0.1.0 — completion provider (the next jump)

Tracked as GitHub issue #1. Turns the static extension into an activated one:

1. Lock the grammar with snapshot tests — done in v0.0.2.
2. Extract the DRU expression API into a single `data/api.json`, stamped with
   the KiCad version and audit date, instead of duplicating it into code.
3. Scaffold a TypeScript `extension.js` + `onLanguage:kicad-dru` activation +
   esbuild bundle.
4. Implement the completion provider: receivers (`A` `B` `AB` `L`) → property
   accessors → the registered functions, each with a docstring and a version
   tag, skipping the lexer-unreachable hyphen/`%` properties.
5. Unit tests for the provider; manual round-trip through KiCad's Check Rule
   Syntax.
6. Reverse the README "no completion" wording; bump to v0.1.0.

## v0.1.x — hover docs

Reuses the `data/api.json` and activation from v0.1.0 to show type, units, and
return value on hover. Low marginal cost once the provider exists.

## v0.2+ — diagnostics / semantic validation

In-editor checking of rule validity (constraint and condition well-formedness),
possibly via a language server. Out of the original v1 scope; pursue only if the
highlighter gains traction. A tree-sitter grammar is a v2+ option if the
TextMate grammar reaches its expressiveness ceiling.

## Distribution

v0.0.2 ships through GitHub Releases (download the `.vsix`, install with
`code --install-extension`). The VS Code Marketplace is gated on an Azure
DevOps PAT the maintainer account can't currently create; Open VSX needs an
`OVSX_PAT`. `publish.yml` already skips both cleanly when the PATs are absent,
so wiring either up later is just adding the secret.

## Maintenance cadence

Re-verify the DRU language (constraints, functions, units, disallow keywords)
against each KiCad release and re-stamp the audit date. KiCad 11 is in
development; its net-chain family is already recognised by the grammar and will
move into the snippet set once 11 ships stable.
