/* No framework, no CDN, no inline HTML from model/tool output. */
(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const transcript = new DshTranscript();
  const markdown = window.markdownit({ html: false, linkify: true, typographer: false });
  // No remote image loading from model output; retain the image's descriptive text.
  markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content || '图片');
  let connected = false,
    pending = false,
    session = '',
    scheduled = false;
  const expanded = new Set();
  const icons = {
    plus: '<path d="M8 2v12M2 8h12"/>',
    history: '<circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/>',
    more: '<circle cx="3" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="13" cy="8" r=".6"/>',
    copy: '<rect x="5" y="5" width="8" height="9" rx="1"/><path d="M3 11H2V2h8v1"/>',
    context: '<circle cx="8" cy="8" r="2.5"/><path d="M10.5 5.5v4a1.5 1.5 0 0 0 3 0V8a5.5 5.5 0 1 0-3.5 5.1"/>',
    send: '<path d="m2 2 12 6-12 6 2-6-2-6Zm2 6h10"/>',
    stop: '<rect x="4" y="4" width="8" height="8" rx="1"/>'
  };
  const post = (type, data = {}) => vscode.postMessage({ type, ...data });
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  function button(icon, label, action) {
    const b = el('button', 'icon');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${icons[icon]}</svg>`;
    b.onclick = action;
    return b;
  }
  const app = document.getElementById('app');
  const toolbar = el('header', 'toolbar');
  toolbar.append(el('span', 'brand', 'DEEPSEEK HARNESS'));
  const newButton = button('plus', '新建会话', () => post('new'));
  const historyButton = button('history', '历史会话', () => post('history'));
  toolbar.append(
    newButton,
    historyButton,
    button('more', '查看运行日志', () => post('logs'))
  );
  const taskbar = el('div', 'taskbar'),
    title = el('div', 'title', '新会话'),
    connection = el('div', 'connection connecting');
  const statusText = el('span', '', '正在连接…');
  connection.append(el('span', 'dot'), statusText);
  taskbar.append(el('div', 'task-label', '当前任务'), title);
  const feed = el('main', 'transcript');
  feed.setAttribute('aria-label', '对话记录');
  const errorbar = el('div', 'errorbar');
  errorbar.hidden = true;
  errorbar.setAttribute('role', 'alert');
  const wrap = el('footer', 'composer-wrap'),
    composer = el('div', 'composer'),
    chips = el('div', 'chips');
  const input = el('textarea');
  input.placeholder = '继续提问，或添加文件上下文…';
  input.setAttribute('aria-label', '消息');
  input.rows = 2;
  input.value = saved.draft || '';
  const bottom = el('div', 'composer-bottom'),
    model = el('button', 'model', 'DeepSeek ⌄');
  model.title = '选择模型';
  model.onclick = () => post('model');
  const send = button('send', '发送消息', () => submit());
  send.classList.add('send');
  bottom.append(
    button('context', '添加文件或当前选区', () => post('attach')),
    model,
    el('span', 'mode', 'Agent')
  );
  const hint = el('div', 'hint');
  hint.append(connection, el('span', 'keys', 'Enter 发送 · Shift Enter 换行'));
  const jump = el('button', 'jump-latest', '↓ 回到最新');
  jump.hidden = true;
  const updateJump = () => {
    jump.hidden = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 70;
  };
  jump.onclick = () => {
    feed.scrollTop = feed.scrollHeight;
    updateJump();
  };
  feed.addEventListener('scroll', updateJump, { passive: true });
  composer.append(chips, input, send);
  wrap.append(jump, composer, bottom, hint);
  const questions = new DshQuestionPanel(post, content, active => {
    composer.hidden = bottom.hidden = active;
    scheduleRender();
  });
  wrap.prepend(questions.node);
  app.append(toolbar, taskbar, feed, errorbar, wrap);
  function controls() {
    const busy = transcript.running || pending;
    input.readOnly = pending;
    send.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${icons[busy ? 'stop' : 'send']}</svg>`;
    send.title = busy ? '停止生成' : '发送消息';
    send.setAttribute('aria-label', send.title);
    send.disabled = !connected || (!busy && !input.value.trim());
    newButton.disabled = historyButton.disabled = !connected || pending;
    model.disabled = !connected || busy;
  }
  const resizeInput = () => {
    input.style.height = '84px';
    input.style.height = Math.min(180, input.scrollHeight) + 'px';
  };
  input.addEventListener('input', () => {
    vscode.setState({ draft: input.value });
    resizeInput();
    controls();
  });
  let composerWidth = 0;
  new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width !== composerWidth) {
      composerWidth = width;
      resizeInput();
    }
  }).observe(composer);
  const submit = () => {
    if (transcript.running || pending) {
      post('stop');
      return;
    }
    if (!connected || !input.value.trim()) return;
    pending = true;
    errorbar.hidden = true;
    post('send', { text: input.value.trim() });
    controls();
    render();
  };
  send.onclick = submit;
  input.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!pending && !transcript.running) submit();
    }
  };
  function content(text) {
    const node = el('div', 'content');
    // markdown-it escapes raw HTML and validates link schemes. Only its output enters innerHTML.
    node.innerHTML = markdown.render(String(text));
    for (const anchor of node.querySelectorAll('a')) {
      const target = anchor.getAttribute('href');
      anchor.title = target;
      anchor.onclick = event => {
        event.preventDefault();
        post('openLink', { target });
      };
    }
    for (const table of node.querySelectorAll('table')) {
      const scroll = el('div', 'table-scroll');
      table.replaceWith(scroll);
      scroll.append(table);
    }
    for (const pre of node.querySelectorAll('pre')) {
      const code = pre.querySelector('code');
      if (!code) continue;
      const block = el('div', 'code-block'),
        header = el('div', 'code-header');
      const lang = code.className.replace(/^language-/, '') || '代码';
      const copy = el('button', '', '复制');
      copy.onclick = () => post('copy', { text: code.textContent });
      header.append(el('span', '', lang), copy);
      pre.replaceWith(block);
      block.append(header, pre);
    }
    return node;
  }
  function userContent(text) {
    const [prompt, ...contexts] = text.split('\n\n--- 附加上下文 ---\n');
    const node = el('div', 'user-content');
    node.append(el('div', 'content', prompt));
    for (const [index, value] of contexts.entries()) {
      const path = value.match(/文件：([^\n]+)/)?.[1] || '引用代码';
      const lines = value.match(/行号：([^\n]+)/)?.[1];
      const label = path.split(/[\\/]/).pop() + (lines ? ` · ${lines}` : '');
      const quote = details(`quote-${path}-${index}`, 'quoted-code', label);
      quote.append(el('pre', '', value));
      node.append(quote);
    }
    return node;
  }
  function details(id, cls, label) {
    const d = el('details', cls);
    d.open = expanded.has(id);
    const s = el('summary', '', label);
    d.append(s);
    d.ontoggle = () => {
      if (!d.isConnected) return;
      if (d.open) expanded.add(id);
      else expanded.delete(id);
    };
    return d;
  }
  function render() {
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 70;
    const position = feed.scrollTop;
    feed.replaceChildren();
    const rows = transcript.rows();
    if (!rows.length && !pending) {
      const empty = el('div', 'empty');
      empty.append(el('h2', '', '今天想完成什么？'), el('p', '', '选中编辑器里的代码即可引用，也可以添加文件，开始一个任务。'));
      const examples = el('div', 'suggestions');
      for (const value of ['解释这段代码', '检查潜在问题']) {
        const b = el('button', '', value);
        b.onclick = () => {
          input.value = value;
          input.dispatchEvent(new Event('input'));
          input.focus();
        };
        examples.append(b);
      }
      empty.append(examples);
      feed.append(empty);
    }
    if (transcript.hasMore) feed.append(el('div', 'older', '当前显示最近的消息'));
    let previousRole = '';
    for (const row of rows) {
      if (row.role === 'notice') {
        feed.append(el('div', 'notice', row.text));
        continue;
      }
      if (row.role === 'tool') {
        const tool = details(row.id, 'tool', '');
        const summary = tool.firstChild;
        summary.append(
          el('span', row.state === 'error' ? 'error' : 'check', row.state === 'done' ? '✓' : row.state === 'error' ? '!' : '·'),
          el('span', 'label', row.name + (row.path ? `  ${row.path.split(/[\\/]/).pop()}` : '')),
          el('small', '', row.state === 'running' ? '执行中' : row.state === 'error' ? '失败' : '完成')
        );
        tool.append(el('pre', '', row.result || row.args || '等待工具返回…'));
        feed.append(tool);
        for (const [index, diff] of (row.diffs || []).entries()) {
          const card = el('section', 'diff');
          const header = el('header');
          header.append(el('span', '', diff.path || row.path || '文件变更'));
          card.append(header);
          if (typeof diff.oldText === 'string') card.append(el('pre', 'removed', diff.oldText));
          if (typeof diff.newText === 'string') card.append(el('pre', 'added', diff.newText));
          const open = el('button', 'diff-link', '查看差异 ↗');
          open.onclick = () => post('diff', { id: `${row.resultSeq}:${index}` });
          card.append(open);
          feed.append(card);
        }
        previousRole = 'assistant';
        continue;
      }
      const turn = el('section', `turn ${row.role}`);
      if (previousRole !== row.role) turn.append(el('div', 'role', row.role === 'user' ? '你' : 'DeepSeek'));
      if (row.reasoning) {
        const reason = details(`r-${row.id}`, 'reason', row.live ? '正在思考…' : '思考过程');
        reason.append(content(row.reasoning));
        turn.append(reason);
      }
      if (row.text) turn.append(row.role === 'user' ? userContent(row.text) : content(row.text));
      if (row.interrupted) turn.append(el('div', 'notice', '已停止'));
      if (row.role === 'assistant' && row.text && !row.live) {
        const actions = el('div', 'actions');
        actions.append(button('copy', '复制回复', () => post('copy', { text: row.text })));
        turn.append(actions);
      }
      feed.append(turn);
      previousRole = row.role;
    }
    if (pending || transcript.running)
      feed.append(el('div', 'working', questions.current ? '等待你回答…' : pending ? '正在发送…' : '正在处理…'));
    if (transcript.title) title.textContent = transcript.title;
    model.textContent = transcript.model + ' ⌄';
    model.title = '选择模型 · ' + transcript.model;
    if (nearBottom) feed.scrollTop = feed.scrollHeight;
    else feed.scrollTop = position;
    controls();
    updateJump();
  }
  function scheduleRender() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        render();
      });
    }
  }
  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'questions') {
      questions.update(m.sessionId, m.items || []);
      return;
    }
    if (m.type === 'questionError') {
      questions.fail(m.eventId, m.message);
      return;
    }
    if (m.type === 'status') {
      connected = m.status === 'ready';
      connection.className = `connection ${m.status}`;
      statusText.textContent = m.label;
      statusText.title = m.label;
    }
    if (m.type === 'session') {
      session = m.id;
      questions.update(session, []);
      transcript.reset();
      expanded.clear();
      title.textContent = '新会话';
      errorbar.hidden = true;
    }
    if (m.type === 'frame') {
      transcript.apply(m.value);
    }
    if (m.type === 'accepted') {
      pending = false;
      input.value = '';
      resizeInput();
      vscode.setState({ draft: '' });
      title.textContent = m.title || '当前会话';
    }
    if (m.type === 'model') transcript.model = m.label;
    if (m.type === 'error') {
      pending = false;
      errorbar.replaceChildren(el('span', '', m.message));
      const b = el('button', '', '日志');
      b.onclick = () => post('logs');
      errorbar.append(b);
      errorbar.hidden = false;
    }
    if (m.type === 'attachments') {
      chips.replaceChildren();
      for (const item of m.items) {
        const chip = el('div', `chip${item.automatic ? ' auto-context' : ''}${item.tooLarge ? ' too-large' : ''}`);
        const label = el('button', 'context-label', item.label);
        label.title = `${item.automatic ? '自动引用选区（发送时附带）' : '已引用代码'}\n${item.detail || ''}\n\n${item.preview || ''}`;
        label.onclick = () => post('revealContext', { id: item.id });
        chip.append(label);
        const remove = el('button', '', '×');
        remove.title = '移除 ' + item.label;
        remove.setAttribute('aria-label', remove.title);
        remove.onclick = () => post('removeAttachment', { id: item.id });
        chip.append(remove);
        chips.append(chip);
      }
      input.placeholder = m.items.some(i => i.automatic) ? '针对选中的代码提问…' : '继续提问，或添加文件上下文…';
    }
    scheduleRender();
  });
  render();
  controls();
  post('ready');
})();
