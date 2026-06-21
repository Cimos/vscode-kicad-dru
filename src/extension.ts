import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildApi,
  computeCompletions,
  type ApiData,
  type CompletionApi,
  type CompletionEntry,
  type EntryKind,
} from './completion';
import { computeHover } from './hover';

/**
 * Extension entry point. The only `vscode`-coupled file.
 *
 * On activation (`onLanguage:kicad-dru`) it loads `data/api.json` once,
 * builds the injected {@link CompletionApi}, and registers a
 * CompletionItemProvider. All decision-making lives in the pure
 * `computeCompletions` (see `src/completion.ts`); this adapter only supplies
 * the physical line text + cursor column and maps results to
 * `vscode.CompletionItem`s.
 */

const KIND_MAP: Record<EntryKind, vscode.CompletionItemKind> = {
  receiver: vscode.CompletionItemKind.Variable,
  property: vscode.CompletionItemKind.Property,
  function: vscode.CompletionItemKind.Function,
  keyword: vscode.CompletionItemKind.Keyword,
  constraintType: vscode.CompletionItemKind.Keyword,
  disallowCategory: vscode.CompletionItemKind.EnumMember,
  zoneConnection: vscode.CompletionItemKind.EnumMember,
  severity: vscode.CompletionItemKind.EnumMember,
  layerToken: vscode.CompletionItemKind.Constant,
};

function toItem(e: CompletionEntry, lineNumber: number): vscode.CompletionItem {
  const item = new vscode.CompletionItem(e.label, KIND_MAP[e.kind]);
  item.detail = e.detail;
  item.documentation = new vscode.MarkdownString(e.doc);
  item.sortText = e.sortText;
  item.range = new vscode.Range(lineNumber, e.replace.start, lineNumber, e.replace.end);
  if (e.insertText) {
    item.insertText = new vscode.SnippetString(e.insertText); // functions seed `('$1')`
  }
  return item;
}

function loadApi(context: vscode.ExtensionContext): { api: CompletionApi; data: ApiData } {
  const apiPath = path.join(context.extensionPath, 'data', 'api.json');
  const raw = fs.readFileSync(apiPath, 'utf8');
  const data = JSON.parse(raw) as ApiData;
  // `api` powers completion; the raw `data` powers hover (which reads the
  // property/function/vocab lists directly). Loaded once, shared by both.
  return { api: buildApi(data), data };
}

export function activate(context: vscode.ExtensionContext): void {
  let api: CompletionApi;
  let data: ApiData;
  try {
    ({ api, data } = loadApi(context));
  } catch (err) {
    // If the data payload is missing/corrupt, fail soft: the grammar and
    // snippets still work; completion simply offers nothing.
    console.error('[kicad-dru] failed to load data/api.json:', err);
    return;
  }

  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      const line = document.lineAt(position.line).text;
      const col = position.character;
      // Prior lines feed structural rule-depth (top-level vs rule-body
      // keywords); ignored inside expression bodies.
      const preceding =
        position.line > 0
          ? document.getText(new vscode.Range(0, 0, position.line, 0))
          : '';
      const entries = computeCompletions(line, col, api, preceding);
      return entries.map((e) => toItem(e, position.line));
    },
  };

  // Trigger on '.' (receiver dot) and letters/underscore for in-string member
  // completion, plus '(' and ' ' so the STRUCTURAL slots (constraint types,
  // disallow categories, layers, severities, keywords) pop outside strings.
  const triggerChars = [
    '.',
    '_',
    '(',
    ' ',
    ...'abcdefghijklmnopqrstuvwxyz'.split(''),
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ];

  // Hover provider — pure decision-making lives in `computeHover`
  // (src/hover.ts); this adapter supplies the line text + cursor column + the
  // shared `data` and maps the markdown + range onto a `vscode.Hover`.
  const hoverProvider: vscode.HoverProvider = {
    provideHover(document, position) {
      const line = document.lineAt(position.line).text;
      const col = position.character;
      const preceding =
        position.line > 0
          ? document.getText(new vscode.Range(0, 0, position.line, 0))
          : '';
      const result = computeHover(line, col, data, preceding);
      if (!result) return null;
      return new vscode.Hover(
        new vscode.MarkdownString(result.contents),
        new vscode.Range(position.line, result.range.start, position.line, result.range.end),
      );
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'kicad-dru' },
      provider,
      ...triggerChars,
    ),
    vscode.languages.registerHoverProvider({ language: 'kicad-dru' }, hoverProvider),
  );
}

export function deactivate(): void {
  // Disposables are tracked on context.subscriptions; nothing else to clean up.
}
