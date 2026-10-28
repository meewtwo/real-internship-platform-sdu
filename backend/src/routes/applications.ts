import { Hono } from 'hono';
import { validateStatusChange } from '@sdu/shared';
import { requireAuth } from '../lib/guard';
import { apiError, readJson, UUID_RE, type AppEnv } from '../lib/http';
import { auditIf } from '../services/audit';
import { appEventStmt, iso, uniqueStamp } from '../lib/sql';
import { notifyIf } from '../services/notify';
import { cvResponse } from './cv';
import { loadCvBytes } from '../services/cvStore';
import { rankedApplicants } from './vacancies';

export const applications = new Hono<AppEnv>();

/** Student: my applications with status history. */
applications.get('/', requireAuth('student'), async (c) => {
  const { rows } = await c.var.db.query(
    `SELECT a.id, a.status, a.match_percent, a.cover_note, a.created_at, a.updated_at, v.id AS vacancy_id, v.title, v.kind, v.status AS vacancy_status, ep.company_name,
            COALESCE((SELECT json_group_array(json_object('status', status, 'at', created_at)) FROM (SELECT status, created_at FROM application_events e WHERE e.application_id = a.id ORDER BY e.id)), '[]') AS events
     FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN employer_profiles ep ON ep.user_id = v.employer_id
     WHERE a.student_id = $1 ORDER BY a.updated_at DESC LIMIT 200`,
    [c.var.auth!.user.id],
  );
  return c.json({ applications: rows.map((r: any) => ({
    id: r.id, status: r.status, matchPercent: r.match_percent, coverNote: r.cover_note, createdAt: r.created_at, updatedAt: r.updated_at,
    vacancy: { id: r.vacancy_id, title: r.title, kind: r.kind, status: r.vacancy_status, company: r.company_name }, events: r.events,
  })) });
});

applications.post('/:id/withdraw', requireAuth('student'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const rs = await c.var.db.batch([
    { sql: `UPDATE applications SET status = 'withdrawn' WHERE id = $1 AND student_id = $2 AND status NOT IN ('withdrawn', 'accepted', 'rejected') RETURNING id`, params: [id, c.var.auth!.user.id] },
    appEventStmt(id, 'withdrawn'),
  ]);
  return rs[0].rowCount > 0 ? c.json({ ok: true }) : apiError(c, 404, 'NOT_FOUND');
});

/** Employer: every applicant of every own vacancy, ranked by match % (US-10). */
applications.get('/employer', requireAuth('employer'), async (c) => {
  const ids = (await c.var.db.query<{ id: string }>('SELECT id FROM vacancies WHERE employer_id = $1', [c.var.auth!.user.id])).rows.map((r) => r.id);
  return c.json({ applicants: ids.length ? await rankedApplicants(c, ids) : [] });
});

/** Employer: change an applicant's status; the student is notified (US-11). */
applications.patch('/:id/status', requireAuth('employer'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateStatusChange(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const me = c.var.auth!.user.id;
  let res: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'OK' = 'OK';
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = (await c.var.db.query<{ status: string; student_id: string; title: string; company: string }>(
      `SELECT a.status, a.student_id, v.title, ep.company_name AS company FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN employer_profiles ep ON ep.user_id = v.employer_id
       WHERE a.id = $1 AND v.employer_id = $2`, [id, me])).rows[0];
    if (!a) { res = 'NOT_FOUND'; break; }
    if (a.status === 'withdrawn') { res = 'INVALID_TRANSITION'; break; }
    if (a.status === v.data.status) { res = 'OK'; break; }
    // compare-and-set on the status we just read; the stamp in updated_at proves to the following statements that THIS batch won
    const stamp = uniqueStamp();
    const proof = 'SELECT 1 FROM applications WHERE id = $5 AND status = $6 AND updated_at = $7';
    const pp = [id, v.data.status, stamp];
    const rs = await c.var.db.batch([
      { sql: `UPDATE applications SET status = $2, updated_at = $3 WHERE id = $1 AND status = $4 RETURNING id`, params: [id, v.data.status, stamp, a.status] },
      appEventStmt(id, v.data.status),
      notifyIf(proof, pp, a.student_id, 'status_changed', { title: a.title, company: a.company, status: v.data.status }, '/applications'),
      auditIf(`SELECT 1 FROM applications WHERE id = $7 AND status = $8 AND updated_at = $9`, pp, { id: me, role: 'employer' }, 'application.status', { type: 'application', id }, { from: a.status, to: v.data.status }),
    ]);
    if (rs[0].rowCount) { res = 'OK'; break; }
    // somebody else changed the status in between: re-read and decide again
  }
  if (res === 'NOT_FOUND') return apiError(c, 404, 'NOT_FOUND');
  if (res === 'INVALID_TRANSITION') return apiError(c, 409, 'INVALID_TRANSITION');
  return c.json({ ok: true, status: v.data.status });
});

/** The applicant's CV: only the vacancy owner (or the student) may download it. */
applications.get('/:id/cv', requireAuth('employer', 'student'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const u = c.var.auth!.user;
  const { rows } = await c.var.db.query<{ user_id: string; filename: string; mime: string; size_bytes: number; content: Uint8Array | null; storage_key: string | null }>(
    `SELECT cv.user_id, cv.filename, cv.mime, cv.size_bytes, cv.content, cv.storage_key FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN cvs cv ON cv.user_id = a.student_id
     WHERE a.id = $1 AND a.status <> 'withdrawn' AND (v.employer_id = $2 OR a.student_id = $2)`,
    [id, u.id],
  );
  if (!rows[0]) return apiError(c, 404, 'CV_NOT_FOUND');
  const bytes = await loadCvBytes(c.env, c.var.db, rows[0]);
  return bytes ? cvResponse({ ...rows[0], content: bytes }) : apiError(c, 404, 'CV_NOT_FOUND');
});
