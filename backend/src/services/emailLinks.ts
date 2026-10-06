import { appSecret, type Env } from '../env';
import { hmacHex } from '../lib/crypto';
import type { Links } from './emailText';

export type UnsubKind = 'digest' | 'instant' | 'all';
export const UNSUB_KINDS: readonly UnsubKind[] = ['digest', 'instant', 'all'];

/** HMAC token that authorises exactly one action (unsubscribe one kind) for one user — no login, no way to escalate. */
export const unsubToken = (env: Env, userId: string, kind: UnsubKind) => hmacHex(appSecret(env), `unsub:${userId}:${kind}`);

export function appBase(env: Env, origin?: string): string {
  return (env.APP_URL ?? origin ?? env.ALLOWED_ORIGINS?.split(',')[0]?.trim() ?? 'http://localhost:5173').replace(/\/+$/, '');
}

export async function mailLinks(env: Env, base: string, userId: string, kind: 'digest' | 'instant', path: string): Promise<Links> {
  const q = `u=${userId}&k=${kind}&t=${await unsubToken(env, userId, kind)}`;
  return { open: `${base}${path}`, unsub: `${base}/unsubscribe?${q}`, unsubPostUrl: `${base}/api/email/unsubscribe?${q}`, manage: `${base}/profile` };
}
