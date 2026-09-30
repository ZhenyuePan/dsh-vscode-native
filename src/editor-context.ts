import * as vscode from 'vscode';
import { randomUUID } from 'crypto';

export type CodeContext = {
  id: string;
  label: string;
  text: string;
  uri: vscode.Uri;
  startLine: number;
  endLine: number;
  preview: string;
  automatic?: boolean;
};

/** Retains the last real code editor when focus moves into a Webview or Quick Pick. */
export class EditorContext implements vscode.Disposable {
  private editor?: vscode.TextEditor;
  private automatic?: CodeContext;
  private suppressed?: string;
  private readonly manual = new Map<string, CodeContext>();
  private readonly subscriptions: vscode.Disposable[] = [];
  constructor(private readonly changed: () => void) {
    this.capture(
      vscode.window.activeTextEditor || (vscode.window.visibleTextEditors.length === 1 ? vscode.window.visibleTextEditors[0] : undefined)
    );
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(editor => this.capture(editor)),
      vscode.window.onDidChangeTextEditorSelection(event => this.capture(event.textEditor)),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.editor?.document.uri.toString() === event.document.uri.toString()) this.capture(this.editor);
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (this.editor?.document === document) {
          this.editor = undefined;
          this.automatic = undefined;
          this.changed();
        }
      })
    );
  }
  private capture(editor: vscode.TextEditor | undefined) {
    if (!editor || !['file', 'vscode-remote', 'untitled'].includes(editor.document.uri.scheme)) return;
    this.editor = editor;
    const selected = editor.selections.filter(s => !s.isEmpty);
    this.automatic = selected.length ? this.make(editor.document, selected, true) : undefined;
    this.changed();
  }
  private make(document: vscode.TextDocument, ranges?: readonly vscode.Selection[], automatic = false): CodeContext {
    const name = vscode.workspace.asRelativePath(document.uri);
    const parts = ranges?.length
      ? ranges.map(r => ({
          start: r.start.line + 1,
          end: r.end.character === 0 && r.end.line > r.start.line ? r.end.line : r.end.line + 1,
          startColumn: r.start.character + 1,
          endColumn: r.end.character + 1,
          text: document.getText(r)
        }))
      : [{ start: 1, end: document.lineCount, startColumn: 1, endColumn: 1, text: document.getText() }];
    const total = parts.map(p => p.text).join('\n');
    const startLine = parts[0].start,
      endLine = parts[parts.length - 1].end;
    const label = `${name.split(/[\\/]/).pop()}${ranges?.length ? `:${startLine}${endLine !== startLine ? `–${endLine}` : ''}` : ''}`;
    // Include document version and selected text in identity, so removal suppresses only this selection.
    const id = automatic
      ? `selection:${document.uri.toString()}:${document.version}:${JSON.stringify(parts.map(({ start, end, startColumn, endColumn }) => [start, end, startColumn, endColumn]))}`
      : randomUUID();
    const code = parts.map(p => `行号：${p.start}–${p.end}，起始列：${p.startColumn}\n<code>\n${p.text}\n</code>`).join('\n\n');
    return {
      id,
      uri: document.uri,
      label,
      startLine,
      endLine,
      automatic,
      preview: total,
      text: `来源：${automatic || ranges?.length ? '用户在编辑器中选中的代码' : '用户引用的文件'}\n文件：${document.uri.fsPath}\n工作区相对路径：${name}\n语言：${document.languageId}\n${code}`
    };
  }
  items(): CodeContext[] {
    const auto = this.automatic && this.automatic.id !== this.suppressed ? [this.automatic] : [];
    return [...auto, ...this.manual.values()];
  }
  summary() {
    return this.items().map(({ id, label, text, preview, automatic }) => ({
      id,
      label,
      automatic,
      detail: text.split('\n<code>')[0],
      preview: preview.slice(0, 3000),
      tooLarge: preview.length > 60_000
    }));
  }
  remove(id: string) {
    if (id === this.automatic?.id) this.suppressed = id;
    else this.manual.delete(id);
    this.changed();
  }
  clearSent(items: CodeContext[]) {
    for (const item of items) this.manual.delete(item.id);
    this.changed();
  }
  pinSelection() {
    if (!this.automatic) throw new Error('请先在编辑器中选择代码。');
    if (this.automatic.preview.length > 60_000) throw new Error('引用超过 60000 字符，请缩小选区。');
    const item = { ...this.automatic, id: randomUUID(), automatic: false };
    this.suppressed = this.automatic.id;
    this.manual.set(item.id, item);
    this.changed();
  }
  async choose() {
    // Snapshot before the picker opens: opening it can clear activeTextEditor.
    const editor = this.editor;
    const selected = editor?.selections.filter(s => !s.isEmpty);
    const selection = editor && selected?.length ? this.make(editor.document, selected) : undefined;
    const document = editor?.document;
    const pick = await vscode.window.showQuickPick(['当前选区', '当前文件', '选择文件…'], { placeHolder: '引用代码到下一条消息' });
    let item: CodeContext | undefined;
    if (pick === '当前选区') {
      if (!selection) throw new Error('请先在编辑器中选择代码。');
      if (this.automatic) {
        this.suppressed = undefined;
        this.changed();
        return;
      }
      item = selection;
    } else if (pick === '当前文件') {
      if (!document) throw new Error('请先打开一个代码文件。');
      item = this.make(document);
    } else if (pick === '选择文件…') {
      const uris = await vscode.window.showOpenDialog({ canSelectMany: false });
      if (!uris?.[0]) return;
      const stat = await vscode.workspace.fs.stat(uris[0]);
      if (stat.size > 300_000) throw new Error('文件过大，请打开后选择需要的代码。');
      item = this.make(await vscode.workspace.openTextDocument(uris[0]));
    }
    if (!item) return;
    if (item.preview.length > 60_000) throw new Error('引用超过 60000 字符，请缩小选区。');
    this.manual.set(item.id, item);
    this.changed();
  }
  async reveal(id: string) {
    const item = this.items().find(i => i.id === id);
    if (!item) return;
    const document = await vscode.workspace.openTextDocument(item.uri);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const range = new vscode.Range(item.startLine - 1, 0, Math.min(item.endLine - 1, document.lineCount - 1), 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }
  dispose() {
    this.subscriptions.forEach(s => s.dispose());
  }
}
