import { DshEndpoint, Json, RpcResult, uuid } from './protocol';

export class DshRpcClient {
  public constructor(private readonly endpoint: DshEndpoint) {}

  /** `session/list` is the current exception: its generated parameter wire-name is `_request`. */
  async call<T>(method: string, request: Record<string, Json>, wireName: string | null = 'request'): Promise<T> {
    const rpcId = uuid();
    const response = await fetch(`${this.endpoint.origin}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.endpoint.cookie },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        type: 'client-request',
        rpcId,
        method,
        payload: { args: wireName === null ? request : wireName ? { [wireName]: request } : {} }
      })
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status} ${await response.text()}`);
    const body = (await response.json()) as { type?: string; rpcId?: string; result?: RpcResult<T> };
    if (body.type !== 'server-response' || body.rpcId !== rpcId || !body.result) throw new Error(`${method}: malformed RPC response`);
    if (!body.result.ok) throw new Error(`${method}: ${body.result.error.code}: ${body.result.error.message}`);
    return body.result.value;
  }

  list(): Promise<{ items: Array<{ sessionId: string; updatedAt: number; running: boolean; blank: boolean; cwd?: string }> }> {
    return this.call('session/list', {}, '_request');
  }
  create(cwd?: string): Promise<{ sessionId: string }> {
    return this.call('session/create', cwd ? { cwd } : {});
  }
  prompt(sessionId: string, text: string): Promise<{ accepted: true }> {
    return this.call('session/prompt', { requestId: uuid(), sessionId, mode: 'queue', content: [{ type: 'text', text }] });
  }
  cancel(sessionId: string): Promise<{ accepted: true }> {
    return this.call('session/cancel', { sessionId });
  }
}
