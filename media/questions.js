/* Live human-input forms. Never infer a request or reply from historical tool logs. */
class DshQuestionPanel {
  constructor(post, markdown, changed) {
    this.post = post; this.markdown = markdown; this.changed = changed;
    this.node = document.createElement('section'); this.node.className = 'question-panel'; this.node.hidden = true;
    this.drafts = new Map();
  }
  update(sessionId, items) {
    this.sessionId = sessionId;
    const current = items[0];
    if (!current) { this.current = undefined; this.node.hidden = true; this.node.replaceChildren(); this.changed(false); return; }
    if (this.current?.eventId === current.eventId) {
      this.current = current;
      this.setBusy(current.submitting);
      return;
    }
    this.current = current; this.node.hidden = false; this.node.replaceChildren();
    const e = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
    this.node.append(e('h3', `需要你回答${items.length > 1 ? `（${items.length} 组待答）` : ''}`));
    const form = e('form'); this.form = form;
    const draft = this.drafts.get(current.eventId) || new Map(); this.drafts.set(current.eventId, draft);
    // Bound local draft retention; drafts are never persisted to VS Code or sent automatically.
    if (this.drafts.size > 30) this.drafts.delete(this.drafts.keys().next().value);
    const fields = current.questions.map((q, index) => {
      const group = e('fieldset'); group.append(e('legend', q.header || `问题 ${index + 1}`), e('p', q.question));
      if (q.detail) group.append(this.markdown(q.detail));
      const value = draft.get(q.id) || { selected: [], custom: '' }; draft.set(q.id, value);
      const choices = (q.options || []).map(option => {
        const label = e('label'); label.className = 'question-choice';
        const input = e('input'); input.type = q.multiSelect ? 'checkbox' : 'radio'; input.name = `q-${index}`; input.value = option.label; input.checked = value.selected.includes(option.label);
        const copy = e('span'); copy.append(e('span', option.label)); if (option.description) copy.append(e('small', option.description));
        label.append(input, copy); group.append(label); return input;
      });
      const customLabel = e('label', q.options?.length ? '其他回答' : '你的回答'); customLabel.className = 'question-custom';
      const custom = e('textarea'); custom.rows = 2; custom.value = value.custom; custom.setAttribute('aria-label', `${q.header || q.id}：${q.options?.length ? '其他回答' : '你的回答'}`); customLabel.append(custom); group.append(customLabel);
      const save = () => { value.selected = choices.filter(i => i.checked).map(i => i.value); value.custom = custom.value; this.validate(); };
      choices.forEach(input => input.onchange = () => { if (!q.multiSelect) custom.value = ''; save(); });
      custom.oninput = () => { if (!q.multiSelect && custom.value.trim()) choices.forEach(i => i.checked = false); save(); };
      form.append(group); return { q, choices, custom };
    });
    this.fields = fields;
    this.error = e('div'); this.error.className = 'question-error'; this.error.setAttribute('role', 'alert');
    const actions = e('div'); actions.className = 'question-actions';
    this.submit = e('button', '提交回答'); this.submit.type = 'submit';
    this.cancel = e('button', '取消提问'); this.cancel.type = 'button';
    this.cancel.onclick = () => this.send(true);
    actions.append(this.submit, this.cancel); form.append(this.error, actions);
    form.onsubmit = event => { event.preventDefault(); if (!this.submit.disabled) this.send(false); };
    this.node.append(form); this.setBusy(current.submitting); this.changed(true);
  }
  validate() {
    this.submit.disabled = this.busy || !this.fields.every(f => f.choices.some(i => i.checked) || f.custom.value.trim());
  }
  setBusy(busy) {
    this.busy = busy;
    for (const input of this.form.querySelectorAll('input, textarea')) input.disabled = busy;
    this.cancel.disabled = busy; this.submit.textContent = busy ? '正在提交…' : '提交回答'; this.validate();
  }
  send(cancel) {
    if (this.busy || !this.current) return;
    this.error.textContent = ''; this.setBusy(true);
    const answers = this.fields.map(f => ({ id: f.q.id, selected: f.choices.filter(i => i.checked).map(i => i.value), ...(f.custom.value.trim() ? { custom: f.custom.value.trim() } : {}) }));
    this.post(cancel ? 'cancelQuestion' : 'answerQuestion', { sessionId: this.sessionId, eventId: this.current.eventId, answers });
  }
  fail(eventId, message) { if (this.current?.eventId === eventId) { this.setBusy(false); this.error.textContent = message; } }
}
