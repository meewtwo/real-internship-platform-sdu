import { Hono } from 'hono';
import { requireAuth } from '../lib/guard';
import { iso } from '../lib/sql';
import { apiError, UUID_RE, type AppEnv } from '../lib/http';

export const notifications = new Hono<AppEnv>();
notifications.use('*', requireAuth());

notifications.get('/', async (c) => {
  const uid = c.var.auth!.user.id;
  const { rows } = await c.var.db.query('SELECT id, kind, params, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [uid]);
  const unread = (await c.var.db.query<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [uid])).rows[0].n;
  return c.json({ unread, items: rows.map((r: any) => ({ id: String(r.id), kind: r.kind, params: r.params, link: r.link, read: r.read_at !== null, createdAt: r.created_at })) });
});
notifications.get('/count', async (c) => {
  const r = await c.var.db.query<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [c.var.auth!.user.id]);
  return c.json({ unread: r.rows[0].n });
});
notifications.post('/read-all', async (c) => {
  await c.var.db.query('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL', [c.var.auth!.user.id, iso()]);
  return c.json({ ok: true });
});
notifications.post('/:id/read', async (c) => {
  const id = c.req.param('id');
  if (!/^[0-9]{1,18}$/.test(id) || UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const r = await c.var.db.query('UPDATE notifications SET read_at = COALESCE(read_at, $3) WHERE id = $1 AND user_id = $2', [id, c.var.auth!.user.id, iso()]);
  return r.rowCount ? c.json({ ok: true }) : apiError(c, 404, 'NOT_FOUND');
});
