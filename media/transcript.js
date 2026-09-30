/* Shared browser/Node projection of DSH 0.1.7 follow frames. No HTML from the host is trusted. */
(function (root) {
  function textOf(blocks, type = 'text') {
    return (blocks || [])
      .filter(b => b.type === type)
      .map(b => b.text || '')
      .join('\n');
  }
  function chunk(blocks, c) {
    if (!c || typeof c.index !== 'number') return;
    let b = blocks.get(c.index);
    if (b?.closed) return;
    if (c.type === 'block-end') {
      blocks.set(c.index, { ...c.block, closed: true });
      return;
    }
    if (c.type === 'text-delta' || c.type === 'reasoning-delta') {
      b ||= { type: c.type === 'text-delta' ? 'text' : 'reasoning', text: '' };
      b.text += c.text || '';
      blocks.set(c.index, b);
    }
  }
  function baseline(records) {
    const blocks = new Map();
    for (const r of records || []) {
      if (r.type === 'chunk') chunk(blocks, r.chunk);
      else if (r.type === 'text-chunks' || r.type === 'reasoning-chunks')
        chunk(blocks, { type: r.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta', index: r.index, text: r.texts.join('') });
    }
    return blocks;
  }
  class Transcript {
    constructor() {
      this.reset();
    }
    reset() {
      this.events = new Map();
      this.live = undefined;
      this.title = '';
      this.model = 'DeepSeek';
      this.running = false;
      this.hasMore = false;
    }
    apply(frame) {
      if (!frame) return;
      if (frame.type === 'snapshot') {
        this.events.clear();
        this.live = undefined;
        this.running = false;
        this.hasMore = Boolean(frame.hasMore);
        for (const r of frame.records || []) this.add(r.event);
        const a = frame.assistantStream?.activeAttempt;
        if (a) {
          this.live = { id: a.attemptId, next: a.nextIndex, blocks: baseline(a.stream) };
          this.running = true;
        }
        const model = frame.projections?.values?.modelSelection?.next;
        if (model?.model) this.model = model.model;
      } else if (frame.type === 'event') this.add(frame.event);
      else if (frame.type === 'assistant-stream') {
        const f = frame.frame;
        if (f.type === 'start') {
          this.live = { id: f.attemptId, next: 0, blocks: new Map() };
          this.running = true;
        }
        if (f.type === 'chunk' && this.live?.id === f.attemptId && f.index >= this.live.next) {
          chunk(this.live.blocks, f.chunk);
          this.live.next = f.index + 1;
        }
        if (f.type === 'end' && this.live?.id === f.attemptId) {
          // If the durable event has not arrived yet retain the visible prefix until it does.
          if (f.outcome.kind === 'abandoned' || this.events.has(f.outcome.seq)) this.live = undefined;
          else this.live.commitSeq = f.outcome.seq;
        }
      }
    }
    add(e) {
      if (!e || this.events.has(e.seq)) return;
      this.events.set(e.seq, e);
      if (this.live?.commitSeq === e.seq) this.live = undefined;
      if (e.type === 'session/title') this.title = e.data?.title || '';
      if (e.type === 'model/selection') this.model = e.data?.model || this.model;
      if (e.type === 'turn/start') this.running = true;
      if (e.type === 'turn/end') {
        this.running = false;
        this.live = undefined;
      }
    }
    rows() {
      const rows = [];
      const tools = new Map();
      const removed = new Set();
      const events = [...this.events.values()].sort((a, b) => a.seq - b.seq);
      for (const e of events) {
        if (e.surfaceOp?.op === 'replace')
          for (const old of events) if (old.seq >= e.surfaceOp.startSeq && old.seq <= e.surfaceOp.endSeq) removed.add(old.seq);
      }
      for (const e of events) {
        if (removed.has(e.seq)) continue;
        const d = e.data || {};
        const message = d.message || d;
        if (e.type === 'user/message' || e.type === 'assistant/message' || e.type === 'assistant/attempt') {
          const blocks = message.content || [...baseline(d.stream).values()];
          const text = textOf(blocks),
            reasoning = textOf(blocks, 'reasoning');
          if (text || reasoning)
            rows.push({
              id: String(e.seq),
              role: e.type === 'user/message' ? 'user' : 'assistant',
              text,
              reasoning,
              interrupted: d.interrupted
            });
          if (e.type === 'assistant/message' && message.source?.model) this.model = message.source.model;
        } else if (e.type === 'tool/call') {
          let args = {};
          try {
            args = JSON.parse(d.arguments || '{}');
          } catch {
            /* Show tool name if args are partial. */
          }
          const row = {
            id: String(e.seq),
            role: 'tool',
            name: d.name,
            path: args.file_path || args.path || '',
            args: d.arguments,
            state: 'running',
            result: '',
            diffs: []
          };
          tools.set(d.callId, row);
          rows.push(row);
        } else if (e.type === 'tool/result') {
          let row = tools.get(message.toolCallId);
          if (!row) {
            row = { id: String(e.seq), role: 'tool', name: '工具结果' };
            rows.push(row);
          }
          row.state = message.isError ? 'error' : 'done';
          row.result = textOf(message.content);
          row.diffs = d.meta?.diffs || [];
          row.resultSeq = e.seq;
        } else if (e.type === 'approval/asked') {
          rows.push({ id: String(e.seq), role: 'notice', text: '此操作正在等待审批。当前版本请在 DSH 客户端处理，或点击停止。' });
        }
      }
      if (this.live) {
        const blocks = [...this.live.blocks.values()];
        rows.push({ id: 'live', role: 'assistant', text: textOf(blocks), reasoning: textOf(blocks, 'reasoning'), live: true });
      }
      return rows;
    }
  }
  if (typeof module !== 'undefined') module.exports = { Transcript };
  else root.DshTranscript = Transcript;
})(globalThis);
