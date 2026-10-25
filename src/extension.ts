import * as vscode from 'vscode';
import apiJson from '../data/api.json';
import {
  buildApi,
  computeCompletions,
  type ApiData,
  type CompletionApi,
  type CompletionEntry,
  type EntryKind,
} from './completion';
import { computeHover } from './hover';
import { computeFoldingRanges } from './folding';
import { computeDiagnostics, type Diag, type Level } from './diagnostics';
import { computeSymbols, type DruSymbol, type SymbolKind } from './symbols';
import { formatDocument } from './format';
import {
  REVIEW_URL,
  applyChoice,
  recordActivation,
  shouldPrompt,
  type RatingChoice,
  type RatingState,
} from './rating';

/**
 * Extension entry point. The only `vscode`-coupled file.
 *
 * `data/api.json` is bundled into this file by esbuild (no filesystem access),
 * so the same build runs on desktop and in the browser (vscode.dev /
 * github.dev). On activation (`onLanguage:kicad-dru`) it builds the injected
 * {@link CompletionApi} and registers the providers. All decision-making lives
 * in the pure modules (`completion`, `hover`, `diagnostics`, `symbols`,
 * `format`, `folding`, `rating`); this adapter only supplies document text /
 * positions and maps results onto `vscode` types.
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
  value: vscode.CompletionItemKind.Value,
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

const SYMBOL_KIND: Record<SymbolKind, vscode.SymbolKind> = {
  version: vscode.SymbolKind.Number,
  rule: vscode.SymbolKind.Class,
  constraint: vscode.SymbolKind.Property,
  condition: vscode.SymbolKind.Boolean,
  layer: vscode.SymbolKind.Enum,
  severity: vscode.SymbolKind.EnumMember,
};

const toRange = (r: { start: { line: number; col: number }; end: { line: number; col: number } }): vscode.Range =>
  new vscode.Range(r.start.line, r.start.col, r.end.line, r.end.col);

function toSymbol(s: DruSymbol): vscode.DocumentSymbol {
  const sym = new vscode.DocumentSymbol(s.name, s.detail, SYMBOL_KIND[s.kind], toRange(s.range), toRange(s.selectionRange));
  sym.children = s.children.map(toSymbol);
  return sym;
}

export function activate(context: vscode.ExtensionContext): void {
  registerRatingPrompt(context);

  const selector: vscode.DocumentSelector = { language: 'kicad-dru' };
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges(document) {
        return computeFoldingRanges(document.getText()).map(
          (r) => new vscode.FoldingRange(r.start, r.end, r.kind === 'region' ? vscode.FoldingRangeKind.Region : undefined),
        );
      },
    }),
    // Outline panel, breadcrumbs, Go to Symbol (Ctrl+Shift+O).
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(document) {
        return computeSymbols(document.getText()).map(toSymbol);
      },
    }),
    // Format Document. A file with parse errors comes back unchanged.
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits(document, options) {
        const text = document.getText();
        const formatted = formatDocument(text, { tabSize: options.tabSize, insertSpaces: options.insertSpaces });
        if (formatted === text) return [];
        const all = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
        return [vscode.TextEdit.replace(all, formatted)];
      },
    }),
  );

  // `api` powers completion; the raw `data` powers hover and diagnostics
  // (which read the property/function/vocab lists directly).
  const data = apiJson as unknown as ApiData;
  const api: CompletionApi = buildApi(data);

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

  registerDiagnostics(context, data);
}

/**
 * Diagnostics adapter — pure decision-making lives in `computeDiagnostics`
 * (src/diagnostics.ts). Validates every open `.kicad_dru` document on open,
 * on change (debounced), and when the `kicad-dru.diagnostics` setting flips.
 */
function registerDiagnostics(context: vscode.ExtensionContext, data: ApiData): void {
  const collection = vscode.languages.createDiagnosticCollection('kicad-dru');
  const SEVERITY = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
  } as const;
  const level = (): Level =>
    vscode.workspace.getConfiguration('kicad-dru').get<Level>('diagnostics', 'all');

  // The quick fix travels with the diagnostic object VS Code hands back to the
  // code-action provider, so nothing is recomputed when the lightbulb opens.
  const fixes = new WeakMap<vscode.Diagnostic, NonNullable<Diag['fix']>>();

  const validate = (doc: vscode.TextDocument): void => {
    if (doc.languageId !== 'kicad-dru') return;
    const items = computeDiagnostics(doc.getText(), data, level()).map((d) => {
      const item = new vscode.Diagnostic(toRange(d.range), d.message, SEVERITY[d.severity]);
      item.source = 'kicad-dru';
      item.code = d.code;
      if (d.fix) fixes.set(item, d.fix);
      return item;
    });
    collection.set(doc.uri, items);
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'kicad-dru' },
      {
        provideCodeActions(document, _range, ctx) {
          const actions: vscode.CodeAction[] = [];
          for (const diag of ctx.diagnostics) {
            const fix = fixes.get(diag);
            if (!fix) continue;
            const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
            action.edit = new vscode.WorkspaceEdit();
            for (const e of fix.edits) action.edit.replace(document.uri, toRange(e.range), e.newText);
            action.diagnostics = [diag];
            action.isPreferred = true;
            actions.push(action);
          }
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (doc: vscode.TextDocument): void => {
    if (doc.languageId !== 'kicad-dru') return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      validate(doc);
    }, 300));
  };

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      collection.delete(doc.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('kicad-dru.diagnostics')) {
        vscode.workspace.textDocuments.forEach(validate);
      }
    }),
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },
  );
  vscode.workspace.textDocuments.forEach(validate);
}

const RATING_KEY = 'kicad-dru.rating';

/**
 * Rating toast adapter — policy lives in `src/rating.ts`. State is kept in
 * `globalState` and synced, so "Don't ask again" follows the user across
 * machines. The `kicad-dru.rate` command shows the same toast on demand
 * (Command Palette: "KiCad DRU: Rate this extension"), which is also how the
 * toast is smoke-tested without waiting out the quiet period.
 */
function registerRatingPrompt(context: vscode.ExtensionContext): void {
  context.globalState.setKeysForSync([RATING_KEY]);
  const read = (): RatingState | undefined => context.globalState.get<RatingState>(RATING_KEY);
  const write = (s: RatingState): Thenable<void> => context.globalState.update(RATING_KEY, s);

  const BUTTONS: Record<string, RatingChoice> = {
    'Rate it': 'rate',
    'Later': 'later',
    "Don't ask again": 'never',
  };

  const show = async (): Promise<void> => {
    const picked = await vscode.window.showInformationMessage(
      'Enjoying KiCad Custom Design Rules? A quick rating on the Marketplace helps other KiCad users find it.',
      ...Object.keys(BUTTONS),
    );
    const choice = picked ? BUTTONS[picked] : undefined;
    const state = read() ?? recordActivation(undefined, Date.now());
    await write(applyChoice(state, choice, Date.now()));
    if (choice === 'rate') {
      await vscode.env.openExternal(vscode.Uri.parse(REVIEW_URL));
    }
  };

  context.subscriptions.push(vscode.commands.registerCommand('kicad-dru.rate', show));

  const now = Date.now();
  const state = recordActivation(read(), now);
  void write(state).then(() => {
    if (shouldPrompt(state, now)) void show();
  });
}

export function deactivate(): void {
  // Disposables are tracked on context.subscriptions; nothing else to clean up.
}
