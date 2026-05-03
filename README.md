# KiCad Custom Design Rules — VS Code extension

Syntax highlighting and snippets for KiCad **Custom Design Rule** files
(`.kicad_dru`) in Visual Studio Code.

KiCad ships a single-line textbox in *Board Setup → Custom Rules* and a
*Check Rule Syntax* button. That works for one-liners. For real rule sets
you want a real editor — multi-cursor, search, and colour that distinguishes
`condition` operators from `A.NetClass` accessors from layer names from
string literals. This extension adds that for `.kicad_dru` specifically.

## Features

- **Syntax highlighting** scoped to `.kicad_dru`. Keywords (`version`,
  `rule`, `constraint`, `condition`, `layer`, `severity`, `disallow`),
  constraint types (`clearance`, `hole_clearance`, `track_width`,
  `length`, `assertion`, …), token-expression accessors (`A.NetClass`,
  `B.intersectsArea`, …), operators, layer names, severities, comments,
  strings, and numbers with units are all coloured distinctly.
- **Snippets** for the common rule shapes: starter `rule` block, clearance
  by netclass, disallow, length matching, via and track sizing,
  hole-to-hole, assertion. Type the prefix in a paren context, accept,
  tab through.
- **Editor niceties**: `#` line comment toggling, paren matching, folding
  on each top-level `(rule …)` block, auto-closing pairs.

## What this extension does *not* do

- It is a **highlighter**, not a validator. KiCad's own *Check Rule Syntax*
  button remains the source of truth for whether a rule is valid.
- It does not parse `.kicad_pcb`, `.kicad_sch`, `.kicad_sym`, or any other
  KiCad file. Those have other extensions (`DanielMeza.kicad-syntax-
  highlighter` covers most of them; `oaslananka.kicadstudio` covers KiCad
  workflows end-to-end). This extension intentionally stays focused on
  `.kicad_dru` so that DRU support is first-class instead of incidental.
- It does not provide hover docs, completion, or diagnostics. Those are
  potential future additions and are tracked against later versions.

## Installation

From the VS Code Marketplace:

```
ext install cimos.kicad-dru
```

Or search for **"KiCad Custom Design Rules"** in the Extensions view.

A `.vsix` is also attached to each GitHub release if you prefer manual
installation:

```
code --install-extension vscode-kicad-dru-<version>.vsix
```

## Use with KiCad's External Tools menu

KiCad ≥ 7 supports launching an external editor on a file via
*Preferences → Configure Paths → External Tools*. Pointing it at VS Code
gives you a one-click round trip from the KiCad PCB editor to this
extension's editor view. Save the file in VS Code, switch back to KiCad,
and re-run *Check Rule Syntax*.

## Contributing

Pull requests are welcome — especially for grammar gaps you hit on a real
rule file. Please attach a minimal `.kicad_dru` snippet that demonstrates
the issue.

Issues: <https://github.com/Cimos/vscode-kicad-dru/issues>

## License

[MIT](LICENSE.md).
