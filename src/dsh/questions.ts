import { DshRemoteMux } from './mux';
import { DshRpcClient } from './rpc';
import { Json } from './protocol';

export type Question = {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
};
type Pending = { eventId: string; sessionId: string; questions: Question[]; submitting: boolean };
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Questions are live Remote waterfalls, NOT tool-log events or ordinary prompts. */
export class DshQuestions {
  private clientId?: string;
  private pending = new Map<string, Pending>();
  private owned = new Set<string>();
  private stop?: () => void;
  constructor(
    private rpc: DshRpcClient,
    private mux: DshRemoteMux,
    private changed: () => void,
    private failed: (error: unknown) => void
  ) {}
  get ready(): boolean {
    return !!this.clientId;
  }
  track(sessionId: string): void {
    this.owned.add(sessionId);
  }
  items(sessionId?: string): Pending[] {
    return [...this.pending.values()].filter(p => p.sessionId === sessionId);
  }
  private reset = () => {
    this.clientId = undefined;
    this.pending.clear();
    this.changed();
  };
  async start(): Promise<void> {
    let settle!: () => void, reject!: (error: unknown) => void;
    const ready = new Promise<void>((yes, no) => {
      settle = yes;
      reject = no;
    });
    void ready.catch(() => {}); // Also handle a deadline while the socket is still opening.
    const timer = setTimeout(() => reject(new Error('提问通道启动超时，请重启 Runtime。')), 10_000);
    try {
      this.stop = await this.mux.stream(
        '$events',
        { args: {} },
        value => {
          try {
            this.receive(value);
            if (this.ready) settle();
          } catch (error) {
            reject(error);
            this.failed(error);
          }
        },
        error => {
          reject(error);
          this.failed(error);
        },
        this.reset
      );
      await ready;
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  dispose(): void {
    this.stop?.();
    this.stop = undefined;
    this.reset();
  }
  private receive(value: unknown): void {
    if (!record(value)) return;
    if (value.type === 'ready' && typeof value.clientId === 'string') {
      this.reset();
      this.clientId = value.clientId;
      this.changed();
      return;
    }
    if (value.type === 'cancel') {
      this.pending.delete(value.eventId);
      this.changed();
      return;
    }
    if (value.type !== 'waterfall' || typeof value.eventId !== 'string' || !this.clientId) return;
    if (this.pending.has(value.eventId)) return;
    if (value.event !== 'user-questions/request' || !this.owned.has(value.agentId)) {
      void this.reply(value.eventId, { kind: 'next' }).catch(this.failed);
      return;
    }
    const questions = value.request?.questions;
    if (
      !Array.isArray(questions) ||
      !questions.length ||
      questions.some(
        q =>
          !record(q) ||
          typeof q.id !== 'string' ||
          typeof q.question !== 'string' ||
          (q.options !== undefined &&
            (!Array.isArray(q.options) || q.options.some((o: unknown) => !record(o) || typeof o.label !== 'string')))
      )
    ) {
      void this.reply(value.eventId, {
        kind: 'rejected',
        error: { name: 'Error', code: 'INVALID_QUESTIONS', message: 'Invalid user question payload' }
      }).catch(this.failed);
      return;
    }
    this.pending.set(value.eventId, { eventId: value.eventId, sessionId: value.agentId, questions, submitting: false });
    this.changed();
  }
  private reply(eventId: string, outcome: Json): Promise<unknown> {
    if (!this.clientId) return Promise.reject(new Error('提问已因断线失效，请等待新的提问。'));
    return this.rpc.call('$events/result', { clientId: this.clientId, eventId, outcome }, null);
  }
  async answer(sessionId: string, eventId: string, answers: unknown, cancel = false): Promise<void> {
    const pending = this.pending.get(eventId);
    if (!pending || pending.sessionId !== sessionId || !this.ready) throw new Error('提问已失效或不属于当前会话。');
    if (pending.submitting) throw new Error('回答正在提交，请勿重复操作。');
    const normalized = cancel ? [] : validateAnswers(pending.questions, answers);
    pending.submitting = true;
    this.changed();
    try {
      await this.reply(
        eventId,
        cancel
          ? {
              kind: 'rejected',
              error: { name: 'UserQuestionError', code: 'ASK_CANCELLED', message: 'the user cancelled ask_user_question' }
            }
          : { kind: 'result', value: { answers: normalized } }
      );
      if (this.pending.get(eventId) === pending) this.pending.delete(eventId);
    } finally {
      pending.submitting = false;
      this.changed();
    }
  }
}

export function validateAnswers(questions: Question[], input: unknown): Json[] {
  if (!Array.isArray(input) || input.length !== questions.length) throw new Error('请回答全部问题。');
  return questions.map(q => {
    const matches = input.filter(a => record(a) && a.id === q.id);
    const a = matches[0];
    if (
      matches.length !== 1 ||
      !Array.isArray(a.selected) ||
      a.selected.some((s: unknown) => typeof s !== 'string' || !q.options?.some(o => o.label === s))
    )
      throw new Error('选项或问题编号无效。');
    const selected = [...new Set<string>(a.selected)];
    if (
      selected.length !== a.selected.length ||
      (!q.multiSelect && selected.length > 1) ||
      (a.custom !== undefined && typeof a.custom !== 'string')
    )
      throw new Error('回答格式无效。');
    const custom = a.custom?.trim() || '';
    if ((!selected.length && !custom) || (!q.multiSelect && selected.length && custom)) throw new Error('请选择一个答案或填写其他回答。');
    return { id: q.id, selected, ...(custom ? { custom } : {}) };
  });
}
