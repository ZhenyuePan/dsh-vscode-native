const assert = require('node:assert/strict');
const { DshQuestions, validateAnswers } = require('../out/dsh/questions');
async function main() {
  let receive, reset;
  const replies = [];
  let fail = false,
    hold;
  const rpc = {
    call: async (...args) => {
      replies.push(args);
      if (fail) throw Error('network');
      if (hold) await hold;
      return {};
    }
  };
  const mux = {
    stream: async (endpoint, payload, callback, error, onReset) => {
      assert.equal(endpoint, '$events');
      assert.deepEqual(payload, { args: {} });
      receive = callback;
      reset = onReset;
      queueMicrotask(() => receive({ type: 'ready', clientId: 'client-1' }));
      return () => {};
    }
  };
  const service = new DshQuestions(
    rpc,
    mux,
    () => {},
    error => {
      throw error;
    }
  );
  service.track('s1');
  service.track('s2');
  await service.start();
  const questions = [
    { id: 'q1', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] },
    { id: 'q2', question: 'Multiple?', multiSelect: true, options: [{ label: 'X' }, { label: 'Y' }] },
    { id: 'q3', question: 'Text?' }
  ];
  const emit = (id = 'e1', session = 's1', event = 'user-questions/request') =>
    receive({ type: 'waterfall', eventId: id, agentId: session, event, request: { questions } });
  const answers = [
    { id: 'q1', selected: ['A'] },
    { id: 'q2', selected: ['X', 'Y'], custom: 'note' },
    { id: 'q3', selected: [], custom: 'text' }
  ];
  emit();
  assert.equal(service.items('s1').length, 1);
  assert.equal(service.items('s2').length, 0);
  await assert.rejects(() => service.answer('s2', 'e1', answers));
  assert.throws(() => validateAnswers(questions, []));
  assert.throws(() => validateAnswers([questions[0]], [{ id: 'q1', selected: ['missing'] }]));
  assert.throws(() => validateAnswers([questions[0]], [{ id: 'q1', selected: ['A', 'B'] }]));
  assert.throws(() => validateAnswers([questions[0]], [{ id: 'q1', selected: ['A'], custom: 'bad' }]));
  fail = true;
  await assert.rejects(() => service.answer('s1', 'e1', answers));
  assert.equal(service.items('s1')[0].submitting, false);
  fail = false;
  let release;
  hold = new Promise(r => (release = r));
  const first = service.answer('s1', 'e1', answers);
  await assert.rejects(() => service.answer('s1', 'e1', answers));
  release();
  await first;
  hold = undefined;
  assert.equal(service.items('s1').length, 0);
  const reply = replies.at(-1);
  assert.equal(reply[0], '$events/result');
  assert.equal(reply[2], null);
  assert.deepEqual(reply[1], { clientId: 'client-1', eventId: 'e1', outcome: { kind: 'result', value: { answers } } });
  emit('cancel');
  await service.answer('s1', 'cancel', undefined, true);
  assert.equal(replies.at(-1)[1].outcome.error.code, 'ASK_CANCELLED');
  emit('host-cancel');
  receive({ type: 'cancel', eventId: 'host-cancel' });
  assert.equal(service.items('s1').length, 0);
  emit('stale');
  reset();
  assert(!service.ready);
  assert.equal(service.items('s1').length, 0);
  await assert.rejects(() => service.answer('s1', 'stale', answers));
  receive({ type: 'ready', clientId: 'client-2' });
  emit('fresh');
  await service.answer('s1', 'fresh', answers);
  assert.equal(replies.at(-1)[1].clientId, 'client-2');
  emit('foreign', 'unowned');
  assert.equal(replies.at(-1)[1].outcome.kind, 'next');
  emit('approval', 's1', 'approval/request');
  assert.equal(replies.at(-1)[1].outcome.kind, 'next');
  service.dispose();
  console.log(
    'Questions: structured answers, validation, scope, retry, duplicate prevention, cancel, disconnect and generation checks passed'
  );
}
main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
