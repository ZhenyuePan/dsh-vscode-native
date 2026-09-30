import { DshEndpoint } from './protocol';

/** Converts DSH's one-shot ?token= launch URL into the HttpOnly session cookie. */
export async function exchangeLaunchToken(tokenUrl: string): Promise<DshEndpoint> {
  const parsed = new URL(tokenUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error(`Refusing a non-local DSH endpoint: ${parsed.hostname}`);
  }
  if (!parsed.searchParams.get('token')) throw new Error('The DSH launch URL has no token.');

  const response = await fetch(parsed, { redirect: 'manual' });
  if (response.status !== 303) throw new Error(`DSH token exchange returned HTTP ${response.status}, expected 303.`);
  const rawCookies =
    typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  const authCookie = rawCookies.map(value => value.split(';', 1)[0]).find(value => value.startsWith('dsh-auth-'));
  if (!authCookie) throw new Error('DSH token exchange did not return a dsh-auth cookie.');
  return { origin: parsed.origin, tokenUrl, cookie: authCookie };
}
