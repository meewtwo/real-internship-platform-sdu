import type { Context } from 'hono';
import type { ApiErrorBody, ErrorCode, FieldErrors, Language, Role } from '@sdu/shared';
import type { Env } from '../env';
import type { Db } from './db';

export interface PublicUser {
  id: string;
  role: Role;
  status: 'unverified' | 'active' | 'pending' | 'blocked';
  email: string;
  studentId: string | null;
  phone: string | null;
  preferredLanguage: Language;
}
export interface Auth { sessionId: string; user: PublicUser }
export type AppEnv = { Bindings: Env; Variables: { db: Db; auth: Auth | null; requestId?: string } };
export type Ctx = Context<AppEnv>;

export function apiError(c: Ctx, status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 423 | 429 | 500 | 503, code: ErrorCode, extra: { fields?: FieldErrors; retryAfter?: number } = {}) {
  const body: ApiErrorBody = { error: { code, ...extra } };
  if (extra.retryAfter) c.header('Retry-After', String(extra.retryAfter));
  return c.json(body, status);
}

export function clientIp(c: Ctx): string {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf;
  if (c.env.TRUST_PROXY_HEADERS === '1') {
    const xf = c.req.header('x-forwarded-for');
    if (xf) return xf.split(',')[0].trim().slice(0, 64);
  }
  return 'local';
}

export const isHttps = (c: Ctx) => new URL(c.req.url).protocol === 'https:';

/** Parses a JSON object body. Size is capped earlier by the bodyLimit middleware. */
export async function readJson(c: Ctx): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const ct = c.req.header('content-type') ?? '';
  if (!/^application\/json\b/i.test(ct)) return { ok: false, res: apiError(c, 415, 'UNSUPPORTED_MEDIA_TYPE') };
  try {
    return { ok: true, body: JSON.parse(await c.req.text()) };
  } catch {
    return { ok: false, res: apiError(c, 400, 'INVALID_JSON') };
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function constantTimeEqualStr(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
