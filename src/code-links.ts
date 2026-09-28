import * as vscode from 'vscode';
import * as path from 'path';

export async function openCodeLink(target: string): Promise<void> {
  if (/^https?:\/\//i.test(target)) { await vscode.env.openExternal(vscode.Uri.parse(target)); return; }
  if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) throw new Error('不支持此链接类型。');
  const decoded = decodeURIComponent(target);
  const match = decoded.match(/(?:#L?(\d+)(?:[-:]L?(\d+))?|:(\d+)(?::(\d+))?)$/);
  const file = match ? decoded.slice(0, match.index) : decoded;
  const line = Number(match?.[1] || match?.[3] || 1), end = Number(match?.[2] || line);
  if (!file || file.includes('\0') || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(end) || end < 1) throw new Error('文件引用无效。');
  const roots = vscode.workspace.workspaceFolders || [];
  const candidates = path.isAbsolute(file) ? [file] : roots.map(root => path.resolve(root.uri.fsPath, file));
  const files = candidates.filter(candidate => roots.some(root => {
    const rel = path.relative(root.uri.fsPath, candidate); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  }));
  for (const candidate of files) {
    let document: vscode.TextDocument;
    try { document = await vscode.workspace.openTextDocument(vscode.Uri.file(candidate)); } catch { continue; }
    const start = Math.min(line - 1, document.lineCount - 1), last = Math.min(Math.max(end - 1, start), document.lineCount - 1);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const range = new vscode.Range(start, 0, last, document.lineAt(last).text.length);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter); return;
  }
  throw new Error('无法在当前工作区打开该文件引用。');
}
