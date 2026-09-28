import WebSocket from 'ws';
import { exchangeLaunchToken } from './dsh/auth';
import { DshRpcClient } from './dsh/rpc';
import { uuid } from './dsh/protocol';

async function main(): Promise<void> {
  const url = process.env.DSH_URL;
  if (!url) throw new Error('DSH_URL must be the dsh web launch URL containing ?token=.');
  const endpoint = await exchangeLaunchToken(url);
  console.log(`AUTH 303 cookie exchange OK: ${endpoint.origin}`);
  const rpc = new DshRpcClient(endpoint);
  const before = await rpc.list(); console.log(`session/list OK (${before.items.length} sessions)`);
  const created = await rpc.create(process.cwd()); console.log(`session/create OK (${created.sessionId})`);
  const ws = new WebSocket(`${endpoint.origin.replace(/^http/, 'ws')}/api/remote.mux`, { headers: { Cookie: endpoint.cookie } });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const frames: Array<{ type: string; streamId: string; [key: string]: unknown }> = [];
  ws.on('message', (data) => frames.push(JSON.parse(String(data))));
  const streamId = uuid();
  ws.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: created.sessionId }, assistantStream: true } } } }));
  await waitFor(() => frames.some((frame) => frame.streamId === streamId && frame.type === 'item'));
  console.log(`remote.mux session/follow open/item compatibility OK (${frames.length} frames)`);
  ws.send(JSON.stringify({ type: 'cancel', streamId }));
  // `session/follow` is an infinite live stream: cancel is client-local and intentionally has no end reply.
  // DshRemoteMux removes it immediately, so UI teardown never waits for a server frame.
  console.log('remote.mux cancel compatibility OK (no end frame is expected for a cancelled live follow)');
  const errorStreamId = uuid();
  ws.send(JSON.stringify({ type: 'open', streamId: errorStreamId, endpoint: 'session/not-a-real-stream', payload: { args: {} } }));
  await waitFor(() => frames.some((frame) => frame.streamId === errorStreamId && frame.type === 'error'));
  console.log('remote.mux error compatibility OK');
  await rpc.prompt(created.sessionId, 'Reply with exactly: runtime test acknowledged.'); console.log('session/prompt OK');
  await rpc.cancel(created.sessionId); console.log('session/cancel OK');
  ws.close();
}
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for expected Remote mux frame.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
