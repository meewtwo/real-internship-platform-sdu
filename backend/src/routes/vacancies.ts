import { Hono } from 'hono';
import { MATCH_NOTIFY_THRESHOLD, matchScore, parseSearchQuery, skillKey, validateApply, validateVacancy, vacancySimilarity } from '@sdu/shared';
import { asDbError } from '../lib/db';
import { iso, replaceSkillsStmts, uniqueStamp } from '../lib/sql';
import { requireAuth } from '../lib/guard';
import { apiError, readJson, UUID_RE, type AppEnv, type Ctx } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { companyApproved, loadStudentSignal, loadStudentSignals, matchFor, SQL_TODAY, STUDENT_VISIBLE, toVacancyDto, VACANCY_SELECT, vacancySignal, type VacancyRow } from '../services/matching';
import { auditIf } from '../services/audit';
import { notifyIf } from '../services/notify';
import { publishVacancy } from '../services/publish';
import { embedVacancy } from '../services/embeddings';

export const vacancies = new Hono<AppEnv>();
const esc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

async function ownVacancy(c: Ctx, id: string): Promise<VacancyRow | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} WHERE v.id = $1 AND v.employer_id = $2`, [id, c.var.auth!.user.id]);
  return rows[0] ?? null;
}

// ───────────────────────── Employer: manage ─────────────────────────
vacancies.get('/mine', requireAuth('employer'), async (c) => {
  const { rows } = await c.var.db.query<VacancyRow>(
    `${VACANCY_SELECT.replace('FROM vacancies v', ", (SELECT count(*) FROM applications a WHERE a.vacancy_id = v.id AND a.status <> 'withdrawn') AS applicants FROM vacancies v")} WHERE v.employer_id = $1 ORDER BY v.created_at DESC LIMIT 200`,
    [c.var.auth!.user.id],
  );
  return c.json({ vacancies: rows.map(toVacancyDto) });
});

vacancies.post('/', requireAuth('employer'), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateVacancy(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const d = v.data;
  const rl = await rateLimit(c.var.db, c.env, `vac:${c.var.auth!.user.id}`, 60, 3600);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const id = crypto.randomUUID();
  await c.var.db.batch([
    { sql: `INSERT INTO vacancies (id, employer_id, title, title_lc, description, description_lc, kind, industry_key, city_key, city_other, work_format, min_gpa, deadline, salary_min, salary_max, industry_other)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      params: [id, c.var.auth!.user.id, d.title, d.title.toLocaleLowerCase(), d.description, d.description.toLocaleLowerCase(), d.kind, d.industry, d.city, d.cityOther, d.workFormat, d.minGpa, d.deadline, d.salaryMin, d.salaryMax, d.industryOther] },
    ...replaceSkillsStmts('vacancy_skills', 'vacancy_id', id, d.requiredSkills),
  ]);
  const row = await ownVacancy(c, id);
  return c.json({ vacancy: toVacancyDto(row!) }, 201);
});

vacancies.put('/:id', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  if (cur.status === 'closed') return apiError(c, 409, 'VACANCY_CLOSED');
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateVacancy(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const d = v.data;
  await c.var.db.batch([
    { sql: `UPDATE vacancies SET title = $2, title_lc = $13, description = $3, description_lc = $14, kind = $4, industry_key = $5, city_key = $6, city_other = $7, work_format = $8, min_gpa = $9, deadline = $10, salary_min = $11, salary_max = $12, industry_other = $15 WHERE id = $1`,
      params: [cur.id, d.title, d.description, d.kind, d.industry, d.city, d.cityOther, d.workFormat, d.minGpa, d.deadline, d.salaryMin, d.salaryMax, d.title.toLocaleLowerCase(), d.description.toLocaleLowerCase(), d.industryOther] },
    ...replaceSkillsStmts('vacancy_skills', 'vacancy_id', cur.id, d.requiredSkills),
  ]);
  const updated = (await ownVacancy(c, cur.id))!;
  if (updated.status === 'published') await embedVacancy(c.var.db, c.env, updated); // keep the semantic vector in step with the edited text
  return c.json({ vacancy: toVacancyDto(updated) });
});

vacancies.post('/:id/publish', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  // the same approval field the student list checks (STUDENT_VISIBLE), so a vacancy can never be published and still be hidden
  const review = (await c.var.db.query<{ review_status: string }>('SELECT review_status FROM employer_profiles WHERE user_id = $1', [c.var.auth!.user.id])).rows[0]?.review_status;
  if (c.var.auth!.user.status !== 'active' || review !== 'approved') return apiError(c, 403, review === 'rejected' ? 'EMPLOYER_REJECTED' : 'EMPLOYER_NOT_APPROVED');
  if (cur.status === 'published') return c.json({ vacancy: toVacancyDto(cur), matches: 0 });
  // a closed vacancy stays closed (it used to answer 200 here without publishing anything, which looked like success)
  if (cur.status === 'closed') return apiError(c, 409, 'VACANCY_CLOSED');
  const r = await publishVacancy(c.var.db, c.env, cur, { id: c.var.auth!.user.id, role: 'employer' });
  if (!r.ok) return apiError(c, 400, 'VALIDATION_FAILED', { fields: r.fields });
  const fresh = (await ownVacancy(c, cur.id))!;
  return c.json({ vacancy: toVacancyDto(fresh), matches: r.matches, queued: r.queued });
});

/**
 * "Publish after approval": a company that is still waiting for the admin marks a draft; approving the company publishes it (publishRequestedDrafts).
 * An approved company publishes directly instead (409 here, so the client never thinks a request is pending). DELETE withdraws the request.
 */
vacancies.post('/:id/publish-request', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  if (cur.status !== 'draft') return apiError(c, 409, cur.status === 'closed' ? 'VACANCY_CLOSED' : 'VACANCY_NOT_DRAFT');
  if (cur.company_review === 'rejected') return apiError(c, 403, 'EMPLOYER_REJECTED');
  if (cur.company_review === 'approved' && c.var.auth!.user.status === 'active') return apiError(c, 409, 'EMPLOYER_ALREADY_APPROVED');
  await c.var.db.query(`UPDATE vacancies SET publish_requested_at = COALESCE(publish_requested_at, $2) WHERE id = $1 AND status = 'draft'`, [cur.id, iso()]);
  return c.json({ vacancy: toVacancyDto((await ownVacancy(c, cur.id))!) });
});
vacancies.delete('/:id/publish-request', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  await c.var.db.query('UPDATE vacancies SET publish_requested_at = NULL WHERE id = $1', [cur.id]);
  return c.json({ vacancy: toVacancyDto((await ownVacancy(c, cur.id))!) });
});

vacancies.post('/:id/close', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  if (cur.status !== 'published') return apiError(c, 409, 'VACANCY_NOT_PUBLISHED');
  const stamp = uniqueStamp();
  await c.var.db.batch([
    { sql: `UPDATE vacancies SET status = 'closed', updated_at = $2 WHERE id = $1 AND status = 'published'`, params: [cur.id, stamp] },
    auditIf("SELECT 1 FROM vacancies WHERE id = $7 AND status = 'closed' AND updated_at = $8", [cur.id, stamp], { id: c.var.auth!.user.id, role: 'employer' }, 'vacancy.close', { type: 'vacancy', id: cur.id }),
  ]);
  return c.json({ vacancy: toVacancyDto((await ownVacancy(c, cur.id))!) });
});

vacancies.delete('/:id', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  // one batch, one guard: audit + delete both happen only while the vacancy has no applications (no interleaving inside a batch)
  const guard = 'SELECT 1 FROM vacancies v WHERE v.id = $7 AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.vacancy_id = v.id)';
  const rs = await c.var.db.batch([
    auditIf(guard, [cur.id], { id: c.var.auth!.user.id, role: 'employer' }, 'vacancy.delete', { type: 'vacancy', id: cur.id }, { status: cur.status }),
    { sql: 'DELETE FROM vacancies WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.vacancy_id = $1)', params: [cur.id] },
  ]);
  const done = rs[1].rowCount > 0;
  if (!done) return apiError(c, 409, 'VACANCY_HAS_APPLICATIONS');
  return c.json({ ok: true });
});

/** Applicants of one vacancy, ranked by match %. */
vacancies.get('/:id/applicants', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  return c.json({ vacancy: toVacancyDto(cur), applicants: await rankedApplicants(c, [cur.id]) });
});

export async function rankedApplicants(c: Ctx, vacancyIds: string[]) {
  const { rows } = await c.var.db.query<Record<string, any>>(
    `SELECT a.id, a.vacancy_id, a.status, a.match_percent, a.cover_note, a.created_at, sp.user_id AS student_id, sp.name, sp.surname, sp.major_key, sp.year_of_study,
            sp.gpa AS gpa, sp.city_key, sp.city_other, u.email, u.phone, (cv.user_id IS NOT NULL) AS has_cv, cv.experience_years AS exp,
            v.title AS vacancy_title
     FROM applications a JOIN student_profiles sp ON sp.user_id = a.student_id JOIN users u ON u.id = a.student_id
     JOIN vacancies v ON v.id = a.vacancy_id LEFT JOIN cvs cv ON cv.user_id = a.student_id
     WHERE a.vacancy_id IN (SELECT value FROM json_each($1)) AND a.status <> 'withdrawn' ORDER BY a.match_percent DESC, a.created_at ASC LIMIT 300`,
    [JSON.stringify(vacancyIds)],
  );
  // fresh explainable breakdown against the vacancy's CURRENT requirements
  const vac = new Map<string, VacancyRow>();
  for (const id of vacancyIds) { const r = (await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} WHERE v.id = $1`, [id])).rows[0]; if (r) vac.set(id, r); }
  const signals = await loadStudentSignals(c.var.db, [...new Set(rows.map((r) => r.student_id as string))]);
  const out = [];
  for (const r of rows) {
    const s = signals.get(r.student_id) ?? null;
    const m = s && vac.get(r.vacancy_id) ? matchScore(s, vacancySignal(vac.get(r.vacancy_id)!)) : null;
    out.push({
      id: r.id, vacancyId: r.vacancy_id, vacancyTitle: r.vacancy_title, status: r.status, matchPercent: r.match_percent, coverNote: r.cover_note, appliedAt: r.created_at,
      student: { id: r.student_id, name: r.name, surname: r.surname, email: r.email, phone: r.phone, major: r.major_key, year: r.year_of_study, gpa: r.gpa, city: r.city_key, cityOther: r.city_other, hasCv: r.has_cv, experienceYears: Number(r.exp ?? 0) },
      matchedSkills: m?.matchedSkills ?? [], missingSkills: m?.missingSkills ?? [],
    });
  }
  return out;
}

// ───────────────────────── Browse / search (all roles; students get match %) ─────────────────────────
vacancies.get('/', requireAuth(), async (c) => {
  const p = parseSearchQuery(c.req.query());
  if (!p.ok) return apiError(c, 400, 'SEARCH_INVALID');
  const f = p.value;
  const params: unknown[] = [];
  const where = [STUDENT_VISIBLE];
  const add = (sql: string, val: unknown) => { params.push(val); where.push(sql.replace('$#', `$${params.length}`)); };
  if (f.q) { params.push(`%${esc(f.q.toLocaleLowerCase())}%`); const i = params.length; where.push(`(v.title_lc LIKE $${i} ESCAPE '\\' OR v.description_lc LIKE $${i} ESCAPE '\\' OR ep.company_lc LIKE $${i} ESCAPE '\\' OR EXISTS (SELECT 1 FROM vacancy_skills vs JOIN skills s ON s.id = vs.skill_id WHERE vs.vacancy_id = v.id AND s.name_key LIKE $${i} ESCAPE '\\'))`); }
  if (f.industry) add('v.industry_key = $#', f.industry);
  if (f.kind) add('v.kind = $#', f.kind);
  if (f.format) add('v.work_format = $#', f.format);
  if (f.city) add('v.city_key = $#', f.city);
  if (f.salaryFrom) add('COALESCE(v.salary_max, v.salary_min) >= $#', f.salaryFrom);
  if (f.withSalary) where.push('(v.salary_min IS NOT NULL OR v.salary_max IS NOT NULL)');
  const { rows } = await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} WHERE ${where.join(' AND ')} ORDER BY v.published_at DESC LIMIT 500`, params);
  const student = c.var.auth!.user.role === 'student' ? await loadStudentSignal(c.var.db, c.var.auth!.user.id) : null;
  let items = rows.map((r) => ({ v: r, m: matchFor(student, r) }));
  if (f.sort === 'match' && student) items.sort((a, b) => b.m!.percent - a.m!.percent);
  if (f.sort === 'salary') items.sort((a, b) => (b.v.salary_max ?? b.v.salary_min ?? -1) - (a.v.salary_max ?? a.v.salary_min ?? -1));
  const total = items.length;
  items = items.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  const applied = student ? new Set((await c.var.db.query<{ vacancy_id: string }>(`SELECT vacancy_id FROM applications WHERE student_id = $1 AND status <> 'withdrawn'`, [c.var.auth!.user.id])).rows.map((r) => r.vacancy_id)) : new Set<string>();
  const favs = new Set((await c.var.db.query<{ vacancy_id: string }>('SELECT vacancy_id FROM favorites WHERE user_id = $1 AND vacancy_id IN (SELECT value FROM json_each($2))', [c.var.auth!.user.id, JSON.stringify(items.map((x) => x.v.id))])).rows.map((r) => r.vacancy_id));
  return c.json({ total, page: f.page, pageSize: f.pageSize, items: items.map(({ v, m }) => ({ ...toVacancyDto(v), match: m, applied: applied.has(v.id), favorite: favs.has(v.id) })) });
});

vacancies.get('/:id', requireAuth(), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const { rows } = await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} WHERE v.id = $1`, [id]);
  const v = rows[0];
  const a = c.var.auth!.user;
  // students: published vacancies of approved companies only (a past deadline still opens, read-only); admins see everything (moderation)
  if (!v || (v.status === 'draft' && v.employer_id !== a.id && a.role !== 'admin') || (a.role === 'student' && (v.status !== 'published' || !companyApproved(v)))) return apiError(c, 404, 'NOT_FOUND');
  const student = a.role === 'student' ? await loadStudentSignal(c.var.db, a.id) : null;
  if (a.role === 'student' && v.status === 'published') {
    // one row per student per day; analytics must never break the page, so failures are swallowed
    await c.var.db.query('INSERT OR IGNORE INTO vacancy_views (vacancy_id, student_id) VALUES ($1, $2)', [id, a.id]).catch(() => undefined);
  }
  const app = a.role === 'student' ? (await c.var.db.query(`SELECT id, status, match_percent, created_at FROM applications WHERE vacancy_id = $1 AND student_id = $2`, [id, a.id])).rows[0] : null;
  const favorite = (await c.var.db.query('SELECT 1 FROM favorites WHERE user_id = $1 AND vacancy_id = $2', [a.id, id])).rowCount > 0;
  return c.json({ vacancy: toVacancyDto(v), favorite, match: matchFor(student, v), application: app ? { id: app.id, status: app.status, matchPercent: app.match_percent, createdAt: app.created_at } : null });
});

// ───────────────────────── Employer: insights (views → applications) ─────────────────────────
vacancies.get('/:id/insights', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  const db = c.var.db;
  const views = (await db.query<{ total: number; unique: number; converted: number }>(
    `SELECT count(*) AS total, count(DISTINCT vw.student_id) AS "unique",
            count(DISTINCT vw.student_id) FILTER (WHERE EXISTS (SELECT 1 FROM applications a WHERE a.vacancy_id = vw.vacancy_id AND a.student_id = vw.student_id AND a.status <> 'withdrawn')) AS converted
     FROM vacancy_views vw WHERE vw.vacancy_id = $1`, [cur.id])).rows[0];
  const series = (await db.query<{ day: string; views: number }>(
    `WITH RECURSIVE d(day) AS (SELECT date('now', '+5 hours', '-29 days') UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < date('now', '+5 hours'))
     SELECT day, (SELECT count(*) FROM vacancy_views vw WHERE vw.vacancy_id = $1 AND vw.day = d.day) AS views FROM d ORDER BY day`, [cur.id])).rows;
  const byStatus = Object.fromEntries((await db.query<{ status: string; n: number }>(
    `SELECT status, count(*) AS n FROM applications WHERE vacancy_id = $1 GROUP BY status`, [cur.id])).rows.map((r) => [r.status, r.n]));
  const apps = (await db.query<{ student_id: string; match_percent: number }>(
    `SELECT student_id, match_percent FROM applications WHERE vacancy_id = $1 AND status <> 'withdrawn'`, [cur.id])).rows;
  const pool = (await db.query<{ n: number; avg: number | null }>('SELECT count(*) AS n, round(avg(percent), 1) AS avg FROM matches WHERE vacancy_id = $1', [cur.id])).rows[0];
  // what applicants lack most often (fresh against the CURRENT requirements) – tells the employer which requirement filters people out
  const signals = await loadStudentSignals(db, apps.map((x) => x.student_id));
  const gap = new Map<string, { skill: string; n: number }>();
  for (const s of signals.values()) for (const m of matchScore(s, vacancySignal(cur)).missingSkills) { const k = skillKey(m); const g = gap.get(k) ?? { skill: m, n: 0 }; g.n++; gap.set(k, g); }
  return c.json({
    views: { total: views.total, unique: views.unique, series },
    applications: { total: apps.length, byStatus, conversionPercent: views.unique ? Math.round((views.converted / views.unique) * 1000) / 10 : null,
      averageMatch: apps.length ? Math.round((apps.reduce((a, x) => a + x.match_percent, 0) / apps.length) * 10) / 10 : null },
    matchPool: { size: pool.n, averageMatch: pool.avg === null ? null : Number(pool.avg) },
    topMissingSkills: [...gap.values()].sort((a, b) => b.n - a.n || a.skill.localeCompare(b.skill)).slice(0, 5),
  });
});

// ───────────────────────── Similar vacancies ─────────────────────────
vacancies.get('/:id/similar', requireAuth('student', 'employer'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const a = c.var.auth!.user;
  const { rows } = await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} WHERE v.id = $1`, [id]);
  const base = rows[0];
  if (!base || ((base.status !== 'published' || !companyApproved(base)) && base.employer_id !== a.id)) return apiError(c, 404, 'NOT_FOUND');
  const pool = (await c.var.db.query<VacancyRow>(
    `${VACANCY_SELECT} WHERE ${STUDENT_VISIBLE} AND v.id <> $1 ORDER BY v.published_at DESC LIMIT 500`, [id])).rows;
  const bs = { ...vacancySignal(base), kind: base.kind };
  const ranked = pool.map((v) => ({ v, score: vacancySimilarity(bs, { ...vacancySignal(v), kind: v.kind }) })).filter((x) => x.score >= 0.2)
    .sort((x, y) => y.score - x.score || x.v.id.localeCompare(y.v.id)).slice(0, 5);
  const student = a.role === 'student' ? await loadStudentSignal(c.var.db, a.id) : null;
  return c.json({ similar: ranked.map(({ v, score }) => ({ ...toVacancyDto(v), similarity: Math.round(score * 100), match: matchFor(student, v) })) });
});

// ───────────────────────── Student: "what if I learn X?" ─────────────────────────
vacancies.get('/:id/whatif', requireAuth('student'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const { rows } = await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} WHERE v.id = $1 AND v.status = 'published' AND ep.review_status = 'approved'`, [id]);
  const v = rows[0];
  const s = await loadStudentSignal(c.var.db, c.var.auth!.user.id);
  if (!v || !s) return apiError(c, 404, 'NOT_FOUND');
  const base = matchScore(s, vacancySignal(v));
  const gain = (skills: string[]) => matchScore({ ...s, skills: [...s.skills, ...skills] }, vacancySignal(v)).percent;
  const options = base.missingSkills.map((sk) => ({ skill: sk, percent: gain([sk]) })).map((o) => ({ ...o, delta: o.percent - base.percent })).sort((a, b) => b.delta - a.delta);
  return c.json({ current: base.percent, options, all: base.missingSkills.length ? gain(base.missingSkills) : base.percent });
});

// ───────────────────────── Employer: talent pool + invitations ─────────────────────────
vacancies.get('/:id/talent', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  const { rows } = await c.var.db.query<{ student_id: string; percent: number; invited: boolean }>(
    `SELECT m.student_id, m.percent, EXISTS (SELECT 1 FROM invitations i WHERE i.vacancy_id = m.vacancy_id AND i.student_id = m.student_id) AS invited
     FROM matches m JOIN users u ON u.id = m.student_id AND u.status = 'active'
     WHERE m.vacancy_id = $1 AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.vacancy_id = m.vacancy_id AND a.student_id = m.student_id AND a.status <> 'withdrawn')
     ORDER BY m.percent DESC LIMIT 20`, [cur.id]);
  const ids = rows.map((r) => r.student_id);
  const signals = await loadStudentSignals(c.var.db, ids);
  const prof = (await c.var.db.query<Record<string, any>>(`SELECT user_id, name, surname, major_key, year_of_study, gpa AS gpa, city_key, city_other FROM student_profiles WHERE user_id IN (SELECT value FROM json_each($1))`, [JSON.stringify(ids)])).rows;
  const byId = new Map(prof.map((p) => [p.user_id, p]));
  return c.json({ candidates: rows.map((r) => {
    const p = byId.get(r.student_id)!, s = signals.get(r.student_id), m = s ? matchScore(s, vacancySignal(cur)) : null;
    return { studentId: r.student_id, name: p.name, surname: p.surname, major: p.major_key, year: p.year_of_study, gpa: p.gpa, city: p.city_key, cityOther: p.city_other, matchPercent: r.percent, matchedSkills: m?.matchedSkills ?? [], missingSkills: m?.missingSkills ?? [], invited: r.invited };
  }) });
});

vacancies.post('/:id/invite', requireAuth('employer'), async (c) => {
  const cur = await ownVacancy(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'NOT_FOUND');
  if (cur.status !== 'published') return apiError(c, 409, 'VACANCY_NOT_PUBLISHED');
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const sid = typeof body.body === 'object' && body.body ? (body.body as Record<string, unknown>).studentId : null;
  const extra = typeof body.body === 'object' && body.body ? Object.keys(body.body as object).filter((k) => k !== 'studentId') : [];
  if (extra.length) return apiError(c, 400, 'UNKNOWN_FIELDS');
  if (typeof sid !== 'string' || !UUID_RE.test(sid)) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { studentId: 'STUDENT_NOT_FOUND' } });
  const rl = await rateLimit(c.var.db, c.env, `invite:${c.var.auth!.user.id}`, 20, 86400);
  if (!rl.allowed) return apiError(c, 429, 'INVITE_LIMIT', { retryAfter: rl.retryAfter });
  const stamp = uniqueStamp();
  const [ins] = await c.var.db.batch([
    { sql: `INSERT OR IGNORE INTO invitations (vacancy_id, student_id, created_at) SELECT $1, sp.user_id, $3 FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $2 AND u.status = 'active' RETURNING student_id`, params: [cur.id, sid, stamp] },
    notifyIf('SELECT 1 FROM invitations WHERE vacancy_id = $5 AND student_id = $6 AND created_at = $7', [cur.id, sid, stamp], sid, 'invitation', { title: cur.title, company: cur.company_name }, `/vacancies/${cur.id}`),
  ]);
  let ok: 'OK' | 'NF' | 'DUP' = 'OK';
  if (!ins.rowCount) ok = (await c.var.db.query("SELECT 1 FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1 AND u.status = 'active'", [sid])).rowCount ? 'DUP' : 'NF';
  if (ok === 'NF') return apiError(c, 404, 'STUDENT_NOT_FOUND' as never);
  if (ok === 'DUP') return apiError(c, 409, 'ALREADY_INVITED');
  return c.json({ ok: true }, 201);
});

// ───────────────────────── Student: one-click apply (US-9) ─────────────────────────
vacancies.post('/:id/apply', requireAuth('student'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  let payload: unknown = {};
  const rawBody = await c.req.text(); // an empty body means "no cover note"
  if (rawBody.trim() !== '') {
    if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return apiError(c, 415, 'UNSUPPORTED_MEDIA_TYPE');
    try { payload = JSON.parse(rawBody); } catch { return apiError(c, 400, 'INVALID_JSON'); }
  }
  const v = validateApply(payload);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const { rows } = await c.var.db.query<VacancyRow & { expired: boolean }>(`${VACANCY_SELECT.replace('SELECT v.id', `SELECT (v.deadline IS NOT NULL AND v.deadline < ${SQL_TODAY}) AS expired, v.id`)} WHERE v.id = $1`, [id]);
  const vac = rows[0];
  if (!vac || vac.status === 'draft' || !companyApproved(vac)) return apiError(c, 404, 'NOT_FOUND');
  if (vac.status === 'closed' || vac.expired) return apiError(c, 409, 'VACANCY_CLOSED');
  const sid = c.var.auth!.user.id;
  const s = await loadStudentSignal(c.var.db, sid);
  const m = matchScore(s!, vacancySignal(vac));
  try {
    const nm = (await c.var.db.query<{ n: string; s: string }>('SELECT name AS n, surname AS s FROM student_profiles WHERE user_id = $1', [sid])).rows[0];
    const stamp = uniqueStamp();
    // one atomic UPSERT: a new row, or a withdrawn one re-applied; an active application matches no row (→ ALREADY_APPLIED even under a race)
    const [up] = await c.var.db.batch([
      { sql: `INSERT INTO applications (id, vacancy_id, student_id, match_percent, cover_note, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (vacancy_id, student_id) DO UPDATE SET status = 'applied', match_percent = $4, cover_note = $5, updated_at = $6 WHERE applications.status = 'withdrawn'
              RETURNING id`, params: [crypto.randomUUID(), id, sid, m.percent, v.data.coverNote, stamp] },
      { sql: `INSERT INTO application_events (application_id, status) SELECT id, 'applied' FROM applications WHERE vacancy_id = $1 AND student_id = $2 AND updated_at = $3`, params: [id, sid, stamp] },
      notifyIf('SELECT 1 FROM applications WHERE vacancy_id = $5 AND student_id = $6 AND updated_at = $7', [id, sid, stamp], vac.employer_id, 'new_application', { title: vac.title, student: `${nm.n} ${nm.s}`, percent: m.percent }, `/vacancies/${id}/applicants`),
    ]);
    if (!up.rowCount) return apiError(c, 409, 'ALREADY_APPLIED');
    const appId = (up.rows[0] as { id: string }).id;
    return c.json({ application: { id: appId, status: 'applied', matchPercent: m.percent } }, 201);
  } catch (e) {
    if (asDbError(e).code === '23505') return apiError(c, 409, 'ALREADY_APPLIED');
    throw e;
  }
});
