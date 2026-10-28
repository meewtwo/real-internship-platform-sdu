import { Hono } from 'hono';
import { requireAuth } from '../lib/guard';
import { apiError, UUID_RE, type AppEnv } from '../lib/http';
import { loadStudentSignal, matchFor, STUDENT_VISIBLE, toVacancyDto, VACANCY_SELECT, type VacancyRow } from '../services/matching';

export const favorites = new Hono<AppEnv>();
favorites.use('*', requireAuth('student'));

favorites.get('/', async (c) => {
  const uid = c.var.auth!.user.id;
  const { rows } = await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} JOIN favorites f ON f.vacancy_id = v.id AND f.user_id = $1 WHERE ${STUDENT_VISIBLE} ORDER BY f.created_at DESC LIMIT 200`, [uid]);
  const s = await loadStudentSignal(c.var.db, uid);
  return c.json({ items: rows.map((v) => ({ ...toVacancyDto(v), match: matchFor(s, v), favorite: true })) });
});
favorites.put('/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const n = (await c.var.db.query('SELECT count(*) AS n FROM favorites WHERE user_id = $1', [c.var.auth!.user.id])).rows[0] as { n: number };
  if (n.n >= 200) return apiError(c, 429, 'RATE_LIMITED');
  const r = await c.var.db.query(`INSERT INTO favorites (user_id, vacancy_id) SELECT $1, v.id FROM vacancies v JOIN employer_profiles ep ON ep.user_id = v.employer_id WHERE v.id = $2 AND v.status = 'published' AND ep.review_status = 'approved' ON CONFLICT DO NOTHING RETURNING vacancy_id`, [c.var.auth!.user.id, id]);
  const exists = r.rowCount || (await c.var.db.query('SELECT 1 FROM favorites WHERE user_id = $1 AND vacancy_id = $2', [c.var.auth!.user.id, id])).rowCount;
  return exists ? c.json({ ok: true, favorite: true }) : apiError(c, 404, 'NOT_FOUND');
});
favorites.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  await c.var.db.query('DELETE FROM favorites WHERE user_id = $1 AND vacancy_id = $2', [c.var.auth!.user.id, id]);
  return c.json({ ok: true, favorite: false });
});
