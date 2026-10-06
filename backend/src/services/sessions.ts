import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { randomToken, sha256Hex } from '../lib/crypto';
import type { Queryable } from '../lib/db';
import { iso } from '../lib/sql';
import { isHttps, type Auth, type Ctx } from '../lib/http';
import { toPublicUser, type UserRow } from './users';

const REMEMBER_DAYS = 30;
const SESSION_HOURS = 12;
const COOKIE = 'sid';

const cookieOpts = (c: Ctx) => {
  const secure = isHttps(c);
  return { secure, prefix: secure ? ('host' as const) : undefined, path: '/', httpOnly: true, sameSite: 'Lax' as const };
};

export async function startSession(c: Ctx, userId: string, remember: boolean) {
  const token = randomToken(32);
  const hours = remember ? REMEMBER_DAYS * 24 : SESSION_HOURS;
  await c.var.db.query(
    `INSERT INTO sessions (user_id, token_hash, remember, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, await sha256Hex(token), remember, (c.req.header('user-agent') ?? '').slice(0, 200), iso(hours * 3600_000)],
  );
  setCookie(c, COOKIE, token, { ...cookieOpts(c), ...(remember ? { maxAge: hours * 3600 } : {}) });
}

export async function endSession(c: Ctx) {
  const token = getCookie(c, COOKIE, cookieOpts(c).prefix);
  if (token) await c.var.db.query('DELETE FROM sessions WHERE token_hash = $1', [await sha256Hex(token)]);
  deleteCookie(c, COOKIE, cookieOpts(c));
}

export async function destroyAllSessions(db: Queryable, userId: string) {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

/** Resolves the session cookie to a user (active or pending only). */
export async function loadAuth(c: Ctx): Promise<Auth | null> {
  const token = getCookie(c, COOKIE, cookieOpts(c).prefix);
  if (!token || token.length > 100) return null;
  const { rows } = await c.var.db.query<UserRow & { session_id: string }>(
    `SELECT s.id AS session_id, u.id, u.role, u.student_id, u.email, u.phone, u.status, u.preferred_language
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status IN ('active', 'pending')`,
    [await sha256Hex(token), iso()],
  );
  const r = rows[0];
  return r ? { sessionId: r.session_id, user: toPublicUser(r) } : null;
}
