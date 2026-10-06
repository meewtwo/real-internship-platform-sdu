import { Hono } from 'hono';
import { requireAuth } from '../lib/guard';
import { apiError, type AppEnv } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { iso } from '../lib/sql';

export const MAX_AVATAR_BYTES = 150 * 1024;
export const avatar = new Hono<AppEnv>();
avatar.use('*', requireAuth());

/** The real format from the first bytes — the client's Content-Type is never trusted. */
export function sniffImage(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

avatar.get('/me', async (c) => {
  const { rows } = await c.var.db.query<{ updated_at: string }>('SELECT updated_at FROM avatars WHERE user_id = $1', [c.var.auth!.user.id]);
  return c.json({ updatedAt: rows[0]?.updated_at ?? null });
});

avatar.put('/', async (c) => {
  const a = c.var.auth!;
  const rl = await rateLimit(c.var.db, c.env, `avatar:${a.user.id}`, 20, 3600);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > MAX_AVATAR_BYTES) return apiError(c, 413, 'AVATAR_TOO_LARGE');
  const mime = sniffImage(bytes);
  if (!mime) return apiError(c, 400, 'AVATAR_TYPE_INVALID');
  const at = iso();
  await c.var.db.query(
    `INSERT INTO avatars (user_id, mime, content, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET mime = $2, content = $3, updated_at = $4`, [a.user.id, mime, bytes, at]);
  return c.json({ updatedAt: at });
});

avatar.delete('/', async (c) => {
  await c.var.db.query('DELETE FROM avatars WHERE user_id = $1', [c.var.auth!.user.id]);
  return c.json({ ok: true });
});

/** Any signed-in user may see another user's picture (applicants, employers); ids are unguessable UUIDs. */
avatar.get('/:id', async (c) => {
  const { rows } = await c.var.db.query<{ mime: string; content: Uint8Array }>('SELECT mime, content FROM avatars WHERE user_id = $1', [c.req.param('id')]);
  if (!rows[0]) return apiError(c, 404, 'NOT_FOUND');
  return new Response(rows[0].content as BodyInit, { headers: { 'content-type': rows[0].mime, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
});
