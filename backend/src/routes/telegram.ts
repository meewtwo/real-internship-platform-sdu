import { Hono } from 'hono';
import { requireAuth } from '../lib/guard';
import { apiError, clientIp, constantTimeEqualStr, readJson, type AppEnv } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { appBase } from '../services/emailLinks';
import { createLinkToken, handleUpdate, telegramConfigured } from '../services/telegram';

export const telegram = new Hono<AppEnv>();

/**
 * Telegram → us. Authenticated ONLY by the secret header Telegram echoes from setWebhook; anything else answers an opaque 404.
 * It always answers 200 for authentic updates (Telegram retries on errors), and a failure while handling is logged, not surfaced.
 */
telegram.post('/webhook', async (c) => {
  const rl = await rateLimit(c.var.db, c.env, `tgwh:${clientIp(c)}`, 600, 60);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const given = c.req.header('x-telegram-bot-api-secret-token') ?? '';
  if (!telegramConfigured(c.env) || !constantTimeEqualStr(given, c.env.TELEGRAM_WEBHOOK_SECRET!)) return apiError(c, 404, 'NOT_FOUND');
  let update: unknown = null;
  try { update = JSON.parse(await c.req.text()); } catch { return c.json({ ok: true }); }
  try { await handleUpdate(c.var.db, c.env, appBase(c.env, new URL(c.req.url).origin), update); }
  catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'telegram update failed', detail: (e as Error).message, requestId: c.get('requestId') ?? null })); }
  return c.json({ ok: true });
});

telegram.get('/status', requireAuth('student', 'employer'), async (c) => {
  const r = (await c.var.db.query<{ enabled: boolean }>('SELECT enabled FROM telegram_links WHERE user_id = $1', [c.var.auth!.user.id])).rows[0];
  return c.json({ configured: telegramConfigured(c.env), linked: !!r, enabled: r?.enabled ?? false, username: c.env.TELEGRAM_BOT_USERNAME ?? null });
});

telegram.post('/link', requireAuth('student', 'employer'), async (c) => {
  if (!telegramConfigured(c.env) || !c.env.TELEGRAM_BOT_USERNAME) return apiError(c, 503, 'TELEGRAM_UNAVAILABLE');
  const rl = await rateLimit(c.var.db, c.env, `tglink:${c.var.auth!.user.id}`, 10, 3600);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const token = await createLinkToken(c.var.db, c.var.auth!.user.id);
  return c.json({ url: `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${token}`, expiresInMinutes: 15 });
});

telegram.delete('/link', requireAuth('student', 'employer'), async (c) => {
  await c.var.db.query('DELETE FROM telegram_links WHERE user_id = $1', [c.var.auth!.user.id]);
  await c.var.db.query('DELETE FROM telegram_link_tokens WHERE user_id = $1', [c.var.auth!.user.id]);
  return c.json({ ok: true });
});

telegram.put('/settings', requireAuth('student', 'employer'), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => k !== 'enabled') || typeof o.enabled !== 'boolean') return apiError(c, 400, 'VALIDATION_FAILED');
  const r = await c.var.db.query('UPDATE telegram_links SET enabled = $2 WHERE user_id = $1', [c.var.auth!.user.id, o.enabled]);
  return r.rowCount ? c.json({ enabled: o.enabled }) : apiError(c, 404, 'NOT_FOUND');
});
