import { Hono } from 'hono';
import { apiError, UUID_RE, type AppEnv, type Ctx } from '../lib/http';
import { loadAuth } from '../services/sessions';
import { audit, auditIf } from '../services/audit';
import { iso, TODAY, uniqueStamp } from '../lib/sql';
import { toVacancyDto, VACANCY_SELECT, type VacancyRow } from '../services/matching';
import { appBase } from '../services/emailLinks';
import { flushInstantEmails } from '../services/emailQueue';
import { runDigest } from '../services/digest';
import { backfillEmbeddings, embeddingsEnabled } from '../services/embeddings';
import { telegramConfigured, tgSetWebhook } from '../services/telegram';
import { notifyIf } from '../services/notify';
import { publishRequestedDrafts } from '../services/publish';

export const admin = new Hono<AppEnv>();

admin.use('*', async (c, next) => {
  const a = await loadAuth(c);
  if (!a) return apiError(c, 401, 'UNAUTHORIZED');
  if (a.user.role !== 'admin') return apiError(c, 403, 'FORBIDDEN');
  c.set('auth', a);
  await next();
});

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REJECTION_REASON_MAX = 500;
// verified accounts only (an employer that has not confirmed the e-mail yet is not up for review)
const VERIFIED = `u.role = 'employer' AND u.status <> 'unverified'`;

const COMPANY_COLS = `u.id, u.email, u.phone, u.status, u.created_at AS "createdAt", ep.company_name AS "companyName", ep.bin, ep.industry_key AS industry, ep.industry_other AS "industryOther",
  ep.size_key AS size, ep.city_key AS city, ep.city_other AS "cityOther", ep.contact_name AS "contactName", ep.contact_surname AS "contactSurname", ep.position,
  ep.website, ep.description, ep.review_status AS "reviewStatus", ep.rejection_reason AS "rejectionReason", ep.reviewed_at AS "reviewedAt", rv.email AS "reviewedBy",
  (SELECT count(*) FROM vacancies v WHERE v.employer_id = u.id) AS "vacancyCount",
  (SELECT count(*) FROM vacancies v WHERE v.employer_id = u.id AND v.status = 'published') AS "publishedCount"`;

/** Companies by review status (?status=pending|approved|rejected, default pending) + per-status counts for the tabs. */
admin.get('/employers', async (c) => {
  const status = (c.req.query('status') ?? 'pending') as ReviewStatus;
  if (!REVIEW_STATUSES.includes(status)) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { status: 'VALIDATION_FAILED' } });
  const { rows } = await c.var.db.query(
    `SELECT ${COMPANY_COLS}
     FROM users u JOIN employer_profiles ep ON ep.user_id = u.id LEFT JOIN users rv ON rv.id = ep.reviewed_by
     WHERE ${VERIFIED} AND ep.review_status = $1 ORDER BY ${status === 'pending' ? 'u.created_at' : 'ep.reviewed_at DESC'} LIMIT 200`,
    [status],
  );
  const counts = (await c.var.db.query<{ pending: number; approved: number; rejected: number }>(
    `SELECT count(*) FILTER (WHERE ep.review_status = 'pending') AS pending, count(*) FILTER (WHERE ep.review_status = 'approved') AS approved,
            count(*) FILTER (WHERE ep.review_status = 'rejected') AS rejected FROM users u JOIN employer_profiles ep ON ep.user_id = u.id WHERE ${VERIFIED}`)).rows[0];
  return c.json({ employers: rows, counts });
});

export const ADMIN_VACANCY_STATUSES = ['draft', 'published', 'closed', 'expired'] as const;
const VACANCY_PAGE = 20;
/**
 * One company with ALL its vacancies, drafts included (admins only — this router checks the role on every request; students keep seeing only
 * STUDENT_VISIBLE vacancies and employers only their own). ?status=draft|published|closed|expired (expired = published, deadline passed),
 * ?sort=newest|oldest (creation date), ?page=1…; counts per status for the filter.
 */
admin.get('/employers/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const status = c.req.query('status') ?? '', sort = c.req.query('sort') ?? 'newest', pageRaw = c.req.query('page') ?? '1';
  if (status !== '' && !(ADMIN_VACANCY_STATUSES as readonly string[]).includes(status)) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { status: 'VALIDATION_FAILED' } });
  if (sort !== 'newest' && sort !== 'oldest') return apiError(c, 400, 'VALIDATION_FAILED', { fields: { sort: 'VALIDATION_FAILED' } });
  if (!/^[0-9]{1,4}$/.test(pageRaw) || Number(pageRaw) < 1) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { page: 'VALIDATION_FAILED' } });
  const page = Number(pageRaw);
  const company = (await c.var.db.query(
    `SELECT ${COMPANY_COLS} FROM users u JOIN employer_profiles ep ON ep.user_id = u.id LEFT JOIN users rv ON rv.id = ep.reviewed_by WHERE u.id = $1 AND u.role = 'employer'`, [id])).rows[0];
  if (!company) return apiError(c, 404, 'NOT_FOUND');
  const expired = `(v.deadline IS NOT NULL AND v.deadline < ${TODAY})`;
  const dir = sort === 'oldest' ? 'ASC' : 'DESC';
  const params: unknown[] = [id, VACANCY_PAGE, (page - 1) * VACANCY_PAGE];
  let filter = '';
  if (status === 'expired') filter = `AND v.status = 'published' AND ${expired}`;
  else if (status === 'published') filter = `AND v.status = 'published' AND NOT ${expired}`;
  else if (status !== '') { params.push(status); filter = 'AND v.status = $4'; }
  // (the alias is not "expired": the db layer turns a column of that name into a boolean)
  const n = (await c.var.db.query<{ all: number; draft: number; published: number; closed: number; expired_n: number }>(
    `SELECT count(*) AS "all", count(*) FILTER (WHERE v.status = 'draft') AS draft, count(*) FILTER (WHERE v.status = 'published' AND NOT ${expired}) AS published,
            count(*) FILTER (WHERE v.status = 'closed') AS closed, count(*) FILTER (WHERE v.status = 'published' AND ${expired}) AS expired_n
     FROM vacancies v WHERE v.employer_id = $1`, [id])).rows[0];
  const counts: Record<string, number> = { all: n.all, draft: n.draft, published: n.published, closed: n.closed, expired: n.expired_n };
  const { rows } = await c.var.db.query<VacancyRow>(
    `${VACANCY_SELECT.replace('FROM vacancies v', ", (SELECT count(*) FROM applications a WHERE a.vacancy_id = v.id AND a.status <> 'withdrawn') AS applicants FROM vacancies v")}
     WHERE v.employer_id = $1 ${filter} ORDER BY v.created_at ${dir}, v.id ${dir} LIMIT $2 OFFSET $3`, params);
  const total = status === '' ? counts.all : counts[status];
  return c.json({ company, vacancies: rows.map(toVacancyDto), counts, total, page, pageSize: VACANCY_PAGE });
});

/**
 * Approve (from pending or rejected) or reject (from pending, optional reason). Rejecting keeps the account signed-in-able (status 'pending')
 * so the employer sees the reason; approving activates it, which is what unlocks publishing. All writes commit atomically, tied to one stamp.
 */
async function review(c: Ctx, to: 'approved' | 'rejected') {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  let reason: string | null = null;
  const text = to === 'rejected' ? (await c.req.text()).trim() : '';
  if (text) { // the body ({ reason }) is optional
    if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return apiError(c, 415, 'UNSUPPORTED_MEDIA_TYPE');
    let body: unknown;
    try { body = JSON.parse(text); } catch { return apiError(c, 400, 'INVALID_JSON'); }
    const raw = (body as { reason?: unknown } | null)?.reason;
    if (raw !== undefined && raw !== null && typeof raw !== 'string') return apiError(c, 400, 'VALIDATION_FAILED', { fields: { reason: 'VALIDATION_FAILED' } });
    reason = typeof raw === 'string' ? raw.normalize('NFC').trim() || null : null;
    if (reason && Array.from(reason).length > REJECTION_REASON_MAX) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { reason: 'REJECTION_REASON_TOO_LONG' } });
  }
  const admin = c.var.auth!.user;
  const stamp = uniqueStamp(), now = iso();
  const proof = 'SELECT 1 FROM users WHERE id = $5 AND updated_at = $6';
  const pp = [id, stamp];
  const claim = to === 'approved'
    // 'blocked' + rejected = a company rejected before rejections kept the account usable
    ? `UPDATE users SET status = 'active', updated_at = $2 WHERE id = $1 AND role = 'employer'
         AND ((status = 'pending' AND EXISTS (SELECT 1 FROM employer_profiles WHERE user_id = $1 AND review_status IN ('pending', 'rejected')))
           OR (status = 'blocked' AND EXISTS (SELECT 1 FROM employer_profiles WHERE user_id = $1 AND review_status = 'rejected'))) RETURNING id`
    : `UPDATE users SET updated_at = $2 WHERE id = $1 AND role = 'employer' AND status = 'pending'
         AND EXISTS (SELECT 1 FROM employer_profiles WHERE user_id = $1 AND review_status = 'pending') RETURNING id`;
  const rs = await c.var.db.batch([
    { sql: claim, params: [id, stamp] },
    { sql: `UPDATE employer_profiles SET review_status = $2, rejection_reason = $3, reviewed_by = $4, reviewed_at = $5 WHERE user_id = $1 AND EXISTS (SELECT 1 FROM users WHERE id = $1 AND updated_at = $6)`,
      params: [id, to, reason, admin.id, now, stamp] },
    to === 'approved'
      ? notifyIf(proof, pp, id, 'employer_approved', {}, '/vacancies/mine')
      : notifyIf(proof, pp, id, 'employer_rejected', reason ? { reason } : {}, '/vacancies/mine'),
    auditIf('SELECT 1 FROM users WHERE id = $7 AND updated_at = $8', pp, { id: admin.id, role: 'admin' }, to === 'approved' ? 'employer.approve' : 'employer.reject', { type: 'user', id }, to === 'rejected' ? { withReason: !!reason } : {}),
  ]);
  if (rs[0].rowCount === 0) return apiError(c, 404, 'NOT_FOUND');
  // drafts the employer asked to publish while waiting go live now (the cron sweep retries anything that fails here)
  let published = 0;
  if (to === 'approved') {
    try { published = await publishRequestedDrafts(c.var.db, c.env, id, { id: admin.id, role: 'admin' }); }
    catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'publish after approval failed', detail: (e as Error).message })); }
  }
  return c.json({ ok: true, status: to === 'approved' ? 'active' : 'pending', reviewStatus: to, rejectionReason: reason, published });
}
admin.post('/employers/:id/approve', (c) => review(c, 'approved'));
admin.post('/employers/:id/reject', (c) => review(c, 'rejected'));

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
