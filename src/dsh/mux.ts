import WebSocket from 'ws';
import { DshEndpoint, Json, RemoteFrame, RpcFailure, uuid } from './protocol';

type Follow = { sessionId: string; onItem: (value: Json) => void; onError?: (error: Error) => void; streamId?: string };

/** One physical /api/remote.mux connection shared by every logical Remote stream.
 * Live follows are restored after a socket drop; their first item is DSH's fresh snapshot. */
export class DshRemoteMux {
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private readonly follows = new Map<string, Follow>();
  private reconnectTimer?: NodeJS.Timeout;
  private deliberatelyClosed = false;
  public constructor(private readonly endpoint: DshEndpoint) {}

  async follow(sessionId: string, onItem: (value: Json) => void, onError?: (error: Error) => void): Promise<() => void> {
    this.deliberatelyClosed = false;
    const id = uuid();
    this.follows.set(id, { sessionId, onItem, onError });
    try { await this.openFollow(id); } catch (error) { this.follows.delete(id); throw error; }
    return () => {
      const follow = this.follows.get(id);
      if (!follow) return;
      this.follows.delete(id);
      if (follow.streamId && this.socket?.readyState === WebSocket.OPEN) this.send({ type: 'cancel', streamId: follow.streamId });
    };
  }

  close(): void {
    this.deliberatelyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.follows.clear(); this.socket?.close(); this.socket = undefined;
  }

  private async openFollow(id: string): Promise<void> {
    const follow = this.follows.get(id);
    if (!follow) return;
    await this.connect();
    const streamId = uuid();
    follow.streamId = streamId;
    this.send({ type: 'open', streamId, endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: follow.sessionId }, assistantStream: true } } } });
  }
  private async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const wsOrigin = this.endpoint.origin.replace(/^http/, 'ws');
      const socket = new WebSocket(`${wsOrigin}/api/remote.mux`, { headers: { Cookie: this.endpoint.cookie } });
      this.socket = socket;
      socket.once('open', resolve);
      socket.once('error', reject);
      socket.on('message', (data) => this.dispatch(String(data)));
      socket.on('close', () => {
        if (this.socket === socket) this.socket = undefined;
        for (const follow of this.follows.values()) follow.streamId = undefined;
        if (!this.deliberatelyClosed && this.follows.size) this.scheduleReconnect();
      });
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private scheduleReconnect(attempt = 0): void {
    if (this.reconnectTimer || this.deliberatelyClosed || !this.follows.size) return;
    const delay = Math.min(10_000, 500 * 2 ** attempt);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try { await this.connect(); await Promise.all([...this.follows.keys()].map((id) => this.openFollow(id))); }
      catch { this.scheduleReconnect(attempt + 1); }
    }, delay);
  }
  private send(value: object): void { this.socket?.send(JSON.stringify(value)); }
  private dispatch(raw: string): void {
    let frame: RemoteFrame;
    try { frame = JSON.parse(raw) as RemoteFrame; } catch { return; }
    const found = [...this.follows.entries()].find(([, candidate]) => candidate.streamId === frame.streamId);
    if (!found) return;
    const [id, follow] = found;
    if (frame.type === 'item') { follow.onItem(frame.value ?? null); return; }
    follow.streamId = undefined;
    if (frame.type === 'error') { this.follows.delete(id); follow.onError?.(remoteError(frame.error)); return; }
    // `end` is a normal terminal frame. It is distinct from a locally cancelled live follow.
    this.follows.delete(id);
  }
}
function remoteError(error: RpcFailure): Error { return new Error(`${error.code}: ${error.message}`); }
