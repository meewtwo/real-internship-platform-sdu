import { Hono } from 'hono';
import { clientIp, apiError, type AppEnv } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { STUDENT_VISIBLE, toVacancyDto, VACANCY_SELECT, type VacancyRow } from '../services/matching';

/** Public (no login) data for the landing page: latest vacancies and headline numbers. No personal data. */
export const publicApi = new Hono<AppEnv>();
publicApi.get('/home', async (c) => {
  const rl = await rateLimit(c.var.db, c.env, `pub:${clientIp(c)}`, 120, 60);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const { rows } = await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} WHERE ${STUDENT_VISIBLE} ORDER BY v.published_at DESC LIMIT 9`);
  const n = (await c.var.db.query<{ v: number; e: number; s: number }>(
    `SELECT (SELECT count(*) FROM vacancies v JOIN employer_profiles ep ON ep.user_id = v.employer_id WHERE ${STUDENT_VISIBLE}) AS v, (SELECT count(*) FROM users WHERE role = 'employer' AND status = 'active') AS e, (SELECT count(*) FROM users WHERE role = 'student' AND status = 'active') AS s`)).rows[0];
  return c.json({ vacancies: rows.map((r) => ({ ...toVacancyDto(r), description: r.description.slice(0, 220) })), stats: { vacancies: n.v, employers: n.e, students: n.s } });
});

/** A résumé its owner chose to share: unauthenticated, unlisted (random slug), not indexable. Contact details are hidden unless the owner opted in. */
publicApi.get('/resume/:slug', async (c) => {
  const rl = await rateLimit(c.var.db, c.env, `pubres:${clientIp(c)}`, 60, 60);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const slug = c.req.param('slug');
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) return apiError(c, 404, 'NOT_FOUND');
  const r = (await c.var.db.query<{ title: string; template: string; language: string; data: Record<string, any>; public_contact: boolean; updated_at: string }>(
    'SELECT title, template, language, data, public_contact, updated_at FROM resume_docs WHERE public_slug = $1', [slug])).rows[0];
  if (!r) return apiError(c, 404, 'NOT_FOUND');
  const data = { ...r.data, personal: { ...r.data.personal, ...(r.public_contact ? {} : { email: '', phone: '' }) } };
  return c.json({ resume: { title: r.title, template: r.template, language: r.language, data, updatedAt: r.updated_at } });
});

/** Public runtime config for the SPA (nothing secret): whether to show the captcha and with which site key. */
publicApi.get('/config', (c) => c.json({ turnstileSiteKey: c.env.TURNSTILE_SECRET && c.env.TURNSTILE_SITEKEY ? c.env.TURNSTILE_SITEKEY : null }));
