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

function loadApi(context: vscode.ExtensionContext): CompletionApi {
  const apiPath = path.join(context.extensionPath, 'data', 'api.json');
  const raw = fs.readFileSync(apiPath, 'utf8');
  const data = JSON.parse(raw) as ApiData;
  return buildApi(data);
}

export function activate(context: vscode.ExtensionContext): void {
  let api: CompletionApi;
  try {
    api = loadApi(context);
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
      const entries = computeCompletions(line, col, api);
      return entries.map((e) => toItem(e, position.line));
    },
  };

  // Trigger on '.' (receiver dot) plus the letters/underscore so completion
  // pops as the user types an identifier inside the expression body.
  const triggerChars = [
    '.',
    '_',
    ...'abcdefghijklmnopqrstuvwxyz'.split(''),
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ];

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'kicad-dru' },
      provider,
      ...triggerChars,
    ),
  );
}

export function deactivate(): void {
  // Disposables are tracked on context.subscriptions; nothing else to clean up.
}
