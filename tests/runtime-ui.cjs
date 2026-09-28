const assert = require('node:assert/strict');
const { DshProcessManager } = require('../out/dsh/process');
const { DshRpcClient } = require('../out/dsh/rpc');
const { DshRemoteMux } = require('../out/dsh/mux');
const { Transcript } = require('../media/transcript');
async function main() {
  const process = new DshProcessManager(); let mux, stop; const store = new Transcript(); const frames = [];
  let sessionId;
  try {
    const endpoint = await process.start(); console.log('Managed launch + auth: OK');
    const rpc = new DshRpcClient(endpoint); mux = new DshRemoteMux(endpoint);
    sessionId = (await rpc.create(require('node:path').resolve(__dirname, '..'))).sessionId;
    stop = await mux.follow(sessionId, f => { frames.push(f); store.apply(f); }, e => { throw e; });
    await wait(() => frames.some(f => f.type === 'snapshot'));
    await rpc.prompt(sessionId, 'This is a UI integration smoke test. Reply with exactly UI_SMOKE_OK. Do not use tools or modify any files.');
    await wait(() => frames.some(f => f.type === 'event' && f.event.type === 'turn/end'), 90000);
    const rows = store.rows();
    console.log('Events:', [...new Set(frames.filter(f => f.type === 'event').map(f => f.event.type))].join(', '));
    assert(rows.some(r => r.role === 'user'));
    assert(rows.some(r => r.role === 'assistant' && r.text.includes('UI_SMOKE_OK')), 'Real model reply missing');
    assert.equal(store.running, false);
    console.log('Live reply + turn completion: OK');
    stop(); const replay = new Transcript(); let snapshot;
    stop = await mux.follow(sessionId, f => { replay.apply(f); if (f.type === 'snapshot') snapshot = f; });
    await wait(() => snapshot);
    assert.equal(replay.rows().filter(r => r.role === 'assistant').map(r => r.text).join(''), rows.filter(r => r.role === 'assistant').map(r => r.text).join(''));
    console.log('History replay matches live reply: OK');
    const catalog = await rpc.call('session/modelCatalog', {}, '');
    assert(Array.isArray(catalog.groups)); console.log('Model picker catalog: OK');
  } finally { stop?.(); mux?.close(); process.stop(); }
}
async function wait(fn, timeout = 10000) { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 50)); } }
main().catch(e => { console.error(e); process.exitCode = 1; });
