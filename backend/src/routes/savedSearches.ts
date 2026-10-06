import { Hono } from 'hono';
import { MAX_SAVED_SEARCHES, validateSavedSearch } from '@sdu/shared';
import { asDbError } from '../lib/db';
import { requireAuth } from '../lib/guard';
import { apiError, readJson, UUID_RE, type AppEnv } from '../lib/http';

export const savedSearches = new Hono<AppEnv>();
savedSearches.use('*', requireAuth('student'));

const dto = (r: { id: string; name: string; filters: unknown; created_at: string }) => ({ id: r.id, name: r.name, filters: r.filters, createdAt: r.created_at });

savedSearches.get('/', async (c) => {
  const { rows } = await c.var.db.query<{ id: string; name: string; filters: unknown; created_at: string }>(
    'SELECT id, name, filters, created_at FROM saved_searches WHERE user_id = $1 ORDER BY created_at, id', [c.var.auth!.user.id]);
  return c.json({ searches: rows.map(dto), max: MAX_SAVED_SEARCHES });
});

savedSearches.post('/', async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateSavedSearch(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const uid = c.var.auth!.user.id;
  try {
    // the limit is checked INSIDE the INSERT (one atomic statement), so racing requests cannot exceed it
    const res = (await c.var.db.query<{ id: string; name: string; filters: unknown; created_at: string }>(
      `INSERT INTO saved_searches (user_id, name, filters) SELECT $1, $2, $3 WHERE (SELECT count(*) FROM saved_searches WHERE user_id = $1) < $4
       RETURNING id, name, filters, created_at`, [uid, v.data.name, JSON.stringify(v.data.filters), MAX_SAVED_SEARCHES])).rows[0];
    if (!res) return apiError(c, 409, 'SAVED_SEARCH_LIMIT');
    return c.json({ search: dto(res) }, 201);
  } catch (e) {
    if (asDbError(e).code === '23505') return apiError(c, 409, 'SAVED_SEARCH_NAME_TAKEN', { fields: { name: 'SAVED_SEARCH_NAME_TAKEN' } });
    throw e;
  }
});

savedSearches.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const r = await c.var.db.query('DELETE FROM saved_searches WHERE id = $1 AND user_id = $2', [id, c.var.auth!.user.id]);
  return r.rowCount ? c.json({ ok: true }) : apiError(c, 404, 'NOT_FOUND');
});
