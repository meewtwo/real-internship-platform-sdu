import { Hono } from 'hono';
import { validateMessage } from '@sdu/shared';
import { requireAuth } from '../lib/guard';
import { apiError, readJson, UUID_RE, type AppEnv, type Ctx } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { iso } from '../lib/sql';

export const messages = new Hono<AppEnv>();
messages.use('*', requireAuth('student', 'employer'));

/** Statuses in which the two sides may still talk. Rejected/withdrawn applications are read-only history. */
const OPEN = ['applied', 'viewed', 'shortlisted', 'interview', 'accepted'];

interface Party { id: string; status: string; studentId: string; employerId: string; vacancyId: string; title: string; company: string; studentName: string; mine: 'student' | 'employer' }
export async function party(c: Ctx, appId: string): Promise<Party | null> {
  if (!UUID_RE.test(appId)) return null;
  const me = c.var.auth!.user.id;
  const r = (await c.var.db.query<{ id: string; status: string; student_id: string; employer_id: string; vacancy_id: string; title: string; company: string; name: string; surname: string }>(
    `SELECT a.id, a.status, a.student_id, v.employer_id, v.id AS vacancy_id, v.title, ep.company_name AS company, sp.name, sp.surname
     FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN employer_profiles ep ON ep.user_id = v.employer_id JOIN student_profiles sp ON sp.user_id = a.student_id
     WHERE a.id = $1 AND (a.student_id = $2 OR v.employer_id = $2)`, [appId, me])).rows[0];
  return r ? { id: r.id, status: r.status, studentId: r.student_id, employerId: r.employer_id, vacancyId: r.vacancy_id, title: r.title, company: r.company, studentName: `${r.name} ${r.surname}`, mine: r.student_id === me ? 'student' : 'employer' } : null;
}
export const counterpartName = (p: Party) => (p.mine === 'student' ? p.company : p.studentName);
export const counterpartId = (p: Party) => (p.mine === 'student' ? p.employerId : p.studentId);
export const myName = (p: Party) => (p.mine === 'student' ? p.studentName : p.company);

/** Conversations the user takes part in (those with at least one message), newest activity first, with unread counts. */
messages.get('/threads', async (c) => {
  const me = c.var.auth!.user.id;
  const { rows } = await c.var.db.query<{ id: string; status: string; vacancy_id: string; title: string; company: string; name: string; surname: string; mine: string; body: string; at: string; sender_id: string; unread: number }>(
    `SELECT a.id, a.status, v.id AS vacancy_id, v.title, ep.company_name AS company, sp.name, sp.surname,
            CASE WHEN a.student_id = $1 THEN 'student' ELSE 'employer' END AS mine,
            lm.body, lm.created_at AS at, lm.sender_id,
            (SELECT count(*) FROM application_messages m WHERE m.application_id = a.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
     FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN employer_profiles ep ON ep.user_id = v.employer_id JOIN student_profiles sp ON sp.user_id = a.student_id
     JOIN application_messages lm ON lm.id = (SELECT max(m.id) FROM application_messages m WHERE m.application_id = a.id)
     WHERE a.student_id = $1 OR v.employer_id = $1 ORDER BY lm.created_at DESC LIMIT 100`, [me]);
  return c.json({ threads: rows.map((r) => ({
    applicationId: r.id, status: r.status, vacancy: { id: r.vacancy_id, title: r.title },
    counterpart: r.mine === 'student' ? r.company : `${r.name} ${r.surname}`,
    last: { body: r.body.slice(0, 160), at: r.at, mine: r.sender_id === me }, unread: r.unread,
  })) });
});

messages.get('/unread', async (c) => {
  const me = c.var.auth!.user.id;
  const n = (await c.var.db.query<{ n: number }>(
    `SELECT count(*) AS n FROM application_messages m JOIN applications a ON a.id = m.application_id JOIN vacancies v ON v.id = a.vacancy_id
     WHERE m.sender_id <> $1 AND m.read_at IS NULL AND (a.student_id = $1 OR v.employer_id = $1)`, [me])).rows[0].n;
  return c.json({ unread: n });
});

/** Messages of one application (all, or only those after `?after=<id>` for cheap polling). Reading marks the other side's messages as read. */
messages.get('/:applicationId', async (c) => {
  const p = await party(c, c.req.param('applicationId'));
  if (!p) return apiError(c, 404, 'NOT_FOUND');
  const afterRaw = c.req.query('after');
  if (afterRaw !== undefined && !/^[0-9]{1,15}$/.test(afterRaw)) return apiError(c, 400, 'VALIDATION_FAILED');
  const me = c.var.auth!.user.id;
  await c.var.db.query('UPDATE application_messages SET read_at = $3 WHERE application_id = $1 AND sender_id <> $2 AND read_at IS NULL', [p.id, me, iso()]);
  const { rows } = await c.var.db.query<{ id: string; sender_id: string; body: string; created_at: string; read_at: string | null }>(
    `SELECT CAST(id AS TEXT) AS id, sender_id, body, created_at, read_at FROM application_messages WHERE application_id = $1 ${afterRaw ? 'AND id > CAST($2 AS INTEGER)' : ''} ORDER BY id ASC LIMIT 500`, afterRaw ? [p.id, afterRaw] : [p.id]);
  return c.json({
    messages: rows.map((m) => ({ id: m.id, mine: m.sender_id === me, body: m.body, at: m.created_at, read: m.read_at !== null })),
    counterpart: counterpartName(p), role: p.mine, status: p.status, canSend: OPEN.includes(p.status), vacancy: { id: p.vacancyId, title: p.title },
  });
});

messages.post('/:applicationId', async (c) => {
  const p = await party(c, c.req.param('applicationId'));
  if (!p) return apiError(c, 404, 'NOT_FOUND');
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => k !== 'body')) return apiError(c, 400, 'UNKNOWN_FIELDS');
  const v = validateMessage(o.body);
  if (!v.ok) return apiError(c, 400, v.code ?? 'MESSAGE_INVALID');
  if (!OPEN.includes(p.status)) return apiError(c, 409, 'MESSAGE_NOT_ALLOWED');
  const me = c.var.auth!.user.id;
  const rl = await rateLimit(c.var.db, c.env, `msg:${me}`, 60, 3600);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const to = counterpartId(p), link = `/messages/${p.id}`;
  // one batch: the message and (only if the recipient has no unread "new message" for this conversation yet) its notification — a burst of
  // messages must not become a burst of e-mails/pings
  const [ins] = await c.var.db.batch([
    { sql: 'INSERT INTO application_messages (application_id, sender_id, body) VALUES ($1, $2, $3) RETURNING CAST(id AS TEXT) AS id, created_at', params: [p.id, me, v.data] },
    { sql: `INSERT INTO notifications (user_id, kind, params, link) SELECT $1, 'new_message', $2, $3
            WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'new_message' AND link = $3 AND read_at IS NULL)`, params: [to, JSON.stringify({ title: p.title, from: myName(p) }), link] },
  ]);
  const msg = ins.rows[0] as { id: string; created_at: string };
  return c.json({ message: { id: msg.id, mine: true, body: v.data, at: msg.created_at, read: false } }, 201);
});
