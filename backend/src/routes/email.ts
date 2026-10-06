import { Hono } from 'hono';
import { requireAuth } from '../lib/guard';
import { constantTimeEqualStr, apiError, clientIp, readJson, UUID_RE, type AppEnv } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { iso } from '../lib/sql';
import { unsubToken, UNSUB_KINDS, type UnsubKind } from '../services/emailLinks';

export const email = new Hono<AppEnv>();

const prefs = async (db: AppEnv['Variables']['db'], id: string) => {
  const r = (await db.query<{ email_digest: boolean; email_instant: boolean }>('SELECT email_digest, email_instant FROM notification_prefs WHERE user_id = $1', [id])).rows[0];
  return { digest: r?.email_digest ?? true, instant: r?.email_instant ?? true };
};

email.get('/prefs', requireAuth(), async (c) => c.json(await prefs(c.var.db, c.var.auth!.user.id)));

email.put('/prefs', requireAuth(), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => k !== 'digest' && k !== 'instant') || Object.keys(o).length === 0
    || Object.values(o).some((v) => typeof v !== 'boolean')) return apiError(c, 400, 'VALIDATION_FAILED');
  const id = c.var.auth!.user.id;
  const cur = await prefs(c.var.db, id);
  const next = { digest: (o.digest as boolean | undefined) ?? cur.digest, instant: (o.instant as boolean | undefined) ?? cur.instant };
  await c.var.db.query(
    `INSERT INTO notification_prefs (user_id, email_digest, email_instant) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET email_digest = $2, email_instant = $3, updated_at = $4`, [id, next.digest, next.instant, iso()]);
  return c.json(next);
});

/**
 * One-click unsubscribe from a mail link (RFC 8058 style): authorised by an HMAC token tied to the user AND the kind, so it needs no login and no CSRF
 * cookie (the app's CSRF check exempts exactly this path). Any invalid input answers the same 404 so tokens cannot be probed.
 */
email.post('/unsubscribe', async (c) => {
  const rl = await rateLimit(c.var.db, c.env, `unsub:${clientIp(c)}`, 30, 3600);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const u = c.req.query('u') ?? '', k = c.req.query('k') ?? '', t = c.req.query('t') ?? '';
  if (!UUID_RE.test(u) || !(UNSUB_KINDS as readonly string[]).includes(k) || !/^[0-9a-f]{64}$/.test(t)) return apiError(c, 404, 'NOT_FOUND');
  if (!constantTimeEqualStr(t, await unsubToken(c.env, u, k as UnsubKind))) return apiError(c, 404, 'NOT_FOUND');
  const digest = k === 'instant' ? null : false, instant = k === 'digest' ? null : false;
  const r = await c.var.db.query(
    `INSERT INTO notification_prefs (user_id, email_digest, email_instant) SELECT id, COALESCE($2, 1), COALESCE($3, 1) FROM users WHERE id = $1 AND true
     ON CONFLICT (user_id) DO UPDATE SET email_digest = COALESCE($2, notification_prefs.email_digest), email_instant = COALESCE($3, notification_prefs.email_instant), updated_at = $4`, [u, digest, instant, iso()]);
  return r.rowCount ? c.json({ ok: true, kind: k }) : apiError(c, 404, 'NOT_FOUND');
});
