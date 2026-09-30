import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { DshProcessManager } from './dsh/process';
import { DshRpcClient } from './dsh/rpc';
import { DshRemoteMux } from './dsh/mux';
import { DshQuestions } from './dsh/questions';
import { Json } from './dsh/protocol';
import { EditorContext } from './editor-context';
import { openCodeLink } from './code-links';

export function activate(context: vscode.ExtensionContext): void {
  const runtime = new DshProcessManager();
  const output = vscode.window.createOutputChannel('DeepSeek Harness');
  let connection: Promise<{ rpc: DshRpcClient; mux: DshRemoteMux; questions: DshQuestions }> | undefined;
  let current: Awaited<NonNullable<typeof connection>> | undefined;
  let view: vscode.WebviewView | undefined;
  let activeSession = context.workspaceState.get<string>('activeSession');
  let unsubscribe: (() => void) | undefined;
  let generation = 0;
  let queue = Promise.resolve();
  const diffs = new Map<string, { path: string; oldText: string; newText: string }>();
  const diffDocuments = new Map<string, string>();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('dsh-diff', {
      provideTextDocumentContent(uri) {
        return diffDocuments.get(uri.toString()) || '';
      }
    })
  );
  const collectDiffs = (value: Json) => {
    const frame = value as any;
    const records = frame.type === 'snapshot' ? frame.records : frame.type === 'event' ? [frame] : [];
    for (const record of records || []) {
      const event = record.event;
      if (event?.type !== 'tool/result') continue;
      for (const [index, diff] of (event.data?.meta?.diffs || []).entries()) {
        if (
          typeof diff.path === 'string' &&
          typeof diff.newText === 'string' &&
          (diff.oldText === null || typeof diff.oldText === 'string')
        ) {
          diffs.set(`${event.seq}:${index}`, { ...diff, oldText: diff.oldText || '' });
        }
      }
    }
  };
  const send = (value: object) => {
    void view?.webview.postMessage(value);
  };
  const pushQuestions = () => send({ type: 'questions', sessionId: activeSession, items: current?.questions.items(activeSession) || [] });
  let codeContext: EditorContext;
  const pushContext = () => {
    if (codeContext) send({ type: 'attachments', items: codeContext.summary() });
  };
  codeContext = new EditorContext(pushContext);
  context.subscriptions.push(codeContext);
  const fail = (error: unknown) => {
    const message = (error instanceof Error ? error.message : String(error)).replace(/([?&]token=)[^\s]+/g, '$1[redacted]');
    output.appendLine(`${new Date().toISOString()} ${message}`);
    send({ type: 'error', message });
  };
  const connect = () => {
    if (!connection) {
      send({ type: 'status', status: 'connecting', label: '正在连接…' });
      connection = runtime
        .start()
        .then(async endpoint => {
          const rpc = new DshRpcClient(endpoint),
            mux = new DshRemoteMux(endpoint);
          const questions = new DshQuestions(rpc, mux, pushQuestions, fail);
          current = { rpc, mux, questions };
          if (activeSession) questions.track(activeSession);
          await questions.start();
          output.appendLine(`Runtime connected: ${endpoint.origin}`);
          send({ type: 'status', status: 'ready', label: hostname() });
          return current;
        })
        .catch(error => {
          current?.questions.dispose();
          current?.mux.close();
          current = undefined;
          connection = undefined;
          throw error;
        });
    }
    return connection;
  };
  const subscribe = async (id: string) => {
    const token = ++generation;
    unsubscribe?.();
    unsubscribe = undefined;
    const { mux } = await connect();
    activeSession = id;
    current!.questions.track(id);
    diffs.clear();
    await context.workspaceState.update('activeSession', id);
    send({ type: 'session', id });
    pushQuestions();
    const dispose = await mux.follow(
      id,
      value => {
        if (token === generation) {
          collectDiffs(value);
          send({ type: 'frame', value });
        }
      },
      fail
    );
    if (token !== generation) dispose();
    else unsubscribe = dispose;
  };
  const newSession = async () => {
    const { rpc } = await connect();
    const { sessionId } = await rpc.create(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
    await subscribe(sessionId);
  };
  const enqueue = (action: () => Promise<void>) => {
    queue = queue.then(action).catch(fail);
    return queue;
  };
  const chooseHistory = async () => {
    const { rpc } = await connect();
    const { items } = await rpc.list();
    const titles = context.workspaceState.get<Record<string, string>>('titles', {});
    const pick = await vscode.window.showQuickPick(
      items
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(item => ({
          label: titles[item.sessionId] || `会话 ${item.sessionId.replace('session-', '').slice(0, 8)}`,
          description: item.running ? '运行中' : new Date(item.updatedAt).toLocaleString(),
          detail: item.cwd,
          id: item.sessionId
        })),
      { placeHolder: '搜索并切换会话' }
    );
    if (pick) await subscribe(pick.id);
  };
  const selectModel = async () => {
    const { rpc } = await connect();
    if (!activeSession) await newSession();
    const catalog = await rpc.call<{ groups: { id: string; name: string; models: { id: string; name: string }[] }[] }>(
      'session/modelCatalog',
      {},
      ''
    );
    const pick = await vscode.window.showQuickPick(
      catalog.groups.flatMap(g => g.models.map(m => ({ label: m.name, description: g.name, provider: g.id, model: m.id }))),
      { placeHolder: '选择此会话使用的模型' }
    );
    if (pick) {
      await rpc.call('session/selectModel', { sessionId: activeSession!, provider: pick.provider, model: pick.model });
      send({ type: 'model', label: pick.label });
    }
  };
  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider(
      'dshNative.chat',
      {
        resolveWebviewView(resolved) {
          view = resolved;
          resolved.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
          resolved.webview.onDidReceiveMessage(
            (message: {
              type: string;
              text?: string;
              id?: string;
              target?: string;
              sessionId?: string;
              eventId?: string;
              answers?: unknown;
            }) => {
              const submittedContext = message.type === 'send' ? codeContext.items() : [];
              if (message.type === 'stop') {
                if (activeSession)
                  void connect()
                    .then(c => c.rpc.cancel(activeSession!))
                    .catch(fail);
                return;
              }
              void enqueue(async () => {
                switch (message.type) {
                  case 'answerQuestion':
                  case 'cancelQuestion': {
                    try {
                      if (!activeSession || message.sessionId !== activeSession || !message.eventId)
                        throw new Error('提问不属于当前会话。');
                      const { questions } = await connect();
                      await questions.answer(activeSession, message.eventId, message.answers, message.type === 'cancelQuestion');
                    } catch (error) {
                      send({
                        type: 'questionError',
                        eventId: message.eventId,
                        message: error instanceof Error ? error.message : String(error)
                      });
                    }
                    break;
                  }
                  case 'ready':
                    await connect();
                    send({ type: 'status', status: 'ready', label: hostname() });
                    if (activeSession) await subscribe(activeSession);
                    pushContext();
                    pushQuestions();
                    break;
                  case 'new':
                    await newSession();
                    break;
                  case 'history':
                    await chooseHistory();
                    break;
                  case 'attach':
                    await codeContext.choose();
                    break;
                  case 'removeAttachment':
                    codeContext.remove(message.id || '');
                    break;
                  case 'revealContext':
                    await codeContext.reveal(message.id || '');
                    break;
                  case 'openLink':
                    if (message.target) await openCodeLink(message.target);
                    break;
                  case 'copy':
                    if (message.text) await vscode.env.clipboard.writeText(message.text);
                    break;
                  case 'model':
                    await selectModel();
                    break;
                  case 'logs':
                    output.show();
                    break;
                  case 'diff': {
                    const diff = diffs.get(message.id || '');
                    if (!diff) throw new Error('这个变更已不在当前会话中，请重新打开会话。');
                    const key = randomUUID();
                    const before = vscode.Uri.parse(`dsh-diff:/${key}/before`),
                      after = vscode.Uri.parse(`dsh-diff:/${key}/after`);
                    diffDocuments.set(before.toString(), diff.oldText);
                    diffDocuments.set(after.toString(), diff.newText);
                    await vscode.commands.executeCommand('vscode.diff', before, after, `${diff.path} · 变更片段`);
                    break;
                  }
                  case 'send': {
                    if (!message.text?.trim()) return;
                    const { rpc, questions } = await connect();
                    if (!questions.ready) throw new Error('提问通道正在重新连接，请稍后发送。');
                    if (!activeSession) await newSession();
                    if (submittedContext.some(a => a.preview.length > 60_000))
                      throw new Error('当前选区超过 60000 字符，请缩小选区或移除引用。');
                    const text = message.text + submittedContext.map(a => `\n\n--- 附加上下文 ---\n${a.text}`).join('');
                    await rpc.prompt(activeSession!, text);
                    const titles = context.workspaceState.get<Record<string, string>>('titles', {});
                    if (!titles[activeSession!]) {
                      titles[activeSession!] = message.text.slice(0, 40);
                      await context.workspaceState.update('titles', titles);
                    }
                    send({ type: 'accepted', title: titles[activeSession!] });
                    codeContext.clearSent(submittedContext);
                    break;
                  }
                }
              });
            },
            undefined,
            context.subscriptions
          );
          const nonce = randomUUID().replace(/-/g, '');
          const resource = (file: string) => resolved.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', file));
          resolved.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${resolved.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${resource('sidebar.css')}"></head><body><div id="app"></div><script nonce="${nonce}" src="${resource('markdown-it.min.js')}"></script><script nonce="${nonce}" src="${resource('transcript.js')}"></script><script nonce="${nonce}" src="${resource('questions.js')}"></script><script nonce="${nonce}" src="${resource('sidebar.js')}"></script></body></html>`;
        }
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  context.subscriptions.push(vscode.commands.registerCommand('dshNative.newSession', () => enqueue(newSession)));
  context.subscriptions.push(
    vscode.commands.registerCommand('dshNative.addSelection', async () => {
      try {
        codeContext.pinSelection();
        await vscode.commands.executeCommand('dshNative.chat.focus');
        pushContext();
      } catch (error) {
        fail(error);
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('dshNative.stop', () => activeSession && connect().then(c => c.rpc.cancel(activeSession!)))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('dshNative.restart', () =>
      enqueue(async () => {
        ++generation;
        unsubscribe?.();
        current?.mux.close();
        runtime.stop();
        current = undefined;
        connection = undefined;
        await connect();
        if (activeSession) await subscribe(activeSession);
      })
    )
  );
  context.subscriptions.push({
    dispose: () => {
      ++generation;
      unsubscribe?.();
      current?.mux.close();
      runtime.stop();
    }
  });
}
