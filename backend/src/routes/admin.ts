import { Hono } from 'hono';
import { apiError, UUID_RE, type AppEnv, type Ctx } from '../lib/http';
import { loadAuth } from '../services/sessions';
import { audit, auditIf } from '../services/audit';
import { iso, uniqueStamp } from '../lib/sql';
import { appBase } from '../services/emailLinks';
import { flushInstantEmails } from '../services/emailQueue';
import { runDigest } from '../services/digest';
import { backfillEmbeddings, embeddingsEnabled } from '../services/embeddings';
import { telegramConfigured, tgSetWebhook } from '../services/telegram';
import { notifyIf } from '../services/notify';

export const admin = new Hono<AppEnv>();

admin.use('*', async (c, next) => {
  const a = await loadAuth(c);
  if (!a) return apiError(c, 401, 'UNAUTHORIZED');
  if (a.user.role !== 'admin') return apiError(c, 403, 'FORBIDDEN');
  c.set('auth', a);
  await next();
});

admin.get('/employers', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  if (!['pending', 'active', 'blocked'].includes(status)) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { status: 'VALIDATION_FAILED' } });
  const { rows } = await c.var.db.query(
    `SELECT u.id, u.email, u.status, u.created_at AS "createdAt", ep.company_name AS "companyName", ep.bin, ep.contact_name AS "contactName", ep.contact_surname AS "contactSurname"
     FROM users u JOIN employer_profiles ep ON ep.user_id = u.id WHERE u.role = 'employer' AND u.status = $1 ORDER BY u.created_at LIMIT 200`,
    [status],
  );
  return c.json({ employers: rows });
});

async function setStatus(c: Ctx, from: string, to: string) {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const stamp = uniqueStamp();
  const proof = 'SELECT 1 FROM users WHERE id = $5 AND status = $6 AND updated_at = $7';
  const pp = [id, to, stamp];
  const rs = await c.var.db.batch([
    { sql: `UPDATE users SET status = $3, updated_at = $4 WHERE id = $1 AND role = 'employer' AND status = $2 RETURNING id`, params: [id, from, to, stamp] },
    ...(to === 'active' ? [notifyIf(proof, pp, id, 'employer_approved', {}, '/vacancies/mine')] : []),
    auditIf('SELECT 1 FROM users WHERE id = $7 AND status = $8 AND updated_at = $9', pp, { id: c.var.auth!.user.id, role: 'admin' }, to === 'active' ? 'employer.approve' : 'employer.reject', { type: 'user', id }),
  ]);
  const ok = rs[0].rowCount > 0;
  return ok ? c.json({ ok: true, status: to }) : apiError(c, 404, 'NOT_FOUND');
}
admin.post('/employers/:id/approve', (c) => setStatus(c, 'pending', 'active'));
admin.post('/employers/:id/reject', (c) => setStatus(c, 'pending', 'blocked'));

/** Platform analytics (US-12). */
admin.get('/analytics', async (c) => {
  const q = c.var.db;
  const one = async <T>(sql: string) => (await q.query<T>(sql)).rows[0];
  const users = await one<{ students: number; employers_active: number; employers_pending: number; unverified: number }>(
    `SELECT count(*) FILTER (WHERE role = 'student' AND status = 'active') AS students, count(*) FILTER (WHERE role = 'employer' AND status = 'active') AS employers_active,
            count(*) FILTER (WHERE role = 'employer' AND status = 'pending') AS employers_pending, count(*) FILTER (WHERE status = 'unverified') AS unverified FROM users`);
  const vac = await one<{ published: number; draft: number; closed: number }>(
    `SELECT count(*) FILTER (WHERE status = 'published') AS published, count(*) FILTER (WHERE status = 'draft') AS draft, count(*) FILTER (WHERE status = 'closed') AS closed FROM vacancies`);
  const apps = await one<{ total: number; accepted: number }>(`SELECT count(*) AS total, count(*) FILTER (WHERE status = 'accepted') AS accepted FROM applications`);
  const match = await one<{ total: number; avg: number | null; strong: number }>(`SELECT count(*) AS total, round(avg(percent), 1) AS avg, count(*) FILTER (WHERE percent >= 80) AS strong FROM matches`);
  const funnel = (await q.query<{ status: string; n: number }>('SELECT status, count(*) AS n FROM applications GROUP BY status')).rows;
  const series = (await q.query<{ day: string; registrations: number; applications: number; vacancies: number }>(
    `WITH RECURSIVE d(day) AS (SELECT date('now', '-29 days') UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < date('now'))
     SELECT day,
       (SELECT count(*) FROM users u WHERE substr(u.created_at, 1, 10) = day AND u.status <> 'unverified') AS registrations,
       (SELECT count(*) FROM applications a WHERE substr(a.created_at, 1, 10) = day) AS applications,
       (SELECT count(*) FROM vacancies v WHERE substr(v.published_at, 1, 10) = day) AS vacancies
     FROM d ORDER BY day`)).rows;
  const wanted = (await q.query<{ name: string; n: number }>(
    `SELECT s.name, count(*) AS n FROM vacancy_skills vs JOIN skills s ON s.id = vs.skill_id JOIN vacancies v ON v.id = vs.vacancy_id WHERE v.status <> 'draft' GROUP BY s.name ORDER BY n DESC, s.name LIMIT 10`)).rows;
  const held = (await q.query<{ name: string; n: number }>(
    `SELECT s.name, count(*) AS n FROM student_skills ss JOIN skills s ON s.id = ss.skill_id GROUP BY s.name ORDER BY n DESC, s.name LIMIT 10`)).rows;
  return c.json({
    users: { students: users.students, employersActive: users.employers_active, employersPending: users.employers_pending, unverified: users.unverified },
    vacancies: vac, applications: apps, matches: { total: match.total, average: match.avg === null ? null : Number(match.avg), strong: match.strong },
    funnel, series, topSkillsWanted: wanted, topSkillsHeld: held,
  });
});

/** Audit trail, newest first. Cursor pagination: pass the last `id` as ?before=. Optional ?action= filter. */
admin.get('/audit', async (c) => {
  const limitRaw = c.req.query('limit'), before = c.req.query('before'), action = c.req.query('action');
  const limit = limitRaw === undefined ? 50 : /^[0-9]{1,3}$/.test(limitRaw) ? Number(limitRaw) : 0;
  if (limit < 1 || limit > 100) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { limit: 'VALIDATION_FAILED' } });
  if (before !== undefined && !/^[0-9]{1,15}$/.test(before)) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { before: 'VALIDATION_FAILED' } });
  if (action !== undefined && !/^[a-z_.]{1,40}$/.test(action)) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { action: 'VALIDATION_FAILED' } });
  const params: unknown[] = [limit + 1];
  const where: string[] = [];
  if (before !== undefined) { params.push(before); where.push(`a.id < CAST($${params.length} AS INTEGER)`); }
  if (action !== undefined) { params.push(action); where.push(`a.action = $${params.length}`); }
  const { rows } = await c.var.db.query<{ id: string; at: string; actor_id: string | null; actor_role: string | null; email: string | null; action: string; target_type: string | null; target_id: string | null; meta: unknown }>(
    `SELECT CAST(a.id AS TEXT) AS id, a.created_at AS at, a.actor_id, a.actor_role, u.email, a.action, a.target_type, a.target_id, a.meta
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT $1`, params);
  const page = rows.slice(0, limit);
  return c.json({
    items: page.map((r) => ({ id: r.id, at: r.at, actor: r.actor_id ? { id: r.actor_id, role: r.actor_role, email: r.email } : { id: null, role: r.actor_role, email: null }, action: r.action, target: r.target_type ? { type: r.target_type, id: r.target_id } : null, meta: r.meta })),
    next: rows.length > limit ? page[page.length - 1].id : null,
  });
});

/** Runs the weekly digest and flushes pending instant e-mails now (the Cron Trigger does this on schedule). Safe to repeat: users are claimed with a compare-and-set and mailed at most once per 6 days. */
admin.post('/digest/run', async (c) => {
  const base = appBase(c.env, new URL(c.req.url).origin);
  const digest = await runDigest(c.var.db, c.env, { base, limit: 200 });
  const instant = await flushInstantEmails(c.var.db, c.env, base, 100);
  await audit(c.var.db, { id: c.var.auth!.user.id, role: 'admin' }, 'digest.run', null, { sent: digest.sent, considered: digest.considered, instant: instant.sent });
  return c.json({ digest, instant });
});

/** Registers /api/telegram/webhook with Telegram (secret_token = TELEGRAM_WEBHOOK_SECRET). Run once after setting the bot secrets. */
admin.post('/telegram/webhook', async (c) => {
  if (!telegramConfigured(c.env)) return apiError(c, 503, 'TELEGRAM_UNAVAILABLE');
  const ok = await tgSetWebhook(c.env, `${appBase(c.env, new URL(c.req.url).origin)}/api/telegram/webhook`);
  return ok ? c.json({ ok: true }) : apiError(c, 503, 'TELEGRAM_UNAVAILABLE');
});

/** Embeds vacancies/students that have no semantic vector yet (also run by the cron). Safe to repeat. */
admin.post('/embeddings/backfill', async (c) => {
  if (!embeddingsEnabled(c.env)) return apiError(c, 503, 'AI_UNAVAILABLE');
  return c.json(await backfillEmbeddings(c.var.db, c.env, 100));
});
