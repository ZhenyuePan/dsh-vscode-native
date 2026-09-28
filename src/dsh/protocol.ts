export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface DshEndpoint {
  origin: string;
  tokenUrl: string;
  cookie: string;
}

export interface RpcFailure {
  code: string;
  message: string;
  details: Record<string, Json>;
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcFailure };

export interface SessionSummary { sessionId: string; updatedAt: number; running: boolean; blank: boolean; cwd?: string; }
export interface SessionListValue { items: SessionSummary[]; }
export interface SessionCreateValue { sessionId: string; agentPreset?: string; }

export type RemoteFrame =
  | { type: 'item'; streamId: string; value?: Json }
  | { type: 'end'; streamId: string }
  | { type: 'error'; streamId: string; error: RpcFailure };

export function uuid(): string {
  return globalThis.crypto.randomUUID();
}
