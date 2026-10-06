import { Hono } from 'hono';
import { validateInterviewProposal } from '@sdu/shared';
import { buildIcs } from '../lib/ics';
import { asDbError } from '../lib/db';
import { requireAuth } from '../lib/guard';
import { apiError, readJson, UUID_RE, type AppEnv, type Ctx } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { appEventStmt, iso, uniqueStamp } from '../lib/sql';
import { notifyIf } from '../services/notify';
import { counterpartId, counterpartName, myName, party } from './messages';

export const interviews = new Hono<AppEnv>();
interviews.use('*', requireAuth('student', 'employer'));

/** "2026-10-12 15:30" in Almaty time — the zone both sides use; calendars receive UTC via .ics. */
const when = (isoTs: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(isoTs)).replace(',', '');
const endOf = (startIso: string, mins: number) => new Date(Date.parse(startIso) + mins * 60_000).toISOString();
/** SQL expression for the end instant of interview alias `i`. */
const END_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', i.starts_at, '+' || i.duration_min || ' minutes')";

interface Row { id: string; application_id: string; proposed_by: string; starts_at: string; duration_min: number; format: string; location: string; note: string | null; status: string; created_at: string; title: string; company: string; student_id: string; employer_id: string; name: string; surname: string }
const SELECT = `SELECT i.id, i.application_id, i.proposed_by, i.starts_at, i.duration_min, i.format, i.location, i.note, i.status, i.created_at, v.title, ep.company_name AS company, a.student_id, v.employer_id, sp.name, sp.surname
  FROM interviews i JOIN applications a ON a.id = i.application_id JOIN vacancies v ON v.id = a.vacancy_id JOIN employer_profiles ep ON ep.user_id = v.employer_id JOIN student_profiles sp ON sp.user_id = a.student_id`;
const dto = (r: Row, me: string) => ({
  id: r.id, applicationId: r.application_id, startsAt: r.starts_at, durationMin: r.duration_min, format: r.format, location: r.location, note: r.note, status: r.status,
  vacancy: { title: r.title }, counterpart: r.student_id === me ? r.company : `${r.name} ${r.surname}`, role: r.student_id === me ? 'student' : 'employer', proposedByMe: r.proposed_by === me,
});
async function mine(c: Ctx, id: string): Promise<Row | null> {
  if (!UUID_RE.test(id)) return null;
  const me = c.var.auth!.user.id;
  return (await c.var.db.query<Row>(`${SELECT} WHERE i.id = $1 AND (a.student_id = $2 OR v.employer_id = $2)`, [id, me])).rows[0] ?? null;
}

/** Upcoming first, then past. */
interviews.get('/', async (c) => {
  const me = c.var.auth!.user.id;
  const { rows } = await c.var.db.query<Row>(`${SELECT} WHERE a.student_id = $1 OR v.employer_id = $1 ORDER BY (i.starts_at < $2), i.starts_at LIMIT 200`, [me, iso()]);
  return c.json({ interviews: rows.map((r) => dto(r, me)) });
});

/** Employer proposes a slot for one of their applicants. The overlap check lives inside the INSERT, so two simultaneous proposals cannot both win. */
interviews.post('/', requireAuth('employer'), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateInterviewProposal(body.body);
  if (!v.ok) return apiError(c, 400, v.code ?? 'VALIDATION_FAILED', { fields: v.fields });
  const d = v.data;
  const p = await party(c, d.applicationId);
  if (!p || p.mine !== 'employer') return apiError(c, 404, 'NOT_FOUND');
  if (!['applied', 'viewed', 'shortlisted', 'interview', 'accepted'].includes(p.status)) return apiError(c, 409, 'INTERVIEW_STATE_INVALID');
  const me = c.var.auth!.user.id;
  const rl = await rateLimit(c.var.db, c.env, `intv:${me}`, 30, 86400);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const id = crypto.randomUUID();
  try {
    const [ins] = await c.var.db.batch([
      { sql: `INSERT INTO interviews (id, application_id, proposed_by, starts_at, duration_min, format, location, note)
              SELECT $1, $2, $3, $4, $5, $6, $7, $8
              WHERE NOT EXISTS (SELECT 1 FROM interviews i JOIN applications a ON a.id = i.application_id JOIN vacancies v ON v.id = a.vacancy_id
                                WHERE v.employer_id = $3 AND i.status IN ('proposed', 'accepted') AND i.starts_at < $9 AND ${END_SQL} > $4)
              RETURNING id`, params: [id, p.id, me, d.startsAt, d.durationMin, d.format, d.location, d.note, endOf(d.startsAt, d.durationMin)] },
      notifyIf('SELECT 1 FROM interviews WHERE id = $5', [id], p.studentId, 'interview_update', { title: p.title, from: p.company, state: 'proposed', when: when(d.startsAt) }, `/messages/${p.id}`),
    ]);
    if (!ins.rowCount) return apiError(c, 409, 'INTERVIEW_CONFLICT');
    return c.json({ interview: dto((await mine(c, id))!, me) }, 201);
  } catch (e) {
    if (asDbError(e).code === '23505') return apiError(c, 409, 'INTERVIEW_ACTIVE_EXISTS');
    throw e;
  }
});

/** Candidate accepts or declines a proposal. Accepting moves the application to "interview" and refuses a time that clashes with their other interviews. */
interviews.post('/:id/respond', requireAuth('student'), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => k !== 'accept') || typeof o.accept !== 'boolean') return apiError(c, 400, 'VALIDATION_FAILED');
  const row = await mine(c, c.req.param('id'));
  if (!row || row.student_id !== c.var.auth!.user.id) return apiError(c, 404, 'INTERVIEW_NOT_FOUND');
  const me = c.var.auth!.user.id;
  const stamp = uniqueStamp();
  const state = o.accept ? 'accepted' : 'declined';
  const clash = o.accept ? `AND NOT EXISTS (SELECT 1 FROM interviews i JOIN applications a ON a.id = i.application_id WHERE a.student_id = $5 AND i.id <> $1 AND i.status = 'accepted'
                            AND i.starts_at < $6 AND ${END_SQL} > $7)` : '';
  const params: unknown[] = [row.id, state, stamp, stamp, ...(o.accept ? [me, endOf(row.starts_at, row.duration_min), row.starts_at] : [])];
  const proof = 'SELECT 1 FROM interviews WHERE id = $5 AND status = $6 AND updated_at = $7';
  const pp = [row.id, state, stamp];
  const stmts = [
    { sql: `UPDATE interviews SET status = $2, updated_at = $3 WHERE id = $1 AND status = 'proposed' AND starts_at > $4 ${clash} RETURNING id`, params },
    ...(o.accept ? [
      { sql: `UPDATE applications SET status = 'interview' WHERE id = $1 AND status IN ('applied', 'viewed', 'shortlisted') AND EXISTS (SELECT 1 FROM interviews WHERE id = $2 AND status = 'accepted' AND updated_at = $3)`, params: [row.application_id, row.id, stamp] },
      appEventStmt(row.application_id, 'interview'),
    ] : []),
    notifyIf(proof, pp, row.employer_id, 'interview_update', { title: row.title, from: `${row.name} ${row.surname}`, state, when: when(row.starts_at) }, `/messages/${row.application_id}`),
  ];
  const rs = await c.var.db.batch(stmts);
  if (!rs[0].rowCount) {
    const cur = await mine(c, row.id);
    // not applied: either it is no longer a live proposal / already started, or (accepting) it overlaps another confirmed interview
    return apiError(c, 409, o.accept && cur?.status === 'proposed' && Date.parse(cur.starts_at) > Date.now() ? 'INTERVIEW_CONFLICT' : 'INTERVIEW_STATE_INVALID');
  }
  return c.json({ interview: dto((await mine(c, row.id))!, me) });
});

/** Either side can cancel a proposal/confirmed interview that has not started yet. */
interviews.post('/:id/cancel', async (c) => {
  const row = await mine(c, c.req.param('id'));
  if (!row) return apiError(c, 404, 'INTERVIEW_NOT_FOUND');
  const me = c.var.auth!.user.id;
  const p = (await party(c, row.application_id))!;
  const stamp = uniqueStamp();
  const rs = await c.var.db.batch([
    { sql: `UPDATE interviews SET status = 'cancelled', updated_at = $2 WHERE id = $1 AND status IN ('proposed', 'accepted') AND starts_at > $3 RETURNING id`, params: [row.id, stamp, stamp] },
    notifyIf("SELECT 1 FROM interviews WHERE id = $5 AND status = 'cancelled' AND updated_at = $6", [row.id, stamp], counterpartId(p), 'interview_update', { title: row.title, from: myName(p), state: 'cancelled', when: when(row.starts_at) }, `/messages/${row.application_id}`),
  ]);
  return rs[0].rowCount ? c.json({ interview: dto((await mine(c, row.id))!, me) }) : apiError(c, 409, 'INTERVIEW_STATE_INVALID');
});

/** Calendar file for a participant (add to Google/Apple/Outlook). Cancelled interviews export as CANCELLED so calendars remove them. */
interviews.get('/:id/ics', async (c) => {
  const row = await mine(c, c.req.param('id'));
  if (!row) return apiError(c, 404, 'INTERVIEW_NOT_FOUND');
  const p = (await party(c, row.application_id))!;
  const ics = buildIcs({
    uid: row.id, start: new Date(row.starts_at), durationMin: row.duration_min, sequence: row.status === 'cancelled' ? 1 : 0,
    summary: `Interview: ${row.title} — ${counterpartName(p)}`, location: row.location,
    description: [`${row.format}`, row.note ?? '', `Vacancy: ${row.title}`].filter(Boolean).join('\n'),
    status: row.status === 'accepted' ? 'CONFIRMED' : row.status === 'proposed' ? 'TENTATIVE' : 'CANCELLED',
  });
  return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="interview.ics"', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } });
});
